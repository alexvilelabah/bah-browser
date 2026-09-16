/**
 * local-providers.ts — shared plumbing for local (on-machine / LAN) model endpoints.
 *
 * Covers BOTH transports behind one capability-graded interface:
 *   - 'ollama'      → Ollama native API (/api/tags, /api/ps, /api/show, /api/chat)
 *   - 'openai-compatible'→ generic OpenAI-compatible server (llama.cpp, LM Studio, vLLM…):
 *                     ONLY /v1/models + /v1/chat/completions (+ /props on llama.cpp).
 *
 * Design rules (Ollama no-regression):
 *   - Nothing here is called by the legacy Ollama path unless explicitly opted in.
 *   - Discovery NEVER autoloads models: llama.cpp router autoloads on metadata
 *     requests by default, so props queries always pass autoload=false.
 *   - An "unknown" capability is reported as unknown — never guessed.
 */

export type LocalProvider = 'ollama' | 'openai-compatible';

export type VisionSupport = 'supported' | 'unsupported' | 'unknown';
export type ContextSource = 'runtime' | 'configured' | 'fallback';

export interface LocalModelInfo {
  id: string;
  /** true = loaded now, false = unloaded, undefined = unknown (e.g. Ollama idle list). */
  loaded?: boolean;
  vision: VisionSupport;
  /** Runtime context allocation in tokens, when known. */
  contextTokens?: number;
  contextSource?: ContextSource;
  /** Model is wrong workload for chat/agent (embedding-only, image-gen, …). */
  unsuitable?: 'embedding' | 'image' | 'other';
  rawVendor?: string;
}

export interface LocalDiscovery {
  ok: boolean;
  models: LocalModelInfo[];
  error?: string;
}

/** Machine-readable failure codes for local requests. */
export type LocalErrorCode =
  | 'CONNECTION_FAILED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'MODEL_NOT_FOUND'
  | 'UNSUITABLE_MODEL'
  | 'CONTEXT_OVERFLOW'
  | 'TRUNCATED'
  | 'AUTH_FAILED'
  | 'SERVER_ERROR'
  | 'STREAM_ERROR'
  | 'UNKNOWN';

export class LocalRequestError extends Error {
  code: LocalErrorCode;
  retryable: boolean;
  constructor(code: LocalErrorCode, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

/** Normalize a user-entered base URL: trim, drop trailing slashes AND a trailing
 *  "/v1" (so both "http://host:port" and "http://host:port/v1" work without
 *  producing "/v1/v1/chat/completions"). Returns '' for empty input. */
export function normalizeBaseUrl(raw: string | undefined | null): string {
  let b = (raw || '').trim();
  if (!b) return '';
  b = b.replace(/\/+$/, '');
  b = b.replace(/\/v1$/i, '');
  // Windows IPv6-localhost fix (same as the legacy ollamaUrl helper): Ollama
  // on Windows often listens on 127.0.0.1 only, while `localhost` may resolve
  // to ::1. Apply narrowly — only a bare `localhost` host segment.
  b = b.replace(/(\/\/)localhost(\b|:)/i, '$1127.0.0.1$2');
  return b;
}

export function chatCompletionsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v1/chat/completions`;
}

export function modelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v1/models`;
}

function authHeaders(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  // A generic local endpoint is not necessarily unauthenticated — send the key
  // only when one is configured (stored encrypted via secure:encrypt).
  if (apiKey && apiKey.trim()) h['Authorization'] = `Bearer ${apiKey.trim()}`;
  return h;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LocalRequestError(
        res.status === 401 || res.status === 403 ? 'AUTH_FAILED'
          : res.status === 404 ? 'MODEL_NOT_FOUND'
          : res.status >= 500 ? 'SERVER_ERROR' : 'SERVER_ERROR',
        `HTTP ${res.status}: ${text.slice(0, 300)}`,
        res.status === 429 || res.status >= 500,
      );
    }
    return await res.json();
  } catch (e: any) {
    if (e instanceof LocalRequestError) throw e;
    if (e?.name === 'AbortError') throw new LocalRequestError('TIMEOUT', `Request timed out (${Math.round(timeoutMs / 1000)}s)`, true);
    throw new LocalRequestError('CONNECTION_FAILED', `Cannot reach ${url}: ${e?.message ?? e}`, true);
  } finally {
    clearTimeout(t);
  }
}

// ── Discovery ────────────────────────────────────────────────────────────────
// Prefers /v1/models (works on BOTH Ollama and llama.cpp — verified live), then
// enriches with Ollama-native /api/tags metadata when available (capabilities,
// context_length). llama.cpp-only extras (load status, modalities) come from
// /v1/models itself. Never throws: returns { ok:false, models:[], error }.

export async function discoverLocalModels(baseUrl: string, apiKey?: string, timeoutMs = 8000): Promise<LocalDiscovery> {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return { ok: false, models: [], error: 'empty base URL' };
  let v1: any = null;
  let v1Error = '';
  try {
    v1 = await fetchJson(modelsUrl(base), { headers: authHeaders(apiKey) }, timeoutMs);
  } catch (e: any) {
    v1Error = e?.message ?? String(e);
  }
  // Optional Ollama enrichment — failure here must not fail discovery (a
  // llama.cpp server has no /api/tags at all).
  let tags: any[] = [];
  try {
    const t = await fetchJson(`${base}/api/tags`, { headers: authHeaders(apiKey) }, Math.min(timeoutMs, 4000));
    if (Array.isArray(t?.models)) tags = t.models;
  } catch { /* not an Ollama server — fine */ }
  const tagsByName = new Map<string, any>();
  for (const m of tags) tagsByName.set(String(m?.name ?? m?.model ?? '').toLowerCase(), m);

  const out: LocalModelInfo[] = [];
  const v1models: any[] = Array.isArray(v1?.data) ? v1.data : [];
  if (v1models.length > 0) {
    for (const m of v1models) {
      const id = String(m?.id ?? '');
      if (!id) continue;
      const tag = tagsByName.get(id.toLowerCase());
      const info: LocalModelInfo = { id, vision: 'unknown', rawVendor: 'v1' };
      // llama.cpp router reports load status + modalities; Ollama's /v1/models does not.
      if (m?.status?.value === 'loaded') info.loaded = true;
      else if (m?.status?.value === 'unloaded') info.loaded = false;
      // llama.cpp reports input modalities explicitly — when the list is there and
      // has no 'image', that is a KNOWN negative, not an unknown (verified live:
      // gemma/Fara report ["text","image"], DeepSeek-V4-Flash reports ["text"]).
      const inputModalities: string[] = Array.isArray(m?.architecture?.input_modalities)
        ? m.architecture.input_modalities.map(String) : [];
      if (inputModalities.length > 0) {
        info.vision = inputModalities.includes('image') ? 'supported' : 'unsupported';
      }
      // Router-launched servers carry their llama-server argv; --ctx-size is the
      // allocation the model WILL get once loaded (the only context number
      // available while it is unloaded, since /props 400s on unloaded models).
      const ctxArg = ctxSizeFromArgs(m?.status?.args);
      if (ctxArg) { info.contextTokens = ctxArg; info.contextSource = 'configured'; }
      if (tag) enrichFromOllamaTag(info, tag);
      info.unsuitable = classifyUnsuitable(info.id, tag?.capabilities);
      out.push(info);
    }
    return { ok: true, models: out };
  }
  // No /v1/models (or it failed) — fall back to pure Ollama /api/tags.
  if (tags.length > 0) {
    for (const t of tags) {
      const id = String(t?.name ?? t?.model ?? '');
      if (!id) continue;
      const info: LocalModelInfo = { id, vision: 'unknown', rawVendor: 'ollama-tags' };
      enrichFromOllamaTag(info, t);
      info.unsuitable = classifyUnsuitable(id, t?.capabilities);
      out.push(info);
    }
    return { ok: true, models: out };
  }
  return { ok: false, models: [], error: v1Error || 'no models reported' };
}

/** Pull `--ctx-size N` (or `-c N`) out of a llama.cpp router's recorded argv. */
function ctxSizeFromArgs(args: unknown): number | undefined {
  if (!Array.isArray(args)) return undefined;
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '--ctx-size' || args[i] === '-c') {
      const n = Number(args[i + 1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

function enrichFromOllamaTag(info: LocalModelInfo, tag: any): void {
  const caps: string[] = Array.isArray(tag?.capabilities) ? tag.capabilities.map(String) : [];
  if (caps.includes('vision')) info.vision = 'supported';
  else if (caps.length > 0 && !caps.includes('vision') && (caps.includes('completion') || caps.includes('tools'))) {
    info.vision = 'unsupported';
  }
  const ctx = Number(tag?.details?.context_length);
  if (Number.isFinite(ctx) && ctx > 0) {
    // Nominal (trained) context from the model registry — NOT a confirmed
    // runtime allocation. Marked configured, never runtime.
    info.contextTokens = ctx;
    info.contextSource = 'configured';
  }
}

function classifyUnsuitable(id: string, capabilities?: string[]): LocalModelInfo['unsuitable'] {
  const caps = (capabilities || []).map(String);
  if (caps.length > 0) {
    if (caps.includes('embedding') && !caps.includes('completion') && !caps.includes('tools')) return 'embedding';
    if (caps.includes('image') && !caps.includes('completion') && !caps.includes('tools')) return 'image';
    return undefined;
  }
  // Without capability metadata, match obvious embedding/image names only.
  if (/embed/i.test(id)) return 'embedding';
  return undefined;
}

// ── Runtime context detection (Auto) ─────────────────────────────────────────
// Ollama: GET /api/ps → running model's `context_length` = ACTUAL allocation.
//   (Verified live: qwen3:4b-instruct → 262144 while loaded.)
// llama.cpp: GET /props?model=<url-encoded id>&autoload=false →
//   default_generation_settings.n_ctx. autoload=false is REQUIRED so discovery
//   never loads/evicts models as a side effect. Router-level n_ctx:0 means
//   UNKNOWN, never zero/unlimited.

export interface RuntimeContext {
  tokens?: number;
  source: ContextSource | 'unknown';
}

export async function detectRuntimeContext(
  provider: LocalProvider, baseUrl: string, modelId: string, apiKey?: string, timeoutMs = 8000,
): Promise<RuntimeContext> {
  const base = normalizeBaseUrl(baseUrl);
  if (!base || !modelId) return { source: 'unknown' };
  if (provider === 'ollama') {
    try {
      const ps = await fetchJson(`${base}/api/ps`, { headers: authHeaders(apiKey) }, timeoutMs);
      const running: any[] = Array.isArray(ps?.models) ? ps.models : [];
      const hit = running.find(m => String(m?.name ?? m?.model ?? '').toLowerCase() === modelId.toLowerCase())
        ?? running.find(m => String(m?.model ?? '').toLowerCase().split(':')[0] === modelId.toLowerCase().split(':')[0]);
      const ctx = Number(hit?.context_length);
      if (hit && Number.isFinite(ctx) && ctx > 0) return { tokens: ctx, source: 'runtime' };
    } catch { /* fall through to unknown */ }
    return { source: 'unknown' };
  }
  // openai-compatible → llama.cpp props (LM Studio/vLLM simply won't have it).
  try {
    const url = `${base}/props?model=${encodeURIComponent(modelId)}&autoload=false`;
    const props = await fetchJson(url, { headers: authHeaders(apiKey) }, timeoutMs);
    const nctx = Number(props?.default_generation_settings?.n_ctx);
    if (Number.isFinite(nctx) && nctx > 0) return { tokens: nctx, source: 'runtime' };
  } catch { /* not llama.cpp or model unknown — fall through */ }
  return { source: 'unknown' };
}

// ── Connection test (explicit, never warms/loads) ───────────────────────────

export interface ConnectionTest {
  ok: boolean;
  reachable: boolean;
  modelsFound: number;
  error?: string;
}

/** Lightweight check: is something answering at this base URL? Uses discovery
 *  endpoints only — never runs inference, never loads a model. */
export async function testLocalConnection(baseUrl: string, apiKey?: string): Promise<ConnectionTest> {
  const d = await discoverLocalModels(baseUrl, apiKey, 6000);
  return {
    ok: d.ok,
    reachable: d.ok || (d.error ? !/cannot reach|econnrefused|enotfound|timed out/i.test(d.error) : false),
    modelsFound: d.models.length,
    error: d.ok ? undefined : d.error,
  };
}

// ── Context budgeting ────────────────────────────────────────────────────────
// Conservative estimator: ~4 chars/token for text (never presented as exact),
// ~1500 tokens per attached image. The estimate is ALWAYS labeled approximate
// at the call site; prefer server usage numbers when available.

export function estimateTokens(text: string, imageCount = 0): number {
  return Math.ceil((text || '').length / 4) + imageCount * 1500;
}

export interface ContextBudget {
  /** Total window in tokens (runtime-detected, configured, or fallback). */
  totalTokens: number;
  /** Reserved for the model's reply INCLUDING reasoning tokens. */
  maxOutputTokens: number;
  /** Safety margin kept free. */
  marginTokens?: number;
}

const OBS_MARKERS = {
  pageText: 'PAGE TEXT:',
  ocr: 'OCR TEXT',
  history: 'RECENT HISTORY:',
} as const;

/** Fit an assembled agent observation into budget by trimming the variable
 *  sections first (page text, then history), NEVER the interactive-element
 *  list. Returns the fitted text + whether anything was trimmed. */
export function applyContextBudget(observedState: string, budget: ContextBudget): { text: string; trimmed: boolean } {
  const margin = budget.marginTokens ?? 512;
  const allowed = Math.max(0, budget.totalTokens - budget.maxOutputTokens - margin);
  if (!observedState || estimateTokens(observedState) <= allowed) return { text: observedState, trimmed: false };

  let text = observedState;
  // Trim PAGE TEXT block first (keep head + tail would lose refs; keep head).
  text = trimMarkedSection(text, OBS_MARKERS.pageText, [OBS_MARKERS.ocr, OBS_MARKERS.history], allowed);
  if (estimateTokens(text) <= allowed) return { text: text + '\n[context trimmed: page text shortened]', trimmed: true };
  // Then RECENT HISTORY (keep the TAIL — most recent steps matter most).
  text = trimHistoryTail(text, allowed);
  if (estimateTokens(text) <= allowed) return { text: text + '\n[context trimmed: history shortened]', trimmed: true };
  // Last resort: hard cut preserving head (elements) — still never fabricate.
  const approxChars = allowed * 4;
  return { text: text.slice(0, Math.max(0, approxChars)) + '\n[context trimmed: observation truncated]', trimmed: true };
}

function trimMarkedSection(text: string, startMarker: string, endMarkers: string[], allowedTokens: number): string {
  const si = text.indexOf(startMarker);
  if (si < 0) return text;
  let ei = -1;
  for (const em of endMarkers) {
    const i = text.indexOf(em, si + startMarker.length);
    if (i >= 0 && (ei < 0 || i < ei)) ei = i;
  }
  const end = ei >= 0 ? ei : text.length;
  // Halve the kept section until it fits. Every candidate is rebuilt from the
  // ORIGINAL head/section/tail: si and end index into the text we were given, so
  // reassigning `text` inside the loop (as this used to) made the next slice cut
  // at a stale offset — corrupting the section boundary and eating part of the
  // head, which is exactly the interactive-element list we promise never to trim.
  const head = text.slice(0, si);
  const section = text.slice(si, end);
  const tail = text.slice(end);
  const build = (keep: number) => head + section.slice(0, keep) + '…[trimmed]\n' + tail;
  let keep = section.length;
  let best = text;
  while (keep > 500) {
    keep = Math.floor(keep / 2);
    best = build(keep);
    if (estimateTokens(best) <= allowedTokens) break;
  }
  return best;
}

function trimHistoryTail(text: string, allowedTokens: number): string {
  const hi = text.indexOf(OBS_MARKERS.history);
  if (hi < 0) return text;
  const head = text.slice(0, hi + OBS_MARKERS.history.length);
  let tail = text.slice(hi + OBS_MARKERS.history.length);
  // Drop oldest lines first.
  while (estimateTokens(head + tail) > allowedTokens && tail.length > 500) {
    const nl = tail.indexOf('\n');
    if (nl < 0) break;
    tail = tail.slice(nl + 1);
  }
  return head + '\n[…earlier history trimmed]\n' + tail;
}
