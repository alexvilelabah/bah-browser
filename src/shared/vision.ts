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

/** Provider cannot take image input at all (no image API on the route). */
const NO_IMAGE_PROVIDERS = new Set(['deepseek', 'mistral', 'nvidia']);
export function providerAcceptsImages(provider?: string): boolean {
  return !NO_IMAGE_PROVIDERS.has((provider || '').toLowerCase());
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

const RX_IMAGE_INTENT =
  /\b(image|imagens?|foto|fotos|imagem|picture|photo|screenshot|captura|print|desenh[oa]|ilustra[çc][ãa]o|gr[áa]fico|graph|chart|diagram|logo|banner| thumbnail|miniatura|visual|aparece|aparecem|mostra|mostre|veja|ver|look|see|describ[ae]|describe|what is this|what does this|o que (?:é|e|esta|isso)|como (?:é|e|fica|parece))\b/i;

/** Question is about what a picture LOOKS like (bilingual) — needs pixels, not OCR. */
export function looksLikeVisualIntent(text: string): boolean {
  return RX_IMAGE_INTENT.test(text || '');
}

/** Question is about TEXT rendered in an image (bilingual). Fixes the old
 *  Portuguese-only gate that silently never fired for English commands. */
export function looksLikeTextReadIntent(text: string): boolean {
  const t = text || '';
  const imageWord = /\b(imagem|imagens|image|foto|fotos|picture|photo|screenshot|captura|print)\b/i.test(t);
  const textWord = /\b(texto|text|escrito|escrita|letters?|caractere|palavra|word|n[úu]mero|number|d[íi]git|read|ler|leia|l[êe]|diga|say|transcri|extract|c[ôo]digo|captcha|url|link|endere[çc]o|address)\b/i.test(t);
  return imageWord && textWord;
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
export function estimateImageTokens(width: number, height: number): number {
  if (!width || !height) return 800;
  return Math.max(100, Math.ceil((width * height) / (28 * 28)));
}
