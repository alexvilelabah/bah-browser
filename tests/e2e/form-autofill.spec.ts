import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Candidatura preenchida POR CÓDIGO: perfil salvo → campos; autoidentificação → recusar; o que sobra
// vira UM cartão de perguntas, e a resposta é preenchida e fica salva (cifrada) pra próxima vez.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
// --use-mock-keychain: no macOS o cofre de senhas (safeStorage) abre um pedido do Chaveiro que trava o main
// num perfil novo de teste; o chaveiro falso do Chromium evita o pedido.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('application form: profile fills by code, voluntary is declined, one questions card, answer saved', async () => {
  test.setTimeout(180_000);
  const server = http.createServer((_q, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<title>Apply: Support Engineer</title><h1>Support Engineer at Acme</h1><form id="f">
<label>First Name <input id="fn" name="first_name" required></label>
<label>Last Name <input id="ln" name="last_name" required></label>
<label>Email <input id="em" type="email" required></label>
<label>Resume <input type="file" id="cv"></label>
<fieldset><legend>Have you read the job description?</legend>
<label><input type="radio" name="read" value="y" required> I read this</label><label><input type="radio" name="read" value="n"> I did not read this</label></fieldset>
<fieldset><legend>Gender</legend>
<label><input type="radio" name="g" value="m"> Male</label><label><input type="radio" name="g" value="f"> Female</label><label><input type="radio" name="g" value="d"> Decline to self-identify</label></fieldset>
<button type="submit">Submit application</button></form>`);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-autofill-'));
  const script = [
    { type: 'navigate', url: T },
    { type: 'wait', ms: 500 },
    { type: 'done', reason: 'Form filled; waiting for the user to submit.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    expect((await page.evaluate(() => (window as any).electronAPI.applicantSetProfile({ firstName: 'Pat', lastName: 'Example', email: 'pat@example.com', voluntary: 'decline' }))).ok).toBe(true);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('apply to this job with my resume');
    await page.getByTestId('agent-command-input').press('Enter');
    const fillBtn = page.getByRole('button', { name: 'Fill these in' });
    for (let i = 0; i < 80 && !(await fillBtn.isVisible().catch(() => false)); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      await sleep(500);
    }
    const card = page.locator('.feed-confirm-card').last();
    await expect(card).toContainText('Have you read the job description?');
    await expect(card).toContainText('I filled 4 fields on 127.0.0.1 from your profile: First Name, Last Name, Email, Gender');
    await expect(card.locator('select, textarea')).toHaveCount(1);   // only the question the profile cannot answer
    await card.locator('select').selectOption({ label: 'I read this' });
    await fillBtn.click();
    const tab = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w => w.getType() === 'webview').pop()!
      .executeJavaScript(`JSON.stringify({ fn: fn.value, ln: ln.value, em: em.value, read: (document.querySelector('[name=read]:checked')||{}).value || '', g: (document.querySelector('[name=g]:checked')||{}).value || '' })`));
    let got: any = {};
    for (let i = 0; i < 40 && got.read !== 'y'; i++) { await sleep(250); got = JSON.parse(await tab()); }
    expect(got).toEqual({ fn: 'Pat', ln: 'Example', em: 'pat@example.com', read: 'y', g: 'd' });
    const stored = await page.evaluate(() => (window as any).electronAPI.applicantGet());
    expect(stored.answers['have you read the job description']).toBe('I read this');
    expect(fs.readFileSync(path.join(tmp, 'applicant.enc')).toString('utf8')).not.toContain('pat@example.com');
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
