import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySelfEval, nextSelfFailCount } from '../../src/shared/self-eval.ts';

// The model happily repeats a click that did nothing. Asking it to judge the previous
// action only helps if the answer is read correctly: prose that mentions "fail" later
// must not read as a failure, and shrugging must not reset the counter.

test('the first word decides', () => {
  assert.equal(classifySelfEval('failed - the modal is still open'), 'failed');
  assert.equal(classifySelfEval('success, no error shown'), 'success');
  assert.equal(classifySelfEval('ok'), 'success');
  assert.equal(classifySelfEval('não mudou nada'), 'failed');
  assert.equal(classifySelfEval('unclear'), 'unclear');
  assert.equal(classifySelfEval(''), 'unclear');
  assert.equal(classifySelfEval('   '), 'unclear');
});

test('a mention of failure deeper in the sentence is not a verdict', () => {
  assert.equal(classifySelfEval('success. It failed the first time but worked now'), 'success');
  assert.equal(classifySelfEval('success - no failure'), 'success');
});

test('consecutive failures accumulate and only a success clears them', () => {
  assert.equal(nextSelfFailCount(0, 'failed'), 1);
  assert.equal(nextSelfFailCount(1, 'failed'), 2);
  assert.equal(nextSelfFailCount(2, 'failed'), 3);
  assert.equal(nextSelfFailCount(2, 'success'), 0);
  assert.equal(nextSelfFailCount(2, 'unclear'), 2, 'shrugging is not evidence of success');
});
