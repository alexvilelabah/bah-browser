// error-codes.ts — the machine-readable failure vocabulary shared by main and renderer.
//
// The renderer used to classify failures by regex over a human sentence, so any rewording
// silently changed behaviour (a retryable timeout read as a permanent failure and killed the
// run). Codes travel instead; the message stays for the log.
export type AgentErrorCode =
  | 'CANCELLED'
  | 'CONNECTION_FAILED'
  | 'TIMEOUT_FIRST_CHUNK'
  | 'TIMEOUT_TOTAL'
  | 'TIMEOUT_STALL'
  | 'TIMEOUT'
  | 'MODEL_NOT_FOUND'
  | 'UNSUITABLE_MODEL'
  | 'CONTEXT_OVERFLOW'
  | 'TRUNCATED'
  | 'THINKING_BUDGET'
  | 'INSTREAM_ERROR'
  | 'COMPUTE_ERROR'
  | 'BAD_JSON'
  | 'IMAGE_REJECTED'
  | 'AUTH_FAILED'
  | 'SERVER_ERROR'
  | 'RATE_LIMIT'
  | 'STREAM_ERROR'
  | 'UNKNOWN';

/** Everything the renderer needs to decide: retry, degrade, or pause. */
export interface ErrorPayload {
  code: AgentErrorCode;
  message: string;
  retryable: boolean;
  detail?: Record<string, unknown>;
}

const RETRYABLE: ReadonlySet<AgentErrorCode> = new Set<AgentErrorCode>([
  'CONNECTION_FAILED', 'TIMEOUT_FIRST_CHUNK', 'TIMEOUT_TOTAL', 'TIMEOUT_STALL', 'TIMEOUT',
  'INSTREAM_ERROR', 'BAD_JSON', 'RATE_LIMIT', 'STREAM_ERROR',
]);

/** Classify anything thrown at us. A LocalRequestError already knows; anything else is
 *  matched on the message, which is a fallback, not the contract. */
export function classifyError(e: any): ErrorPayload {
  const message = String(e?.message ?? e ?? '');
  if (e?.code && RETRYABLE.has(e.code)) {
    return { code: e.code, message, retryable: true, detail: e.detail };
  }
  if (e?.code) return { code: e.code as AgentErrorCode, message, retryable: false, detail: e.detail };
  if (/cancelled|abort/i.test(message)) return { code: 'CANCELLED', message, retryable: false };
  if (/econnrefused|enotfound|fetch failed|cannot reach|network/i.test(message)) {
    return { code: 'CONNECTION_FAILED', message, retryable: true };
  }
  if (/timed out|timeout|too slow/i.test(message)) return { code: 'TIMEOUT', message, retryable: true };
  if (/compute error|failed to load model|out of memory|oom/i.test(message)) {
    return { code: 'COMPUTE_ERROR', message, retryable: false };
  }
  if (/context length|context window|too many tokens|overflow/i.test(message)) {
    return { code: 'CONTEXT_OVERFLOW', message, retryable: false };
  }
  if (/model .*(not found|does not exist)|404/i.test(message)) {
    return { code: 'MODEL_NOT_FOUND', message, retryable: false };
  }
  if (/401|403|unauthorized|forbidden|invalid.*key/i.test(message)) {
    return { code: 'AUTH_FAILED', message, retryable: false };
  }
  if (/429|rate limit/i.test(message)) return { code: 'RATE_LIMIT', message, retryable: true };
  if (/image|multimodal|mmproj/i.test(message)) return { code: 'IMAGE_REJECTED', message, retryable: false };
  if (/unexpected token|not valid json|bad json/i.test(message)) {
    return { code: 'BAD_JSON', message, retryable: true };
  }
  return { code: 'UNKNOWN', message, retryable: false };
}

export function isCancellation(e: any): boolean {
  return classifyError(e).code === 'CANCELLED';
}

/** A failure the user can plausibly fix by waiting or by switching engine. */
export function isTransient(code: AgentErrorCode): boolean {
  return RETRYABLE.has(code);
}
