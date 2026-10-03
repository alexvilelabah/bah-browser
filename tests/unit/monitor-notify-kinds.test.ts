import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNotifyKinds, shouldNotify } from '../../src/shared/monitor-notify.ts';

// // A monitor whose check kept failing stayed silent forever; the user thought it was watched.

test('unknown kinds are dropped, empty falls back to trigger', () => {
  assert.deepEqual(normalizeNotifyKinds(['trigger']), ['trigger']);
  assert.deepEqual(normalizeNotifyKinds(['change', 'error']), ['change', 'error']);
  assert.deepEqual(normalizeNotifyKinds(['triger']), ['trigger'], 'typo must not disarm the monitor');
  assert.deepEqual(normalizeNotifyKinds([]), ['trigger']);
  assert.deepEqual(normalizeNotifyKinds(undefined), ['trigger']);
  assert.deepEqual(normalizeNotifyKinds(null), ['trigger']);
  assert.deepEqual(normalizeNotifyKinds('nope' as unknown), ['trigger']);
  assert.deepEqual(normalizeNotifyKinds(['change', 'change']), ['change'], 'no duplicates');
});

test('trigger fires on the edge, not the level', () => {
  const base = { value: 'R$ 90', prevValue: 'R$ 90', failed: false };
  assert.equal(shouldNotify(['trigger'], { ...base, met: true, prevMet: false }), 'trigger');
  assert.equal(shouldNotify(['trigger'], { ...base, met: true, prevMet: true }), null, 'already met: no spam');
  assert.equal(shouldNotify(['trigger'], { ...base, met: false, prevMet: false }), null);
});

test('change fires when the value moved even though the target was not hit', () => {
  const kinds = ['trigger', 'change'];
  assert.equal(shouldNotify(kinds, { met: false, prevMet: false, value: 'R$ 85', prevValue: 'R$ 90', failed: false }), 'change');
  assert.equal(shouldNotify(kinds, { met: false, prevMet: false, value: 'R$ 85', prevValue: 'R$ 85', failed: false }), null);
  // trigger wins over change when both apply
  assert.equal(shouldNotify(kinds, { met: true, prevMet: false, value: 'R$ 85', prevValue: 'R$ 90', failed: false }), 'trigger');
});

test('change is invisible to someone who did not ask for it', () => {
  assert.equal(shouldNotify(['trigger'], { met: false, prevMet: false, value: 'R$ 85', prevValue: 'R$ 90', failed: false }), null);
});

test('a failed check notifies only if the user asked; silence is not the default', () => {
  assert.equal(shouldNotify(['trigger', 'error'], { met: false, prevMet: false, value: '', prevValue: '', failed: true }), 'error');
  assert.equal(shouldNotify(['trigger'], { met: false, prevMet: false, value: '', prevValue: '', failed: true }), null);
  // failure outranks a met verdict: the verdict came from a broken read
  assert.equal(shouldNotify(['trigger', 'error'], { met: true, prevMet: false, value: '', prevValue: '', failed: true }), 'error');
});
