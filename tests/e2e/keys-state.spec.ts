import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// get (estado do elemento), insert_text (cola de uma vez), keydown/keyup (shift-clique).
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
// --use-mock-keychain: no macOS o cofre de senhas (safeStorage) abre um pedido do Chaveiro que trava o main
// num perfil novo de teste; o chaveiro falso do Chromium evita o pedido.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAGE = `<!doctype html><title>Form</title><h1>Form</h1>
<label><input type="checkbox" id="terms" checked> I agree to the terms</label>
<button id="send" disabled>Send application</button>
<label>Cover letter <textarea id="cl"></textarea></label>
<button onclick="document.title = event.shiftKey ? 'shift-click' : 'plain-click'">Select range</button>`;

test('get state, insert_text and shift-click', async () => {
  test.setTimeout(150_000);
  const server = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end(PAGE); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-keys-'));
  const letter = 'Dear hiring team, I build browser automation. '.repeat(8).trim();
  const script = [
    { type: 'navigate', url: T },
    { type: 'get', ref: '__REF:I agree to the terms__' },
    { type: 'get', ref: '__REF:Send application__' },
    { type: 'fill_ref', ref: '__REF:Cover letter__', value: 'Hi.' },
    { type: 'insert_text', text: ' ' + letter },
    { type: 'keydown', key: 'Shift' },
    { type: 'click_ref', ref: '__REF:Select range__' },
    { type: 'keyup', key: 'Shift' },
    { type: 'get', ref: '__REF:Cover letter__' },
    { type: 'done', reason: 'Checked the form.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('check the application form and paste my cover letter');
    await page.getByTestId('agent-command-input').press('Enter');
    let last = '';
    for (let i = 0; i < 300 && !/STEP 9: get[^\n]*\nRESULT/.test(last); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      const ps: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
      last = ps[ps.length - 1] || '';
      await sleep(500);
    }
    const gets = [...last.matchAll(/GET @\d+: (\{[^\n]*\})/g)].map(m => JSON.parse(m[1]));
    expect(gets[0]).toMatchObject({ tag: 'input', type: 'checkbox', checked: true });
    expect(gets[1]).toMatchObject({ tag: 'button', enabled: false, text: 'Send application' });
    expect(gets[2]).toMatchObject({ tag: 'textarea', valueLength: `Hi. ${letter}`.length });
    expect(`Hi. ${letter}`.startsWith(gets[2].value)).toBe(true);
    const title = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w => w.getType() === 'webview').pop()!.getTitle());
    expect(title).toBe('shift-click');
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
