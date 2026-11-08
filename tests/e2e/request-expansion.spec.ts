import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Expansão do pedido pelo roteador local, sem modelo: E2E_FAKE_ROUTER_EXPAND (com E2E_MOCK_AI=1) é a
// saída "do modelo". Aceita → "Understood as: …" no feed e a linha UNDERSTOOD AS embaixo do GOAL;
// ruim (muda a intenção) ou sem roteador → o pedido vai como está.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const COMMAND = 'find the soundtrack of the movie top gun with tom cruise';
const EXPANDED = 'find the soundtrack of the 1986 film Top Gun with Tom Cruise, not Top Gun: Maverick (2022)';

async function run(fakeExpand?: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-expand-'));   // perfil novo: sem models/ → sem roteador de verdade
  const script = Array.from({ length: 4 }, () => ({ type: 'done', reason: 'Expansion run done.', success: true }));
  const { ELECTRON_RUN_AS_NODE: _n, E2E_FAKE_ROUTER_EXPAND: _f, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'],
    env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test',
      ...(fakeExpand !== undefined ? { E2E_FAKE_ROUTER_EXPAND: fakeExpand } : {}) } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill(COMMAND);
    await page.getByTestId('agent-command-input').press('Enter');
    let prompts: string[] = [];
    for (let i = 0; i < 120 && !prompts.length; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      prompts = await app.evaluate(() => (global as any).__e2ePrompts || []);
      await sleep(500);
    }
    const understoodShown = await page.getByText(/Understood as:/).count();
    return { page, first: prompts[0] || '', understoodShown };
  } finally { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
}

test('request expansion: an accepted expansion shows in the feed and reaches the model under GOAL', async () => {
  test.setTimeout(120_000);
  const r = await run(JSON.stringify({ understood: EXPANDED }));
  expect(r.understoodShown).toBeGreaterThan(0);
  expect(r.first).toContain(`GOAL: ${COMMAND}\nUNDERSTOOD AS (`);
  expect(r.first).toContain(EXPANDED);
});

test('request expansion: an expansion that changes the intent is dropped', async () => {
  test.setTimeout(120_000);
  const r = await run(JSON.stringify({ understood: 'find the soundtrack of the 1986 film Top Gun with Tom Cruise and buy it' }));
  expect(r.understoodShown).toBe(0);
  expect(r.first).toContain(`GOAL: ${COMMAND}`);
  expect(r.first).not.toContain('UNDERSTOOD AS (');
});

test('request expansion: without the routing model the request goes as typed', async () => {
  test.setTimeout(120_000);
  const r = await run();
  expect(r.understoodShown).toBe(0);
  expect(r.first).toContain(`GOAL: ${COMMAND}`);
  expect(r.first).not.toContain('UNDERSTOOD AS (');
});
