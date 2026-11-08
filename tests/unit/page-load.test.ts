// "A página não carregou": Access Denied (Akamai), 404, erro do navegador, em branco, clique sem efeito.
import { test } from 'node:test';
import assert from 'node:assert';
import { pageLoadProblem, pageLoadHint, wantedPageWords } from '../../src/renderer/page-load.ts';

test('Access Denied pages are spotted (Akamai / edgesuite, plain 403)', () => {
  const akamai = pageLoadProblem({ url: 'https://www.dell.com/en-us/lp/contact-us', title: 'Access Denied', elementCount: 0,
    text: 'Access Denied You don\'t have permission to access "http://www.dell.com/en-us/lp/contact-us" on this server. Reference #18.6b2d3e17.1730000000.1a2b3c https://errors.edgesuite.net/18.6b2d3e17.1730000000.1a2b3c' });
  assert.deepStrictEqual(akamai, { kind: 'access_denied', detail: 'Access Denied (errors.edgesuite.net)' });
  assert.strictEqual(pageLoadProblem({ url: 'https://x.com/a', title: '403 Forbidden', text: 'Forbidden', elementCount: 1 })?.kind, 'access_denied');
  // Uma página de conteúdo que só CITA "access denied" não é bloqueio.
  const article = 'How to fix "Access Denied" errors in Windows. '.repeat(60);
  assert.strictEqual(pageLoadProblem({ url: 'https://blog.example/fix', title: 'Fix access errors', text: article, elementCount: 80 }), null);
});

test('not found, browser error, blank page and clicks without effect', () => {
  assert.strictEqual(pageLoadProblem({ url: 'https://support.apple.com/x', title: 'Page Not Found - Apple Support', text: 'The page you are looking for cannot be found. '.repeat(10), elementCount: 120 })?.kind, 'not_found');
  assert.strictEqual(pageLoadProblem({ url: 'chrome-error://chromewebdata/', title: 'www.dell.com', text: "This site can't be reached ERR_CONNECTION_RESET", elementCount: 2 })?.kind, 'error');
  assert.strictEqual(pageLoadProblem({ url: 'https://www.dell.com/x', title: '', text: '', elementCount: 0 })?.kind, 'blank');
  assert.strictEqual(pageLoadProblem({ url: 'https://www.dell.com/support', title: 'Support', text: 'Dell support home '.repeat(30), elementCount: 60, lastAction: 'click_ref', urlChanged: false, noEffectCount: 2 })?.kind, 'no_change');
  // Página normal, ou um clique só sem efeito: nada.
  assert.strictEqual(pageLoadProblem({ url: 'https://www.dell.com/support', title: 'Support | Dell US', text: 'Dell support home '.repeat(30), elementCount: 60, lastAction: 'click_ref', urlChanged: false, noEffectCount: 1 }), null);
});

test('the hint names the page that failed and asks for a web search, then an official-domain result', () => {
  const p = { kind: 'access_denied' as const, detail: 'Access Denied / 403' };
  const h = pageLoadHint(p, { url: 'https://www.dell.com/en-us/lp/contact-us', target: '"Contact Support"', vendor: 'Dell', domains: ['dell.com', 'delltechnologies.com'], product: 'XPS 13' });
  assert.match(h, /^PAGE DID NOT LOAD: https:\/\/www\.dell\.com\/en-us\/lp\/contact-us — Access Denied \/ 403/);
  assert.match(h, /"query": "Dell Contact Support XPS 13"/);
  assert.match(h, /dell\.com \/ delltechnologies\.com \(the official site — never another domain\)/);
  assert.match(h, /never try to get around a block/);
  assert.strictEqual(wantedPageWords('https://www.dell.com/en-us/lp/contact-us'), 'contact us');
  assert.strictEqual(wantedPageWords('https://getsupport.apple.com/solutions'), 'solutions');
});
