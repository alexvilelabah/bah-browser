// Caminho do ponteiro do agente: UM arco, o mesmo no cursor que o Bah desenha e nos eventos de mouse de
// verdade que a página recebe (gravadores de sessão tipo HotJar mostram os semicírculos — a "assinatura"
// do Bah, reconhecível, sem tremor aleatório). Puro: o main (input:click) e o overlay usam esta conta.

export interface Pt { x: number; y: number }

/** Ponto num arco entre a e b (curva quadrática com o controle afastado pro lado — parece um arco de
 *  círculo). `side` escolhe o lado da curva. */
export function arcPoint(a: Pt, b: Pt, t: number, side: 1 | -1): Pt {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bulge = Math.min(160, len * 0.35) * side;   // quanto a curva se afasta da reta
  const cx = mx - (dy / len) * bulge, cy = my + (dx / len) * bulge;
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y };
}

/** Lado da curva pela direção do movimento — determinístico, então overlay e eventos reais concordam. */
export function arcSide(a: Pt, b: Pt): 1 | -1 {
  return b.x >= a.x ? 1 : -1;
}

/** Ease-in-out (o mesmo do overlay). */
export function easeInOut(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}

export const ARC_MS = 450;

/** Os pontos (inteiros) do arco de a até b em `steps` passos, já com o easing; o último é b exato. */
export function arcPath(a: Pt, b: Pt, steps = 18): Pt[] {
  const side = arcSide(a, b), out: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const p = i === steps ? b : arcPoint(a, b, easeInOut(i / steps), side);
    out.push({ x: Math.round(p.x), y: Math.round(p.y) });
  }
  return out;
}
