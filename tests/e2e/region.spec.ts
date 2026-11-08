import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// 🌍 Região e hora: o fuso que os sites veem só muda quando a PESSOA escolhe (painel ou cartão do
// agente), aparece num selo na barra, e volta pro do computador ao reiniciar (sem "manter").
// Região de compras em "computador" → nenhuma consulta de rede no teste.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
// --use-mock-keychain: no macOS o cofre de senhas (safeStorage) abre um pedido do Chaveiro que trava o main
// num perfil novo de teste; o chaveiro falso do Chromium evita o pedido.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('time zone for sites: panel, chip, agent suggestion, reset on restart', async () => {
  test.setTimeout(150_000);
  const server = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<title>Flights</title><h1>Flight times</h1>'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-region-'));
  fs.writeFileSync(path.join(tmp, 'region.json'), JSON.stringify({ shopping: 'os', tz: 'os' }));
  const script = [
    { type: 'suggest_time_zone', zone: 'Asia/Tokyo', reason: 'You are booking a flight that departs from Tokyo.' },
    { type: 'done', reason: 'Suggested Tokyo time.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const launch = () => electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  let app = await launch();
  try {
    let page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    const go = async (u: string) => { const a = page.locator('.url-input'); await a.click(); await a.fill(u); await a.press('Enter'); await sleep(2000); };
    const pageTz = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w => w.getType() === 'webview').pop()!
      .executeJavaScript('Intl.DateTimeFormat().resolvedOptions().timeZone'));
    const osTz: string = await app.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    const openPanel = async () => { await page.locator('.menu-btn[title="Menu"]').click(); await page.locator('.menu-item', { hasText: 'Region & time' }).click(); };

    await go(T + '/');
    expect(await pageTz()).toBe(osTz);
    await expect(page.locator('.tz-chip')).toBeHidden();

    // Painel → Europe/Lisbon: o selo aparece e a página vê Lisboa (depois de recarregar).
    await openPanel();
    await page.locator('.region-tz').selectOption('zone');
    await page.locator('.region-zone').fill('Europe/Lisbon');
    await expect(page.locator('.region-panel')).toContainText('there now');
    await page.locator('.region-save').click();
    await expect(page.locator('.region-panel .proxy-status')).toContainText('Saved');
    await page.locator('.region-panel .tour-x').click();
    await expect(page.locator('.tz-chip')).toHaveText(/Lisbon/);
    await go(T + '/again');
    expect(await pageTz()).toBe('Europe/Lisbon');

    // UTC (privado).
    await openPanel(); await page.locator('.region-tz').selectOption('utc'); await page.locator('.region-save').click();
    await page.locator('.region-panel .tour-x').click();
    await expect(page.locator('.tz-chip')).toHaveText(/UTC/);
    await go(T + '/utc'); expect(await pageTz()).toBe('UTC');

    // Volta pro do computador.
    await openPanel(); await page.locator('.region-tz').selectOption('os'); await page.locator('.region-save').click();
    await page.locator('.region-panel .tour-x').click();
    await expect(page.locator('.tz-chip')).toBeHidden();
    await go(T + '/back'); expect(await pageTz()).toBe(osTz);

    // Agente sugere Tóquio → cartão → a pessoa aceita.
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('check the departure times on this flight page');
    await page.getByTestId('agent-command-input').press('Enter');
    const accept = page.getByRole('button', { name: /Use Tokyo time/ });
    for (let i = 0; i < 40 && !(await accept.isVisible().catch(() => false)); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      await sleep(500);
    }
    await accept.click();
    await expect(page.locator('.tz-chip')).toHaveText(/Tokyo/, { timeout: 10_000 });
    const prompts: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
    expect(prompts.some(p => /TIME ZONE: sites see the computer's time zone/.test(p))).toBe(true);
    await go(T + '/tokyo'); expect(await pageTz()).toBe('Asia/Tokyo');

    // Reinício sem "manter" → volta pro fuso do computador.
    await app.close();
    app = await launch();
    page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(2500);
    await expect(page.locator('.tz-chip')).toBeHidden();
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'region.json'), 'utf8')).tz).toBe('os');
  } finally { await app.close().catch(() => {}); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
