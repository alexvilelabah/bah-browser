import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Skills de navegação: as incluídas (skills/) e as do usuário (<userData>/skills) entram no prompt
// conforme o estado da página, a tarefa e o site; e a oferta "Salvar como skill" depois de uma
// tarefa que deu certo. IA de mentira (E2E_MOCK_SCRIPT) numa página local.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><title>Driver downloads</title>
<h1>Driver downloads</h1>
<label for="os">Operating system</label>
<select id="os"><option>Windows 11</option><option>macOS 26.x</option><option>Linux</option></select>
<button>Windows</button> <button>macOS</button>
<p><label><input type="checkbox" id="eula"> I accept the license agreement</label></p>
<button>Download</button>`;

async function launch(script: unknown[]) {
  const server = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end(PAGE); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-skills-'));
  const steps = script.map((a: any) => (a.url ? { ...a, url: T + a.url } : a));
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(steps), NODE_ENV: 'test' } });
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
  await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  const close = async () => { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); };
  return { app, page, userData, close };
}

async function run(app: ElectronApplication, page: Page, command: string, until: RegExp): Promise<string[]> {
  if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
  await page.getByTestId('agent-command-input').fill(command);
  await page.getByTestId('agent-command-input').press('Enter');
  let all: string[] = [];
  for (let i = 0; i < 240 && !all.some(p => until.test(p)); i++) {
    if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
    all = await app.evaluate(() => (global as any).__e2ePrompts || []);
    await sleep(500);
  }
  return all;
}
// O bloco de skills do prompt feito na página de drivers (o 1º passo ainda é a aba inicial).
const skillsOnDriverPage = (prompts: string[]) => {
  const p = prompts.find(x => /SKILLS FOR THIS PAGE/.test(x) && /TITLE: Driver downloads/.test(x)) || '';
  return p.slice(p.indexOf('SKILLS FOR THIS PAGE'), p.indexOf('TITLE: Driver downloads'));
};

test('skills: page state + task pick bundled skills; a user skill for this site ranks first', async () => {
  test.setTimeout(180_000);
  const { app, page, userData, close } = await launch([
    { type: 'navigate', url: 'drivers' },
    { type: 'wait', ms: 300 },
    { type: 'done', reason: 'Looked at the driver page.', success: true },
  ]);
  try {
    // Skill do usuário (como o "Salvar" grava): vale a partir da próxima tarefa.
    const dir = path.join(userData, 'skills', 'local-driver-site');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: local-driver-site\ndescription: Test site recipe.\nsites: [127.0.0.1]\ntasks: [download]\n---\nUSER SKILL BODY: pick the package, then Download.\n');
    const block = skillsOnDriverPage(await run(app, page, 'download the printer driver for my computer', /SKILLS FOR THIS PAGE[\s\S]*TITLE: Driver downloads/));
    expect(block).toMatch(/^SKILLS FOR THIS PAGE[^\n]*\nTODAY: \d{4}-\d{2}-\d{2} /);
    // Site + tarefa (usuário) > estado + tarefa (eula-accept) > só tarefa (software-download, a de maior
    // prioridade entre as de download; media-collection só entra em pedido de coleção); no máximo 3.
    const names = [...block.matchAll(/^### ([a-z0-9-]+)$/gm)].map(m => m[1]);
    expect(names).toEqual(['local-driver-site', 'eula-accept', 'software-download']);
    expect(block).toContain('USER SKILL BODY');
    await expect(page.getByText(/🧩 Skills: local-driver-site, eula-accept, software-download/).first()).toBeVisible({ timeout: 30_000 });
  } finally { await close(); }
});

test('skills: without a download task, the page states alone pick os-selector', async () => {
  test.setTimeout(180_000);
  const { app, page, close } = await launch([
    { type: 'navigate', url: 'drivers' },
    { type: 'wait', ms: 300 },
    { type: 'done', reason: 'Looked at the driver page.', success: true },
  ]);
  try {
    const block = skillsOnDriverPage(await run(app, page, 'open the driver page and pick macOS', /SKILLS FOR THIS PAGE[\s\S]*TITLE: Driver downloads/));
    expect(block).toMatch(/^### os-selector$/m);
    expect(block).not.toMatch(/^### eula-accept$/m);   // eula-accept também exige a tarefa download
  } finally { await close(); }
});

test('skills: after a successful task of 3+ steps Bah offers "Save as skill"; Not now ends it', async () => {
  test.setTimeout(180_000);
  const { app, page, close } = await launch([
    { type: 'navigate', url: 'drivers' },
    { type: 'wait', ms: 200 },
    { type: 'wait', ms: 200 },
    { type: 'done', reason: 'The driver page lists Windows 11, macOS 26.x and Linux.', success: true },
  ]);
  try {
    await run(app, page, 'open the driver page and tell me which systems it lists', /STEP 3:/);
    await expect(page.getByText('💾 Save as skill?').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByRole('button', { name: '✍️ Draft skill' })).toHaveCount(0);
    await expect(page.getByText('✍️ Drafting a skill from this task…')).toHaveCount(0);
  } finally { await close(); }
});
