import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Troca de modelo no meio de uma tarefa do agente: antes da próxima chamada ao modelo a tarefa pausa e
// pergunta (continuar / recomeçar / parar). Aqui a pessoa escolhe continuar e o histórico registra a troca.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('model switched during a task: the task pauses and asks, continue notes the switch', async () => {
  test.setTimeout(180_000);
  const script = [
    { type: 'wait', ms: 15000 },
    { type: 'done', reason: 'Model run done.', success: true },
  ];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-model-'));
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'],
    env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('open the page and wait for it to finish loading');
    await page.getByTestId('agent-command-input').press('Enter');
    // 1º passo (wait de 15 s) rodando: troca o provedor nas configurações e salva.
    for (let i = 0; i < 120 && (await app.evaluate(() => ((global as any).__e2ePrompts || []).length)) < 1; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      await sleep(250);
    }
    await page.locator('.sidebar-actions button').first().click();   // engrenagem
    await expect(page.locator('.settings-panel')).toBeVisible();
    await page.locator('.mode-opt', { hasText: 'Cloud' }).click().catch(() => {});
    await page.locator('.settings-panel select').nth(1).selectOption('anthropic');
    await page.locator('.settings-panel input[type="password"]').fill('sk-ant-test-fake');
    await page.locator('.save-settings').click();
    await page.locator('.sidebar-actions button').first().click();   // fecha as configurações

    await expect(page.getByText('🔁 Model changed during this task')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: '🔄 Restart the task with it' })).toBeVisible();
    await expect(page.getByRole('button', { name: '⏹ Stop' })).toBeVisible();
    expect(await app.evaluate(() => ((global as any).__e2ePrompts || []).length)).toBe(1);   // pausou antes da 2ª chamada
    await page.getByRole('button', { name: /^▶️ Continue with anthropic/ }).click();

    let all = '';
    for (let i = 0; i < 120 && !/MODEL SWITCH:/.test(all); i++) {
      all = (await app.evaluate(() => (global as any).__e2ePrompts || [])).join('\n');
      await sleep(500);
    }
    expect(all).toMatch(/MODEL SWITCH: from now on the model is anthropic[^\n]* \(was [^\n]+\)\. Continue the task from here\./);
  } finally { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
