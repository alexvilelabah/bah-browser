import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Sessões do agente: a 1ª tarefa numa aba cria a sessão (chip colorido + nome na barra e no painel);
// a aba que o agente abre entra nela e mostra a MESMA conversa; renomear pelo chip; "Adicionar a…"
// no menu da aba junta outra aba; "Tirar da sessão" separa.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('agent sessions: chip on the tab strip, shared conversation, rename, add and remove tabs', async () => {
  test.setTimeout(180_000);
  const server = http.createServer((q, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(q.url === '/second' ? '<title>Second job</title><h1>Second job</h1>' : '<title>Job board</title><h1>Jobs</h1><a href="/second">Second job</a>');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-sessions-'));
  const script = [
    { type: 'navigate', url: T },
    { type: 'new_tab', url: T + 'second' },
    { type: 'done', reason: 'Opened both jobs.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await expect(page.locator('.session-chip')).toHaveCount(0);   // no assistant use yet → no chip

    await page.getByTestId('agent-command-input').fill('find a job on this board and open the second one');
    await page.getByTestId('agent-command-input').press('Enter');
    for (let i = 0; i < 120; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      if (await page.getByText('Opened both jobs.').first().isVisible().catch(() => false)) break;
      await sleep(500);
    }
    await expect(page.getByText('Opened both jobs.').first()).toBeVisible();

    // One chip "Job hunt" before the session's tabs; both tabs are in it (underlined in its colour).
    await expect(page.locator('.session-chip')).toHaveCount(1);
    await expect(page.locator('.session-chip')).toHaveText('Job hunt');
    await expect(page.locator('.tab.in-session')).toHaveCount(2);
    await expect(page.getByTestId('panel-session-chip')).toContainText('Job hunt');
    await expect(page.getByTestId('panel-session-chip')).toContainText('· 2');

    // Clicking the other tab of the session shows the SAME conversation.
    const tabs = page.locator('.tab.in-session');
    await tabs.nth(1).click(); await sleep(400);
    await expect(page.getByText('find a job on this board and open the second one').first()).toBeVisible();
    await tabs.nth(0).click(); await sleep(400);
    await expect(page.getByText('find a job on this board and open the second one').first()).toBeVisible();

    // Rename from the chip.
    await page.locator('.session-chip').click();
    await page.locator('.session-name-input').fill('Acme search');
    await page.locator('.session-name-input').press('Enter');
    await expect(page.locator('.session-chip')).toHaveText('Acme search');
    await expect(page.getByTestId('panel-session-chip')).toContainText('Acme search');

    // A plain new tab has its own (empty) conversation and no chip…
    await page.locator('.tab-new').click(); await sleep(600);
    await expect(page.locator('.tab.in-session')).toHaveCount(2);
    await expect(page.getByTestId('panel-session-chip')).toHaveCount(0);
    await expect(page.getByText('find a job on this board and open the second one')).toHaveCount(0);
    // …until it is added to the session from its right-click menu.
    await page.locator('.tab.active').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Add to “Acme search”/ }).click();
    await expect(page.locator('.tab.in-session')).toHaveCount(3);
    await expect(page.getByTestId('panel-session-chip')).toContainText('· 3');
    await expect(page.getByText('find a job on this board and open the second one').first()).toBeVisible();

    // Remove it again: back to its own conversation, the session keeps 2 tabs.
    await page.locator('.tab.active').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove from session' }).click();
    await expect(page.locator('.tab.in-session')).toHaveCount(2);
    await expect(page.getByTestId('panel-session-chip')).toHaveCount(0);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
