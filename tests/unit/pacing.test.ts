// Ritmo por site: espera aleatória de 1–5s entre ações no mesmo host; recuo após checagem anti-robô.
import { test } from 'node:test';
import assert from 'node:assert';
import { paceDelay, recordHit, backoff, isBackedOff, hostOf, MIN_GAP_MS, MAX_GAP_MS, BACKOFF_MIN_MS, BACKOFF_MAX_MS, BACKOFF_FOR_MS, BOT_CHECK_RE, _resetPacingForTests } from '../../src/renderer/pacing.ts';

test('every gap is random within 1–5 s and the gaps are not all equal', () => {
  _resetPacingForTests();
  const gaps: number[] = [];
  let t = 0;
  for (let i = 0; i < 50; i++) { recordHit('amazon.com', t); const g = paceDelay('amazon.com', t); gaps.push(g); t += g; }
  assert.ok(gaps.every(g => g >= MIN_GAP_MS && g <= MAX_GAP_MS), `out of range: ${gaps.filter(g => g < MIN_GAP_MS || g > MAX_GAP_MS)}`);
  assert.ok(new Set(gaps).size > 10, 'gaps should vary');
});

test('the wait counts down; other hosts are independent', () => {
  _resetPacingForTests(() => 0.5);   // 3000 ms
  recordHit('amazon.com', 1000);
  assert.strictEqual(paceDelay('amazon.com', 1000), 3000);
  assert.strictEqual(paceDelay('amazon.com', 3500), 500);
  assert.strictEqual(paceDelay('amazon.com', 5000), 0);
  assert.strictEqual(paceDelay('ebay.com', 1000), 0);
});

test('after a bot check the waits are longer (15–30 s) for 30 minutes, then back to 1–5 s', () => {
  _resetPacingForTests(() => 0);
  backoff('amazon.com', 0);
  assert.ok(isBackedOff('amazon.com', 1000));
  assert.strictEqual(paceDelay('amazon.com', 0), BACKOFF_MIN_MS);
  _resetPacingForTests(() => 1);
  backoff('amazon.com', 0);
  recordHit('amazon.com', 100);
  assert.strictEqual(paceDelay('amazon.com', 100), BACKOFF_MAX_MS);
  recordHit('amazon.com', BACKOFF_FOR_MS + 10);
  assert.strictEqual(isBackedOff('amazon.com', BACKOFF_FOR_MS + 10), false);
  assert.strictEqual(paceDelay('amazon.com', BACKOFF_FOR_MS + 10), MAX_GAP_MS);
});

test('host normalisation and bot-check wording', () => {
  assert.strictEqual(hostOf('https://www.Amazon.com/s?k=x'), 'amazon.com');
  for (const t of ['Robot Check', 'Enter the characters you see below', 'To discuss automated access to Amazon data', 'Just a moment...', 'Our systems have detected unusual traffic'])
    assert.ok(BOT_CHECK_RE.test(t), t);
  assert.ok(!BOT_CHECK_RE.test('USB-C charger 65W — 4.5 out of 5 stars'));
});
