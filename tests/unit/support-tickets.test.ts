// Chamado de suporte / post em fórum: detecção do pedido, site oficial, freio do envio e o texto do cartão.
import { test } from 'node:test';
import assert from 'node:assert';
import { commandIsSupport, commandIsForum, supportSiteFor, supportPromptBlock, formatSupportDraft, supportRequestText, offSupportSite } from '../../src/renderer/support-tickets.ts';
import { classifyRisk, riskForAction } from '../../src/renderer/risk.ts';
import { commandLikelyNeedsAccount, detectManualHelpNeed } from '../../src/renderer/agent-login-policy.ts';

test('support and forum requests are detected', () => {
  for (const c of [
    "open a support ticket with Apple for my MacBook's battery",
    'ask Dell support about my XPS fan noise',
    'contact Apple support about my iPhone screen',
    'file a case with Lenovo about the hinge',
    'create a support request for my HP printer',
    'post a question in the Apple Support Community about Wi-Fi drops',
    'ask on the Dell community forum why my fan is loud',
    'abrir um chamado com a Dell sobre o ventilador',
    'contactar soporte técnico de HP',
  ]) assert.ok(commandIsSupport(c), c);
  assert.ok(commandIsForum('post a question in the Apple Support Community'));
  assert.ok(!commandIsForum("open a support ticket with Apple for my MacBook's battery"));
});

test('ordinary tasks are not support tasks', () => {
  for (const c of [
    'apply to this job with my resume',
    'find customer support jobs in Austin',
    'buy a MacBook battery replacement',
    'download the Dell XPS 13 BIOS update',
    'what is the weather in Lisbon',
    'search the community calendar for events',
    'does the iPhone 16 support wifi 7',
  ]) assert.ok(!commandIsSupport(c), c);
});

test('the official support site comes from the vendor named first', () => {
  assert.strictEqual(supportSiteFor('open a ticket with Apple for my MacBook')?.support, 'https://support.apple.com/');
  assert.strictEqual(supportSiteFor('ask Dell support about my XPS fan after the Windows update')?.vendor, 'Dell');
  assert.strictEqual(supportSiteFor('my XPS fan is loud')?.vendor, 'Dell');
  assert.strictEqual(supportSiteFor('help with my printer'), null);
  assert.strictEqual(supportSiteFor('help me with this'), null);   // "help" não é "hp"
  const b = supportPromptBlock('post in the Apple Support Community about my AirPods', {});
  assert.match(b, /OFFICIAL APPLE COMMUNITY: https:\/\/discussions\.apple\.com\//);
});

test('only contact fields from the profile reach the prompt; nothing invented', () => {
  const b = supportPromptBlock('ask Dell support about my fan', { firstName: 'Pat', lastName: 'Example', email: 'pat@example.com', phone: '555-0100', salaryExpectation: '1' } as any);
  assert.match(b, /name Pat Example; email pat@example.com; phone 555-0100/);
  assert.doesNotMatch(b, /salary/i);
  assert.match(supportPromptBlock('ask Dell support about my fan', null), /never invent/);
});

test('sending a ticket or a post asks first in a support task', () => {
  const support = { support: true };
  for (const label of ['Submit', 'Send', 'Post', 'Post reply', 'Submit ticket', 'Submit request', 'Create case', 'Schedule a call', 'Request a call', 'Request a callback', 'Start chat', 'Enviar', 'Publicar']) {
    assert.strictEqual(classifyRisk('click_ref', label, undefined, undefined, support)?.kind, 'message', label);
  }
  // Fortes valem mesmo sem a tarefa detectada.
  for (const label of ['Submit ticket', 'Submit request', 'Create a case', 'Post your question', 'Request a call back', 'Schedule a call']) {
    assert.strictEqual(classifyRisk('click_ref', label)?.kind, 'message', label);
  }
  assert.strictEqual(riskForAction({ type: 'click_text', text: 'Post' }, undefined, undefined, support)?.kind, 'message');
});

test('ordinary support steps do not ask', () => {
  const support = { support: true };
  // Botão da busca do cabeçalho (Apple: "Submit search") não é o envio do chamado.
  assert.strictEqual(classifyRisk('click_ref', 'Submit Search', undefined, 'Submit search', support), null);
  assert.strictEqual(classifyRisk('click_ref', 'Submit', undefined, 'Submit search', support), null);
  for (const label of ['Get Support', 'Continue', 'Next', 'Ask a question', 'Search the community', 'Reply', 'Postal code', 'Choose a product', 'Contact us', 'Battery', 'Sign in']) {
    assert.strictEqual(classifyRisk('click_ref', label, undefined, undefined, support), null, label);
  }
  // Long text that starts with "send" is not the form's button.
  assert.strictEqual(classifyRisk('click_ref', 'Send us feedback about this article and help improve our documentation', undefined, undefined, support), null);
  assert.strictEqual(classifyRisk('fill_ref', 'Describe your issue', undefined, undefined, support), null);
  assert.strictEqual(classifyRisk('click_ref', 'Submit'), null);   // fora de tarefa de suporte/vaga
});

test('Enter on a ticket form asks; Enter in the support search does not', () => {
  const support = { support: true };
  assert.strictEqual(riskForAction({ type: 'press', key: 'Enter' }, undefined, 'https://example.com/support/create-case?p=1', support)?.kind, 'message');
  assert.strictEqual(riskForAction({ type: 'press', key: 'Enter' }, undefined, 'https://discussions.apple.com/ask', support)?.kind, 'message');
  assert.strictEqual(riskForAction({ type: 'press', key: 'Enter' }, undefined, 'https://support.apple.com/en-us/search?q=battery', support), null);
  assert.strictEqual(riskForAction({ type: 'press', key: 'Enter' }, undefined, 'https://discussions.apple.com/ask'), null);
});

test('a vendor sign-in page in a support task pauses for the user at once', () => {
  const cmd = 'Create a support request with Dell technical support using the practice copy at http://127.0.0.1:47300/dell/support : my XPS 13 9310 fan is loud even at idle since the BIOS update last week. Service tag 7XK2PQ3. Contact me by email.';
  const obs: any = { url: 'http://127.0.0.1:47300/dell/signin?next=%2Fdell%2Frequest', title: 'Sign In | Dell US',
    text_sample: 'DELL Support Community Sign In Practice copy. Email Address Password Sign In Forgot Password? New to Dell? Create an Account',
    interactive_elements: [{ tag: 'input', text: 'Email Address' }, { tag: 'input', text: 'Password' }, { tag: 'button', text: 'Sign In' }] };
  assert.strictEqual(detectManualHelpNeed(cmd, obs, 0, 0)?.kind, 'login');
  // Apple: o login é um iframe (idmsa) — a página mostra só o cabeçalho e "Sign In - Apple".
  const apple: any = { url: 'https://idmsa.apple.com/IDMSWebAuth/signin?path=//post/question', title: 'Sign In - Apple', text_sample: 'Apple Store Mac iPad iPhone Support', interactive_elements: [] };
  assert.strictEqual(detectManualHelpNeed("open a support ticket with Apple for my MacBook's battery", apple, 0, 0)?.kind, 'login');
});

test('support tasks count as account tasks (sign-in wall pauses)', () => {
  assert.ok(commandLikelyNeedsAccount("open a support ticket with Apple for my MacBook's battery"));
  assert.ok(commandLikelyNeedsAccount('post a question in the Dell Community about fan noise'));
});

test('the confirmation shows what is being sent, never a password', () => {
  const d = formatSupportDraft([
    { label: 'Product', value: 'MacBook Air', type: 'select' },
    { label: 'Password', value: 'hunter2', type: 'password' },
    { label: 'Search', value: 'battery', type: 'text' },
    { label: 'Describe the issue', value: 'Battery drains from 100% to 20% in two hours since macOS 15.\nTried an SMC reset.', type: 'textarea' },
    { label: 'Phone', value: '555-0100', type: 'tel' },
    { label: 'Empty', value: '  ', type: 'text' },
  ]);
  assert.strictEqual(d, 'Product: MacBook Air\nPhone: 555-0100\nDescribe the issue:\nBattery drains from 100% to 20% in two hours since macOS 15.\nTried an SMC reset.');
  assert.ok(formatSupportDraft([{ label: 'Body', value: 'x'.repeat(5000), type: 'textarea' }]).length <= 1400);
});

test('a short answer in the middle of a support request stays a support task', () => {
  const prev = 'Create a support request with Dell technical support: my XPS 13 fan is loud at idle.';
  const t = supportRequestText('Email is fine. Service tag 7XK2PQ3. Please continue.', prev);
  assert.ok(t && t.includes(prev) && t.includes('Service tag 7XK2PQ3'));
  assert.strictEqual(supportSiteFor(t!)?.vendor, 'Dell');
  assert.strictEqual(supportRequestText('Email is fine.', 'find cheap flights to Lisbon'), null);
  assert.strictEqual(supportRequestText('Email is fine.', null), null);
  assert.strictEqual(supportRequestText('ask Apple support about my iPad', prev), 'ask Apple support about my iPad');
});

test('a support lobby offering sign-in is not a wall, even after a few steps there', () => {
  const lobby: any = { url: 'https://getsupport.apple.com/', title: 'Apple Support',
    text_sample: 'Get the help you need. Connect by phone, chat, email, and more. View your products Sign in with your Apple Account for personalized support. See all products Choose a product',
    interactive_elements: [{ tag: 'a', text: 'Sign in' }, { tag: 'a', text: 'Choose a product' }, { tag: 'input', text: 'Search Support' }] };
  assert.strictEqual(detectManualHelpNeed("open a support ticket with Apple for my MacBook's battery", lobby, 3, 2), null);
});

test('an address the user wrote wins over the official map', () => {
  const b = supportPromptBlock('Ask the Dell Community (practice copy at http://127.0.0.1:47300/dell/community) why my fan is loud', {});
  assert.match(b, /USER-GIVEN ADDRESS: http:\/\/127\.0\.0\.1:47300\/dell\/community — work there/);
  assert.doesNotMatch(b, /OFFICIAL DELL/);
});

test('the support home page mentioning subscriptions is not a paywall', () => {
  const home: any = { url: 'https://support.apple.com/', title: 'Official Apple Support',
    text_sample: 'Apple Support Need help? Start here. iPhone Mac iPad Reset Apple Account password Change a subscription Billing and payments Search Support',
    interactive_elements: [{ tag: 'a', text: 'Mac' }, { tag: 'a', text: 'Change a subscription' }, { tag: 'input', text: 'Search Support' }] };
  assert.strictEqual(detectManualHelpNeed("Open a support ticket with Apple for my MacBook Air's battery", home, 0, 0), null);
});

test('the send card warns when the description box is still empty', () => {
  const d = formatSupportDraft([{ label: 'Subject', value: 'Fan noise', type: 'text' }, { label: 'Describe the problem', value: '', type: 'textarea' }]);
  assert.strictEqual(d, 'Subject: Fan noise\n⚠️ Empty: Describe the problem');
});

test('a support request with a known vendor stays on that vendor\'s site', () => {
  const cmd = 'Ask Dell support about my XPS 13 9310 fan noise. Open a support request.';
  assert.strictEqual(offSupportSite({ type: 'navigate', url: 'https://www.dell.com/support/home/en-us' }, cmd), null);
  assert.strictEqual(offSupportSite({ type: 'navigate', url: 'www.dell.com/community/en' }, cmd), null);
  assert.match(offSupportSite({ type: 'navigate', url: 'https://www.notebookcheck.net/' }, cmd) || '', /not Dell's site/);
  assert.match(offSupportSite({ type: 'new_tab', url: 'https://mail.google.com' }, cmd) || '', /never the user's mailbox/);
  assert.match(offSupportSite({ type: 'web_search' }, cmd) || '', /stay on Dell's own support site/);
  assert.strictEqual(offSupportSite({ type: 'click_ref' }, cmd), null);
  // Apple: o login (idmsa.apple.com) é do mesmo dono.
  assert.strictEqual(offSupportSite({ type: 'navigate', url: 'https://idmsa.apple.com/IDMSWebAuth/signin' }, 'open a ticket with Apple for my MacBook'), null);
  // Sem fabricante conhecido, ou com endereço escrito pela pessoa: não restringe.
  assert.strictEqual(offSupportSite({ type: 'navigate', url: 'https://example.org/' }, 'open a support ticket about my printer'), null);
  assert.strictEqual(offSupportSite({ type: 'navigate', url: 'https://www.dell.com/' }, 'ask Dell support (copy at http://127.0.0.1:47300/dell/support)'), null);
});
