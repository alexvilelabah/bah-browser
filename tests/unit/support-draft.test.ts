// Chamado de suporte: fatos → rascunho (sem inventar), modelo fixo, preenchimento por código e o fim "desistiu".
import { test } from 'node:test';
import assert from 'node:assert';
import {
  supportFacts, templateDraft, finalDraft, draftPrompt, parseDraftReply, inventedTokens, planSupportFill,
  stripSupportCommand, productFrom, serialFrom, findingFrom, supportFinishProblem, supportThreadContext,
} from '../../src/renderer/support-draft.ts';
import { commandIsSupport, offSupportSite } from '../../src/renderer/support-tickets.ts';
import type { FieldInfo } from '../../src/shared/form-fill.ts';

const DELL = 'Create a support request with Dell technical support: my XPS 13 9310 fan is loud even at idle since the BIOS update last week. Service tag 7XK2PQ3. Contact me by email.';

test('facts come from the request and the follow-ups, without the command or directives', () => {
  const f = supportFacts(`${DELL}\nFOLLOW-UP: Email is fine. Service tag 7XK2PQ3. Please continue and fill the request.`, ['I already tried resetting the BIOS to defaults.']);
  assert.strictEqual(f.vendor, 'Dell');
  assert.strictEqual(f.product, 'XPS 13 9310');
  assert.strictEqual(f.serial, '7XK2PQ3');
  assert.strictEqual(f.contactMethod, 'email');
  assert.deepStrictEqual(f.problem, ['My XPS 13 9310 fan is loud even at idle since the BIOS update last week.']);
  assert.deepStrictEqual(f.followUps, ['I already tried resetting the BIOS to defaults.']);   // "continue", "email is fine" e o serial não entram
  assert.strictEqual(f.forum, false);
});

test('the command part is stripped, the problem stays in the user\'s words', () => {
  assert.strictEqual(stripSupportCommand("open a support ticket with Apple for my MacBook's battery"), "my MacBook's battery");
  assert.strictEqual(stripSupportCommand('ask Dell support about my XPS fan noise'), 'my XPS fan noise');
  assert.strictEqual(stripSupportCommand('Ask the Dell Community (practice copy at http://x/dell) why my XPS 13 9310 fan is loud'), 'why my XPS 13 9310 fan is loud');
  assert.strictEqual(productFrom('my MacBook Air M2 battery drains'), 'MacBook Air M2');
  assert.strictEqual(productFrom('my laptop battery'), undefined);
  assert.strictEqual(serialFrom('the serial number is C02XK1ABJG5J'), 'C02XK1ABJG5J');
  assert.strictEqual(serialFrom('what is the serial number?'), undefined);
});

test('template draft: sections from the facts only', () => {
  const f = supportFacts('open a support ticket with Acme about my laptop battery: it drains from 100% to 20% in about two hours.',
    ['Serial C02XK1ABJG5J. It started after the macOS update last week; I already tried an SMC reset.']);
  const d = templateDraft(f);
  assert.strictEqual(d.source, 'template');
  assert.strictEqual(d.description, [
    'My laptop battery: it drains from 100% to 20% in about two hours.',
    'When it started: It started after the macOS update last week.',
    'What I already tried: An SMC reset.',
    'Serial number: C02XK1ABJG5J',
  ].join('\n'));
  assert.match(d.subject, /^Laptop battery/);
  // Nada inventado: todo número do texto está nos fatos.
  assert.deepStrictEqual(inventedTokens(d, f), []);
  const dell = templateDraft(supportFacts(DELL));
  assert.strictEqual(dell.subject, 'XPS 13 9310: Fan is loud even at idle');
  assert.match(dell.description, /Product: Dell XPS 13 9310\nService tag: 7XK2PQ3$/);
});

test('model draft is used only when it adds nothing; otherwise the template', () => {
  const f = supportFacts(DELL);
  const good = 'SUBJECT: XPS 13 9310 fan loud at idle\nDESCRIPTION:\nSince the BIOS update last week, the fan on my XPS 13 9310 is loud even when idle.\nService tag: 7XK2PQ3';
  const d = finalDraft(f, good);
  assert.strictEqual(d.source, 'model');
  assert.strictEqual(d.subject, 'XPS 13 9310 fan loud at idle');
  // Ensaio: o modelo inventou o ano do modelo → recusado, vai o modelo fixo.
  const bad = 'SUBJECT: XPS 13 9310 (2021) fan noise\nDESCRIPTION:\nMy 2021 XPS 13 9310 fan is loud since BIOS 1.15.0. Service tag 7XK2PQ3.';
  assert.deepStrictEqual(inventedTokens(parseDraftReply(bad)!, f).sort(), ['15', '2021']);
  assert.strictEqual(finalDraft(f, bad).source, 'template');
  // Chamada falhou / formato errado → modelo fixo.
  assert.strictEqual(finalDraft(f, null).source, 'template');
  assert.strictEqual(finalDraft(f, 'Sure! Here is your ticket.').source, 'template');
  // Modelo esqueceu o serial: o Bah acrescenta (é fato).
  assert.match(finalDraft(f, 'SUBJECT: Fan noise\nDESCRIPTION:\nThe fan on my XPS 13 9310 is loud even at idle since the BIOS update.').description, /Service tag: 7XK2PQ3$/);
  // O pedido ao modelo lista só os fatos e proíbe inventar.
  const p = draftPrompt(f);
  assert.match(p, /ONLY the facts below/);
  assert.match(p, /- Service tag: 7XK2PQ3/);
  assert.doesNotMatch(p, /Contact me by email/);
});

const field = (idx: number, label: string, type: string, extra: Partial<FieldInfo> = {}): FieldInfo => ({ idx, label, type, ...extra });

test('form fields: description, subject, serial, product and profile contact; filled and password fields untouched', () => {
  const fields = [
    field(0, 'Search support', 'text'),
    field(1, 'Subject', 'text'),
    field(2, 'Product', 'select', { options: ['Choose…', 'XPS 13 9310', 'Inspiron 15'] }),
    field(3, 'Service Tag', 'text'),
    field(4, 'First name', 'text', { autocomplete: 'given-name' }),
    field(5, 'Last name', 'text', { filled: true }),   // a pessoa já escreveu
    field(6, 'Email', 'email'),
    field(7, 'Street address', 'text'),               // fora do limite de contato
    field(8, 'Describe your issue', 'textarea'),
    field(9, 'How should we contact you?', 'radio', { options: ['Email', 'Phone'] }),
  ];
  const plan = planSupportFill(fields, { subject: 'Fan noise', description: 'Fan is loud.' }, { product: 'XPS 13 9310', serial: '7XK2PQ3' },
    { firstName: 'Pat', lastName: 'Example', email: 'pat@example.com', address: '1 Main St' });
  assert.deepStrictEqual(plan.map(d => [d.idx, d.what, d.value ?? d.option]), [
    [1, 'subject', 'Fan noise'], [2, 'product', 1], [3, 'serial', '7XK2PQ3'], [4, 'contact', 'Pat'], [6, 'contact', 'pat@example.com'], [8, 'description', 'Fan is loud.'],
  ]);
  // Forum: título + corpo.
  const forum = planSupportFill([field(0, 'Question title', 'text'), field(1, 'Question details', 'textarea')], { subject: 'T', description: 'Body text' }, {});
  assert.deepStrictEqual(forum.map(d => d.what), ['subject', 'description']);
  // Login (senha) → nada. Descrição já escrita pela pessoa → nada. Sem caixa de texto → nada.
  assert.deepStrictEqual(planSupportFill([field(0, 'Email', 'email'), field(1, 'Password', 'password'), field(2, 'Message', 'textarea')], { subject: 'S', description: 'D' }, {}), []);
  assert.deepStrictEqual(planSupportFill([field(0, 'Subject', 'text'), field(1, 'Message', 'textarea', { filled: true })], { subject: 'S', description: 'D' }, {}), []);
  assert.deepStrictEqual(planSupportFill([field(0, 'Subject', 'text')], { subject: 'S', description: 'D' }, {}), []);
  // Serial desconhecido: o campo fica vazio (nunca inventa).
  assert.ok(!planSupportFill([field(0, 'Serial number', 'text'), field(1, 'Message', 'textarea')], { subject: 'S', description: 'D' }, {}).some(d => d.what === 'serial'));
});

test('a similar thread seen on the vendor community is a finding; other pages are not', () => {
  const cmd = 'ask the Apple community why my MacBook Air battery drains';
  assert.match(findingFrom('https://discussions.apple.com/thread/255012345', 'Battery drains fast after update - Apple Community', cmd) || '', /^similar thread "Battery drains fast/);
  assert.strictEqual(findingFrom('https://discussions.apple.com/thread/new', 'Ask a question', cmd), null);
  assert.strictEqual(findingFrom('https://www.reddit.com/r/mac/comments/x/thread/1', 'reddit', cmd), null);
});

test('thread context: the original support request and what the user said after it', () => {
  const entries = [
    { kind: 'task', goal: 'what is the weather' },
    { kind: 'task', goal: 'open a support ticket with Acme about my laptop battery' },
    { kind: 'user', text: 'it started after the update' },
    { kind: 'task', goal: 'Serial C02XK1ABJG5J' },
  ];
  assert.deepStrictEqual(supportThreadContext(entries, commandIsSupport), { root: 'open a support ticket with Acme about my laptop battery', followUps: ['it started after the update', 'Serial C02XK1ABJG5J'] });
  assert.deepStrictEqual(supportThreadContext([{ kind: 'task', goal: 'buy milk' }], commandIsSupport), { root: null, followUps: [] });
});

test('a support task that ends off the vendor site is not a success', () => {
  const cmd = 'open a support ticket with Dell about my XPS 13 fan';
  assert.match(supportFinishProblem(cmd, 'https://www.notebookcheck.net/XPS-13-review.html') || '', /ended on www\.notebookcheck\.net, not on Dell's support site/);
  assert.strictEqual(supportFinishProblem(cmd, 'https://www.dell.com/support/incidents-online/en-us/contactus/dynamic'), null);
  assert.strictEqual(supportFinishProblem('open a support ticket about my printer', 'https://example.org/'), null);
});

test('web search is allowed after a page failed to load; opening a result stays on the vendor domain', () => {
  const cmd = 'open a support ticket with Dell about my XPS 13 fan';
  assert.match(offSupportSite({ type: 'web_search' }, cmd) || '', /stay on Dell's own support site/);
  assert.strictEqual(offSupportSite({ type: 'web_search' }, cmd, { pageFailed: true }), null);
  assert.strictEqual(offSupportSite({ type: 'navigate', url: 'https://www.dell.com/support/incidents-online/en-us/contactus/dynamic' }, cmd, { pageFailed: true }), null);
  assert.match(offSupportSite({ type: 'navigate', url: 'https://www.notebookcheck.net/' }, cmd, { pageFailed: true }) || '', /not Dell's site/);
  assert.match(offSupportSite({ type: 'navigate', url: 'https://www.google.com/search?q=dell' }, cmd, { pageFailed: true }) || '', /not Dell's site/);
});
