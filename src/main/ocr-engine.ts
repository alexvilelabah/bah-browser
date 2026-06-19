/**
 * ocr-engine.ts
 * OCR local usando Tesseract.js (100% Node — sem instalação nativa no Windows).
 *
 * Exports:
 *   runOCR(imagePath, options?) → OcrResult
 *   hasEnoughDomText(text, minChars?) → boolean  ← fallback guard
 */

import path from 'path';

export interface OcrResult {
  text: string;
  confidence: number;  // 0–100
  words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
  durationMs: number;
  skipped: boolean;    // true se o DOM já tinha texto suficiente
}

/**
 * Verifica se o texto DOM já é suficiente para dispensar o OCR.
 * Evita rodar Tesseract em páginas que o DOM extrai bem.
 */
export function hasEnoughDomText(domText: string, minChars = 150): boolean {
  const clean = domText.replace(/\s+/g, ' ').trim();
  return clean.length >= minChars;
}

// Persistent worker cache per language. Creating a Tesseract worker loads a ~40MB
// language model and takes 2–5s; reusing it makes every OCR after the first ~5x faster.
// Memory cost (~40–80MB resident) is fine on the user's machine and worth the speed.
const workerCache = new Map<string, Promise<any>>();

function getWorker(lang: string): Promise<any> {
  let w = workerCache.get(lang);
  if (!w) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createWorker } = require('tesseract.js') as typeof import('tesseract.js');
    w = createWorker(lang, 1, { logger: () => {}, errorHandler: () => {} });
    workerCache.set(lang, w);
    // If creation fails, drop it so the next call retries cleanly.
    w.catch(() => workerCache.delete(lang));
  }
  return w;
}

/** Terminate all cached OCR workers (call on app quit to free memory cleanly). */
export async function terminateOcrWorkers(): Promise<void> {
  const all = [...workerCache.values()];
  workerCache.clear();
  await Promise.all(all.map(async p => { try { (await p).terminate(); } catch {} }));
}

/**
 * Roda OCR local com Tesseract.js, reusando um worker persistente por idioma.
 *
 * @param imagePath   Caminho absoluto para o PNG/JPEG capturado
 * @param lang        Idioma (padrão 'por+eng' — português + inglês)
 */
export async function runOCR(
  imagePath: string,
  lang = 'por+eng'
): Promise<OcrResult> {
  const t0 = Date.now();
  const worker = await getWorker(lang);

  const { data } = await worker.recognize(imagePath);
  const raw = data as any;

  const words = ((raw.words ?? []) as any[]).map((w: any) => ({
    text: w.text,
    confidence: w.confidence,
    bbox: w.bbox,
  }));

  return {
    text: (raw.text as string).replace(/\s+/g, ' ').trim(),
    confidence: raw.confidence as number,
    words,
    durationMs: Date.now() - t0,
    skipped: false,
  };
}

/**
 * Versão "inteligente": só roda OCR se o DOM não tiver texto suficiente.
 * Retorna { skipped: true, text: '' } quando o DOM é suficiente.
 */
export async function runOCRIfNeeded(
  imagePath: string,
  domText: string,
  minDomChars = 150,
  lang = 'por+eng'
): Promise<OcrResult> {
  if (hasEnoughDomText(domText, minDomChars)) {
    return {
      text: '',
      confidence: 0,
      words: [],
      durationMs: 0,
      skipped: true,
    };
  }
  return runOCR(imagePath, lang);
}
