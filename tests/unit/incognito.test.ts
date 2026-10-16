import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_PARTITION, INCOGNITO_PARTITION, partitionFor, isInMemoryPartition, incognitoCount,
  lastIncognitoClosed, opensIncognito, mayRecord, canDiscard, isIncognitoBlank,
  type TraceStore, type TabSource,
} from '../../src/shared/incognito.ts';
import { sessionToSave, type SessionSource } from '../../src/shared/session-restore.ts';
import { incognitoStore, resolveRequest, checkAnswer, type PermStore } from '../../src/main/site-permission-rules.ts';

// Aba anônima: a sessão só na memória, quando zerar, de onde nasce aba anônima, o que não guarda
// nada vindo dela, Memory Saver, "Continuar de onde parou" e as permissões dos sites.

test('partição: anônima mora só na memória (sem "persist:"), a normal fica em disco', () => {
  assert.equal(partitionFor(false), BROWSER_PARTITION);
  assert.equal(partitionFor(undefined), BROWSER_PARTITION);
  assert.equal(partitionFor(true), INCOGNITO_PARTITION);
  assert.equal(isInMemoryPartition(INCOGNITO_PARTITION), true);
  assert.equal(isInMemoryPartition(BROWSER_PARTITION), false);
  assert.equal(isInMemoryPartition('Persist:x'), false);
  assert.notEqual(INCOGNITO_PARTITION, BROWSER_PARTITION);
});

test('zerar a sessão: só quando a ÚLTIMA aba anônima fecha (as escondidas contam)', () => {
  const tabs = [{ incognito: true }, {}, { incognito: true }, { incognito: false }];
  assert.equal(incognitoCount(tabs), 2);
  assert.equal(incognitoCount([]), 0);
  assert.equal(lastIncognitoClosed(2, 0), true);
  assert.equal(lastIncognitoClosed(1, 0), true);
  assert.equal(lastIncognitoClosed(2, 1), false);   // ainda sobrou uma (a da IA, escondida, também segura)
  assert.equal(lastIncognitoClosed(0, 0), false);   // nunca teve: nada a zerar
  assert.equal(lastIncognitoClosed(0, 1), false);   // abriu a primeira
});

test('de onde nasce aba anônima: Ctrl+Shift+N sempre; o que sai de uma aba herda; o resto é normal', () => {
  const cases: Array<[TabSource, boolean, boolean]> = [
    ['incognito', false, true], ['incognito', true, true],
    ['from-tab', true, true], ['from-tab', false, false],
    ['new-tab', true, false],      // Ctrl+T / "+" com a anônima na frente: aba normal
    ['extension', true, false],    // extensão não roda em aba anônima
    ['monitor', true, false], ['restore', true, false],
  ];
  for (const [src, opener, want] of cases) assert.equal(opensIncognito(src, opener), want, `${src}/${opener}`);
  assert.equal(opensIncognito('from-tab'), false);
});

test('nada que vem de aba anônima é guardado — menos downloads e favoritos (igual ao Chrome)', () => {
  const skip: TraceStore[] = ['history', 'session', 'closedTabs', 'favicons', 'siteKnowledge', 'macro',
    'agentRuns', 'agentLog', 'resultPages', 'sitePermissions', 'siteMute'];
  for (const s of skip) {
    assert.equal(mayRecord(s, true), false, s);
    assert.equal(mayRecord(s, false), true, s);
    assert.equal(mayRecord(s, undefined), true, s);
  }
  for (const s of ['downloads', 'favorites'] as TraceStore[]) {
    assert.equal(mayRecord(s, true), true, s);
    assert.equal(mayRecord(s, false), true, s);
  }
});

test('Memory Saver: aba anônima (e a escondida da IA) nunca dorme', () => {
  assert.equal(canDiscard({}), true);
  assert.equal(canDiscard({ incognito: false }), true);
  assert.equal(canDiscard({ incognito: true }), false);
  assert.equal(canDiscard({ hidden: true }), false);
});

test('página de explicação: só enquanto a aba anônima não abriu nada', () => {
  for (const u of ['', 'about:blank', undefined, null]) assert.equal(isIncognitoBlank(u), true, String(u));
  for (const u of ['https://a.com/', 'about:blank#x', 'data:text/html,x']) assert.equal(isIncognitoBlank(u), false, u);
});

test('Continuar de onde parou: aba anônima nunca vai pro disco; se ela é a ativa, assume a vizinha', () => {
  const tab = (id: string, url: string, extra: Partial<SessionSource> = {}): SessionSource => ({ id, url, title: id, ...extra });
  const tabs = [
    tab('a', 'https://a.com/'),
    tab('x', 'https://segredo.com/', { incognito: true }),
    tab('b', 'https://b.com/'),
    tab('y', 'https://outro-segredo.com/', { incognito: true, pinned: true }),
  ];
  const s = sessionToSave(tabs, 'x');
  assert.deepEqual(s.tabs.map(t => t.url), ['https://a.com/', 'https://b.com/']);
  assert.equal(s.active, 1);   // a da direita da anônima ativa (b)
  assert.ok(!JSON.stringify(s).includes('segredo'));
  // Só anônimas abertas: nada salvo.
  assert.deepEqual(sessionToSave([tab('x', 'https://segredo.com/', { incognito: true })], 'x'), { tabs: [], active: -1 });
  // A ativa normal continua a ativa.
  assert.equal(sessionToSave(tabs, 'b').active, 1);
});

test('permissões na aba anônima: só os "Bloquear" do perfil valem; "Permitir" pergunta de novo', () => {
  const store: PermStore = {
    'https://meet.com': { camera: 'allow', microphone: 'allow' },
    'https://chato.com': { notifications: 'block', geolocation: 'allow' },
  };
  const priv = incognitoStore(store);
  assert.deepEqual(priv, { 'https://chato.com': { notifications: 'block' } });
  assert.deepEqual(store['https://meet.com'], { camera: 'allow', microphone: 'allow' });   // o original fica intacto
  // Câmera liberada no perfil normal: na anônima, pergunta.
  const r = resolveRequest(priv, 'media', { mediaTypes: ['video'] }, 'https://meet.com/sala');
  assert.equal(r.action, 'ask');
  assert.equal(resolveRequest(store, 'media', { mediaTypes: ['video'] }, 'https://meet.com/sala').action, 'allow');
  // Notificação bloqueada no perfil: continua bloqueada na anônima.
  assert.equal(resolveRequest(priv, 'notifications', { isMainFrame: true }, 'https://chato.com/').action, 'deny');
  assert.equal(checkAnswer(priv, 'https://chato.com', 'notifications'), false);
  // Localização liberada no perfil: na anônima não está liberada (a checagem diz não, o pedido pergunta).
  assert.equal(checkAnswer(priv, 'https://chato.com', 'geolocation'), false);
  assert.equal(resolveRequest(priv, 'geolocation', {}, 'https://chato.com/').action, 'ask');
  assert.deepEqual(incognitoStore({}), {});
});
