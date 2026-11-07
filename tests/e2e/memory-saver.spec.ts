import { test, expect, _electron as electron, type Page } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Economia de memória (regras em src/shared/memory-saver.ts): com o tempo parada encurtado (1,5 s) e
// a varredura a cada 1 s, a aba parada comum dorme (o <webview> é desmontado) e acorda no clique; ficam
// acordadas a aba com formulário digitado, a fixada, a de um site da lista "sempre ativos" e a da sessão
// com tarefa do agente parada no freio de segurança (cartão de pagamento esperando a pessoa).
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// URLs das <webview> montadas (aba dormindo = sem <webview>).
const mounted = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('webview')].map(w => { try { return (w as any).getURL() as string; } catch { return ''; } }));
const isMounted = async (page: Page, needle: string) => (await mounted(page)).some(u => u.includes(needle));
// Abre uma aba nova e carrega a URL nela.
const openTab = async (page: Page, url: string) => {
  await page.locator('.tab-new').click(); await sleep(500);
  await page.evaluate((u) => {
    const wv = [...document.querySelectorAll('webview')].find(w => (w as HTMLElement).style.display !== 'none') as any;
    wv.loadURL(u);
  }, url);
  for (let i = 0; i < 40 && !(await isMounted(page, url)); i++) await sleep(250);
};

test('memory saver: idle tab sleeps; form, pinned, keep-active site and waiting agent session stay awake', async () => {
  test.setTimeout(180_000);
  const server = http.createServer((q, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const u = q.url || '/';
    if (u.startsWith('/apply')) {
      res.end(`<title>Checkout</title><h1>Your order</h1>
<button onclick="document.title = 'PAID'">Place order</button>`);
    } else if (u.startsWith('/form')) {
      res.end('<title>Form page</title><form><input id="q" name="q"><input type="search" name="s"></form>');
    } else {
      res.end(`<title>${u.slice(1) || 'home'}</title><h1>${u}</h1>`);
    }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const T = `http://127.0.0.1:${port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-memsaver-'));
  const script = [
    { type: 'navigate', url: T + 'apply' },
    { type: 'click_ref', ref: '__REF:Place order__' },
    { type: 'done', reason: 'Left it unpaid.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    // Desligada enquanto monta as abas; os overrides dos testes encurtam tempo parada e varredura.
    await page.evaluate(() => {
      localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1');
      localStorage.setItem('memSaver', '0');
      localStorage.setItem('memSaverIdleMs', '1500'); localStorage.setItem('memSaverSweepMs', '1000');
    });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);

    // 1) Tarefa do agente na 1ª aba, parada no freio de pagamento (esperando a pessoa).
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('place the order on this page');
    await page.getByTestId('agent-command-input').press('Enter');
    const payCancel = page.locator('.confirm-no');
    for (let i = 0; i < 120 && !(await payCancel.last().isVisible().catch(() => false)); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      await sleep(500);
    }
    await expect(payCancel.last()).toBeVisible();

    // 2) As outras abas: comum, formulário digitado, fixada, site da lista, e uma em branco por último (ativa).
    await openTab(page, T + 'plain');
    await openTab(page, T + 'form');
    await page.evaluate(() => {
      const wv = [...document.querySelectorAll('webview')].find(w => (w as any).getURL().includes('/form')) as any;
      return wv.executeJavaScript("document.getElementById('q').value = 'half typed'; document.querySelector('[type=search]').value = 'x'; 1");
    });
    await openTab(page, T + 'pinned');
    await page.locator('.tab.active').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
    await expect(page.locator('.tab.pinned')).toHaveCount(1);
    await openTab(page, `http://localhost:${port}/keep`);

    // Liga pelo menu ⋮ → 💤 e adiciona "localhost" à lista com o botão "Adicionar este site".
    await page.locator('.menu-btn[title="Menu"]').click();
    await page.getByTestId('menu-memsaver').click();
    await expect(page.getByTestId('memsaver-panel')).toBeVisible();
    await page.getByTestId('memsaver-keep-current').click();
    await expect(page.getByTestId('memsaver-keep-list')).toContainText('localhost');
    // Entrada inválida é recusada; nível troca e volta.
    await page.getByTestId('memsaver-keep-input').fill('not a site');
    await page.getByTestId('memsaver-keep-add').click();
    await expect(page.getByTestId('memsaver-keep-list')).not.toContainText('not a site');
    // Desligada, o nível fica travado; liga e escolhe Máxima.
    await expect(page.getByTestId('memsaver-level-maximum')).toBeDisabled();
    await page.getByTestId('memsaver-toggle').click();
    await page.getByTestId('memsaver-level-maximum').click();
    await expect(page.getByTestId('memsaver-level-maximum')).toHaveAttribute('aria-checked', 'true');
    await page.locator('.menu-overlay').click({ position: { x: 5, y: 300 } });   // fecha o menu
    expect(await page.evaluate(() => [localStorage.getItem('memSaver'), localStorage.getItem('memSaverLevel'), localStorage.getItem('memSaverKeep')]))
      .toEqual(['1', 'maximum', '["localhost"]']);

    await page.locator('.tab-new').click();   // aba em branco ativa: todas as outras ficam paradas

    // 3) A comum dorme…
    for (let i = 0; i < 40 && (await isMounted(page, '/plain')); i++) await sleep(250);
    expect(await isMounted(page, '/plain')).toBe(false);
    await expect(page.locator('.tab.discarded')).toHaveCount(1);
    // …e as protegidas continuam acordadas por várias varreduras, com o motivo no balão da aba.
    await sleep(3500);
    expect(await isMounted(page, '/form')).toBe(true);
    expect(await isMounted(page, '/pinned')).toBe(true);
    expect(await isMounted(page, '/keep')).toBe(true);
    expect(await isMounted(page, '/apply')).toBe(true);
    await expect(page.locator('.tab.discarded')).toHaveCount(1);
    await expect(page.locator('.tab[title*="form partly filled in"]')).toHaveCount(1);
    await expect(page.locator('.tab[title*="pinned tab"]')).toHaveCount(1);
    await expect(page.locator('.tab[title*="always keep active"]')).toHaveCount(1);
    await expect(page.locator('.tab[title*="AI task running or waiting"]')).toHaveCount(1);

    // 4) Clicar na aba dormindo acorda (o <webview> volta).
    await page.locator('.tab.discarded').first().click();
    for (let i = 0; i < 40 && (await page.locator('.tab.discarded').count()) === 1; i++) await sleep(250);
    await expect(page.locator('.tab.discarded')).toHaveCount(0);
    for (let i = 0; i < 40 && !(await isMounted(page, '/plain')); i++) await sleep(250);   // recarrega na URL dela
    expect(await isMounted(page, '/plain')).toBe(true);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
