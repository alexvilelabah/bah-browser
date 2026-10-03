// The thinking budget is soft - it only bites while there is NO answer.
import { test } from 'node:test';
import assert from 'node:assert';
import { ThinkingBudget, detectRepeat, THINKING_TOKENS_SOFT } from '../../src/main/thinking-budget.ts';

// Varied text: a filler that never repeats verbatim, so it must not look like a loop.
const prose = (n: number) => { let s = ''; for (let i = 0; s.length < n; i++) s += `step ${i}: read row ${i * 7} titled "${(i * 31) % 997}" `; return s.slice(0, n); };

test('never cuts while an answer is flowing', () => {
  const b = new ThinkingBudget();
  assert.equal(b.check(prose(100_000), true), undefined);
});

test('cuts reasoning over the token cap with no content', () => {
  const b = new ThinkingBudget();
  const cap = Math.round(THINKING_TOKENS_SOFT * 3.5);
  assert.equal(b.check(prose(cap - 10), false), undefined);
  assert.equal(b.check(prose(cap + 400), false), 'THINKING_BUDGET');
});

test('cuts verbatim loops, not varied prose', () => {
  const loop = 'I should click the button and then check the result. '.repeat(40);
  assert.equal(detectRepeat(loop), true);
  assert.equal(detectRepeat(prose(loop.length)), false);
  assert.equal(new ThinkingBudget().check(loop, false), 'REPEATING');
});

test('short thinking is left alone', () => {
  const b = new ThinkingBudget();
  assert.equal(b.check(prose(3000), false), undefined);
});

test('elapsed cap scales with the last step and is bounded', () => {
  assert.equal(ThinkingBudget.forStep(0).msCap, 240_000);
  assert.equal(ThinkingBudget.forStep(2869).msCap, Math.round(240 * (1 + 2869 / 4096)) * 1000);
  assert.ok(ThinkingBudget.forStep(999_999).msCap <= 600_000);
  assert.equal(ThinkingBudget.forStep(999_999).charsCap, Math.round(THINKING_TOKENS_SOFT * 3.5));
});
