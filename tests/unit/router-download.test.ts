// Download do modelo do roteador (src/main/router/model-download.ts): retoma com Range, recomeça
// quando o servidor ignora o Range, confere tamanho e sha256 e só então dá o nome final.
import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { downloadModel, sha256File } from '../../src/main/router/model-download.ts';

const DATA = crypto.randomBytes(300_000);
const SHA = crypto.createHash('sha256').update(DATA).digest('hex');

async function server(opts: { ignoreRange?: boolean; cutAt?: number } = {}) {
  const ranges: string[] = [];
  const srv = http.createServer((req, res) => {
    const r = req.headers.range;
    ranges.push(r || '');
    const m = /^bytes=(\d+)-$/.exec(r || '');
    if (m && !opts.ignoreRange) {
      const from = Number(m[1]);
      if (from >= DATA.length) { res.writeHead(416); res.end(); return; }
      res.writeHead(206, { 'Content-Length': DATA.length - from, 'Content-Range': `bytes ${from}-${DATA.length - 1}/${DATA.length}` });
      res.end(DATA.subarray(from));
      return;
    }
    if (opts.cutAt) {
      // Conexão cai no meio: manda parte e destrói.
      res.writeHead(200, { 'Content-Length': DATA.length });
      res.write(DATA.subarray(0, opts.cutAt), () => setTimeout(() => res.destroy(), 20));
      return;
    }
    res.writeHead(200, { 'Content-Length': DATA.length });
    res.end(DATA);
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/m.gguf`, ranges, close: () => srv.close() };
}

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bah-router-dl-')), 'm.gguf');

test('fresh download: verified and renamed, no .part left; progress reported', async () => {
  const s = await server();
  const dest = tmp();
  let last = 0;
  try {
    await downloadModel({ url: s.url, dest, sha256: SHA, size: DATA.length, onProgress: (b) => { last = b; } });
    assert.equal(await sha256File(dest), SHA);
    assert.ok(!fs.existsSync(dest + '.part'));
    assert.equal(last, DATA.length);
    assert.deepEqual(s.ranges, ['']);
  } finally { s.close(); }
});

test('resume: an existing .part is continued with a Range request', async () => {
  const s = await server();
  const dest = tmp();
  fs.writeFileSync(dest + '.part', DATA.subarray(0, 123_456));
  try {
    await downloadModel({ url: s.url, dest, sha256: SHA, size: DATA.length });
    assert.deepEqual(s.ranges, ['bytes=123456-']);
    assert.equal(await sha256File(dest), SHA);
  } finally { s.close(); }
});

test('server ignores Range (200) → starts over instead of appending', async () => {
  const s = await server({ ignoreRange: true });
  const dest = tmp();
  fs.writeFileSync(dest + '.part', DATA.subarray(0, 1000));
  try {
    await downloadModel({ url: s.url, dest, sha256: SHA, size: DATA.length });
    assert.equal(await sha256File(dest), SHA);
  } finally { s.close(); }
});

test('complete .part is only verified (416 / no request)', async () => {
  const s = await server();
  const dest = tmp();
  fs.writeFileSync(dest + '.part', DATA);
  try {
    await downloadModel({ url: s.url, dest, sha256: SHA, size: DATA.length });
    assert.deepEqual(s.ranges, []);
    assert.ok(fs.existsSync(dest));
  } finally { s.close(); }
});

test('checksum mismatch: rejected and the bad .part is deleted; nothing at dest', async () => {
  const s = await server();
  const dest = tmp();
  try {
    await assert.rejects(downloadModel({ url: s.url, dest, sha256: '0'.repeat(64), size: DATA.length }), /checksum mismatch/);
    assert.ok(!fs.existsSync(dest));
    assert.ok(!fs.existsSync(dest + '.part'));
  } finally { s.close(); }
});

test('interrupted download keeps the .part, and the next call resumes it', async () => {
  const cut = await server({ cutAt: 100_000 });
  const dest = tmp();
  try {
    await assert.rejects(downloadModel({ url: cut.url, dest, sha256: SHA, size: DATA.length }));
    const kept = fs.statSync(dest + '.part').size;
    assert.ok(kept > 0 && kept < DATA.length, String(kept));
  } finally { cut.close(); }
  const s = await server();
  try {
    await downloadModel({ url: s.url, dest, sha256: SHA, size: DATA.length });
    assert.match(s.ranges[0], /^bytes=\d+-$/);
    assert.equal(await sha256File(dest), SHA);
  } finally { s.close(); }
});

test('HTTP error → rejected with the status', async () => {
  const srv = http.createServer((_q, res) => { res.writeHead(404); res.end(); });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
  try {
    await assert.rejects(downloadModel({ url, dest: tmp(), sha256: SHA, size: DATA.length }), /HTTP 404/);
  } finally { srv.close(); }
});
