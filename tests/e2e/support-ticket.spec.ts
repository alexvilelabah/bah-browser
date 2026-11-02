import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Chamado de suporte: parede de login → pausa pra pessoa entrar; depois o formulário é preenchido e o
// "Submit request" passa pelo freio, que mostra o texto. "Don't send" → nada sai; "Send it" → enviado.
// Depois um post de fórum: o "Post" também pergunta, e "Don't send" deixa sem publicar.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('support ticket: sign-in wall pauses, the form is filled, Submit asks with the text; forum Post asks too', async () => {
  test.setTimeout(240_000);
  let signedIn = false;
  const tickets: string[] = [], posts: string[] = [];
  const server = http.createServer((q, res) => {
    const u = new URL(q.url || '/', 'http://x');
    if (q.method === 'POST') {
      let body = ''; q.on('data', d => body += d);
      q.on('end', () => { (u.pathname === '/ticket' ? tickets : posts).push(body); res.end('ok'); });
      return;
    }
    if (u.pathname === '/__signin') { signedIn = true; res.end('ok'); return; }
    if (u.pathname === '/contact' && !signedIn) { res.writeHead(302, { Location: '/signin?next=/contact' }); res.end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (u.pathname === '/signin') {
      res.end(`<title>Sign in - Acme Account</title><h1>Sign in to Acme Support</h1>
<form onsubmit="event.preventDefault()"><label>Email <input type="email" name="u"></label>
<label>Password <input type="password" name="p"></label><button>Sign in</button></form><a href="/create">Create account</a>`);
    } else if (u.pathname === '/contact') {
      res.end(`<title>Create a support request - Acme Support</title><h1>Create a support request</h1><a href="/account">Sign out</a>
<form onsubmit="event.preventDefault(); fetch('/ticket', {method:'POST', body: new URLSearchParams(new FormData(this)).toString()}).then(() => document.title = 'Request submitted')">
<label>Product <select name="product" aria-label="Product"><option value="">Choose…</option><option selected>MacBook Air (M2, 2022)</option></select></label>
<label>Serial number <input name="serial" aria-label="Serial number" placeholder="Serial number"></label>
<label>Topic <select name="topic" aria-label="Topic"><option>Battery &amp; power</option><option>Display</option></select></label>
<label>Describe the issue <textarea name="desc" aria-label="Describe the issue" placeholder="Describe the issue"></textarea></label>
<fieldset><legend>How should we contact you?</legend><label><input type="radio" name="method" value="email" checked> Email</label><label><input type="radio" name="method" value="phone"> Phone call</label></fieldset>
<button type="submit">Submit request</button></form>`);
    } else if (u.pathname === '/community/ask') {
      res.end(`<title>Ask a question - Acme Community</title><h1>Ask the community</h1><a href="/account">Sign out</a>
<form onsubmit="event.preventDefault(); fetch('/post', {method:'POST', body: new URLSearchParams(new FormData(this)).toString()})">
<input name="title" aria-label="Question title" placeholder="Question title">
<textarea name="body" aria-label="Question details" placeholder="Question details"></textarea>
<button type="submit">Post</button></form>`);
    } else {
      res.end('<title>Acme Support</title><h1>Acme Support</h1><a href="/contact">Get Support</a>');
    }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-support-'));
  const desc = 'Battery drains from 100% to 20% in about two hours since the macOS update last week. Tried an SMC reset; no change.';
  const script = [
    { type: 'navigate', url: `${T}contact` },                    // → parede de login (Bah pausa)
    { type: 'navigate', url: `${T}contact` },                    // depois do login: o formulário
    { type: 'fill_ref', ref: '__REF:serial number__', value: 'C02XK1ABJG5J' },
    { type: 'fill_ref', ref: '__REF:describe the issue__', value: desc },
    { type: 'click_role', role: 'button', name: 'Submit request' },   // "Don't send"
    { type: 'click_role', role: 'button', name: 'Submit request' },   // "Send it"
    { type: 'done', reason: 'Support request sent.', success: true },
    // segunda tarefa: post no fórum
    { type: 'navigate', url: `${T}community/ask` },
    { type: 'fill_ref', ref: '__REF:question title__', value: 'XPS 13 fan loud at idle' },
    { type: 'fill_ref', ref: '__REF:question details__', value: 'Fan spins up at idle since the last BIOS update.' },
    { type: 'click_role', role: 'button', name: 'Post' },             // "Don't send"
    { type: 'done', reason: 'Draft left unposted.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    const prompts = async (): Promise<string[]> => app.evaluate(() => (global as any).__e2ePrompts || []);
    let cardsAnswered = 0;   // cartões antigos continuam no feed: só responde um cartão NOVO
    const run = async (command: string, answers: string[], untilPrompt: number) => {
      await page.getByTestId('agent-command-input').fill(command);
      await page.getByTestId('agent-command-input').press('Enter');
      let paused = false;
      for (let i = 0; i < 300 && (answers.length || (await prompts()).length < untilPrompt); i++) {
        if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
        if (await page.getByTestId('agent-manual-continue').isVisible().catch(() => false)) {
          // A pessoa entra no site (simulado no servidor) e clica Continuar.
          expect((await prompts()).length).toBe(1);   // nenhum passo de modelo na tela de login
          paused = true;
          await fetch(`${T}__signin`);
          await page.getByTestId('agent-manual-continue').click();
        }
        const btn = page.getByRole('button', { name: answers[0] });
        const cards = await page.getByText(/Send this on your behalf\?/).count();
        if (answers.length && cards > cardsAnswered && await btn.last().isVisible().catch(() => false)) {
          cardsAnswered = cards;
          answers.shift();
          await btn.last().click();
        }
        await sleep(500);
      }
      expect(answers).toEqual([]);
      return paused;
    };

    const answers1 = ["Don't send", '📨 Send it'];
    // Antes de responder: o cartão mostra o texto do formulário.
    const paused = await (async () => {
      const p = run('open a support ticket with Acme for my MacBook battery, serial C02XK1ABJG5J', answers1, 7);
      for (let i = 0; i < 300 && !(await page.getByText(/Send this on your behalf\?/).last().isVisible().catch(() => false)); i++) await sleep(300);
      await expect(page.getByText(/Battery drains from 100% to 20%/).last()).toBeVisible();
      await expect(page.getByText(/Serial number: C02XK1ABJG5J/).last()).toBeVisible();
      expect(tickets.length).toBe(0);
      return p;
    })();
    expect(paused).toBe(true);
    for (let i = 0; i < 20 && !tickets.length; i++) await sleep(250);
    expect(tickets.length).toBe(1);
    expect(decodeURIComponent(tickets[0].replace(/\+/g, ' '))).toContain('Battery drains from 100% to 20%');
    let ps = await prompts();
    // A skill e o bloco de suporte chegaram ao modelo; o primeiro "Submit request" foi cancelado.
    expect(ps[1]).toContain('### support-ticket');
    expect(ps[1]).toContain('SUPPORT TASK');
    expect(ps[5]).toMatch(/click_ref\(@\d+\)\nRESULT: \{"success":false,"reason":"user_cancelled"/);
    for (let i = 0; i < 60 && !(await page.getByTestId('agent-command-input').isEnabled().catch(() => false)); i++) await sleep(500);
    await sleep(1500);

    // Fórum: o "Post" pergunta; "Don't send" → nada publicado.
    await run("post a question in the Acme community about my XPS fan noise", ["Don't send"], 0);
    const cancelled = /GOAL: post a question[\s\S]*click_ref\(@\d+\)\nRESULT: \{"success":false,"reason":"user_cancelled"/;
    for (let i = 0; i < 60 && !(await prompts()).some(p => cancelled.test(p)); i++) await sleep(500);
    expect(posts.length).toBe(0);
    ps = await prompts();
    if (process.env.SUPPORT_DUMP) { fs.writeFileSync(process.env.SUPPORT_DUMP, ps.join('\n=====\n')); fs.writeFileSync(process.env.SUPPORT_DUMP + '.feed', await page.locator('body').innerText()); }
    expect(ps.some(p => cancelled.test(p))).toBe(true);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
