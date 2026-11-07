// Progresso de download pro AGENTE — política única de cadência e de travamento (stall).
// O painel de Downloads recebe todo tick (1s); só os eventos com `notify: true` chegam na
// história do agente, num ritmo que depende do ETA (download curto = mais detalhe, longo =
// menos ruído/tokens). Travamento é detectado aqui, no código (bytes pararam de chegar) —
// a IA só decide o que fazer depois (esperar, tentar de novo, outro mirror).

export const TICK_MS = 1000;            // painel: um evento por segundo
export const STALL_WARN_MS = 15_000;    // sem dado por 15s → "stalled" (avisa painel + agente)
export const STALL_ABORT_MS = 60_000;   // sem dado por 60s → aborta (falha com motivo 'stalled')
const SPEED_WINDOW_MS = 5_000;          // velocidade suavizada nos últimos ~5s

/** Intervalo entre avisos pro agente, pelo ETA: ≤2min → 1s, ≤10min → 5s, >10min → 15s;
 *  ETA desconhecido (servidor sem Content-Length, ou ainda sem velocidade) → 5s. */
export function agentCadenceMs(etaSec: number | null): number {
  if (etaSec == null || !Number.isFinite(etaSec)) return 5_000;
  if (etaSec <= 120) return 1_000;
  if (etaSec <= 600) return 5_000;
  return 15_000;
}

export interface ProgressSnapshot {
  bytes: number;
  totalBytes: number;        // 0 = desconhecido
  speedBps: number;
  etaSec: number | null;
  stalled: boolean;
  stalledForSec: number;     // 0 quando não travado
  notify: boolean;           // true = este tick vai pro agente
}

export class ProgressTracker {
  bytes = 0;
  stalled = false;
  private samples: Array<[number, number]> = [];   // [t, bytes]
  private lastByteAt: number;
  private lastNotifyAt: number;

  readonly totalBytes: number;

  /** `now` = início; conta como o aviso "started" (já mandado pro agente). */
  constructor(totalBytes: number, now: number) {
    this.totalBytes = totalBytes;
    this.lastByteAt = now;
    this.lastNotifyAt = now;
    this.samples.push([now, 0]);
  }

  add(n: number, now: number): void {
    this.bytes += n;
    this.lastByteAt = now;
  }

  msSinceData(now: number): number { return now - this.lastByteAt; }

  tick(now: number): ProgressSnapshot {
    this.samples.push([now, this.bytes]);
    // Mantém só a janela (mais uma amostra antes dela, pra sempre ter um ponto de partida).
    while (this.samples.length > 2 && now - this.samples[1][0] >= SPEED_WINDOW_MS) this.samples.shift();
    const [t0, b0] = this.samples[0];
    const speedBps = now > t0 ? Math.max(0, ((this.bytes - b0) * 1000) / (now - t0)) : 0;
    const etaSec = this.totalBytes > 0 && speedBps > 0
      ? Math.max(0, Math.round((this.totalBytes - this.bytes) / speedBps))
      : null;

    const idle = now - this.lastByteAt;
    const nowStalled = idle >= STALL_WARN_MS;
    let notify = false;
    if (nowStalled !== this.stalled) {
      // Entrou/saiu de travamento → avisa já, fora da cadência.
      this.stalled = nowStalled;
      notify = true;
    } else if (!nowStalled && now - this.lastNotifyAt >= agentCadenceMs(etaSec)) {
      // Travado não repete aviso a cada tick: o próximo é a volta ou o abort.
      notify = true;
    }
    if (notify) this.lastNotifyAt = now;

    return {
      bytes: this.bytes,
      totalBytes: this.totalBytes,
      speedBps: Math.round(speedBps),
      etaSec,
      stalled: nowStalled,
      stalledForSec: nowStalled ? Math.floor(idle / 1000) : 0,
      notify,
    };
  }
}
