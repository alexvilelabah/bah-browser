import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// wait por condição: texto aparece, texto some, URL casa (glob), rede ociosa — e termina assim que for verdade.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
// --use-mock-keychain: no macOS o cofre de senhas (safeStorage) abre um pedido do Chaveiro que trava o main
// num perfil novo de teste; o chaveiro falso do Chromium evita o pedido.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAGE = `<!doctype html><title>Search</title><h1>Search</h1><div id="s">Loading…</div>
<a href="/orders/123" onclick="event.preventDefault(); setTimeout(function(){ location.href='/orders/123'; }, 1500)">Go to orders</a>
<script>setTimeout(function(){ document.getElementById('s').textContent = 'Results ready'; }, 2000);</script>`;
const ORDERS = `<!doctype html><title>Orders</title><h1>Order 123</h1><script>fetch('/slow').then(function(){ document.title='loaded'; });</script>`;

test('wait for text, text gone, URL glob and network idle', async () => {
  test.setTimeout(180_000);
  const server = http.createServer((q, res) => {
    if (q.url === '/slow') { setTimeout(() => res.end('ok'), 2500); return; }
    res.setHeader('Content-Type', 'text/html'); res.end(q.url!.startsWith('/orders') ? ORDERS : PAGE);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-wait-'));
  const script = [
    { type: 'navigate', url: T },
    { type: 'wait', text: 'Results ready', timeout: 10000 },
    { type: 'wait', gone: 'Loading', timeout: 10000 },
    { type: 'click_ref', ref: '__REF:Go to orders__' },
    { type: 'wait', url: '**/orders/*', timeout: 10000 },
    { type: 'wait', load: 'networkidle', timeout: 15000 },
    { type: 'wait', text: 'Never shows up', timeout: 2000 },
    { type: 'done', reason: 'Waited for everything.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('search, wait for results, then open my orders');
    await page.getByTestId('agent-command-input').press('Enter');
    let last = '';
    for (let i = 0; i < 240 && !/STEP 7: wait\(text "Never shows up"\)\nRESULT/.test(last); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      const ps: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
      last = ps[ps.length - 1] || '';
      await sleep(500);
    }
    const result = (n: number) => { const m = new RegExp(`STEP ${n}: [^\\n]*\\nRESULT: ([^\\n]*)`).exec(last); return m ? JSON.parse(m[1]) : null; };
    expect(result(2)).toMatchObject({ success: true, info: { waitedFor: 'text "Results ready"' } });
    expect(result(3)).toMatchObject({ success: true });
    expect(result(5)).toMatchObject({ success: true, info: { waitedFor: 'URL **/orders/*' } });
    expect(result(6)).toMatchObject({ success: true, info: { waitedFor: 'page networkidle' } });
    expect(result(7)?.success).toBe(false);
    expect(result(7)?.error).toMatch(/not yet/);
    const title = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w => w.getType() === 'webview').pop()!.getTitle());
    expect(title).toBe('loaded');   // networkidle esperou o /slow terminar
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
