import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeadline } from '../../src/renderer/task-deadline.ts';

// The user set a time limit and the agent blew straight through it, because the limit
// was only compared between steps and a single step (or a hung local model) could take
// as long as it liked. These are the two behaviours that were missing.

test('the deadline fires on its own, without anyone checking a clock', async () => {
  const d = createDeadline(Date.now(), 20);
  assert.equal(d.fired(), false);
  assert.ok(d.remainingMs() > 0);
  await new Promise<void>((res) => d.signal.addEventListener('abort', () => res(), { once: true }));
  assert.equal(d.fired(), true);
  assert.equal(d.remainingMs(), 0);
});

test('suspend hands the clock to the human and resume gives it back', async () => {
  const started = Date.now();
  const d = createDeadline(started, 500);
  d.suspend();
  assert.equal(d.suspended(), true);
  await new Promise((res) => setTimeout(res, 120));       // a human taking their time
  assert.equal(d.fired(), false, 'time spent by a person must not burn the budget');

  d.resume();
  assert.equal(d.suspended(), false);
  // the human's span was not charged: only machine time burns the budget. (A version that
  // subtracted the suspended span twice left ~258ms here, halving the budget.)
  const left = d.remainingMs();
  assert.ok(left > 400 && left <= 500, `expected 400-500ms left, got ${Math.round(left)}`);
  assert.ok(d.spentMs() < 100, `expected near-zero machine time spent, got ${Math.round(d.spentMs())}`);
  // and it still fires afterwards — suspending is not cancelling
  await new Promise<void>((res) => d.signal.addEventListener('abort', () => res(), { once: true }));
  assert.equal(d.fired(), true);
});

test('an unlimited run never fires, and clear() releases the timer', async () => {
  const inf = createDeadline(Date.now(), Infinity);
  assert.equal(inf.remainingMs(), Infinity);
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(inf.fired(), false);

  const d = createDeadline(Date.now(), 10);
  d.clear();
  await new Promise((res) => setTimeout(res, 40));
  assert.equal(d.fired(), false, 'a cleared deadline must not fire after the run ended');
});

test('a limit already spent when created fires immediately, not never', () => {
  const d = createDeadline(Date.now() - 5000, 1000);
  assert.equal(d.fired(), true);
  assert.equal(d.remainingMs(), 0);
});
