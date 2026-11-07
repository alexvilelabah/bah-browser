import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// click_role: "o 2º botão Add to cart" sem ref numérico; papel/nome inexistente devolve erro claro.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
// --use-mock-keychain: no macOS o cofre de senhas (safeStorage) abre um pedido do Chaveiro que trava o main
// num perfil novo de teste; o chaveiro falso do Chromium evita o pedido.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('click_role picks the nth button by name', async () => {
  test.setTimeout(120_000);
  const server = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<title>Shop</title><h1>Shop</h1>
<p>Kettle <button onclick="document.title='kettle'">Add to cart</button></p>
<p>Toaster <button onclick="document.title='toaster'">Add to cart</button></p>`); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-role-'));
  const script = [
    { type: 'navigate', url: T },
    { type: 'click_role', role: 'button', name: 'Add to cart', nth: 2 },
    { type: 'click_role', role: 'checkbox', name: 'Gift wrap' },
    { type: 'done', reason: 'Added the toaster.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('add the toaster to the cart');
    await page.getByTestId('agent-command-input').press('Enter');
    let last = '';
    for (let i = 0; i < 160 && !/STEP 3: [^\n]*\nRESULT/.test(last); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      const ps: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
      last = ps[ps.length - 1] || '';
      await sleep(500);
    }
    const title = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w => w.getType() === 'webview').pop()!.getTitle());
    expect(title).toBe('toaster');
    expect(last).toMatch(/STEP 3: click_role\(checkbox "Gift wrap"\)\nRESULT: \{"success":false,"error":"no checkbox labelled \\"Gift wrap\\"/);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
