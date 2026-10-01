/**
 * Vision policy + payload primitives (shared by renderer and main — keep it pure TS,
 * no electron imports).
 *
 * Two independent layers:
 *  - mode (user intent) + per-step heuristics, decided in the renderer;
 *  - capability/size gates (model truth), enforced in ai-engine.ts:resolveVision().
 * Every 'no' carries a machine-readable reason so the UI can be honest about
 * "no image this step" instead of letting the model guess.
 */

export type VisionMode = 'off' | 'auto' | 'always';

/** One screenshot for a model call: encoded image + the geometry it came from,
 *  so the coordinate contract can be stated instead of guessed. */
export interface VisionImage {
  dataUrl: string;          // data:image/jpeg;base64,… (already downscaled)
  width?: number;
  height?: number;
  cssWidth?: number;        // live viewport in CSS px — the space click_at must use
  cssHeight?: number;
  bytes?: number;         // encoded size, for diagnostics (never logged as content)
}

/** How the model was fed, for the UI and the logs. Never contains image bytes. */
export interface VisionReport {
  attached: boolean;
  reason: string;
  bytes?: number;
  width?: number;
  height?: number;
}

/** Split a data URL into mime + base64; null on anything malformed. */
export function splitDataUrl(dataUrl?: string): { mime: string; base64: string } | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl || '');
  if (!m) return null;
  return { mime: m[1].toLowerCase(), base64: m[2].replace(/\s+/g, '') };
}

/** Legacy boolean → new tri-state. Existing `"vision": true` keeps working as 'auto'. */
export function resolveVisionMode(ls: { vision?: boolean; visionMode?: VisionMode }): VisionMode {
  if (ls.visionMode === 'off' || ls.visionMode === 'auto' || ls.visionMode === 'always') return ls.visionMode;
  return ls.vision === true ? 'auto' : 'off';
}

/** Providers with no image input on their API route — images never travel. */
export const NO_IMAGE_PROVIDERS = new Set(['deepseek', 'mistral', 'nvidia']);

/** Never let the internal `image` field leak into a provider payload. */
export function stripImages<T extends { image?: unknown }>(msgs: T[]): Omit<T, 'image'>[] {
  return msgs.map(m => { const { image, ...rest } = m; return rest as Omit<T, 'image'>; });
}

export function providerAcceptsImages(provider?: string): boolean {
  return !NO_IMAGE_PROVIDERS.has((provider || '').toLowerCase());
}

/** Rejections that will not change for the rest of an agent run: once main reports one
 *  of these, the renderer stops capturing/encoding/IPC-ing frames nobody will look at. */
export const STICKY_VISION_REASONS = new Set(['mode_off', 'provider_no_vision', 'model_no_vision', 'model_rejected_image']);

/** Server error text that means "this model/route takes no image input". Seen in the
 *  wild: llama.cpp without --mmproj, LM Studio text models, vLLM text models, and
 *  servers that only accept string `content`. */
export const RX_IMAGE_REJECTED =
  /image input is not supported|missing data required for image input|mmproj|does not support (?:images?|vision|multimodal)|not a multimodal model|vision is not (?:supported|enabled)|image_url|content must be a string|expected string.{0,40}content|multimodal/i;

/** Real pixel size of an encoded PNG/JPEG, read from its header. The NativeImage size
 *  is in DIP; on HiDPI screens the encoded bitmap can be 2x that, and the coordinate
 *  contract must use what the MODEL actually sees. null when unparseable. */
export function encodedImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const b = bytes;
  // PNG: 8-byte signature, then IHDR with width/height as big-endian u32.
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const u32 = (o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
    return { width: u32(16), height: u32(20) };
  }
  // JPEG: walk the segments until a Start-Of-Frame marker (C0-CF minus C4/C8/CC).
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = (b[i + 2] << 8) + b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: (b[i + 7] << 8) + b[i + 8], height: (b[i + 5] << 8) + b[i + 6] };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** base64 → bytes without Buffer (works in the sandboxed renderer and in main). Only
 *  the head is decoded: image headers live in the first few KB. */
export function base64Head(base64: string, maxBytes = 64 * 1024): Uint8Array {
  const chunk = base64.slice(0, Math.ceil(maxBytes / 3) * 4);
  const bin = atob(chunk);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Map a click_at coordinate from screenshot pixels to live-viewport CSS pixels and
 *  clamp it inside the viewport (outside it no click can land). */
export function mapShotPointToViewport(
  x: number, y: number,
  shot: { width?: number; height?: number } | undefined,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const sx = shot?.width && viewport.width ? viewport.width / shot.width : 1;
  const sy = shot?.height && viewport.height ? viewport.height / shot.height : 1;
  const clamp = (v: number, max: number) => Math.max(0, max > 0 ? Math.min(v, max - 1) : v);
  return { x: clamp(Math.round(x * sx), viewport.width), y: clamp(Math.round(y * sy), viewport.height) };
}

/** Max long edge of the inference image. Never upscaled. */
export const VISION_MAX_SIDE = 1280;
/** Encoded bytes cap per image (main enforces its own hard cap too).
 *  A 1280px JPEG at q82 is ~150-400 KB, so this only trips on pathological pages. */
export const VISION_MAX_BYTES = 2_500_000;
/** Images per agent run in 'auto' — bounds tokens/latency on long runs. */
export const VISION_MAX_IMAGES_PER_RUN = 8;
/** Pixels below this on the long edge, detail is already gone: skip the send. */
export const VISION_MIN_SIDE = 320;

// JS `\b` is ASCII-only: it never fires next to "é"/"ê"/"ç", so "o que é" or "lê" could not
// match. These use Unicode letter boundaries instead. Entries ending in `\p{L}*` are stems
// (transcri → transcribe/transcreva/transcrição).
const wordRx = (alts: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'iu');

// Deliberately NOT generic verbs like "see"/"look"/"ver"/"mostra": they appear in most
// requests ("see if there is a refund policy") and would attach an image every turn.
const RX_IMAGE_INTENT = wordRx([
  'images?', 'imagens?', 'imagen(?:es)?', 'pictures?', 'photos?', 'fotos?', 'screenshots?', 'capturas?',
  'desenhos?', 'dibujos?', 'ilustra(?:ção|cao|ções|coes|ción|cion)', 'gr[áa]ficos?', 'graphs?', 'charts?',
  'diagram(?:a|as|s)?', 'logos?', 'banners?', 'thumbnails?', 'miniaturas?', 'icons?', '[íi]cones?', 'iconos?',
  'colou?rs?', 'cor(?:es)?', 'layout', 'look(?:s)? like', 'parece(?:m)?', 'describ\\p{L}*', 'descrev\\p{L}*',
  'what is this', 'what does (?:this|it) look', 'o que (?:é|e) (?:isso|isto|essa|esta)', 'qu[ée] es (?:esto|eso)',
].join('|'));

const RX_IMAGE_WORD = wordRx('imagem|imagens|imagen(?:es)?|images?|fotos?|pictures?|photos?|screenshots?|capturas?|print');
const RX_TEXT_WORD = wordRx([
  'texto', 'text', 'escrit\\p{L}*', 'letters?', 'letras?', 'caracter\\p{L}*', 'palavras?', 'palabras?', 'words?',
  'n[úu]meros?', 'numbers?', 'd[íi]git\\p{L}*', 'read', 'ler', 'leer', 'leia', 'l[êe]', 'lee', 'diga', 'say',
  'transcri\\p{L}*', 'extra(?:ct|i|e)\\p{L}*', 'c[óo]dig\\p{L}*', 'codes?', 'captcha', 'urls?', 'links?',
  'endere[çc]o', 'direcci[óo]n', 'address',
].join('|'));

/** Question is about what a picture LOOKS like (en/pt/es) — needs pixels, not OCR. */
export function looksLikeVisualIntent(text: string): boolean {
  return RX_IMAGE_INTENT.test(text || '');
}

/** Question is about TEXT rendered in an image (en/pt/es). Fixes the old
 *  Portuguese-only gate that silently never fired for English commands. */
export function looksLikeTextReadIntent(text: string): boolean {
  const t = text || '';
  return RX_IMAGE_WORD.test(t) && RX_TEXT_WORD.test(t);
}

export interface ShotDecision {
  attach: boolean;
  reason: string;
}

/**
 * 'auto' heuristics — attach only when pixels earn their cost:
 * first step of a task, the page just changed, the DOM has no text to work
 * with (canvas/iframe/image-centric), or the request is explicitly visual.
 */
export function decideAgentShot(o: {
  mode: VisionMode;
  step: number;
  pageChanged: boolean;
  domTextLen: number;
  imagesSent: number;
  command: string;
  provider?: string;
}): ShotDecision {
  if (o.mode === 'off') return { attach: false, reason: 'mode_off' };
  if (!providerAcceptsImages(o.provider)) return { attach: false, reason: 'provider_no_vision' };
  if (o.mode === 'always') return { attach: true, reason: 'mode_always' };
  if (o.imagesSent >= VISION_MAX_IMAGES_PER_RUN) return { attach: false, reason: 'run_budget' };
  if (o.step === 0) return { attach: true, reason: 'first_step' };
  if (o.pageChanged) return { attach: true, reason: 'page_changed' };
  if (o.domTextLen < 200) return { attach: true, reason: 'sparse_dom' };
  if (looksLikeVisualIntent(o.command)) return { attach: true, reason: 'visual_intent' };
  return { attach: false, reason: 'auto_no_need' };
}

/** Chat: attach when the mode is on and the turn needs the page's look. */
export function decideChatShot(o: {
  mode: VisionMode;
  message: string;
  pageTextLen: number;
  hasDoc: boolean;
  provider?: string;
}): ShotDecision {
  if (o.mode === 'off') return { attach: false, reason: 'mode_off' };
  if (!providerAcceptsImages(o.provider)) return { attach: false, reason: 'provider_no_vision' };
  if (o.hasDoc) return { attach: false, reason: 'doc_attached' };
  if (o.mode === 'always') return { attach: true, reason: 'mode_always' };
  if (looksLikeVisualIntent(o.message)) return { attach: true, reason: 'visual_intent' };
  if (o.pageTextLen < 200) return { attach: true, reason: 'sparse_dom' };
  return { attach: false, reason: 'auto_no_need' };
}

/** Rough image token cost (approximate, labelled as such at the call site).
 *  Vision encoders tile images; ~1 token per ~28x28 patch is a fair estimate. */
export function estimateImageTokens(width?: number, height?: number): number {
  if (!width || !height) return 800;
  return Math.max(100, Math.ceil((width * height) / (28 * 28)));
}
