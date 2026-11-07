import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// "Summarize my open tabs": 3 páginas locais abertas (uma proíbe script — CSP sandbox) → pede a
// permissão das abas, lê as que deixam e mostra um cartão com um link por aba; o link troca de aba.
// A de CSP sandbox aparece como "não deu pra ler" (ler página assim é outro PR: o mundo isolado do Bah).
// A tarefa começa na Alpha: o agente também não observa uma aba que proíbe script.
// O chat de mentira devolve texto puro (não JSON): cada aba mostra o começo do PRÓPRIO texto, o que
// prova que ela foi lida de verdade.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('summarize my open tabs: asks for tab access, lists each tab with a link, summary overall', async () => {
  test.setTimeout(180_000);
  const pages: Record<string, string> = {
    '/alpha': '<title>Alpha apples</title><h1>Alpha</h1><p>Alpha page about red apples from the orchard.</p>',
    '/beta': '<title>Beta boats</title><h1>Beta</h1><p>Beta page about blue sailing boats.</p>',
    '/gamma': '<title>Gamma gears</title><h1>Gamma</h1><p>Gamma page about green bicycle gears.</p>',
  };
  const server = http.createServer((q, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (q.url === '/gamma') res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.end(pages[q.url || ''] ?? '<title>404</title>');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-tabsum-'));
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'],
    env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: '[]', E2E_MOCK_CHAT: 'You are reading about apples, boats and gears.', NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    const go = async (u: string) => { const a = page.locator('.url-input'); await a.click(); await a.fill(u); await a.press('Enter'); await sleep(2000); };
    await go(`${T}/alpha`);
    await page.locator('.tab-new').click(); await sleep(600); await go(`${T}/beta`);
    await page.locator('.tab-new').click(); await sleep(600); await go(`${T}/gamma`);
    await expect(page.locator('.tab.active')).toContainText('Gamma');
    await page.locator('.tab', { hasText: 'Alpha' }).click(); await sleep(800);
    await expect(page.locator('.tab.active')).toContainText('Alpha');

    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('summarize my open tabs');
    await page.getByTestId('agent-command-input').press('Enter');
    let asked = false;
    for (let i = 0; i < 120; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      const allow = page.getByRole('button', { name: '✅ Allow for this task' });
      if (await allow.last().isVisible().catch(() => false)) { asked = true; await allow.last().click(); }
      if (await page.getByTestId('tabs-summary').isVisible().catch(() => false)) break;
      await sleep(500);
    }
    expect(asked).toBe(true);   // Beta e Gamma não são a aba da tarefa → passa pela permissão
    const card = page.getByTestId('tabs-summary');
    await expect(card).toBeVisible();
    const links = card.getByTestId('tabs-summary-link');
    await expect(links).toHaveText(['Alpha apples', 'Beta boats', 'Gamma gears']);
    await expect(card).toContainText('Alpha page about red apples');
    await expect(card).toContainText('Beta page about blue sailing boats');
    await expect(card.locator('.tabs-summary-unreadable')).toContainText('Could not read this page');   // página com CSP sandbox
    await expect(card).toContainText('You are reading about apples, boats and gears.');
    // O agente não chamou o modelo de ações: o resumo é feito pelo executor.
    const ps: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
    expect(ps.length).toBe(0);

    await links.nth(1).click(); await sleep(500);
    await expect(page.locator('.tab.active')).toContainText('Beta');
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
