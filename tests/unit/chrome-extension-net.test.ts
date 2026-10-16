// Extensões do Chrome — a parte de VPN/proxy: padrão de endereço (permissão de host), tradução
// do chrome.proxy pro session.setProxy, ChromeSetting (quem controla), login de proxy,
// cookies, notificações e as linhas do diálogo de instalação.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  matchPattern, hasHostPermission, hasApiPermission, unsupportedFeatures,
  parseProxyServer, proxyServerUri, pacDataUrl, translateProxyConfig, proxyConfigMentions, proxyChainMentions, MAX_PAC_BYTES,
  settingInfo, validateSettingValue, settingLevel, checkSettingScope, parseSettingControllers, isEnforcedSetting,
  parseDormantSettings, DORMANT_KEY,
  PROXY_SETTING, WEBRTC_SETTING, PRIVACY_SETTING_KEYS,
  canAnswerProxyAuth, authAnswer, authRequestKind, chromeHeaders,
  imageHeaderSize, iconBytesOk, iconDataUrlBase64, MAX_ICON_BYTES,
  chromeCookie, cookieUrl, checkCookieStore, cookieTargetUrl, cookieSetDetails, cookieFilter, cookieChangeCause, pickCookie,
  notificationIdArg, notificationOptions, notificationBody, notificationIcon,
  permissionLineKeys,
} from '../../src/main/chrome-extension-rules.ts';

const VPN = 'majdfhpaihoncoakbjgbdhglocklcgno';
const OTHER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
// O que importa do manifesto da "VPN grátis para Chrome" 5.0.3.
const VPN_MANIFEST = {
  manifest_version: 3, version: '5.0.3',
  permissions: ['storage', 'proxy', 'tabs', 'cookies', 'notifications', 'webRequest', 'webRequestAuthProvider', 'privacy', 'management'],
  host_permissions: ['<all_urls>'],
};

test('matchPattern: padrões do Chrome (esquema, host, porta, caminho)', () => {
  assert.ok(matchPattern('<all_urls>', 'https://a.com/x'));
  assert.ok(matchPattern('<all_urls>', 'wss://a.com/x'));
  assert.ok(!matchPattern('<all_urls>', 'file:///C:/x'));
  assert.ok(!matchPattern('<all_urls>', 'chrome-extension://x/y'));
  assert.ok(matchPattern('*://*/*', 'http://a.com/'));
  assert.ok(!matchPattern('*://*/*', 'ftp://a.com/'));
  assert.ok(matchPattern('https://*.veepn.com/*', 'https://veepn.com/a'));
  assert.ok(matchPattern('https://*.veepn.com/*', 'https://api.veepn.com/a'));
  assert.ok(!matchPattern('https://*.veepn.com/*', 'https://notveepn.com/a'));
  assert.ok(!matchPattern('https://*.veepn.com/*', 'http://veepn.com/a'));
  assert.ok(matchPattern('http://a.com/p/*', 'http://a.com/p/q?x=1'));
  assert.ok(!matchPattern('http://a.com/p/*', 'http://a.com/z'));
  assert.ok(matchPattern('http://a.com/p/*', 'http://a.com/z', { ignorePath: true }));
  assert.ok(matchPattern('http://a.com:8080/*', 'http://a.com:8080/'));
  assert.ok(!matchPattern('http://a.com:8080/*', 'http://a.com/'));
  assert.ok(matchPattern('http://a.com/*', 'http://a.com:9999/'));          // sem porta = qualquer porta
  assert.ok(matchPattern('https://a.com:443/*', 'https://a.com/'));          // porta padrão
  assert.ok(matchPattern('http://[::1]/*', 'http://[::1]:3000/'));
  assert.ok(matchPattern('http://A.COM/', 'http://a.com/', { ignorePath: true }));
  assert.ok(!matchPattern('http://a.*.com/*', 'http://a.b.com/'));           // curinga no meio: inválido
  assert.ok(!matchPattern('file:///*', 'file:///etc/passwd'));
  assert.ok(!matchPattern('garbage', 'http://a.com/'));
  assert.ok(!matchPattern('<all_urls>', 'not a url'));
});

test('hasHostPermission: host_permissions e MV2; content_scripts não contam', () => {
  assert.ok(hasHostPermission(VPN_MANIFEST, 'https://veepn.com/'));
  assert.ok(hasHostPermission({ permissions: ['https://a.com/*'] }, 'https://a.com/x'));
  assert.ok(!hasHostPermission({ content_scripts: [{ matches: ['<all_urls>'] }] }, 'https://a.com/'));
  assert.ok(!hasHostPermission({ host_permissions: ['https://a.com/*'] }, 'https://b.com/'));
  assert.ok(!hasHostPermission(null, 'https://a.com/'));
  assert.ok(hasApiPermission(VPN_MANIFEST, 'proxy'));
  assert.ok(!hasApiPermission({}, 'proxy'));
});

test('unsupportedFeatures: a VPN não vê mais proxy/cookies/notificações/privacy como faltando', () => {
  assert.deepStrictEqual(unsupportedFeatures(VPN_MANIFEST), []);
  // Sem proxy + webRequestAuthProvider, webRequest continua avisado.
  assert.deepStrictEqual(unsupportedFeatures({ permissions: ['webRequest', 'webRequestAuthProvider'] }), ['webRequest']);
  assert.deepStrictEqual(unsupportedFeatures({ permissions: ['proxy', 'webRequest'] }), ['webRequest']);
});

test('parseProxyServer: esquema, host e porta conferidos', () => {
  assert.deepStrictEqual(parseProxyServer({ host: 'p.example.com' }), { scheme: 'http', host: 'p.example.com', port: 80 });
  assert.deepStrictEqual(parseProxyServer({ scheme: 'socks5', host: '10.0.0.1' }), { scheme: 'socks5', host: '10.0.0.1', port: 1080 });
  assert.deepStrictEqual(parseProxyServer({ scheme: 'https', host: 'P.Example.com', port: 8443 }), { scheme: 'https', host: 'p.example.com', port: 8443 });
  assert.deepStrictEqual(parseProxyServer({ host: '::1', port: 3128 }), { scheme: 'http', host: '[::1]', port: 3128 });
  assert.strictEqual(proxyServerUri(parseProxyServer({ scheme: 'quic', host: 'q.example' })), 'quic://q.example:443');
  for (const bad of [
    { host: 'a.com', port: 0 }, { host: 'a.com', port: 70000 }, { host: 'a.com', port: 80.5 }, { host: 'a.com', port: '80' },
    { scheme: 'ftp', host: 'a.com' }, { host: '' }, { host: 'a.com;direct://' }, { host: 'a.com,b.com' }, { host: 'a b' },
    { host: 'a.com:80' }, { host: 'a/b' }, { host: 42 }, null, 'a.com',
  ]) assert.throws(() => parseProxyServer(bad), /Invalid/, JSON.stringify(bad));
});

test('translateProxyConfig: modos do Chrome → session.setProxy do Electron', () => {
  assert.deepStrictEqual(translateProxyConfig({ mode: 'direct' }).electron, { mode: 'direct' });
  assert.deepStrictEqual(translateProxyConfig({ mode: 'system' }).electron, { mode: 'system' });
  assert.deepStrictEqual(translateProxyConfig({ mode: 'auto_detect' }).electron, { mode: 'auto_detect' });

  // O formato que a VPN gera: PAC em texto com "HTTPS host:porta".
  const pac = 'function FindProxyForURL(url, host) { return "HTTPS s1.example.net:443; HTTPS 1.2.3.4:443"; }';
  const p = translateProxyConfig({ mode: 'pac_script', pacScript: { data: pac, mandatory: false } });
  assert.strictEqual(p.electron.mode, 'pac_script');
  assert.strictEqual(p.electron.pacScript, pacDataUrl(pac));
  assert.ok(p.electron.pacScript!.startsWith('data:application/x-ns-proxy-autoconfig;base64,'));
  assert.strictEqual(Buffer.from(p.electron.pacScript!.split(',')[1], 'base64').toString('utf8'), pac);
  assert.deepStrictEqual(p.value, { mode: 'pac_script', pacScript: { data: pac, mandatory: false } });
  assert.deepStrictEqual(translateProxyConfig({ mode: 'pac_script', pacScript: { url: 'https://x.com/p.pac' } }).electron,
    { mode: 'pac_script', pacScript: 'https://x.com/p.pac' });
  assert.throws(() => translateProxyConfig({ mode: 'pac_script', pacScript: { url: 'file:///C:/p.pac' } }), /http, https or data/);
  assert.throws(() => translateProxyConfig({ mode: 'pac_script', pacScript: { url: 'javascript:alert(1)' } }), /Invalid pacScript/);
  assert.throws(() => translateProxyConfig({ mode: 'pac_script', pacScript: {} }), /needs data or url/);
  assert.throws(() => translateProxyConfig({ mode: 'pac_script' }), /needs pacScript/);
  assert.throws(() => translateProxyConfig({ mode: 'pac_script', pacScript: { data: 'x'.repeat(MAX_PAC_BYTES + 1) } }), /too large/);

  const single = translateProxyConfig({ mode: 'fixed_servers', rules: { singleProxy: { scheme: 'socks5', host: 'p.net', port: 1081 }, bypassList: ['<local>', '*.lan', '10.0.0.0/8'] } });
  assert.deepStrictEqual(single.electron, { mode: 'fixed_servers', proxyRules: 'socks5://p.net:1081', proxyBypassRules: '<local>,*.lan,10.0.0.0/8' });
  assert.deepStrictEqual(single.value.rules, { singleProxy: { scheme: 'socks5', host: 'p.net', port: 1081 }, bypassList: ['<local>', '*.lan', '10.0.0.0/8'] });
  const per = translateProxyConfig({ mode: 'fixed_servers', rules: { proxyForHttp: { host: 'h' }, proxyForHttps: { scheme: 'https', host: 's', port: 444 }, fallbackProxy: { scheme: 'socks4', host: 'f' } } });
  assert.strictEqual(per.electron.proxyRules, 'http=http://h:80;https=https://s:444;socks=socks4://f:1080');
  assert.strictEqual(per.electron.proxyBypassRules, undefined);
  assert.throws(() => translateProxyConfig({ mode: 'fixed_servers', rules: {} }), /no proxy server/);
  assert.throws(() => translateProxyConfig({ mode: 'fixed_servers', rules: { singleProxy: { host: 'a' }, bypassList: ['a,b'] } }), /bypassList/);
  assert.throws(() => translateProxyConfig({ mode: 'fixed_servers', rules: { singleProxy: { host: 'a' }, bypassList: ['a b'] } }), /bypassList/);
  assert.throws(() => translateProxyConfig({ mode: 'fixed_servers', rules: { singleProxy: { host: 'a' }, bypassList: 'x' } }), /bypassList/);
  assert.throws(() => translateProxyConfig({ mode: 'fixed_servers' }), /needs rules/);
  assert.throws(() => translateProxyConfig({ mode: 'evil' }), /Invalid proxy mode/);
  assert.throws(() => translateProxyConfig(null), /expected an object/);
  assert.throws(() => translateProxyConfig([]), /expected an object/);
});

test('proxyConfigMentions: o servidor que pediu senha é o da config da extensão?', () => {
  const pac = { mode: 'pac_script', pacScript: { data: 'return "HTTPS S1.example.net:443; PROXY 1.2.3.4:8080"' } };
  assert.ok(proxyConfigMentions(pac, 's1.example.net', 443));
  assert.ok(proxyConfigMentions(pac, '1.2.3.4', 8080));
  assert.ok(!proxyConfigMentions(pac, '1.2.3.4', 443));
  assert.ok(!proxyConfigMentions(pac, 'evil.com', 443));
  const fixed = translateProxyConfig({ mode: 'fixed_servers', rules: { singleProxy: { host: 'p.net', port: 3128 } } }).value;
  assert.ok(proxyConfigMentions(fixed, 'P.NET', 3128));
  assert.ok(!proxyConfigMentions(fixed, 'p.net', 80));
  assert.ok(!proxyConfigMentions({ mode: 'pac_script', pacScript: { url: 'https://x/p.pac' } }, 'x', 443));
  assert.ok(!proxyConfigMentions({ mode: 'direct' }, 'x', 1));
  assert.ok(!proxyConfigMentions(null, 'x', 1));
});

test('proxyChainMentions: o caminho que o Chromium resolveu passa por este proxy?', () => {
  // PAC que monta o endereço na hora / pacScript.url: o texto não tem "host:porta", o resolveProxy tem.
  assert.ok(proxyChainMentions('HTTPS s1.example.net:443; PROXY 1.2.3.4:8080; DIRECT', 'S1.example.net', 443));
  assert.ok(proxyChainMentions('HTTPS s1.example.net:443; PROXY 1.2.3.4:8080', '1.2.3.4', 8080));
  assert.ok(proxyChainMentions('PROXY [::1]:3128', '::1', 3128));
  assert.ok(proxyChainMentions('SOCKS5 p.net:1080', 'p.net', 1080));
  assert.ok(!proxyChainMentions('DIRECT', 'p.net', 1080));
  assert.ok(!proxyChainMentions('PROXY p.net:1081', 'p.net', 1080));
  assert.ok(!proxyChainMentions('PROXY evil-p.net:1080', 'p.net', 1080));
  assert.ok(!proxyChainMentions('PROXY p.net:10800', 'p.net', 1080));
  assert.ok(!proxyChainMentions(undefined, 'p.net', 1080));
  assert.ok(!proxyChainMentions('PROXY p.net:1080', '', 1080));
  assert.ok(!proxyChainMentions('PROXY p.net:1080', 'p.net', '1080'));
});

test('ChromeSetting: chaves, valores, levelOfControl e escopo', () => {
  assert.deepStrictEqual(settingInfo(PROXY_SETTING), { perm: 'proxy', def: { mode: 'system' } });
  assert.deepStrictEqual(settingInfo(WEBRTC_SETTING), { perm: 'privacy', def: 'default' });
  assert.deepStrictEqual(settingInfo('privacy.services.passwordSavingEnabled'), { perm: 'privacy', def: true });
  assert.strictEqual(settingInfo('privacy.network.nope'), null);
  assert.strictEqual(settingInfo('privacy.__proto__'), null);
  assert.strictEqual(settingInfo(undefined), null);
  for (const k of PRIVACY_SETTING_KEYS) assert.ok(settingInfo('privacy.' + k), k);

  assert.strictEqual(validateSettingValue(WEBRTC_SETTING, 'disable_non_proxied_udp'), 'disable_non_proxied_udp');
  assert.throws(() => validateSettingValue(WEBRTC_SETTING, 'off'), /webRTCIPHandlingPolicy/);
  assert.strictEqual(validateSettingValue('privacy.network.networkPredictionEnabled', false), false);
  assert.throws(() => validateSettingValue('privacy.network.networkPredictionEnabled', 'no'), /boolean/);
  assert.deepStrictEqual(validateSettingValue(PROXY_SETTING, { mode: 'direct', junk: 1 }), { mode: 'direct' });
  assert.throws(() => validateSettingValue(PROXY_SETTING, { mode: 'x' }), /proxy mode/);

  assert.strictEqual(settingLevel(false, null, VPN), 'not_controllable');
  assert.strictEqual(settingLevel(false, VPN, VPN), 'not_controllable');
  assert.strictEqual(settingLevel(true, null, VPN), 'controllable_by_this_extension');
  assert.strictEqual(settingLevel(true, VPN, VPN), 'controlled_by_this_extension');
  assert.strictEqual(settingLevel(true, OTHER, VPN), 'controlled_by_other_extensions');

  // Só proxy e WebRTC o Bah aplica; o resto de privacy.* não pode dizer "controlado por você".
  assert.ok(isEnforcedSetting(PROXY_SETTING));
  assert.ok(isEnforcedSetting(WEBRTC_SETTING));
  assert.ok(!isEnforcedSetting('privacy.websites.hyperlinkAuditingEnabled'));
  assert.ok(!isEnforcedSetting('privacy.network.networkPredictionEnabled'));
  assert.ok(!isEnforcedSetting('privacy.websites.thirdPartyCookiesAllowed'));
  assert.ok(!isEnforcedSetting(DORMANT_KEY));

  checkSettingScope(undefined); checkSettingScope('regular'); checkSettingScope('regular_only');
  assert.throws(() => checkSettingScope('incognito_persistent'), /incognito/);
  assert.throws(() => checkSettingScope('x'), /Invalid scope/);
});

test('parseSettingControllers: o arquivo salvo só devolve o que é válido', () => {
  const pac = { mode: 'pac_script', pacScript: { data: 'function FindProxyForURL(){return "DIRECT"}' } };
  const raw = {
    proxy: { extId: VPN, value: pac },
    [WEBRTC_SETTING]: { extId: VPN, value: 'disable_non_proxied_udp' },
    'privacy.network.networkPredictionEnabled': { extId: 'nope', value: false },   // ID inválido
    'privacy.services.autofillEnabled': { extId: VPN, value: 'x' },               // valor inválido
    'privacy.whatever': { extId: VPN, value: true },                              // chave desconhecida
    'privacy.websites.hyperlinkAuditingEnabled': { extId: VPN, value: false },    // o Bah não aplica: some
    [DORMANT_KEY]: { [VPN]: { proxy: pac } },                                       // não é configuração
  };
  assert.deepStrictEqual(parseSettingControllers(raw), {
    proxy: { extId: VPN, value: pac },
    [WEBRTC_SETTING]: { extId: VPN, value: 'disable_non_proxied_udp' },
  });
  assert.deepStrictEqual(parseSettingControllers(null), {});
  assert.deepStrictEqual(parseSettingControllers([1]), {});
  assert.deepStrictEqual(parseSettingControllers({ proxy: { extId: VPN, value: { mode: 'fixed_servers', rules: { singleProxy: { host: 'a;b' } } } } }), {});
});

test('parseDormantSettings: o proxy/WebRTC pausado de extensão desligada volta do arquivo, conferido', () => {
  const pac = { mode: 'pac_script', pacScript: { data: 'function FindProxyForURL(){return "HTTPS a.net:443"}' } };
  const raw = {
    proxy: { extId: OTHER, value: { mode: 'direct' } },
    [DORMANT_KEY]: {
      [VPN]: { proxy: pac, [WEBRTC_SETTING]: 'disable_non_proxied_udp', 'privacy.websites.referrersEnabled': false, junk: 1 },
      [OTHER]: { proxy: { mode: 'evil' } },           // valor inválido: a extensão some (sem nada)
      'not-an-id': { proxy: pac },
    },
  };
  assert.deepStrictEqual(parseDormantSettings(raw), { [VPN]: { proxy: pac, [WEBRTC_SETTING]: 'disable_non_proxied_udp' } });
  assert.deepStrictEqual(parseDormantSettings({ proxy: { extId: VPN, value: pac } }), {});
  assert.deepStrictEqual(parseDormantSettings({ [DORMANT_KEY]: [1] }), {});
  assert.deepStrictEqual(parseDormantSettings(null), {});
  // O arquivo antigo (sem "dormant") continua igual pro parse dos controles.
  assert.deepStrictEqual(parseSettingControllers(raw), { proxy: { extId: OTHER, value: { mode: 'direct' } } });
});

test('login de proxy: quem pode responder e o formato da resposta', () => {
  assert.ok(canAnswerProxyAuth(VPN_MANIFEST));
  assert.ok(canAnswerProxyAuth({ permissions: ['webRequest', 'webRequestBlocking'] }));
  assert.ok(!canAnswerProxyAuth({ permissions: ['webRequestAuthProvider'] }));
  assert.ok(!canAnswerProxyAuth({ permissions: ['webRequest'] }));
  assert.deepStrictEqual(authAnswer({ authCredentials: { username: 'u', password: 'p' } }), { kind: 'credentials', username: 'u', password: 'p' });
  assert.deepStrictEqual(authAnswer({ cancel: true, authCredentials: { username: 'u', password: 'p' } }), { kind: 'cancel' });
  assert.deepStrictEqual(authAnswer({ authCredentials: { username: 'u' } }), { kind: 'none' });
  assert.deepStrictEqual(authAnswer({ authCredentials: { username: 'u', password: 'x'.repeat(5000) } }), { kind: 'none' });
  assert.deepStrictEqual(authAnswer({}), { kind: 'none' });
  assert.deepStrictEqual(authAnswer(undefined), { kind: 'none' });
  assert.deepStrictEqual(authAnswer({ cancel: 'yes' }), { kind: 'none' });

  // type/frameId: navegação do quadro principal (o endereço que a aba está abrindo) × o resto.
  assert.deepStrictEqual(authRequestKind({ hasWc: true, isNavigation: true, url: 'https://a.com/', mainFrameUrl: 'https://a.com/' }), { type: 'main_frame', frameId: 0 });
  assert.deepStrictEqual(authRequestKind({ hasWc: true, isNavigation: true, url: 'https://ads.com/f', mainFrameUrl: 'https://a.com/' }), { type: 'sub_frame', frameId: -1 });
  assert.deepStrictEqual(authRequestKind({ hasWc: true, isNavigation: true, url: 'https://a.com/' }), { type: 'sub_frame', frameId: -1 });
  assert.deepStrictEqual(authRequestKind({ hasWc: true, isNavigation: false, url: 'https://a.com/x.png', mainFrameUrl: 'https://a.com/x.png' }), { type: 'other', frameId: -1 });
  assert.deepStrictEqual(authRequestKind({ hasWc: false, isNavigation: false, url: 'https://api.veepn.com/' }), { type: 'xmlhttprequest', frameId: -1 });
  assert.deepStrictEqual(chromeHeaders({ 'proxy-authenticate': ['Basic realm="x"', 'Digest y'], via: '1.1 p', n: 5, gone: null }), [
    { name: 'proxy-authenticate', value: 'Basic realm="x"' }, { name: 'proxy-authenticate', value: 'Digest y' },
    { name: 'via', value: '1.1 p' }, { name: 'n', value: '5' },
  ]);
  assert.deepStrictEqual(chromeHeaders(undefined), []);
  assert.deepStrictEqual(chromeHeaders(['x']), []);
});

test('cookies: formato do Chrome, URL da permissão e argumentos conferidos', () => {
  const c = chromeCookie({ name: 'udid', value: 'v', domain: '.veepn.com', hostOnly: false, path: '/', secure: true, httpOnly: false, session: false, expirationDate: 1900000000.5, sameSite: 'lax' });
  assert.deepStrictEqual(c, { domain: '.veepn.com', hostOnly: false, httpOnly: false, name: 'udid', path: '/', sameSite: 'lax', secure: true, session: false, storeId: '0', value: 'v', expirationDate: 1900000000.5 });
  const s = chromeCookie({ name: 'a', value: 'b', domain: 'x.com', session: true, expirationDate: 5, sameSite: 'weird' });
  assert.strictEqual(s.expirationDate, undefined);
  assert.strictEqual(s.sameSite, 'unspecified');
  assert.strictEqual(cookieUrl({ domain: '.veepn.com', path: '/a', secure: true }), 'https://veepn.com/a');
  assert.strictEqual(cookieUrl({ domain: 'x.com', secure: false }), 'http://x.com/');

  checkCookieStore(undefined); checkCookieStore('0');
  assert.throws(() => checkCookieStore('1'), /store id/);
  assert.strictEqual(cookieTargetUrl('https://veepn.com'), 'https://veepn.com/');
  assert.throws(() => cookieTargetUrl('chrome://settings'), /Invalid url/);
  assert.throws(() => cookieTargetUrl('file:///C:/x'), /Invalid url/);
  assert.throws(() => cookieTargetUrl(5), /Invalid url/);

  // O set() que a VPN faz: url + domain ".host" + expirationDate em segundos.
  assert.deepStrictEqual(cookieSetDetails({ name: 'udid', value: 'v', url: 'https://veepn.com/', domain: '.veepn.com', expirationDate: 1900000000 }),
    { url: 'https://veepn.com/', name: 'udid', value: 'v', domain: '.veepn.com', expirationDate: 1900000000, sameSite: 'unspecified' });
  // Sem sameSite = 'unspecified' (o Electron poria 'lax'); o que a extensão pediu vale.
  assert.strictEqual(cookieSetDetails({ url: 'https://a.com', sameSite: 'strict' }).sameSite, 'strict');
  assert.strictEqual(cookieSetDetails({ url: 'https://a.com', sameSite: 'no_restriction' }).sameSite, 'no_restriction');
  assert.throws(() => cookieSetDetails({ url: 'https://a.com', name: 'a\nb' }), /name/);
  assert.throws(() => cookieSetDetails({ url: 'https://a.com', path: 'x' }), /path/);
  assert.throws(() => cookieSetDetails({ url: 'https://a.com', secure: 'yes' }), /secure/);
  assert.throws(() => cookieSetDetails({ url: 'https://a.com', sameSite: 'none' }), /sameSite/);
  assert.throws(() => cookieSetDetails({ url: 'https://a.com', expirationDate: Infinity }), /expirationDate/);
  assert.throws(() => cookieSetDetails({ name: 'a' }), /Invalid url/);

  assert.deepStrictEqual(cookieFilter({ domain: 'veepn.com', secure: true, storeId: '0', junk: 1 }), { domain: 'veepn.com', secure: true });
  assert.deepStrictEqual(cookieFilter(undefined), {});
  assert.throws(() => cookieFilter({ session: 1 }), /session/);

  assert.strictEqual(cookieChangeCause('inserted'), 'explicit');
  assert.strictEqual(cookieChangeCause('explicit'), 'explicit');
  assert.strictEqual(cookieChangeCause('expired-overwrite'), 'expired_overwrite');
  assert.strictEqual(cookieChangeCause('inserted-no-change-overwrite'), 'overwrite');
  assert.strictEqual(cookieChangeCause('evicted'), 'evicted');
  assert.deepStrictEqual(pickCookie([{ path: '/' }, { path: '/a/b' }, { path: '/a' }]), { path: '/a/b' });
  assert.strictEqual(pickCookie([]), null);
});

test('notificações: id, opções (create × update), texto e ícone só de dentro da extensão', () => {
  assert.strictEqual(notificationIdArg(undefined), '');
  assert.strictEqual(notificationIdArg('abc'), 'abc');
  assert.throws(() => notificationIdArg(5), /id/);
  assert.throws(() => notificationIdArg('x'.repeat(501)), /id/);

  assert.throws(() => notificationOptions({ title: 't' }, null), /required properties/);
  const o = notificationOptions({ type: 'basic', title: 'VPN', message: 'Conectado', iconUrl: `chrome-extension://${VPN}/icons/128.png`, buttons: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }, null);
  assert.strictEqual(o.title, 'VPN');
  assert.deepStrictEqual(o.buttons, ['A', 'B']);   // o Chrome aceita até 2
  const u = notificationOptions({ message: 'Desconectado' }, o);
  assert.strictEqual(u.title, 'VPN');
  assert.strictEqual(u.message, 'Desconectado');
  assert.strictEqual(o.message, 'Conectado');     // o original não muda
  assert.throws(() => notificationOptions({ type: 'weird', title: 't', message: 'm' }, null), /type/);
  assert.throws(() => notificationOptions({ type: 'progress', title: 't', message: 'm', progress: 101 }, null), /progress/);
  assert.throws(() => notificationOptions({ type: 'basic', title: 't', message: 'm', priority: 3 }, null), /priority/);

  const list = notificationOptions({ type: 'list', title: 't', message: 'm', items: [{ title: 'a', message: 'b' }], contextMessage: 'ctx' }, null);
  assert.strictEqual(notificationBody(list, 'VPN grátis'), 'm\na: b\nctx\n— VPN grátis');
  const prog = notificationOptions({ type: 'progress', title: 't', message: 'm', progress: 40 }, null);
  assert.strictEqual(notificationBody(prog, ''), 'm\n40%');

  assert.deepStrictEqual(notificationIcon(`chrome-extension://${VPN}/icons/128.png`, VPN), { kind: 'file', rel: 'icons/128.png' });
  assert.deepStrictEqual(notificationIcon('data:image/png;base64,AAAA', VPN), { kind: 'data', url: 'data:image/png;base64,AAAA' });
  assert.strictEqual(notificationIcon(`chrome-extension://${OTHER}/x.png`, VPN), null);
  assert.strictEqual(notificationIcon(`chrome-extension://${VPN}/../../x.png`, VPN), null);
  assert.strictEqual(notificationIcon('https://evil.com/x.png', VPN), null);
  assert.strictEqual(notificationIcon('data:text/html;base64,AAAA', VPN), null);
  assert.strictEqual(notificationIcon('file:///C:/x.png', VPN), null);
  // Só PNG/JPEG (o nativeImage só decodifica esses) e até ~1 MB.
  assert.deepStrictEqual(notificationIcon('data:image/jpeg;base64,AAAA', VPN), { kind: 'data', url: 'data:image/jpeg;base64,AAAA' });
  assert.strictEqual(notificationIcon('data:image/gif;base64,AAAA', VPN), null);
  assert.strictEqual(notificationIcon('data:image/webp;base64,AAAA', VPN), null);
  assert.strictEqual(notificationIcon('data:image/png;base64,' + 'A'.repeat(1_400_000), VPN), null);
  assert.ok(notificationIcon('data:image/png;base64,' + 'A'.repeat(1_300_000), VPN));
  assert.strictEqual(iconDataUrlBase64('data:image/png;base64,QUJD'), 'QUJD');
  assert.strictEqual(iconDataUrlBase64('data:image/png;base64,QU JD'), null);
  assert.strictEqual(iconDataUrlBase64(5), null);
});

// Cabeçalho de PNG (assinatura + IHDR) e de JPEG (APP0, DQT, SOF0) com o tamanho declarado.
const pngHeader = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  b[24] = 1; // 1 bit por pixel: um "PNG bomba" pequeno declara 12000×12000
  return b;
};
const jpegHeader = (w: number, h: number, sof = 0xc0) => Buffer.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,   // APP0 (JFIF)
  0xff, 0xdb, 0x00, 0x04, 0x00, 0x00,                                                                               // DQT (curto)
  0xff, sof, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,       // SOFn
  0xff, 0xda, 0x00, 0x02,
]);

test('ícones: tamanho pelo cabeçalho (PNG/JPEG) ANTES de decodificar', () => {
  assert.deepStrictEqual(imageHeaderSize(pngHeader(128, 64)), { width: 128, height: 64 });
  assert.deepStrictEqual(imageHeaderSize(pngHeader(12000, 12000)), { width: 12000, height: 12000 });
  assert.deepStrictEqual(imageHeaderSize(pngHeader(0xffffffff, 1)), { width: 0xffffffff, height: 1 });
  assert.deepStrictEqual(imageHeaderSize(jpegHeader(640, 480)), { width: 640, height: 480 });
  assert.deepStrictEqual(imageHeaderSize(jpegHeader(300, 200, 0xc2)), { width: 300, height: 200 });   // progressivo
  assert.strictEqual(imageHeaderSize(jpegHeader(300, 200, 0xc4)), null);   // DHT não é SOF: segue até o SOS e desiste
  const notIhdr = pngHeader(1, 1); notIhdr.write('IDAT', 12, 'latin1');
  assert.strictEqual(imageHeaderSize(notIhdr), null);
  assert.strictEqual(imageHeaderSize(Buffer.from('GIF89a' + 'x'.repeat(30))), null);
  assert.strictEqual(imageHeaderSize(Buffer.alloc(10)), null);
  assert.strictEqual(imageHeaderSize(Buffer.from([0xff, 0xd8, 0x00, 0x00, ...new Array(30).fill(0)])), null);

  assert.ok(iconBytesOk(pngHeader(128, 128)));
  assert.ok(iconBytesOk(pngHeader(1024, 1024)));
  assert.ok(!iconBytesOk(pngHeader(1025, 16)));
  assert.ok(!iconBytesOk(pngHeader(12000, 12000)));
  assert.ok(!iconBytesOk(pngHeader(0, 16)));
  assert.ok(iconBytesOk(jpegHeader(512, 512)));
  assert.ok(!iconBytesOk(jpegHeader(4000, 10)));
  assert.ok(!iconBytesOk(Buffer.concat([pngHeader(16, 16), Buffer.alloc(MAX_ICON_BYTES)])));   // arquivo grande demais
  assert.ok(!iconBytesOk(Buffer.from('not an image at all, really not')));
});

test('diálogo de instalação: linhas das permissões novas (e textos em en/pt/es)', () => {
  const r = permissionLineKeys(VPN_MANIFEST.permissions);
  assert.deepStrictEqual(r.keys, ['ext.perm.proxy', 'ext.perm.privacy', 'ext.perm.cookies', 'ext.perm.management', 'ext.perm.notifications']);
  assert.deepStrictEqual(r.rest, ['storage', 'tabs', 'webRequest', 'webRequestAuthProvider']);
  assert.deepStrictEqual(permissionLineKeys(undefined), { keys: [], rest: [] });
  const main = fs.readFileSync(path.join(import.meta.dirname, '../../src/main/main.ts'), 'utf8');
  for (const k of [...r.keys, 'ext.selfUninstall.detail']) assert.strictEqual(main.split(`'${k}':`).length - 1, 3, k);
});

test('calço × main: todo evento que o main manda tem quem receba no calço', () => {
  const shim = fs.readFileSync(path.join(import.meta.dirname, '../../src/preload/extension-shim-preload.ts'), 'utf8');
  const main = fs.readFileSync(path.join(import.meta.dirname, '../../src/main/chrome-extensions.ts'), 'utf8') +
    fs.readFileSync(path.join(import.meta.dirname, '../../src/main/chrome-extension-apis.ts'), 'utf8');
  for (const name of ['tabs.onUpdated', 'tabs.onCreated', 'tabs.onRemoved', 'cookies.onChangedBatch']) {
    assert.ok(main.includes(`'${name}'`), `main: ${name}`);
    assert.ok(shim.includes(`'${name}'`), `calço: ${name}`);
  }
  // Os eventos de aba nativos são casca: o calço troca no objeto e trava (chrome e browser).
  for (const k of ['onUpdated', 'onCreated', 'onRemoved']) assert.ok(shim.includes(`patch(chrome.tabs, '${k}'`), k);
  for (const m of ['tabs.subscribe', 'cookies.subscribe']) assert.ok(shim.includes(`'${m}'`) && main.includes(`'${m}'`), m);
});

test('calço: monta TODAS as chaves de chrome.privacy que o main conhece', () => {
  const shim = fs.readFileSync(path.join(import.meta.dirname, '../../src/preload/extension-shim-preload.ts'), 'utf8');
  for (const k of PRIVACY_SETTING_KEYS) assert.ok(shim.includes(`'${k}'`), k);
});
