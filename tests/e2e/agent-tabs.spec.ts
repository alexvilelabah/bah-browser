import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Abas da tarefa e permissões: a aba que o agente abre é dele (marca "agent tab"), a de partida não pode
// ser fechada por ele, e o histórico só é lido com permissão (aqui a pessoa responde "Always deny").
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('task tabs: agent tab marked, starting tab not closable, history needs permission', async () => {
  test.setTimeout(180_000);
  const server = http.createServer((q, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<title>Page ${q.url}</title><h1>Page ${q.url}</h1>`); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const script = [
    { type: 'new_tab', url: `${T}second` },
    { type: 'close_tab', tab: 0 },
    { type: 'history_search', query: 'laptop' },
    { type: 'done', reason: 'Tabs run done.', success: true },
  ];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-tabs-'));
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'],
    env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('open the second page in a new tab and close the first one');
    await page.getByTestId('agent-command-input').press('Enter');

    // A pergunta de permissão do histórico aparece com as 4 opções; a pessoa escolhe "Always deny".
    const never = page.getByRole('button', { name: '🚫 Always deny' });
    for (let i = 0; i < 240 && !(await never.isVisible().catch(() => false)); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      await sleep(500);
    }
    await expect(page.getByText('🔐 The agent wants to use your browsing history')).toBeVisible();
    await expect(page.getByRole('button', { name: '✅ Allow for this task' })).toBeVisible();
    await expect(page.locator('.tab-title', { hasText: '🤖' })).toHaveCount(1);   // a aba que o agente abriu, enquanto a tarefa roda
    await never.click();

    let all = '';
    for (let i = 0; i < 120 && !/did not allow the agent to read their browsing history/.test(all); i++) {
      all = (await app.evaluate(() => (global as any).__e2ePrompts || [])).join('\n');
      await sleep(500);
    }
    expect(all).toMatch(/\[0\][^\n]*\(starting tab\)/);
    expect(all).toMatch(/\[1\] \(active\) \(agent tab\) "[^"]*" — http:\/\/127\.0\.0\.1:\d+\/second/);
    expect(all).toContain('Only tabs the agent opened in this task can be closed — this one belongs to the user.');
    expect(all).toContain('The user did not allow the agent to read their browsing history.');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agentPerms') || '{}').history)).toBe('deny');
    await expect(page.locator('.tab-title', { hasText: '🤖' })).toHaveCount(0, { timeout: 60_000 });   // a marca some quando a tarefa acaba
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
