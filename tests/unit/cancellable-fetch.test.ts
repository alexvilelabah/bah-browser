// Regression test for the real symptom: Stop pressed mid-response used to discard the
// result locally while the server kept generating.
import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { fetchCancellable } from '../../src/main/cancellable-fetch.ts';
import { LocalRequestError } from '../../src/main/local-providers.ts';

function startServer() {
  return new Promise((resolve) => {
    let closed = false;
    const server = http.createServer((req, res) => {
      req.on('close', () => { closed = true; });
      const mode = new URL(req.url ?? '/', 'http://x').searchParams.get('mode') ?? 'ok';
      if (mode === 'slow-headers') return; // never answer
      if (mode === 'trickle') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"choices":[');
        const iv = setInterval(() => res.write('{"delta":{"content":"x"}},'), 40);
        req.on('close', () => clearInterval(iv));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${(server.address() as any).port}`, wasClosed: () => closed });
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('slow headers abort as TIMEOUT_FIRST_CHUNK', async () => {
  const { server, url, wasClosed } = await startServer();
  try {
    await assert.rejects(
      fetchCancellable(`${url}/?mode=slow-headers`, { method: 'POST' }, { firstChunkMs: 120, label: 'local m' }),
      (e: any) => e instanceof LocalRequestError && e.code === 'TIMEOUT_FIRST_CHUNK' && e.retryable,
    );
    await sleep(80);
    assert.ok(wasClosed(), 'socket must be dropped, not left generating');
  } finally { server.close(); }
});

test('caller abort mid-body cancels and frees the socket', async () => {
  const { server, url, wasClosed } = await startServer();
  try {
    const ac = new AbortController();
    const { res, settle } = await fetchCancellable(`${url}/?mode=trickle`, { method: 'POST' }, { firstChunkMs: 5000, totalMs: 5000, signal: ac.signal, label: 'local m' });
    assert.equal(res.status, 200);
    const p = res.text().catch((e: any) => e);
    ac.abort();
    const outcome: any = await p;
    assert.ok(outcome instanceof Error || outcome?.code === undefined, 'body read must not resolve cleanly');
    settle();
    await sleep(120);
    assert.ok(wasClosed(), 'Stop must drop the socket, not just ignore the result');
  } finally { server.close(); }
});

test('total clock aborts a non-streaming call that never finishes', async () => {
  const { server, url } = await startServer();
  try {
    const { res, settle } = await fetchCancellable(`${url}/?mode=trickle`, { method: 'POST' }, { firstChunkMs: 5000, totalMs: 200, label: 'local m' });
    assert.equal(res.status, 200);
    const p = res.text().catch((e: any) => e);
    const outcome: any = await p;
    assert.ok(outcome instanceof Error, 'trickling body must be cut by the total clock');
    settle();
  } finally { server.close(); }
});

test('happy path reads the body and settle() leaves no timers behind', async () => {
  const { server, url } = await startServer();
  try {
    const { res, settle } = await fetchCancellable(`${url}/?mode=ok`, { method: 'POST' }, { firstChunkMs: 5000, totalMs: 5000, label: 'local m' });
    assert.deepEqual(JSON.parse(await res.text()), { ok: true });
    settle();
    settle(); // idempotent
    assert.equal(process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length, 0, 'settle() must clear both clocks');
  } finally { server.close(); }
});

test('connection refused is CONNECTION_FAILED and retryable', async () => {
  const { server } = await startServer();
  const port = (server.address() as any).port;
  await new Promise((r) => server.close(r));
  await assert.rejects(
    fetchCancellable(`http://127.0.0.1:${port}/`, { method: 'POST' }, { firstChunkMs: 1000, label: 'local m' }),
    (e: any) => e instanceof LocalRequestError && e.code === 'CONNECTION_FAILED' && e.retryable,
  );
});
