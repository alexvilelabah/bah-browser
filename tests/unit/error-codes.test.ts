// C14: failures travel as codes. The renderer must not need a regex over prose to know
// whether a failure is retryable, permanent, or the user pressing Stop.
import { test } from 'node:test';
import assert from 'node:assert';
import { classifyError, isCancellation, isTransient } from '../../src/shared/error-codes.ts';

test('cancellation is never retryable and is recognised as such', () => {
  assert.equal(classifyError(new Error('CANCELLED')).code, 'CANCELLED');
  assert.equal(classifyError(new Error('task aborted')).code, 'CANCELLED');
  assert.equal(isCancellation(new Error('CANCELLED')), true);
  assert.equal(isTransient('CANCELLED'), false);
});

test('transport failures are retryable, permanent ones are not', () => {
  assert.equal(classifyError(new Error('fetch failed')).retryable, true);
  assert.equal(classifyError(new Error('connect ECONNREFUSED 127.0.0.1:11434')).code, 'CONNECTION_FAILED');
  assert.equal(classifyError(new Error('body read timed out')).retryable, true);
  assert.equal(classifyError(new Error('Local AI too slow')).code, 'TIMEOUT');
  assert.equal(classifyError(new Error('HTTP 429 rate limit')).code, 'RATE_LIMIT');
  assert.equal(classifyError(new Error('compute error: model not loaded')).code, 'COMPUTE_ERROR');
  assert.equal(classifyError(new Error('compute error: model not loaded')).retryable, false);
  assert.equal(classifyError(new Error('context length exceeded')).retryable, false);
  assert.equal(classifyError(new Error('401 unauthorized')).retryable, false);
});

test('a typed error keeps its own code and detail', () => {
  class E extends Error { code = 'TIMEOUT_STALL'; detail = { model: 'qwen3' }; }
  const e = new E('stream stalled (60s)');
  const c = classifyError(e);
  assert.equal(c.code, 'TIMEOUT_STALL');
  assert.equal(c.retryable, true);
  assert.deepEqual(c.detail, { model: 'qwen3' });
});

test('unknown is honest, not optimistic', () => {
  const c = classifyError({ weird: true });
  assert.equal(c.code, 'UNKNOWN');
  assert.equal(c.retryable, false);
});

test('every code the transport can emit is known to the renderer', () => {
  const known = new Set(['CANCELLED', 'CONNECTION_FAILED', 'TIMEOUT_FIRST_CHUNK', 'TIMEOUT_TOTAL', 'TIMEOUT_STALL',
    'TIMEOUT', 'MODEL_NOT_FOUND', 'UNSUITABLE_MODEL', 'CONTEXT_OVERFLOW', 'TRUNCATED', 'THINKING_BUDGET',
    'INSTREAM_ERROR', 'COMPUTE_ERROR', 'BAD_JSON', 'IMAGE_REJECTED', 'AUTH_FAILED', 'SERVER_ERROR',
    'RATE_LIMIT', 'STREAM_ERROR', 'UNKNOWN']);
  for (const code of known) {
    assert.equal(classifyError({ code, message: 'x' }).code, code, `${code} must survive classification`);
  }
});
