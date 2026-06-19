// ─────────────────────────────────────────────────────────────────────────────
// FILA DE TAREFAS (Job Queue) — serial por "lane" (faixa).
// Antes, flags globais (videoDownloadBusy/videoEditBusy) REJEITAVAM a 2ª tarefa
// concorrente ("já tem uma rodando"). Aqui a 2ª ENTRA NA FILA e roda quando chegar
// a vez. Cada lane processa UMA por vez, em ordem de chegada. Lanes diferentes
// rodam em paralelo (ex.: um download e uma edição ao mesmo tempo).
//
// Pós-auditoria: cada job tem id+label, há teto de espera por lane (maxPending) e
// getQueueState() pra observabilidade. Aditivo — uso normal é idêntico.
// ─────────────────────────────────────────────────────────────────────────────

let JOB_SEQ = 0;
const MAX_PENDING_DEFAULT = 12;   // teto de tarefas ESPERANDO por lane (anti-runaway)

export interface JobInfo { id: number; label?: string; }
export interface LaneState { running: number; pending: number; jobs: JobInfo[] }
export interface EnqueueOpts { label?: string; maxPending?: number }

class Lane {
  private chain: Promise<unknown> = Promise.resolve();
  private inflight: JobInfo[] = [];   // [0] = rodando; resto = esperando
  constructor(private maxPending: number) {}

  get running(): number { return this.inflight.length > 0 ? 1 : 0; }
  get pending(): number { return Math.max(0, this.inflight.length - 1); }
  state(): LaneState { return { running: this.running, pending: this.pending, jobs: this.inflight.slice() }; }

  enqueue<T>(fn: () => Promise<T>, onWait?: (ahead: number) => void, label?: string): Promise<T> {
    if (this.pending >= this.maxPending) {
      return Promise.reject(new Error('Muitas tarefas na fila — aguarde as atuais terminarem.'));
    }
    const meta: JobInfo = { id: ++JOB_SEQ, label };
    const ahead = this.inflight.length;        // quantas (rodando + esperando) já estão na frente
    this.inflight.push(meta);
    if (ahead > 0) { try { onWait?.(ahead); } catch { /* aviso é best-effort */ } }
    // encadeia: só roda depois que a anterior terminou (sucesso OU falha)
    const result = this.chain.then(() => fn());
    // mantém a corrente avançando mesmo se um job falhar (não trava a fila)
    this.chain = result.then(() => undefined, () => undefined);
    const done = () => { const i = this.inflight.findIndex(j => j.id === meta.id); if (i >= 0) this.inflight.splice(i, 1); };
    result.then(done, done);
    return result;
  }
}

const lanes = new Map<string, Lane>();
function laneFor(name: string, maxPending = MAX_PENDING_DEFAULT): Lane {
  let l = lanes.get(name);
  if (!l) { l = new Lane(maxPending); lanes.set(name, l); }
  return l;
}

/**
 * Enfileira `fn` na faixa `lane`. Resolve/rejeita com o resultado de `fn`.
 * `onWait(ahead)` é chamado UMA vez se precisou esperar (ahead = quantas na frente).
 * Rejeita se a faixa já tem `maxPending` esperando (anti-runaway).
 * Compatível: `enqueueJob(lane, fn, onWait)` continua valendo; `opts` é opcional.
 */
export function enqueueJob<T>(
  lane: string,
  fn: () => Promise<T>,
  onWait?: (ahead: number) => void,
  opts?: EnqueueOpts,
): Promise<T> {
  return laneFor(lane, opts?.maxPending).enqueue(fn, onWait, opts?.label);
}

/** Snapshot de todas as faixas (running/pending/jobs) — pra UI/diagnóstico. */
export function getQueueState(): Record<string, LaneState> {
  const out: Record<string, LaneState> = {};
  for (const [name, lane] of lanes) out[name] = lane.state();
  return out;
}
