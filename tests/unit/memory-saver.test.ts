import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVEL_IDLE_MS, idleMsFor, sanitizeLevel, parseKeepEntry, normalizeKeepEntry, sanitizeKeepList,
  matchesKeepList, keepEntryForUrl, cheapKeepReason, signalKeepReason, keepReason, isShownReason,
  PAGE_SIGNALS_SCRIPT, type SweepCtx, type SweepTab,
} from '../../src/shared/memory-saver.ts';

// Economia de memória: níveis, o que nunca dorme e a lista "Manter estes sites sempre ativos"
// com as regras do Chrome.

const MIN = 60_000;
const NOW = 10_000_000_000;
const ctx = (over: Partial<SweepCtx> = {}): SweepCtx => ({ now: NOW, idleMs: 30 * MIN, activeId: 'active', keepList: [], ...over });
const idle = (over: Partial<SweepTab> = {}): SweepTab => ({ id: 't1', url: 'https://news.example.com/a', lastActiveAt: NOW - 31 * MIN, ...over });

test('níveis: Moderada 2 h, Equilibrada 30 min, Máxima 10 min; override dos testes vence', () => {
  assert.equal(LEVEL_IDLE_MS.moderate, 120 * MIN);
  assert.equal(LEVEL_IDLE_MS.balanced, 30 * MIN);
  assert.equal(LEVEL_IDLE_MS.maximum, 10 * MIN);
  assert.ok(LEVEL_IDLE_MS.moderate > LEVEL_IDLE_MS.balanced && LEVEL_IDLE_MS.balanced > LEVEL_IDLE_MS.maximum);
  assert.equal(idleMsFor('maximum'), 10 * MIN);
  assert.equal(idleMsFor('moderate', 5000), 5000);
  assert.equal(idleMsFor('balanced', 0), 30 * MIN);
  assert.equal(sanitizeLevel('maximum'), 'maximum');
  assert.equal(sanitizeLevel('turbo'), 'balanced');
  assert.equal(sanitizeLevel(null), 'balanced');
});

test('o nível decide quando a aba parada vira candidata', () => {
  const tab = idle({ lastActiveAt: NOW - 15 * MIN });
  assert.equal(cheapKeepReason(tab, ctx({ idleMs: idleMsFor('maximum') })), null);
  assert.equal(cheapKeepReason(tab, ctx({ idleMs: idleMsFor('balanced') })), 'recent');
  assert.equal(cheapKeepReason(tab, ctx({ idleMs: idleMsFor('moderate') })), 'recent');
  assert.equal(cheapKeepReason(idle({ lastActiveAt: NOW - 121 * MIN }), ctx({ idleMs: idleMsFor('moderate') })), null);
  // Sem lastActiveAt conta como "agora" (nunca dorme de cara).
  assert.equal(cheapKeepReason(idle({ lastActiveAt: undefined }), ctx()), 'recent');
});

test('regras baratas: ativa, já dormindo, anônima/escondida, fixada, sessão do agente, lista', () => {
  assert.equal(cheapKeepReason(idle(), ctx()), null);
  assert.equal(cheapKeepReason(idle({ id: 'active' }), ctx()), 'active');
  assert.equal(cheapKeepReason(idle({ discarded: true }), ctx()), 'discarded');
  assert.equal(cheapKeepReason(idle({ incognito: true }), ctx()), 'private');
  assert.equal(cheapKeepReason(idle({ hidden: true }), ctx()), 'private');
  assert.equal(cheapKeepReason(idle({ pinned: true }), ctx()), 'pinned');
  assert.equal(cheapKeepReason(idle(), ctx({ agentBusy: true })), 'agent');
  assert.equal(cheapKeepReason(idle(), ctx({ keepList: ['example.com'] })), 'keepSite');
  assert.equal(cheapKeepReason(idle(), ctx({ keepList: ['other.com'] })), null);
});

test('sinais: cada proteção do Chrome segura a aba', () => {
  assert.equal(signalKeepReason(null), null);
  assert.equal(signalKeepReason({}), null);
  assert.equal(signalKeepReason({ audible: true }), 'media');
  assert.equal(signalKeepReason({ playingMedia: true }), 'media');   // <video> tocando mudo
  assert.equal(signalKeepReason({ capture: true }), 'capture');
  assert.equal(signalKeepReason({ notifications: true }), 'notifications');
  assert.equal(signalKeepReason({ download: true }), 'download');
  assert.equal(signalKeepReason({ formDirty: true }), 'form');
  assert.equal(signalKeepReason({ device: true }), 'device');
  assert.equal(signalKeepReason({ audible: false, formDirty: false, download: false }), null);
});

test('decisão completa: barato primeiro, depois os sinais', () => {
  assert.equal(keepReason(idle(), ctx(), {}), null);
  assert.equal(keepReason(idle(), ctx(), { formDirty: true }), 'form');
  assert.equal(keepReason(idle({ pinned: true }), ctx(), { formDirty: true }), 'pinned');
  assert.equal(keepReason(idle(), ctx()), null);
  assert.equal(isShownReason('form'), true);
  assert.equal(isShownReason('agent'), true);
  assert.equal(isShownReason('recent'), false);
  assert.equal(isShownReason('active'), false);
  assert.equal(isShownReason(null), false);
});

test('lista: "google.com" vale pro domínio e subdomínios', () => {
  const l = ['google.com'];
  assert.equal(matchesKeepList('https://google.com/', l), true);
  assert.equal(matchesKeepList('https://mail.google.com/inbox', l), true);
  assert.equal(matchesKeepList('http://a.b.google.com', l), true);
  assert.equal(matchesKeepList('https://notgoogle.com/', l), false);
  assert.equal(matchesKeepList('https://google.com.evil.net/', l), false);
});

test('lista: ".google.com" só o domínio exato', () => {
  const l = ['.google.com'];
  assert.equal(matchesKeepList('https://google.com/x', l), true);
  assert.equal(matchesKeepList('https://mail.google.com/', l), false);
});

test('lista: curingas "[*.]" e "*." são o mesmo que sem nada', () => {
  for (const e of ['[*.]google.com', '*.google.com']) {
    assert.equal(matchesKeepList('https://google.com', [e]), true);
    assert.equal(matchesKeepList('https://docs.google.com', [e]), true);
  }
  assert.equal(normalizeKeepEntry('*.Google.com'), 'google.com');
});

test('lista: domínio com caminho casa no começo, em fronteira de segmento', () => {
  const l = ['example.com/app'];
  assert.equal(matchesKeepList('https://example.com/app', l), true);
  assert.equal(matchesKeepList('https://example.com/app/inbox?x=1', l), true);
  assert.equal(matchesKeepList('https://www.example.com/app/', l), true);
  assert.equal(matchesKeepList('https://example.com/apple', l), false);
  assert.equal(matchesKeepList('https://example.com/', l), false);
});

test('lista: esquema e porta escritos precisam bater; página que não é site nunca casa', () => {
  assert.equal(matchesKeepList('https://example.com', ['https://example.com']), true);
  assert.equal(matchesKeepList('http://example.com', ['https://example.com']), false);
  assert.equal(matchesKeepList('http://127.0.0.1:8080/', ['127.0.0.1:8080']), true);
  assert.equal(matchesKeepList('http://127.0.0.1:9090/', ['127.0.0.1:8080']), false);
  assert.equal(matchesKeepList('http://127.0.0.1:9090/', ['127.0.0.1']), true);
  assert.equal(matchesKeepList('file:///C:/x.html', ['example.com']), false);
  assert.equal(matchesKeepList('bah://newtab', ['newtab']), false);
  assert.equal(matchesKeepList('not a url', ['example.com']), false);
});

test('entrada: normaliza, recusa lixo e converte IDN', () => {
  assert.equal(normalizeKeepEntry('  Example.COM/App/  '), 'example.com/app');
  assert.equal(normalizeKeepEntry('HTTPS://Example.com'), 'https://example.com');
  assert.equal(normalizeKeepEntry('.example.com'), '.example.com');
  assert.equal(normalizeKeepEntry('example.com/a?q=1#x'), 'example.com/a');
  assert.equal(normalizeKeepEntry(''), null);
  assert.equal(normalizeKeepEntry('ex ample.com'), null);
  assert.equal(normalizeKeepEntry('ftp://example.com'), null);
  assert.equal(normalizeKeepEntry('exa*mple.com'), null);
  assert.equal(normalizeKeepEntry('-bad.com'), null);
  assert.equal(normalizeKeepEntry('a..b'), null);
  assert.equal(normalizeKeepEntry('münchen.de'), 'xn--mnchen-3ya.de');
  assert.equal(matchesKeepList('https://www.xn--mnchen-3ya.de/', ['münchen.de']), true);
  assert.deepEqual(parseKeepEntry('.a.com:81/x'), { scheme: undefined, host: 'a.com', exact: true, port: '81', path: '/x' });
});

test('lista guardada: limpa, sem repetição, só texto válido', () => {
  assert.deepEqual(sanitizeKeepList(['Google.com', 'google.com', 42, '', 'bad site', '.x.org']), ['google.com', '.x.org']);
  assert.deepEqual(sanitizeKeepList('google.com'), []);
  assert.deepEqual(sanitizeKeepList(null), []);
  assert.equal(sanitizeKeepList(Array.from({ length: 300 }, (_, i) => `s${i}.com`)).length, 200);
});

test('"Adicionar este site": o host da aba; página que não é site não oferece', () => {
  assert.equal(keepEntryForUrl('https://Mail.Google.com/mail/u/0'), 'mail.google.com');
  assert.equal(keepEntryForUrl('http://127.0.0.1:3000/x'), '127.0.0.1');
  assert.equal(keepEntryForUrl('bah://newtab'), null);
  assert.equal(keepEntryForUrl('about:blank'), null);
  assert.equal(keepEntryForUrl(''), null);
});

test('script da página: é uma expressão que devolve promessa (executeJavaScript aguarda)', () => {
  assert.match(PAGE_SIGNALS_SCRIPT, /^\(async \(\) => \{/);
  assert.match(PAGE_SIGNALS_SCRIPT, /\}\)\(\)$/);
  // Compila (sem rodar: não há DOM aqui).
  assert.doesNotThrow(() => new Function(`return ${PAGE_SIGNALS_SCRIPT.replace(/\)\(\)$/, ')')}`));
  for (const k of ['defaultValue', 'defaultChecked', 'defaultSelected', "hidden: 1", "search: 1"]) assert.ok(PAGE_SIGNALS_SCRIPT.includes(k), k);
});

// Roda o script com um DOM de mentira: só o que ele lê (querySelectorAll + campos dos elementos).
const runPage = (els: any[], media: any[] = [], nav: any = {}) => {
  const doc = { querySelectorAll: (sel: string) => (sel.includes('video') ? media : els) };
  return new Function('document', 'navigator', `return ${PAGE_SIGNALS_SCRIPT}`)(doc, nav) as Promise<any>;
};
const input = (type: string, value: string, defaultValue: string, extra: any = {}) => ({ tagName: 'INPUT', type, value, defaultValue, ...extra });

test('script da página: formulário pela metade (e o que NÃO conta)', async () => {
  assert.equal((await runPage([input('text', '', '')])).formDirty, false);
  assert.equal((await runPage([input('text', 'Pat', '')])).formDirty, true);
  assert.equal((await runPage([input('text', 'Pat', 'Pat')])).formDirty, false);   // veio preenchido do site
  assert.equal((await runPage([input('hidden', 'tok', '')])).formDirty, false);
  assert.equal((await runPage([input('search', 'shoes', '')])).formDirty, false);
  assert.equal((await runPage([input('text', 'x', '', { disabled: true })])).formDirty, false);
  assert.equal((await runPage([input('checkbox', 'on', 'on', { checked: true, defaultChecked: false })])).formDirty, true);
  assert.equal((await runPage([input('radio', 'a', 'a', { checked: true, defaultChecked: true })])).formDirty, false);
  assert.equal((await runPage([{ tagName: 'TEXTAREA', value: 'hello', defaultValue: '' }])).formDirty, true);
  const opt = (selected: boolean, defaultSelected: boolean) => ({ selected, defaultSelected });
  // <select> sem "selected" no HTML: o padrão é a 1ª opção.
  assert.equal((await runPage([{ tagName: 'SELECT', options: [opt(true, false), opt(false, false)], selectedIndex: 0 }])).formDirty, false);
  assert.equal((await runPage([{ tagName: 'SELECT', options: [opt(false, false), opt(true, false)], selectedIndex: 1 }])).formDirty, true);
  assert.equal((await runPage([{ tagName: 'SELECT', options: [opt(false, true), opt(true, false)], selectedIndex: 1 }])).formDirty, true);
});

test('script da página: vídeo tocando (mesmo mudo), câmera ao vivo, dispositivo aberto', async () => {
  assert.equal((await runPage([], [{ paused: false, ended: false, readyState: 4, muted: true }])).playingMedia, true);
  assert.equal((await runPage([], [{ paused: true, ended: false, readyState: 4 }])).playingMedia, false);
  const live = { getTracks: () => [{ readyState: 'live' }] };
  assert.equal((await runPage([], [{ paused: true, readyState: 0, srcObject: live }])).capture, true);
  assert.equal((await runPage([], [], { hid: { getDevices: async () => [{ opened: true }] } })).device, true);
  assert.equal((await runPage([], [], { hid: { getDevices: async () => [{ opened: false }] } })).device, false);
  assert.equal((await runPage([], [], { serial: { getPorts: async () => [{ readable: {} }] } })).device, true);
  assert.equal((await runPage([], [], { bluetooth: { getDevices: async () => [{ gatt: { connected: true } }] } })).device, true);
});
