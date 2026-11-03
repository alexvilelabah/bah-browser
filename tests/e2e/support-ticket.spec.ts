import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Chamado de suporte: parede de login → pausa pra pessoa entrar; o formulário é preenchido POR CÓDIGO com o
// que já se sabe e a pessoa confere num cartão; o "Submit request" passa pelo freio, que mostra o texto.
// "Don't send" → nada sai; "Send it" → enviado. Depois um post de fórum: o "Post" também pergunta.
// Segundo teste: pedido + resposta seguinte viram o texto do chamado; a edição da pessoa na aba aparece no
// cartão de envio e é o que sai. Terceiro: página do fabricante com 403 "Access Denied" → busca na web (resultados
// fixos) → só abre o resultado do domínio oficial. Quarto: fabricante fora da tabela (Canon) → o 1º passo é a busca
// do site de suporte; o anúncio golpista (domínio parecido) no topo é recusado e o resultado canon.com abre.
// Todo chamado começa pela busca do site de suporte (fixa no teste); www.acme.com / www.dell.com / www.canon.com → o
// servidor local (--host-resolver-rules), porque abrir resultado só vale no domínio do fabricante.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function acmeServer() {
  const st = { signedIn: false, tickets: [] as string[], posts: [] as string[] };
  const server = http.createServer((q, res) => {
    const u = new URL(q.url || '/', 'http://x');
    if (q.method === 'POST') {
      let body = ''; q.on('data', d => body += d);
      q.on('end', () => { (u.pathname === '/ticket' ? st.tickets : st.posts).push(body); res.end('ok'); });
      return;
    }
    if (u.pathname === '/__signin') { st.signedIn = true; res.end('ok'); return; }
    if (u.pathname === '/contact' && !st.signedIn) { res.writeHead(302, { Location: '/signin?next=/contact' }); res.end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (u.pathname === '/signin') {
      res.end(`<title>Sign in - Acme Account</title><h1>Sign in to Acme Support</h1>
<form onsubmit="event.preventDefault()"><label>Email <input type="email" name="u"></label>
<label>Password <input type="password" name="p"></label><button>Sign in</button></form><a href="/create">Create account</a>`);
    } else if (u.pathname === '/contact') {
      res.end(`<title>Create a support request - Acme Support</title><h1>Create a support request</h1><a href="/account">Sign out</a>
<form onsubmit="event.preventDefault(); fetch('/ticket', {method:'POST', body: new URLSearchParams(new FormData(this)).toString()}).then(() => document.title = 'Request submitted')">
<label>Your name <input name="name"></label>
<label>Email <input type="email" name="email"></label>
<label>Product <select name="product" aria-label="Product"><option value="">Choose…</option><option selected>MacBook Air (M2, 2022)</option></select></label>
<label>Serial number <input name="serial" aria-label="Serial number" placeholder="Serial number"></label>
<label>Topic <select name="topic" aria-label="Topic"><option>Battery &amp; power</option><option>Display</option></select></label>
<label>Subject <input name="subject"></label>
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
  return { st, server };
}

async function launch(env: Record<string, string>, extraArgs: string[] = []): Promise<{ app: ElectronApplication; page: Page; tmp: string }> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-support-'));
  const { ELECTRON_RUN_AS_NODE: _n, ...base } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain', ...extraArgs], env: { ...base, E2E_MOCK_AI: '1', NODE_ENV: 'test', ...env } as any });
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
  await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
  if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
  return { app, page, tmp };
}

const prompts = async (app: ElectronApplication): Promise<string[]> => app.evaluate(() => (global as any).__e2ePrompts || []);
const REVIEW = /Check the (ticket|post) before I continue/;
const SEND = /Send this on your behalf\?/;
const waitIdle = async (page: Page) => {
  for (let i = 0; i < 60 && !(await page.getByTestId('agent-command-input').isEnabled().catch(() => false)); i++) await sleep(500);
  await sleep(1500);
};

test('support ticket: sign-in wall pauses, the form is filled by code and reviewed, Submit asks with the text; forum Post asks too', async () => {
  test.setTimeout(240_000);
  const { st, server } = acmeServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port1 = (server.address() as AddressInfo).port;
  const T = `http://www.acme.com:${port1}/`;      // o navegador (MAP www.acme.com → 127.0.0.1)
  const L = `http://127.0.0.1:${port1}/`;         // o próprio teste (Node não usa o MAP)
  const desc = 'Battery drains from 100% to 20% in about two hours since the macOS update last week. Tried an SMC reset; no change.';
  const script = [
    { type: 'navigate', url: `${T}contact` },                    // → parede de login (Bah pausa)
    { type: 'navigate', url: `${T}contact` },                    // depois do login: o formulário (o Bah preenche e a pessoa confere)
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
  // Resposta do "modelo" sem o formato pedido → o Bah usa o modelo fixo (as palavras da pessoa).
  const acmeResults = [{ title: 'Acme Support', snippet: 'Get support for Acme products', url: `${T}` }];
  const { app, page, tmp } = await launch({ E2E_MOCK_SCRIPT: JSON.stringify(script), E2E_MOCK_CHAT: 'Sure, here is a ticket.', E2E_SEARCH_RESULTS: JSON.stringify(acmeResults) }, ['--host-resolver-rules=MAP www.acme.com 127.0.0.1']);
  try {
    let sendAnswered = 0, reviewsAnswered = 0;   // cartões antigos continuam no feed: só responde um cartão NOVO
    const run = async (command: string, answers: string[], untilPrompt: number) => {
      await page.getByTestId('agent-command-input').fill(command);
      await page.getByTestId('agent-command-input').press('Enter');
      let paused = false;
      for (let i = 0; i < 300 && (answers.length || (await prompts(app)).length < untilPrompt); i++) {
        if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
        if (await page.getByTestId('agent-manual-continue').isVisible().catch(() => false)) {
          // A pessoa entra no site (simulado no servidor) e clica Continuar.
          expect((await prompts(app)).length).toBe(1);   // nenhum passo de modelo na tela de login
          paused = true;
          await fetch(`${L}__signin`);
          await page.getByTestId('agent-manual-continue').click();
        }
        const reviews = await page.getByText(REVIEW).count();
        if (reviews > reviewsAnswered) {
          reviewsAnswered = reviews;
          await page.locator('.feed-confirm-card').last().getByRole('button', { name: 'Continue' }).click();
        }
        const btn = page.getByRole('button', { name: answers[0] });
        const cards = await page.getByText(SEND).count();
        if (answers.length && cards > sendAnswered && await btn.last().isVisible().catch(() => false)) {
          sendAnswered = cards;
          answers.shift();
          await btn.last().click();
        }
        await sleep(500);
      }
      expect(answers).toEqual([]);
      return paused;
    };

    const answers1 = ["Don't send", '📨 Send it'];
    const paused = await (async () => {
      // Sem fabricante conhecido (MacBook/XPS): com um, o agente só pode navegar no site oficial dele.
      const p = run('open a support ticket with Acme for my laptop battery, serial C02XK1ABJG5J', answers1, 7);
      // O cartão de revisão mostra o que o Bah preencheu (modelo fixo: as palavras da pessoa + o serial).
      for (let i = 0; i < 300 && !(await page.getByText(REVIEW).last().isVisible().catch(() => false)); i++) await sleep(300);
      await expect(page.locator('.feed-confirm-card').filter({ hasText: REVIEW }).last()).toContainText('Serial number: C02XK1ABJG5J');
      await expect(page.locator('.feed-confirm-card').filter({ hasText: REVIEW }).last()).toContainText('My laptop battery');
      // Antes de responder ao envio: o cartão mostra o texto do formulário.
      for (let i = 0; i < 300 && !(await page.getByText(SEND).last().isVisible().catch(() => false)); i++) await sleep(300);
      await expect(page.getByText(/Battery drains from 100% to 20%/).last()).toBeVisible();
      await expect(page.getByText(/Serial number: C02XK1ABJG5J/).last()).toBeVisible();
      expect(st.tickets.length).toBe(0);
      return p;
    })();
    expect(paused).toBe(true);
    for (let i = 0; i < 20 && !st.tickets.length; i++) await sleep(250);
    expect(st.tickets.length).toBe(1);
    expect(decodeURIComponent(st.tickets[0].replace(/\+/g, ' '))).toContain('Battery drains from 100% to 20%');
    let ps = await prompts(app);
    // A skill e o bloco de suporte chegaram ao modelo; o formulário preenchido também; o 1º "Submit request" foi cancelado.
    expect(ps[1]).toContain('### support-ticket');
    expect(ps[1]).toContain('SUPPORT TASK');
    // 1º passo, sem o modelo: a busca do site de suporte (fabricante + produto + "support contact").
    expect(ps[0]).toContain('WEB RESULTS for "Acme laptop support contact"');
    expect(ps[0]).toContain("ACME'S OWN SITE: result 1");
    expect(ps[0]).toContain("FIND THE SITE: open Acme's support result from the web search");
    expect(ps[2]).toContain('FORM FILLED BY BAH');
    expect(ps[5]).toMatch(/click_ref\(@\d+\)\nRESULT: \{"success":false,"reason":"user_cancelled"/);
    await waitIdle(page);

    // Fórum: o Bah preenche título e corpo (a pessoa confere); o "Post" pergunta; "Don't send" → nada publicado.
    await run("post a question in the Acme community about my laptop fan noise", ["Don't send"], 0);
    const cancelled = /GOAL: post a question[\s\S]*click_ref\(@\d+\)\nRESULT: \{"success":false,"reason":"user_cancelled"/;
    for (let i = 0; i < 60 && !(await prompts(app)).some(p => cancelled.test(p)); i++) await sleep(500);
    expect(st.posts.length).toBe(0);
    expect(reviewsAnswered).toBe(2);
    ps = await prompts(app);
    if (process.env.SUPPORT_DUMP) { fs.writeFileSync(process.env.SUPPORT_DUMP, ps.join('\n=====\n')); fs.writeFileSync(process.env.SUPPORT_DUMP + '.feed', await page.locator('body').innerText()); }
    expect(ps.some(p => cancelled.test(p))).toBe(true);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('support ticket: the request and a follow-up fill the form by code; the user\'s edit is what the send card shows and what is sent', async () => {
  test.setTimeout(240_000);
  const { st, server } = acmeServer();
  st.signedIn = true;
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const T = `http://www.acme.com:${port}/`;
  const script = [
    { type: 'done', reason: 'What is the serial number, and when did it start?', success: true },   // 1ª tarefa: pergunta
    { type: 'navigate', url: `${T}contact` },                        // 2ª tarefa (resposta da pessoa): o formulário
    { type: 'click_role', role: 'button', name: 'Submit request' },   // "Don't send"
    { type: 'click_role', role: 'button', name: 'Submit request' },   // "Send it"
    { type: 'done', reason: 'Support request sent.', success: true },
  ];
  // "Modelo" que redige só com os fatos (números todos do pedido) → o Bah usa esse texto e põe o serial.
  const chat = 'SUBJECT: Laptop battery drains in about two hours\nDESCRIPTION:\nMy laptop battery drains from 100% to 20% in about two hours. It started after the macOS update last week. I already tried an SMC reset.';
  const { app, page, tmp } = await launch({ E2E_MOCK_SCRIPT: JSON.stringify(script), E2E_MOCK_CHAT: chat, E2E_SEARCH_RESULTS: JSON.stringify([{ title: 'Acme Support', snippet: 'Acme', url: T }]) }, ['--host-resolver-rules=MAP www.acme.com 127.0.0.1']);
  try {
    await page.evaluate(() => (window as any).electronAPI?.applicantSetProfile?.({ firstName: 'Pat', lastName: 'Example', email: 'pat@example.com', address: '1 Main St' }));
    const send = async (text: string) => { await page.getByTestId('agent-command-input').fill(text); await page.getByTestId('agent-command-input').press('Enter'); };
    const approvePlans = async () => { if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click(); };
    await send('open a support ticket with Acme about my laptop battery: it drains from 100% to 20% in about two hours.');
    for (let i = 0; i < 60 && (await prompts(app)).length < 1; i++) { await approvePlans(); await sleep(500); }
    await waitIdle(page);
    await send('Serial C02XK1ABJG5J. It started after the macOS update last week; I already tried an SMC reset.');
    for (let i = 0; i < 300 && !(await page.getByText(REVIEW).last().isVisible().catch(() => false)); i++) { await approvePlans(); await sleep(300); }
    const review = page.locator('.feed-confirm-card').filter({ hasText: REVIEW }).last();
    await expect(review).toContainText('My laptop battery drains from 100% to 20% in about two hours. It started after the macOS update last week. I already tried an SMC reset.');
    await expect(review).toContainText('Serial number: C02XK1ABJG5J');
    await expect(review).toContainText('written by the AI');
    // Na aba: o formulário preenchido por código (contato do perfil, não o endereço).
    const inTab = (js: string) => app.evaluate(async ({ webContents }, a) => {
      const w = webContents.getAllWebContents().find(x => x.getType() === 'webview' && x.getURL().includes(`:${a.port}/contact`));
      return w ? w.executeJavaScript(a.js) : null;
    }, { port, js });
    const form = await inTab(`(function(){ var f = document.forms[0]; return { name: f.name.value, email: f.email.value, serial: f.serial.value, subject: f.subject.value, desc: f.desc.value }; })()`);
    expect(form).toMatchObject({ name: 'Pat Example', email: 'pat@example.com', serial: 'C02XK1ABJG5J', subject: 'Laptop battery drains in about two hours' });
    expect(form.desc).toContain('It started after the macOS update last week.');
    expect(st.tickets.length).toBe(0);
    // A pessoa muda o texto direto na aba e aperta Continuar.
    await inTab(`(function(){ var t = document.forms[0].desc; t.value = t.value + '\\nThe fan is also loud when charging.'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await review.getByRole('button', { name: 'Continue' }).click();
    // Cartão de envio: mostra o texto editado. "Don't send" → nada sai.
    for (let i = 0; i < 300 && (await page.getByText(SEND).count()) < 1; i++) await sleep(300);
    await expect(page.locator('.feed-confirm-card').filter({ hasText: SEND }).last()).toContainText('The fan is also loud when charging.');
    await page.getByRole('button', { name: "Don't send" }).last().click();
    for (let i = 0; i < 300 && (await page.getByText(SEND).count()) < 2; i++) await sleep(300);
    expect(st.tickets.length).toBe(0);
    await expect(page.locator('.feed-confirm-card').filter({ hasText: SEND }).last()).toContainText('The fan is also loud when charging.');
    await page.getByRole('button', { name: '📨 Send it' }).last().click();
    for (let i = 0; i < 40 && !st.tickets.length; i++) await sleep(250);
    expect(st.tickets.length).toBe(1);
    const sent = Object.fromEntries(new URLSearchParams(st.tickets[0]));
    expect(sent.desc).toContain('The fan is also loud when charging.');
    expect(sent.desc).toContain('I already tried an SMC reset.');
    expect(sent.serial).toBe('C02XK1ABJG5J');
    expect(sent.name).toBe('Pat Example');
    // O modelo viu o formulário como a pessoa deixou e não deve redigitar.
    const ps = await prompts(app);
    expect(ps[2]).toContain('FORM FILLED BY BAH');
    expect(ps[2]).toContain('The fan is also loud when charging.');
    expect(ps[2]).toContain('THIS IS A FOLLOW-UP to the support request');
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('support ticket: a vendor page answering 403 Access Denied → web search → only the official-domain result is opened', async () => {
  test.setTimeout(180_000);
  const hits: string[] = [];
  const server = http.createServer((q, res) => {
    const u = new URL(q.url || '/', 'http://x');
    hits.push(`${q.headers.host}${u.pathname}`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (u.pathname === '/en-us/lp/contact-us') {
      // Como o Akamai responde ao Bah: 403 e a página "Access Denied".
      res.statusCode = 403;
      res.end(`<html><head><title>Access Denied</title></head><body><h1>Access Denied</h1>You don't have permission to access "http&#58;&#47;&#47;www&#46;dell&#46;com&#47;en&#45;us&#47;lp&#47;contact&#45;us" on this server.<p>Reference&#32;&#35;18&#46;6b2d3e17&#46;1730000000&#46;1a2b3c</p><p>https&#58;&#47;&#47;errors&#46;edgesuite&#46;net&#47;18&#46;6b2d3e17</p></body></html>`);
    } else if (u.pathname.startsWith('/support/incidents-online')) {
      res.end('<title>Contact Technical Support | Dell US</title><h1>Contact Technical Support</h1><ol><li>Identify your device</li><li>Describe your issue</li><li>See your support options</li></ol><label>Service Tag <input name="tag"></label><button>Submit</button>');
    } else res.end('<title>Support | Dell US</title><h1>Dell Support</h1>');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const DELL = `http://www.dell.com:${port}`;
  const official = `${DELL}/support/incidents-online/en-us/contactus/dynamic`;
  const script = [
    { type: 'navigate', url: `${DELL}/en-us/lp/contact-us` },                  // → 403 Access Denied
    { type: 'web_search', query: 'Dell contact technical support XPS 13' },     // liberado depois da falha
    { type: 'navigate', url: 'https://www.notebookcheck.net/Dell-XPS-13-9310-review.html' },   // resultado de terceiro → recusado
    { type: 'navigate', url: official },                                        // resultado oficial
    { type: 'done', reason: 'On Dell\'s Contact Technical Support page.', success: true },
  ];
  const results = [
    { title: 'Dell XPS 13 9310 review - Notebookcheck', snippet: 'Review', url: 'https://www.notebookcheck.net/Dell-XPS-13-9310-review.html' },
    { title: 'Contact Technical Support | Dell US', snippet: 'Identify your device, describe your issue', url: official },
  ];
  // www.dell.com → este servidor (sem rede de verdade); os resultados da busca são fixos.
  const { app, page, tmp } = await launch({ E2E_MOCK_SCRIPT: JSON.stringify(script), E2E_SEARCH_RESULTS: JSON.stringify(results) }, ['--host-resolver-rules=MAP www.dell.com 127.0.0.1']);
  try {
    await page.getByTestId('agent-command-input').fill('open a support ticket with Dell about my XPS 13 9310 fan noise, service tag 7XK2PQ3');
    await page.getByTestId('agent-command-input').press('Enter');
    for (let i = 0; i < 240 && (await prompts(app)).length < 5; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      await sleep(500);
    }
    const ps = await prompts(app);
    if (process.env.SUPPORT_DUMP) fs.writeFileSync(process.env.SUPPORT_DUMP + '.403', ps.join('\n=====\n'));
    expect(ps.length).toBe(5);
    // 1º passo: a busca do site de suporte; o resultado dell.com é apontado (o de terceiro não).
    expect(ps[0]).toContain('WEB RESULTS for "Dell XPS 13 9310 support contact"');
    expect(ps[0]).toContain("DELL'S OWN SITE: result 2");
    expect(ps[0]).toContain('OFFICIAL DELL SUPPORT: https://www.dell.com/support/home/en-us — the fallback');
    // Depois do 403: a dica nomeia a página e manda buscar na web, abrindo só o domínio oficial.
    expect(ps[1]).toContain(`PAGE DID NOT LOAD: ${DELL}/en-us/lp/contact-us — Access Denied (errors.edgesuite.net)`);
    expect(ps[1]).toContain('"action": "web_search", "query": "Dell contact us XPS 13 9310"');
    expect(ps[1]).not.toContain('use Google, Wikipedia');
    // A busca não foi recusada e trouxe os resultados.
    expect(ps[2]).toContain('WEB RESULTS for "Dell contact technical support XPS 13"');
    expect(ps[2]).not.toContain('REFUSED');
    // O resultado de terceiro foi recusado; o oficial abriu.
    expect(ps[3]).toContain("REFUSED: www.notebookcheck.net is not Dell's site");
    expect(ps[4]).toContain(`URL: ${official}`);
    expect(hits.filter(h => h.endsWith('/en-us/lp/contact-us')).length).toBe(1);   // não insistiu no endereço bloqueado
    expect(hits.some(h => h.includes('/support/incidents-online/'))).toBe(true);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('support ticket, vendor outside the table: the first step finds the support site; a look-alike "support" ad is refused, the vendor domain opens', async () => {
  test.setTimeout(180_000);
  const hits: string[] = [];
  const server = http.createServer((q, res) => {
    const u = new URL(q.url || '/', 'http://x');
    hits.push(`${q.headers.host}${u.pathname}`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (/support-help/.test(String(q.headers.host))) res.end('<title>Canon Printer Support 24/7</title><h1>Call 1-800-000-0000 now</h1>');
    else if (u.pathname === '/support/contact') res.end('<title>Contact Support | Canon U.S.A.</title><h1>Contact Canon Support</h1><a href="/support/contact/printer">Printers</a>');
    else res.end('<title>Canon</title><h1>Canon</h1>');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const scam = `http://www.canon-printer-support-help.com:${port}/`;
  const real = `http://www.canon.com:${port}/support/contact`;
  // Anúncio golpista primeiro (como no buscador de verdade), o domínio da Canon depois.
  const results = [
    { title: 'Canon Printer Support ☎ 1-800 Call Now — Official Help', snippet: 'Printer not working? Call our certified technicians.', url: scam },
    { title: 'Contact Support | Canon U.S.A.', snippet: 'Get help with your Canon printer', url: real },
  ];
  const script = [
    { type: 'navigate', url: scam },    // o modelo cai no anúncio → recusado
    { type: 'navigate', url: real },    // o resultado no domínio da Canon
    { type: 'done', reason: "On Canon's Contact Support page.", success: true },
  ];
  const { app, page, tmp } = await launch({ E2E_MOCK_SCRIPT: JSON.stringify(script), E2E_SEARCH_RESULTS: JSON.stringify(results) },
    ['--host-resolver-rules=MAP www.canon.com 127.0.0.1, MAP www.canon-printer-support-help.com 127.0.0.1']);
  try {
    await page.getByTestId('agent-command-input').fill('open a support ticket with Canon about my PIXMA printer, it keeps jamming');
    await page.getByTestId('agent-command-input').press('Enter');
    let sawFinding = false;
    for (let i = 0; i < 240 && (await prompts(app)).length < 3; i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      if (!sawFinding) sawFinding = await page.getByText(/Finding Canon's support site/).count().then(n => n > 0).catch(() => false);
      await sleep(250);
    }
    const ps = await prompts(app);
    if (process.env.SUPPORT_DUMP) fs.writeFileSync(process.env.SUPPORT_DUMP + '.canon', ps.join('\n=====\n'));
    expect(ps.length).toBe(3);
    expect(sawFinding).toBe(true);
    // 1º passo sem o modelo: a busca (fabricante + aparelho + "support contact"), e o resultado da Canon apontado.
    expect(ps[0]).toContain('WEB RESULTS for "Canon printer support contact"');
    expect(ps[0]).toContain("CANON'S OWN SITE: result 2 (canon.com (or canon.<country>))");
    expect(ps[0]).toContain('only a result on canon.com (or canon.<country>)');
    // O anúncio parecido foi recusado; o domínio da Canon abriu.
    expect(ps[1]).toContain("REFUSED: www.canon-printer-support-help.com is not Canon's site");
    expect(ps[2]).toContain(`URL: ${real}`);
    expect(hits.some(h => /support-help/.test(h))).toBe(false);
    expect(hits.some(h => h.startsWith('www.canon.com') && h.endsWith('/support/contact'))).toBe(true);
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
