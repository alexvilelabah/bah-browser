// A conversa (thread) de uma sessão: turnos, tarefas, fatos, 📌, orçamento e compactação
// (shared/thread-store.ts).
import { test } from 'node:test';
import assert from 'node:assert';
import {
  emptyThread, addTurn, addTask, setFact, pinEntry, renderThread, threadTokens, threadBudgetFor,
  budgetLevel, compactThread, clearThread, mergeThreads, sanitizeThread, foldCandidates, firstRequest,
  isEmptyThread, MAX_FACTS, MAX_USER_CHARS, KEEP_RECENT, type Thread,
} from '../../src/shared/thread-store.ts';

const filled = (n: number, len = 200): Thread => {
  let t = emptyThread('s1', 1);
  for (let i = 0; i < n; i++) {
    t = addTurn(t, 'user', `question ${i} ` + 'x'.repeat(len), 10 + i * 2);
    t = addTurn(t, 'assistant', `answer ${i} ` + 'y'.repeat(len), 11 + i * 2);
  }
  return t;
};

test('turns, tasks and facts all land in one thread, rendered newest last', () => {
  let t = emptyThread('s1', 1);
  assert.equal(renderThread(t), '');
  assert.ok(isEmptyThread(t));
  t = addTurn(t, 'user', 'find golf clubs', 2);
  t = addTask(t, { goal: 'find golf clubs', status: 'success', outcome: 'Opened 3 results', steps: ['navigate google', 'click result'], target: '"Ping G430" on golf.com' }, 3);
  t = addTurn(t, 'assistant', 'The cheapest is the Ping.', 4);
  t = setFact(t, 'signed-in:golf.com', 'signed in on golf.com', { now: 5 });
  const r = renderThread(t);
  assert.match(r, /FACTS:\n- signed in on golf.com/);
  assert.match(r, /agent task "find golf clubs" → success: Opened 3 results/);
  assert.match(r, /key steps: navigate google; click result/);
  assert.match(r, /last thing acted on: "Ping G430" on golf.com/);
  assert.ok(r.indexOf('user: "find golf clubs"') < r.indexOf('you replied: "The cheapest'));
  assert.equal(firstRequest(t), 'find golf clubs');
});

test('long turns are clipped; empty ones ignored', () => {
  let t = addTurn(emptyThread('k'), 'user', 'a'.repeat(5000));
  assert.ok((t.entries[0] as any).text.length <= MAX_USER_CHARS);
  t = addTurn(t, 'assistant', '   ');
  assert.equal(t.entries.length, 1);
});

test('facts: same key replaces, cap drops the oldest unpinned', () => {
  let t = setFact(emptyThread('k'), 'resume', 'résumé A', { pinned: true, now: 1 });
  t = setFact(t, 'resume', 'résumé B', { now: 2 });
  assert.equal(t.facts.length, 1);
  assert.equal(t.facts[0].text, 'résumé B');
  assert.equal(t.facts[0].pinned, true);   // keeps its pin
  for (let i = 0; i < MAX_FACTS + 5; i++) t = setFact(t, `job${i}`, `job ${i}`, { now: 10 + i });
  assert.equal(t.facts.length, MAX_FACTS);
  assert.ok(t.facts.some(f => f.key === 'resume'));
  assert.ok(!t.facts.some(f => f.key === 'job0'));
});

test('budget: 15% of the window, clamped; unknown window → 3000', () => {
  assert.equal(threadBudgetFor(16384), 2458);
  assert.equal(threadBudgetFor(8192), 1229);
  assert.equal(threadBudgetFor(2048), 512);
  assert.equal(threadBudgetFor(131072), 4096);
  assert.equal(threadBudgetFor(undefined), 3000);
  assert.equal(budgetLevel(79, 100), 'ok');
  assert.equal(budgetLevel(80, 100), 'warn');
  assert.equal(budgetLevel(101, 100), 'over');
});

test('compaction folds the oldest turns into a summary and fits half the budget', () => {
  const t = filled(10);
  const budget = 600;
  assert.equal(budgetLevel(threadTokens(t), budget), 'over');
  const r = compactThread(t, budget, { now: 99 });
  assert.ok(r.folded > 0);
  assert.ok(threadTokens(r.thread) <= budget, `${threadTokens(r.thread)} > ${budget}`);
  assert.equal(r.thread.folded, r.folded);
  // The exact text that replaced the turns is in the summary (the oldest lines may not fit its cap).
  assert.ok(r.added.length > 0);
  assert.ok(r.thread.summary.endsWith(r.added));
  assert.equal(r.added.split('\n').length + r.dropped, r.folded);
  const roomy = compactThread(filled(10, 300), 3000);
  assert.match(roomy.added, /^- asked: question 0/);
  assert.equal(roomy.dropped, 0);
  // The most recent turns stay word for word.
  assert.equal(r.thread.entries.slice(-KEEP_RECENT).map(e => e.id).join(), t.entries.slice(-KEEP_RECENT).map(e => e.id).join());
});

test('compaction never folds a 📌 pinned item', () => {
  let t = filled(10);
  const first = t.entries[0].id;
  t = pinEntry(t, first);
  const r = compactThread(t, 300, { force: true });
  assert.ok(r.thread.entries.some(e => e.id === first && e.pinned));
  assert.match(renderThread(r.thread), /^PINNED/);
  assert.ok(!foldCandidates(r.thread).some(e => e.id === first));
});

test('/compact (force) folds everything but the last turns; nothing to fold → no-op', () => {
  const t = filled(3, 10);
  const r = compactThread(t, 100000, { force: true });
  assert.equal(r.folded, t.entries.length - KEEP_RECENT);
  assert.equal(compactThread(r.thread, 100000, { force: true }).folded, 0);
  // Under budget without force: nothing happens.
  assert.equal(compactThread(t, 100000).folded, 0);
});

test('the running summary itself stays capped (oldest lines go, marked …)', () => {
  let t = filled(4, 50);
  for (let i = 0; i < 30; i++) {
    t = compactThread(t, 400, { force: true }).thread;
    t = addTurn(addTurn(addTurn(t, 'user', `more ${i} ` + 'z'.repeat(150)), 'assistant', 'ok'), 'user', 'next');
  }
  assert.ok(t.summary.length <= 400 * 0.35 * 4 + 200);
  assert.ok(t.summary.startsWith('…'));
});

test('clear keeps only pinned items and reports what went', () => {
  let t = filled(2, 5);
  t = pinEntry(t, t.entries[1].id);
  t = setFact(t, 'a', 'fact a');
  const r = clearThread(t);
  assert.equal(r.thread.entries.length, 1);
  assert.equal(r.thread.facts.length, 0);
  assert.equal(r.removed, 4);
  assert.match(r.text, /asked: question 0/);
});

test('merge: entries by time, facts joined', () => {
  let a = addTurn(emptyThread('a'), 'user', 'first', 1);
  a = addTurn(a, 'user', 'third', 3);
  let b = addTurn(emptyThread('b'), 'user', 'second', 2);
  b = setFact(b, 'x', 'fact x');
  const m = mergeThreads(a, b);
  assert.equal(m.key, 'a');
  assert.deepEqual(m.entries.map(e => (e as any).text), ['first', 'second', 'third']);
  assert.equal(m.facts.length, 1);
});

test('sanitize: junk from disk is dropped, good entries kept', () => {
  assert.equal(sanitizeThread(null), null);
  assert.equal(sanitizeThread({ entries: [] }), null);   // no key
  const t = sanitizeThread({ key: 'k', summary: 7, entries: [{ kind: 'user', text: 'hi', at: 1 }, { kind: 'evil', text: 'x' }, { kind: 'task', goal: '' }, { kind: 'task', goal: 'g', steps: [1, 'a'] }], facts: [{ key: 'a', text: 'b', pinned: true }, { key: 1 }] });
  assert.ok(t);
  assert.equal(t!.entries.length, 2);
  assert.equal(t!.summary, '');
  assert.deepEqual((t!.entries[1] as any).steps, ['a']);
  assert.equal(t!.facts.length, 1);
});
