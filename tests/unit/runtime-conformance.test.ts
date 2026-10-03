// Runtime conformance: the same app must drive Ollama (native API), llama.cpp
// (OpenAI-compatible + /props) and MLX-style servers (OpenAI-compatible only) without
// assuming which one it is talking to. Each runtime advertises context under a
// different name, or not at all, and the wrong request here either loads a model as a
// side effect or overclaims a window the server will not honour.
//
// These run offline against fake servers that answer like each runtime does, so the
// behaviour is pinned before a live endpoint is pointed at them.
import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import {
  normalizeBaseUrl, chatCompletionsUrl, modelsUrl,
  discoverLocalModels, detectRuntimeContext, testLocalConnection,
  advertisedContextTokens, ollamaAutoNumCtx, outputBudget, clampWindow,
  applyContextBudget, estimateTokens,
} from '../../src/main/local-providers.ts';

/** Fake server that records every path it was asked for. */
function serve(routes: Record<string, { status?: number; body?: any }>) {
  const seen: { path: string; search: string }[] = [];
  return new Promise<{ url: string; seen: typeof seen; close: () => void }>((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x');
      seen.push({ path: u.pathname, search: u.search });
      const hit = routes[u.pathname];
      if (!hit) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return; }
      res.writeHead(hit.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(hit.body ?? {}));
    });
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${(server.address() as any).port}`,
      seen,
      close: () => server.close(),
    }));
  });
}

// ── URL shape ────────────────────────────────────────────────────────────────

test('base URL never doubles the /v1 segment', () => {
  assert.equal(chatCompletionsUrl('http://h:1234/v1'), 'http://h:1234/v1/chat/completions');
  assert.equal(chatCompletionsUrl('http://h:1234/v1/'), 'http://h:1234/v1/chat/completions');
  assert.equal(chatCompletionsUrl('http://h:1234/'), 'http://h:1234/v1/chat/completions');
  assert.equal(modelsUrl('http://h:1234'), 'http://h:1234/v1/models');
  assert.equal(normalizeBaseUrl(''), '', 'empty stays empty — no request to a bare host');
});

test('bare localhost becomes IPv4, but a real hostname is left alone', () => {
  assert.equal(normalizeBaseUrl('http://localhost:11434'), 'http://127.0.0.1:11434');
  assert.equal(normalizeBaseUrl('http://192.168.2.162:11434'), 'http://192.168.2.162:11434');
  assert.equal(normalizeBaseUrl('http://localhost.local:1234'), 'http://localhost.local:1234', 'only a bare localhost host is rewritten');
});

// ── Ollama native ────────────────────────────────────────────────────────────

test('ollama reports the ACTUAL allocated window for a loaded model', async () => {
  const s = await serve({
    '/api/ps': { body: { models: [{ name: 'qwen3.5:4b', context_length: 32768, size_vram: 3.4e9 }] } },
  });
  try {
    const ctx = await detectRuntimeContext('ollama', s.url, 'qwen3.5:4b', undefined, 4000);
    assert.equal(ctx.tokens, 32768);
    assert.equal(ctx.source, 'runtime', 'a loaded model is a fact, not an estimate');
    assert.ok(!s.seen.some((r) => r.path === '/props'), 'ollama must not be probed over the OpenAI surface');
  } finally { s.close(); }
});

test('ollama with the model unloaded is unknown, never the trained maximum', async () => {
  const s = await serve({
    '/api/ps': { body: { models: [{ name: 'other:model', context_length: 4096 }] } },
  });
  try {
    const ctx = await detectRuntimeContext('ollama', s.url, 'qwen3.5:4b', undefined, 4000);
    assert.equal(ctx.tokens, undefined, 'another model window is not this model window');
    assert.equal(ctx.source, 'unknown');
  } finally { s.close(); }
});

test('ollama answers without a context field, and nothing is invented', async () => {
  const s = await serve({ '/api/ps': { body: { models: [{ name: 'qwen3.5:4b' }] } } });
  try {
    const ctx = await detectRuntimeContext('ollama', s.url, 'qwen3.5:4b', undefined, 4000);
    assert.equal(ctx.source, 'unknown');
  } finally { s.close(); }
});

test('ollama auto context stays in bounds and never shrinks', () => {
  assert.equal(ollamaAutoNumCtx({}), 16384, 'nothing measured: ask for the floor');
  assert.equal(ollamaAutoNumCtx({ measuredPromptTokens: 1000, outputTokens: 1000 }), 16384, 'small need still gets the floor');
  assert.equal(ollamaAutoNumCtx({ measuredPromptTokens: 20000, outputTokens: 8000 }), 28256);
  assert.equal(ollamaAutoNumCtx({ measuredPromptTokens: 200000, outputTokens: 16000 }), 32768, 'capped at the ceiling');
  assert.equal(ollamaAutoNumCtx({ measuredPromptTokens: 1000, outputTokens: 1000, sent: 24576 }), 24576, 'never shrinks: reallocating reloads the model');
});

// ── llama.cpp ────────────────────────────────────────────────────────────────

test('llama.cpp props are read with autoload disabled', async () => {
  const s = await serve({
    '/props': { body: { default_generation_settings: { n_ctx: 8192 } } },
  });
  try {
    const ctx = await detectRuntimeContext('openai-compatible', s.url, 'llama-3.1-8b', undefined, 4000);
    assert.equal(ctx.tokens, 8192);
    assert.equal(ctx.source, 'runtime');
    const props = s.seen.find((r) => r.path === '/props');
    assert.ok(props, 'props was queried');
    assert.match(props!.search, /autoload=false/, 'autoload=false is mandatory: the default loads the model');
    assert.match(props!.search, /model=llama-3\.1-8b/, 'the query names the model');
  } finally { s.close(); }
});

test('a router advertising n_ctx 0 is unknown, not unlimited', async () => {
  const s = await serve({ '/props': { body: { default_generation_settings: { n_ctx: 0 } } } });
  try {
    const ctx = await detectRuntimeContext('openai-compatible', s.url, 'any', undefined, 4000);
    assert.equal(ctx.tokens, undefined);
    assert.equal(ctx.source, 'unknown');
  } finally { s.close(); }
});

test('a server without /props degrades to unknown instead of failing', async () => {
  const s = await serve({});
  try {
    const ctx = await detectRuntimeContext('openai-compatible', s.url, 'any', undefined, 4000);
    assert.equal(ctx.source, 'unknown');
  } finally { s.close(); }
});

// ── MLX-style server: /v1 only ───────────────────────────────────────────────

test('MLX-style server still yields models and an advertised window', async () => {
  const s = await serve({
    '/v1/models': {
      body: { object: 'list', data: [
        { id: 'mlx-community/Qwen3.5-4B-4bit', max_model_len: 40960 },
        { id: 'text-embedding-small' },
      ] },
    },
  });
  try {
    const d = await discoverLocalModels(s.url, undefined, 4000);
    assert.equal(d.ok, true);
    assert.equal(d.models.length, 2);
    assert.equal(d.models.find((m) => m.id.startsWith('mlx-community'))?.contextTokens, 40960);
    assert.equal(d.models.find((m) => m.id.startsWith('mlx-community'))?.vision, 'unknown', 'no metadata means unknown, never guessed');
    const ctx = await detectRuntimeContext('openai-compatible', s.url, 'mlx-community/Qwen3.5-4B-4bit', undefined, 4000);
    assert.equal(ctx.source, 'unknown', 'no props endpoint: the runtime window is genuinely unknown');
  } finally { s.close(); }
});

test('embedding models are flagged, not offered to the agent', async () => {
  const s = await serve({
    '/v1/models': { body: { object: 'list', data: [{ id: 'nomic-embed-text' }, { id: 'qwen3.5:4b' }] } },
  });
  try {
    const d = await discoverLocalModels(s.url, undefined, 4000);
    assert.equal(d.models.find((m) => m.id === 'nomic-embed-text')?.unsuitable, 'embedding');
    assert.equal(d.models.find((m) => m.id === 'qwen3.5:4b')?.unsuitable, undefined);
  } finally { s.close(); }
});

test('an unreachable endpoint reports failure instead of an empty success', async () => {
  const s = await serve({});
  try {
    const c = await testLocalConnection(s.url);
    assert.equal(c.ok, false);
    assert.equal(c.modelsFound, 0);
  } finally { s.close(); }
});

test('connection test never runs inference or loads a model', async () => {
  const s = await serve({ '/v1/models': { body: { object: 'list', data: [{ id: 'a' }, { id: 'b' }] } } });
  try {
    const c = await testLocalConnection(s.url);
    assert.equal(c.ok, true);
    assert.equal(c.modelsFound, 2);
    const dangerous = s.seen.filter((r) => /chat\/completions|\/api\/generate|\/api\/chat|\/completions/.test(r.path));
    assert.deepEqual(dangerous, [], 'a settings ping must not generate tokens or load weights');
  } finally { s.close(); }
});

// ── Budget arithmetic shared by both transports ──────────────────────────────

test('local output budget honours the user setting, cloud keeps its number', () => {
  assert.equal(outputBudget({ isLocal: true }), 16384, 'nothing set: the full local cap, a short one truncates JSON and the agent loops');
  assert.equal(outputBudget({ isLocal: true, userMax: 2048 }), 2048, 'the user setting is honoured');
  assert.equal(outputBudget({ isLocal: true, userMax: 64000 }), 16384, 'still bounded');
  assert.equal(outputBudget({ isLocal: false }), 4096, 'cloud is untouched by local work');
  assert.equal(outputBudget({ isLocal: false, userMax: 64000 }), 4096, 'a local user setting must not inflate a cloud call');
});

test('window prefers the runtime allocation and clamps to what was asked', () => {
  assert.deepEqual(clampWindow({ runtime: 32768, advertised: 262144, fallback: 8192 }), { tokens: 32768, source: 'runtime' }, 'a live allocation beats the trained maximum');
  assert.deepEqual(clampWindow({ runtime: 32768, requested: 16384, fallback: 8192 }), { tokens: 16384, source: 'clamped' });
  assert.deepEqual(clampWindow({ advertised: 40960, fallback: 8192 }), { tokens: 40960, source: 'configured' });
  assert.deepEqual(clampWindow({ fallback: 8192 }), { tokens: 8192, source: 'fallback' }, 'no information yields the fallback, never zero');
  assert.deepEqual(clampWindow({ runtime: 0, advertised: 0, fallback: 8192 }), { tokens: 8192, source: 'fallback' }, 'zero is not a window');
});

test('context trim keeps the newest steps and says what it cut', () => {
  const observed = 'PAGE TEXT\n' + 'x'.repeat(40000) + '\nRECENT HISTORY\nstep1\nstep2\nstep3';
  const r = applyContextBudget(observed, { totalTokens: 4096, maxOutputTokens: 16384 });
  assert.equal(r.trimmed, true);
  assert.match(r.text, /context trimmed/, 'the model is told the observation is partial');
  assert.ok(r.text.length < observed.length);
  assert.ok(estimateTokens(r.text) <= estimateTokens(observed));
});

test('a fitting observation is passed through untouched', () => {
  const observed = 'PAGE TEXT\nshort page';
  const r = applyContextBudget(observed, { totalTokens: 32768, maxOutputTokens: 4096 });
  assert.equal(r.trimmed, false);
  assert.equal(r.text, observed, 'no silent rewriting when nothing had to give');
});

test('advertised window names across runtimes all resolve', () => {
  assert.equal(advertisedContextTokens({ max_model_len: 40960 }), 40960, 'vLLM / MLX server');
  assert.equal(advertisedContextTokens({ context_length: 32768 }), 32768, 'LM Studio');
  assert.equal(advertisedContextTokens({ n_ctx: 8192 }), 8192, 'llama.cpp');
  assert.equal(advertisedContextTokens({ num_ctx: 16384 }), 16384, 'ollama');
  assert.equal(advertisedContextTokens({ n_ctx: 0 }), undefined, 'zero is never a window');
});
