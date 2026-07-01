import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// Memory Saver: aba parada é descartada (💤) e recarrega ao clicar.
// Roda só sob demanda (E2E_MEMSAVER=1) — o ciclo de varredura leva ~70s.
test('memory saver discards an idle tab and wakes it on click', async () => {
  test.skip(process.env.E2E_MEMSAVER !== '1', 'Set E2E_MEMSAVER=1 to run (takes ~2 min).');
  test.setTimeout(240_000);

  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/electron/dist/electron.exe'),
    args: [path.resolve(__dirname, '../..')],
    env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  try {
    // Encurta o tempo de inatividade pra 5s (a varredura continua a cada 60s).
    await page.evaluate(() => localStorage.setItem('memSaverIdleMs', '5000'));
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.tab')).toHaveCount(1);

    // Abre uma 2ª aba → a 1ª fica inativa.
    await page.locator('.tab-new').click();
    await expect(page.locator('.tab')).toHaveCount(2);

    // Espera o ciclo da varredura (60s) + folga → a aba 1 deve dormir (💤).
    await expect(page.locator('.tab.discarded')).toHaveCount(1, { timeout: 130_000 });
    // O webview da aba dormindo foi DESMONTADO (só resta 1 montado).
    await expect(page.locator('webview')).toHaveCount(1);

    // Clica na aba dormindo → acorda: 💤 some e o webview remonta.
    await page.locator('.tab.discarded').click();
    await expect(page.locator('.tab.discarded')).toHaveCount(0);
    await expect(page.locator('webview')).toHaveCount(2);
  } finally {
    await page.evaluate(() => localStorage.removeItem('memSaverIdleMs')).catch(() => {});
    await app.close();
  }
});
