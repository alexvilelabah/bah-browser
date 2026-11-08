// Anel de progresso no botão de downloads (igual ao Chrome): enquanto há download ativo, um círculo
// em volta da seta enche com o progresso somado; sem tamanho conhecido, gira; ao terminar tudo,
// pisca "concluído". Antes o botão não mudava e a pessoa achava que nada estava acontecendo.

export interface RingDownload { state: string; bytes?: number; totalBytes?: number; paused?: boolean }

export type RingState =
  | { kind: 'idle' }
  | { kind: 'progress'; fraction: number; count: number; paused: boolean }
  | { kind: 'indeterminate'; count: number };

const ACTIVE = new Set(['started', 'progress', 'queued', 'preparing']);

/** O que o anel mostra: progresso somado dos downloads ativos (bytes/total), ou "girando" sem total. */
export function ringState(list: readonly RingDownload[]): RingState {
  const active = list.filter(d => ACTIVE.has(d.state));
  if (!active.length) return { kind: 'idle' };
  const sized = active.filter(d => (d.totalBytes ?? 0) > 0);
  if (!sized.length) return { kind: 'indeterminate', count: active.length };
  const total = sized.reduce((s, d) => s + (d.totalBytes as number), 0);
  const got = sized.reduce((s, d) => s + Math.min(d.bytes ?? 0, d.totalBytes as number), 0);
  return { kind: 'progress', fraction: Math.max(0, Math.min(1, got / total)), count: active.length, paused: active.every(d => d.paused) };
}

/** Comprimento do traço do arco (stroke-dasharray) pra uma fração, num círculo de raio r. */
export function ringDash(fraction: number, r: number): string {
  const c = 2 * Math.PI * r;
  const on = Math.max(0, Math.min(1, fraction)) * c;
  return `${on.toFixed(2)} ${(c - on).toFixed(2)}`;
}
