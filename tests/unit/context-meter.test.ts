// Medidor de contexto do painel (shared/context-meter.ts).
import { test } from 'node:test';
import assert from 'node:assert';
import { meterState, meterLabel, fmtTokens, partShares } from '../../src/shared/context-meter.ts';

test('token format', () => {
  assert.equal(fmtTokens(950), '950');
  assert.equal(fmtTokens(6100), '6.1k');
  assert.equal(fmtTokens(2000), '2k');
  assert.equal(fmtTokens(16384), '16k');
  assert.equal(fmtTokens(2349), '2.3k');
});

test('label: reported usage vs estimate, with and without a known window', () => {
  const s = meterState({ window: 16384, parts: { instructions: 1800, thread: 2300, page: 2000 }, reported: 6100 });
  assert.equal(s.estimated, false);
  assert.equal(meterLabel(s), 'context 6.1k / 16k · thread 2.3k');
  const e = meterState({ parts: { instructions: 1000, thread: 300, page: 1200 } });
  assert.equal(e.estimated, true);
  assert.equal(e.window, 0);
  assert.equal(meterLabel(e), 'context ~2.5k · thread 300');
});

test('colour shifts as it fills and names what crowds it', () => {
  assert.equal(meterState({ window: 10000, parts: { page: 5000 } }).level, 'ok');
  const amber = meterState({ window: 10000, parts: { instructions: 1000, thread: 1000, page: 5500 } });
  assert.equal(amber.level, 'amber');
  assert.equal(amber.crowding, 'page');
  const red = meterState({ window: 10000, parts: { instructions: 2000, thread: 6000, page: 1500 } });
  assert.equal(red.level, 'red');
  assert.equal(red.crowding, 'thread');
  assert.equal(meterState({ window: 10000, parts: { page: 3000 } }).crowding, undefined);
  // Unknown window: never amber/red (no ratio to judge).
  assert.equal(meterState({ parts: { page: 999999 } }).level, 'ok');
});

test('breakdown shares add up', () => {
  const sh = partShares({ parts: { instructions: 1, skills: 1, thread: 1, page: 1 } });
  assert.equal(Object.values(sh).reduce((a, b) => a + b, 0), 1);
});
