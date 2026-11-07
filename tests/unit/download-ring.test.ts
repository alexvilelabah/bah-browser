// Anel de progresso do botão de downloads.
import { test } from 'node:test';
import assert from 'node:assert';
import { ringState, ringDash } from '../../src/renderer/download-ring.ts';

test('idle when nothing is active; finished/failed/cancelled do not count', () => {
  assert.deepEqual(ringState([]), { kind: 'idle' });
  assert.deepEqual(ringState([{ state: 'completed', bytes: 5, totalBytes: 5 }, { state: 'failed' }, { state: 'cancelled' }]), { kind: 'idle' });
});

test('progress sums bytes over active downloads with a known size', () => {
  const s = ringState([{ state: 'progress', bytes: 25, totalBytes: 100 }, { state: 'progress', bytes: 75, totalBytes: 100 }, { state: 'completed', bytes: 9, totalBytes: 9 }]);
  assert.equal(s.kind, 'progress');
  assert.equal((s as any).fraction, 0.5);
  assert.equal((s as any).count, 2);
});

test('unknown size spins; all paused is flagged; bytes over total are capped', () => {
  assert.deepEqual(ringState([{ state: 'started' }]), { kind: 'indeterminate', count: 1 });
  const p = ringState([{ state: 'progress', bytes: 10, totalBytes: 100, paused: true }]) as any;
  assert.equal(p.paused, true);
  assert.equal((ringState([{ state: 'progress', bytes: 150, totalBytes: 100 }]) as any).fraction, 1);
});

test('dash covers the right share of the circle', () => {
  const [on, off] = ringDash(0.25, 10).split(' ').map(Number);
  assert.ok(Math.abs(on - (2 * Math.PI * 10) / 4) < 0.01);
  assert.ok(Math.abs(on + off - 2 * Math.PI * 10) < 0.01);
});
