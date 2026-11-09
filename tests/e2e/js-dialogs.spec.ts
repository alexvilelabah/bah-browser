import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// alert/confirm das páginas. Pra pessoa: caixa do Bah (não a nativa, que trava a página). Pro agente:
// armado vale; alert fecha; confirm comum aceito; confirm de exclusão/pagamento vai pra pessoa.
// O Playwright prende os diálogos REAIS na sessão CDP dele, então o teste dispara o mesmo evento
// interno que o motor dispara ('-run-dialog', com info + callback) e confere a resposta do callback.
// (Que o motor dispara esse evento com o CDP do próprio Bah ligado foi conferido fora do Playwright.)
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
// --use-mock-keychain: no macOS o cofre de senhas (safeStorage) abre um pedido do Chaveiro que trava o main
// num perfil novo de teste; o chaveiro falso do Chromium evita o pedido.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('page dialogs: Bah box for the user, agent policy on agent tabs', async () => {
  test.setTimeout(180_000);
  const server = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<title>Shop</title><h1>Shop</h1>'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-jsdlg-'));
  const script = [
    { type: 'navigate', url: T + 'agent' },
    { type: 'dialog', accept: false },
    { type: 'wait', timeout: 9000 },
    { type: 'wait', timeout: 1000 },
    { type: 'done', reason: 'Handled the dialogs.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    const a = page.locator('.url-input'); await a.click(); await a.fill(T + 'user'); await a.press('Enter'); await sleep(2000);
    // Dispara um diálogo como o motor faria; a resposta do callback fica em globalThis.__dlg[key].
    const fire = (key: string, dialogType: 'alert' | 'confirm', messageText: string) => app.evaluate(({ webContents }, [k, ty, msg]) => {
      const w = webContents.getAllWebContents().filter(w => w.getType() === 'webview').pop()!;
      const g = globalThis as any; g.__dlg = g.__dlg || {};
      g.__dlg[k] = 'pending';
      (w as any).emit('-run-dialog', { frame: { origin: new URL(w.getURL()).origin }, dialogType: ty, messageText: msg, defaultPromptText: '' }, (ok: boolean) => { g.__dlg[k] = ok; });
    }, [key, dialogType, messageText] as const);
    const answer = (key: string) => app.evaluate((_e, k) => (globalThis as any).__dlg?.[k], key);

    // Pessoa: caixa do Bah.
    await fire('u1', 'confirm', 'Leave this page?');
    await expect(page.locator('.jsdialog')).toContainText('Leave this page?');
    await expect(page.locator('.jsdialog')).toContainText('127.0.0.1');
    await page.locator('.jsdialog-cancel').click();
    await expect.poll(() => answer('u1')).toBe(false);
    await fire('u2', 'alert', 'Saved!');
    await page.locator('.jsdialog-ok').click();
    await expect.poll(() => answer('u2')).toBe(true);

    // Agente: arma "dispensar", depois os diálogos chegam durante o wait.
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('handle the dialogs on this shop page');
    await page.getByTestId('agent-command-input').press('Enter');
    for (let i = 0; i < 120; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      const n = (await app.evaluate(() => ((global as any).__e2ePrompts || []).length));
      if (n >= 3) break;   // passo 3 (wait) começou: o dialog armado já valeu pra aba
      await sleep(500);
    }
    await fire('a1', 'confirm', 'Continue to step 2?');          // armado: dispensar
    await expect.poll(() => answer('a1')).toBe(false);
    await fire('a2', 'confirm', 'Apply this coupon?');           // sem armar: aceita
    await expect.poll(() => answer('a2')).toBe(true);
    await fire('a3', 'alert', 'Coupon applied');                  // alert: fecha
    await expect.poll(() => answer('a3')).toBe(true);
    await fire('a4', 'confirm', 'Delete this item permanently?'); // exclusão: a pessoa decide
    const box = page.locator('.jsdialog', { hasText: 'Delete this item permanently?' });
    await expect(box).toContainText('looks like a payment or a deletion');
    await box.locator('.jsdialog-cancel').click();
    await expect.poll(() => answer('a4')).toBe(false);
    let all = '';
    for (let i = 0; i < 60 && !/the user refused it/.test(all); i++) { all = (await app.evaluate(() => (global as any).__e2ePrompts || [])).join('\n'); await sleep(500); }
    expect(all).toMatch(/DIALOG: confirm "Continue to step 2\?" → dismissed \(as you armed it\)/);
    expect(all).toMatch(/DIALOG: confirm "Apply this coupon\?" → accepted/);
    expect(all).toMatch(/DIALOG: alert "Coupon applied" → closed/);
    expect(all).toMatch(/DIALOG: confirm "Delete this item permanently\?" → the user refused it/);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
