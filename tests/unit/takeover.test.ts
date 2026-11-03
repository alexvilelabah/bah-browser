// Watch/Takeover (shared/takeover.ts): AGENT → HANDOFF → TAKEOVER → AGENT, cada transição, mais a trava
// que recusa ação do agente numa página de checagem humana.
import { test } from 'node:test';
import assert from 'node:assert';
import { takeoverReducer as R, initialTakeover, agentMayAct, waitingItems, guardAgentAction, TAKEOVER_TIMEOUT_MS, TAKEOVER_POLL_MS, type TakeoverState } from '../../src/shared/takeover.ts';

const T = 1_000_000;
const one = (o: Partial<{ unattended: boolean }> = {}): TakeoverState => R(initialTakeover(), { type: 'detected', kind: 'captcha', items: [{ id: 'tab1', site: 'walmart.com' }], now: T, ...o });

test('defaults: 3 min timeout, ~1.5 s poll, starts with the agent driving', () => {
  assert.strictEqual(TAKEOVER_TIMEOUT_MS, 180_000);
  assert.strictEqual(TAKEOVER_POLL_MS, 1_500);
  const s = initialTakeover();
  assert.strictEqual(s.mode, 'agent');
  assert.strictEqual(agentMayAct(s), true);
});

test('AGENT → HANDOFF on detection; the agent may not act', () => {
  const s = one();
  assert.strictEqual(s.mode, 'handoff');
  assert.strictEqual(s.kind, 'captcha');
  assert.strictEqual(agentMayAct(s), false);
  assert.deepStrictEqual(waitingItems(s).map(i => i.site), ['walmart.com']);
  // Non-detection events while the agent drives change nothing.
  const a = initialTakeover();
  for (const e of [{ type: 'poll', id: 'x', blocked: false, now: T }, { type: 'user_input', now: T }, { type: 'tick', now: T + 1e9 }, { type: 'hand_back' }, { type: 'skip' }, { type: 'stop' }] as const) assert.strictEqual(R(a, e as any), a);
  // Detection with no page does nothing.
  assert.strictEqual(R(a, { type: 'detected', kind: 'captcha', items: [], now: T }), a);
});

test('HANDOFF → TAKEOVER when the person uses the page; more input keeps TAKEOVER', () => {
  let s = R(one(), { type: 'user_input', now: T + 5_000 });
  assert.strictEqual(s.mode, 'takeover');
  assert.strictEqual(agentMayAct(s), false);
  s = R(s, { type: 'user_input', now: T + 9_000 });
  assert.strictEqual(s.mode, 'takeover');
  assert.strictEqual(s.lastInputAt, T + 9_000);
  // A second detection mid-hand-off is ignored.
  assert.strictEqual(R(s, { type: 'detected', kind: 'signin', items: [{ id: 'z', site: 'z' }], now: T }), s);
});

test('HANDOFF/TAKEOVER → AGENT automatically when the page is no longer a check', () => {
  for (const start of [one(), R(one(), { type: 'user_input', now: T + 1 })]) {
    let s = R(start, { type: 'poll', id: 'tab1', blocked: true, now: T + 1_500 });
    assert.notStrictEqual(s.mode, 'agent');
    s = R(s, { type: 'poll', id: 'tab1', blocked: false, now: T + 3_000 });
    assert.strictEqual(s.mode, 'agent');
    assert.strictEqual(s.outcome, 'cleared');
    assert.strictEqual(s.items[0].status, 'cleared');
  }
});

test('[Hand back] and [Skip this site]', () => {
  const hb = R(R(one(), { type: 'user_input', now: T + 1 }), { type: 'hand_back' });
  assert.deepStrictEqual([hb.mode, hb.outcome, hb.items[0].status], ['agent', 'handed_back', 'handed_back']);
  const sk = R(one(), { type: 'skip' });
  assert.deepStrictEqual([sk.mode, sk.outcome, sk.items[0].status], ['agent', 'skipped', 'skipped']);
});

test('timeout: 3 min after the hand-off, or after the person last touched the page', () => {
  let s = R(one(), { type: 'tick', now: T + TAKEOVER_TIMEOUT_MS - 1 });
  assert.strictEqual(s.mode, 'handoff');
  s = R(s, { type: 'tick', now: T + TAKEOVER_TIMEOUT_MS });
  assert.deepStrictEqual([s.mode, s.outcome, s.items[0].status], ['agent', 'timeout', 'timeout']);
  // A blocked poll also expires.
  assert.strictEqual(R(one(), { type: 'poll', id: 'tab1', blocked: true, now: T + TAKEOVER_TIMEOUT_MS }).outcome, 'timeout');
  // The person working on it at minute 2 pushes the deadline.
  let d = R(one(), { type: 'user_input', now: T + 120_000 });
  d = R(d, { type: 'tick', now: T + TAKEOVER_TIMEOUT_MS + 1 });
  assert.strictEqual(d.mode, 'takeover');
  d = R(d, { type: 'tick', now: T + 120_000 + TAKEOVER_TIMEOUT_MS });
  assert.strictEqual(d.outcome, 'timeout');
  // Configurable per hand-off.
  const short = R(initialTakeover(), { type: 'detected', kind: 'captcha', items: [{ id: 'a', site: 'a' }], now: T, timeoutMs: 2_000 });
  assert.strictEqual(R(short, { type: 'tick', now: T + 2_000 }).outcome, 'timeout');
});

test('unattended (scheduled) run: never waits — straight back to AGENT, marked unattended', () => {
  const s = one({ unattended: true });
  assert.deepStrictEqual([s.mode, s.outcome, s.items[0].status], ['agent', 'unattended', 'unattended']);
  assert.strictEqual(agentMayAct(s), true);
});

test('Stop exits any state', () => {
  for (const start of [one(), R(one(), { type: 'user_input', now: T + 1 })]) {
    const s = R(start, { type: 'stop' });
    assert.deepStrictEqual([s.mode, s.outcome, s.items[0].status], ['agent', 'stopped', 'stopped']);
  }
});

test('several pages (price compare): each clears on its own, the rest time out together', () => {
  let s = R(initialTakeover(), { type: 'detected', kind: 'captcha', items: [{ id: 'target', site: 'Target' }, { id: 'walmart', site: 'Walmart' }], now: T });
  assert.strictEqual(waitingItems(s).length, 2);
  s = R(s, { type: 'poll', id: 'target', blocked: false, now: T + 10_000 });
  assert.strictEqual(s.mode, 'handoff');
  assert.deepStrictEqual(s.items.map(i => i.status), ['cleared', 'waiting']);
  s = R(s, { type: 'tick', now: T + TAKEOVER_TIMEOUT_MS });
  assert.deepStrictEqual([s.mode, s.outcome], ['agent', 'timeout']);
  assert.deepStrictEqual(s.items.map(i => i.status), ['cleared', 'timeout']);
  // Both cleared → cleared.
  let b = R(initialTakeover(), { type: 'detected', kind: 'captcha', items: [{ id: 'a', site: 'A' }, { id: 'b', site: 'B' }], now: T });
  b = R(R(b, { type: 'poll', id: 'b', blocked: false, now: T + 1 }), { type: 'poll', id: 'a', blocked: false, now: T + 2 });
  assert.deepStrictEqual([b.mode, b.outcome], ['agent', 'cleared']);
  // Skip with one cleared: only the waiting one is skipped.
  let c = R(initialTakeover(), { type: 'detected', kind: 'captcha', items: [{ id: 'a', site: 'A' }, { id: 'b', site: 'B' }], now: T });
  c = R(R(c, { type: 'poll', id: 'a', blocked: false, now: T + 1 }), { type: 'skip' });
  assert.deepStrictEqual(c.items.map(i => i.status), ['cleared', 'skipped']);
});

test('guard: on a human check, every page interaction is refused; passive reads and leaving are allowed', () => {
  const check = { kind: 'captcha' as const, why: 'challenge element #px-captcha' };
  for (const a of ['click_ref', 'click_text', 'click_at', 'click_role', 'dblclick', 'hover', 'focus', 'drag', 'check', 'uncheck', 'select_option',
    'fill', 'fill_ref', 'type', 'insert_text', 'press', 'keydown', 'keyup', 'scroll', 'upload', 'dialog', 'reload', 'find', 'look_at', 'some_future_action']) {
    const r = guardAgentAction(a, check, 'walmart.com');
    assert.ok(r, `${a} must be refused`);
    assert.match(r!, /human check/);
    assert.match(r!, /never operates/);
  }
  for (const a of ['screenshot', 'extract_text', 'get', 'wait', 'navigate', 'back', 'new_tab', 'switch_tab', 'close_tab', 'web_search', 'done', 'report', 'store'])
    assert.strictEqual(guardAgentAction(a, check), null, `${a} is passive / leaves the page`);
  // Not a human check (normal page, or a sign-in wall) → the guard does not apply.
  assert.strictEqual(guardAgentAction('click_ref', null), null);
  assert.strictEqual(guardAgentAction('click_ref', { kind: 'signin' }), null);
});
