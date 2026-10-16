import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStartupMode, restorableUrl, sessionToSave, sanitizeSession, serializeSession,
  loadSession, bootPlan, sessionTitle, sessionShape,
  DEFAULT_STARTUP_MODE, MAX_SESSION_TABS, MAX_SESSION_TITLE, MAX_SESSION_URL,
  type SessionSource, type SavedSession,
} from '../../src/shared/session-restore.ts';

// Continuar de onde parou (⋮ → Ao abrir o Bah): o que salvar, qual fica ativa depois de filtrar,
// ler o que veio do disco, migrar a lista antiga das fixadas e o que abrir no boot.

const tab = (id: string, url: string, extra: Partial<SessionSource> = {}): SessionSource => ({ id, url, title: id.toUpperCase(), ...extra });
const urls = (s: SavedSession) => s.tabs.map(t => t.url.replace(/^https:\/\//, '').replace(/\/$/, '')).join(' ');

test('escolha: só "restore" liga; o resto (nada salvo, lixo) é abrir aba nova', () => {
  assert.equal(DEFAULT_STARTUP_MODE, 'newtab');
  assert.equal(normalizeStartupMode('restore'), 'restore');
  assert.equal(normalizeStartupMode('newtab'), 'newtab');
  for (const raw of [null, undefined, '', 'RESTORE', 1, {}, 'continue']) assert.equal(normalizeStartupMode(raw), 'newtab');
});

test('endereços que voltam: só http/https de verdade', () => {
  for (const u of ['https://a.com/', 'http://b.com/x?y=1#z', 'http://localhost:3000/', 'https://www.google.com.br/webhp?hl=pt-BR']) {
    assert.equal(restorableUrl(u), true, u);
  }
  for (const u of [
    'about:blank', 'data:text/html,oi', 'file:///C:/Users/x/AppData/Roaming/bah/views/view-1.html',
    'chrome://settings', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html', 'javascript:alert(1)',
    'view-source:https://a.com/', 'blob:https://a.com/1-2', 'devtools://devtools/bundled/inspector.html',
    'https://user:senha@a.com/', 'http://127.0.0.1:51234/webtorrent/abc/filme.mp4', 'http://localhost:9/webtorrent/x',
    '', 'não é url', 42, null, 'https://a.com/' + 'x'.repeat(MAX_SESSION_URL),
  ]) assert.equal(restorableUrl(u), false, String(u));
});

test('salvar: abas da barra na ordem, sem as escondidas do agente, nome cortado', () => {
  const s = sessionToSave([
    tab('p', 'https://p.com/', { pinned: true }),
    tab('a', 'https://a.com/'),
    tab('h', 'https://google.com/search?q=x', { hidden: true }),   // Pesquisa Rápida
    tab('b', 'https://b.com/', { title: 'x'.repeat(1000) }),
    tab('c', 'https://c.com/', { title: undefined }),
  ], 'a');
  assert.equal(urls(s), 'p.com a.com b.com c.com');
  assert.deepEqual(s.tabs[0], { url: 'https://p.com/', title: 'P', pinned: true });
  assert.deepEqual(s.tabs[1], { url: 'https://a.com/', title: 'A' });   // sem "pinned: false" no disco
  assert.equal(s.tabs[2].title.length, MAX_SESSION_TITLE);
  assert.equal(s.tabs[3].title, '');
  assert.equal(s.active, 1);
});

test('ativa depois de filtrar: a própria, senão a vizinha da direita, senão a da esquerda', () => {
  const strip = [
    tab('a', 'https://a.com/'), tab('x', 'about:blank'), tab('b', 'https://b.com/'),
    tab('f', 'file:///C:/t.html'), tab('c', 'https://c.com/'), tab('d', 'data:text/html,1'),
  ];
  assert.equal(sessionToSave(strip, 'b').active, 1);    // ela mesma (a, b, c)
  assert.equal(sessionToSave(strip, 'x').active, 1);    // about:blank não volta → a da direita (b)
  assert.equal(sessionToSave(strip, 'f').active, 2);    // file: → c
  assert.equal(sessionToSave(strip, 'd').active, 2);    // a última e não volta → a da esquerda (c)
  assert.equal(sessionToSave(strip, 'sumiu').active, 2);   // não se sabe qual → a última
  // A "ativa" seria uma escondida (não está na barra) → a última da barra.
  assert.equal(sessionToSave([tab('a', 'https://a.com/'), tab('h', 'https://h.com/', { hidden: true }), tab('b', 'https://b.com/')], 'h').active, 1);
  // Nada volta → sessão vazia (no boot: o de sempre).
  assert.deepEqual(sessionToSave([tab('x', 'about:blank'), tab('h', 'https://h.com/', { hidden: true })], 'x'), { tabs: [], active: -1 });
});

test('teto de abas: as primeiras da barra, e a ativa entra mesmo se passou', () => {
  const many = Array.from({ length: 150 }, (_, i) => tab(`t${i}`, `https://s${i}.com/`));
  const early = sessionToSave(many, 't10');
  assert.equal(early.tabs.length, MAX_SESSION_TABS);
  assert.equal(early.active, 10);
  assert.equal(early.tabs[10].url, 'https://s10.com/');
  const late = sessionToSave(many, 't140');
  assert.equal(late.tabs.length, MAX_SESSION_TABS);
  assert.equal(late.active, MAX_SESSION_TABS - 1);
  assert.equal(late.tabs[late.active].url, 'https://s140.com/');
  assert.equal(late.tabs[MAX_SESSION_TABS - 2].url, `https://s${MAX_SESSION_TABS - 2}.com/`);
});

test('disco: estragado → null; o que presta fica, fixadas primeiro, ativa remapeada', () => {
  for (const raw of [null, undefined, 'x', 7, [], {}, { tabs: 'x' }, { tabs: {} }]) assert.equal(sanitizeSession(raw), null, JSON.stringify(raw));
  assert.deepEqual(sanitizeSession({ tabs: [] }), { tabs: [], active: -1 });
  const s = sanitizeSession({
    v: 1, active: 3,
    tabs: [
      { url: 'https://a.com/', title: 'A' },
      null, 'https://lixo.com/', { url: 'javascript:alert(1)', title: 'mau' },
      { url: 'https://b.com/', title: 9 },
      { url: 'https://p.com/', title: 'P', pinned: true },   // fixada fora do lugar (editado à mão)
      { url: 'https://q.com/', pinned: 'sim' },               // "pinned" que não é true = não fixada
    ],
  })!;
  assert.equal(urls(s), 'p.com a.com b.com q.com');
  assert.deepEqual(s.tabs[0], { url: 'https://p.com/', title: 'P', pinned: true });
  assert.equal(s.tabs[2].title, '');
  assert.equal(s.tabs[3].pinned, undefined);
  assert.equal(s.active, 2);   // a ativa (posição 3, javascript:) não volta → a da direita (b.com)
  // Ativa fora da lista / estranha → a última.
  assert.equal(sanitizeSession({ active: 99, tabs: [{ url: 'https://a.com/' }, { url: 'https://b.com/' }] })!.active, 1);
  assert.equal(sanitizeSession({ active: -5, tabs: [{ url: 'https://a.com/' }, { url: 'https://b.com/' }] })!.active, 1);
  assert.equal(sanitizeSession({ active: 0.5, tabs: [{ url: 'https://a.com/' }, { url: 'https://b.com/' }] })!.active, 1);
  // Lista enorme no disco: teto também.
  const huge = sanitizeSession({ active: 0, tabs: Array.from({ length: 5000 }, (_, i) => ({ url: `https://s${i}.com/` })) })!;
  assert.equal(huge.tabs.length, MAX_SESSION_TABS);
});

test('gravar e ler de volta dá a mesma sessão', () => {
  const s = sessionToSave([
    tab('p', 'https://p.com/', { pinned: true }), tab('a', 'https://a.com/x?q=ç&y=1#frag', { title: 'Título "com" aspas' }),
  ], 'a');
  const json = serializeSession(s);
  assert.equal(JSON.parse(json).v, 1);
  assert.deepEqual(sanitizeSession(JSON.parse(json)), s);
  assert.deepEqual(loadSession(json, null), s);
});

test('migração: a lista antiga das fixadas vira sessão uma vez; sessão válida ganha (sem duplicar)', () => {
  const old = JSON.stringify([{ url: 'https://p1.com/', title: 'P1' }, { url: 'about:blank' }, { url: 'https://p2.com/', title: 'P2' }]);
  const migrated = loadSession(null, old)!;
  assert.equal(urls(migrated), 'p1.com p2.com');
  assert.ok(migrated.tabs.every(t => t.pinned === true));
  assert.equal(migrated.active, 1);
  // Sessão gravada (com as fixadas dentro) + lista antiga ainda lá: só a sessão.
  const session = serializeSession({ tabs: [{ url: 'https://p1.com/', title: 'P1', pinned: true }, { url: 'https://a.com/', title: 'A' }], active: 1 });
  assert.equal(urls(loadSession(session, old)!), 'p1.com a.com');
  // Sessão válida mas vazia também ganha da lista antiga.
  assert.deepEqual(loadSession(serializeSession({ tabs: [], active: -1 }), old), { tabs: [], active: -1 });
  // Sessão estragada → a lista antiga.
  assert.equal(urls(loadSession('{quebrado', old)!), 'p1.com p2.com');
  assert.equal(urls(loadSession('"texto"', old)!), 'p1.com p2.com');
  // Nada aproveitável → null.
  assert.equal(loadSession(null, null), null);
  assert.equal(loadSession('', ''), null);
  assert.equal(loadSession('{quebrado', '[{"url":"about:blank"}]'), null);
  assert.equal(loadSession(null, 'lixo'), null);
});

test('boot com "Continuar de onde parou": as abas salvas, só a ativa carrega, sem aba nova', () => {
  const saved: SavedSession = {
    tabs: [{ url: 'https://p.com/', title: 'P', pinned: true }, { url: 'https://a.com/', title: 'A' }, { url: 'https://b.com/', title: 'B' }],
    active: 1,
  };
  const plan = bootPlan('restore', saved);
  assert.equal(plan.newTab, false);
  assert.deepEqual(plan.tabs.map(t => [t.url, t.active, t.lazy]), [
    ['https://p.com/', false, true], ['https://a.com/', true, false], ['https://b.com/', false, true],
  ]);
  assert.equal(plan.tabs.filter(t => t.active).length, 1);
  assert.equal(plan.tabs[0].pinned, true);
  // Só fixadas salvas: voltam elas (a ativa carrega), sem aba nova.
  const onlyPinned = bootPlan('restore', { tabs: [{ url: 'https://p.com/', title: 'P', pinned: true }], active: 0 });
  assert.equal(onlyPinned.newTab, false);
  assert.deepEqual(onlyPinned.tabs.map(t => [t.active, t.lazy]), [[true, false]]);
  // Ativa estranha → a última.
  assert.equal(bootPlan('restore', { ...saved, active: 9 }).tabs[2].active, true);
  assert.equal(bootPlan('restore', { ...saved, active: -1 }).tabs[2].active, true);
});

test('boot no de sempre: as fixadas (carregam já) + a aba nova; sessão vazia/estragada idem', () => {
  const saved: SavedSession = {
    tabs: [{ url: 'https://p.com/', title: 'P', pinned: true }, { url: 'https://a.com/', title: 'A' }],
    active: 1,
  };
  const plan = bootPlan('newtab', saved);
  assert.equal(plan.newTab, true);
  assert.deepEqual(plan.tabs.map(t => [t.url, t.active, t.lazy]), [['https://p.com/', false, false]]);
  for (const s of [null, { tabs: [], active: -1 }]) {
    assert.deepEqual(bootPlan('restore', s), { tabs: [], newTab: true });
    assert.deepEqual(bootPlan('newtab', s), { tabs: [], newTab: true });
  }
});

test('nome antes de carregar: o salvo; sem nome, o site', () => {
  assert.equal(sessionTitle({ url: 'https://www.youtube.com/watch?v=1', title: 'Vídeo' }), 'Vídeo');
  assert.equal(sessionTitle({ url: 'https://www.youtube.com/watch?v=1', title: '   ' }), 'youtube.com');
  assert.equal(sessionTitle({ url: 'https://m.site.com.br/', title: '' }), 'm.site.com.br');
});

test('esqueleto: muda com endereço, fixada, ordem e ativa — não com o nome', () => {
  const base: SavedSession = { tabs: [{ url: 'https://a.com/', title: 'A' }, { url: 'https://b.com/', title: 'B' }], active: 0 };
  const shape = sessionShape(base);
  assert.equal(sessionShape({ ...base, tabs: [{ url: 'https://a.com/', title: '(3) A' }, base.tabs[1]] }), shape);
  assert.notEqual(sessionShape({ ...base, active: 1 }), shape);
  assert.notEqual(sessionShape({ ...base, tabs: [base.tabs[1], base.tabs[0]] }), shape);
  assert.notEqual(sessionShape({ ...base, tabs: [{ ...base.tabs[0], pinned: true }, base.tabs[1]] }), shape);
  assert.notEqual(sessionShape({ ...base, tabs: [{ url: 'https://a.com/x', title: 'A' }, base.tabs[1]] }), shape);
});
