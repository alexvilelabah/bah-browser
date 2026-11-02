import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Site nomeado da lista curada ("browse to linkedin…") → o 1º passo recebe o endereço oficial e a
// ordem de navegar direto (sem web_search do nome). Nome desconhecido não ganha dica nenhuma.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('named site: first step gets the official address and the navigate-directly rule; unknown names do not', async () => {
  test.setTimeout(150_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-named-'));
  // Outras chamadas ao modelo (nome da sessão etc.) também consomem o roteiro: todas terminam.
  const script = Array.from({ length: 8 }, () => ({ type: 'done', reason: 'Site run done.', success: true }));
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();

    // Devolve o 1º prompt do agente pra esse pedido (o que tem "GOAL: <cmd>").
    const run = async (cmd: string): Promise<string> => {
      await page.getByTestId('agent-command-input').fill(cmd);
      await page.getByTestId('agent-command-input').press('Enter');
      for (let i = 0; i < 120; i++) {
        if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
        const ps: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
        const hit = ps.find(p => p.includes(`GOAL: ${cmd}`));
        if (hit) { await sleep(1500); return hit; }
        await sleep(500);
      }
      throw new Error(`no agent prompt for "${cmd}"`);
    };

    const first = await run('browse to linkedin, find a job as a nurse in Seattle');
    const ps = [first];
    expect(ps[0]).toContain('NAMED SITE: the user named LinkedIn; its official address is https://www.linkedin.com/');
    expect(ps[0]).toContain('do NOT web_search its name');
    expect(ps[0]).toMatch(/OFFICIAL SITES[^\n]*never web_search its name\):\n[^\n]*linkedin: https:\/\/www\.linkedin\.com\//);
    expect(ps[0]).toContain('wholefoods: https://www.wholefoodsmarket.com/');

    const unknown = await run('browse to zorblax, find a job as a nurse in Seattle');
    expect(unknown).not.toContain('NAMED SITE');
    expect(unknown).not.toMatch(/zorblax\.(com|net|org)/);
    expect(unknown).toContain('OFFICIAL SITES');   // a lista continua lá; só não há site nomeado
  } finally { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
