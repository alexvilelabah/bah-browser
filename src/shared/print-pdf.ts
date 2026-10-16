// print-pdf.ts — regras PURAS do "Imprimir…" e do "Salvar como PDF…" (menu ⋮ / Ctrl+P).
// Sem electron, sem fs, sem DOM: o main e os testes usam a MESMA regra.
//  • Nome do arquivo: vem do título da página (igual ao Chrome), limpo pra qualquer sistema.
//  • Papel: Carta nos países que usam Carta (EUA, Canadá, México…), A4 no resto do mundo.
//  • Quais endereços dá pra imprimir (páginas internas não dão).

/** Tamanho máximo do nome (sem o ".pdf"): folga pro caminho inteiro caber no limite do Windows. */
export const MAX_NAME_CHARS = 120;

// Nomes que o Windows reserva pra aparelhos (CON, NUL, COM1…): um arquivo assim não abre.
const WIN_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Nome do arquivo PDF a partir do título da página (cai pro site do endereço, depois "pagina"). */
export function pdfFileName(title: unknown, url?: unknown, fallback = 'pagina'): string {
  let name = cleanName(typeof title === 'string' ? title : '');
  if (!name) name = cleanName(hostOf(url));
  if (!name) name = cleanName(fallback) || 'page';
  return name + '.pdf';
}

function cleanName(raw: string): string {
  let s = String(raw || '')
    .normalize('NFC')
    // Caracteres proibidos no Windows/macOS e de controle viram espaço (não somem: "a/b" ≠ "ab").
    .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, ' ')
    // Marcas invisíveis de direção do texto (truque de nome falso, ex.: "fdp.exe") somem.
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Título que já termina em ".pdf" (aba de um PDF) não vira "x.pdf.pdf".
  s = s.replace(/\.pdf$/i, '').trim();
  s = cutChars(s, MAX_NAME_CHARS);
  // Windows não aceita nome terminando em ponto ou espaço; começando em ponto vira oculto no Mac.
  s = s.replace(/[. ]+$/g, '').replace(/^[. ]+/g, '');
  if (WIN_RESERVED.test(s)) s = '_' + s;
  return s;
}

// Corta por caractere de verdade (não quebra emoji / letra acentuada composta no meio).
function cutChars(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('').trim() : s;
}

function hostOf(url: unknown): string {
  if (typeof url !== 'string' || !url) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') {
      const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
      return last.replace(/\.[a-z0-9]{1,5}$/i, '');
    }
    return u.hostname.replace(/^www\./i, '');
  } catch { return ''; }
}

// Países que usam papel Carta (lista do CLDR, a mesma que o Chrome usa pro padrão de impressão).
const LETTER_REGIONS = new Set(['US', 'CA', 'MX', 'BZ', 'CL', 'CO', 'CR', 'GT', 'NI', 'PA', 'PH', 'PR', 'SV', 'VE']);

/**
 * Papel padrão pelo país. Aceita o código do país em maiúsculas ("BR", "US") ou um idioma com região
 * ("pt-BR", "en_US", "es-MX"). Sem país reconhecível → A4 (o padrão de quase todo o mundo).
 */
export function paperSizeFor(...hints: Array<string | null | undefined>): 'A4' | 'Letter' {
  for (const h of hints) {
    const region = regionOf(h);
    if (region) return LETTER_REGIONS.has(region) ? 'Letter' : 'A4';
  }
  return 'A4';
}

function regionOf(hint: string | null | undefined): string {
  const s = String(hint || '').trim().replace(/_/g, '-').replace(/\..*$/, '');   // "pt_BR.UTF-8" → "pt-BR"
  if (!s) return '';
  // Só o país vem em MAIÚSCULA ("BR"); duas letras minúsculas são idioma sem país ("en").
  if (/^[A-Z]{2}$/.test(s)) return s;
  const parts = s.split('-');
  for (const p of parts.slice(1)) if (/^[A-Za-z]{2}$/.test(p)) return p.toUpperCase();
  return '';
}

/** Endereço que é um arquivo PDF (a aba mostra o visualizador de PDF, não uma página). */
export function isPdfUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false;
  try { return /\.pdf$/i.test(decodeURIComponent(new URL(url).pathname)); } catch { return false; }
}

export type PrintableKind = 'ok' | 'empty' | 'internal';

/**
 * Dá pra imprimir/salvar esta página? Sites (http/https), arquivos locais e data:/blob: sim;
 * aba vazia (about:blank) e páginas internas (chrome://, devtools://, extensões) não.
 */
export function printableKind(url: unknown): PrintableKind {
  if (typeof url !== 'string' || !url.trim()) return 'empty';
  let proto = '';
  try { proto = new URL(url).protocol; } catch { return 'internal'; }
  if (proto === 'http:' || proto === 'https:' || proto === 'file:' || proto === 'data:' || proto === 'blob:') return 'ok';
  if (proto === 'about:') return 'empty';
  return 'internal';
}
