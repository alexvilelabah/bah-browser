// Gerenciador de senha em extensão: qual está ligado, quanto o agente espera o login automático dele,
// e a interface que a extensão injeta na página fora da vista do agente.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  detectPasswordExtensions, parseExtraPasswordIds, loginWaitStep, guidanceKey, AUTO_LOGIN, AUTO_LOGIN_WAIT_MS,
  PASSWORD_FIELD_FILLED_JS, SUBMIT_FILLED_LOGIN_JS,
} from '../../src/shared/password-extensions.ts';
import { dropExtensionUi, isExtensionFrameUrl, EXTENSION_UI_SELECTOR } from '../../src/shared/extension-ui.ts';
import { loginFormVisible } from '../../src/renderer/agent-login-policy.ts';

const LP = 'hdokiejnpimakedhajhdlcegeplioahd', BW = 'nngceckbapebfimnlniiiahkandclblb', OP = 'aeblfdkhhhdcdjpifhhbdiojplfjncoa';

test('detects LastPass, Bitwarden and 1Password by store ID; disabled or unknown ones do not count', () => {
  const list = [
    { id: 'abcdefghijklmnopabcdefghijklmnop', name: 'uBlock' },
    { id: BW, name: '__MSG_extName__' },
    { id: LP, name: 'LastPass: Free Password Manager', enabled: false },
    { id: OP, name: '1Password' },
  ];
  assert.deepEqual(detectPasswordExtensions(list), [
    { id: BW, name: 'Bitwarden', kind: 'bitwarden' },
    { id: OP, name: '1Password', kind: '1password' },
  ]);
  assert.deepEqual(detectPasswordExtensions([]), []);
  // Nome não basta: uma extensão qualquer chamada "LastPass" não é o LastPass.
  assert.deepEqual(detectPasswordExtensions([{ id: 'ponmlkjihgfedcbaponmlkjihgfedcba', name: 'LastPass' }]), []);
});

test('test-only extra IDs: only valid ids and known kinds are accepted', () => {
  const extra = parseExtraPasswordIds(JSON.stringify({ ponmlkjihgfedcbaponmlkjihgfedcba: 'lastpass', bad: 'lastpass', abcdefghijklmnopabcdefghijklmnop: 'evil' }));
  assert.deepEqual(extra, { ponmlkjihgfedcbaponmlkjihgfedcba: 'lastpass' });
  assert.deepEqual(parseExtraPasswordIds('not json'), {});
  assert.deepEqual(parseExtraPasswordIds(undefined), {});
  assert.equal(detectPasswordExtensions([{ id: 'ponmlkjihgfedcbaponmlkjihgfedcba' }], extra)[0].kind, 'lastpass');
});

test('setting names per extension (official docs) and which ones act on their own', () => {
  assert.equal(AUTO_LOGIN.lastpass.setting, 'Auto-login');
  assert.equal(AUTO_LOGIN.bitwarden.setting, 'Autofill on page load');
  assert.equal(AUTO_LOGIN['1password'].acts, false);   // 1Password nunca preenche sozinho
  assert.equal(AUTO_LOGIN.bitwarden.fillOnly, true);
  assert.equal(guidanceKey('lastpass'), 'pwext.guide.lastpass');
  assert.equal(guidanceKey('1password'), 'pwext.guide.1password');
});

test('wait decision: signed in / form gone continue; fill-only gets one submit; timeout pauses', () => {
  const snap = (o: Partial<{ loginForm: boolean; signedIn: boolean; passwordFilled: boolean; agentTyped: boolean }>) =>
    ({ loginForm: true, signedIn: false, passwordFilled: false, ...o });
  assert.equal(loginWaitStep({ kind: 'lastpass', elapsedMs: 500, submitted: false, snap: snap({}) }), 'wait');
  assert.equal(loginWaitStep({ kind: 'lastpass', elapsedMs: 500, submitted: false, snap: snap({ signedIn: true }) }), 'continue');
  assert.equal(loginWaitStep({ kind: 'lastpass', elapsedMs: 500, submitted: false, snap: snap({ loginForm: false }) }), 'continue');
  assert.equal(loginWaitStep({ kind: 'lastpass', elapsedMs: AUTO_LOGIN_WAIT_MS, submitted: false, snap: snap({}) }), 'pause');
  // LastPass envia sozinho: campo preenchido é só esperar o envio dele.
  assert.equal(loginWaitStep({ kind: 'lastpass', elapsedMs: 500, submitted: false, snap: snap({ passwordFilled: true }) }), 'wait');
  // Bitwarden só preenche: o Bah aperta Entrar UMA vez.
  assert.equal(loginWaitStep({ kind: 'bitwarden', elapsedMs: 500, submitted: false, snap: snap({ passwordFilled: true }) }), 'submit');
  assert.equal(loginWaitStep({ kind: 'bitwarden', elapsedMs: 500, submitted: true, snap: snap({ passwordFilled: true }) }), 'wait');
  assert.equal(loginWaitStep({ kind: 'bitwarden', elapsedMs: 99_999, submitted: true, snap: snap({ passwordFilled: true }) }), 'pause');
  // 1Password nunca entra sozinho → pausa já, sem esperar.
  assert.equal(loginWaitStep({ kind: '1password', elapsedMs: 0, submitted: false, snap: snap({}) }), 'pause');
  // Quem digitou foi o agente → não é a extensão: nada de enviar.
  assert.equal(loginWaitStep({ kind: 'bitwarden', elapsedMs: 0, submitted: false, snap: snap({ passwordFilled: true, agentTyped: true }) }), 'pause');
  assert.equal(loginWaitStep({ kind: 'lastpass', elapsedMs: 3000, budgetMs: 2000, submitted: false, snap: snap({}) }), 'pause');
});

test('page scripts compile and only answer yes/no (never return the password)', () => {
  new Function(PASSWORD_FIELD_FILLED_JS);
  new Function(SUBMIT_FILLED_LOGIN_JS);
  for (const js of [PASSWORD_FIELD_FILLED_JS, SUBMIT_FILLED_LOGIN_JS]) assert.doesNotMatch(js, /return\s+[^;]*\.value\s*[;}]/);
});

test('extension frames and injected UI roots are recognised', () => {
  assert.ok(isExtensionFrameUrl('chrome-extension://hdokiejnpimakedhajhdlcegeplioahd/webclient-infield.html'));
  assert.ok(!isExtensionFrameUrl('https://example.com/'));
  assert.ok(!isExtensionFrameUrl('about:srcdoc'));
  assert.ok(!isExtensionFrameUrl(undefined));
  assert.match(EXTENSION_UI_SELECTOR, /data-lastpass-icon-root/);
  assert.match(EXTENSION_UI_SELECTOR, /com-1password-button/);
});

test('AX nodes under an extension root are dropped (root included), page nodes stay', () => {
  const nodes = [
    { nodeId: '1', backendDOMNodeId: 1 },
    { nodeId: '2', parentId: '1', backendDOMNodeId: 2, name: 'Email' },
    { nodeId: '3', parentId: '1', backendDOMNodeId: 30 },              // <div data-lastpass-icon-root>
    { nodeId: '4', parentId: '3', backendDOMNodeId: 31, name: 'Fill' }, // botão no shadow root
    { nodeId: '5', parentId: '4', backendDOMNodeId: 32 },
    { nodeId: '6', parentId: '1', backendDOMNodeId: 40 },               // <iframe chrome-extension://>
    { nodeId: '7', parentId: '1', backendDOMNodeId: 7, name: 'Sign in' },
  ];
  const kept = dropExtensionUi(nodes, new Set([30, 40])).map(n => n.nodeId);
  assert.deepEqual(kept, ['1', '2', '7']);
  assert.equal(dropExtensionUi(nodes, new Set()).length, nodes.length);
});

test('login form visible: password field or a login URL', () => {
  const page = (url: string, els: Array<{ tag: string; aria?: string; text?: string }>) =>
    ({ url, title: '', text_sample: '', interactive_elements: els.map((e, i) => ({ id: i, x: 1, y: 1, w: 1, h: 1, text: '', ...e })) });
  assert.ok(loginFormVisible(page('https://x.com/a', [{ tag: 'input', aria: 'Password' }])));
  assert.ok(loginFormVisible(page('https://x.com/login', [])));
  assert.ok(!loginFormVisible(page('https://x.com/home', [{ tag: 'a', text: 'Sign out' }])));
});
