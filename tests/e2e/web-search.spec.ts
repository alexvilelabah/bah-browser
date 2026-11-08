import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// web_search do agente: resultados fixos (E2E_SEARCH_RESULTS, nada de buscador de verdade) voltam como
// texto no histórico; o prompt traz a linha SEARCH ENGINE; num site cuidadoso a busca é permitida.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('web_search returns the results as text, also on a careful site', async () => {
  test.setTimeout(180_000);
  const server = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<title>Driver page</title><h1>Driver page</h1>'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const results = [
    { title: 'Acme Drivers — official downloads', snippet: 'Drivers for every Acme printer.', url: `${T}drivers` },
    { title: 'Acme support', snippet: 'Contact Acme.', url: `${T}support` },
  ];
  const script = [
    { type: 'navigate', url: `${T}page` },
    { type: 'web_search', query: 'acme printer drivers' },
    { type: 'done', reason: 'Search run done.', success: true },
  ];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-websearch-'));
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'],
    env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), E2E_SEARCH_RESULTS: JSON.stringify(results), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); localStorage.setItem('carefulSites', JSON.stringify(['127.0.0.1'])); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('open the driver page and search the web for acme printer drivers');
    await page.getByTestId('agent-command-input').press('Enter');
    let all = '';
    for (let i = 0; i < 240 && !/WEB RESULTS for/.test(all); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      all = (await app.evaluate(() => (global as any).__e2ePrompts || [])).join('\n');
      await sleep(500);
    }
    expect(all).toContain('SEARCH ENGINE: to search the web use { "action": "web_search", "query": "..." } — Bah tries Google → Bing → DuckDuckGo → Yahoo → Perplexity in that order');
    expect(all).toContain(`WEB RESULTS for "acme printer drivers" (via E2E) — open the best one with navigate:\n  1. Acme Drivers — official downloads — ${T}drivers`);
    expect(all).not.toMatch(/CAREFUL SITE \(127\.0\.0\.1\): "web_search"/);
    // A tarefa termina (o 1º done pode ser segurado pelo freio "encerrou sem listar o que achou").
    await expect(page.locator('.result-report', { hasText: /Search run done\.|E2E script finished\./ }).first()).toBeVisible({ timeout: 60_000 });
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
