import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Candidatura: o "Submit" puro do formulário (Workday, iCIMS…) numa tarefa de vaga passa pelo freio.
// "Don't send" → nada enviado e o agente sabe; "Send it" → enviado.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
// --use-mock-keychain: no macOS o cofre de senhas (safeStorage) abre um pedido do Chaveiro que trava o main
// num perfil novo de teste; o chaveiro falso do Chromium evita o pedido.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('job application: bare Submit asks the user; cancel keeps it unsent, approve sends it', async () => {
  test.setTimeout(180_000);
  let sent = 0;
  const server = http.createServer((q, res) => {
    if (q.url === '/sent') { sent++; res.end('ok'); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<title>Apply: Support Engineer</title><h1>Support Engineer at Acme</h1>
<h2>Matches your preferences</h2><ul>
<li><a href="/viewjob?jk=a1">VP of IT Operations</a> Serve Robotics · Remote · $220,000 a year <button aria-label="Save job" aria-pressed="true">★</button></li>
<li><a href="/viewjob?jk=b2">Engineering Manager</a> Adyen · San Francisco <button aria-label="Save job" aria-pressed="false">☆</button></li></ul>
<form onsubmit="event.preventDefault(); fetch('/sent').then(() => document.title = 'SENT')">
<label>Full name <input name="n" value="Pat Example"></label>
<button type="button">Back</button> <button type="submit">Submit</button></form>`);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-job-'));
  const script = [
    { type: 'navigate', url: T },
    { type: 'click_role', role: 'button', name: 'Submit' },
    { type: 'click_role', role: 'button', name: 'Submit' },
    { type: 'done', reason: 'Application sent.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('apply to this job with my resume');
    await page.getByTestId('agent-command-input').press('Enter');
    const answers = ["Don't send", '📨 Send it'];
    let last = '';
    for (let i = 0; i < 240 && !/STEP 3: [^\n]*\nRESULT/.test(last); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      const btn = page.getByRole('button', { name: answers[0] });
      if (answers.length && await btn.last().isVisible().catch(() => false)) {
        await expect(page.getByText(/Ready to send your application/).last()).toBeVisible();
        expect(sent).toBe(0);
        await btn.last().click();
        answers.shift();
      }
      const ps: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
      last = ps[ps.length - 1] || '';
      await sleep(500);
    }
    expect(answers).toEqual([]);
    // The job cards reach the model as the job list, the saved one marked.
    const ps: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
    expect(ps[1]).toContain('JOB LISTINGS ON THIS PAGE (2 found, 1 ★ saved)');
    expect(ps[1]).toMatch(/1\. ★ SAVED · VP of IT Operations — Serve Robotics · Remote · \$220,000 a year[^\n]*→ http:\/\/127\.0\.0\.1:\d+\/viewjob\?jk=a1/);
    expect(ps[1]).toMatch(/2\. Engineering Manager — Adyen/);
    expect(last).toMatch(/STEP 2: click_ref\(@\d+\)\nRESULT: \{"success":false,"reason":"user_cancelled"/);
    for (let i = 0; i < 20 && !sent; i++) await sleep(250);
    expect(sent).toBe(1);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
