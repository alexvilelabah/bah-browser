// tab-strip.ts — regras PURAS da barra de abas estilo Chrome (sem React, sem DOM, sem electron).
// O renderer e os testes (tests/unit/tab-strip.test.ts) usam a MESMA conta:
//  • Ordem: arrastar e Ctrl+Shift+PageUp/PageDown movem uma aba entre as VISÍVEIS; as fixadas
//    ficam sempre antes das outras (nem arrastar nem o teclado cruzam essa fronteira).
//  • Onde nasce a aba de "Nova aba à direita"/"Duplicar"; quem sai em "Fechar outras abas" e
//    "Fechar abas à direita" (as fixadas ficam, igual ao Chrome).
//  • Quem fica ativa quando a ativa fecha — nunca uma aba escondida do agente.
//  • Ordem dos <webview> no DOM: a de chegada de cada aba, NUNCA a da barra (mover um <webview>
//    no DOM desanexa a página e ela recarrega do zero — vídeo, formulário, tudo perdido).
//  • Arrasto: para onde a aba vai e quanto as vizinhas deslizam.
//  • O "site" do "Desativar som do site" e as listas salvas (abas fixadas, sites mudos).
// Abas escondidas (trabalho do agente: Pesquisa Rápida etc.) não aparecem na barra e aqui nunca
// mudam de casa na lista completa.

export interface StripTab { id: string; hidden?: boolean; pinned?: boolean }

export const MAX_SAVED_PINNED = 50;   // teto da lista de fixadas salva (localStorage)
export const MAX_MUTED_SITES = 500;   // teto da lista de sites mudos salva
const MAX_URL = 4096;
const MAX_TITLE = 300;

// ── Ordem ──

/** As abas que aparecem na barra, na ordem da barra. */
export function stripTabs<T extends StripTab>(tabs: readonly T[]): T[] {
  return tabs.filter(t => !t.hidden);
}

/** Quantas abas fixadas (são sempre as primeiras da barra). */
export function pinnedCount(tabs: readonly StripTab[]): number {
  let n = 0;
  for (const t of tabs) if (!t.hidden && t.pinned) n++;
  return n;
}

/** Posições da barra (lo..hi) onde uma aba fixada / não fixada pode ficar. */
export function groupRange(tabs: readonly StripTab[], pinned: boolean): [number, number] {
  const n = stripTabs(tabs).length;
  const p = pinnedCount(tabs);
  return pinned ? [0, p - 1] : [p, n - 1];
}

// Recoloca as visíveis na ordem nova, nas MESMAS casas que as visíveis ocupavam: as escondidas
// não saem do lugar (o agente acha as abas pelo índice da lista completa).
function withStripOrder<T extends StripTab>(tabs: readonly T[], strip: readonly T[]): T[] {
  let k = 0;
  return tabs.map(t => (t.hidden ? t : strip[k++]));
}

/** Move a aba `id` para a posição `to` da barra (contada entre as visíveis, já sem ela).
 *  Fora do grupo dela (fixadas / outras), fica na ponta do grupo. Nada muda → mesma lista. */
export function moveTab<T extends StripTab>(tabs: readonly T[], id: string, to: number): T[] {
  const strip = stripTabs(tabs);
  const from = strip.findIndex(t => t.id === id);
  if (from < 0 || !Number.isFinite(to)) return tabs as T[];
  const [lo, hi] = groupRange(tabs, !!strip[from].pinned);
  const dest = Math.max(lo, Math.min(hi, Math.trunc(to)));
  if (dest === from) return tabs as T[];
  const next = strip.slice();
  const [moved] = next.splice(from, 1);
  next.splice(dest, 0, moved);
  return withStripOrder(tabs, next);
}

/** Fixar / Liberar (igual ao Chrome): a fixada vai pro FIM das fixadas; a liberada, pro COMEÇO
 *  das outras. Já estava assim (ou não existe) → mesma lista. */
export function setPinned<T extends StripTab>(tabs: readonly T[], id: string, pinned: boolean): T[] {
  const strip = stripTabs(tabs);
  const from = strip.findIndex(t => t.id === id);
  if (from < 0 || !!strip[from].pinned === pinned) return tabs as T[];
  const rest = strip.filter((_, i) => i !== from);
  rest.splice(pinnedCount(rest), 0, { ...strip[from], pinned });
  return withStripOrder(tabs, rest);
}

/** Aba nova de "Nova aba à direita"/"Duplicar": logo depois da âncora — mas uma aba comum nunca
 *  entra no meio das fixadas (vai pro começo das outras) e uma fixada nunca fica depois delas.
 *  Âncora sumiu → no fim do grupo dela. */
export function insertAfter<T extends StripTab>(tabs: readonly T[], anchorId: string, tab: T): T[] {
  const strip = stripTabs(tabs);
  const p = pinnedCount(tabs);
  const a = strip.findIndex(t => t.id === anchorId);
  let pos = a < 0 ? (tab.pinned ? p : strip.length) : a + 1;
  pos = tab.pinned ? Math.min(pos, p) : Math.max(pos, p);
  if (pos >= strip.length) return [...tabs, tab];
  const before = tabs.indexOf(strip[pos]);
  return [...tabs.slice(0, before), tab, ...tabs.slice(before)];
}

// ── Fechar ──

/** "Fechar outras abas": as visíveis menos ela — as fixadas ficam (igual ao Chrome). */
export function closeOthersIds(tabs: readonly StripTab[], id: string): string[] {
  if (!stripTabs(tabs).some(t => t.id === id)) return [];
  return stripTabs(tabs).filter(t => t.id !== id && !t.pinned).map(t => t.id);
}

/** "Fechar abas à direita": as visíveis depois dela — as fixadas ficam. */
export function closeRightIds(tabs: readonly StripTab[], id: string): string[] {
  const strip = stripTabs(tabs);
  const i = strip.findIndex(t => t.id === id);
  if (i < 0) return [];
  return strip.slice(i + 1).filter(t => !t.pinned).map(t => t.id);
}

/** Quem fica ativa depois de fechar `closing`: a ativa, se ficou na barra; senão a vizinha da
 *  DIREITA que sobrou, senão a da esquerda. null = não sobrou nenhuma visível (abrir uma nova).
 *  Nunca devolve uma aba escondida (a de trabalho do agente não pode virar a aba da pessoa). */
export function nextActiveAfterClose(tabs: readonly StripTab[], closing: ReadonlySet<string>, activeId: string): string | null {
  const strip = stripTabs(tabs);
  const i = strip.findIndex(t => t.id === activeId);
  if (i >= 0 && !closing.has(activeId)) return activeId;
  if (i < 0) {
    const first = strip.find(t => !closing.has(t.id));
    return first ? first.id : null;
  }
  for (let j = i + 1; j < strip.length; j++) if (!closing.has(strip[j].id)) return strip[j].id;
  for (let j = i - 1; j >= 0; j--) if (!closing.has(strip[j].id)) return strip[j].id;
  return null;
}

// ── <webview> no DOM ──

/** Ordem dos <webview> no DOM: a de CHEGADA de cada aba (`seq`), nunca a da barra. Com a ordem
 *  da barra, o React MOVERIA o <webview> ao arrastar uma aba — e <webview> movido recarrega.
 *  `seq` é atualizado aqui: aba nova ganha o próximo número (entra no fim), fechada sai. Aba
 *  dormindo (Memory Saver) fica fora da lista mas guarda o número: ao acordar entra na casa dela
 *  (inserir não move as outras). */
export function webviewOrder<T extends { id: string; discarded?: boolean }>(tabs: readonly T[], seq: Map<string, number>): T[] {
  let next = 0;
  for (const v of seq.values()) if (v >= next) next = v + 1;
  const live = new Set<string>();
  for (const t of tabs) {
    live.add(t.id);
    if (!seq.has(t.id)) seq.set(t.id, next++);
  }
  for (const id of Array.from(seq.keys())) if (!live.has(id)) seq.delete(id);
  return tabs.filter(t => !t.discarded).sort((a, b) => (seq.get(a.id) ?? 0) - (seq.get(b.id) ?? 0));
}

// ── Arrasto ──

/** Arrastando a aba `from` (barra medida no começo do arrasto: `lefts`/`widths`), deslocada `dx`
 *  pixels: o deslocamento fica preso ao grupo dela (posições lo..hi) e a aba cai na posição `to`
 *  quando a borda dela passa do MEIO da vizinha (igual ao Chrome: troca na metade). */
export function dragTarget(lefts: readonly number[], widths: readonly number[], from: number, lo: number, hi: number, dx: number): { dx: number; to: number } {
  if (!(from >= lo && from <= hi) || !Number.isFinite(dx)) return { dx: 0, to: from };
  const w = widths[from];
  const minDx = lefts[lo] - lefts[from];
  const maxDx = lefts[hi] + widths[hi] - (lefts[from] + w);
  const d = Math.max(minDx, Math.min(maxDx, dx));
  const left = lefts[from] + d;
  const right = left + w;
  let to = from;
  for (let j = from + 1; j <= hi; j++) { if (right > lefts[j] + widths[j] / 2) to = j; else break; }
  for (let j = from - 1; j >= lo; j--) { if (left < lefts[j] + widths[j] / 2) to = j; else break; }
  return { dx: d, to };
}

/** Quanto a aba da posição `i` desliza enquanto a arrastada (largura `w`) saiu de `from` e está
 *  sobre `to`: as que ela já passou vão uma casa pro lado de onde ela veio. */
export function dragShift(i: number, from: number, to: number, w: number): number {
  if (from < to && i > from && i <= to) return -w;
  if (to < from && i >= to && i < from) return w;
  return 0;
}

// ── Sites e listas salvas ──

function webUrl(url: unknown): URL | null {
  if (typeof url !== 'string' || !url || url.length > MAX_URL) return null;
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? u : null;
  } catch { return null; }
}

/** O "site" do "Desativar som do site": o host sem "www." (youtube.com e www.youtube.com são o
 *  mesmo site; m.youtube.com é outro). null = página que não é http/https. */
export function siteKey(url: unknown): string | null {
  const u = webUrl(url);
  if (!u) return null;
  return u.hostname.toLowerCase().replace(/^www\./, '') || null;
}

export interface SavedPinned { url: string; title: string }

/** Lista antiga das fixadas (pinnedTabs.v1, do localStorage: pode estar velha ou estragada) → só o
 *  que presta. Hoje as fixadas moram na sessão (shared/session-restore.ts migra esta lista 1x). */
export function sanitizePinned(raw: unknown): SavedPinned[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedPinned[] = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const url = (it as { url?: unknown }).url;
    const title = (it as { title?: unknown }).title;
    if (!webUrl(url)) continue;
    out.push({ url: url as string, title: typeof title === 'string' ? title.slice(0, MAX_TITLE) : '' });
    if (out.length >= MAX_SAVED_PINNED) break;
  }
  return out;
}

/** Lista salva dos sites mudos → só sites válidos, minúsculos, sem repetir. */
export function sanitizeSites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const it of raw) {
    if (typeof it !== 'string' || !it || it.length > 253) continue;
    const k = siteKey(`https://${it}/`);
    if (k && k === it.toLowerCase()) out.add(k);
    if (out.size >= MAX_MUTED_SITES) break;
  }
  return [...out];
}
