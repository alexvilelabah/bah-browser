// cancellable-fetch.ts — who owns the abort on a LOCAL model request.
//
// fetchWithTimeout drops the caller's abort listener once headers arrive, so Stop only
// discards the result: the server keeps generating (measured on oMLX — an abandoned
// request kept the GPU busy past 60s and the next ran at half speed, 47 vs 102 tok/s).
// Here the listener stays wired until settle(), called once the body is consumed.
//
// Two clocks: firstChunkMs covers connect + model load + prompt processing; totalMs caps
// non-streaming calls, where oMLX sends nothing between headers and body so byte-inactivity
// cannot be used. Cloud callers keep fetchWithTimeout. Electron-free so `node --test` runs it.
import { LocalRequestError } from './local-providers.ts';

// Clocks. A cold local model takes minutes to load; a warm step is seconds; but one long
// answer can sit silent for minutes (measured: 2,869 output tokens at 19 tok/s = 151s,
// and oMLX sends nothing between headers and body when not streaming). Cloud is unchanged.
export const LOCAL_FIRST_CHUNK_MS = 300_000;   // connect + model load + prompt processing
export const LOCAL_TOTAL_MS = 300_000;         // non-streaming: no chunks to measure by
export const LOCAL_INACTIVITY_MS = 60_000;     // streaming: silence between chunks
export const CLOUD_FIRST_CHUNK_MS = 45_000;
export const CLOUD_BODY_MS = 60_000;
export const CLOUD_INACTIVITY_MS = 30_000;
export interface CancellableFetch {
  res: Response;
  /** Release the listener and clocks. Once, AFTER the body is consumed or discarded. */
  settle: () => void;
}

export interface CancellableFetchOptions {
  firstChunkMs?: number;
  totalMs?: number;
  signal?: AbortSignal;
  label?: string;
}

export async function fetchCancellable(
  url: string,
  opts: RequestInit,
  o: CancellableFetchOptions,
): Promise<CancellableFetch> {
  const ctrl = new AbortController();
  const label = o.label ?? url;
  let firstTimer: ReturnType<typeof setTimeout> | null = null;
  let totalTimer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const abortWith = (reason: string) => {
    if (ctrl.signal.aborted) return;
    try { ctrl.abort(new Error(reason)); } catch { try { ctrl.abort(); } catch { /* ignore */ } }
  };
  const clearTimers = () => {
    if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
    if (totalTimer) { clearTimeout(totalTimer); totalTimer = null; }
  };
  const onAbort = () => abortWith('cancelled');

  if (o.firstChunkMs) firstTimer = setTimeout(() => abortWith('first_chunk'), o.firstChunkMs);
  if (o.totalMs) totalTimer = setTimeout(() => abortWith('total'), o.totalMs);
  if (o.signal) {
    if (o.signal.aborted) onAbort();
    else o.signal.addEventListener('abort', onAbort, { once: true });
  }

  const settle = () => {
    if (settled) return;
    settled = true;
    clearTimers();
    if (o.signal) o.signal.removeEventListener('abort', onAbort);
  };

  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    // Headers in: first-chunk clock done, total clock and caller abort stay armed.
    if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
    return { res, settle };
  } catch (e: any) {
    clearTimers();
    if (o.signal) o.signal.removeEventListener('abort', onAbort);
    if (o.signal?.aborted) throw new LocalRequestError('CANCELLED', `${label} cancelled`, false);
    const reason = String((ctrl.signal as any)?.reason?.message ?? '');
    const msg = String(e?.message ?? e);
    if (/abort/i.test(msg) || ctrl.signal.aborted) {
      if (reason === 'total') {
        throw new LocalRequestError('TIMEOUT_TOTAL', `${label}: no response within ${Math.round((o.totalMs ?? 0) / 1000)}s`, true);
      }
      throw new LocalRequestError('TIMEOUT_FIRST_CHUNK', `${label}: the server did not answer within ${Math.round((o.firstChunkMs ?? 0) / 1000)}s`, true);
    }
    throw new LocalRequestError('CONNECTION_FAILED', `Cannot reach ${url}: ${msg}`, true);
  }
}

/** Streaming decision, kept pure so it is testable. Agent mode streams locally: a step
/** silent for 150s looks hung, and a stream proves liveness. */
export function shouldStream(o: { hasDelta: boolean; isAgentMode: boolean; isLocal: boolean; noStream?: boolean; rejected?: boolean }): boolean {
  return o.hasDelta && (!o.isAgentMode || o.isLocal) && !o.noStream && !o.rejected;
}

/** Sticky capability key: what one server told us must not be assumed about another. */
export function streamKey(baseUrl: string, model: string): string {
  return `${baseUrl}::${model}`;
}
