// Gerenciador de senha em extensão: qual está ligado, quanto o agente espera o login automático dele,
// e a interface que a extensão injeta na página fora da vista do agente.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  detectPasswordExtensions, parseExtraPasswordIds, guidanceKey, AUTO_LOGIN,
} from '../../src/shared/password-extensions.ts';
import { dropExtensionUi, isExtensionFrameUrl, EXTENSION_UI_SELECTOR } from '../../src/shared/extension-ui.ts';

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
