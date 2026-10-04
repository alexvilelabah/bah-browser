// The budget must account for everything travelling in the window: system prompt, output
// reserve, images — or the observation is fitted to a window that does not exist.
import { test } from 'node:test';
import assert from 'node:assert';
import { applyContextBudget, estimateTokens, outputBudget , ollamaAutoNumCtx, recoverOutputBudget } from '../../src/main/local-providers.ts';

const obs = (n: number) => `PAGE TEXT:\n${'x'.repeat(n)}\nRECENT HISTORY:\nold step\n`;

test('the system prompt is deducted from the window', () => {
  const total = 16384, out = 4096, sys = 6855;   // measured: 26,434 chars ≈ 6,855 tokens
  const withSys = applyContextBudget(obs(200_000), { totalTokens: total, maxOutputTokens: out, systemTokens: sys });
  const noSys = applyContextBudget(obs(200_000), { totalTokens: total, maxOutputTokens: out });
  assert.equal(withSys.trimmed, true);
  assert.ok(withSys.text.length < noSys.text.length, 'counting the prompt must leave less room, not more');
  assert.ok(estimateTokens(withSys.text) <= total - out - 512 - sys + 40, 'fitted observation must fit the remaining window');
});

test('without a system prompt the fit is unchanged', () => {
  const small = obs(1000);
  assert.deepEqual(applyContextBudget(small, { totalTokens: 16384, maxOutputTokens: 4096, systemTokens: 6855 }), { text: small, trimmed: false });
});

test('images are deducted too', () => {
  const r = applyContextBudget(obs(200_000), { totalTokens: 16384, maxOutputTokens: 4096, systemTokens: 6855, imageTokens: 1500 });
  const r2 = applyContextBudget(obs(200_000), { totalTokens: 16384, maxOutputTokens: 4096, systemTokens: 6855 });
  assert.ok(r.text.length <= r2.text.length);
});

test('the computed output budget is what gets sent', () => {
  // Cloud: unchanged historic numbers.
  assert.equal(outputBudget({ isLocal: false }), 4096);
  assert.equal(outputBudget({ isLocal: false, cfgMax: 16384 }), 16384);
  assert.equal(outputBudget({ isLocal: false, userMax: 16384 }), 4096, 'a local setting must not leak to cloud');
  // Local: honours the user's setting, defaults to the hard cap, never exceeds it.
  assert.equal(outputBudget({ isLocal: true }), 16384);
  assert.equal(outputBudget({ isLocal: true, userMax: 8192 }), 8192, 'the user setting is honoured');
  assert.equal(outputBudget({ isLocal: true, userMax: 8192, cfgMax: 16384 }), 16384, 'recovery headroom outranks the user setting');
  assert.equal(outputBudget({ isLocal: true, userMax: 32768 }), 16384, 'hard cap');
  assert.equal(outputBudget({ isLocal: true, cfgMax: 4096 }), 16384);
});

test('auto num_ctx is measured, never shrunk, and bounded', () => {
  // No measurement yet: the 16k floor.
  assert.equal(ollamaAutoNumCtx({ outputTokens: 16384 }), 16384);
  // A measured prompt that does not fit escalates once, up to the ceiling.
  assert.equal(ollamaAutoNumCtx({ measuredPromptTokens: 20000, outputTokens: 16384, sent: 16384 }), 32768);
  // Ceiling holds even when the need is absurd.
  assert.equal(ollamaAutoNumCtx({ measuredPromptTokens: 200000, outputTokens: 16384, sent: 16384 }), 32768);
  // Never shrinks: lowering num_ctx reallocates and reloads the model.
  assert.equal(ollamaAutoNumCtx({ measuredPromptTokens: 1000, outputTokens: 512, sent: 32768 }), 32768);
});

test('recovery grows to what fits, not to a fixed 16k', () => {
  // Small window, big prompt: recovery cannot ask for 16k.
  assert.equal(recoverOutputBudget({ previous: 4096, measuredPromptTokens: 12000, window: 16384 }), 3872);
  // Roomy window: double, capped at the hard 16384.
  assert.equal(recoverOutputBudget({ previous: 4096, measuredPromptTokens: 2000, window: 32768 }), 8192);
  assert.equal(recoverOutputBudget({ previous: 12000, measuredPromptTokens: 2000, window: 262144 }), 16384);
  // Recovery never asks for less than the attempt that just failed.
  assert.ok(recoverOutputBudget({ previous: 16384, measuredPromptTokens: 40000, window: 32768 }) >= 1024);
});
