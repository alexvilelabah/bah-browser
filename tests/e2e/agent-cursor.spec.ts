import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// O cursor/ondinha que o Bah desenha tem que cair onde o clique DE VERDADE caiu na página. Antes o overlay
// somava o deslocamento da janela e desenhava ~100 px abaixo do clique. Página local só; o agente é
// conduzido por E2E_MOCK_SCRIPT (sem modelo).
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('the overlay cursor and ripple land where the real click landed on the page', async () => {
  test.setTimeout(120_000);
  const PAGE = `<!doctype html><title>cursor</title><style>body{margin:0}#t1{position:absolute;left:600px;top:420px;width:160px;height:60px}</style>
<button id=t1>Target one</button><script>window.__clicks=[];window.__moves=[];addEventListener('mousemove',e=>__moves.push([e.clientX,e.clientY]));addEventListener('click',e=>__clicks.push([e.clientX,e.clientY,e.isTrusted]));</script>`;
  const server = http.createServer((_q, r) => { r.setHeader('Content-Type', 'text/html'); r.end(PAGE); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-cursor-'));
  const script = [{ type: 'navigate', url: T }, { type: 'click_text', text: 'Target one' }, { type: 'done', reason: 'ok', success: true }];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.evaluate(() => {
      const w = window as any;
      w.__ripples = []; w.__cursor = null;
      const center = (el: Element) => { const r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; };
      new MutationObserver(() => {
        document.querySelectorAll('.agent-ripple').forEach(el => {
          const c = center(el);
          if (!w.__ripples.some((x: number[]) => x[0] === c[0] && x[1] === c[1])) w.__ripples.push(c);
        });
        // Ponta da seta = canto de cima à esquerda do elemento do cursor.
        const cur = document.querySelector('.agent-cursor');
        if (cur) { const r = cur.getBoundingClientRect(); w.__cursor = [Math.round(r.left), Math.round(r.top)]; }
      }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
    });
    await page.getByTestId('agent-command-input').fill('click target one');
    await page.getByTestId('agent-command-input').press('Enter');
    let clicks: number[][] = [];
    for (let i = 0; i < 120 && !clicks.length; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      clicks = await app.evaluate(async ({ webContents }, url) => {
        const wc = webContents.getAllWebContents().find(w => w.getType() === 'webview' && w.getURL() === url);
        return wc ? JSON.parse(await wc.executeJavaScript('JSON.stringify(window.__clicks || [])')) : [];
      }, T).catch(() => []);
      await sleep(500);
    }
    expect(clicks.length).toBeGreaterThan(0);
    const [cx, cy, trusted] = clicks[0] as any;
    expect(trusted).toBe(true);
    const wv = await page.evaluate(() => { const w = [...document.querySelectorAll('webview')].find(x => (x as HTMLElement).offsetParent) as HTMLElement; const r = w.getBoundingClientRect(); return { x: r.left, y: r.top }; });
    const ripples: number[][] = await page.evaluate(() => (window as any).__ripples);
    expect(ripples.length).toBeGreaterThan(0);
    const [rx, ry] = ripples[ripples.length - 1];
    // Ondinha (coordenadas da janela) − origem da página = ponto na página; tem que bater com o clique real.
    expect(Math.abs(rx - wv.x - cx)).toBeLessThanOrEqual(6);
    expect(Math.abs(ry - wv.y - cy)).toBeLessThanOrEqual(6);
    // O cursor desenhado termina no mesmo ponto.
    const cursor: number[] | null = await page.evaluate(() => (window as any).__cursor);
    expect(cursor).toBeTruthy();
    expect(Math.abs(cursor![0] - wv.x - cx)).toBeLessThanOrEqual(6);
    expect(Math.abs(cursor![1] - wv.y - cy)).toBeLessThanOrEqual(6);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
