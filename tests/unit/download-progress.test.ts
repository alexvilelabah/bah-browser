// Cadência dos avisos de progresso pro agente (pelo ETA) e detecção de travamento.
import { test } from 'node:test';
import assert from 'node:assert';
import { agentCadenceMs, ProgressTracker, STALL_WARN_MS } from '../../src/main/download-progress.ts';

const MB = 1024 * 1024;

test('cadence follows the ETA: ≤2min 1s, ≤10min 5s, >10min 15s, unknown 5s', () => {
  assert.strictEqual(agentCadenceMs(30), 1_000);
  assert.strictEqual(agentCadenceMs(120), 1_000);
  assert.strictEqual(agentCadenceMs(121), 5_000);
  assert.strictEqual(agentCadenceMs(600), 5_000);
  assert.strictEqual(agentCadenceMs(601), 15_000);
  assert.strictEqual(agentCadenceMs(null), 5_000);
  assert.strictEqual(agentCadenceMs(Infinity), 5_000);
});

/** Simula `seconds` ticks de 1s a `bps`; devolve quantos ticks notificaram. */
function run(tr: ProgressTracker, start: number, seconds: number, bps: number) {
  let notified = 0; let t = start; let last;
  for (let i = 0; i < seconds; i++) {
    t += 1000;
    if (bps > 0) tr.add(bps, t);
    last = tr.tick(t);
    if (last.notify) notified++;
  }
  return { notified, t, last: last! };
}

test('short download (ETA < 2min) notifies the agent every second', () => {
  const tr = new ProgressTracker(100 * MB, 0);
  const { notified, last } = run(tr, 0, 10, 2 * MB);   // 100MB a 2MB/s → ETA ~40s
  assert.strictEqual(notified, 10);
  assert.ok(last.etaSec! > 30 && last.etaSec! < 50, `eta ${last.etaSec}`);
  assert.strictEqual(last.speedBps, 2 * MB);
});

test('medium download (ETA 2-10min) notifies every 5s', () => {
  const tr = new ProgressTracker(600 * MB, 0);
  const { notified } = run(tr, 0, 30, 2 * MB);          // ETA ~5min
  assert.strictEqual(notified, 6);
});

test('long download (ETA > 10min) notifies every 15s', () => {
  const tr = new ProgressTracker(6000 * MB, 0);
  const { notified } = run(tr, 0, 60, 2 * MB);          // ETA ~50min
  assert.strictEqual(notified, 4);
});

test('unknown size uses the 5s default', () => {
  const tr = new ProgressTracker(0, 0);
  const { notified, last } = run(tr, 0, 20, 1 * MB);
  assert.strictEqual(last.etaSec, null);
  assert.strictEqual(notified, 4);
});

test('cadence adapts when speed changes mid-download', () => {
  const tr = new ProgressTracker(1000 * MB, 0);
  const slow = run(tr, 0, 30, 1 * MB);                   // ETA ~16min → 15s
  assert.strictEqual(slow.notified, 2);
  const fast = run(tr, slow.t, 30, 50 * MB);              // ETA drops under 2min → 1s
  assert.ok(fast.notified >= 25, `fast notified ${fast.notified}`);
});

test('stall: flagged once after 15s without data, cleared (and notified) when data resumes', () => {
  const tr = new ProgressTracker(6000 * MB, 0);
  let t = run(tr, 0, 5, 10 * MB).t;
  const idle = run(tr, t, STALL_WARN_MS / 1000 + 10, 0);   // 25s sem dado
  t = idle.t;
  assert.strictEqual(idle.last.stalled, true);
  assert.ok(idle.last.stalledForSec >= 15);
  // Once data stops the speed decays to 0 → ETA unknown → 5s cadence until the stall (≤3 notifies),
  // then exactly one stall transition and NO repeats while stalled.
  assert.ok(idle.notified <= 4, `idle notified ${idle.notified}`);
  const still = run(tr, t, 10, 0);
  t = still.t;
  assert.strictEqual(still.notified, 0);
  t += 1000; tr.add(MB, t);
  const back = tr.tick(t);
  assert.strictEqual(back.stalled, false);
  assert.strictEqual(back.notify, true);
});
