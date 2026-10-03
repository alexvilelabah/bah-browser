// C8: the advertised context window must be read, not assumed.
import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { discoverLocalModels, advertisedContextTokens } from '../../src/main/local-providers.ts';

function serveJson(routes: Record<string, any>) {
  return new Promise<{ url: string; server: http.Server }>((resolve) => {
    const server = http.createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      const body = routes[path];
      if (body === undefined) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as any).port}`, server }));
  });
}

test('advertises the window under the names servers actually use', () => {
  assert.equal(advertisedContextTokens({ max_model_len: 32768 }), 32768);
  assert.equal(advertisedContextTokens({ context_length: 8192 }), 8192);
  assert.equal(advertisedContextTokens({ max_context_tokens: 4096 }), 4096);
  assert.equal(advertisedContextTokens({ n_ctx: 2048 }), 2048);
  assert.equal(advertisedContextTokens({ metadata: { max_model_len: 16384 } }), 16384);
  assert.equal(advertisedContextTokens({ n_ctx: 0 }), undefined, 'zero is unknown, never unlimited');
  assert.equal(advertisedContextTokens({}), undefined);
  assert.equal(advertisedContextTokens(null), undefined);
});

test('discovery carries the advertised window (vLLM style)', async () => {
  const { server, url } = await serveJson({
    '/v1/models': { object: 'list', data: [{ id: 'srv-a', max_model_len: 32768 }, { id: 'srv-b' }] },
  });
  try {
    const d = await discoverLocalModels(url, undefined, 4000);
    assert.equal(d.ok, true);
    assert.equal(d.models.find(m => m.id === 'srv-a')?.contextTokens, 32768);
    assert.equal(d.models.find(m => m.id === 'srv-b')?.contextTokens, undefined, 'absence stays absence — no invented window');
  } finally { server.close(); }
});

test('router argv --ctx-size is used when nothing is advertised', async () => {
  const { server, url } = await serveJson({
    '/v1/models': { object: 'list', data: [{ id: 'srv-c', status: { value: 'unloaded', args: ['-c', '8192'] } }] },
  });
  try {
    const d = await discoverLocalModels(url, undefined, 4000);
    assert.equal(d.models[0].contextTokens, 8192);
    assert.equal(d.models[0].contextSource, 'configured');
  } finally { server.close(); }
});
