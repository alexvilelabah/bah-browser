import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Página que PROÍBE scripts (CSP "default-src 'none'; sandbox", como os arquivos crus do Hugging Face /
// GitHub): o agente ainda tem que LER o conteúdo — o texto chega no prompt e o extract_text devolve.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('agent reads a page that forbids scripts (sandbox CSP)', async () => {
  test.setTimeout(180_000);
  const server = http.createServer((_q, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.end('# Routing model card\nbase_model: Qwen/Qwen2.5-1.5B-Instruct\nlicense: apache-2.0\nThe secret word is PERIWINKLE.\n');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/README.md`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-nojs-'));
  const script = [
    { type: 'navigate', url: T },
    { type: 'extract_text' },
    { type: 'done', reason: 'Read it.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('open the model card and tell me the secret word');
    await page.getByTestId('agent-command-input').press('Enter');
    let ps: string[] = [];
    for (let i = 0; i < 160; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      ps = await app.evaluate(() => (global as any).__e2ePrompts || []);
      if (ps.length >= 3) break;
      await sleep(500);
    }
    expect(ps.length).toBeGreaterThanOrEqual(3);
    // Step 2's prompt: the page text sample (read via the isolated world) is there.
    expect(ps[1]).toContain('PERIWINKLE');
    // Step 3's prompt: extract_text returned the content.
    expect(ps[2]).toMatch(/STEP 2: extract_text[\s\S]*PERIWINKLE/);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
