// Extensões do Chrome: ícone, badge/título (global × por aba), URLs que a extensão pode abrir,
// o que o Bah não tem, e caminhos que não saem da pasta da extensão.
import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import {
  isExtensionId, extensionIdFromUrl, extensionUrl, normalizeExtPath, resolveInsideRoot,
  pickIconPath, actionIconPath, optionsPagePath, localizeMessage, localeCandidates,
  parseColor, cssColor, autoTextColor, normalizeBadgeText, DEFAULT_BADGE_BG,
  initialActionState, updateAction, clearTabAction, resolveAction, actionView,
  asDetails, asTabId, checkTabUrl, hostAccessSummary, unsupportedFeatures,
  platformInfo, clampPopupSize, popupPosition, asAnchor,
  extensionIdFromKey, canSeeTabUrl, accessGrant, asGrant, accessIncrease,
  storageGet, storageSet, storageRemove, storageClear, storageBytesInUse, SYNC_LIMITS,
  createAlarm, alarmTimerDelay, MAX_TIMER_MS,
  isInsideDir, sanitizeDisabledEntry, parseDisabledSet, compareVersions, pickLatestVersion,
  mergeExtensionViews, storeInstallStatus, managementInfo, blockedAsDisabled,
} from '../../src/main/chrome-extension-rules.ts';

const ID = 'eemaaomlfllldamnpoajaedaemnblgal';   // Dólar Hoje
const OTHER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

// O manifesto de verdade do Dólar Hoje (o que importa dele).
const DOLAR = {
  manifest_version: 3, name: 'Dólar Hoje', version: '0.48',
  background: { service_worker: 'app.js' },
  icons: { '128': 'logo.png' },
  omnibox: { keyword: 'dolarhoje' },
  content_scripts: [{ matches: ['http://www.dolarhoje.com/', 'http://dolarhoje.com/', 'https://dolarhoje.com/'], js: ['has_extension.js'] }],
  action: { default_icon: 'logo.png', default_title: 'Dólar Hoje' },
  content_security_policy: {},
  host_permissions: ['http://DolarHoje.com/', 'http://api.DolarHoje.com/', 'https://DolarHoje.com/'],
};

test('extensionIdFromUrl: só chrome-extension:// com ID válido; o resto vira vazio', () => {
  assert.ok(isExtensionId(ID));
  assert.ok(!isExtensionId('abc'));
  assert.ok(!isExtensionId(ID.toUpperCase()));
  assert.strictEqual(extensionIdFromUrl(`chrome-extension://${ID}/`), ID);
  assert.strictEqual(extensionIdFromUrl(`chrome-extension://${ID}`), ID);          // origem do frame
  assert.strictEqual(extensionIdFromUrl(`chrome-extension://${ID}/popup.html?x#y`), ID);
  assert.strictEqual(extensionIdFromUrl(`chrome-extension://${ID}x/`), '');        // ID mais comprido
  assert.strictEqual(extensionIdFromUrl(`https://${ID}/`), '');
  assert.strictEqual(extensionIdFromUrl(`chrome-extension://${ID}.evil/`), '');
  assert.strictEqual(extensionIdFromUrl(undefined), '');
  assert.strictEqual(extensionUrl(ID, '/popup.html'), `chrome-extension://${ID}/popup.html`);
});

test('normalizeExtPath: relativo à raiz, nunca sobe, nunca outra extensão', () => {
  assert.strictEqual(normalizeExtPath('popup.html', ID), 'popup.html');
  assert.strictEqual(normalizeExtPath('/ui/popup.html?a=1#b', ID), 'ui/popup.html');
  assert.strictEqual(normalizeExtPath('./ui//x.html', ID), 'ui/x.html');
  assert.strictEqual(normalizeExtPath('ui\\x.html', ID), 'ui/x.html');
  assert.strictEqual(normalizeExtPath(`chrome-extension://${ID}/p.html`, ID), 'p.html');
  assert.strictEqual(normalizeExtPath('', ID), '');
  assert.strictEqual(normalizeExtPath('   ', ID), '');
  assert.strictEqual(normalizeExtPath('../segredo', ID), null);
  assert.strictEqual(normalizeExtPath('a/../../b', ID), null);
  assert.strictEqual(normalizeExtPath(`chrome-extension://${OTHER}/p.html`, ID), null);
  assert.strictEqual(normalizeExtPath('https://site.com/p.html', ID), null);
  assert.strictEqual(normalizeExtPath('javascript:alert(1)', ID), null);
  assert.strictEqual(normalizeExtPath(42, ID), null);
  assert.strictEqual(normalizeExtPath('a\0b', ID), null);
});

test('resolveInsideRoot: fica dentro da pasta da extensão', () => {
  const root = path.resolve('/tmp/ext/abc/0.48_0');
  assert.strictEqual(resolveInsideRoot(root, 'logo.png'), path.join(root, 'logo.png'));
  assert.strictEqual(resolveInsideRoot(root, '/img/a.png'), path.join(root, 'img', 'a.png'));
  assert.strictEqual(resolveInsideRoot(root, 'img\\a.png'), path.join(root, 'img', 'a.png'));
  assert.strictEqual(resolveInsideRoot(root, '../outra/logo.png'), null);
  assert.strictEqual(resolveInsideRoot(root, 'img/../../x'), null);
  assert.strictEqual(resolveInsideRoot(root, 'C:/Windows/win.ini'), null);
  assert.strictEqual(resolveInsideRoot(root, ''), null);
  assert.strictEqual(resolveInsideRoot(root, '.'), null);
  assert.strictEqual(resolveInsideRoot(root, undefined), null);
});

test('pickIconPath: menor que cobre o tamanho; senão o maior', () => {
  assert.strictEqual(pickIconPath('logo.png', 16), 'logo.png');
  const map = { '16': 'i16.png', '32': 'i32.png', '48': 'i48.png', '128': 'i128.png' };
  assert.strictEqual(pickIconPath(map, 16), 'i16.png');
  assert.strictEqual(pickIconPath(map, 20), 'i32.png');
  assert.strictEqual(pickIconPath(map, 32), 'i32.png');
  assert.strictEqual(pickIconPath({ '128': 'big.png' }, 16), 'big.png');
  assert.strictEqual(pickIconPath({ '16': 'a.png', '19': 'b.png' }, 32), 'b.png');
  assert.strictEqual(pickIconPath({ x: 'a.png', '16': 5 }, 16), '');
  assert.strictEqual(pickIconPath(undefined, 16), '');
});

test('actionIconPath: action.default_icon, depois icons', () => {
  assert.strictEqual(actionIconPath(DOLAR, 32), 'logo.png');
  assert.strictEqual(actionIconPath({ icons: { '48': 'i48.png', '16': 'i16.png' } }, 16), 'i16.png');
  assert.strictEqual(actionIconPath({ action: {}, icons: { '128': 'i.png' } }, 32), 'i.png');
  assert.strictEqual(actionIconPath({ action: { default_icon: { '16': 'a16.png', '32': 'a32.png' } }, icons: { '128': 'i.png' } }, 32), 'a32.png');
  assert.strictEqual(actionIconPath({}, 32), '');
  assert.strictEqual(actionIconPath(null, 32), '');
});

test('optionsPagePath: options_ui.page ou options_page, limpo', () => {
  assert.strictEqual(optionsPagePath({ options_ui: { page: 'options.html' } }, ID), 'options.html');
  assert.strictEqual(optionsPagePath({ options_page: '/opt/index.html' }, ID), 'opt/index.html');
  assert.strictEqual(optionsPagePath({ options_page: '../x.html' }, ID), '');
  assert.strictEqual(optionsPagePath(DOLAR, ID), '');
});

test('localizeMessage / localeCandidates: __MSG_nome__ do _locales', () => {
  const msgs = { appName: { message: 'Leitor Escuro' }, Desc: { message: 'Tudo escuro' } };
  assert.strictEqual(localizeMessage('__MSG_appName__', msgs), 'Leitor Escuro');
  assert.strictEqual(localizeMessage('__MSG_APPNAME__ — __MSG_desc__', msgs), 'Leitor Escuro — Tudo escuro');
  assert.strictEqual(localizeMessage('__MSG_missing__', msgs), '__MSG_missing__');
  assert.strictEqual(localizeMessage('Dólar Hoje', null), 'Dólar Hoje');
  assert.deepStrictEqual(localeCandidates('pt-BR', 'en'), ['pt_BR', 'pt', 'en']);
  assert.deepStrictEqual(localeCandidates('es', 'fr'), ['es', 'fr', 'en']);
  assert.deepStrictEqual(localeCandidates('', '../../etc'), ['en']);
});

test('parseColor: string CSS ou [r,g,b,a]; inválida → null', () => {
  assert.deepStrictEqual(parseColor('#006400'), [0, 100, 0, 255]);   // verde do Dólar Hoje
  assert.deepStrictEqual(parseColor('#f00'), [255, 0, 0, 255]);
  assert.deepStrictEqual(parseColor('#ff000080'), [255, 0, 0, 128]);
  assert.deepStrictEqual(parseColor('rgb(1, 2, 3)'), [1, 2, 3, 255]);
  assert.deepStrictEqual(parseColor('rgba(1,2,3,0.5)'), [1, 2, 3, 128]);
  assert.deepStrictEqual(parseColor('Red'), [255, 0, 0, 255]);
  assert.deepStrictEqual(parseColor([10, 20, 30, 255]), [10, 20, 30, 255]);
  assert.deepStrictEqual(parseColor([10, 20, 30]), [10, 20, 30, 255]);
  assert.deepStrictEqual(parseColor([300, -5, 30.4, 255]), [255, 0, 30, 255]);
  assert.deepStrictEqual(parseColor('hsl(120, 100%, 50%)'), [0, 255, 0, 255]);
  assert.deepStrictEqual(parseColor('hsla(0, 100%, 50%, 0.5)'), [255, 0, 0, 128]);
  assert.deepStrictEqual(parseColor('hsl(-120, 100%, 50%)'), [0, 0, 255, 255]);      // -120° = 240°
  assert.deepStrictEqual(parseColor('hsl(480, 100%, 50%)'), [0, 255, 0, 255]);       // 480° = 120°
  assert.deepStrictEqual(parseColor('hsl(0, 0%, 100%)'), [255, 255, 255, 255]);
  assert.deepStrictEqual(parseColor('hsl(0, 150%, 50%)'), [255, 0, 0, 255]);         // saturação limitada a 100%
  assert.strictEqual(parseColor('hsl(0, 100, 50)'), null);                           // sem % não vale
  assert.strictEqual(parseColor('red; background:url(x)'), null);
  assert.strictEqual(parseColor('#12345'), null);
  assert.strictEqual(parseColor([1, 2]), null);
  assert.strictEqual(parseColor([1, 2, 'x']), null);
  assert.strictEqual(parseColor(undefined), null);
  assert.strictEqual(cssColor([0, 100, 0, 255]), 'rgba(0, 100, 0, 1)');
  assert.deepStrictEqual(autoTextColor([0, 100, 0, 255]), [255, 255, 255, 255]);
  assert.deepStrictEqual(autoTextColor([255, 255, 0, 255]), [0, 0, 0, 255]);
});

test('normalizeBadgeText: no máximo 4 caracteres (letras, não bytes)', () => {
  assert.strictEqual(normalizeBadgeText('5,43'), '5,43');
  assert.strictEqual(normalizeBadgeText('12345'), '1234');
  assert.strictEqual(normalizeBadgeText('😀😀😀😀😀'), '😀😀😀😀');
  assert.strictEqual(normalizeBadgeText(''), '');
  assert.strictEqual(normalizeBadgeText(null), '');
});

test('estado do botão: por aba ganha do global; null na aba volta pro global; texto vazio limpa', () => {
  let s = initialActionState(DOLAR, ID);
  assert.strictEqual(resolveAction(s).title, 'Dólar Hoje');
  assert.strictEqual(resolveAction(s).badgeText, '');
  assert.strictEqual(resolveAction(s).enabled, true);

  s = updateAction(s, 'badgeText', '5,43');
  s = updateAction(s, 'badgeBg', [0, 100, 0, 255]);
  s = updateAction(s, 'title', 'US$ 1,00 vale R$ 5,43 hoje');
  assert.strictEqual(resolveAction(s).badgeText, '5,43');
  assert.strictEqual(resolveAction(s, 7).badgeText, '5,43');          // aba sem valor próprio usa o global

  s = updateAction(s, 'badgeText', 'ON', 7);
  assert.strictEqual(resolveAction(s, 7).badgeText, 'ON');
  assert.strictEqual(resolveAction(s, 8).badgeText, '5,43');
  assert.strictEqual(resolveAction(s).badgeText, '5,43');

  s = updateAction(s, 'badgeText', '', 7);                            // vazio NA ABA: some só lá
  assert.strictEqual(resolveAction(s, 7).badgeText, '');
  s = updateAction(s, 'badgeText', null, 7);                          // null na aba: volta pro global
  assert.strictEqual(resolveAction(s, 7).badgeText, '5,43');
  assert.deepStrictEqual(s.tabs, {});

  s = updateAction(s, 'badgeText', '');                               // vazio global: limpa
  assert.strictEqual(resolveAction(s).badgeText, '');

  s = updateAction(s, 'title', 'outro');
  s = updateAction(s, 'title', null);                                 // null global: volta ao padrão
  assert.strictEqual(resolveAction(s).title, 'Dólar Hoje');

  s = updateAction(s, 'enabled', false, 3);
  assert.strictEqual(resolveAction(s, 3).enabled, false);
  const before = s;
  s = clearTabAction(s, 3);
  assert.strictEqual(resolveAction(s, 3).enabled, true);
  assert.notStrictEqual(s, before);
  assert.strictEqual(clearTabAction(s, 99), s);                       // nada mudou → mesmo objeto
});

test('updateAction não muda o estado anterior (imutável)', () => {
  const a = initialActionState(DOLAR, ID);
  const b = updateAction(a, 'badgeText', 'x', 1);
  assert.deepStrictEqual(a.tabs, {});
  assert.strictEqual(b.tabs['1'].badgeText, 'x');
  assert.strictEqual(a.global.badgeText, '');
});

test('initialActionState: popup do manifesto (limpo), título padrão', () => {
  const s = initialActionState({ action: { default_popup: '/popup/index.html', default_title: 'T' } }, ID);
  assert.strictEqual(s.global.popup, 'popup/index.html');
  assert.strictEqual(s.global.title, 'T');
  assert.strictEqual(initialActionState({ action: { default_popup: '../x.html' } }, ID).global.popup, '');
  assert.strictEqual(initialActionState({}, ID).global.popup, '');
});

test('actionView: o que a tela desenha', () => {
  let s = initialActionState(DOLAR, ID);
  let v = actionView(s, 'Dólar Hoje', 'data:icon');
  assert.strictEqual(v.title, 'Dólar Hoje');
  assert.strictEqual(v.badgeText, '');
  assert.strictEqual(v.badgeBg, cssColor(DEFAULT_BADGE_BG));
  assert.strictEqual(v.badgeFg, 'rgba(255, 255, 255, 1)');
  assert.strictEqual(v.icon, 'data:icon');
  assert.strictEqual(v.enabled, true);
  assert.strictEqual(v.hasPopup, false);
  s = updateAction(s, 'badgeText', '5,43');
  s = updateAction(s, 'badgeBg', [0, 100, 0, 255]);
  s = updateAction(s, 'title', '');
  v = actionView(s, 'Dólar Hoje', '');
  assert.strictEqual(v.badgeText, '5,43');
  assert.strictEqual(v.badgeBg, 'rgba(0, 100, 0, 1)');
  assert.strictEqual(v.title, 'Dólar Hoje');                          // título vazio → nome
  s = updateAction(s, 'badgeFg', [255, 255, 0, 255]);
  s = updateAction(s, 'icon', 'data:tab', 4);
  s = updateAction(s, 'popup', 'p.html', 4);
  assert.strictEqual(actionView(s, 'x', 'data:icon').badgeFg, 'rgba(255, 255, 0, 1)');
  assert.strictEqual(actionView(s, 'x', 'data:icon', 4).icon, 'data:tab');
  assert.strictEqual(actionView(s, 'x', 'data:icon', 4).hasPopup, true);
  assert.strictEqual(actionView(s, 'x', 'data:icon', 5).hasPopup, false);
});

test('asDetails / asTabId: argumentos da extensão conferidos', () => {
  assert.deepStrictEqual(asDetails(undefined), {});
  assert.deepStrictEqual(asDetails({ text: 'a' }), { text: 'a' });
  assert.throws(() => asDetails('x'));
  assert.throws(() => asDetails([1]));
  assert.strictEqual(asTabId(undefined), undefined);
  assert.strictEqual(asTabId(null), undefined);
  assert.strictEqual(asTabId(12), 12);
  assert.throws(() => asTabId(-1));
  assert.throws(() => asTabId(1.5));
  assert.throws(() => asTabId('3'));
});

test('checkTabUrl: http/https e páginas da própria extensão; o resto é recusado', () => {
  assert.deepStrictEqual(checkTabUrl('https://dolarhoje.com', ID), { ok: true, url: 'https://dolarhoje.com/' });
  assert.deepStrictEqual(checkTabUrl('http://example.com/a?b#c', ID), { ok: true, url: 'http://example.com/a?b#c' });
  assert.deepStrictEqual(checkTabUrl(undefined, ID), { ok: true, url: '' });
  assert.deepStrictEqual(checkTabUrl('options.html', ID), { ok: true, url: `chrome-extension://${ID}/options.html` });
  assert.deepStrictEqual(checkTabUrl('/ui/page.html?x=1', ID), { ok: true, url: `chrome-extension://${ID}/ui/page.html?x=1` });
  assert.deepStrictEqual(checkTabUrl('../../../escape.html', ID), { ok: true, url: `chrome-extension://${ID}/escape.html` });
  assert.deepStrictEqual(checkTabUrl(`chrome-extension://${ID}/p.html`, ID), { ok: true, url: `chrome-extension://${ID}/p.html` });
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,<b>x</b>',
    'chrome://settings', 'about:blank', `chrome-extension://${OTHER}/p.html`, 'blob:https://x/y']) {
    assert.strictEqual(checkTabUrl(bad, ID).ok, false, bad);
  }
  assert.strictEqual(checkTabUrl(42, ID).ok, false);
});

test('hostAccessSummary: sites do Dólar Hoje; <all_urls> = todos', () => {
  assert.deepStrictEqual(hostAccessSummary(DOLAR), { all: false, hosts: ['dolarhoje.com', 'api.dolarhoje.com', 'www.dolarhoje.com'] });
  assert.strictEqual(hostAccessSummary({ host_permissions: ['<all_urls>'] }).all, true);
  assert.strictEqual(hostAccessSummary({ content_scripts: [{ matches: ['*://*/*'] }] }).all, true);
  assert.strictEqual(hostAccessSummary({ host_permissions: ['https://*/*'] }).all, true);
  assert.deepStrictEqual(hostAccessSummary({ host_permissions: ['https://*.google.com/*', 'http://localhost:3000/*'] }).hosts, ['*.google.com', 'localhost']);
  assert.deepStrictEqual(hostAccessSummary({ permissions: ['storage', 'https://a.com/*'] }).hosts, ['a.com']);
  assert.deepStrictEqual(hostAccessSummary({ optional_host_permissions: ['<all_urls>'] }), { all: false, hosts: [] });
  assert.deepStrictEqual(hostAccessSummary(null), { all: false, hosts: [] });
  // file:// não é "todos os sites" (o Bah não dá acesso a arquivo local pra extensão)
  assert.deepStrictEqual(hostAccessSummary({ host_permissions: ['file:///*'] }), { all: false, hosts: [] });
  assert.deepStrictEqual(hostAccessSummary({ content_scripts: [{ matches: ['file://*/*.md'] }] }), { all: false, hosts: [] });
  assert.deepStrictEqual(hostAccessSummary({ content_scripts: [{ matches: ['file:///C:/*'] }] }), { all: false, hosts: [] });
  assert.deepStrictEqual(hostAccessSummary({ host_permissions: ['file:///*', 'https://a.com/*'] }), { all: false, hosts: ['a.com'] });
});

test('extensionIdFromKey: mesmo ID que a biblioteca da loja e o Chrome calculam', () => {
  // O algoritmo da própria electron-chrome-web-store (src/browser/id.ts), lido do dist.
  const dist = fs.readFileSync(path.resolve('node_modules/electron-chrome-web-store/dist/cjs/browser/index.js'), 'utf8');
  const start = dist.indexOf('// src/browser/id.ts');
  const end = dist.indexOf('// src/browser/', start + 10);
  assert.ok(start >= 0 && end > start, 'id.ts não achado no dist da biblioteca');
  const body = dist.slice(start, end).replace(/var import_node_crypto = require\("node:crypto"\);/, '');
  const libGenerateId = new Function('import_node_crypto', `${body}\nreturn generateId;`)({ createHash }) as (k: string) => string;
  for (let i = 0; i < 5; i++) {
    const key = randomBytes(162).toString('base64');
    const id = extensionIdFromKey(key);
    assert.ok(isExtensionId(id), id);
    assert.strictEqual(id, libGenerateId(key));
  }
  assert.strictEqual(extensionIdFromKey(''), '');
  assert.strictEqual(extensionIdFromKey(undefined), '');
  assert.strictEqual(extensionIdFromKey(42), '');
});

test('canSeeTabUrl: url/título da aba só com tabs, activeTab ou host_permissions que cubra', () => {
  const page = 'https://docs.google.com/document/d/segredo/edit';
  assert.strictEqual(canSeeTabUrl(DOLAR, page), false);                                   // só dolarhoje.com
  assert.strictEqual(canSeeTabUrl(DOLAR, 'https://dolarhoje.com/'), true);
  assert.strictEqual(canSeeTabUrl(DOLAR, 'http://api.dolarhoje.com/x'), true);
  assert.strictEqual(canSeeTabUrl(DOLAR, 'https://api.dolarhoje.com/x'), false);          // só http no manifesto
  assert.strictEqual(canSeeTabUrl({ permissions: ['tabs'] }, page), true);
  assert.strictEqual(canSeeTabUrl({ permissions: ['activeTab'] }, page), true);
  assert.strictEqual(canSeeTabUrl({ host_permissions: ['<all_urls>'] }, page), true);
  assert.strictEqual(canSeeTabUrl({ host_permissions: ['*://*/*'] }, page), true);
  assert.strictEqual(canSeeTabUrl({ host_permissions: ['https://*.google.com/*'] }, page), true);
  assert.strictEqual(canSeeTabUrl({ host_permissions: ['https://*.google.com/*'] }, 'https://google.com/'), true);
  assert.strictEqual(canSeeTabUrl({ host_permissions: ['https://*.google.com/*'] }, 'https://notgoogle.com/'), false);
  assert.strictEqual(canSeeTabUrl({ host_permissions: ['https://google.com/*'] }, page), false);
  assert.strictEqual(canSeeTabUrl({ permissions: ['https://docs.google.com/*'] }, page), true);  // MV2
  // content_scripts NÃO dão acesso à url da aba
  assert.strictEqual(canSeeTabUrl({ content_scripts: [{ matches: ['<all_urls>'] }] }, page), false);
  assert.strictEqual(canSeeTabUrl({}, page), false);
  assert.strictEqual(canSeeTabUrl({ host_permissions: ['<all_urls>'] }, 'not a url'), false);
  // página da própria extensão ela sempre vê; a de outra, não
  assert.strictEqual(canSeeTabUrl({}, `chrome-extension://${ID}/options.html`, ID), true);
  assert.strictEqual(canSeeTabUrl({}, `chrome-extension://${OTHER}/options.html`, ID), false);
});

test('accessGrant / accessIncrease: atualização que pede mais acesso precisa de aprovação', () => {
  const g = accessGrant(DOLAR);
  assert.deepStrictEqual(g, { permissions: [], all: false, hosts: ['api.dolarhoje.com', 'dolarhoje.com', 'www.dolarhoje.com'] });
  assert.deepStrictEqual(asGrant(JSON.parse(JSON.stringify(g))), g);
  assert.strictEqual(asGrant({ permissions: 'x', all: false, hosts: [] }), null);
  assert.strictEqual(asGrant(null), null);
  // mesma coisa (ou menos) → nada novo
  assert.strictEqual(accessIncrease(g, DOLAR), null);
  assert.strictEqual(accessIncrease(g, { ...DOLAR, host_permissions: ['https://dolarhoje.com/'] }), null);
  // <all_urls> num content script → todos os sites
  assert.deepStrictEqual(
    accessIncrease(g, { ...DOLAR, host_permissions: ['<all_urls>'] }),
    { permissions: [], all: true, hosts: [] },
  );
  // site novo
  assert.deepStrictEqual(
    accessIncrease(g, { ...DOLAR, host_permissions: [...DOLAR.host_permissions, 'https://bank.com/*'] }),
    { permissions: [], all: false, hosts: ['bank.com'] },
  );
  // permissão com aviso (tabs, cookies) conta; sem aviso (storage, alarms) não
  assert.deepStrictEqual(
    accessIncrease(g, { ...DOLAR, permissions: ['storage', 'alarms', 'tabs', 'cookies'] }),
    { permissions: ['cookies', 'tabs'], all: false, hosts: [] },
  );
  assert.strictEqual(accessIncrease(g, { ...DOLAR, permissions: ['storage', 'alarms'] }), null);
  // curinga aprovado cobre subdomínio; nome exato não cobre curinga
  const wild = accessGrant({ host_permissions: ['https://*.site.com/*'] });
  assert.strictEqual(accessIncrease(wild, { host_permissions: ['https://a.site.com/*', 'https://site.com/*', 'https://*.b.site.com/*'] }), null);
  const exact = accessGrant({ host_permissions: ['https://site.com/*'] });
  assert.deepStrictEqual(accessIncrease(exact, { host_permissions: ['https://*.site.com/*'] }), { permissions: [], all: false, hosts: ['*.site.com'] });
  // já tinha todos os sites: host novo não é novidade
  assert.strictEqual(accessIncrease(accessGrant({ host_permissions: ['<all_urls>'] }), { host_permissions: ['https://x.com/*'] }), null);
  // sem nada aprovado, tudo é novo
  assert.deepStrictEqual(accessIncrease(null, { permissions: ['tabs'] }), { permissions: ['tabs'], all: false, hosts: [] });
});

test('storage.sync: área própria (get/set/remove/clear), mudanças e cotas do Chrome', () => {
  let s = {};
  let r = storageSet(s, { theme: 'dark', n: 1, gone: undefined, fn: () => 1 } as any);
  s = r.store;
  assert.deepStrictEqual(s, { theme: 'dark', n: 1 });
  assert.deepStrictEqual(r.changes, { theme: { newValue: 'dark' }, n: { newValue: 1 } });
  r = storageSet(s, { theme: 'dark', n: 2 });                                // igual não avisa
  assert.deepStrictEqual(r.changes, { n: { oldValue: 1, newValue: 2 } });
  s = r.store;
  assert.deepStrictEqual(storageGet(s, null), { theme: 'dark', n: 2 });
  assert.deepStrictEqual(storageGet(s, 'theme'), { theme: 'dark' });
  assert.deepStrictEqual(storageGet(s, ['theme', 'nope']), { theme: 'dark' });
  assert.deepStrictEqual(storageGet(s, { theme: 'light', size: 12 }), { theme: 'dark', size: 12 });
  assert.throws(() => storageGet(s, 5));
  assert.strictEqual(storageBytesInUse(s, 'theme'), 'theme'.length + '"dark"'.length);
  assert.strictEqual(storageBytesInUse(s), storageBytesInUse(s, ['theme', 'n']));
  r = storageRemove(s, ['n', 'nope']);
  assert.deepStrictEqual(r.changes, { n: { oldValue: 2 } });
  assert.deepStrictEqual(r.store, { theme: 'dark' });
  r = storageClear(r.store);
  assert.deepStrictEqual(r.store, {});
  assert.deepStrictEqual(r.changes, { theme: { oldValue: 'dark' } });
  // não mexe no objeto anterior
  assert.deepStrictEqual(s, { theme: 'dark', n: 2 });
  // "__proto__" é uma chave como outra qualquer
  const p = storageSet({}, JSON.parse('{"__proto__": {"x": 1}}')).store;
  assert.ok(Object.prototype.hasOwnProperty.call(p, '__proto__'));
  assert.strictEqual(Object.getPrototypeOf(p), Object.prototype);
  // cotas
  assert.throws(() => storageSet({}, { big: 'x'.repeat(SYNC_LIMITS.QUOTA_BYTES_PER_ITEM) }), /QUOTA_BYTES_PER_ITEM/);
  const many: Record<string, number> = {};
  for (let i = 0; i <= SYNC_LIMITS.MAX_ITEMS; i++) many['k' + i] = i;
  assert.throws(() => storageSet({}, many), /MAX_ITEMS/);
  const heavy: Record<string, string> = {};
  for (let i = 0; i < 20; i++) heavy['k' + i] = 'x'.repeat(8000);
  assert.throws(() => storageSet({}, heavy), /QUOTA_BYTES quota/);
  assert.throws(() => storageSet({}, [1]), /Invalid items/);
});

test('createAlarm / alarmTimerDelay: mínimo de 30 s e alarme longe não dispara na hora', () => {
  const now = 1_000_000;
  assert.deepStrictEqual(createAlarm('a', { delayInMinutes: 1 }, now), { name: 'a', scheduledTime: now + 60000 });
  assert.deepStrictEqual(createAlarm('a', { delayInMinutes: 0.01 }, now), { name: 'a', scheduledTime: now + 30000 });
  assert.deepStrictEqual(createAlarm('p', { periodInMinutes: 5 }, now), { name: 'p', scheduledTime: now + 300000, periodInMinutes: 5 });
  assert.deepStrictEqual(createAlarm('p', { periodInMinutes: 0.1 }, now), { name: 'p', scheduledTime: now + 30000, periodInMinutes: 0.5 });
  assert.deepStrictEqual(createAlarm(undefined, { when: now + 5 }, now), { name: '', scheduledTime: now + 5 });
  assert.deepStrictEqual(createAlarm('x', {}, now), { name: 'x', scheduledTime: now + 30000 });
  assert.throws(() => createAlarm('x', { when: now, delayInMinutes: 1 }, now), /both/);
  assert.throws(() => createAlarm('x', { delayInMinutes: -1 }, now));
  assert.throws(() => createAlarm('x', { when: 'amanhã' }, now));
  // "me lembra mês que vem": 30 dias passa do limite do setTimeout → espera em pedaços
  const month = createAlarm('m', { when: now + 30 * 86400e3 }, now);
  assert.strictEqual(alarmTimerDelay(month.scheduledTime, now), MAX_TIMER_MS);
  assert.strictEqual(alarmTimerDelay(month.scheduledTime, now + MAX_TIMER_MS), 30 * 86400e3 - MAX_TIMER_MS);
  assert.strictEqual(alarmTimerDelay(now - 10, now), 0);
});

test('preload da loja: os textos que o Bah troca continuam lá (versão nova da biblioteca quebra aqui)', () => {
  const src = fs.readFileSync(path.resolve('node_modules/electron-chrome-web-store/dist/chrome-web-store.preload.js'), 'utf8');
  assert.ok(src.includes('overrideUserAgent();'), 'sem overrideUserAgent(); — o Bah não consegue tirar o disfarce de Mac');
  assert.ok(src.includes('setAppName(result.app_name)'), 'sem setAppName(result.app_name) — o nome "Bah" some dos botões');
});

test('unsupportedFeatures: o que o Bah ainda não tem', () => {
  assert.deepStrictEqual(unsupportedFeatures(DOLAR), ['omnibox']);   // CSP vazio NÃO conta
  assert.deepStrictEqual(
    unsupportedFeatures({ permissions: ['storage', 'tabs', 'webRequest', 'declarativeNetRequest', 'contextMenus', 'alarms', 'scripting', 'webRequest'], side_panel: { default_path: 'p.html' } }),
    ['webRequest', 'declarativeNetRequest', 'contextMenus', 'sidePanel'],
  );
  assert.deepStrictEqual(unsupportedFeatures({ permissions: ['storage', 'activeTab', 'scripting'], action: {} }), []);
  assert.deepStrictEqual(unsupportedFeatures({ commands: { _execute_action: {} }, chrome_url_overrides: { newtab: 'n.html' } }), ['chrome_url_overrides', 'commands']);
  assert.deepStrictEqual(unsupportedFeatures(undefined), []);
});

test('platformInfo / clampPopupSize / popupPosition / asAnchor', () => {
  assert.deepStrictEqual(platformInfo('win32', 'x64'), { os: 'win', arch: 'x86-64', nacl_arch: 'x86-64' });
  assert.deepStrictEqual(platformInfo('darwin', 'arm64'), { os: 'mac', arch: 'arm64', nacl_arch: 'arm' });
  assert.deepStrictEqual(clampPopupSize(10, 10000), { width: 25, height: 600 });
  assert.deepStrictEqual(clampPopupSize(300.2, 200), { width: 301, height: 200 });
  assert.deepStrictEqual(clampPopupSize(NaN, undefined), { width: 25, height: 25 });
  const work = { x: 0, y: 0, width: 1920, height: 1040 };
  // canto de cima à direita do popup embaixo do canto de baixo à direita do ícone
  assert.deepStrictEqual(popupPosition({ left: 1500, right: 1528, bottom: 90 }, { x: 100, y: 50 }, { width: 300, height: 200 }, work), { x: 1328, y: 142 });
  // não sai da tela
  assert.deepStrictEqual(popupPosition({ left: 0, right: 10, bottom: 90 }, { x: 0, y: 0 }, { width: 300, height: 200 }, work), { x: 0, y: 92 });
  // zoom da UI
  assert.deepStrictEqual(popupPosition({ left: 0, right: 1000, bottom: 50 }, { x: 0, y: 0 }, { width: 100, height: 100 }, work, 1.5), { x: 1400, y: 77 });
  assert.deepStrictEqual(asAnchor({ left: 1, top: 2, right: 3, bottom: 4 }), { left: 1, top: 2, right: 3, bottom: 4 });
  assert.strictEqual(asAnchor({ left: 1, top: 2, right: 'x', bottom: 4 }), null);
  assert.strictEqual(asAnchor(null), null);
});

// ── Ligar/desligar ────────────────────────────────────────────────────────────

const EXTS_WIN = 'C:\\Users\\a\\AppData\\Roaming\\bah-browser\\Extensions';
const EXTS_POSIX = '/home/a/.config/bah-browser/Extensions';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('isInsideDir: só DENTRO da pasta (nem igual, nem vizinha, nem ..)', () => {
  assert.ok(isInsideDir(EXTS_WIN, `${EXTS_WIN}\\${ID}\\0.48_0`, 'win32'));
  assert.ok(isInsideDir(EXTS_WIN, `${EXTS_WIN.toLowerCase()}\\${ID}`, 'win32'));     // Windows: sem diferenciar maiúsculas
  assert.ok(!isInsideDir(EXTS_WIN, EXTS_WIN, 'win32'));                              // a própria pasta não
  assert.ok(!isInsideDir(EXTS_WIN, `${EXTS_WIN}\\..\\Local Storage`, 'win32'));
  assert.ok(!isInsideDir(EXTS_WIN, `${EXTS_WIN}-evil\\x`, 'win32'));                  // pasta vizinha com o mesmo começo
  assert.ok(!isInsideDir(EXTS_WIN, 'D:\\x', 'win32'));
  assert.ok(!isInsideDir(EXTS_WIN, `${EXTS_WIN}\\a\u0000b`, 'win32'));
  assert.ok(!isInsideDir(EXTS_WIN, 42, 'win32'));
  assert.ok(isInsideDir(EXTS_POSIX, `${EXTS_POSIX}/${ID}/0.48_0`, 'linux'));
  assert.ok(!isInsideDir(EXTS_POSIX, `${EXTS_POSIX.toUpperCase()}/${ID}`, 'linux'));  // Linux diferencia
  assert.ok(!isInsideDir(EXTS_POSIX, `${EXTS_POSIX}/../x`, 'linux'));
  // Uma pasta que começa com ".." mas está dentro vale ("..x" não é "..").
  assert.ok(isInsideDir(EXTS_POSIX, `${EXTS_POSIX}/..x`, 'linux'));
});

test('parseDisabledSet: só IDs de verdade, campos limpos, pasta fora de Extensions vira vazio', () => {
  const raw = JSON.parse(JSON.stringify({
    [ID]: { name: '  Dólar Hoje\n', version: '0.48', icon: PNG, path: `${EXTS_POSIX}/${ID}/0.48_0` },
    [OTHER]: { name: 42, version: '1.0<script>', icon: 'javascript:alert(1)', path: '/etc' },
    '../../evil': { name: 'x', path: `${EXTS_POSIX}/x` },
  }).replace('{', '{"__proto__":{"name":"p"},'));
  const set = parseDisabledSet(raw, EXTS_POSIX, 'linux');
  assert.deepStrictEqual(Object.keys(set).sort(), [OTHER, ID].sort());
  assert.deepStrictEqual(set[ID], { name: 'Dólar Hoje', version: '0.48', icon: PNG, path: `${EXTS_POSIX}/${ID}/0.48_0` });
  assert.deepStrictEqual(set[OTHER], { name: OTHER, version: '', icon: '', path: '' });
  // lista antiga só com os IDs
  assert.deepStrictEqual(Object.keys(parseDisabledSet([ID, 'nope', 7], EXTS_POSIX, 'linux')), [ID]);
  assert.deepStrictEqual(parseDisabledSet(null, EXTS_POSIX, 'linux'), {});
  assert.deepStrictEqual(parseDisabledSet('x', EXTS_POSIX, 'linux'), {});
  // ícone enorme não entra; caminho relativo resolve a partir do cwd (fora) → vazio
  const big = sanitizeDisabledEntry(ID, { icon: 'data:image/png;base64,' + 'A'.repeat(300_000), path: 'Extensions/x' }, EXTS_POSIX, 'linux');
  assert.strictEqual(big.icon, '');
  assert.strictEqual(big.path, '');
  assert.strictEqual(sanitizeDisabledEntry(ID, { name: 'x'.repeat(500) }, EXTS_POSIX, 'linux').name.length, 200);
});

test('compareVersions / pickLatestVersion: como o Chrome compara versões', () => {
  assert.strictEqual(compareVersions('1.2.10', '1.2.9'), 1);
  assert.strictEqual(compareVersions('1.2', '1.2.0'), 0);
  assert.strictEqual(compareVersions('0.48', '0.5'), 1);
  assert.strictEqual(compareVersions('1', '2'), -1);
  assert.strictEqual(compareVersions(undefined, '0'), 0);
  assert.deepStrictEqual(pickLatestVersion([{ version: '0.47', p: 'a' }, { version: '0.48', p: 'b' }, { version: '0.9', p: 'c' }]), { version: '0.48', p: 'b' });
  assert.strictEqual(pickLatestVersion([]), null);
});

test('mergeExtensionViews: ligadas + desligadas, por nome, com o "enabled" do interruptor', () => {
  const st = initialActionState(DOLAR, ID);
  const loaded = [{ id: ID, name: 'Dólar Hoje', version: '0.48', hasOptions: false, global: actionView(st, 'Dólar Hoje', PNG), tabs: {} }];
  const disabled = { [OTHER]: { name: 'Alpha', version: '2.0', icon: PNG, path: '' } };
  const list = mergeExtensionViews(loaded, disabled);
  assert.deepStrictEqual(list.map(x => [x.id, x.enabled]), [[OTHER, false], [ID, true]]);   // "Alpha" antes de "Dólar"
  const off = list[0];
  assert.strictEqual(off.name, 'Alpha');
  assert.strictEqual(off.version, '2.0');
  assert.strictEqual(off.hasOptions, false);
  assert.strictEqual(off.global.icon, PNG);
  assert.strictEqual(off.global.badgeText, '');
  assert.strictEqual(off.global.enabled, false);
  assert.deepStrictEqual(off.tabs, {});
  // Ainda carregada mas já na lista de desligadas (descarregando agora): vai desligada, uma vez só.
  const both = mergeExtensionViews(loaded, { [ID]: { name: 'Dólar Hoje', version: '0.48', icon: '', path: '' } });
  assert.strictEqual(both.length, 1);
  assert.strictEqual(both[0].enabled, false);
  assert.strictEqual(both[0].global.icon, PNG);   // o estado da carregada ganha
  // Sem nome guardado: usa o ID.
  assert.strictEqual(mergeExtensionViews([], { [OTHER]: { name: '', version: '', icon: '', path: '' } })[0].name, OTHER);
});

test('blockedAsDisabled: desligada não carrega, menos a que está sendo ligada agora', () => {
  const disabled = { [ID]: { name: 'Dólar Hoje', version: '0.48', icon: '', path: '' } };
  assert.strictEqual(blockedAsDisabled(ID, disabled, new Set()), true);
  // Ligando: continua na lista de desligadas (arquivo e menu), mas este carregamento passa.
  assert.strictEqual(blockedAsDisabled(ID, disabled, new Set([ID])), false);
  // Ligando OUTRA: a desligada continua barrada.
  assert.strictEqual(blockedAsDisabled(ID, disabled, new Set([OTHER])), true);
  assert.strictEqual(blockedAsDisabled(OTHER, disabled, new Set()), false);
  // Nada de herança do Object.prototype.
  assert.strictEqual(blockedAsDisabled('constructor', disabled, new Set()), false);
  // Durante o carregamento a linha segue no menu (desligada), sem sumir.
  assert.deepStrictEqual(mergeExtensionViews([], disabled).map(x => [x.id, x.enabled]), [[ID, false]]);
});

test('storeInstallStatus: desligada → "disabled" (a loja oferece Ativar, não instalar)', () => {
  const base = { manifest: { manifest_version: 3 }, minimumManifestVersion: 3 };
  assert.strictEqual(storeInstallStatus({ ...base, loaded: false, disabledByUser: false }), 'installable');
  assert.strictEqual(storeInstallStatus({ ...base, loaded: true, disabledByUser: false }), 'enabled');
  assert.strictEqual(storeInstallStatus({ ...base, loaded: false, disabledByUser: true }), 'disabled');
  assert.strictEqual(storeInstallStatus({ ...base, loaded: true, disabledByUser: true }), 'disabled');
  assert.strictEqual(storeInstallStatus({ manifest: { manifest_version: 2 }, minimumManifestVersion: 3, loaded: false, disabledByUser: true }), 'deprecated_manifest_version');
  assert.strictEqual(storeInstallStatus({ manifest: null, minimumManifestVersion: 3, loaded: false, disabledByUser: false }), 'installable');
});

test('managementInfo: o formato que a loja recebe (igual ao da biblioteca)', () => {
  const info = managementInfo(ID, { ...DOLAR, description: 'Cotação', options_page: 'o.html' }, false, 'Dólar Hoje');
  assert.strictEqual(info.id, ID);
  assert.strictEqual(info.enabled, false);
  assert.strictEqual(info.name, 'Dólar Hoje');
  assert.strictEqual(info.shortName, 'Dólar Hoje');
  assert.strictEqual(info.version, '0.48');
  assert.strictEqual(info.description, 'Cotação');
  assert.strictEqual(info.mayDisable, true);
  assert.strictEqual(info.type, 'extension');
  assert.strictEqual(info.installType, 'normal');
  assert.strictEqual(info.optionsUrl, `chrome-extension://${ID}/o.html`);
  assert.deepStrictEqual(info.icons, [{ size: 128, url: `chrome://extension-icon/${ID}/128/0` }]);
  assert.deepStrictEqual(info.hostPermissions, DOLAR.host_permissions);
  const bare = managementInfo(OTHER, null, true);
  assert.strictEqual(bare.name, OTHER);
  assert.strictEqual(bare.enabled, true);
  assert.deepStrictEqual(bare.permissions, []);
});
