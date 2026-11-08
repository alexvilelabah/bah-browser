import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Iframes: o agente vê e usa campos/botões de um iframe do mesmo site (srcdoc) e de OUTRO site
// (cross-origin, processo separado) — formulário de vaga, pagamento, reserva embutidos.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
// --use-mock-keychain: no macOS o cofre de senhas (safeStorage) abre um pedido do Chaveiro que trava o main
// num perfil novo de teste; o chaveiro falso do Chromium evita o pedido.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('agent sees and fills fields inside same-origin and cross-origin iframes', async () => {
  test.setTimeout(180_000);
  const inner = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<label>Card number <input id="card"></label> <button onclick="document.title='sent:'+document.getElementById('card').value">Submit</button>`); });
  await new Promise<void>(r => inner.listen(0, '127.0.0.1', r));
  const IN = `http://localhost:${(inner.address() as AddressInfo).port}/`;
  const outer = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<title>Checkout</title><h1>Checkout</h1>
<iframe srcdoc="<label>Email <input id='em' value='old@example.com'></label>" style="width:420px;height:80px"></iframe>
<iframe src="${IN}" style="width:420px;height:80px"></iframe>`); });
  await new Promise<void>(r => outer.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(outer.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-ifr-'));
  const script = [
    { type: 'navigate', url: T },
    { type: 'fill_ref', ref: '__REF:Email__', value: 'ada@example.com' },
    { type: 'fill_ref', ref: '__REF:Card number__', value: '4242' },
    { type: 'click_ref', ref: '__REF:Submit__' },
    { type: 'done', reason: 'Filled the embedded forms.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('fill in my email and pay with card 4242 on this checkout');
    await page.getByTestId('agent-command-input').press('Enter');
    // Campo de cartão → o freio pede confirmação; a "pessoa" confirma.
    const frameValue = (urlPart: string, js: string) => app.evaluate(({ webContents }, [u, code]) => {
      const w = webContents.getAllWebContents().filter(w => w.getType() === 'webview').pop()!;
      const f = w.mainFrame.framesInSubtree.find(f => f.url.includes(u as string));
      return f ? f.executeJavaScript(code as string) : null;
    }, [urlPart, js] as const);
    let paid: any = null;
    for (let i = 0; i < 180 && !/^sent:/.test(String(paid)); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      const yes = page.locator('.confirm-yes').last();
      if (await yes.isVisible().catch(() => false)) await yes.click();
      paid = await frameValue('localhost', 'document.title').catch(() => null);
      await sleep(500);
    }
    expect(await frameValue('about:srcdoc', `document.getElementById('em').value`)).toBe('ada@example.com');
    expect(paid).toBe('sent:4242');
    const prompts: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
    expect(prompts[1] || '').toMatch(/frame="embedded"/);
    expect(prompts[1] || '').toMatch(new RegExp(`frame="localhost:\\d+"`));
  } finally { await app.close(); inner.close(); outer.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
