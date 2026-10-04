// The two stream clocks, against a real socket. Before the first token the deadline is the
// first-token budget (keepalives do not count: oMLX sends one every ~10s while it processes
// the prompt); after it, silence longer than the inactivity window means a dead stream.
import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { readSseStream, readOllamaNdjson, createLiveMeter } from '../../src/main/stream-readers.ts';
import { ThinkingBudget } from '../../src/main/thinking-budget.ts';
import { fitOutputToWindow } from '../../src/main/local-providers.ts';

type Step = { at: number; data: string };

/** Writes each chunk at its own time, then ends (or hangs when `hang`). */
function serveTimed(steps: Step[], hang = false) {
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.flushHeaders();   // headers now, body later - like oMLX and llama.cpp
      for (const s of steps) timers.push(setTimeout(() => { try { res.write(s.data); } catch {} }, s.at));
      if (!hang) timers.push(setTimeout(() => { try { res.end(); } catch {} }, Math.max(0, ...steps.map(s => s.at)) + 20));
    });
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${(server.address() as any).port}/`,
      close: () => { timers.forEach(clearTimeout); server.closeAllConnections?.(); server.close(); },
    }));
  });
}

const KEEPALIVE = 'data: {"model":"keepalive","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n';

test('keepalives before the first token do not stop the first-token deadline', async () => {
  // Keepalive every 40ms, never a token: inactivity (100ms) alone would wait forever.
  const steps = Array.from({ length: 20 }, (_, i) => ({ at: i * 40, data: KEEPALIVE }));
  const srv = await serveTimed(steps, true);
  try {
    const t0 = Date.now();
    await assert.rejects(readSseStream(await fetch(srv.url), () => {}, undefined, 100, undefined, undefined, 300),
      (e: any) => e.code === 'TIMEOUT_FIRST_CHUNK');
    assert.ok(Date.now() - t0 < 700, 'fires at the first-token deadline, not after the keepalives end');
  } finally { srv.close(); }
});

test('a slow prompt phase longer than the inactivity window survives when the budget allows', async () => {
  // Silent 250ms (prompt processing), then tokens. Inactivity is 100ms, first-token budget 1s.
  const srv = await serveTimed([
    { at: 250, data: 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n' },
    { at: 260, data: 'data: [DONE]\n\n' },
  ]);
  try {
    const text = await readSseStream(await fetch(srv.url), () => {}, undefined, 100, undefined, undefined, 1000);
    assert.equal(text, 'ok');
  } finally { srv.close(); }
});

test('after the first token, silence past the inactivity window is a stall', async () => {
  const srv = await serveTimed([{ at: 10, data: 'data: {"choices":[{"delta":{"content":"par"}}]}\n\n' }], true);
  try {
    await assert.rejects(readSseStream(await fetch(srv.url), () => {}, undefined, 150, undefined, undefined, 5000),
      (e: any) => e.code === 'TIMEOUT_STALL');
  } finally { srv.close(); }
});

test('without a first-token budget (cloud) the reader keeps its inactivity-only clock', async () => {
  const srv = await serveTimed([{ at: 250, data: 'data: {"choices":[{"delta":{"content":"x"}}]}\n\n' }]);
  try {
    await assert.rejects(readSseStream(await fetch(srv.url), () => {}, undefined, 100), (e: any) => e.code === 'TIMEOUT_STALL');
  } finally { srv.close(); }
});

test('delta.reasoning (vLLM / LM Studio) is thinking: shown as such and counted by the budget', async () => {
  const chunk = 'data: {"choices":[{"delta":{"reasoning":"' + 'think '.repeat(40) + '"}}]}\n\n';
  const srv = await serveTimed(Array.from({ length: 10 }, (_, i) => ({ at: i * 5, data: chunk })), true);
  try {
    let seen = '';
    await assert.rejects(
      readSseStream(await fetch(srv.url), (d) => { seen += d; }, undefined, 2000, new ThinkingBudget({ tokensSoft: 100 }), undefined, 2000),
      (e: any) => e.code === 'THINKING_BUDGET');
    assert.ok(seen.startsWith('<think>'), 'reasoning is wrapped for the UI');
  } finally { srv.close(); }
});

test('ollama: first-token deadline and done_reason', async () => {
  const srv = await serveTimed([
    { at: 200, data: '{"message":{"content":"{\\"action\\":\\"done\\"}"},"done":false}\n' },
    { at: 210, data: '{"message":{"content":""},"done":true,"done_reason":"length","eval_count":7}\n' },
  ]);
  try {
    const metrics: { usage?: any; finish?: string } = {};
    const text = await readOllamaNdjson(await fetch(srv.url), () => {}, undefined, 50, undefined, metrics, 1000);
    assert.equal(text, '{"action":"done"}');
    assert.equal(metrics.finish, 'length');
    assert.equal(metrics.usage?.completion_tokens, 7);
  } finally { srv.close(); }
});

test('live meter: cumulative, throttled, rate from the first token, exact on usage', () => {
  let t = 0;
  const sent: any[] = [];
  const m = createLiveMeter((x) => sent.push(x), () => t);
  t = 5000;                       // 5s of load + prompt processing before the first token
  m.add('<think>');
  m.add('x'.repeat(35));          // first token: reports (10 est. tokens)
  t = 5500; m.add('x'.repeat(35));// throttled
  t = 7000; m.add('x'.repeat(70));// 40 est. tokens over 2s since the first token
  assert.equal(sent.length, 2);
  assert.equal(sent[1].kind, 'thinking');
  assert.equal(sent[1].estTokens, 40);
  assert.equal(sent[1].tokPerSec, 20, 'rate excludes the 5s before the first token');
  m.add('</think>');
  m.done({ completion_tokens: 123, generation_tokens_per_second: 77.4 });
  const last = sent[sent.length - 1];
  assert.deepEqual([last.kind, last.estTokens, last.tokPerSec, last.exact], ['answer', 123, 77, true]);
});

test('output budget fits the window, with a usable floor', () => {
  assert.equal(fitOutputToWindow({ budget: 16384, window: 262144, promptTokens: 9000 }), 16384);
  assert.equal(fitOutputToWindow({ budget: 16384, window: 16384, promptTokens: 9000 }), 16384 - 9000 - 512);
  assert.equal(fitOutputToWindow({ budget: 16384, window: 8192, promptTokens: 9000 }), 1024, 'overflow is left to the server to report');
  assert.equal(fitOutputToWindow({ budget: 2048, window: 262144, promptTokens: 9000 }), 2048, 'never above the user budget');
});
