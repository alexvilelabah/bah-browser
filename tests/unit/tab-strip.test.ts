import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripTabs, pinnedCount, groupRange, moveTab, setPinned, insertAfter,
  closeOthersIds, closeRightIds, nextActiveAfterClose, webviewOrder,
  dragTarget, dragShift, siteKey, sanitizePinned, sanitizeSites,
  MAX_SAVED_PINNED, type StripTab,
} from '../../src/shared/tab-strip.ts';

// Barra de abas estilo Chrome: ordem com a fronteira das fixadas, fechar várias, quem assume,
// ordem dos <webview>, conta do arrasto e as listas salvas.

type T = StripTab & { url?: string; title?: string; discarded?: boolean };
const tab = (id: string, extra: Partial<T> = {}): T => ({ id, ...extra });
const ids = (list: readonly StripTab[]) => list.map(t => t.id).join(' ');

// P1 P2 | A B C — com uma escondida (h, do agente) no meio da lista completa.
const base = (): T[] => [
  tab('P1', { pinned: true }), tab('P2', { pinned: true }),
  tab('A'), tab('h', { hidden: true }), tab('B'), tab('C'),
];

test('barra: só as visíveis, fixadas contadas, grupos', () => {
  const tabs = base();
  assert.equal(ids(stripTabs(tabs)), 'P1 P2 A B C');
  assert.equal(pinnedCount(tabs), 2);
  assert.deepEqual(groupRange(tabs, true), [0, 1]);
  assert.deepEqual(groupRange(tabs, false), [2, 4]);
  assert.deepEqual(groupRange([tab('A'), tab('B')], true), [0, -1]);
});

test('mover: dentro do grupo, a escondida não sai da casa dela', () => {
  const tabs = base();
  assert.equal(ids(moveTab(tabs, 'A', 4)), 'P1 P2 B h C A');
  assert.equal(ids(moveTab(tabs, 'C', 2)), 'P1 P2 C h A B');
  assert.equal(ids(moveTab(tabs, 'B', 2)), 'P1 P2 B h A C');
  assert.equal(ids(moveTab(tabs, 'P2', 0)), 'P2 P1 A h B C');
});

test('mover: não cruza a fronteira das fixadas (fica na ponta do grupo)', () => {
  const tabs = base();
  assert.equal(ids(moveTab(tabs, 'A', 0)), ids(tabs));            // já está na ponta: nada muda
  assert.equal(moveTab(tabs, 'A', 0), tabs);                       // mesma lista (React não redesenha)
  assert.equal(ids(moveTab(tabs, 'C', 0)), 'P1 P2 C h A B');      // pedida pra antes das fixadas → começo das outras
  assert.equal(ids(moveTab(tabs, 'P1', 9)), 'P2 P1 A h B C');     // fixada pedida pro fim → fim das fixadas
  assert.equal(ids(moveTab(tabs, 'P1', -5)), ids(tabs));
});

test('mover: teclado (±1) nas pontas não dá a volta; aba escondida/inexistente não mexe', () => {
  const tabs = base();
  assert.equal(moveTab(tabs, 'C', 5), tabs);
  assert.equal(moveTab(tabs, 'A', 1), tabs);
  assert.equal(moveTab(tabs, 'h', 0), tabs);
  assert.equal(moveTab(tabs, 'zzz', 0), tabs);
  assert.equal(moveTab(tabs, 'A', NaN), tabs);
  assert.equal(ids(moveTab(tabs, 'A', 3.9)), 'P1 P2 B h A C');    // índice fracionado: trunca
});

test('fixar vai pro fim das fixadas; liberar, pro começo das outras', () => {
  const tabs = base();
  const pinnedB = setPinned(tabs, 'B', true);
  assert.equal(ids(pinnedB), 'P1 P2 B h A C');
  assert.equal(pinnedB.find(t => t.id === 'B')?.pinned, true);
  const freedP1 = setPinned(tabs, 'P1', false);
  assert.equal(ids(freedP1), 'P2 P1 A h B C');
  assert.equal(freedP1.find(t => t.id === 'P1')?.pinned, false);
  assert.equal(setPinned(tabs, 'P1', true), tabs);                // já fixada
  assert.equal(setPinned(tabs, 'A', false), tabs);
  assert.equal(setPinned(tabs, 'h', true), tabs);                 // escondida não se fixa
  // fixar todas, uma a uma, mantém a ordem relativa
  let all = base();
  for (const id of ['A', 'B', 'C']) all = setPinned(all, id, true);
  assert.equal(ids(stripTabs(all)), 'P1 P2 A B C');
  assert.equal(pinnedCount(all), 5);
});

test('nova aba à direita / duplicar: logo depois, respeitando as fixadas', () => {
  const tabs = base();
  // entra antes da próxima VISÍVEL (a escondida h fica onde estava; na barra: A N B C)
  assert.equal(ids(insertAfter(tabs, 'A', tab('N'))), 'P1 P2 A h N B C');
  assert.equal(ids(stripTabs(insertAfter(tabs, 'A', tab('N')))), 'P1 P2 A N B C');
  assert.equal(ids(insertAfter(tabs, 'C', tab('N'))), 'P1 P2 A h B C N');
  // à direita de uma fixada, uma aba comum vai pro começo das outras (não entre as fixadas)
  assert.equal(ids(insertAfter(tabs, 'P1', tab('N'))), 'P1 P2 N A h B C');
  // duplicar uma fixada: a cópia é fixada e fica logo depois dela
  assert.equal(ids(insertAfter(tabs, 'P1', tab('N', { pinned: true }))), 'P1 N P2 A h B C');
  assert.equal(ids(insertAfter(tabs, 'P2', tab('N', { pinned: true }))), 'P1 P2 N A h B C');
  // âncora sumiu: fim do grupo
  assert.equal(ids(insertAfter(tabs, 'zzz', tab('N'))), 'P1 P2 A h B C N');
  assert.equal(ids(insertAfter(tabs, 'zzz', tab('N', { pinned: true }))), 'P1 P2 N A h B C');
  // só fixadas na barra
  assert.equal(ids(insertAfter([tab('P', { pinned: true })], 'P', tab('N', { pinned: true }))), 'P N');
  assert.equal(ids(insertAfter([tab('P', { pinned: true })], 'P', tab('N'))), 'P N');
});

test('fechar outras / à direita: fixadas e escondidas ficam', () => {
  const tabs = base();
  assert.deepEqual(closeOthersIds(tabs, 'B'), ['A', 'C']);
  assert.deepEqual(closeOthersIds(tabs, 'P1'), ['A', 'B', 'C']);
  assert.deepEqual(closeOthersIds([tab('A')], 'A'), []);
  assert.deepEqual(closeOthersIds(tabs, 'zzz'), []);
  assert.deepEqual(closeRightIds(tabs, 'A'), ['B', 'C']);
  assert.deepEqual(closeRightIds(tabs, 'C'), []);
  assert.deepEqual(closeRightIds(tabs, 'P1'), ['A', 'B', 'C']);   // à direita de uma fixada: só as comuns
  assert.deepEqual(closeRightIds(tabs, 'h'), []);
});

test('quem assume quando a ativa fecha: direita, senão esquerda, nunca a escondida', () => {
  const tabs = base();
  assert.equal(nextActiveAfterClose(tabs, new Set(['A']), 'A'), 'B');          // pula a escondida
  assert.equal(nextActiveAfterClose(tabs, new Set(['C']), 'C'), 'B');
  assert.equal(nextActiveAfterClose(tabs, new Set(['B']), 'A'), 'A');          // a ativa ficou
  // "Fechar outras" a partir de B com A ativa → B
  assert.equal(nextActiveAfterClose(tabs, new Set(closeOthersIds(tabs, 'B')), 'A'), 'B');
  // "Fechar à direita" de A com C ativa → A
  assert.equal(nextActiveAfterClose(tabs, new Set(closeRightIds(tabs, 'A')), 'C'), 'A');
  // ativa fixada: "Fechar outras" a partir de B não mexe nela
  assert.equal(nextActiveAfterClose(tabs, new Set(closeOthersIds(tabs, 'B')), 'P1'), 'P1');
  // sobrou só a escondida → null (abrir uma nova)
  const lonely = [tab('A'), tab('h', { hidden: true })];
  assert.equal(nextActiveAfterClose(lonely, new Set(['A']), 'A'), null);
  // ativa desconhecida → a primeira visível que sobrou
  assert.equal(nextActiveAfterClose(tabs, new Set(['P1']), 'zzz'), 'P2');
});

test('<webview>: ordem de chegada, não muda com arrasto nem com aba no meio', () => {
  const seq = new Map<string, number>();
  let tabs: T[] = [tab('A'), tab('B'), tab('C')];
  assert.equal(ids(webviewOrder(tabs, seq)), 'A B C');
  tabs = moveTab(tabs, 'A', 2);                                   // arrastou A pro fim
  assert.equal(ids(tabs), 'B C A');
  assert.equal(ids(webviewOrder(tabs, seq)), 'A B C');            // DOM igual: nada se mexe
  tabs = insertAfter(tabs, 'B', tab('N'));                        // nova aba à direita de B
  assert.equal(ids(tabs), 'B N C A');
  assert.equal(ids(webviewOrder(tabs, seq)), 'A B C N');          // a nova entra no fim do DOM
  // dormiu (Memory Saver) e acordou: volta pra casa dela, as outras não se movem
  tabs = tabs.map(t => (t.id === 'B' ? { ...t, discarded: true } : t));
  assert.equal(ids(webviewOrder(tabs, seq)), 'A C N');
  tabs = tabs.map(t => (t.id === 'B' ? { ...t, discarded: false } : t));
  assert.equal(ids(webviewOrder(tabs, seq)), 'A B C N');
  // fechou C: sai; a próxima aba nova continua indo pro fim
  tabs = tabs.filter(t => t.id !== 'C');
  assert.equal(ids(webviewOrder(tabs, seq)), 'A B N');
  assert.equal(seq.has('C'), false);
  tabs = [tab('Z'), ...tabs];
  assert.equal(ids(webviewOrder(tabs, seq)), 'A B N Z');
});

test('arrasto: troca quando a borda passa do meio da vizinha; preso ao grupo', () => {
  // três abas de 100px: 0, 100, 200
  const L = [0, 100, 200], W = [100, 100, 100];
  assert.deepEqual(dragTarget(L, W, 0, 0, 2, 0), { dx: 0, to: 0 });
  assert.deepEqual(dragTarget(L, W, 0, 0, 2, 50), { dx: 50, to: 0 });     // na metade exata: ainda não
  assert.deepEqual(dragTarget(L, W, 0, 0, 2, 51), { dx: 51, to: 1 });
  assert.deepEqual(dragTarget(L, W, 0, 0, 2, 151), { dx: 151, to: 2 });
  assert.deepEqual(dragTarget(L, W, 0, 0, 2, 999), { dx: 200, to: 2 });   // não passa da última
  assert.deepEqual(dragTarget(L, W, 2, 0, 2, -51), { dx: -51, to: 1 });
  assert.deepEqual(dragTarget(L, W, 2, 0, 2, -999), { dx: -200, to: 0 });
  assert.deepEqual(dragTarget(L, W, 1, 0, 2, 0.4), { dx: 0.4, to: 1 });
  // grupo das comuns começa na posição 1 (a 0 é fixada, 40px): não entra no lugar dela
  const L2 = [0, 40, 140], W2 = [40, 100, 100];
  assert.deepEqual(dragTarget(L2, W2, 2, 1, 2, -999), { dx: -100, to: 1 });
  // larguras diferentes: a estreita (60px) troca com meio deslocamento DELA
  const L3 = [0, 200], W3 = [200, 60];
  assert.equal(dragTarget(L3, W3, 0, 0, 1, 29).to, 0);
  assert.equal(dragTarget(L3, W3, 0, 0, 1, 31).to, 1);
  // dados ruins: fica parada
  assert.deepEqual(dragTarget(L, W, 0, 1, 2, 50), { dx: 0, to: 0 });
  assert.deepEqual(dragTarget(L, W, 0, 0, 2, NaN), { dx: 0, to: 0 });
});

test('arrasto: só as que a aba passou deslizam, uma casa (a largura dela)', () => {
  assert.equal(dragShift(1, 0, 2, 100), -100);
  assert.equal(dragShift(2, 0, 2, 100), -100);
  assert.equal(dragShift(3, 0, 2, 100), 0);
  assert.equal(dragShift(0, 0, 2, 100), 0);
  assert.equal(dragShift(1, 3, 1, 80), 80);
  assert.equal(dragShift(2, 3, 1, 80), 80);
  assert.equal(dragShift(0, 3, 1, 80), 0);
  assert.equal(dragShift(2, 2, 2, 80), 0);
});

test('site do "Desativar som do site": host sem www, só http/https', () => {
  assert.equal(siteKey('https://www.YouTube.com/watch?v=1'), 'youtube.com');
  assert.equal(siteKey('https://youtube.com/'), 'youtube.com');
  assert.equal(siteKey('https://m.youtube.com/'), 'm.youtube.com');
  assert.equal(siteKey('http://localhost:8080/x'), 'localhost');
  assert.equal(siteKey('about:blank'), null);
  assert.equal(siteKey('file:///C:/x.html'), null);
  assert.equal(siteKey('data:text/html,oi'), null);
  assert.equal(siteKey(''), null);
  assert.equal(siteKey(42), null);
  assert.equal(siteKey('não é url'), null);
});

test('fixadas salvas (lista antiga, migrada pra sessão): só http/https, nome cortado, teto', () => {
  assert.deepEqual(sanitizePinned(null), []);
  assert.deepEqual(sanitizePinned('x'), []);
  assert.deepEqual(sanitizePinned([
    { url: 'https://a.com/', title: 'A' }, { url: 'javascript:alert(1)' }, { url: 'about:blank' },
    null, 7, { url: 'http://b.com/x', title: 9 }, { url: 'https://' + 'a'.repeat(5000) + '.com' },
  ]), [{ url: 'https://a.com/', title: 'A' }, { url: 'http://b.com/x', title: '' }]);
  assert.equal(sanitizePinned([{ url: 'https://a.com/', title: 'x'.repeat(1000) }])[0].title.length, 300);
  const many = Array.from({ length: 80 }, (_, i) => ({ url: `https://s${i}.com/`, title: '' }));
  assert.equal(sanitizePinned(many).length, MAX_SAVED_PINNED);
});

test('sites mudos salvos: válidos, minúsculos, sem repetir', () => {
  assert.deepEqual(sanitizeSites(['youtube.com', 'youtube.com', 'Twitch.tv', 'www.x.com', '', 7, 'a b', 'a/b', 'm.youtube.com']), ['youtube.com', 'twitch.tv', 'm.youtube.com']);
  assert.deepEqual(sanitizeSites({}), []);
});
