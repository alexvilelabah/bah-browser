// Guards, run against a real server: an error inside a 200 stream must not become a
// silently empty answer.
import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { readSseStream, readOllamaNdjson } from '../../src/main/stream-readers.ts';
import { ThinkingBudget } from '../../src/main/thinking-budget.ts';
import { LocalRequestError } from '../../src/main/local-providers.ts';

function serve(chunks: string[], status = 200) {
  return new Promise<{ url: string; server: http.Server }>((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(status, { 'Content-Type': 'text/event-stream' });
      for (const c of chunks) res.write(c);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as any).port}/`, server }));
  });
}

test('sse content and finish_reason come through', async () => {
  const { server, url } = await serve([
    'data: {"choices":[{"delta":{"content":"he"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"llo"},"finish_reason":"stop"}],"usage":{"completion_tokens":2}}\n\n',
    'data: [DONE]\n\n',
  ]);
  try {
    const metrics: { usage?: any; finish?: string } = {};
    let seen = '';
    const text = await readSseStream(await fetch(url), (d) => { seen += d; }, undefined, 5000, undefined, metrics);
    assert.equal(text, 'hello');
    assert.equal(seen, 'hello');
    assert.equal(metrics.finish, 'stop');
    assert.equal(metrics.usage?.completion_tokens, 2);
  } finally { server.close(); }
});

test('an error payload inside a 200 stream throws INSTREAM_ERROR', async () => {
  const { server, url } = await serve([
    'data: {"choices":[{"delta":{"content":"par"}}]}\n\n',
    'data: {"error":{"message":"model overload, retry later"}}\n\n',
  ]);
  try {
    await assert.rejects(readSseStream(await fetch(url), () => {}), (e: any) => {
      assert.ok(e instanceof LocalRequestError);
      assert.equal(e.code, 'INSTREAM_ERROR');
      assert.equal(e.retryable, true, 'overload is retryable');
      return true;
    });
  } finally { server.close(); }
});

test('a non-retryable in-stream error stays non-retryable', async () => {
  const { server, url } = await serve(['data: {"error":"context length exceeded for this model"}\n\n']);
  try {
    await assert.rejects(readSseStream(await fetch(url), () => {}), (e: any) => e.code === 'INSTREAM_ERROR' && e.retryable === false);
  } finally { server.close(); }
});

test('ollama NDJSON error throws instead of answering empty', async () => {
  const { server, url } = await serve(['{"error":"ctx window exceeded"}\n']);
  try {
    await assert.rejects(readOllamaNdjson(await fetch(url), () => {}), (e: any) => e.code === 'INSTREAM_ERROR');
  } finally { server.close(); }
});

test('a permanent in-stream error is not retried (ollama)', async () => {
  const { server, url } = await serve(['{"error":"context length exceeded"}\n']);
  try {
    await assert.rejects(readOllamaNdjson(await fetch(url), () => {}), (e: any) => e.code === 'INSTREAM_ERROR' && e.retryable === false);
  } finally { server.close(); }
});

test('ollama NDJSON thinking is emitted and the budget can cut it', async () => {
  const big = 'x'.repeat(40_000);
  const { server, url } = await serve([`{"message":{"thinking":"${big}"}}\n`, '{"message":{"content":"later"},"done":true}\n']);
  try {
    await assert.rejects(readOllamaNdjson(await fetch(url), () => {}, undefined, 60_000, new ThinkingBudget()), (e: any) => e.code === 'THINKING_BUDGET' && e.retryable);
  } finally { server.close(); }
});

test('thinking is not cut once the answer has started', async () => {
  const big = 'y'.repeat(40_000);
  const { server, url } = await serve([`{"message":{"content":"go"}}\n`, `{"message":{"thinking":"${big}"}}\n`, '{"done":true}\n']);
  try {
    const text = await readOllamaNdjson(await fetch(url), () => {}, undefined, 60_000, new ThinkingBudget());
    assert.ok(text.includes('go'));
  } finally { server.close(); }
});

test('missing body is a STREAM_ERROR, not an empty answer', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200); res.end(); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/`;
  try {
    // A response with no stream at all (server closed early / proxy stripped the body).
    await assert.rejects(readOllamaNdjson({ status: 200 } as any, () => {}), (e: any) => e.code === 'STREAM_ERROR' && e.retryable);
    await assert.rejects(readSseStream({ status: 200 } as any, () => {}), (e: any) => e.code === 'STREAM_ERROR' && e.retryable);
  } finally { server.close(); }
});
