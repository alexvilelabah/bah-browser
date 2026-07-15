import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// Limite de passos da IA (menu ⋮): default 25 → clique vira 50 → persiste após reload.
// Roda só sob demanda (E2E_AGENT_STEPS=1).
test('agent step limit cycles 25→50 in the menu and persists', async () => {
  test.skip(process.env.E2E_AGENT_STEPS !== '1', 'Set E2E_AGENT_STEPS=1 to run.');
  test.setTimeout(120_000);

  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/electron/dist/electron.exe'),
    args: [path.resolve(__dirname, '../..')],
    env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  try {
    // Estado limpo: remove escolha de runs anteriores e recarrega → default 25.
    await page.evaluate(() => localStorage.removeItem('agentMaxSteps'));
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Abre o menu ⋮ (é o último .menu-wrap; o primeiro é o de downloads).
    const openMenu = async () => {
      await page.locator('.menu-wrap').last().locator('.menu-btn').click();
      await expect(page.locator('.menu-panel')).toBeVisible();
    };
    await openMenu();

    const stepsItem = page.locator('.menu-item', { hasText: 'AI steps' });
    await expect(stepsItem).toHaveCount(1);
    await expect(stepsItem.locator('.menu-switch')).toHaveText('25');

    // 1 clique → 50 (e para aqui: o teste cobre a opção de 50).
    await stepsItem.click();
    await expect(stepsItem.locator('.menu-switch')).toHaveText('50');

    // Persistiu?
    const stored = await page.evaluate(() => localStorage.getItem('agentMaxSteps'));
    expect(stored).toBe('50');

    // Reload → continua 50.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await openMenu();
    const stepsItem2 = page.locator('.menu-item', { hasText: 'AI steps' });
    await expect(stepsItem2.locator('.menu-switch')).toHaveText('50');

    // 2º clique → 100; 3º clique → volta pro 25 (ciclo completo).
    await stepsItem2.click();
    await expect(stepsItem2.locator('.menu-switch')).toHaveText('100');
    expect(await page.evaluate(() => localStorage.getItem('agentMaxSteps'))).toBe('100');
    await stepsItem2.click();
    await expect(stepsItem2.locator('.menu-switch')).toHaveText('25');
  } finally {
    await page.evaluate(() => localStorage.removeItem('agentMaxSteps')).catch(() => {});
    await app.close();
  }
});
