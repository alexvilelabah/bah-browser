import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  const app = await electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/electron/dist/electron.exe'),
    args: [path.resolve(__dirname, '../..')],
    env: {
      ...env,
      E2E_MOCK_AI: process.env.E2E_USE_SAVED_AI === '1' ? '' : '1',
      NODE_ENV: 'test',
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

test('opens the browser shell and shows the agent command bar', async () => {
  const { app, page } = await launchApp();
  try {
    await expect(page.getByTestId('agent-command-bar')).toBeVisible();
    await expect(page.getByTestId('agent-command-input')).toBeVisible();
    await expect(page.getByTestId('agent-run')).toBeDisabled();

    await page.getByTestId('agent-command-input').fill('teste smoke');
    await expect(page.getByTestId('agent-run')).toBeEnabled();
  } finally {
    await app.close();
  }
});

test('runs a live agent command when E2E_AGENT_COMMAND is provided', async () => {
  const command = process.env.E2E_AGENT_COMMAND;
  test.skip(!command, 'Set E2E_AGENT_COMMAND to run a live browser-agent task.');

  const { app, page } = await launchApp();
  try {
    const deepSeekKey = process.env.E2E_DEEPSEEK_API_KEY;
    if (deepSeekKey) {
      await page.evaluate((apiKey) => {
        localStorage.setItem('aiSettings', JSON.stringify({
          provider: 'deepseek',
          apiKey,
          baseUrl: '',
        }));
      }, deepSeekKey);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('agent-command-input')).toBeVisible();
    } else if (process.env.E2E_USE_SAVED_AI !== '1') {
      await page.evaluate(() => {
        localStorage.setItem('aiSettings', JSON.stringify({
          provider: 'deepseek',
          apiKey: '',
          baseUrl: '',
        }));
      });
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('agent-command-input')).toBeVisible();
    }

    await page.getByTestId('agent-command-input').fill(command!);
    await page.getByTestId('agent-run').click();

    const resultOrManualHelp = page.locator('.result-report, .result-error, [data-testid="agent-manual-continue"]').first();
    await expect(resultOrManualHelp).toBeVisible({ timeout: 120_000 });

    const needsManualHelp = await page.getByTestId('agent-manual-continue').isVisible().catch(() => false);
    if (needsManualHelp) {
      throw new Error('Agent requested manual help. Reproduce manually, fix the policy/flow if this was unexpected, then rerun.');
    }

    const errorText = await page.locator('.result-error').textContent().catch(() => '');
    expect(errorText || '').toBe('');
  } finally {
    await app.close();
  }
});
