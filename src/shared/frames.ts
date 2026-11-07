// frames.ts — regras PURAS do conteúdo de iframes pro agente (sem electron; testado com node --test).
// O main (src/main/frames.ts) usa pra: nomear cada iframe na lista de elementos (`frame="host"`), decodificar
// a chave do frame (mesmo processo × outro processo), descartar iframes de extensão e converter a caixa
// de um nó (quad do DOM.getBoxModel) em centro + tamanho na viewport da página.

/** Quantos iframes entram na observação (os vazios ficam de fora). */
export const MAX_FRAMES = 8;
/** Profundidade máxima de iframes aninhados percorridos na árvore de frames. */
export const MAX_FRAME_DEPTH = 3;

/** Nome do iframe na lista de elementos: o host da URL; srcdoc/about:blank viram "embedded". */
export function frameLabel(url: unknown): string {
  const u = typeof url === 'string' ? url : '';
  if (!u || u.startsWith('about:')) return 'embedded';
  try { return new URL(u).host || u.slice(0, 40); } catch { return u.slice(0, 40); }
}

/** Iframe que uma extensão injeta na página (menu do gerenciador de senhas etc.): não é da página. */
export function isExtensionFrameUrl(url: unknown): boolean {
  return typeof url === 'string' && /^chrome-extension:\/\//i.test(url.trim());
}

/**
 * Chave do frame: `local:<frameId>` (mesmo processo — CDP da página com frameId) ou `oopif:<sessionId>`
 * (outro processo — sessão CDP achatada do próprio frame). Qualquer outra coisa é inválida.
 */
export type FrameKey = { kind: 'local'; frameId: string } | { kind: 'oopif'; sessionId: string };
export function parseFrameKey(key: unknown): FrameKey | null {
  if (typeof key !== 'string') return null;
  const i = key.indexOf(':');
  if (i <= 0 || i === key.length - 1) return null;
  const kind = key.slice(0, i), ref = key.slice(i + 1);
  if (kind === 'local') return { kind, frameId: ref };
  if (kind === 'oopif') return { kind, sessionId: ref };
  return null;
}

/**
 * Quad do DOM.getBoxModel ([x1,y1,…,x4,y4], coordenadas do documento do frame) → centro + tamanho na
 * viewport da página, somando (ox, oy) = canto do conteúdo do <iframe> (OOPIF; frame local já vem na
 * viewport da página, offset 0). Quad inválido → null.
 */
export function boxFromQuad(q: unknown, ox = 0, oy = 0): { x: number; y: number; w: number; h: number } | null {
  if (!Array.isArray(q) || q.length !== 8 || q.some(v => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: Math.round(ox + (minX + maxX) / 2), y: Math.round(oy + (minY + maxY) / 2), w: Math.round(maxX - minX), h: Math.round(maxY - minY) };
}

/**
 * Frames filhos da árvore do Page.getFrameTree (em profundidade, até `maxDepth`), sem os de extensão —
 * nem o que estiver dentro deles. O frame principal (a página) não entra.
 */
export interface FrameTreeNode { frame: { id: string; url?: string }; childFrames?: FrameTreeNode[] }
export function childFrames(tree: FrameTreeNode | undefined, maxDepth = MAX_FRAME_DEPTH): Array<{ id: string; url?: string }> {
  const walk = (ft: FrameTreeNode | undefined, depth: number): Array<{ id: string; url?: string }> => depth > maxDepth ? [] : (ft?.childFrames || [])
    .filter(c => c?.frame?.id && !isExtensionFrameUrl(c.frame.url))
    .flatMap(c => [c.frame, ...walk(c, depth + 1)]);
  return walk(tree, 0);
}
