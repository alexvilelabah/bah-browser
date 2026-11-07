import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Ação `upload`: o arquivo vem SÓ do diálogo do SO (aqui trocado por um stub no main) escolhido pela
// pessoa no cartão; o 2º upload reusa o mesmo arquivo pelo cartão. Cobre botão que abre o seletor
// (input escondido → interceptação do seletor) e campo de arquivo visível com <label>.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
// --use-mock-keychain: no macOS o cofre de senhas (safeStorage) abre um pedido do Chaveiro que trava o main
// num perfil novo de teste; o chaveiro falso do Chromium evita o pedido.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAGE = `<!doctype html><title>Apply</title><h1>Job application</h1>
<button id="up" onclick="document.getElementById('hidden').click()">Upload resume</button>
<input type="file" id="hidden" style="display:none" accept=".pdf">
<p><label>Cover letter <input type="file" id="cl"></label></p>
<div id="out">none</div>
<script>
function show(){ var a=document.getElementById('hidden').files, b=document.getElementById('cl').files;
  document.getElementById('out').textContent = 'resume=' + (a[0] ? a[0].name + ':' + a[0].size : '-') + ' letter=' + (b[0] ? b[0].name : '-'); }
document.getElementById('hidden').addEventListener('change', show); document.getElementById('cl').addEventListener('change', show);
</script>`;

test('upload: user picks the file; button-opened picker and labelled field both work', async () => {
  test.setTimeout(120_000);
  const server = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end(PAGE); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-upload-'));
  const resume = path.join(tmp, 'resume.pdf');
  fs.writeFileSync(resume, '%PDF-1.4 test resume');
  const script = [
    { type: 'navigate', url: T },
    { type: 'upload', ref: '__REF:Upload resume__' },
    { type: 'upload', ref: '__REF:Cover letter__' },
    { type: 'done', reason: 'Attached the resume to both fields.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${path.join(tmp, 'profile')}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    // Stub do diálogo nativo: a "pessoa" escolhe resume.pdf. Conta quantas vezes abriu.
    await app.evaluate(({ dialog }, f) => { (globalThis as any).__picks = 0; (dialog as any).showOpenDialog = async () => { (globalThis as any).__picks++; return { canceled: false, filePaths: [f] }; }; }, resume);
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('attach my resume to this job application');
    await page.getByTestId('agent-command-input').press('Enter');
    const until = async (loc: ReturnType<typeof page.getByRole>) => {
      for (let i = 0; i < 60 && !(await loc.isVisible().catch(() => false)); i++) {
        if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
        await sleep(500);
      }
      await loc.click();
    };
    await until(page.getByRole('button', { name: /Choose file/ }));
    await until(page.getByRole('button', { name: /Use resume\.pdf/ }));   // 2º campo: reusa o que a pessoa escolheu
    const out = async () => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w => w.getType() === 'webview').pop()!
      .executeJavaScript(`document.getElementById('out').textContent`));
    let text = '';
    for (let i = 0; i < 30 && !/letter=resume\.pdf/.test(text); i++) { await sleep(500); text = await out(); }
    expect(text).toBe(`resume=resume.pdf:${fs.statSync(resume).size} letter=resume.pdf`);
    expect(await app.evaluate(() => (globalThis as any).__picks)).toBe(1);   // diálogo abriu só uma vez
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('folder access: user allows a folder for the session; the agent reads and attaches the right file', async () => {
  test.setTimeout(180_000);
  const server = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end(PAGE); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-folder-'));
  const jobs = path.join(tmp, 'Jobs');
  fs.mkdirSync(path.join(jobs, 'old'), { recursive: true });
  fs.writeFileSync(path.join(jobs, 'resume-nurse.txt'), 'Registered nurse, ICU, 8 years.');
  fs.writeFileSync(path.join(jobs, 'old', 'resume-engineer.txt'), 'Software engineer: TypeScript, Electron, 10 years.');
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'outside the allowed folder');
  const script = [
    { type: 'navigate', url: T },
    { type: 'list_files' },
    { type: 'read_file', file: 'Jobs/old/resume-engineer.txt' },
    { type: 'read_file', file: 'Jobs/../secret.txt' },
    { type: 'upload', ref: '__REF:Upload resume__', file: 'Jobs/old/resume-engineer.txt' },
    { type: 'done', reason: 'Attached the engineering resume.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${path.join(tmp, 'profile')}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    await app.evaluate(({ dialog }, dir) => { (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, jobs);
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('attach the resume that fits a software job');
    await page.getByTestId('agent-command-input').press('Enter');
    const allow = page.getByRole('button', { name: /Choose folder/ });
    for (let i = 0; i < 60 && !(await allow.isVisible().catch(() => false)); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      await sleep(500);
    }
    await allow.click();
    const out = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w => w.getType() === 'webview').pop()!
      .executeJavaScript(`document.getElementById('out').textContent`));
    let text = '';
    for (let i = 0; i < 120 && !/resume-engineer/.test(text); i++) { await sleep(500); text = await out(); }
    expect(text).toMatch(/^resume=resume-engineer\.txt:\d+ letter=-$/);
    const prompts: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
    const last = prompts[prompts.length - 1] || '';
    expect(last).toContain('Jobs/resume-nurse.txt');
    expect(last).toContain('Jobs/old/resume-engineer.txt');
    expect(last).toContain('Software engineer: TypeScript');
    expect(last).not.toContain('outside the allowed folder');
    expect(last).toMatch(/not a file in a folder the user allowed/);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
