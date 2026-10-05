// ─────────────────────────────────────────────────────────────────────────────
// Motor de download com VÁRIAS CONEXÕES — porte do "IDM Caseiro" (D:\idmcaseiro,
// do próprio dono do Bah) pra dentro do navegador. Mesma lógica:
//  - sonda o arquivo (HEAD; se não der, GET Range 0-0) → tamanho, Range, validadores;
//  - divide em N fatias, cada conexão baixa a sua com "Range: bytes=início-fim" e grava
//    direto na posição certa de UM arquivo pré-alocado (esparso no Windows: instantâneo);
//  - divisão dinâmica: conexão que termina pega a METADE FINAL da fatia mais atrasada;
//  - falhou → tenta de novo com espera crescente; servidor limitando (429) → as conexões
//    a mais se aposentam e as outras terminam; servidor ignorou o Range → uma conexão só;
//  - pausar/continuar, cancelar (apaga o parcial), arquivo final só aparece pronto.
// Node puro (sem electron) pra rodar nos testes com um servidor HTTP local.
// ─────────────────────────────────────────────────────────────────────────────
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const MIB = 1024 * 1024;

export interface EngineConfig {
  connections: number;      // 1..32 (padrão 8, como no IDM Caseiro)
  minSegmentBytes: number;  // não cria fatia menor que isto ao dividir o arquivo
  minSplitBytes: number;    // só "rouba" metade de uma fatia se ainda faltar pelo menos isto
  maxRetries: number;       // tentativas SEGUIDAS sem progresso antes de desistir da conexão
  connectTimeoutMs: number; // até chegar a resposta
  readTimeoutMs: number;    // sem receber nada → conexão morta
  retryBaseMs: number;
  retryMaxMs: number;
  speedWindowMs: number;
  /** 'error' quando vai cookie no cabeçalho: redirecionar pra OUTRO site vazaria o cookie. */
  redirect: 'follow' | 'error';
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  connections: 8,
  minSegmentBytes: 1 * MIB,
  minSplitBytes: 2 * MIB,
  maxRetries: 6,
  connectTimeoutMs: 10_000,
  readTimeoutMs: 20_000,
  retryBaseMs: 1_000,
  retryMaxMs: 15_000,
  speedWindowMs: 4_000,
  redirect: 'follow',
};
export const MAX_CONNECTIONS = 32;

export interface ProbeResult {
  finalUrl: string;
  size?: number;
  resumable: boolean;       // aceita Range (dá pra dividir e pausar)
  etag?: string;
  lastModified?: string;
  mime?: string;
}

type SegState = 'pending' | 'connecting' | 'downloading' | 'retrying' | 'done';
interface Segment { start: number; end: number; cursor: number; written: number; owner: number | null; state: SegState }

export type TaskState = 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface ConnectionView { id: number; start: number; end: number; written: number; state: SegState; speedBps: number }
export interface Snapshot {
  state: TaskState;
  total?: number;
  done: number;
  speedBps: number;
  etaSec?: number;
  resumable: boolean;
  connections: ConnectionView[];
  /** Mapa do arquivo: [início, fim, gravado] em fração 0..1 de cada fatia (desenho da barra). */
  map: Array<[number, number, number]>;
  error?: string;
  notice?: string;
}

// Sem "parameter properties": os testes rodam este arquivo direto no Node (type stripping).
class HttpStatusError extends Error {
  status: number;
  retryAfterMs?: number;
  constructor(status: number, retryAfterMs?: number) { super(`HTTP ${status}`); this.status = status; this.retryAfterMs = retryAfterMs; }
  get retryable(): boolean { return this.status === 408 || this.status === 429 || this.status >= 500; }
}
class FatalError extends Error {}
class RangeIgnored extends Error {}
class GaveUp extends Error {
  exhausted: boolean;
  constructor(msg: string, exhausted = true) { super(msg); this.exhausted = exhausted; }
}
class Halted extends Error {}

const header = (h: Headers, name: string) => h.get(name) ?? undefined;
const sameDate = (a?: string, b?: string) => {
  if (!a || !b) return true;
  const ta = Date.parse(a), tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) ? ta === tb : a.trim() === b.trim();
};
export function parseContentRange(v?: string): { first: number; last: number; total?: number } | null {
  const m = /^\s*bytes\s+(\d+)-(\d+)\/(\d+|\*)\s*$/i.exec(v || '');
  if (!m) return null;
  return { first: Number(m[1]), last: Number(m[2]), total: m[3] === '*' ? undefined : Number(m[3]) };
}
function retryAfterMs(v?: string): number | undefined {
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : undefined;
}

/** fetch com tempo pra RESPOSTA chegar (conectar + cabeçalhos). */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  const onOuter = () => ctrl.abort();
  outer?.addEventListener('abort', onOuter, { once: true });
  const timer = setTimeout(() => ctrl.abort(new Error('connect timeout')), timeoutMs);
  try {
    return await fetch(url, { redirect: 'follow', ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  }
}

/**
 * Sonda: tamanho, se aceita Range, validadores. HEAD primeiro (barato); muito servidor
 * recusa HEAD (405/403) ou não manda Accept-Ranges — aí confirma com GET Range 0-0.
 */
export async function probeDownload(url: string, headers: Record<string, string>, timeoutMs = 10_000, signal?: AbortSignal, redirect: 'follow' | 'error' = 'follow'): Promise<ProbeResult> {
  const base = { ...headers, 'Accept-Encoding': 'identity' };
  let finalUrl = url;
  let size: number | undefined, etag: string | undefined, lastModified: string | undefined, mime: string | undefined;
  let rangesAdvertised = false;
  try {
    const r = await fetchWithTimeout(url, { method: 'HEAD', headers: base, redirect }, timeoutMs, signal);
    if (r.ok) {
      finalUrl = r.url || url;
      const len = Number(header(r.headers, 'content-length'));
      if (Number.isFinite(len) && len >= 0 && !header(r.headers, 'content-encoding')) size = len;
      rangesAdvertised = /bytes/i.test(header(r.headers, 'accept-ranges') || '');
      etag = header(r.headers, 'etag');
      lastModified = header(r.headers, 'last-modified');
      mime = header(r.headers, 'content-type');
    }
  } catch { /* HEAD recusado: o GET abaixo decide */ }
  // GET Range 0-0: a prova de verdade (206 + Content-Range com o total).
  const r = await fetchWithTimeout(finalUrl, { method: 'GET', headers: { ...base, Range: 'bytes=0-0' }, redirect }, timeoutMs, signal);
  try {
    if (r.status === 206) {
      const cr = parseContentRange(header(r.headers, 'content-range'));
      return {
        finalUrl: r.url || finalUrl,
        size: cr?.total ?? size,
        resumable: cr?.total !== undefined && !header(r.headers, 'content-encoding'),
        etag: header(r.headers, 'etag') ?? etag,
        lastModified: header(r.headers, 'last-modified') ?? lastModified,
        mime: header(r.headers, 'content-type') ?? mime,
      };
    }
    if (!r.ok) throw new HttpStatusError(r.status, retryAfterMs(header(r.headers, 'retry-after')));
    const len = Number(header(r.headers, 'content-length'));
    return {
      finalUrl: r.url || finalUrl,
      size: size ?? (Number.isFinite(len) ? len : undefined),
      resumable: false,
      etag, lastModified,
      mime: header(r.headers, 'content-type') ?? mime,
    };
  } finally {
    try { await r.body?.cancel(); } catch {}
    void rangesAdvertised;
  }
}

class SpeedMeter {
  samples: Array<[number, number]> = [];
  window: number;
  constructor(windowMs: number) { this.window = windowMs; }
  add(n: number, now = Date.now()): void { this.samples.push([now, n]); this.trim(now); }
  trim(now: number): void { while (this.samples.length && now - this.samples[0][0] > this.window) this.samples.shift(); }
  rate(now = Date.now()): number {
    this.trim(now);
    if (!this.samples.length) return 0;
    const bytes = this.samples.reduce((s, [, n]) => s + n, 0);
    const span = Math.max(1000, now - this.samples[0][0]);
    return (bytes * 1000) / span;
  }
}

interface Slot { id: number; seg: Segment | null; ctrl: AbortController | null; meter: SpeedMeter; retired: boolean }

/** Windows: arquivo esparso → pré-alocar e gravar longe é instantâneo (sem encher de zeros). */
function setSparse(file: string, on: boolean): Promise<void> {
  if (process.platform !== 'win32') return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const child = spawn('fsutil', ['sparse', 'setflag', file, ...(on ? [] : ['0'])], { windowsHide: true });
      const done = () => resolve();
      child.on('error', done);
      child.on('close', done);
      setTimeout(done, 5000);
    } catch { resolve(); }
  });
}

export function partPathFor(target: string): string { return `${target}.bahpart`; }

/** Nome livre: "arquivo.zip" → "arquivo (1).zip" se já existir. */
export function uniqueTarget(target: string): string {
  if (!fs.existsSync(target)) return target;
  const dir = path.dirname(target), ext = path.extname(target), stem = path.basename(target, ext);
  for (let i = 1; i < 1000; i++) {
    const p = path.join(dir, `${stem} (${i})${ext}`);
    if (!fs.existsSync(p)) return p;
  }
  return path.join(dir, `${stem} (${Date.now()})${ext}`);
}

export class MultiDownload extends EventEmitter {
  readonly cfg: EngineConfig;
  readonly probe: ProbeResult;
  readonly headers: Record<string, string>;
  target: string;
  readonly part: string;
  state: TaskState = 'downloading';
  error?: string;
  notice?: string;
  private segments: Segment[] = [];
  private slots: Slot[] = [];
  private fh: fs.promises.FileHandle | null = null;
  private meter: SpeedMeter;
  private halted = false;
  private alive = 0;
  private stream = false;   // servidor sem Range: uma conexão, do começo ao fim
  private runPromise: Promise<void> | null = null;
  private fatal: unknown = null;
  private wakers = new Set<() => void>();

  constructor(probe: ProbeResult, target: string, headers: Record<string, string>, cfg: Partial<EngineConfig> = {}) {
    super();
    this.cfg = { ...DEFAULT_ENGINE_CONFIG, ...cfg };
    this.cfg.connections = Math.min(MAX_CONNECTIONS, Math.max(1, Math.floor(this.cfg.connections)));
    this.probe = probe;
    this.headers = { ...headers, 'Accept-Encoding': 'identity' };
    this.target = target;
    this.part = partPathFor(target);
    this.meter = new SpeedMeter(this.cfg.speedWindowMs);
    const total = probe.size;
    if (!probe.resumable || !total) {
      this.stream = true;
      this.segments = [{ start: 0, end: total ? total - 1 : Number.MAX_SAFE_INTEGER, cursor: 0, written: 0, owner: null, state: 'pending' }];
    } else {
      const parts = Math.min(this.cfg.connections, Math.max(1, Math.floor(total / this.cfg.minSegmentBytes)));
      const base = Math.floor(total / parts), extra = total % parts;
      let start = 0;
      for (let i = 0; i < parts; i++) {
        const size = base + (i < extra ? 1 : 0);
        this.segments.push({ start, end: start + size - 1, cursor: 0, written: 0, owner: null, state: 'pending' });
        start += size;
      }
    }
  }

  /** Começa (ou continua depois de pausar). Resolve quando termina, falha, pausa ou cancela. */
  start(): Promise<void> {
    if (this.runPromise) return this.runPromise;
    this.halted = false;
    this.state = 'downloading';
    this.runPromise = this.run().finally(() => { this.runPromise = null; });
    return this.runPromise;
  }

  pause(): void {
    if (this.state !== 'downloading' || this.stream) return;   // sem Range não dá pra continuar depois
    this.state = 'paused';
    this.halt();
  }

  async cancel(): Promise<void> {
    if (this.state === 'completed' || this.state === 'cancelled') return;
    const wasRunning = !!this.runPromise;
    this.state = 'cancelled';
    this.halt();
    if (wasRunning) { try { await this.runPromise; } catch {} }
    await this.closeFile();
    try { fs.unlinkSync(this.part); } catch {}
    this.emit('end');
  }

  snapshot(): Snapshot {
    const total = this.stream ? this.probe.size : this.probe.size;
    const done = this.segments.reduce((s, x) => s + x.written, 0);
    const speed = this.state === 'downloading' ? this.meter.rate() : 0;
    const now = Date.now();
    return {
      state: this.state,
      total,
      done,
      speedBps: speed,
      etaSec: total && speed > 0 ? Math.round((total - done) / speed) : undefined,
      resumable: !this.stream,
      connections: this.slots.filter(s => !s.retired && s.seg).map(s => ({
        id: s.id, start: s.seg!.start, end: s.seg!.end, written: s.seg!.written, state: s.seg!.state, speedBps: s.meter.rate(now),
      })),
      map: total ? this.segments.map(s => [s.start / total, (s.end + 1) / total, (s.start + s.written) / total] as [number, number, number]) : [],
      error: this.error,
      notice: this.notice,
    };
  }

  // ── execução ──
  private halt(): void {
    this.halted = true;
    for (const s of this.slots) { try { s.ctrl?.abort(); } catch {} }
    for (const w of this.wakers) w();   // acorda quem está esperando pra tentar de novo
    this.wakers.clear();
  }

  private async openFile(): Promise<void> {
    if (this.fh) return;
    fs.mkdirSync(path.dirname(this.part), { recursive: true });
    const exists = fs.existsSync(this.part);
    this.fh = await fs.promises.open(this.part, exists ? 'r+' : 'w+');
    if (!exists && !this.stream && this.probe.size) {
      await this.fh.close();
      await setSparse(this.part, true);
      this.fh = await fs.promises.open(this.part, 'r+');
      await this.fh.truncate(this.probe.size);
    }
  }

  private async closeFile(): Promise<void> {
    const fh = this.fh;
    this.fh = null;
    if (fh) { try { await fh.close(); } catch {} }
  }

  private async run(): Promise<void> {
    try {
      await this.openFile();
      // Fatias já baixadas (continuando) não precisam de conexão; as livres vão pras conexões.
      for (const s of this.segments) { s.cursor = s.written; s.owner = null; if (!this.isDone(s)) s.state = 'pending'; }
      const pending = this.segments.filter(s => !this.isDone(s));
      const remaining = pending.reduce((n, s) => n + this.remaining(s), 0);
      const count = !pending.length ? 0 : this.stream ? 1
        : Math.min(this.cfg.connections, Math.max(pending.length, 1 + Math.floor(remaining / this.cfg.minSplitBytes)));
      this.slots = Array.from({ length: count }, (_, i) => ({ id: i + 1, seg: null, ctrl: null, meter: new SpeedMeter(2000), retired: false }));
      pending.forEach((s, i) => { const slot = this.slots[i]; if (slot) { slot.seg = s; s.owner = slot.id; } });
      this.alive = this.slots.length;
      this.fatal = null;
      await Promise.allSettled(this.slots.map(slot => this.worker(slot)));
      if (this.state === 'paused' || this.state === 'cancelled') { await this.closeFile(); return; }
      if (this.fatal) throw this.fatal;
      if (this.segments.some(s => !this.isDone(s))) throw new FatalError('download incomplete');
      await this.finish();
    } catch (e: any) {
      if (e instanceof RangeIgnored && !this.stream) {
        this.notice = 'range-ignored';
        this.stream = true;
        this.segments = [{ start: 0, end: this.probe.size ? this.probe.size - 1 : Number.MAX_SAFE_INTEGER, cursor: 0, written: 0, owner: null, state: 'pending' }];
        this.halted = false;
        await this.closeFile();
        try { fs.unlinkSync(this.part); } catch {}
        return this.run();
      }
      if (this.state === 'paused' || this.state === 'cancelled') { await this.closeFile(); return; }
      this.state = 'failed';
      this.error = e instanceof HttpStatusError ? `HTTP ${e.status}` : String(e?.message ?? e);
      await this.closeFile();
      this.emit('end');
    }
  }

  private async finish(): Promise<void> {
    await this.closeFile();
    await setSparse(this.part, false);
    const final = uniqueTarget(this.target);
    fs.renameSync(this.part, final);
    this.target = final;
    this.state = 'completed';
    this.emit('end');
  }

  private isDone(s: Segment): boolean {
    if (this.stream && !this.probe.size) return s.state === 'done';
    return s.written >= s.end - s.start + 1;
  }
  private remaining(s: Segment): number { return Math.max(0, s.end - s.start + 1 - s.cursor); }

  private async worker(slot: Slot): Promise<void> {
    try {
      while (!this.halted) {
        const seg = this.claim(slot);
        if (!seg) return;
        try {
          await this.downloadSegment(slot, seg);
        } catch (e) {
          if (e instanceof GaveUp) {
            if (this.retire(slot, seg)) return;   // outra conexão assume a fatia devolvida
            if (e.exhausted) throw new FatalError(e.message);
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      // Erro de verdade numa conexão para TODAS (senão as outras seguiriam gravando).
      if (!(e instanceof Halted) && !this.fatal) { this.fatal = e; this.halt(); }
      throw e;
    }
  }

  /** Próxima fatia da conexão: a sua → uma livre → metade final da mais atrasada → acabou. */
  private claim(slot: Slot): Segment | null {
    const own = slot.seg;
    if (own && own.owner === slot.id && !this.isDone(own)) { this.coalesceIfAlone(own); return own; }
    const free = this.segments.find(s => s.owner === null && !this.isDone(s));
    if (free) { this.assign(slot, free); this.coalesceIfAlone(free); return free; }
    if (!this.stream) {
      const threshold = Math.max(this.cfg.minSplitBytes, 2);
      const victims = this.segments.filter(s => s.owner !== null && this.remaining(s) >= threshold);
      if (victims.length) {
        const victim = victims.reduce((a, b) => (this.remaining(b) > this.remaining(a) ? b : a));
        const take = Math.floor(this.remaining(victim) / 2);
        const piece: Segment = { start: victim.end + 1 - take, end: victim.end, cursor: 0, written: 0, owner: null, state: 'pending' };
        victim.end = piece.start - 1;
        this.segments.splice(this.segments.indexOf(victim) + 1, 0, piece);
        this.assign(slot, piece);
        return piece;
      }
    }
    this.alive--;
    slot.seg = null;
    return null;
  }

  /** Única conexão viva: emenda as fatias livres seguintes — uma requisição em vez de várias. */
  private coalesceIfAlone(seg: Segment): void {
    if (this.alive !== 1 || this.stream) return;
    let i = this.segments.indexOf(seg);
    while (i + 1 < this.segments.length) {
      const nxt = this.segments[i + 1];
      if (nxt.owner !== null || nxt.written || nxt.cursor || nxt.start !== seg.end + 1) break;
      seg.end = nxt.end;
      this.segments.splice(i + 1, 1);
    }
  }

  private assign(slot: Slot, seg: Segment): void { seg.owner = slot.id; seg.state = 'connecting'; slot.seg = seg; }

  private retire(slot: Slot, seg: Segment): boolean {
    if (this.alive <= 1) return false;
    slot.retired = true;
    slot.seg = null;
    seg.owner = null;
    seg.state = 'pending';
    this.alive--;
    return true;
  }

  private async downloadSegment(slot: Slot, seg: Segment): Promise<void> {
    let failures = 0;
    while (!this.halted) {
      const before = seg.written;
      try {
        await this.fetchRange(slot, seg);
        return;
      } catch (e: any) {
        if (this.halted || e instanceof Halted) throw new Halted();
        if (e instanceof FatalError || e instanceof RangeIgnored) throw e;
        if (e instanceof HttpStatusError && !e.retryable) throw new FatalError(`HTTP ${e.status}`);
        // 429: insistir com todas as conexões em sincronia só piora — esta se aposenta.
        if (e instanceof HttpStatusError && e.status === 429 && this.alive > 1) throw new GaveUp(e.message, false);
        failures = seg.written > before ? 1 : failures + 1;
        seg.state = 'retrying';
        if (failures > this.cfg.maxRetries) throw new GaveUp(String(e?.message ?? e));
        let delay = Math.min(this.cfg.retryBaseMs * 2 ** (failures - 1), this.cfg.retryMaxMs) * (0.8 + Math.random() * 0.4);
        if (e instanceof HttpStatusError && e.retryAfterMs) delay = Math.max(delay, e.retryAfterMs);
        await this.sleep(delay);
      }
    }
    throw new Halted();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => { clearTimeout(t); this.wakers.delete(wake); resolve(); };
      const t = setTimeout(wake, ms);
      this.wakers.add(wake);
    });
  }

  private async fetchRange(slot: Slot, seg: Segment): Promise<void> {
    if (this.isDone(seg)) { seg.state = 'done'; return; }
    // Sem Range, toda tentativa recomeça do byte zero (o servidor manda o arquivo inteiro).
    if (this.stream) { seg.cursor = 0; seg.written = 0; }
    const position = seg.start + seg.cursor;
    const ctrl = new AbortController();
    slot.ctrl = ctrl;
    const headers: Record<string, string> = { ...this.headers };
    if (!this.stream) headers.Range = `bytes=${position}-${seg.end}`;
    seg.state = 'connecting';
    const res = await fetchWithTimeout(this.probe.finalUrl, { method: 'GET', headers, redirect: this.cfg.redirect }, this.cfg.connectTimeoutMs, ctrl.signal);
    let idle: ReturnType<typeof setTimeout> | null = null;
    const arm = () => { if (idle) clearTimeout(idle); idle = setTimeout(() => ctrl.abort(new Error('read timeout')), this.cfg.readTimeoutMs); };
    try {
      if (this.halted) throw new Halted();
      this.checkResponse(res, position, seg);
      seg.state = 'downloading';
      if (!res.body) throw new Error('empty body');
      arm();
      for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
        if (this.halted) throw new Halted();
        arm();
        let buf = chunk;
        // Reserva o trecho. Se outra conexão dividiu esta fatia, seg.end encolheu: corta o excesso.
        const offset = seg.start + seg.cursor;
        if (!this.stream || this.probe.size) {
          const room = seg.end + 1 - offset;
          if (room <= 0) break;
          if (buf.byteLength > room) buf = buf.subarray(0, room);
        }
        seg.cursor += buf.byteLength;
        await this.fh!.write(buf, 0, buf.byteLength, offset);
        seg.written += buf.byteLength;
        const now = Date.now();
        this.meter.add(buf.byteLength, now);
        slot.meter.add(buf.byteLength, now);
        if (this.isDone(seg)) break;
      }
      if (this.stream && !this.probe.size) { seg.state = 'done'; return; }
      if (this.isDone(seg)) { seg.state = 'done'; return; }
      throw new Error('connection closed before the end of the piece');
    } catch (e: any) {
      seg.cursor = seg.written;   // o que não foi gravado não conta
      if (this.halted) throw new Halted();
      throw e;
    } finally {
      if (idle) clearTimeout(idle);
      slot.ctrl = null;
      try { ctrl.abort(); } catch {}   // solta a conexão (corte por divisão / fim)
    }
  }

  private checkResponse(res: Response, position: number, seg: Segment): void {
    if (this.stream) {
      if (!res.ok) throw new HttpStatusError(res.status, retryAfterMs(header(res.headers, 'retry-after')));
      return;
    }
    if (res.status === 206) {
      const cr = parseContentRange(header(res.headers, 'content-range'));
      if (!cr) throw new Error('206 without Content-Range');
      if (cr.first !== position) throw new FatalError('server returned a different piece');
      if (cr.total !== undefined && this.probe.size !== undefined && cr.total !== this.probe.size) throw new FatalError('file changed on the server');
      // Mesmo tamanho, outra versão: sem isto o arquivo misturaria bytes das duas.
      if (!sameDate(header(res.headers, 'last-modified'), this.probe.lastModified)) throw new FatalError('file changed on the server');
      return;
    }
    if (res.status === 200) {
      const len = Number(header(res.headers, 'content-length'));
      // Pedido que cobre o arquivo inteiro pode vir 200 com tudo: é o que queremos.
      if (position === 0 && this.probe.size !== undefined && seg.end === this.probe.size - 1 && len === this.probe.size) return;
      throw new RangeIgnored('server ignored Range');
    }
    if (res.status === 416) throw new FatalError('file changed on the server');
    throw new HttpStatusError(res.status, retryAfterMs(header(res.headers, 'retry-after')));
  }
}
