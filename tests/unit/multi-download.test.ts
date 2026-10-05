// Motor de várias conexões (porte do IDM Caseiro): servidor HTTP local que serve um arquivo
// conhecido com Range, sem Range, derrubando conexões e limitando com 429 — o arquivo
// final tem que sair IGUAL byte a byte, e pausar/continuar/cancelar têm que funcionar.
import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MultiDownload, probeDownload, parseContentRange, uniqueTarget, partPathFor } from '../../src/main/multi-download.ts';

const SIZE = 3 * 1024 * 1024 + 12345;
const DATA = crypto.randomBytes(SIZE);
const SHA = crypto.createHash('sha256').update(DATA).digest('hex');
const KB = 1024;
const FAST = { minSegmentBytes: 256 * KB, minSplitBytes: 256 * KB, retryBaseMs: 30, retryMaxMs: 120, connectTimeoutMs: 3000, readTimeoutMs: 3000 };

function startServer(): Promise<{ url: (mode: string) => string; close: () => void; stats: Record<string, number> }> {
  const stats: Record<string, number> = { requests: 0, ranged: 0, refused: 0 };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const mode = u.searchParams.get('mode') ?? 'ok';
    stats.requests++;
    if (u.pathname === '/redirect') { res.writeHead(302, { Location: `/file?mode=${mode}` }); return res.end(); }
    if (req.method === 'HEAD') {
      if (mode === 'nohead') { res.writeHead(405); return res.end(); }
      res.writeHead(200, { 'Content-Length': SIZE, ...(mode === 'norange' ? {} : { 'Accept-Ranges': 'bytes' }), 'Last-Modified': 'Sun, 04 Oct 2026 10:00:00 GMT' });
      return res.end();
    }
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    // 429 nas primeiras requisições com Range (o servidor "limita conexões").
    if (mode === 'limit' && range && Number(range[1]) > 0 && stats.refused < 6) {
      stats.refused++;
      res.writeHead(429, { 'Retry-After': '0' });
      return res.end();
    }
    let start = 0, end = SIZE - 1, status = 200;
    const headers: Record<string, string | number> = { 'Content-Type': 'application/octet-stream', 'Last-Modified': 'Sun, 04 Oct 2026 10:00:00 GMT' };
    if (range && mode !== 'norange') {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), SIZE - 1) : SIZE - 1;
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${SIZE}`;
      stats.ranged++;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    // Manda devagar (pedaços de 32 KB) pra dar tempo de pausar; "drop" corta no meio às vezes.
    let pos = start;
    const dropAt = mode === 'drop' && stats.requests % 3 === 0 ? start + Math.floor((end - start) / 2) : -1;
    const pump = () => {
      if (pos > end) return res.end();
      if (dropAt >= 0 && pos >= dropAt) return res.destroy();
      const next = Math.min(pos + 32 * KB, end + 1);
      const ok = res.write(DATA.subarray(pos, next));
      pos = next;
      const delay = mode === 'slow' ? 15 : 0;
      if (ok) setTimeout(pump, delay); else res.once('drain', () => setTimeout(pump, delay));
    };
    pump();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port;
      resolve({ url: (mode) => `http://127.0.0.1:${port}/file?mode=${mode}`, close: () => server.close(), stats });
    });
  });
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bahdl-'));
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('parseContentRange', () => {
  assert.deepStrictEqual(parseContentRange('bytes 0-0/1234'), { first: 0, last: 0, total: 1234 });
  assert.deepStrictEqual(parseContentRange('bytes 10-19/*'), { first: 10, last: 19, total: undefined });
  assert.strictEqual(parseContentRange('lixo'), null);
});

test('probe: tamanho, Range e endereço final depois do redirecionamento', async () => {
  const s = await startServer();
  try {
    const p = await probeDownload(s.url('ok').replace('/file', '/redirect'), {});
    assert.strictEqual(p.size, SIZE);
    assert.strictEqual(p.resumable, true);
    assert.match(p.finalUrl, /\/file\?mode=ok$/);
    const n = await probeDownload(s.url('norange'), {});
    assert.strictEqual(n.resumable, false);
    const h = await probeDownload(s.url('nohead'), {});   // HEAD recusado → confirma com GET Range 0-0
    assert.strictEqual(h.resumable, true);
    assert.strictEqual(h.size, SIZE);
  } finally { s.close(); }
});

test('4 conexões: arquivo idêntico, parcial some, várias requisições com Range', async () => {
  const s = await startServer();
  const dir = tmp();
  try {
    const target = path.join(dir, 'arquivo.bin');
    const p = await probeDownload(s.url('ok'), {});
    const d = new MultiDownload(p, target, {}, { ...FAST, connections: 4 });
    await d.start();
    assert.strictEqual(d.state, 'completed');
    assert.strictEqual(sha(target), SHA);
    assert.ok(!fs.existsSync(partPathFor(target)));
    assert.ok(s.stats.ranged >= 4, `ranged=${s.stats.ranged}`);
  } finally { s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('servidor sem Range: uma conexão só, arquivo idêntico', async () => {
  const s = await startServer();
  const dir = tmp();
  try {
    const target = path.join(dir, 'semrange.bin');
    const d = new MultiDownload(await probeDownload(s.url('norange'), {}), target, {}, { ...FAST, connections: 8 });
    await d.start();
    assert.strictEqual(d.state, 'completed');
    assert.strictEqual(sha(target), SHA);
  } finally { s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('conexão cai no meio: tenta de novo e termina igual', async () => {
  const s = await startServer();
  const dir = tmp();
  try {
    const target = path.join(dir, 'queda.bin');
    const d = new MultiDownload(await probeDownload(s.url('drop'), {}), target, {}, { ...FAST, connections: 4 });
    await d.start();
    assert.strictEqual(d.state, 'completed', d.error);
    assert.strictEqual(sha(target), SHA);
  } finally { s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('servidor limitando (429): conexões a mais se aposentam e o arquivo sai inteiro', async () => {
  const s = await startServer();
  const dir = tmp();
  try {
    const target = path.join(dir, 'limite.bin');
    const d = new MultiDownload(await probeDownload(s.url('limit'), {}), target, {}, { ...FAST, connections: 6 });
    await d.start();
    assert.strictEqual(d.state, 'completed', d.error);
    assert.strictEqual(sha(target), SHA);
    assert.ok(s.stats.refused > 0);
  } finally { s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pausar e continuar: termina igual', async () => {
  const s = await startServer();
  const dir = tmp();
  try {
    const target = path.join(dir, 'pausa.bin');
    const d = new MultiDownload(await probeDownload(s.url('slow'), {}), target, {}, { ...FAST, connections: 4 });
    const run = d.start();
    while (d.snapshot().done < SIZE / 4) await new Promise(r => setTimeout(r, 20));
    d.pause();
    await run;
    assert.strictEqual(d.state, 'paused');
    const doneAtPause = d.snapshot().done;
    assert.ok(doneAtPause > 0 && doneAtPause < SIZE);
    await d.start();
    assert.strictEqual(d.state, 'completed', d.error);
    assert.strictEqual(sha(target), SHA);
  } finally { s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cancelar: apaga o parcial e não cria o arquivo', async () => {
  const s = await startServer();
  const dir = tmp();
  try {
    const target = path.join(dir, 'cancela.bin');
    const d = new MultiDownload(await probeDownload(s.url('slow'), {}), target, {}, { ...FAST, connections: 4 });
    const run = d.start();
    while (d.snapshot().done < SIZE / 5) await new Promise(r => setTimeout(r, 20));
    await d.cancel();
    await run;
    assert.strictEqual(d.state, 'cancelled');
    assert.ok(!fs.existsSync(partPathFor(target)));
    assert.ok(!fs.existsSync(target));
  } finally { s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('uniqueTarget: não sobrescreve arquivo que já existe', () => {
  const dir = tmp();
  try {
    const f = path.join(dir, 'video.mp4');
    assert.strictEqual(uniqueTarget(f), f);
    fs.writeFileSync(f, 'x');
    assert.strictEqual(uniqueTarget(f), path.join(dir, 'video (1).mp4'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
