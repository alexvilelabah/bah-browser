export type AIProvider = 'anthropic' | 'openai' | 'deepseek' | 'mistral' | 'nvidia' | 'ollama';

import {
  normalizeBaseUrl as _normalizeBaseUrl,
  discoverLocalModels as _discoverLocalModels,
  detectRuntimeContext as _detectRuntimeContext,
  applyContextBudget as _applyContextBudget,
  LocalRequestError,
  type LocalModelInfo as _LocalModelInfo,
  type LocalProvider as _LocalTransport,
} from './local-providers';
import {
  fetchCancellable, shouldStream, streamKey, sleep,
  LOCAL_FIRST_CHUNK_MS, LOCAL_TOTAL_MS, LOCAL_INACTIVITY_MS,
  CLOUD_FIRST_CHUNK_MS, CLOUD_BODY_MS, CLOUD_INACTIVITY_MS,
} from './cancellable-fetch';
import { ThinkingBudget, THINKING_TOKENS_SOFT, THINKING_SECONDS_SOFT } from './thinking-budget';
import {
  NO_IMAGE_PROVIDERS,
  RX_IMAGE_REJECTED,
  VISION_MAX_BYTES,
  base64Head,
  encodedImageSize,
  estimateImageTokens,
  resolveVisionMode,
  splitDataUrl,
  stripImages,
  type VisionImage,
  type VisionMode,
  type VisionReport,
} from '../shared/vision';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  image?: VisionImage;
}

/** Per-endpoint local tuning (context / output / vision). Everything is optional:
 *  with nothing configured the behaviour is exactly what it was before. */
export interface LocalEndpointOpts {
  contextMode?: 'auto' | 'custom';   // default 'auto' (detect from the server)
  contextTokens?: number;            // used when contextMode === 'custom'
  maxOutputTokens?: number;          // reply budget, reasoning tokens included
  vision?: boolean;                  // legacy opt-in (true → 'auto')
  visionMode?: VisionMode;           // off | auto | always
  visionMaxBytes?: number;         // encoded bytes cap per image
  /** Ollama server-side allocation: undefined = 16384 (legacy), 'auto' omits
   *  num_ctx so the server decides, a number = explicit allocation. */
  ollamaNumCtx?: 'auto' | number;
}

// fetch com timeout via AbortController: o timeout ABORTA a request de verdade
// (≠ Promise.race, que rejeita mas deixa o socket vivo / a request rodando). Re-lança como
// erro de "timeout" pra o retry/fallback que já existe nos provedores reconhecerem.
async function fetchWithTimeout(url: string, opts: any, ms: number, signal?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  // Cancelamento EXTERNO (botão Parar do chat): o signal do chamador aborta o mesmo
  // controller do timeout — qualquer um dos dois derruba o fetch de verdade (socket).
  const onAbort = () => { try { ctrl.abort(); } catch {} };
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      if (signal?.aborted) throw new Error('CANCELLED');
      throw new Error(`Request timeout (${Math.round(ms / 1000)}s)`);
    }
    throw e;
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// Lê um corpo SSE OpenAI-compatible (stream:true) e emite os deltas conforme chegam.
// Devolve o texto COMPLETO no fim.
// Modelos de raciocínio (DeepSeek-V4, Fara…) mandam o pensamento num canal SEPARADO
// (delta.reasoning_content). Embrulhamos em <think>…</think> pro renderer exibir o
// chip 💭 — o MESMO padrão do reader NDJSON do Ollama. O retorno (histórico) fica
// LIMPO: só o content, sem o raciocínio vazado (a UI já mostrou os chips via onDelta).
// Guarda de inatividade: sem chunk por inactivityMs → aborta (stream pendurado não congela o chat).
async function readSseStream(res: Response, onDelta: (d: string) => void, signal?: AbortSignal, inactivityMs = CLOUD_INACTIVITY_MS, thinking?: ThinkingBudget, metrics?: { usage?: any }): Promise<string> {
  const reader = (res.body as any)?.getReader?.();
  if (!reader) throw new Error('stream unsupported');
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
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    while (true) {
      if (signal?.aborted) throw new Error('CANCELLED');
      // Timer limpo a CADA leitura (senão um stream longo acumula um timer de 30s por chunk).
      const chunk = await new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => {
        stallTimer = setTimeout(() => reject(new LocalRequestError('TIMEOUT_STALL', `stream stalled (${Math.round(inactivityMs / 1000)}s)`, true)), inactivityMs);
        Promise.resolve(reader.read()).then(
          (r: any) => { if (stallTimer) clearTimeout(stallTimer); resolve(r); },
          (e: any) => { if (stallTimer) clearTimeout(stallTimer); reject(e); },
        );
      });
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
        const dl = j.choices?.[0]?.delta;
        if (j.usage && metrics) metrics.usage = j.usage;
        const rc = dl?.reasoning_content ?? '';
        const d = dl?.content ?? '';
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
    if (stallTimer) clearTimeout(stallTimer);
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
async function readOllamaNdjson(res: Response, onDelta: (d: string) => void, signal?: AbortSignal, inactivityMs = CLOUD_INACTIVITY_MS, thinking?: ThinkingBudget, metrics?: { usage?: any }): Promise<string> {
  const reader = (res.body as any)?.getReader?.();
  if (!reader) throw new Error('stream unsupported');
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
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    while (true) {
      if (signal?.aborted) throw new Error('CANCELLED');
      const chunk = await new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => {
        stallTimer = setTimeout(() => reject(new LocalRequestError('TIMEOUT_STALL', `stream stalled (${Math.round(inactivityMs / 1000)}s)`, true)), inactivityMs);
        Promise.resolve(reader.read()).then(
          (r: any) => { if (stallTimer) clearTimeout(stallTimer); resolve(r); },
          (e: any) => { if (stallTimer) clearTimeout(stallTimer); reject(e); },
        );
      });
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
          if (metrics && (j.eval_count || j.prompt_eval_count)) {
            metrics.usage = { completion_tokens: j.eval_count, prompt_tokens: j.prompt_eval_count, reasoning_tokens: j.thinking_eval_count };
          }
          if (d) { if (thinkOpen) { emit('</think>'); thinkOpen = false; } emit(d); }
          if (j.done === true) { if (thinkOpen) { emit('</think>'); thinkOpen = false; } flushLead(); return full; }
        } catch { /* linha parcial — ignora */ }
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
    if (stallTimer) clearTimeout(stallTimer);
    if (signal) signal.removeEventListener('abort', onAbort);
    try { reader.releaseLock?.(); } catch {}
  }
  if (signal?.aborted) throw new Error('CANCELLED');
  if (thinkOpen) emit('</think>');
  flushLead();
  return full;
}

// Remove o raciocínio (<think>…</think>) de uma resposta de modelo de raciocínio,
// cobrindo também o `</think>` órfão (template que já abre o bloco). Usado no
// histórico de conversa e nos retornos stateless (classificador/pesquisa/monitores),
// que consomem a resposta como DADO — pensamento vazado quebraria o parse deles.
function stripThink(s: string): string {
  if (!s || (!s.includes('<think>') && !s.includes('</think>'))) return s;
  return s.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*?<\/think>/, '').trim();
}

// Limpa vazamentos de raciocínio no content de um provedor OpenAI-compatible em modo
// agente, SEM usar stripThink às cegas no JSON. Ordem: (1) tags <think>…</think> se
// vazaram no content; (2) marcador órfão DEPOIS do objeto (Fara: "}\n response") — só
// remove se vier depois de um `}`; (3) prefixo de raciocínio ANTES do primeiro `{`.
function stripReasoningMarkers(s: string): string {
  if (!s) return s;
  let r = stripThink(s).trim();
  // Marcador órfão no fim (Fara): exige o `}` pra não comer um JSON que termina em "response".
  r = r.replace(/(\})\s* response\s*$/, '$1');
  const brace = r.indexOf('{');
  if (brace > 0) {
    const prefix = r.slice(0, brace);
    if (/think|response/i.test(prefix)) r = r.slice(brace);
  }
  return r.trim();
}

/**
 * Limpa texto raspado antes de virar JSON pro provedor de IA. Páginas (YouTube,
 * redes) têm emojis = pares surrogate UTF-16; quando o texto é cortado (.slice)
 * no meio de um par, sobra um surrogate ÓRFÃO. JSON.stringify o vira um escape
 * "\udXXX" desemparelhado, e o parser estrito do DeepSeek rejeita
 * ("unexpected end of hex escape" → HTTP 400). Removemos surrogates órfãos e
 * caracteres de controle crus. Pares válidos (emojis inteiros) passam normalmente.
 */
function sanitizeForJson(s: string): string {
  if (!s) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) continue; // controle cru (mantem tab/nl/cr)
    if (c >= 0xD800 && c <= 0xDBFF) {                          // high surrogate
      const n = s.charCodeAt(i + 1);
      if (n >= 0xDC00 && n <= 0xDFFF) { out += s[i] + s[i + 1]; i++; continue; } // par valido
      continue;                                                // high orfao -> remove
    }
    if (c >= 0xDC00 && c <= 0xDFFF) continue;                  // low orfao -> remove
    out += s[i];
  }
  return out;
}

const BROWSER_AGENT_SYSTEM_PROMPT = `You are an AI browser agent embedded in a web browser. You operate the page by choosing exactly one structured browser tool per step.

You MUST return ONLY a JSON object with this EXACT shape — no other keys, no nested wrappers, no arrays:
{
  "evaluation": "Success | Failed | Unknown — short judgement of whether YOUR PREVIOUS action achieved its goal",
  "thought": "Brief explanation of the next step",
  "action": "click_text",
  "text": "Gmail"
}

The "evaluation" key is REQUIRED. Before choosing the next action, look at RECENT HISTORY and the current page and honestly judge your PREVIOUS action: did it work? Start it with one of: "Success", "Failed", or "Unknown", followed by a short reason (e.g. "Failed — the page did not change, the button was probably an ad"). On the very first step write "Unknown — first step". This self-check is mandatory and helps you avoid repeating mistakes.

The "action" key is REQUIRED and must be a string matching one of the tool names below. Any additional parameters required by the tool must be flat properties at the root of the JSON object alongside "evaluation", "thought" and "action". NEVER nest parameters inside the action key. If you have nothing to do, use action: "done" and provide a "reason" and "success" boolean.

OPTIONAL FAST MODE — batching multiple actions in one step:
When you are CONFIDENT about a short sequence of actions on the SAME page that won't need re-thinking, you MAY return an "actions" array instead of a single action, to run them in sequence without another round-trip. Each item is a full action object with its own "action" key and flat params:
{
  "evaluation": "...",
  "thought": "Fill the search box and submit",
  "actions": [
    { "action": "fill_ref", "ref": 3, "value": "snoop dogg" },
    { "action": "press", "key": "Enter" }
  ]
}
Rules for "actions":
- Only batch 2-4 SAFE, predictable steps on the SAME page (e.g. fill then Enter, or fill several form fields in a row).
- Only these types may be batched: fill_ref, fill, type, press, click_ref, click_text, scroll.
- Do NOT batch navigations, new_tab, switch_tab, done, report, or anything whose RESULT you must see before deciding the next step. For those, return a single action.
- The system stops the batch automatically if the page changes or an element disappears, then re-thinks. If unsure, just return ONE action.

Never generate JavaScript, CSS selectors unless using the fill tool selector field, or invented function names. The browser will execute only these action types:
- switch_tab: { "action": "switch_tab", "tab": number } — focus another open tab by its number from the TABS list.
- new_tab: { "action": "new_tab", "url": string } — open a new tab on the given URL.
- close_tab: { "action": "close_tab", "tab": number } — close a tab by its number.
- plan: { "action": "plan", "steps": string[] } — EMIT FIRST on complex/multi-step tasks. List the steps you'll take.
- store: { "action": "store", "key": string, "value": any, "source"?: string } — save extracted data into agent MEMORY.
- extract_text: { "action": "extract_text", "max_chars"?: number } — extracts the MAIN CONTENT of the page (Readability-style: picks the densest text block, strips ads/nav/sidebar/footer) and returns it as clean Markdown (# headings, - lists). Token-efficient — use it for reading/summarizing articles and pages.
- search_images: { "action": "search_images", "query": string, "min_width"?: number, "count"?: number } — PREFERRED way to find images. Searches free high-resolution, rights-clean image APIs (Creative Commons / Wikimedia) and returns DIRECT downloadable URLs with real dimensions into your history ("IMAGES FOUND"). No page navigation needed. Then use download with the [imgN] URLs.
- extract_images: { "action": "extract_images", "min_width"?: number } — lists the <img> elements of the CURRENT page. Only use when the user wants an image from a SPECIFIC website they named; otherwise use search_images.
- harvest_images: { "action": "harvest_images", "query": string, "count"?: number, "min_width"?: number } — image harvest: scrapes a search engine (DuckDuckGo/Bing) and downloads N images (1 to 100) into Downloads/<theme>/ in parallel. Use for "baixe N imagens de X", "quero 20 fotos de Y". Set min_width 1000 for "alta qualidade/HD". One action does everything (harvest + parallel download), shows thumbnails and auto-finishes. Prefer this whenever the user wants to DOWNLOAD images.
- generate_image: { "action": "generate_image", "prompt": string, "count"?: 1-4 } — GENERATES new images from a text description (Pollinations, free, no key). For "gere/crie/desenhe uma imagem de X", "generate an image of Y". Saves to Downloads and shows thumbnails; one action, auto-finishes. This CREATES images — different from harvest_images, which downloads EXISTING ones from search.
- download: { "action": "download", "url": string, "filename"?: string } — downloads a file (image, pdf, etc.) from a direct URL into the user's Downloads folder. Executable files are blocked. Use the URLs returned by extract_images. May be batched in "actions" to download several files in one step.
- download_video: { "action": "download_video", "query"?: string, "url"?: string, "audio_only"?: boolean, "count"?: number } — downloads a video/song. BEST: pass "query" (e.g. the song/video name) and it finds AND downloads the top YouTube result directly — no need to open YouTube or click results. Or pass "url", or omit both to grab the currently open tab. Set audio_only:true to save as mp3 (for "baixar música/áudio"). Set count:N to grab the top N results (for "baixe 3 músicas do X"). Video downloads at the BEST available quality of that video BY DEFAULT — only set "quality":"low" if the user explicitly asks for low resolution ("baixa resolução"). Live progress bar; the task auto-finishes on success.
- open_video: { "action": "open_video", "query": string } — opens and PLAYS the single best REAL YouTube video for the query, skipping Shorts/very-short clips (resolves it server-side, then navigates the tab to the watch page). Use for "mostre/abra/toque um vídeo de X", "toque uma música do Y", "mostre alguém fazendo Z". One action, auto-finishes. NEVER just dump the user on a YouTube search results page for these — the top results are Shorts; use open_video instead.
- create_playlist: { "action": "create_playlist", "songs": string[], "name"?: string, "private"?: boolean } — builds a YouTube playlist that PLAYS IMMEDIATELY from a list of songs YOU name. For "crie/monte uma playlist com as N músicas [mais antigas/melhores/mais tocadas] de ARTISTA": use YOUR music knowledge to fill "songs" with the actual N real song titles in the requested order (e.g. oldest-first), each prefixed with the artist for accurate matching, e.g. ["2Pac Brenda's Got a Baby","2Pac Trapped","2Pac If My Homie Calls", ...]. If the user asks for ALL the songs ("todas as músicas", "all songs", "a discografia"), list as MANY real titles as you know — dozens, not a handful (the system builds them one-by-one and the user can stop anytime). If the user gave a NAME for the playlist (e.g. "com o nome i.a", "chamada X") put it in "name". If the user wants it PRIVATE/particular/privada, set "private": true. The system resolves each title to a real video (skipping Shorts), builds the playlist playing, and — when a name is given or the user asked to save — SAVES it to the logged-in account (renaming + setting privacy via the YouTube UI). Emit this as a SINGLE action. After it, the page is on the playlist: if RECENT HISTORY says the save still needs a step, follow that instruction; otherwise you're done.
- open_video_cuts: { "action": "open_video_cuts", "phrase": "...", "count"?: N (default 4) } — finds YouTube videos where the PHRASE IS SPOKEN (subtitle index search) and opens each one in a BACKGROUND tab, PAUSED and muted at the EXACT second it is said; when the user clicks the tab, the video plays from that moment. Use for supercut/edição requests like "faça um supercut de X", "abrir vídeos onde falam X", "achar quem disse Y". One action does everything; the task auto-finishes.
- render_view:{ "action": "render_view", "title": "...", "columns": ["A","B"], "rows": [["x",1],["y",2]], "chart"?: { "type":"bar", "label":"...", "labels":[...], "values":[...] }, "subtitle"?, "source_note"? } — renders the data as a BEAUTIFUL local page (sortable table + search + bar chart, dark theme) opened in a new tab. WHENEVER the user asks for a table/ranking/comparison/statistics, gather the data first (extract_text, Google) and finish with render_view — NEVER dump a table as chat text. Keep rows ≤ 40 when you type them yourself.
- stock_movers: { "action": "stock_movers", "direction": "gainers"|"losers", "count"?: N } — fetches today's top stock gainers/losers DIRECTLY from free finance APIs (B3 first, US fallback) and opens the rendered table+chart page. For any "ações que mais subiram/caíram" request use THIS as the single first action — never browse finance sites for it.
- compare_prices: { "action": "compare_prices", "query": "..." } — for ANY price/shopping request ("preço de X", "X mais barato", "quanto custa Y", "onde comprar Z"): scrapes Google Shopping (which aggregates Mercado Livre, Amazon, Magalu, KaBuM…) and opens a price-sorted comparison table. Use this as the first action for generic price requests — but if the user named a specific store/site or gave a URL, navigate there and use its own search instead of this.
- google_news: { "action": "google_news", "query": "..." } — for news requests ("notícias de X", "últimas sobre Y", "o que está acontecendo com Z"): scrapes Google News and opens a clickable headline panel (headline, source, when). Use this for news by TOPIC with NO specific site. If the user gives a specific news site or URL, do NOT use this — navigate there and use that site's own search/sections instead.
- ask_ai:{ "action": "ask_ai", "question": string } — asks ANOTHER AI (DuckDuckGo's free no-login AI chat, currently GPT-class) the given question and reads its answer back into your history ("EXTERNAL AI ANSWER"). Use it for general knowledge, reasoning, drafting, or a second opinion when you don't need a specific live website. It replaces the current tab with the AI chat. NOT for real-time facts that need a specific source (use Google for those).
- find_file: { "action": "find_file", "query": string, "filetype"?: string } — finds DIRECT download links to a specific file type using Google's filetype: operator. For "ache um PDF sobre X", "um manual em PDF de Y", "uma planilha de Z": call find_file { "query": "X", "filetype": "pdf" } (or xlsx, docx, pptx, mp3...). Results land in history as "FILES FOUND" with [fileN] URLs — then use download to save the chosen one. Default filetype is pdf.
- read_aloud: { "action": "read_aloud", "text"?: string } — reads text ALOUD with the computer's voice (text-to-speech, pt-BR). With no "text" it reads the current page's main content. Use for "leia isso pra mim", "leia a notícia em voz alta".
- report: { "action": "report", "summary": string } — FINAL action. Delivers your synthesized answer/summary to the user and ends the task.
- click_ref: { "action": "click_ref", "ref": number } — PREFERRED. Clicks the element with that id from interactive_elements. Most reliable.
- fill_ref: { "action": "fill_ref", "ref": number, "value": string } — PREFERRED for inputs. Fills the input element with that id.
- click_text: { "action": "click_text", "text": string, "nth"?: number } fallback when the right element isn't in the ref list.
- click_at: { "action": "click_at", "x": number, "y": number } clicks at pixel coordinates of the attached screenshot (only when one is attached), useful when text selection fails.
- type: { "action": "type", "text": string } types into the currently focused element.
- fill: { "action": "fill", "selector"?: string, "label"?: string, "value": string } fills an input, textarea, or rich text editor by selector, visible label, placeholder, name, or currently focused editable area.
- press: { "action": "press", "key": string } presses Enter, Tab, Escape, ArrowDown, etc.
- navigate: { "action": "navigate", "url": string } navigates directly to a URL.
- scroll: { "action": "scroll", "direction": "up"|"down"|"top"|"bottom", "amount"?: number }
- wait: { "action": "wait", "ms": number } or { "action": "wait", "selector": string, "timeout": number }
- done: { "action": "done", "reason": string, "success": boolean } ends the task.

You receive the current observed state on every step in this compact format:

TABS:
[0] (active) "Gmail - Inbox" — mail.google.com
[1] "Craiyon" — craiyon.com
[2] "YouTube" — youtube.com

URL: <current url>
TITLE: <page title>
INTERACTIVE ELEMENTS (use the [N] id with click_ref/fill_ref):
[0] <button>Sign in</button>
[1] <input placeholder="Search">
[2] <a href="/gmail">Gmail</a>
...

PAGE TEXT: <visible text snippet>
RECENT HISTORY: <previous steps>

To act on an element, use its [N] id with click_ref or fill_ref.
The TABS list shows ALL open tabs; you can use switch_tab to change which one is active. Maintain context across tabs — they are part of the same project workspace.

EXECUTION MINDSET:
- Follow the user's request LITERALLY. If they say "go to YouTube, click a video, like it" — do exactly those 3 things, in that order, on the same site. Don't overthink, don't switch sites, don't add extra steps.
- When the user gives an explicit URL or names a specific website, NAVIGATE to it (navigate action) and use ITS OWN search box, buttons and sections. NEVER replace an explicit site with a Google/Shopping/News shortcut (google_news, compare_prices) — those are only for generic requests with no site given. Build the query from the user's REAL search terms only, never from their navigation instructions.
- After each action, the next observation will reflect the new state. Trust that and continue with the NEXT step of the user's plan.
- Don't repeat or second-guess a successful action.

COMPLEX RESEARCH TASKS (multi-page, gather + synthesize):
When the user asks something like "search X, open 3 results, compare prices/specs, summarize":
1. STEP 1 — emit a 'plan' action listing concrete steps. Example:
   { "type": "plan", "steps": ["search X on google", "open result 1", "extract price", "store as price1", "back", "open result 2", "extract price", "store as price2", "open result 3", "extract price", "store as price3", "synthesize comparison", "report"] }
2. Then execute step by step using the tools.
3. After each extract_text on an article page, IMMEDIATELY call store with the key data point (e.g. { "type": "store", "key": "price", "value": 6499, "source": "techradar.com" }). Do NOT rely on history alone — MEMORY is more reliable.
4. Navigate sequentially in one tab to save context, unless you must compare two pages side-by-side.
5. After all data is in MEMORY, call report({"summary": "..."}) with your synthesized answer that USES the memory values. Without report the task is incomplete.

The PLAN and MEMORY blocks are visible to you in every observation. Use them as your scratchpad.

VERIFY BEFORE REPORTING (very important for "find a site/tool that does X" tasks):
- When the task asks you to FIND something with a required property — e.g. "a site that generates video FREE and with NO login", "a tool that works without signup", "the cheapest seller" — you MUST actually OPEN the candidate page and CONFIRM the property before reporting it.
- NEVER report a site/answer based only on a Google result title or snippet. Search snippets are often wrong or outdated. Open the real page first.
- Concretely: from the search results, click/open a promising candidate, look at its actual page. If it demands login/signup/payment when the task required "no login/free", that candidate FAILS — go back and try the next result. Only report a candidate you actually verified.
- If after trying 3-4 candidates none satisfy the requirement, report honestly what you found and that none clearly met the criteria — do not invent a passing answer.

TOGGLE BUTTONS (like/follow/subscribe/star/save):
- Elements have a "pressed" or "checked" attribute showing their toggle state.
- pressed="false" means OFF (not yet liked / not subscribed). pressed="true" means ON (already liked / subscribed).
- After you click a toggle, in the next observation the state flips. THIS IS SUCCESS — do NOT click again.
- For "like the video" type goals: clicking ONCE on a like button is enough. The next observation will show pressed="true". At that point the goal is complete — set done success:true.
- Never click a toggle button twice expecting the same effect.

TAB MANAGEMENT (IMPORTANT):
- DO NOT open a new tab unless the user EXPLICITLY asks for one ("open in a new tab", "abre em nova aba"), or the task strictly requires it (e.g., comparing two pages side-by-side).
- For a fresh task, REUSE the currently active tab — just navigate to the new URL with the navigate action.
- The active tab is the one marked "(active)" in the TABS list.

PATIENCE & PRECISION (read carefully):
- The browser already waits ~4 seconds between your actions to let animations, popups, and async content render. Trust this — never repeat an action just because the page looks similar; the change may just be slow.
- PRECISION OVER SPEED. Read the entire interactive_elements list before deciding. Confirm the right element by its text AND aria attribute when present. Don't pick the first match — pick the BEST match.
- If you are unsure which of two elements is correct, prefer the one with shorter text and matching aria-label. Avoid elements whose text starts with "Não", "No", "Don't", "Cancelar", "Remover" unless the user explicitly asked to undo something.
- For ambiguous icon-only buttons (no text, only aria), use the aria attribute as the primary identifier.
- If the screenshot still shows skeleton/loading placeholders, choose: { "type": "wait", "ms": 3000 } and re-observe before acting.

STRATEGY (in order of preference):
1. ALWAYS scan interactive_elements first. Each has an "id" — if the target is in that list, use click_ref/fill_ref with that id. This is the MOST RELIABLE path.
2. If the target is not in the list, fall back to click_text (for buttons/links) or fill (for inputs with a label).
3. Only as last resort: click_at with x,y from the screenshot.
4. For known destinations (e.g. "open Gmail"), navigate is fastest.

LEAN ON THE GIANTS (be street-smart, not heroic):
- To SEARCH, always navigate to the URL in ONE action: https://www.google.com/search?q={query}. NEVER fill the Google homepage box and click the button — that wastes steps and hits overlays.
- Google answers most questions directly in the results page (featured snippets, conversion boxes, weather).
- RESEARCH / RECOMMENDATION questions ("qual a melhor X", "procure um Y barato", "compare Z", "quanto custa W"): after the Google search, your NEXT action is extract_text to READ THE SNIPPETS, then answer. The snippets already contain product names, prices, specs and recommendations. Do NOT click the result links — they are slow, frequently fail (Google truncates/overlays them), and waste many steps. Only open a specific site if the snippets are truly insufficient.
- When the answer is a list/comparison (several products with prices/specs, a ranking), finish with render_view (a clean table) instead of a long text report — gather the data from snippets, then render it.
- Google Images: https://www.google.com/search?q={query}&udm=2 — then extract_images to get URLs.
- If Google blocks or fails, fall back to Bing: https://www.bing.com/search?q={query} (images: https://www.bing.com/images/search?q={query}).
- Wikipedia/Wikimedia for facts and HIGH-RESOLUTION images of famous artworks, people and places (Wikimedia Commons hosts original-quality files).
- archive.org (Internet Archive) is a goldmine for old games/software/music/books. To download from an item page, navigate to https://archive.org/download/ITEM_ID — it lists EVERY file as a direct link (click the format you want). IGNORE the "download 1 file"/TORRENT buttons on the item page (they give you a .torrent, not the file).
- Prefer reading a search snippet over fighting a hostile website.

VIDEO / MUSIC DOWNLOAD TASKS ("baixar o vídeo do X", "baixar a música Y", "download this video"):
- DEFAULT and ONLY good way: call { "action": "download_video", "query": "..." } as your VERY FIRST action. Do NOT navigate to YouTube, do NOT fill a search box, do NOT click results — download_video searches and downloads by itself (and skips Shorts).
- The "query" must be a CLEAN search term: just the artist + song/video title. STRIP filler words from the user's sentence like "baixe", "baixar", "a música", "o vídeo", "do", "pra mim", "por favor". Examples:
  · user "baixe uma música do 2pac" → query: "2Pac" (audio_only: true)
  · user "baixa o clipe de Evidências do Chitãozinho" → query: "Chitãozinho Xororó Evidências"
  · user "quero o vídeo tutorial de react hooks" → query: "react hooks tutorial"
- For a song/audio request, ALWAYS add "audio_only": true (saves mp3).
- MULTIPLE songs/videos — two cases:
  · N from ONE artist/topic, NOT individually named ("baixe 3 músicas do Leandro e Leonardo", "baixe duas músicas sertanejas"): ONE action with "count" → { "action": "download_video", "query": "Leandro e Leonardo", "audio_only": true, "count": 3 }. It grabs the top N distinct results.
  · Specific NAMED songs ("baixe Evidências, Sufoco e Coração"): return a SINGLE response with an "actions" array, one download_video per name → { "actions": [ {"action":"download_video","query":"Chitãozinho Xororó Evidências","audio_only":true}, {"action":"download_video","query":"... Sufoco","audio_only":true}, {"action":"download_video","query":"... Coração","audio_only":true} ] }. They all run, then it finishes.
- Only if the user is ALREADY on a specific video page and wants THAT exact one: call download_video with no query (grabs current tab).
- The download auto-completes the task on success (you'll see "DOWNLOADED" / the run ends). Never look for a download button, never retry a file that already downloaded.

GITHUB RELEASE DOWNLOADS ("baixe o ComfyUI portable mais atualizado", "latest release de X"):
- NEVER click through the github.com Releases page UI — the "Assets" toggle is unreliable and wastes many steps. Use GitHub's FREE public JSON API instead:
  1. navigate to https://api.github.com/repos/OWNER/REPO/releases/latest (no login needed). If unsure of OWNER/REPO, google "REPO github" first and read the result URL — do NOT guess the owner.
  2. extract_text — the JSON lists every asset with its "browser_download_url".
  3. { "action": "download", "url": "<browser_download_url>" } for the asset matching the user (Windows user → prefer windows/portable; NVIDIA GPU → nvidia variant).
- Shortcut when the asset name is stable: https://github.com/OWNER/REPO/releases/latest/download/ASSET_NAME always redirects to the newest version of that file.

FILE DOWNLOAD TASKS ("ache/baixe um PDF/manual/planilha/documento de X"):
- Use find_file { "query": "X", "filetype": "pdf" } as your FIRST action (filetype can be pdf, docx, xlsx, pptx, mp3, etc.). It returns "FILES FOUND" with direct [fileN] URLs.
- Then download the first good one: { "action": "download", "url": "<a [fileN] url>" }.
- Do NOT manually search Google and click results for files — find_file is faster and gives direct URLs.

IMAGE TASKS (find/download images) — DEFAULT FAST ROUTE:
- To find/download images of something ("baixe uma imagem de X", "baixe 5 fotos de Y"): use search_images { "query": "X", "count": N } FIRST. It returns DIRECT high-resolution, rights-clean URLs ("IMAGES FOUND") instantly — no navigation, no Google Images, no third-party sites.
- Then download the ones you want: batch several { "action": "download", "url": "<an [imgN] url>" } in one "actions" array. For "download N images", download the first N from the list.
- Do NOT open Google Images / Bing Images / random websites for this — that is slow and gets low-res thumbnails or watermarked copies. search_images is faster and cleaner.
- ONLY use extract_images (current-page <img> scrape) if the user explicitly wants the image FROM a specific website they named.
- Clicking a download button/link on a website ALSO works: the browser saves the file automatically to Downloads (NO save dialog appears) and a "DOWNLOAD STARTED/COMPLETED" note appears in RECENT HISTORY. Treat that as SUCCESS — never click the same download button again, and never wait for a save dialog.
- When done, report the saved filenames to the user.
5. For ANY search box, form, or editor: (a) click inside or use fill_ref, (b) type the text, (c) **YOU MUST SUBMIT**. Filling the field is NOT enough. You must either find and click the visible "Search"/"Submit"/"Generate" button, OR use the \`press\` action with key \`Enter\` as the next step.
6. If the previous action had no visible effect, do NOT repeat the same action. Try a different ref, or navigate, or scroll.
7. If a CLICK succeeds but the page does not change, the ref likely hit a wrapper element — retry ONCE with click_text using the EXACT visible label (e.g. GitHub's "Assets 7" toggle). If that also fails, find a URL-based route instead of clicking.

CRITICAL — WHEN TO RETURN done:
- ONLY after you VERIFIED the goal completed by looking at the new page state.
- For "generate image": done as soon as ANY rendered image (even small/thumbnail) appears as a result of your prompt. Do NOT switch to a different site once an image is generated. Even a tiny preview counts as success — set done with success: true.
- For "generate video/text": same rule, partial results count.
- For "search Y": done only after results are visible.
- For "open Z": done only after the page actually loaded with Z's content.
- Filling a form field is NEVER "done" — you must submit and verify the outcome.
- If you typed/filled something and the next observation shows the same form (no result yet), the goal is NOT done. Submit it.
- DO NOT abandon a working site to try another one. If your action succeeded on site A, finish on site A.`;

// Prompt do modo "resposta" (caixa unificada). O ponto-chave: deixar EXPLÍCITO que,
// neste modo, o assistente NÃO age na web — então ele nunca deve fingir progresso
// ("🔍 Pesquisando...", "a página carregou", "vou rolar"). Quando o pedido exigir
// ação, ele responde curto e propõe a tarefa numa linha [[ACTION: ...]] que a UI
// transforma num botão "⚡ Fazer isso" (ou o usuário responde "sim") → roda o agente.
const CHAT_ASSISTANT_SYSTEM_PROMPT = `You are the assistant of an AI web browser, currently in ANSWER mode. Reply in the user's language (default Brazilian Portuguese), directly and concisely. If page content is provided, use it to answer questions about the current page (summaries, "what does this article say", key points, etc.).

IDENTITY: if the user asks who you are or who made you, use the ENGINE line at the very end of this prompt (it names the AI actually running) and answer honestly and briefly. Never invent being ChatGPT/Gemini/Claude or made by OpenAI/Google/Anthropic/Microsoft unless the ENGINE line says so.

CRITICAL: in this mode you CANNOT act on the web yourself — you cannot click, navigate, search, scroll, fill forms, buy or download. Therefore you must NEVER fake progress or pretend you did something. Do NOT output phrases like "🔍 Searching...", "the page loaded", "let me scroll down", "I'll open the results". Nothing actually happens when you say that, and it confuses the user.

When the user's request would require ACTING on the web (search or open a site, compare prices, find news, buy, download a file/video/music, fill or submit a form, click something, log in), do this:
1) Give a brief, genuinely useful answer from your own knowledge first (likely product/option names, what to look for, etc.).
2) Then, as the VERY LAST line and nothing after it, output ONE machine-readable proposal in EXACTLY this format:
[[ACTION: <a clear imperative command, in the user's language, describing the task to run>]]

Example — user: "qual a alexa mais barata?" → you reply:
As mais baratas costumam ser o Echo Dot (5ª geração) e o Echo Pop.
[[ACTION: comparar preços de Echo Dot e Echo Pop]]

Emit at most ONE [[ACTION:]] line, only when acting would genuinely help, and never describe the action as already done. For pure questions (definitions, summaries of the current page, general chat) do NOT emit an action line.`;

// Prompts constantes — sanitizados UMA vez no carregamento do módulo para não varrer
// ~8KB caractere a caractere a cada chamada de IA (era feito em todo callDeepSeek).
const SANITIZED_AGENT_PROMPT = sanitizeForJson(BROWSER_AGENT_SYSTEM_PROMPT);
const SANITIZED_CHAT_PROMPT = sanitizeForJson(CHAT_ASSISTANT_SYSTEM_PROMPT);

// ── Idioma da "voz" do agente (i18n Fase 2) ────────────────────────────────
// O agente fala com o usuário (thought/evaluation/report/resposta) no idioma da
// UI, não no idioma da página. Setado pelo renderer via IPC (ai:set-lang). Default
// pt (comportamento anterior). JSON keys, nomes de ação e URLs ficam em inglês.
const LANG_NAMES: Record<string, string> = { en: 'English', pt: 'Brazilian Portuguese', es: 'Spanish' };
let engineLang: 'en' | 'pt' | 'es' = 'pt';
export function setEngineLang(l: string): void {
  if (l === 'en' || l === 'pt' || l === 'es') engineLang = l;
}
function langSuffix(): string {
  return `\n\nLANGUAGE: Write your "thought", "evaluation", "reason"/report text and ANY message shown to the user in ${LANG_NAMES[engineLang]}, regardless of the page's language. Keep JSON keys, action/tool names and URLs in English.`;
}

export interface AiMetrics {
  kind: 'thinking' | 'answer';
  estTokens: number;
  tokPerSec: number;
  elapsedMs: number;
  exact: boolean;
}

export class AIEngine {
  private provider: AIProvider;
  private apiKey: string;
  private baseUrl: string;
  private ollamaModel: string;
  private cloudModel: string;   // optional cloud model override (e.g. NVIDIA model picker)
  private isLocal: boolean;     // modo IA Local (nunca cai na nuvem; roteia pro endpoint configurado)
  private localWarmup = false;  // pré-aquecer o modelo local é OPCIONAL (opt-in) — o llama.cpp gerencia a VRAM
  private resolvedOllamaModel: string | null = null;  // modelo realmente usado (auto-detect)
  private localOpts: LocalEndpointOpts = {};
  // Discovery (per baseUrl) and runtime context (per model), cached for 5min: without
  // this EVERY agent step would repeat the same probes against the local server.
  private localModelsCache: { at: number; models: _LocalModelInfo[] } | null = null;
  private localModelsCacheBase = '';
  private runtimeCtxCache = new Map<string, { at: number; tokens?: number; source: string }>();
  private static readonly LOCAL_CACHE_TTL_MS = 5 * 60 * 1000;
  // Histórico de chat POR ABA (tabId → mensagens): cada aba do navegador tem sua própria
  // conversa (casa com o chat-por-aba da UI). Antes era um só, global, compartilhado.
  private conversationHistories = new Map<string, Message[]>();
  // Models whose server refused an image (`${baseUrl}::${model}`). Discovery often says
  // "unknown"; the first real rejection is the ground truth, so later steps go text-only
  // instead of failing (and retrying) every single call.
  private visionRejected = new Set<string>();

  // local=false ⇒ provedor de NUVEM (a chave é obrigatória p/ auth). local=true ⇒ backend
  // LOCAL (Ollama ou OpenAI-compatible) — a apiKey vira auth OPCIONAL, NUNCA um marcador
  // de modo (o roteamento local é explícito por isLocal, não por chave fabricada 'local').
  constructor(provider: AIProvider, apiKey: string, baseUrl?: string, ollamaModel?: string, cloudModel?: string, local = false, localOpts?: LocalEndpointOpts) {
    this.provider = provider;
    // Defensive trim: pasted API keys often carry a trailing space/newline,
    // which makes DeepSeek/OpenAI reject the "Bearer <key>" header with 401.
    this.apiKey = (apiKey || '').trim();
    this.isLocal = local;
    this.baseUrl = (baseUrl && baseUrl.trim()) ? baseUrl.trim() : this.defaultBaseUrl(provider);
    // Local OpenAI-compatible: SEM default de modelo Ollama — um "qwen3-vl:8b" fabricado
    // num router com rota coringa poderia carregar o modelo errado. O usuário escolhe na UI.
    this.ollamaModel = ollamaModel || (local && provider === 'openai' ? '' : 'qwen3-vl:8b');
    this.cloudModel = (cloudModel || '').trim();
    // Normaliza base URL OpenAI-compatible: aceita raiz ("http://host:8080") OU já com
    // "/v1" ("http://host:8080/v1") e preserva prefixos de proxy (".../proxy/v1"). O código
    // anexa "/v1/..." na chamada, então NÃO podemos deixar um "/v1" duplicado no final.
    if (provider === 'openai') this.baseUrl = this.baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');
    this.localOpts = { ...(localOpts || {}) };
  }

  getLocalOpts(): LocalEndpointOpts { return { ...this.localOpts }; }

  /** Which discovery transport to use: native Ollama (/api/*) or /v1/* only. */
  private localTransport(): _LocalTransport {
    return this.provider === 'ollama' ? 'ollama' : 'openai-compatible';
  }

  /** Models the server advertises (5min cache). Feeds the UI and the vision gate.
   *  Never loads or unloads a model as a side effect. */
  async listLocalModels(force = false): Promise<_LocalModelInfo[]> {
    const base = _normalizeBaseUrl(this.baseUrl);
    const fresh = this.localModelsCache && !force
      && this.localModelsCacheBase === base
      && Date.now() - this.localModelsCache.at < AIEngine.LOCAL_CACHE_TTL_MS;
    if (fresh) return this.localModelsCache!.models;
    const d = await _discoverLocalModels(base, this.apiKey || undefined);
    this.localModelsCache = { at: Date.now(), models: d.models };
    this.localModelsCacheBase = base;
    return d.models;
  }

  /** Vision as ADVERTISED for the selected model - 'unknown' when the server is silent. */
  async localVisionFor(modelId: string): Promise<'supported' | 'unsupported' | 'unknown'> {
    try {
      const models = await this.listLocalModels();
      const hit = models.find(m => m.id.toLowerCase() === (modelId || '').toLowerCase());
      return hit?.vision ?? 'unknown';
    } catch { return 'unknown'; }
  }

  /** The local endpoint's real context window, so the observation can be fitted to it.
   *  Order: user's custom value -> runtime allocation -> size advertised by discovery
   *  -> 16k as a last resort. The negative result is cached TOO (without that the probe
   *  repeated on every agent step, failing identically each time). */
  async resolveContextBudget(): Promise<{ totalTokens: number; source: string }> {
    const FALLBACK = 16384;
    if ((this.localOpts.contextMode ?? 'auto') === 'custom' && (this.localOpts.contextTokens || 0) > 0) {
      return { totalTokens: this.localOpts.contextTokens!, source: 'configured' };
    }
    const modelId = this.provider === 'ollama' ? (this.resolvedOllamaModel || this.ollamaModel) : this.ollamaModel;
    const ck = `${this.baseUrl}::${modelId}`;
    const hit = this.runtimeCtxCache.get(ck);
    if (hit && Date.now() - hit.at < AIEngine.LOCAL_CACHE_TTL_MS) {
      return { totalTokens: hit.tokens ?? FALLBACK, source: hit.source };
    }
    try {
      const rc = await _detectRuntimeContext(this.localTransport(), this.baseUrl, modelId, this.apiKey || undefined);
      if (rc.tokens) {
        this.runtimeCtxCache.set(ck, { at: Date.now(), tokens: rc.tokens, source: rc.source });
        return { totalTokens: rc.tokens, source: rc.source };
      }
    } catch { /* runtime unknown - fall through to what discovery already knows */ }
    // Model unloaded (llama.cpp's /props answers 400) or a server with no /api/ps:
    // discovery usually knows the number anyway (details.context_length on Ollama,
    // --ctx-size in the router's argv). That is "configured", not runtime - but it beats
    // assuming 16k for a 128k model by a mile.
    try {
      const info = (await this.listLocalModels()).find(m => m.id.toLowerCase() === (modelId || '').toLowerCase());
      if (info?.contextTokens && info.contextTokens > 0) {
        const src = info.contextSource ?? 'configured';
        this.runtimeCtxCache.set(ck, { at: Date.now(), tokens: info.contextTokens, source: src });
        return { totalTokens: info.contextTokens, source: src };
      }
    } catch { /* discovery unavailable - fall back below */ }
    this.runtimeCtxCache.set(ck, { at: Date.now(), source: 'fallback' });
    return { totalTokens: FALLBACK, source: 'fallback' };
  }

  /** Gate + explain in one place. "unsupported" is a known NO from the server;
   *  "unknown" (the common case — most OpenAI-compatible servers advertise no
   *  modalities at all) must NOT be treated as unsupported, or the opt-in would
   *  silently do nothing. Every NO carries a machine-readable reason for the UI. */
  async resolveVision(shot?: VisionImage): Promise<VisionReport> {
    if (!shot?.dataUrl) return { attached: false, reason: 'no_shot' };
    const mode = resolveVisionMode(this.localOpts);
    if (mode === 'off') return { attached: false, reason: 'mode_off' };
    if (NO_IMAGE_PROVIDERS.has(this.provider)) return { attached: false, reason: 'provider_no_vision' };
    const split = splitDataUrl(shot.dataUrl);
    if (!split) return { attached: false, reason: 'bad_dataurl' };
    if (!/^image\/(jpeg|png|webp|gif)$/.test(split.mime)) return { attached: false, reason: 'bad_mime' };
    const bytes = Math.floor(split.base64.length * 3 / 4);
    // The size the model really sees, from the encoded header. The renderer reports DIP
    // sizes, which on HiDPI screens can be half the encoded bitmap — and the coordinate
    // contract is stated in these pixels.
    let real: { width: number; height: number } | null = null;
    try { real = encodedImageSize(base64Head(split.base64)); } catch { /* keep renderer's numbers */ }
    const dims = { width: real?.width || shot.width, height: real?.height || shot.height };
    const cap = this.localOpts.visionMaxBytes ?? VISION_MAX_BYTES;
    if (bytes > cap) return { attached: false, reason: 'too_large', bytes, ...dims };
    if (this.visionRejected.has(this.visionKey())) return { attached: false, reason: 'model_rejected_image', bytes, ...dims };
    let capab: 'supported' | 'unsupported' | 'unknown' = 'unknown';
    // Probe only our own box: asking api.openai.com / api.anthropic.com about modalities
    // would be a surprise API call, and those routes take images anyway.
    if (this.isLocal) {
      try { capab = await this.localVisionFor(this.activeLocalModel()); } catch { /* server silent → unknown */ }
    }
    if (capab === 'unsupported') return { attached: false, reason: 'model_no_vision', bytes, ...dims };
    return { attached: true, reason: capab === 'unknown' ? 'capability_unknown' : 'ok', bytes, ...dims };
  }

  /** The model id the server actually runs: Ollama resolves "qwen3-vl" to "qwen3-vl:8b",
   *  and discovery lists the resolved id — matching the raw setting returned "unknown". */
  private activeLocalModel(): string {
    return this.provider === 'ollama' ? (this.resolvedOllamaModel || this.ollamaModel) : this.ollamaModel;
  }

  private visionKey(): string {
    return `${this.baseUrl}::${this.isLocal ? this.activeLocalModel() : (this.cloudModel || this.provider)}`;
  }

  /** Run a model call; if the server refuses the image, remember that for this model and
   *  retry ONCE without it, so a "capability unknown" model degrades to text instead of
   *  failing the step. `onFallback` lets the caller restate what the model actually got. */
  private async withImageFallback<T>(
    messages: Message[],
    call: (msgs: Message[]) => Promise<T>,
    onFallback: (msgs: Message[]) => Message[],
    signal?: AbortSignal,
  ): Promise<{ value: T; rejected: boolean }> {
    try {
      return { value: await call(messages), rejected: false };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const hadImage = messages.some(m => m.image);
      if (!hadImage || signal?.aborted || /CANCELLED|timeout|too slow/i.test(msg) || !RX_IMAGE_REJECTED.test(msg)) throw e;
      this.visionRejected.add(this.visionKey());
      console.warn(`[vision] server rejected image input for ${this.visionKey()} → text-only from now on: ${msg.slice(0, 200)}`);
      const textOnly = onFallback(messages.map(m => ({ ...m, image: undefined })));
      return { value: await call(textOnly), rejected: true };
    }
  }

  // Endpoint ativo (pro pré-aquecimento de conexão no boot/troca de provedor).
  getBaseUrl(): string { return this.baseUrl; }

  // Provedor ativo — pro main montar mensagens de erro HONESTAS (dizer qual provedor
  // rejeitou a chave, em vez de culpar sempre o DeepSeek).
  getProvider(): AIProvider { return this.provider; }

  // Distingue "nunca configurou chave nenhuma" de "configurou e foi rejeitada" — sem chave
  // não existe mais fallback automático (o keyless morreu), então o main precisa saber
  // qual das duas mensagens mostrar.
  hasApiKey(): boolean { return !!this.apiKey; }

  // Transfere o histórico de chat de um engine antigo pra este: salvar as Configurações
  // recria o engine, e sem isto TODA conversa em andamento era esquecida em silêncio
  // (o feed visual ficava na tela, mas o modelo não lembrava mais de nada).
  adoptHistoriesFrom(other: AIEngine | null | undefined): void {
    if (other?.conversationHistories?.size) this.conversationHistories = other.conversationHistories;
  }

  private defaultBaseUrl(provider: AIProvider): string {
    switch (provider) {
      case 'anthropic': return 'https://api.anthropic.com';
      // O MESMO provider 'openai' serve nuvem (api.openai.com) e LOCAL OpenAI-compatible
      // (llama.cpp/LM Studio/vLLM em :8080). isLocal decide o default; um baseUrl explícito
      // sempre vence e preserva prefixos de proxy/direcional.
      case 'openai': return this.isLocal ? 'http://localhost:8080' : 'https://api.openai.com';
      case 'deepseek': return 'https://api.deepseek.com';
      case 'mistral': return 'https://api.mistral.ai';
      case 'nvidia': return 'https://integrate.api.nvidia.com';
      case 'ollama': return 'http://localhost:11434';
    }
  }

  // Identidade REAL da engine ativa, injetada no prompt do chat → a IA responde honestamente
  // "quem é você" (DeepSeek / IA local no seu PC / etc.). Só no modo chat.
  private engineIdentity(isAgentMode: boolean): string {
    if (isAgentMode) return '';
    const p = this.provider;
    let who: string;
    if (p === 'ollama') {
      who = `a LOCAL AI running on the user's OWN computer via Ollama (model "${this.resolvedOllamaModel || this.ollamaModel}") — fully offline, no cloud`;
    } else if (p === 'openai' && this.isLocal) {
      who = `a LOCAL AI running on the user's OWN computer via an OpenAI-compatible server (llama.cpp / LM Studio / vLLM) with model "${this.ollamaModel || 'local'}" — fully offline, no cloud`;
    } else {
      const name = p === 'deepseek' ? 'DeepSeek' : p === 'mistral' ? 'Mistral' : p === 'nvidia' ? `NVIDIA NIM${this.cloudModel ? ` (model ${this.cloudModel})` : ''}` : p === 'openai' ? 'OpenAI' : p === 'anthropic' ? 'Anthropic' : String(p);
      who = `${name}, via its cloud API (the user's own key)`;
    }
    return `\n\nENGINE: You are ${who}. If the user asks who/what AI you are, or who made you, answer THIS honestly and briefly — you are the browser's assistant, currently powered by the engine just described. Do NOT claim to be ChatGPT/Gemini/Claude or made by OpenAI/Google/Anthropic/Microsoft unless that is exactly the engine above.`;
  }

  clearHistory(tabId?: string): void {
    if (tabId) this.conversationHistories.delete(tabId);
    else this.conversationHistories.clear();
  }

  // Chama o LLM em modo chat com streaming quando há onDelta; se o stream falhar ANTES
  // do primeiro pedaço, refaz sem stream (fallback transparente — nunca pior que antes).
  private async callChatLLM(messages: Message[], onDelta?: (d: string) => void, signal?: AbortSignal): Promise<string> {
    if (!onDelta) {
      const reply = await this.callLLM(messages, false, 'pro', undefined, signal);
      return typeof reply === 'string' ? reply : (reply?.text ?? '');
    }
    let sawDelta = false;
    const wrapped = (d: string) => { sawDelta = true; try { onDelta(d); } catch {} };
    try {
      const reply = await this.callLLM(messages, false, 'pro', wrapped, signal);
      return typeof reply === 'string' ? reply : (reply?.text ?? '');
    } catch (e: any) {
      if (sawDelta || signal?.aborted) throw e;   // stream morreu no meio OU usuário cancelou → não refaz
      const reply = await this.callLLM(messages, false, 'pro', undefined, signal);   // fallback sem stream
      return typeof reply === 'string' ? reply : (reply?.text ?? '');
    }
  }

  async chat(userMessage: string, pageContext?: string, stateless = false, tabId = 'default', rawContext?: string, onDelta?: (d: string) => void, signal?: AbortSignal, image?: VisionImage): Promise<string> {
    // rawContext = a self-contained block the caller already wrote (e.g. an attached
    // document with its own instruction). Used AS-IS, WITHOUT the "[Current page context]"
    // label — that label made weak models think there was an attachment they couldn't open.
    const contextNote = rawContext
      ? `\n\n${rawContext.slice(0, 24000)}`
      : pageContext
        ? `\n\n[Current page context]\n${pageContext.slice(0, 8000)}`
        : '';

    // Stateless: usado pela Pesquisa Rápida (síntese de snippets), classificador de
    // intenção e monitores. NÃO entra no histórico — e o retorno vai LIMPO de <think>:
    // esses chamadores consomem a resposta como DADO (roteiam/parseiam por palavra),
    // então raciocínio vazado quebraria a lógica deles.
    if (stateless) {
      const text = await this.callChatLLM([{ role: 'user', content: userMessage + contextNote }], onDelta, signal);
      return stripThink(text);
    }

    // Conversa DAQUELA aba (chaveada por tabId). O turno do usuário vai numa CÓPIA pra
    // chamada e só entra no histórico DEPOIS do sucesso — uma falha do provedor não pode
    // deixar um 'user' órfão (dois 'user' seguidos quebram provedores estritos/Anthropic).
    const history = this.conversationHistories.get(tabId) ?? [];
    // Chat vision: attach the page screenshot when mode+gate allow, and state it plainly
    // so the model neither refuses to look nor invents what it "sees".
    const vision = await this.resolveVision(image);
    const noImageNote = (reason: string) => `\n\n[No image attached (reason: ${reason}) — page text only.]`;
    const visionNote = vision.attached
      ? `\n\n[PAGE SCREENSHOT attached: ${vision.width ?? '?'}x${vision.height ?? '?'} — answer from it when the question is visual.]`
      : (image ? noImageNote(vision.reason) : '');
    let userTurn: Message = { role: 'user', content: userMessage + contextNote + visionNote, image: vision.attached ? image : undefined };

    // A new screenshot supersedes the one kept in history: never send two frames per call.
    const priorTurns = userTurn.image ? history.map(h => (h.image ? { ...h, image: undefined } : h)) : history;
    const { value: text, rejected } = await this.withImageFallback(
      [...priorTurns, userTurn],
      msgs => this.callChatLLM(msgs, onDelta, signal),
      msgs => {
        // Restate honestly: the model is now on text only.
        userTurn = { role: 'user', content: userMessage + contextNote + noImageNote('model_rejected_image') };
        return [...msgs.slice(0, -1), userTurn];
      },
      signal,
    );
    if (rejected) console.log('[chat] vision: server rejected the image, answered from page text');
    // Cancelado no meio (Parar)? NÃO comita nada: o usuário não viu essa resposta, e gravar
    // deixaria um turno-fantasma que sobrescreveria a memória da PRÓXIMA mensagem daquela aba.
    if (signal?.aborted) return text;
    // Higiene: modelos de raciocínio (qwen3 etc.) prefixam <think>…</think> na resposta.
    // O histórico guarda SÓ a resposta limpa — re-mandar raciocínio velho gasta contexto
    // e confunde o modelo. (O retorno pro renderer segue cheio: a UI exibe o pensamento.)
    const clean = stripThink(text);
    // At most ONE image in history (this turn): re-sending old screenshots every turn
    // costs hundreds of tokens and re-answers a page that has already moved on.
    for (const h of history) if (h.image) h.image = undefined;
    history.push(userTurn, { role: 'assistant', content: clean || text });
    const CAP = 40;   // teto de itens por aba (evita crescer sem limite com muitas abas)
    if (history.length > CAP) history.splice(0, history.length - CAP);
    this.conversationHistories.set(tabId, history);
    return text;
  }

  async generateAction(command: string, observedState?: string, screenshot?: VisionImage, tier: 'flash' | 'pro' = 'pro', signal?: AbortSignal): Promise<{ text: string; usage?: any; latencyMs: number; model: string; contextTokens?: number; contextSource?: string; contextTrimmed?: boolean; vision?: VisionReport }> {
    const vision = await this.resolveVision(screenshot);
    // Context budget: LOCAL path only, where the window is small and knowable. Fits the
    // observation to the real context (trims page text first, then history, never the
    // element list). Cloud keeps the fixed 12k slice it always had.
    // The attached image is charged against the same window (approximate).
    let state = observedState ? observedState.slice(0, 12000) : '';
    let contextTokens: number | undefined;
    let contextSource: string | undefined;
    let contextTrimmed = false;
    const imageTokens = vision.attached ? estimateImageTokens(vision.width, vision.height) : 0;
    if (this.isLocal && state) {
      try {
        const cb = await this.resolveContextBudget();
        contextTokens = cb.totalTokens;
        contextSource = cb.source;
        const fitted = _applyContextBudget(state, {
          totalTokens: cb.totalTokens,
          maxOutputTokens: this.localOpts.maxOutputTokens ?? 4096,
          imageTokens,
        });
        state = fitted.text;
        contextTrimmed = fitted.trimmed;
      } catch { /* budgeting failed -> carry on with the legacy slice */ }
    }
    const contextNote = state
      ? `\n\n[Observed browser state and history]\n${state}`
      : '';
    // Say exactly what the model got. Claiming a screenshot that was never sent made
    // models invent coordinates; denying one that IS sent made them refuse to look.
    // Coordinates are asked for in SCREENSHOT pixels: that is the only space the model can
    // measure in (the DOM list carries no positions). The renderer maps them to the live
    // viewport using the size reported back in `vision` — no arithmetic left to the model.
    const shotFmt = splitDataUrl(screenshot?.dataUrl)?.mime?.split('/')[1] ?? 'image';
    const w = vision.width, h = vision.height;
    const coordNote = w && h
      ? `For click_at, give x,y as pixel coordinates IN THIS SCREENSHOT (x 0..${w - 1}, y 0..${h - 1}); the browser maps them onto the page.]`
      : 'For click_at, give x,y as pixel coordinates in this screenshot.]';
    const noImageNote = (reason: string) =>
      `\n\n[NO IMAGE AVAILABLE (reason: ${reason}) — you receive DOM text and OCR text only. Do NOT describe visual content you cannot see; if the answer depends on how something looks, say so plainly. Prefer click_ref/click_text over click_at: you have no picture to take coordinates from.]`;
    const visionNote = vision.attached
      ? `\n\n[SCREENSHOT attached: ${w ?? '?'}x${h ?? '?'} ${shotFmt}. It shows the CURRENT page — use it for layout, icons, thumbnails and anything the DOM text does not carry. ${coordNote}`
      : noImageNote(vision.reason);

    const t0 = Date.now();
    if (signal?.aborted) throw new Error('CANCELLED');
    const { value: reply, rejected } = await this.withImageFallback(
      [{ role: 'user', content: command + contextNote + visionNote, image: vision.attached ? screenshot : undefined }],
      msgs => this.callLLM(msgs, true, tier, undefined, signal),
      () => [{ role: 'user', content: command + contextNote + noImageNote('model_rejected_image') }],
      signal,
    );
    const finalVision: VisionReport = rejected ? { ...vision, attached: false, reason: 'model_rejected_image' } : vision;
    const meta = { contextTokens, contextSource, contextTrimmed, vision: finalVision };
    if (typeof reply === 'string') {
      return { text: reply, latencyMs: Date.now() - t0, model: this.provider, ...meta };
    }
    return { ...reply, ...meta };
  }

  private async callLLM(messages: Message[], isAgentMode: boolean, tier: 'flash' | 'pro' = 'pro', onDelta?: (d: string) => void, signal?: AbortSignal): Promise<any> {
    // Rastro do provedor: deixa claro QUAL engine respondeu cada request e se usou chave
    // (ex.: "[AI] provider=deepseek chat (no-key)"). Vai pro agent.log e pro console.
    const trace = `[AI] provider=${this.provider} ${isAgentMode ? 'agent' : 'chat'} (${this.apiKey ? 'key' : 'no-key'})`;
    try {
      const logPath = require('path').join(require('electron').app.getPath('userData'), 'agent.log');
      require('fs').appendFileSync(logPath, `${new Date().toISOString()} ${trace}\n`);
    } catch {}
    console.log(trace);
    switch (this.provider) {
      case 'anthropic': return this.callAnthropic(messages, isAgentMode, signal);
      case 'openai': return this.callOpenAI(messages, isAgentMode, onDelta, signal);
      // No image input on these routes: strip so an internal field can never leak out.
      case 'deepseek': return this.callDeepSeek(stripImages(messages), isAgentMode, tier, onDelta, signal);
      case 'mistral': return this.callMistral(stripImages(messages), isAgentMode, onDelta, signal);
      case 'nvidia': return this.callNim(stripImages(messages), isAgentMode, onDelta, signal);
      // resolveVision() decides (mode + capability), so no image reaches here without it.
      case 'ollama': return this.callOllama(messages, isAgentMode, onDelta, signal);
    }
  }

  private async callAnthropic(messages: Message[], isAgentMode: boolean, signal?: AbortSignal): Promise<string> {
    const body = {
      // Sonnet atual (o anterior, sonnet-4, era de mai/2025 e ficou pra trás).
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      system: (isAgentMode ? BROWSER_AGENT_SYSTEM_PROMPT : CHAT_ASSISTANT_SYSTEM_PROMPT) + langSuffix() + this.engineIdentity(isAgentMode),
      messages: messages.map(m => {
        const img = m.image ? splitDataUrl(m.image.dataUrl) : null;
        return img
          ? {
            role: m.role as 'user' | 'assistant',
            content: [
              { type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } },
              { type: 'text', text: m.content },
            ],
          }
          : { role: m.role as 'user' | 'assistant', content: m.content };
      }),
    };

    const res = await fetchWithTimeout(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    }, 45000, signal);

    if (!res.ok) {
      throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text ?? '';
  }

  // O provedor 'openai' serve NUVEM (api.openai.com) e LOCAL OpenAI-compatible
  // (llama.cpp/LM Studio/vLLM). O model vira: local → o modelo SELECIONADO na config local
  // (servidor compatível exige o nome exato do carregado); nuvem → override do usuário ou gpt-4o.
  private async callOpenAI(messages: Message[], isAgentMode: boolean, onDelta?: (d: string) => void, signal?: AbortSignal): Promise<string> {
    if (this.isLocal && !this.ollamaModel.trim()) {
      throw new Error('No local model selected. Pick a model in settings.');
    }
    const model = this.isLocal ? this.ollamaModel : (this.cloudModel || 'gpt-4o');
    return this.openAICompat(messages, isAgentMode, onDelta, signal, {
      model,
      jsonMode: isAgentMode,   // agent = JSON por padrão (evidence-backed); desliga só em recuperação
      maxTokens: 4096,
      depth: 0,
    });
  }

  // Implementação OpenAI-compatible com: retry+backoff (429/5xx/timeout, cancelável),
  // timeout que COBRE a leitura do corpo (não só os headers), canal de raciocínio
  // (reasoning_content) e — em modo agente — recuperação JSON limitada (vazia / truncada /
  // só-raciocínio → tenta com orçamento maior mantendo JSON; só desliga o response_format
  // com evidência de que o servidor não suporta).
  /** Live progress for the UI: a slow local step must read as working, not hung. */
  onMetrics?: (m: AiMetrics) => void;
  private lastMetricsAt = 0;

  /** Estimated from characters until the usage chunk arrives, exact afterwards. */
  private emitMetrics(kind: 'thinking' | 'answer', chars: number, t0: number, exact = false, usage?: any): void {
    const now = Date.now();
    if (!exact && now - this.lastMetricsAt < 1000) return;
    this.lastMetricsAt = now;
    const estTokens = exact ? Math.round(usage?.completion_tokens ?? 0) : Math.round(chars / 3.5);
    const secs = Math.max(0.001, (now - t0) / 1000);
    try { this.onMetrics?.({ kind, estTokens, tokPerSec: Math.round(estTokens / secs), elapsedMs: now - t0, exact }); } catch {}
  }

  // Sticky, per baseUrl::model — learned from the server, not assumed.
  private streamOptionsRejected = new Set<string>();
  private streamRejected = new Set<string>();
  private thinkingKnobRejected = new Set<string>();
  private slowThinking = new Set<string>();
  private stepTokens = new Map<string, number>();

  /** The app marks a stuck run so thinking comes back on (C15 wires the caller). */
  noteStuck(model: string): void {
    this.slowThinking.delete(streamKey(this.baseUrl, model));
  }

  isThinkingThrottled(model: string): boolean {
    return this.slowThinking.has(streamKey(this.baseUrl, model));
  }

  /** Reasoning models must not be pinned to temperature 0 (they loop); the name is the prior,
   *  reported usage is the proof (see the usage checks in the local paths). */
  private isReasoningModel(model: string): boolean {
    const m = (model || '').toLowerCase();
    if (/not.?think|no.?think|instruct/.test(m)) return false;
    return /gpt-?oss|gptoss|qwen3(?!-?vl)|deepseek-r1|thinking/.test(m);
  }

  private async openAICompat(messages: Message[], isAgentMode: boolean, onDelta?: (d: string) => void, signal?: AbortSignal, cfg?: { model: string; jsonMode: boolean; maxTokens: number; depth: number; noStream?: boolean; noStreamOptions?: boolean; thinkingOff?: boolean; bodyRetry?: number }): Promise<string> {
    const model = cfg?.model || (this.isLocal ? this.ollamaModel : (this.cloudModel || 'gpt-4o'));
    const bodyRetry = cfg?.bodyRetry ?? 0;
    // LOCAL streams agent calls as well: a silent 150s step looks hung, and a stream
    // proves liveness. Cloud agent calls stay non-streaming (bodies are locked).
    const key = `${this.baseUrl}::${model}`;
    const streaming = !!onDelta && (!isAgentMode || this.isLocal) && !cfg?.noStream && !this.streamRejected.has(key);
    const jsonMode = cfg?.jsonMode ?? isAgentMode;
    const depth = cfg?.depth ?? 0;
    const maxTokens = cfg?.maxTokens ?? 4096;
    const body: any = {
      // OpenAI-compatible servers (llama.cpp, LM Studio, vLLM) usually require the exact
      // name of the loaded model; only real OpenAI accepts 'gpt-4o'. Honor the user's model.
      model,
      messages: [
        { role: 'system', content: (isAgentMode ? BROWSER_AGENT_SYSTEM_PROMPT : CHAT_ASSISTANT_SYSTEM_PROMPT) + langSuffix() + this.engineIdentity(isAgentMode) },
        // Vision: the image travels INSIDE content as parts. An `image` field next to
        // content is silently ignored by these servers (HTTP 200, zero pixels) — that was
        // the whole vision bug: the screenshot was gated, sent and thrown away.
        ...messages.map(m => m.image
          ? {
            role: m.role,
            content: [
              { type: 'text', text: m.content },
              { type: 'image_url', image_url: { url: m.image.dataUrl } },
            ],
          }
          : { role: m.role, content: m.content }),
      ],
    };
    if (isAgentMode) {
      // JSON estruturado é o DEFAULT do agente (incl. modelos de raciocínio — testado: NOTHINK,
      // Fara e DeepSeek-V4-Flash todos produzem JSON válido com json_object). Desligar é a
      // EXCEÇÃO, só em recuperação com evidência (falha do response_format ou retorno vazio).
      // Deterministic JSON on cloud and on local instruct models (measured: faster and more
      // stable on the llama.cpp route). Thinking models get no temperature at all — vendors
      // recommend sampling for the reasoning pass and temp 0 is what makes them loop.
      if (!(this.isLocal && this.isReasoningModel(model))) body.temperature = 0;
      body.max_tokens = maxTokens;
      if (jsonMode) body.response_format = { type: 'json_object' };
    } else {
      body.max_tokens = 4096;
    }
    if (streaming) {
      body.stream = true;
      // Final usage chunk (tokens/sec for the UI). Dropped and remembered if the
      // server rejects it — verified, not assumed.
      if (this.isLocal && !cfg?.noStreamOptions && !this.streamOptionsRejected.has(key)) body.stream_options = { include_usage: true };
    }
    // Soft thinking budget (local): after a cut, thinking stays off for the run. The knob is
    // dropped and remembered if the server rejects it; measured usage proves if it worked.
    if (this.isLocal && cfg?.thinkingOff && !this.thinkingKnobRejected.has(key)) {
      body.chat_template_kwargs = { ...(body.chat_template_kwargs || {}), enable_thinking: false };
    }
    // Auth OPCIONAL no modo local (llama.cpp/LM Studio geralmente não pedem chave). Sem chave
    // não mandamos o header — nada de 'Bearer ' vazio/fabricado.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const endpoint = `${this.baseUrl}/v1/chat/completions`;
    const bodyJson = JSON.stringify(body);

    const MAX_ATTEMPTS = 3;
    const appendLog = (line: string) => {
      try {
        const logPath = require('path').join(require('electron').app.getPath('userData'), 'agent.log');
        require('fs').appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
      } catch {}
    };
    const trace = `[OpenAI] provider=${this.provider} ${isAgentMode ? 'agent' : 'chat'} model=${model} json=${jsonMode} retry_depth=${depth}`;
    console.log(trace); appendLog(trace);

    const sleep = (ms: number) => new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('CANCELLED')); return; }
      const t = setTimeout(resolve, ms);
      if (!signal) return;
      const onAbort = () => { clearTimeout(t); reject(new Error('CANCELLED')); };
      signal.addEventListener('abort', onAbort, { once: true });
    });

    let lastErr: any = null;
    let res: Response | null = null;
    // LOCAL only: released once the body is consumed; abandoned (socket dropped) before any
    // resend, so the server is not still generating while we retry (measured: half speed).
    let localSettle: (() => void) | undefined;
    let localAbort: (() => void) | undefined;
    const release = () => { const s = localSettle; localSettle = undefined; try { s?.(); } catch {} };
    const abandon = () => { const a = localAbort; localAbort = undefined; release(); try { a?.(); } catch {} };
    const backoffMs = (n: number) => (n <= 1 ? 2000 : 5000);
    const t0 = Date.now();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const firstChunkMs = this.isLocal ? LOCAL_FIRST_CHUNK_MS : CLOUD_FIRST_CHUNK_MS;
      try {
        let candidate: Response;
        if (this.isLocal) {
          const cf = await fetchCancellable(endpoint, { method: 'POST', headers, body: bodyJson }, { firstChunkMs, totalMs: streaming ? undefined : LOCAL_TOTAL_MS, signal, label: `local ${model}` });
          candidate = cf.res;
          localSettle = cf.settle;
          localAbort = cf.abort;
        } else {
          candidate = await fetchWithTimeout(endpoint, { method: 'POST', headers, body: bodyJson }, firstChunkMs, signal);
        }
        // Retry 429/5xx transitórios — NÃO 4xx. "Compute error" no llama.cpp = modelo não
        // carregado / OOM: retry não ajuda, para já com mensagem clara.
        if (candidate.status === 429 || candidate.status >= 500) {
          let peek = '';
          try { peek = await candidate.text(); } catch {}
          release();   // body consumed (or discarded): the socket is ours to free now
          if (this.isLocal && /compute error/i.test(peek)) {
            const fatal: any = new Error(`Local AI compute error for model "${model}" — is that model loaded on the server? ${peek.slice(0, 240)}`);
            fatal.noRetry = true;
            throw fatal;
          }
          // llama.cpp without --mmproj answers an image with a 500: permanent, not transient.
          // Fail fast so the caller can drop the image instead of backing off 3 times.
          if (messages.some(m => m.image) && RX_IMAGE_REJECTED.test(peek)) {
            const fatal: any = new Error(`OpenAI API error ${candidate.status}: ${peek.slice(0, 400)}`);
            fatal.noRetry = true;
            throw fatal;
          }
          if (attempt < MAX_ATTEMPTS) {
            const wait = 800 * Math.pow(2, attempt - 1);
            appendLog(`[OpenAI] ${candidate.status} transient → retry ${attempt + 1}/${MAX_ATTEMPTS} in ${wait}ms`);
            await sleep(wait);
            continue;
          }
          throw new Error(`OpenAI API error ${candidate.status}: ${peek.slice(0, 400)}`);
        }
        res = candidate;
        break;
      } catch (e: any) {
        lastErr = e;
        release();
        if (e?.noRetry || signal?.aborted || /CANCELLED/.test(String(e?.message || ''))) throw e;
        // Timeout (local frio incluso) e erros de rede: retry com backoff cancelável.
        if (attempt < MAX_ATTEMPTS) {
          const wait = 800 * Math.pow(2, attempt - 1);
          appendLog(`[OpenAI] error (${attempt}/${MAX_ATTEMPTS}): ${e?.message} → retry in ${wait}ms`);
          await sleep(wait);
          continue;
        }
        throw e;
      }
    }
    if (!res) throw (lastErr ?? new Error('OpenAI-compatible request failed after retries'));

    // Status de erro ANTES de streamar: um 500/401 no chat virava bolha vazia (readSseStream
    // não acha data: e devolve ''). Lê o corpo como texto — pode ser JSON ou HTML de proxy.
    if (!res.ok) {
      let errText = '';
      try { errText = await res.text(); } catch {}
      release();
      // An image rejection ("…image format…") is not a JSON-mode problem: let it surface so
      // withImageFallback() drops the image, instead of retrying with the image still on.
      const imageRejected = messages.some(m => m.image) && RX_IMAGE_REJECTED.test(errText);
      if (this.isLocal && streaming && !cfg?.noStreamOptions && /stream_options/i.test(errText)) {
        this.streamOptionsRejected.add(key);
        appendLog('[Local] stream_options rejeitado → removendo do corpo');
        return this.openAICompat(messages, isAgentMode, onDelta, signal, { model, jsonMode, maxTokens, depth, noStreamOptions: true });
      }
      if (this.isLocal && /chat_template_kwargs|enable_thinking/i.test(errText) && !this.thinkingKnobRejected.has(key)) {
        this.thinkingKnobRejected.add(key);
        appendLog(`[Local] ${model} rejeitou chat_template_kwargs → nao manda mais esse campo`);
        return this.openAICompat(messages, isAgentMode, onDelta, signal, { model, jsonMode, maxTokens, depth, noStream: cfg?.noStream, noStreamOptions: cfg?.noStreamOptions, thinkingOff: false });
      }
      const unsupportedJson = res.status === 400 && !imageRejected && !/stream_options/i.test(errText) && /response_format|json|format/i.test(errText);
      if (isAgentMode && jsonMode && unsupportedJson) {
        appendLog('[OpenAI] 400 em response_format → retry prompt-only (evidência de incompatibilidade)');
        return this.openAICompat(messages, isAgentMode, onDelta, signal, { model, jsonMode: false, maxTokens: 16384, depth: depth + 1 });
      }
      throw new Error(`OpenAI API error ${res.status}: ${errText.slice(0, 400)}`);
    }

    try {
      if (streaming) {
        let sawDelta = false;
        const wrap = (d: string) => { sawDelta = true; try { onDelta!(d); } catch {} };
        const metrics: { usage?: any } = {};
        const thinking = this.isLocal ? ThinkingBudget.forStep(this.stepTokens.get(key) ?? 0) : undefined;
        const thinkWrap = (d: string) => { wrap(d); if (this.isLocal) this.emitMetrics('thinking', d.length, t0); };
        try {
          const text = await readSseStream(res, thinkWrap, signal, this.isLocal ? LOCAL_INACTIVITY_MS : CLOUD_INACTIVITY_MS, thinking, metrics);
          if (this.isLocal) this.emitMetrics('answer', text.length, t0, !!metrics.usage?.completion_tokens, metrics.usage);
          if (metrics.usage?.completion_tokens) this.stepTokens.set(key, metrics.usage.completion_tokens);
          const reasoningTok = metrics.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
          if (cfg?.thinkingOff && reasoningTok > 0 && !this.thinkingKnobRejected.has(key)) {
            // Server accepted the field but kept thinking — remember so we stop pretending.
            this.thinkingKnobRejected.add(key);
            appendLog(`[Local] ${model} ignorou enable_thinking:false (usage: ${reasoningTok} reasoning tokens)`);
          }
          return text;
        } catch (e: any) {
          if (e instanceof LocalRequestError && e.code === 'THINKING_BUDGET' && this.isLocal && !cfg?.thinkingOff) {
            this.slowThinking.add(key);
            appendLog(`[Local] thinking longo demais em "${model}" → thinking desligado nesta sessao`);
            abandon();
            return this.openAICompat(messages, isAgentMode, onDelta, signal, { model, jsonMode, maxTokens, depth, noStream: cfg?.noStream, noStreamOptions: cfg?.noStreamOptions, thinkingOff: true });
          }
          // Nothing delivered yet: resend the whole request (previous socket dropped first).
          if (this.isLocal && !sawDelta && !signal?.aborted && bodyRetry < 2) {
            const wait = backoffMs(bodyRetry + 1);
            appendLog(`[Local] stream falhou antes do 1º delta (${e?.message}) → reenvio ${bodyRetry + 2}/3 em ${wait}ms`);
            abandon();
            await sleep(wait);
            return this.openAICompat(messages, isAgentMode, onDelta, signal, { model, jsonMode, maxTokens, depth, noStream: cfg?.noStream, noStreamOptions: cfg?.noStreamOptions, thinkingOff: cfg?.thinkingOff, bodyRetry: bodyRetry + 1 });
          }
          // Stream dead before the first delta: remember it and redo unstreamed for the
          // rest of the run — never worse than before this change.
          if (this.isLocal && !sawDelta && !signal?.aborted && !cfg?.noStream) {
            this.streamRejected.add(key);
            appendLog('[Local] stream falhou antes do 1º delta → sem stream para este modelo');
            abandon();
            return this.openAICompat(messages, isAgentMode, onDelta, signal, { model, jsonMode, maxTokens, depth, noStream: true, noStreamOptions: cfg?.noStreamOptions });
          }
          throw e;
        }
      }

      // Lê o corpo com timeout PRÓPRIO: o fetchWithTimeout aborta no tempo de HEADERS, mas a
      // leitura do corpo (res.json) podia pendurar o stream para sempre. Guarda ativa até o fim.
      let data: any = {};
      try {
        // A flat 60s cut off long answers (e.g. a 75-track JSON) the header budget allowed.
        // Local gets the full non-streaming budget; cloud keeps 60s.
        const bodyTimeoutMs = this.isLocal ? LOCAL_TOTAL_MS : CLOUD_BODY_MS;
        const parsed = await this.readJsonWithTimeout(res, bodyTimeoutMs, signal);
        data = parsed.data;
        if (data?.usage?.completion_tokens) this.stepTokens.set(key, data.usage.completion_tokens);
      } catch (e: any) {
        if (signal?.aborted || /CANCELLED/.test(String(e?.message || ''))) throw e;
        // THE original killer: a body timeout used to be final — the retry loop had already
        // exited at the headers. Now the whole request is resent (previous one dropped first).
        if (this.isLocal && bodyRetry < 2) {
          const wait = backoffMs(bodyRetry + 1);
          appendLog(`[Local] corpo nao veio (${e?.message}) → reenvio ${bodyRetry + 2}/3 em ${wait}ms`);
          abandon();
          await sleep(wait);
          return this.openAICompat(messages, isAgentMode, onDelta, signal, { model, jsonMode, maxTokens, depth, noStream: cfg?.noStream, noStreamOptions: cfg?.noStreamOptions, thinkingOff: cfg?.thinkingOff, bodyRetry: bodyRetry + 1 });
        }
        throw new Error(`OpenAI-compatible body read failed: ${e?.message ?? e}`);
      }

    const choice = data?.choices?.[0] ?? {};
    const msg = choice?.message ?? {};
    let text = typeof msg?.content === 'string' ? msg.content : '';
    const reasoning = typeof msg?.reasoning_content === 'string' ? msg.reasoning_content : '';
    const finish = choice?.finish_reason;
    const empty = !text;
    const truncated = finish === 'length';
    const usage = data?.usage;

    // Recuperação JSON: UMA vez com orçamento maior (depth 0 → 1). Se ainda vazio, UMA vez
    // prompt-only (depth 1 → 2). Não dispara o mesmo POST 16384 duas vezes.
    if (isAgentMode && jsonMode && (empty || truncated) && depth === 0) {
      appendLog(`[OpenAI] content vazio/truncado (finish=${finish}, depth=${depth}) → retry com orçamento maior mantendo JSON`);
      return this.openAICompat(messages, isAgentMode, onDelta, signal, { model, jsonMode: true, maxTokens: 16384, depth: 1 });
    }
    if (isAgentMode && empty && jsonMode && depth === 1) {
      appendLog('[OpenAI] ainda vazio com JSON → retry final em prompt-only');
      return this.openAICompat(messages, isAgentMode, onDelta, signal, { model, jsonMode: false, maxTokens: 16384, depth: 2 });
    }

    const latencyMs = Date.now() - t0;
    appendLog(`[OpenAI] ← ${res.status} in ${latencyMs}ms finish=${finish} content_len=${text.length} reasoning_len=${reasoning.length} tokens=${JSON.stringify(usage)}`);
    console.log(`[OpenAI] ← ${res.status} in ${latencyMs}ms finish=${finish} content_len=${text.length} reasoning_len=${reasoning.length}`);
    if (isAgentMode) text = stripReasoningMarkers(text);   // remove marcadores órfãos (Fara) sem quebrar JSON
    return text;
    } finally {
      release();   // body consumed on every exit path above
    }
  }

  // Lê o corpo de uma Response com timeout ativo (o fetchWithTimeout para no tempo de headers;
  // esta guarda cobre a leitura do body, que podia pendurar o stream de um servidor zumbi).
  // Nota: res.text() não cancela por AbortController separado, então fazemos RACE com um timer
  // — jamais pendura pra sempre; se o body não vier, tratamos como falha e seguimos o retry.
  private async readJsonWithTimeout(res: Response, ms: number, signal?: AbortSignal): Promise<{ data: any; raw: string }> {
    if (signal?.aborted) throw new Error('CANCELLED');
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('body read timed out')), ms); });
      const cancelP = signal
        ? new Promise<never>((_, reject) => { signal.addEventListener('abort', () => reject(new Error('CANCELLED')), { once: true }); })
        : null;
      const racers: Promise<any>[] = [res.text(), timeout];
      if (cancelP) racers.push(cancelP);
      const text: string = (await Promise.race(racers)) || '';
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { error: { message: text.slice(0, 400) } }; }
      return { data, raw: text };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Mistral: OpenAI-compatible chat completions. Default model is the cheap one;
  // override via a custom baseUrl/model later if needed. Separate from DeepSeek's
  // model chain so neither path affects the other.
  private async callMistral(messages: Message[], isAgentMode: boolean, onDelta?: (d: string) => void, signal?: AbortSignal): Promise<string> {
    const streaming = !!onDelta && !isAgentMode;
    const body: any = {
      model: 'mistral-small-latest',
      messages: [
        { role: 'system', content: (isAgentMode ? BROWSER_AGENT_SYSTEM_PROMPT : CHAT_ASSISTANT_SYSTEM_PROMPT) + langSuffix() + this.engineIdentity(isAgentMode) },
        ...messages,
      ],
      max_tokens: 4096,
    };
    if (isAgentMode) body.response_format = { type: 'json_object' };
    if (streaming) body.stream = true;

    // timeout abortável (≠ pendurar pra sempre numa rede ruim) — mesmo padrão do resto do arquivo
    const res = await fetchWithTimeout(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    }, 45000, signal);

    if (!res.ok) {
      throw new Error(`Mistral API error ${res.status}: ${await res.text()}`);
    }

    if (streaming) return readSseStream(res, onDelta!, signal);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  // NVIDIA NIM: OpenAI-compatible hosted endpoint (free tier). Default model is a
  // capable free one; override via custom baseUrl later if needed. Separate from the
  // other providers so nada se afeta.
  private async callNim(messages: Message[], isAgentMode: boolean, onDelta?: (d: string) => void, signal?: AbortSignal): Promise<string> {
    const streaming = !!onDelta && !isAgentMode;
    const body: any = {
      model: this.cloudModel || 'meta/llama-3.3-70b-instruct',
      messages: [
        { role: 'system', content: (isAgentMode ? BROWSER_AGENT_SYSTEM_PROMPT : CHAT_ASSISTANT_SYSTEM_PROMPT) + langSuffix() + this.engineIdentity(isAgentMode) },
        ...messages,
      ],
      max_tokens: 4096,
    };
    if (isAgentMode) body.response_format = { type: 'json_object' };
    if (streaming) body.stream = true;

    // timeout abortável (≠ pendurar pra sempre numa rede ruim) — mesmo padrão do resto do arquivo
    const res = await fetchWithTimeout(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    }, 45000, signal);

    if (!res.ok) {
      throw new Error(`NVIDIA NIM API error ${res.status}: ${await res.text()}`);
    }

    if (streaming) return readSseStream(res, onDelta!, signal);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  private deepseekModelsCache: Set<string> | null = null;
  private deepseekModelsCacheAt = 0;
  private static readonly MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

  private async fetchDeepSeekModels(): Promise<Set<string>> {
    const fresh = Date.now() - this.deepseekModelsCacheAt < AIEngine.MODELS_CACHE_TTL_MS;
    if (this.deepseekModelsCache && fresh) return this.deepseekModelsCache;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      const ids = new Set<string>((data.data || []).map((m: any) => m.id));
      this.deepseekModelsCache = ids;
      this.deepseekModelsCacheAt = Date.now();
      console.log('[DeepSeek] Available models:', [...ids].join(', '));
      return ids;
    } catch (e) {
      console.warn('[DeepSeek] /models probe failed (timeout/error), assuming defaults');
      // Fallback nunca deve oferecer o v4-pro (lento/inutilizável) como caminho rápido —
      // assume flash + chat, que são os modelos rápidos conhecidos.
      this.deepseekModelsCache = new Set(['deepseek-v4-flash', 'deepseek-chat']);
      this.deepseekModelsCacheAt = Date.now();
      return this.deepseekModelsCache;
    }
  }

  private async pickDeepSeekModel(): Promise<string> {
    const available = await this.fetchDeepSeekModels();
    // deepseek-v4-pro roda em "thinking mode" e é lentíssimo (~545s medido) — estoura o
    // deadline de 5 min do agente, nunca completa no loop interativo. Por isso a ORDEM é:
    // flash (rápido) → deepseek-chat (rápido, conhecido) → v4-pro só em último caso absoluto.
    // (Antes o chat vinha DEPOIS do v4-pro, então com flash ausente o agente caía no modelo
    // lento e travava — corrigido.)
    // 'deepseek-chat' saiu da cadeia: é apelido DEPRECADO do v4-flash e a DeepSeek
    // remove o nome em 24/07/2026 — depender dele viraria 404 do nada.
    const chain = ['deepseek-v4-flash', 'deepseek-v4-pro'];
    for (const id of chain) if (available.has(id)) return id;
    return 'deepseek-v4-flash';
  }

  private async callDeepSeek(messages: Message[], isAgentMode: boolean, tier: 'flash' | 'pro' = 'pro', onDelta?: (d: string) => void, signal?: AbortSignal): Promise<any> {
    const streaming = !!onDelta && !isAgentMode;
    // Always tell the model TODAY's real date — its training data lives in the past
    // and it will otherwise state wrong years for "hoje"/"atual" questions.
    const now = new Date();
    const dateLine = `CURRENT DATE/TIME: ${now.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} (${now.toISOString()}). TRUST THIS DATE — your training data may believe an earlier year. Use it whenever the user asks about "hoje", "atual", current events or dates.`;
    // Prompt constante já vem pré-sanitizado (SANITIZED_*); só a dateLine (volátil,
    // poucas dezenas de chars) é sanitizada por chamada.
    const systemMsg = (isAgentMode ? SANITIZED_AGENT_PROMPT : SANITIZED_CHAT_PROMPT) + '\n\n' + sanitizeForJson(dateLine) + sanitizeForJson(langSuffix()) + sanitizeForJson(this.engineIdentity(isAgentMode));
    // Images are already stripped upstream — DeepSeek has no vision API
    let model = await this.pickDeepSeekModel();
    const useFlash = model.includes('flash');
    // 🧠 MAESTRO: o tier 'pro' chega só nos momentos de "travou" (loop / ações sem
    // efeito). Aí ligamos o MODO PENSANTE (chain-of-thought) no MESMO deepseek-v4-flash,
    // em vez de trocar pro v4-pro (lento e ~3× mais caro). Todo o resto roda na voz
    // rápida (não-pensante, ~0,6s). É o segundo instrumento da orquestra, usado raro.
    const useThinking = isAgentMode && tier === 'pro';
    console.log(`[DeepSeek] tier=${tier} model=${model}${useThinking ? ' (thinking)' : ''}`);
    const formattedMessages = messages.map(m => ({ role: m.role, content: sanitizeForJson(m.content) }));

    const body: any = {
      model,
      messages: [{ role: 'system', content: systemMsg }, ...formattedMessages],
      max_tokens: useThinking ? 16384 : 4096,   // espaço para o raciocínio + a ação final
      temperature: 0,                            // ignorado no modo pensante (sem efeito, ok)
    };
    if (isAgentMode) {
      if (useThinking) {
        // Liga o raciocínio. NÃO forçamos json_object junto (compat não garantida com
        // thinking) — o parser tolerante (page-agent) extrai o objeto JSON do content.
        body.thinking = { type: 'enabled' };
        body.reasoning_effort = 'high';
      } else {
        body.response_format = { type: 'json_object' };
        // DESLIGA o raciocínio explicitamente: o V4 pode vir com thinking LIGADO por
        // padrão no servidor — no flash isso comeria latência e os 4096 tokens antes
        // do JSON terminar. O modo pensante é SÓ a escada do tier 'pro' (Maestro).
        body.thinking = { type: 'disabled' };
      }
    } else {
      // Chat/pesquisa: voz rápida sempre — sem raciocínio por default do servidor.
      body.thinking = { type: 'disabled' };
    }
    if (streaming) body.stream = true;

    const t0 = Date.now();
    const bodyJson = JSON.stringify(body);
    const sizeKB = (bodyJson.length / 1024).toFixed(0);
    const logMsg1 = `[DeepSeek] → POST /v1/chat/completions (${sizeKB}KB, model=${model})`;
    console.log(logMsg1);
    try {
      const logPath = require('path').join(require('electron').app.getPath('userData'), 'agent.log');
      require('fs').appendFileSync(logPath, `${new Date().toISOString()} ${logMsg1}\n`);
    } catch {}
    // Retry com backoff exponencial para erros transitórios (timeout / rede / 429 / 5xx).
    const MAX_ATTEMPTS = 3;
    const appendLog = (line: string) => {
      try {
        const logPath = require('path').join(require('electron').app.getPath('userData'), 'agent.log');
        require('fs').appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
      } catch {}
    };
    let res: Response | null = null;
    let lastErr: any = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Pensar (chain-of-thought) leva bem mais tempo que a voz rápida — damos folga.
      const reqTimeoutMs = useThinking ? 90000 : 45000;
      try {
        // Timeout que ABORTA o fetch de verdade (o Promise.race antigo rejeitava mas deixava
        // a request rodando). O erro contém "timeout" → o fallback do thinking abaixo reconhece.
        const candidate = await fetchWithTimeout(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
          body: bodyJson,
        }, reqTimeoutMs, signal);
        // Retry server-side transient failures (429 rate-limit, 5xx) — but not 4xx like 401/404.
        if ((candidate.status === 429 || candidate.status >= 500) && attempt < MAX_ATTEMPTS) {
          const wait = 800 * Math.pow(2, attempt - 1);
          appendLog(`[DeepSeek] ${candidate.status} transient → retry ${attempt + 1}/${MAX_ATTEMPTS} in ${wait}ms`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        res = candidate;
        break;
      } catch (e: any) {
        lastErr = e;
        // Usuário cancelou (Parar): não é falha transitória — para JÁ (sem 2.4s de retries
        // mortos e sem 3 linhas de ERRO falso no log).
        if (signal?.aborted) throw e;
        const errMsg = `[DeepSeek] ← ERROR (attempt ${attempt}/${MAX_ATTEMPTS}) after ${Date.now() - t0}ms: ${e?.message ?? e}`;
        console.error(errMsg);
        appendLog(errMsg);
        // The v4-pro "thinking" model is often too slow for interactive use. On a
        // timeout, don't keep retrying the slow model — immediately fall back to the
        // fast flash model (reliable in practice).
        if (/timeout/i.test(String(e?.message)) && useThinking) {
          appendLog('[DeepSeek] thinking timed out → retry sem pensar (flash rápido)');
          console.warn('[DeepSeek] thinking timed out → retry without thinking (fast flash)');
          return this.callDeepSeek(messages, isAgentMode, 'flash', onDelta, signal);
        }
        if (attempt < MAX_ATTEMPTS) {
          const wait = 800 * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw e;
      }
    }
    if (!res) throw (lastErr ?? new Error('DeepSeek request failed after retries'));
    const logMsg2 = `[DeepSeek] ← ${res.status} in ${Date.now() - t0}ms`;
    console.log(logMsg2);
    try {
      const logPath = require('path').join(require('electron').app.getPath('userData'), 'agent.log');
      require('fs').appendFileSync(logPath, `${new Date().toISOString()} ${logMsg2}\n`);
    } catch {}

    if (!res.ok) {
      const errText = await res.text();
      const errMsg = `[DeepSeek] error ${res.status}: ${errText.slice(0, 400)}`;
      console.error(errMsg);
      try {
        const logPath = require('path').join(require('electron').app.getPath('userData'), 'agent.log');
        require('fs').appendFileSync(logPath, `${new Date().toISOString()} ${errMsg}\n`);
      } catch {}
      // Servidor rejeitou o param `thinking` (endpoint/modelo antigo)? Refaz UMA vez
      // sem ele — rede de segurança do `thinking:{disabled}` explícito (padrão Ollama).
      if (res.status === 400 && body.thinking && /thinking/i.test(errText)) {
        console.warn('[DeepSeek] 400 on thinking param → retry without it');
        delete body.thinking; delete body.reasoning_effort;
        const retry = await fetchWithTimeout(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
          body: JSON.stringify(body),
        }, 45000, signal);
        if (retry.ok) { res = retry; }
        else throw new Error(`DeepSeek API error ${retry.status} (${model}): ${(await retry.text()).slice(0, 400)}`);
      } else {
      // Flash failed (404/model_not_found) → mark unavailable and retry on pro
      if (useFlash && (res.status === 404 || errText.includes('model') || errText.includes('not found'))) {
        console.warn(`[DeepSeek] ${model} failed → falling back to pro`);
        if (this.deepseekModelsCache) this.deepseekModelsCache.delete('deepseek-v4-flash');
        return this.callDeepSeek(messages, isAgentMode, 'pro', onDelta, signal);
      }
      if (res.status === 401) {
        throw new Error('Invalid or missing DeepSeek API key. Open the agent settings (sidebar) and paste your key starting with "sk-".');
      }
      throw new Error(`DeepSeek API error ${res.status} (${model}): ${errText}`);
      }
    }

    if (streaming) {
      const text = await readSseStream(res, onDelta!, signal);
      return { text, usage: undefined, latencyMs: Date.now() - t0, model };
    }
    let data: any = null;
    try {
      data = await res.json();
    } catch (e) {
      const errMsg = `[DeepSeek] response body parse failed: ${String(e)}`;
      console.error(errMsg);
      try {
        const logPath = require('path').join(require('electron').app.getPath('userData'), 'agent.log');
        require('fs').appendFileSync(logPath, `${new Date().toISOString()} ${errMsg}\n`);
      } catch {}
    }
    const text = data?.choices?.[0]?.message?.content ?? '';
    if (!text) {
      const dbg = `[DeepSeek] empty content. data=${JSON.stringify(data).slice(0, 500)}`;
      console.warn(dbg);
      try {
        const logPath = require('path').join(require('electron').app.getPath('userData'), 'agent.log');
        require('fs').appendFileSync(logPath, `${new Date().toISOString()} ${dbg}\n`);
      } catch {}
    }
    return {
      text,
      usage: data?.usage,
      latencyMs: Date.now() - t0,
      model,
    };
  }

  /**
   * Resolve o modelo Ollama REALMENTE disponível. Se o configurado (ex.: qwen2.5:14b)
   * não estiver instalado, usa o que houver (prefere um modelo de texto qwen/llama).
   * Evita 404 "model not found" quando o usuário troca/remove modelos.
   */
  private async resolveOllama(): Promise<string> {
    if (this.resolvedOllamaModel) return this.resolvedOllamaModel;
    try {
      const r = await fetchWithTimeout(`${this.baseUrl}/api/tags`, {}, 4000);
      const data: any = await r.json();
      const avail: string[] = (data?.models || []).map((x: any) => String(x.name));
      if (avail.length === 0) { this.resolvedOllamaModel = this.ollamaModel; return this.ollamaModel; }
      const want = (this.ollamaModel || '').toLowerCase();
      let pick = avail.find(n => n.toLowerCase() === want)
        || avail.find(n => n.toLowerCase().split(':')[0] === want.split(':')[0]);
      if (!pick) {
        pick = avail.find(n => /qwen2\.5|qwen3|llama3|mistral/i.test(n) && !/vl|vision|embed/i.test(n))
          || avail.find(n => !/embed/i.test(n))
          || avail[0];
        console.warn(`[Ollama] modelo "${this.ollamaModel}" não instalado → usando "${pick}"`);
      }
      this.resolvedOllamaModel = pick;
      return pick;
    } catch {
      return this.ollamaModel; // servidor offline: deixa o erro estourar adiante (com fallback de nuvem)
    }
  }

  /** O pré-aquecimento é OPCIONAL (opt-in): o llama.cpp gerencia a VRAM sozinho e NÃO
   *  queremos carregar modelo nenhum sem pedido — e nunca descarregar o que já está lá.
   *  Ligar o warmup só manda uma chamada mínima pro modelo SELECIONADO (nunca os outros). */
  setLocalWarmup(on: boolean): void { this.localWarmup = !!on; }
  getLocalWarmup(): boolean { return this.localWarmup; }

  // Pré-carrega o modelo local (fire-and-forget) pra a 1ª tarefa já vir quente.
  async warmupLocal(): Promise<void> {
    if (!this.isLocal || !this.localWarmup) return;
    try {
      if (this.provider === 'ollama') {
        const model = await this.resolveOllama();
        console.log(`[Local] aquecendo "${model}" na VRAM…`);
        // 180s: carregar um modelo grande na VRAM demora mesmo; mas nunca pendura pra sempre.
        await fetchWithTimeout(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'oi' }], stream: false, keep_alive: '30m', options: { num_ctx: 512 } }),
        }, 180000);
      } else if (this.provider === 'openai') {
        if (!this.ollamaModel.trim()) return;   // sem modelo escolhido: não inventa um id
        // OpenAI-compatible: chamada mínima no modelo selecionado (chave opcional).
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
        console.log(`[Local] aquecendo "${this.ollamaModel}" via OpenAI-compatible…`);
        await fetchWithTimeout(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST', headers,
          body: JSON.stringify({ model: this.ollamaModel, messages: [{ role: 'user', content: 'oi' }], max_tokens: 8 }),
        }, 300000);
      } else {
        return;
      }
      console.log(`[Local] modelo pronto na VRAM.`);
    } catch (e: any) {
      console.warn('[Local] warmup falhou (servidor ligado?):', e?.message);
    }
  }

  private async callOllama(messages: Message[], isAgentMode: boolean, onDelta?: (d: string) => void, signal?: AbortSignal, forceNoStream = false, thinkingOff = false, resend = 0): Promise<string> {

    const systemMsg = (isAgentMode ? BROWSER_AGENT_SYSTEM_PROMPT : CHAT_ASSISTANT_SYSTEM_PROMPT) + langSuffix() + this.engineIdentity(isAgentMode);
    // Images arrive here only when resolveVision() allowed them (mode + capability gate).
    const resolvedModel = await this.resolveOllama();
    // Modelo de RACIOCÍNIO (gpt-oss/harmony, qwen3, deepseek-r1): pensa antes de responder.
    // NÃO pode ser tratado como modelo comum — forçar format:json + "wrap em ```json" faz
    // ele despejar o raciocínio nos campos e cuspir ação vazia (navigate("") / ref NaN).
    // (Era exatamente o bug do qwen3.) Todos ganham o mesmo tratamento do gpt-oss.
    // qwen3-vl é modelo de VISÃO/instruct (não raciocina antes) → fica de FORA (senão
    // levava think:true, dava 400+retry e perdia o format:json que ele deve receber).
    const isReasoning = /gpt-?oss|gptoss|qwen3(?!-?vl)|deepseek-r1/.test(resolvedModel.toLowerCase());
    const formatted = messages.map((m, i) => {
      let content = m.content;
      if (isAgentMode && m.role === 'user' && i === messages.length - 1) {
        // Modelo de raciocínio: pede só 1 JSON compacto no FIM, raciocinando em silêncio
        // (o raciocínio vai pro canal 'thinking' do Ollama). Modelo comum segue estilo-qwen.
        content += isReasoning
          ? '\n\nReturn ONLY ONE compact JSON object for your next action, as the LAST thing in your reply with nothing after it. Example: {"thought":"short","evaluation":"short","action":"navigate","url":"https://www.youtube.com"}. Reason SILENTLY — never write analysis/explanation text outside the JSON. ALWAYS fill every field the action needs (url for navigate, ref number for click_ref/fill_ref). Keep "thought" and "evaluation" to ONE short sentence each.'
          : '\n\nIMPORTANT: You must evaluate the observed state and return your next step as a structured JSON object. Wrap your JSON in ```json blocks. Do NOT output freeform analysis. ONLY output the JSON object. Write the "thought" and "evaluation" fields in Portuguese or English ONLY — never Chinese.';
      }
      // Ollama takes images as a sibling array on the message, base64 WITHOUT the prefix.
      const img = m.role === 'user' ? m.image : undefined;
      const b64 = img ? splitDataUrl(img.dataUrl)?.base64 : undefined;
      return { role: m.role, content, ...(b64 ? { images: [b64] } : {}) };
    });

    const model = resolvedModel;   // já resolvido acima (usa o que está REALMENTE instalado)
    const sKey = streamKey(this.baseUrl, model);
    // Agent mode streams too: a silent 150s step looks hung, and a stream proves liveness.
    const streaming = shouldStream({ hasDelta: !!onDelta, isAgentMode, isLocal: true, noStream: forceNoStream, rejected: this.streamRejected.has(sKey) });
    const body: any = {
      model,
      messages: [{ role: 'system', content: systemMsg }, ...formatted],
      stream: streaming,
      keep_alive: '15m',     // keep the model hot in VRAM between agent steps
      options: {
        // 16k: cabe o DOM + texto da página + histórico E os system prompts maiores dos
        // modelos novos/de raciocínio (o de 8k estourava por poucos tokens num "olá" simples,
        // e o pensamento do modelo também consome contexto durante a geração).
        //
        // That 16k stays the default for existing setups. 'auto' OMITS num_ctx so the
        // server keeps whatever it allocated (pinning 16k here would SHRINK a larger
        // allocation), and an explicit number requests exactly that.
        ...(this.localOpts.ollamaNumCtx === 'auto'
          ? {}
          : { num_ctx: (typeof this.localOpts.ollamaNumCtx === 'number' && this.localOpts.ollamaNumCtx > 0)
              ? this.localOpts.ollamaNumCtx
              : 16384 }),
        ...(isReasoning ? {} : { temperature: 0 }),   // no temperature for the reasoning pass
      },
    };
    // Modo agente precisa de JSON confiável: força a gramática JSON do Ollama para os
    // modelos que a suportam bem (qwen incl. qwen3-vl, llama, mistral, gemma). Se o
    // modelo tropeçar, o parser ainda extrai o bloco ```json do texto.
    const m = model.toLowerCase();
    // format:json SÓ pra modelo comum (instruct). Modelo de raciocínio erra/aluciza com ele
    // (o raciocínio brigando com a gramática JSON → ação vazia). Ele responde natural e o
    // parser tolerante ([page-agent.ts]) extrai o JSON do fim.
    if (isAgentMode && /qwen|llama|mistral|gemma/.test(m) && !isReasoning) {
      body.format = 'json';
    }
    // Modelo de raciocínio: pede o pensamento no canal SEPARADO 'thinking' — no agente,
    // o content vem limpo (só o JSON, raciocínio fora); no chat, o leitor NDJSON embrulha
    // em <think> pra UI. Se o Ollama não suportar 'think', a retentativa abaixo refaz sem.
    if (isReasoning) {
      // Sticky: once thinking has been cut in this run it stays off (the app can lift it by
      // marking the run stuck). Proven via usage below, not assumed.
      body.think = thinkingOff || this.isThinkingThrottled(model) ? false : true;
    }

    const t0 = Date.now();
    console.log(`[Ollama] → POST /api/chat (model=${model}, isAgent=${isAgentMode})`);

    // 1ª chamada carrega o modelo na VRAM (pode levar minutos num modelo grande/frio); depois
    // fica quente. fetchWithTimeout ABORTA de verdade no estouro (!= Promise.race, que vazava o
    // socket e nunca limpava o timer — deixava o event loop ativo por ate 5 min por request).
    const firstChunkMs = LOCAL_FIRST_CHUNK_MS;
    let res: Response;
    let settle: (() => void) | undefined;
    let abortFn: (() => void) | undefined;
    const release = () => { const s = settle; settle = undefined; try { s?.(); } catch {} };
    // Drop the socket before a resend: otherwise Ollama keeps generating while we retry.
    const abandon = () => { const a = abortFn; abortFn = undefined; release(); try { a?.(); } catch {} };
    try {
      const cf = await fetchCancellable(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, { firstChunkMs, totalMs: streaming ? undefined : LOCAL_TOTAL_MS, signal, label: `Ollama ${model}` });
      res = cf.res;
      settle = cf.settle;
      abortFn = cf.abort;
    } catch (e: any) {
      release();
      // Estouro de tempo NÃO é falha de conexão. O Ollama respondeu — devagar demais, quase
      // sempre porque o modelo não cabe na VRAM e parte dele roda na CPU (medido: 27B Q6_K =
      // 24 GB numa placa de 16 GB → 10,7 GB na CPU, e a chamada com a página inteira estourava).
      // Embrulhar os dois casos na mesma frase mandava o usuário ligar um Ollama já ligado.
      if (e instanceof LocalRequestError) {
        if (e.code === 'CANCELLED') throw e;   // Parar do usuário: repassa intacto
        if (e.code === 'TIMEOUT_FIRST_CHUNK') throw new LocalRequestError('TIMEOUT_FIRST_CHUNK', `Ollama too slow: ${e.message}`, true, e.detail);
        if (e.code === 'CONNECTION_FAILED') throw new LocalRequestError('CONNECTION_FAILED', `Ollama connection failed: ${e.message}`, true, e.detail);
      }
      if (e?.message === 'CANCELLED') throw e;
      if (/^Request timeout/.test(e?.message || '')) {
        throw new Error(`Ollama too slow: ${e.message}`);
      }
      throw new Error(`Ollama connection failed: ${e.message}`);
    }


    console.log(`[Ollama] ← ${res.status} in ${Date.now() - t0}ms`);
    if (!res.ok) {
      const errText = await res.text();
      release();
      // Modelo importado de GGUF cru pode não ter a capability 'thinking' → o Ollama
      // recusa o think:true. Refaz UMA vez sem ele (ainda streamando; os tags <think>
      // inline no texto seguem tratados pelo renderer).
      if (body.think && res.status >= 400 && res.status < 500) {
        delete body.think;
        const retry = await fetchCancellable(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }, { firstChunkMs, totalMs: streaming ? undefined : LOCAL_TOTAL_MS, signal, label: `Ollama ${model} (no-think)` });
        res = retry.res;
        settle = retry.settle;
        abortFn = retry.abort;
        if (!res.ok) { const t = await res.text().catch(() => ''); release(); throw new Error(`Ollama API error ${res.status}: ${t.slice(0, 400)}`); }
      } else {
        throw new Error(`Ollama API error ${res.status}: ${errText.slice(0, 400)}`);
      }
    }

    // Chat streamado: NDJSON linha a linha (o fallback do callChatLLM refaz sem stream
    // se der erro antes do 1º delta — mesmo contrato dos provedores de nuvem).
    try {
      if (streaming) {
        let sawDelta = false;
        const wrap = (d: string) => { sawDelta = true; try { onDelta!(d); } catch {} };
        const metrics: { usage?: any } = {};
        const thinking = ThinkingBudget.forStep(this.stepTokens.get(sKey) ?? 0);
        const thinkWrap = (d: string) => { wrap(d); this.emitMetrics('thinking', d.length, t0); };
        try {
          const text = await readOllamaNdjson(res, thinkWrap, signal, LOCAL_INACTIVITY_MS, thinking, metrics);
          this.emitMetrics('answer', text.length, t0, !!metrics.usage?.eval_count, { completion_tokens: metrics.usage?.eval_count });
          if (metrics.usage?.eval_count) this.stepTokens.set(sKey, metrics.usage.eval_count);
          if ((thinkingOff || this.isThinkingThrottled(model)) && (metrics.usage?.thinking_count ?? 0) > 0) {
            console.log(`[Ollama] ${model} ignorou think:false (${metrics.usage.thinking_count} thinking tokens)`);
          }
          return text;
        } catch (e: any) {
          if (e instanceof LocalRequestError && e.code === 'THINKING_BUDGET' && !thinkingOff) {
            this.slowThinking.add(sKey);
            console.log(`[Ollama] thinking longo demais em ${model} → think:false nesta sessao`);
            abandon();
            return this.callOllama(messages, isAgentMode, onDelta, signal, forceNoStream, true);
          }
          if (!sawDelta && !signal?.aborted && resend < 2) {
            const wait = resend === 0 ? 2000 : 5000;
            console.log(`[Ollama] stream falhou antes do 1º delta (${e?.message}) → reenvio ${resend + 2}/3 em ${wait}ms`);
            abandon();
            await sleep(wait, signal);
            return this.callOllama(messages, isAgentMode, onDelta, signal, forceNoStream, thinkingOff, resend + 1);
          }
          if (!sawDelta && !signal?.aborted && !forceNoStream) {
            this.streamRejected.add(sKey);
            console.log('[Ollama] stream falhou antes do 1º delta → sem stream para este modelo');
            abandon();
            return this.callOllama(messages, isAgentMode, onDelta, signal, true, thinkingOff);
          }
          throw e;
        }
      }

      let data: any = {};
      try {
        data = await res.json();
      } catch (e: any) {
        if (signal?.aborted) throw e;
        if (resend < 2) {
          const wait = resend === 0 ? 2000 : 5000;
          console.log(`[Ollama] corpo nao veio (${e?.message}) → reenvio ${resend + 2}/3 em ${wait}ms`);
          abandon();
          await sleep(wait, signal);
          return this.callOllama(messages, isAgentMode, onDelta, signal, forceNoStream, thinkingOff, resend + 1);
        }
        throw new LocalRequestError('BAD_JSON', `Ollama body read failed: ${e?.message ?? e}`, true);
      }
      if (data?.eval_count) this.stepTokens.set(sKey, data.eval_count);
      const content = data?.message?.content ?? '';
      if (!content) {
        console.warn(`[Ollama] empty content. data=${JSON.stringify(data).slice(0, 300)}`);
      }
    // Chat não-streamado: se o Ollama separou o pensamento (message.thinking), reanexa
    // como <think> pra UI mostrar o chip 💭. Modo agente fica só com o content (JSON).
      const th = !isAgentMode ? (data.message?.thinking ?? '') : '';
      return th ? `${content}` : content;
    } finally {
      release();   // body consumed or abandoned: free the socket and the clocks
    }
  }
}
