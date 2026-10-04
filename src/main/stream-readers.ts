// stream-readers.ts — consume a streamed local/cloud answer, chunk by chunk.
// Moved out of ai-engine.ts so it can be exercised against a real HTTP server
// (node --test, no Electron). Emits deltas as they arrive and returns the full text.
import { LocalRequestError } from './local-providers.ts';
import { ThinkingBudget } from './thinking-budget.ts';
import { CLOUD_INACTIVITY_MS } from './cancellable-fetch.ts';
/** One read with the right clock. Until the first token, the deadline is the time left of
 *  firstTokenMs (load + prompt processing): keepalive chunks (oMLX sends one every ~10s
 *  while it processes the prompt) prove the socket is up, not that the model is answering.
 *  After the first token, silence longer than inactivityMs means the stream is dead. */
function readWithClock(reader: any, o: { sawToken: boolean; inactivityMs: number; firstDeadline: number }): Promise<{ done: boolean; value?: Uint8Array }> {
  const preToken = !o.sawToken && o.firstDeadline > 0;
  const ms = preToken ? Math.max(1, o.firstDeadline - Date.now()) : o.inactivityMs;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(preToken
      ? new LocalRequestError('TIMEOUT_FIRST_CHUNK', 'the model produced no token in time (still loading or processing the prompt)', true)
      : new LocalRequestError('TIMEOUT_STALL', `stream stalled (${Math.round(o.inactivityMs / 1000)}s)`, true)), ms);
    Promise.resolve(reader.read()).then(
      (r: any) => { if (timer) clearTimeout(timer); resolve(r); },
      (e: any) => { if (timer) clearTimeout(timer); reject(e); },
    );
  });
}

// Lê um corpo SSE OpenAI-compatible (stream:true) e emite os deltas conforme chegam.
// Devolve o texto COMPLETO no fim.
// Modelos de raciocínio (DeepSeek-V4, Fara…) mandam o pensamento num canal SEPARADO
// (delta.reasoning_content). Embrulhamos em <think>…</think> pro renderer exibir o
// chip 💭 — o MESMO padrão do reader NDJSON do Ollama. O retorno (histórico) fica
// LIMPO: só o content, sem o raciocínio vazado (a UI já mostrou os chips via onDelta).
// Guarda de inatividade: sem chunk por inactivityMs → aborta (stream pendurado não congela o chat).
export async function readSseStream(res: Response, onDelta: (d: string) => void, signal?: AbortSignal, inactivityMs = CLOUD_INACTIVITY_MS, thinking?: ThinkingBudget, metrics?: { usage?: any; finish?: string }, firstTokenMs?: number): Promise<string> {
  const firstDeadline = firstTokenMs ? Date.now() + firstTokenMs : 0;
  let sawToken = false;
  const reader = (res.body as any)?.getReader?.();
  // No body on a 200 is a server fault, not an empty answer: say so with a code.
  if (!reader) throw new LocalRequestError('STREAM_ERROR', 'server sent no response body to stream', true);
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let thinkOpen = false;
  const flushThink = () => { try { onDelta('</think>'); } catch {} thinkOpen = false; };
  const emitThink = (d: string) => {
    if (!d) return;
    if (!thinkOpen) { try { onDelta('<think>'); } catch {} thinkOpen = true; }
    try { onDelta(d); } catch {}
  };
  let emitted = 0;
  let thinkingText = '';
  // Emit the accumulated content without splitting a surrogate pair (emoji) in half.
  // The old guard tested target < full.length immediately after target = full.length:
  // never true, so the pair was still cut in half. Now, when the text ends on a lead
  // surrogate (0xD800-0xDBFF) with no pair, that char is held back until the next delta
  // brings the trail. final=true releases whatever is left at end of stream - there the
  // lead really is orphaned, and showing a broken char beats swallowing text.
  const emitUpTo = (final = false) => {
    let target = full.length;
    if (!final && target > emitted) {
      const c = full.charCodeAt(target - 1);
      if (c >= 0xD800 && c <= 0xDBFF) target -= 1;
    }
    if (target > emitted) { try { onDelta(full.slice(emitted, target)); } catch {} emitted = target; }
  };
  // Cancelamento (botão Parar): o listener de abort do fetch some quando os headers
  // chegam, então aqui, DURANTE o corpo do stream, cancelamos o reader na mão — sem isto
  // o Stop no meio do streaming deixava o modelo gerar até o fim e gravava turno-fantasma.
  const onAbort = () => { try { reader.cancel(); } catch {} };
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  try {
    while (true) {
      if (signal?.aborted) throw new Error('CANCELLED');
      const chunk = await readWithClock(reader, { sawToken, inactivityMs, firstDeadline });
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') { emitUpTo(true); if (thinkOpen) flushThink(); return full; }
        let j: any = null;
        try { j = JSON.parse(payload); } catch { /* linha parcial/keep-alive — ignora */ }
        if (!j) continue;
        // An error inside a 200 stream: HTTP said OK, the payload says otherwise. Surface it
        // instead of returning a silent empty answer.
        if (j.error) {
          const msg = typeof j.error === 'string' ? j.error : (j.error?.message ?? JSON.stringify(j.error));
          throw new LocalRequestError('INSTREAM_ERROR', `stream carried an error: ${String(msg).slice(0, 300)}`,
            !/invalid|unsupported|context length|content policy/i.test(String(msg)), { raw: j.error });
        }
        if (j.choices?.[0]?.finish_reason && metrics) metrics.finish = j.choices[0].finish_reason;
        const dl = j.choices?.[0]?.delta;
        if (j.usage && metrics) metrics.usage = j.usage;
        // llama.cpp/oMLX name the channel reasoning_content; vLLM and LM Studio use reasoning.
        const rc = dl?.reasoning_content ?? dl?.reasoning ?? '';
        const d = dl?.content ?? '';
        if (rc || d) sawToken = true;
        if (rc) {
          emitThink(rc);
          // Soft budget, in characters (usage only arrives in the final chunk) and only while
          // there is no answer yet.
          thinkingText += rc;
          const cut = thinking?.check(thinkingText, !!full);
          if (cut) throw new LocalRequestError('THINKING_BUDGET', `local thinking cut (${cut}) after ${thinkingText.length} chars with no answer`, true);
        }
        if (d) {
          if (thinkOpen) flushThink();
          full += d; emitUpTo();
        }
      }
    }
  } catch (e) {
    try { await reader.cancel(); } catch {}   // fecha a conexão de verdade (não deixa o socket pendurado)
    throw e;
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    try { reader.releaseLock?.(); } catch {}
  }
  if (signal?.aborted) throw new Error('CANCELLED');   // reader.cancel() resolve done → garante o throw
  emitUpTo(true);   // stream over: release a held lead surrogate, if any
  if (thinkOpen) flushThink();   // fecha o bloco de raciocínio que ainda estava aberto
  return full;
}

// Lê um corpo de stream do OLLAMA (stream:true): NDJSON — um objeto JSON por linha
// ({message:{content}} até done:true), NÃO é SSE. Mesmo padrão de robustez do
// readSseStream: guarda de 30s por chunk + cancel no erro. Modelos de raciocínio
// (qwen3 etc.) podem mandar o pensamento em message.thinking — embrulhamos em
// <think>…</think> pra o renderer exibir igual ao caso dos tags inline no content.
export async function readOllamaNdjson(res: Response, onDelta: (d: string) => void, signal?: AbortSignal, inactivityMs = CLOUD_INACTIVITY_MS, thinking?: ThinkingBudget, metrics?: { usage?: any; finish?: string }, firstTokenMs?: number): Promise<string> {
  const firstDeadline = firstTokenMs ? Date.now() + firstTokenMs : 0;
  let sawToken = false;
  const reader = (res.body as any)?.getReader?.();
  if (!reader) throw new LocalRequestError('STREAM_ERROR', 'server sent no response body to stream', true);
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let thinkingText = '';
  let contentChars = 0;
  let thinkOpen = false;
  // Same surrogate-pair guard as readSseStream: an emoji can straddle two tokens, and
  // JSON.parse('"\\ud83d"') yields a lone lead - valid in JS, broken on screen.
  let pendingLead = '';
  const safeEmit = (d: string) => {
    let out = pendingLead + d;
    pendingLead = '';
    const last = out.charCodeAt(out.length - 1);
    if (out.length > 0 && last >= 0xD800 && last <= 0xDBFF) { pendingLead = out.slice(-1); out = out.slice(0, -1); }
    if (out) { try { onDelta(out); } catch {} }
  };
  // End of stream: whatever is still held really is an orphan lead - show it.
  const flushLead = () => { if (pendingLead) { const q = pendingLead; pendingLead = ''; try { onDelta(q); } catch {} } };
  const emit = (d: string) => { if (d) { full += d; safeEmit(d); } };
  // Cancelamento (Parar): cancela o reader na mão — senão o Ollama segue gerando na GPU
  // até o fim mesmo depois do Stop, e o turno-fantasma vai pro histórico.
  const onAbort = () => { try { reader.cancel(); } catch {} };
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  try {
    while (true) {
      if (signal?.aborted) throw new Error('CANCELLED');
      const chunk = await readWithClock(reader, { sawToken, inactivityMs, firstDeadline });
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let j: any = null;
        let th = '';
        let d = '';
        try {
          j = JSON.parse(line);
          th = j.message?.thinking ?? '';
          if (th) { if (!thinkOpen) { emit('<think>'); thinkOpen = true; } emit(th); }
          d = j.message?.content ?? '';
          if (th || d) sawToken = true;
          if (metrics && j.done_reason) metrics.finish = j.done_reason;
          if (metrics && (j.eval_count || j.prompt_eval_count)) {
            metrics.usage = { completion_tokens: j.eval_count, prompt_tokens: j.prompt_eval_count, reasoning_tokens: j.thinking_eval_count };
          }
          if (d) { if (thinkOpen) { emit('</think>'); thinkOpen = false; } emit(d); }
          if (j.done === true) { if (thinkOpen) { emit('</think>'); thinkOpen = false; } flushLead(); return full; }
        } catch { /* linha parcial — ignora */ }
        if (j?.error) {
          const msg = typeof j.error === 'string' ? j.error : (j.error?.message ?? JSON.stringify(j.error));
          throw new LocalRequestError('INSTREAM_ERROR', `stream carried an error: ${String(msg).slice(0, 300)}`,
            !/invalid|unsupported|context length|content policy/i.test(String(msg)), { raw: j.error });
        }
        if (d) contentChars += d.length;
        if (th) {
          thinkingText += th;
          // full also carries the thinking tags here, so "has an answer" is contentChars.
          const cut = thinking?.check(thinkingText, contentChars > 0);
          if (cut) throw new LocalRequestError('THINKING_BUDGET', `local thinking cut (${cut}) after ${thinkingText.length} chars with no answer`, true);
        }
      }
    }
  } catch (e) {
    try { await reader.cancel(); } catch {}
    throw e;
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    try { reader.releaseLock?.(); } catch {}
  }
  if (signal?.aborted) throw new Error('CANCELLED');
  if (thinkOpen) emit('</think>');
  flushLead();
  return full;
}


export interface LiveMetrics {
  kind: 'thinking' | 'answer';
  estTokens: number;
  tokPerSec: number;
  elapsedMs: number;
  exact: boolean;
}

/** Live progress for one streamed call. Counts are cumulative (estimated from characters
 *  until the usage chunk makes them exact), reports are throttled to ~1/s, and the rate is
 *  measured from the first token: model load and prompt processing are not generation speed. */
export function createLiveMeter(send: (m: LiveMetrics) => void, now: () => number = Date.now) {
  const t0 = now();
  let chars = 0, firstAt = 0, lastAt = 0, inThink = false;
  const emit = (m: LiveMetrics) => { try { send(m); } catch { /* UI only */ } };
  return {
    add(d: string): void {
      if (d === '<think>') { inThink = true; return; }
      if (d === '</think>') { inThink = false; return; }
      if (!d) return;
      const t = now();
      if (!firstAt) firstAt = t;
      chars += d.length;
      if (t - lastAt < 1000) return;
      lastAt = t;
      const est = Math.round(chars / 3.5);
      const secs = Math.max(0.5, (t - firstAt) / 1000);
      emit({ kind: inThink ? 'thinking' : 'answer', estTokens: est, tokPerSec: Math.round(est / secs), elapsedMs: t - t0, exact: false });
    },
    /** Final report: the server's own numbers when it sent usage. */
    done(usage?: any): void {
      const t = now();
      const exact = !!usage?.completion_tokens;
      const tokens = exact ? Math.round(usage.completion_tokens) : Math.round(chars / 3.5);
      const genSecs = firstAt ? Math.max(0.001, (t - firstAt) / 1000) : 0;
      const tps = Number(usage?.generation_tokens_per_second) || (genSecs ? tokens / genSecs : 0);
      emit({ kind: 'answer', estTokens: tokens, tokPerSec: Math.round(tps), elapsedMs: t - t0, exact });
    },
  };
}
