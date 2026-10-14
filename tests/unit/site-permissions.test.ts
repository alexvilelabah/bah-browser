// Permissões dos sites: o que libera sozinho, o que pergunta, e o que a resposta guardada vale.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  policyFor, kindsFor, storedDecision, checkAnswer, originOf, resolveRequest, schemeOf, sanitizeStore, type PermStore,
} from '../../src/main/site-permission-rules.ts';

test('policyFor: Netflix/tela cheia liberam; câmera/microfone/localização perguntam; desconhecido nega', () => {
  assert.strictEqual(policyFor('mediaKeySystem'), 'allow');   // DRM — negar quebra os streamings
  assert.strictEqual(policyFor('fullscreen'), 'allow');
  assert.strictEqual(policyFor('clipboard-sanitized-write'), 'allow');
  assert.strictEqual(policyFor('storage-access'), 'allow');
  for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal', 'midiSysex', 'display-capture']) {
    assert.strictEqual(policyFor(p), 'ask', p);
  }
  assert.strictEqual(policyFor('unknown'), 'deny');
  assert.strictEqual(policyFor('alguma-coisa-nova'), 'deny');
});

test('kindsFor: câmera e microfone separados; pedido de TELA (sem audio/video) não vira câmera', () => {
  assert.deepStrictEqual(kindsFor('media', ['audio']), ['microphone']);
  assert.deepStrictEqual(kindsFor('media', ['video']), ['camera']);
  assert.deepStrictEqual(kindsFor('media', ['video', 'audio']), ['microphone', 'camera']);
  assert.deepStrictEqual(kindsFor('media', []), []);          // chromeMediaSource:'desktop' = gravar a tela
  assert.deepStrictEqual(kindsFor('media', undefined), []);
  assert.deepStrictEqual(kindsFor('clipboard-read'), ['clipboardRead']);
  assert.deepStrictEqual(kindsFor('midiSysex'), ['midi']);
  assert.deepStrictEqual(kindsFor('unknown'), []);
});

test('storedDecision: um "bloquear" em qualquer parte bloqueia; "permitir" só se tudo foi permitido', () => {
  const store: PermStore = { 'https://meet.example': { microphone: 'allow' } };
  assert.strictEqual(storedDecision(store, 'https://meet.example', ['microphone']), 'allow');
  assert.strictEqual(storedDecision(store, 'https://meet.example', ['microphone', 'camera']), undefined);
  store['https://meet.example'].camera = 'block';
  assert.strictEqual(storedDecision(store, 'https://meet.example', ['microphone', 'camera']), 'block');
  assert.strictEqual(storedDecision(store, 'https://outro.example', ['microphone']), undefined);
});

test('resolveRequest: o site da ABA responde; tela é negada; só pergunta o que falta', () => {
  const top = 'https://meet.example/abc';
  const store: PermStore = { 'https://meet.example': { microphone: 'allow' } };
  // microfone já liberado + câmera nova → pergunta SÓ a câmera
  assert.deepStrictEqual(resolveRequest(store, 'media', { mediaTypes: ['audio', 'video'] }, top),
    { action: 'ask', origin: 'https://meet.example', kinds: ['camera'] });
  assert.deepStrictEqual(resolveRequest(store, 'media', { mediaTypes: ['audio'] }, top), { action: 'allow' });
  // gravar a tela pelo truque antigo: negado mesmo com câmera e microfone liberados
  store['https://meet.example'].camera = 'allow';
  assert.deepStrictEqual(resolveRequest(store, 'media', { mediaTypes: [] }, top), { action: 'deny' });
  // iframe (página em branco dentro de outro site) é atribuído ao site da aba
  assert.deepStrictEqual(resolveRequest({}, 'geolocation', { requestingUrl: 'about:srcdoc', isMainFrame: false }, top),
    { action: 'ask', origin: 'https://meet.example', kinds: ['geolocation'] });
  // notificação de iframe de outro site: negada (como no Chrome)
  assert.deepStrictEqual(resolveRequest({}, 'notifications', { requestingUrl: 'https://ads.example/x', isMainFrame: false }, top), { action: 'deny' });
  assert.deepStrictEqual(resolveRequest({}, 'notifications', { requestingUrl: top, isMainFrame: true }, top),
    { action: 'ask', origin: 'https://meet.example', kinds: ['notifications'] });
  // aba que não é site (nova aba, arquivo) → nega
  assert.deepStrictEqual(resolveRequest({}, 'media', { mediaTypes: ['audio'] }, 'file:///C:/x.html'), { action: 'deny' });
  // liberadas/negadas direto
  assert.deepStrictEqual(resolveRequest({}, 'mediaKeySystem', {}, top), { action: 'allow' });
  assert.deepStrictEqual(resolveRequest({}, 'unknown', {}, top), { action: 'deny' });
});

test('resolveRequest: "abrir aplicativo" pergunta toda vez, com o nome do app; os perigosos são negados', () => {
  const top = 'https://site.example/';
  assert.deepStrictEqual(resolveRequest({}, 'openExternal', { externalURL: 'zoommtg://join?x=1' }, top),
    { action: 'ask', origin: 'https://site.example', kinds: ['openExternal'], external: 'zoommtg' });
  for (const u of ['ms-msdt:/id x', 'search-ms:query=x', 'ms-officecmd:x', 'file:///C:/x', 'javascript:alert(1)', 'ms-excel:ofe|u|x', 'shell:startup']) {
    assert.deepStrictEqual(resolveRequest({}, 'openExternal', { externalURL: u }, top), { action: 'deny' }, u);
  }
  assert.deepStrictEqual(resolveRequest({}, 'openExternal', { externalURL: '' }, top), { action: 'deny' });
  assert.strictEqual(schemeOf('MAILTO:a@b.c'), 'mailto');
  assert.strictEqual(schemeOf('não é link'), '');
});

test('checkAnswer: sem resposta, câmera/microfone dizem sim (pra o site pedir); localização e notificação dizem não', () => {
  const store: PermStore = {};
  const o = 'https://site.example';
  assert.strictEqual(checkAnswer(store, o, 'media', 'audio'), true);
  assert.strictEqual(checkAnswer(store, o, 'media', 'video'), true);
  assert.strictEqual(checkAnswer(store, o, 'geolocation'), false);   // senão a página do Google pedia toda vez
  assert.strictEqual(checkAnswer(store, o, 'notifications'), false);
  assert.strictEqual(checkAnswer(store, o, 'clipboard-read'), false);
  assert.strictEqual(checkAnswer(store, o, 'fullscreen'), true);
  store[o] = { microphone: 'block', notifications: 'allow', geolocation: 'allow' };
  assert.strictEqual(checkAnswer(store, o, 'media', 'audio'), false);
  assert.strictEqual(checkAnswer(store, o, 'geolocation'), true);
  assert.strictEqual(checkAnswer(store, o, 'notifications'), true);
});

test('originOf: só sites http/https', () => {
  assert.strictEqual(originOf('https://meet.google.com/abc?x=1'), 'https://meet.google.com');
  assert.strictEqual(originOf('http://127.0.0.1:8765/perm.html'), 'http://127.0.0.1:8765');
  assert.strictEqual(originOf('file:///C:/x.html'), '');
  assert.strictEqual(originOf('about:blank'), '');
  assert.strictEqual(originOf(undefined), '');
});

test('sanitizeStore: arquivo estragado ou mexido não derruba nada', () => {
  assert.deepStrictEqual(sanitizeStore(null), {});
  assert.deepStrictEqual(sanitizeStore([1, 2]), {});
  assert.deepStrictEqual(sanitizeStore({
    'https://ok.example': { microphone: 'allow', camera: 'talvez', openExternal: 'allow', outro: 'allow' },
    'https://lista.example': ['allow'],
    'nao-e-origem': { camera: 'allow' },
    'https://vazio.example': {},
  }), { 'https://ok.example': { microphone: 'allow' } });
});
