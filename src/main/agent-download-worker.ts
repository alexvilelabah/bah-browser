// Download do AGENTE (ação `download`) numa worker thread — fora do event loop do main.
// Um worker por download. Faz o fetch (com retentativa TLS leniente e 429/403), grava em
// stream direto no arquivo final e manda progresso pro main a cada 1s (ProgressTracker:
// cadência pro agente pelo ETA + detecção de travamento). Sem teto de tamanho nem de tempo
// total: só aborta após STALL_ABORT_MS sem chegar dado.
//
// main → worker: workerData { url, filename?, dir, acceptLanguage }; mensagem { t: 'cancel' }
// worker → main: { t: 'started' | 'progress' | 'completed' | 'failed' | 'cancelled', ... }
import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { Readable } from 'stream';
import { ProgressTracker, TICK_MS, STALL_ABORT_MS } from './download-progress';
import { installCAs } from './system-ca';

interface Job { url: string; filename?: string; dir: string; acceptLanguage: string; cas?: string[] }
const { url, filename, dir, acceptLanguage, cas } = workerData as Job;
// Raízes do SO (rede que inspeciona TLS com a raiz da empresa): a thread tem as próprias defaults.
if (cas?.length) installCAs(cas);
const post = (m: Record<string, unknown>) => parentPort!.postMessage(m);

const ctrl = new AbortController();
let cancelled = false;
let stalledOut = false;
parentPort!.on('message', (m: any) => {
  if (m?.t === 'cancel') { cancelled = true; try { ctrl.abort(); } catch {} }
});

// Full browser-like headers: Wikimedia (and many CDNs) reject generic/partial
// User-Agents with 429/403. Referer helps with hotlink protection.
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': acceptLanguage,
  'Referer': new URL(url).origin + '/',
};

// O fetch nativo ignora `rejectUnauthorized`; o caminho tolerante usa o módulo https direto.
// A resposta dele já é async-iterável e tem .headers, então o resto funciona igual.
const doFetch = (lenient: boolean): Promise<any> => {
  if (!(lenient && url.startsWith('https:'))) return fetch(url, { headers, signal: ctrl.signal } as any);
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, rejectUnauthorized: false }, (r: any) => {
      resolve({
        ok: r.statusCode >= 200 && r.statusCode < 300,
        status: r.statusCode,
        headers: { get: (k: string) => r.headers[String(k).toLowerCase()] ?? null },
        body: r,
      });
    });
    req.on('error', reject);
    ctrl.signal.addEventListener('abort', () => { try { req.destroy(); } catch {} }, { once: true });
  });
};

function targetFor(ctype: string): string {
  // Derive a safe filename: explicit > URL basename > content-type guess
  const extFromType = ctype.includes('jpeg') ? '.jpg' : ctype.includes('png') ? '.png'
    : ctype.includes('webp') ? '.webp' : ctype.includes('gif') ? '.gif'
    : ctype.includes('svg') ? '.svg' : ctype.includes('pdf') ? '.pdf' : '';
  let base = (filename || decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'download')
    .replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  if (!/\.[a-z0-9]{2,5}$/i.test(base) && extFromType) base += extFromType;
  if (!/\.[a-z0-9]{2,5}$/i.test(base)) base += '.bin';
  let target = path.join(dir, base);
  // Never overwrite: suffix (1), (2)...
  for (let i = 1; fs.existsSync(target) && i < 100; i++) {
    const dot = base.lastIndexOf('.');
    target = path.join(dir, `${base.slice(0, dot)} (${i})${base.slice(dot)}`);
  }
  return target;
}

async function run(): Promise<void> {
  let target = '';
  let tracker: ProgressTracker | null = null;
  let ticker: ReturnType<typeof setInterval> | undefined;
  try {
    let res: any;
    try {
      res = await doFetch(false);
    } catch (e: any) {
      // Many .gov.br / older sites have an incomplete TLS cert chain → retry tolerantly.
      if (!cancelled && /certificate|unable to verify|self.signed|CERT_|altname|ERR_TLS/i.test(String(e?.message))) {
        res = await doFetch(true);
      } else throw e;
    }
    if (res.status === 429 || res.status === 403) {
      await new Promise(r => setTimeout(r, 2500));
      res = await doFetch(false).catch(() => doFetch(true));
    }
    if (!res.ok) { post({ t: 'failed', error: `HTTP ${res.status}` }); return; }

    const ctype = String(res.headers.get('content-type') || '');
    const totalBytes = Number(res.headers.get('content-length') || 0) || 0;
    target = targetFor(ctype);
    const out = fs.createWriteStream(target);
    tracker = new ProgressTracker(totalBytes, Date.now());
    post({ t: 'started', path: target, totalBytes, contentType: ctype });

    // Tick de 1s: progresso pro painel (+ notify pro agente na cadência) e abort por travamento.
    ticker = setInterval(() => {
      const now = Date.now();
      post({ t: 'progress', ...tracker!.tick(now) });
      if (tracker!.msSinceData(now) >= STALL_ABORT_MS) { stalledOut = true; try { ctrl.abort(); } catch {} }
    }, TICK_MS);

    try {
      // Corpo sempre lido em stream: https.get já é async-iterável; o fetch nativo vira Readable.
      const body: AsyncIterable<Uint8Array> = typeof res.body?.[Symbol.asyncIterator] === 'function'
        ? res.body : Readable.fromWeb(res.body);
      for await (const chunk of body) {
        tracker.add(chunk.length, Date.now());
        if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => err ? reject(err) : resolve()));
    } catch (e) {
      out.destroy();
      throw e;
    }
    clearInterval(ticker);
    if (tracker.bytes === 0) {
      try { fs.unlinkSync(target); } catch {}
      post({ t: 'failed', error: 'Empty file.', path: target });
      return;
    }
    post({ t: 'completed', path: target, bytes: tracker.bytes, totalBytes, contentType: ctype });
  } catch (e: any) {
    clearInterval(ticker);
    if (target) { try { fs.unlinkSync(target); } catch {} }
    const bytes = tracker?.bytes ?? 0;
    if (cancelled) post({ t: 'cancelled', path: target, bytes });
    else if (stalledOut) post({ t: 'failed', stalled: true, path: target, bytes, totalBytes: tracker?.totalBytes ?? 0, error: `stalled: no data for ${STALL_ABORT_MS / 1000}s` });
    else post({ t: 'failed', path: target, bytes, error: String(e?.message ?? e) });
  }
}

run().finally(() => { try { parentPort!.close(); } catch {} });
