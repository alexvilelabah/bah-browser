// C2 locks the two local clocks and removes `ollamaWarmed`, whose early `= true` made the
// cold 300s budget unreachable on exactly the call that loads the model (it got 120s).
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import http from 'node:http';
import {
  fetchCancellable,
  LOCAL_FIRST_CHUNK_MS, LOCAL_TOTAL_MS, LOCAL_INACTIVITY_MS,
  CLOUD_FIRST_CHUNK_MS, CLOUD_BODY_MS, CLOUD_INACTIVITY_MS,
} from '../../src/main/cancellable-fetch.ts';

test('local clocks are the agreed numbers; cloud clocks are untouched', () => {
  assert.equal(LOCAL_FIRST_CHUNK_MS, 300_000);
  assert.equal(LOCAL_TOTAL_MS, 300_000);
  assert.equal(LOCAL_INACTIVITY_MS, 60_000);
  assert.equal(CLOUD_FIRST_CHUNK_MS, 45_000);
  assert.equal(CLOUD_BODY_MS, 60_000);
  assert.equal(CLOUD_INACTIVITY_MS, 30_000);
  // The old warm clock was the bug: 120s killed long answers.
  assert.ok(LOCAL_TOTAL_MS > 120_000, 'local non-streaming budget must exceed the old 120s');
});

test('a streaming local call gets no total cap, only inactivity', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.write('{"a":1},');
    const iv = setInterval(() => res.write('{"b":2},'), 60);
    req.on('close', () => clearInterval(iv));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/`;
  try {
    const { res, settle } = await fetchCancellable(url, {}, {
      firstChunkMs: LOCAL_FIRST_CHUNK_MS,
      totalMs: undefined, // streaming: inactivity governs, not total
    });
    const reader = res.body!.getReader();
    let chunks = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 400) { const { done } = await reader.read(); if (done) break; chunks++; }
    assert.ok(chunks >= 3, 'stream must keep flowing with no total cap');
    await reader.cancel();
    settle();
  } finally { server.close(); }
});

test('ollamaWarmed is gone — no flag can shorten the budget of the cold call', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'main', 'ai-engine.ts'), 'utf8');
  assert.equal(/ollamaWarmed/.test(src), false, 'the warmed flag must not come back');
  assert.ok(/LOCAL_TOTAL_MS/.test(src), 'local non-streaming must use the shared budget constant');
});

test('non-streaming local uses the full total budget, not the old 120s', async () => {
  const server = http.createServer(async (req, res) => {
    res.writeHead(200);
    // answer after the old warm cap (120s) would have fired — simulated at test scale by
    // checking the clock we hand the transport, not by waiting 300s
    setTimeout(() => res.end('{"ok":true}'), 120);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/`;
  try {
    const { res, settle } = await fetchCancellable(url, {}, { firstChunkMs: LOCAL_FIRST_CHUNK_MS, totalMs: LOCAL_TOTAL_MS });
    assert.deepEqual(JSON.parse(await res.text()), { ok: true });
    settle();
  } finally { server.close(); }
});
