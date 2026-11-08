import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Tabela por ATS no preenchimento por código: formulário com os nomes de campo do Lever (urls[…], org)
// e rótulos que as regras genéricas não entendem. Pelos nomes, Bah reconhece o Lever e usa a tabela:
// urls[LinkedIn] → LinkedIn, org → empresa atual, urls[Other] fica vazio (a regra genérica poria o site).
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
// --use-mock-keychain: no macOS o cofre de senhas (safeStorage) abre um pedido do Chaveiro que trava o main
// num perfil novo de teste; o chaveiro falso do Chromium evita o pedido.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('ATS table: Lever-shaped form is recognised by field names and filled from the table', async () => {
  test.setTimeout(180_000);
  const server = http.createServer((_q, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<title>Apply: Support Engineer</title><h1>Support Engineer at Acme</h1><form id="f">
<label>Resume/CV <input type="file" name="resume"></label>
<label>Full name ✱ <input id="nm" type="text" name="name" required></label>
<label>Email ✱ <input id="em" type="email" name="email" required></label>
<label>Where do you work these days? <input id="org" type="text" name="org"></label>
<label>Profile 1 <input id="li" type="text" name="urls[LinkedIn]"></label>
<label>Other website <input id="ot" type="text" name="urls[Other]"></label>
<button type="submit">Submit application</button></form>`);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-ats-'));
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
    expect((await page.evaluate(() => (window as any).electronAPI.applicantSetProfile({
      firstName: 'Pat', lastName: 'Example', email: 'pat@example.com', currentCompany: 'Initech',
      linkedin: 'https://www.linkedin.com/in/pat-example', website: 'https://pat.example',
    }))).ok).toBe(true);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('apply to this job with my resume');
    await page.getByTestId('agent-command-input').press('Enter');
    const tab = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w => w.getType() === 'webview').pop()!
      .executeJavaScript(`JSON.stringify({ nm: nm.value, em: em.value, org: org.value, li: li.value, ot: ot.value })`).catch(() => '{}'));
    let got: any = {};
    for (let i = 0; i < 120 && got.li !== 'https://www.linkedin.com/in/pat-example'; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      await sleep(500);
      got = JSON.parse(await tab());
    }
    expect(got).toEqual({ nm: 'Pat Example', em: 'pat@example.com', org: 'Initech', li: 'https://www.linkedin.com/in/pat-example', ot: '' });
    // Nada que a tabela reconhece vira pergunta.
    await sleep(1000);
    await expect(page.getByRole('button', { name: 'Fill these in' })).toHaveCount(0);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
