// Controles da página vistos pelo DOM (com href e posição) × a lista de elementos do agente (árvore
// de acessibilidade, sem href), e o modal "caseiro" (div fixa sem role=dialog) que fica por cima.
// Puro (sem DOM) pra testar direto; o script da página só coleta os números.

export interface PageControl { text: string; href?: string; x: number; y: number }
export interface ListedElement { id: number; text?: string; aria?: string; x: number; y: number }

const norm = (s?: string) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * O [id] da lista que é ESTE controle: mesmo texto, o mais perto da posição. Dois "Install Steam"
 * (menu → página; botão grande → .dmg) ou dois "Download" (página atrás × modal) — a posição desempata.
 */
export function matchControl(list: ListedElement[], c: PageControl, maxDist = 120): ListedElement | null {
  const t = norm(c.text);
  if (!t) return null;
  let best: ListedElement | null = null, bestD = Infinity;
  for (const e of list) {
    const et = norm(e.text || e.aria);
    if (!et || !(et === t || (t.length >= 6 && (et.startsWith(t) || t.startsWith(et))))) continue;
    const d = Math.hypot((e.x || 0) - c.x, (e.y || 0) - c.y);
    if (d < bestD) { best = e; bestD = d; }
  }
  return best && bestD <= maxDist ? best : null;
}

// ── Modal sem ARIA ─────────────────────────────────────────────────────────────────────────────

export interface OverlayCandidate {
  z: number;              // z-index computado
  area: number;           // fração da viewport (0–1)
  top: number;
  height: number;
  viewportH: number;
  hitCenter: boolean;     // elementFromPoint no meio da tela cai DENTRO dele
  label: string;          // título/aria-label/texto inicial
  buttons: PageControl[]; // botões/links visíveis dentro dele
  legacy: boolean;        // a regra antiga (fixo/absoluto, z ≥ 10, ≥ 20% da tela) já o pegava
}

const ACTION_RE = /\b(download|continue|close|cancel|ok|accept|agree|install|next|confirm|dismiss|got it|no thanks|baixar|continuar|fechar|descargar|cerrar)\b|^[×x✕]$/i;

/** Pontos do candidato; < 0 = não é modal (barra de cabeçalho, sem botões, sem sinal de "por cima"). */
export function overlayScore(c: OverlayCandidate, backdrop: boolean): number {
  if (!c.buttons.length) return -1;                                        // fundo escuro / enfeite
  if (c.top <= 0 && c.height < 140) return -1;                             // cabeçalho fixo
  if (c.top + c.height >= c.viewportH - 1 && c.height < 140 && !c.legacy && !c.hitCenter) return -1;   // barra fixa no rodapé
  // Sem a regra antiga, precisa de prova de que está POR CIMA: cobre o meio da tela, ou há um fundo.
  if (!c.legacy && !c.hitCenter && !backdrop) return -1;
  // Só "cobre o meio" com z baixo é conteúdo da página (carrossel, hero absoluto), não modal.
  if (!c.legacy && !backdrop && c.z < 10) return -1;
  let s = c.legacy ? 4 : 0;
  if (c.hitCenter) s += 3;
  if (backdrop) s += 2;
  s += c.z >= 100 ? 2 : c.z >= 10 ? 1 : 0;
  if (c.buttons.some(b => ACTION_RE.test(norm(b.text)))) s += 2;
  if (c.area >= 0.03 && c.area <= 0.95) s += 1;
  return s;
}

/** O modal aberto, se houver: o de mais pontos (≥ 4), empate pelo z-index. */
export function pickOverlay(cands: OverlayCandidate[], backdrop: boolean): OverlayCandidate | null {
  let best: OverlayCandidate | null = null, bestS = 3;
  for (const c of cands) {
    const s = overlayScore(c, backdrop);
    if (s > bestS || (s === bestS && best && c.z > best.z)) { best = c; bestS = s; }
  }
  return best;
}
