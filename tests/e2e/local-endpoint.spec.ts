import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';

async function launch() {
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/electron/dist/electron.exe'),
    args: [path.resolve(__dirname, '../..')],
    // E2E_MOCK_AI only intercepts the AGENT (ai:action); chat + local IPCs run for real.
    env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

interface Seen {
  paths: string[];
  propsQueries: string[];
  lastBody: any;
}

/**
 * Stand-in for a llama.cpp router, shaped like the real thing:
 *  - /v1/models reports load status, input modalities and the launch argv
 *  - /props answers only for a LOADED model (400 "model is not loaded" otherwise)
 *  - /v1/chat/completions honours `stream`, and splits reasoning into its own field
 * There is deliberately no /api/* here: that is Ollama's surface, not this one.
 */
function fakeLlamaCpp(onBody: (b: any) => void, mode: 'ok' | 'truncated' = 'ok') {
  const seen: Seen = { paths: [], propsQueries: [], lastBody: null };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const url = req.url || '';
      seen.paths.push(url);
      if (url.startsWith('/props')) seen.propsQueries.push(url);
      if (body) { try { seen.lastBody = JSON.parse(body); } catch {} onBody(JSON.parse(body || '{}')); }
      if (url.startsWith('/api/')) { res.writeHead(404); res.end('{}'); return; }

      if (url.startsWith('/v1/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [
          { id: 'test-vision:q8', status: { value: 'loaded' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
          // Unloaded, text-only, and its context size is knowable only from the argv.
          { id: 'test-text:q4', status: { value: 'unloaded', args: ['--ctx-size', '65536'] }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
          { id: 'test-embed', status: { value: 'unloaded' } },
        ] }));
        return;
      }

      if (url.startsWith('/props')) {
        // Only the loaded model has a runtime allocation to report.
        if (!/model=test-vision/.test(url)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 400, message: 'model is not loaded' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ default_generation_settings: { n_ctx: 131072 }, total_slots: 1 }));
        return;
      }

      if (url.startsWith('/v1/chat/completions')) {
        // Answer in the shape the caller asked for. Without stream:true the engine
        // calls res.json(), and an SSE body there becomes a silently empty reply.
        let reqBody: any = {};
        try { reqBody = JSON.parse(body || '{}'); } catch {}
        if (!reqBody.stream) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(mode === 'ok'
            ? { choices: [{ message: { role: 'assistant', content: 'hello-local', reasoning_content: 'thinking...' }, finish_reason: 'stop' }] }
            : { choices: [{ message: { role: 'assistant', content: '', reasoning_content: 'x'.repeat(50) }, finish_reason: 'length' }] }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const chunks = mode === 'ok'
          ? [
            { choices: [{ delta: { reasoning_content: 'thinking...' }, finish_reason: null }] },
            { choices: [{ delta: { content: 'hello-local' }, finish_reason: null }] },
            { choices: [{ delta: {}, finish_reason: 'stop' }] },
          ]
          : [{ choices: [{ delta: { reasoning_content: 'x'.repeat(50) }, finish_reason: 'length' }] }];
        for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.writeHead(404); res.end('{}');
    });
  });
  return { server, seen };
}

async function baseUrlOf(server: http.Server): Promise<string> {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test('local:discover grades capabilities without touching /api/* or autoloading', async () => {
  const { server, seen } = fakeLlamaCpp(() => {});
  const base = await baseUrlOf(server);
  const { app, page } = await launch();
  try {
    const d: any = await page.evaluate(([u]) => (window as any).electronAPI.localDiscover('openai-compatible', u), [base]);
    expect(d?.ok).toBe(true);

    const vision = d.models.find((m: any) => m.id === 'test-vision:q8');
    expect(vision.loaded).toBe(true);
    expect(vision.vision).toBe('supported');

    // Modalities listed WITHOUT 'image' is a known negative, not an unknown.
    const text = d.models.find((m: any) => m.id === 'test-text:q4');
    expect(text.loaded).toBe(false);
    expect(text.vision).toBe('unsupported');
    // --ctx-size in the recorded argv is the only context number available while unloaded.
    expect(text.contextTokens).toBe(65536);
    expect(text.contextSource).toBe('configured');

    // No modality metadata at all stays honestly unknown.
    const embed = d.models.find((m: any) => m.id === 'test-embed');
    expect(embed.vision).toBe('unknown');
    expect(embed.unsuitable).toBe('embedding');

    // Discovery must not probe /props: without autoload=false that loads a model.
    expect(seen.propsQueries.length).toBe(0);
    expect(seen.paths.some(p => p.startsWith('/api/'))).toBe(false);
  } finally {
    await app.close();
    await new Promise<void>(r => server.close(() => r()));
  }
});

test('local:context reads the runtime n_ctx of a loaded model with autoload=false', async () => {
  const { server, seen } = fakeLlamaCpp(() => {});
  const base = await baseUrlOf(server);
  const { app, page } = await launch();
  try {
    const r: any = await page.evaluate(([u]) => (window as any).electronAPI.localContext('openai-compatible', u, 'test-vision:q8'), [base]);
    expect(r?.ok).toBe(true);
    expect(r?.tokens).toBe(131072);
    expect(r?.source).toBe('runtime');
    expect(seen.propsQueries.some(q => q.includes('autoload=false'))).toBe(true);
  } finally {
    await app.close();
    await new Promise<void>(r => server.close(() => r()));
  }
});

test('local:context falls back to the advertised size when the model is unloaded', async () => {
  const { server } = fakeLlamaCpp(() => {});
  const base = await baseUrlOf(server);
  const { app, page } = await launch();
  try {
    // /props 400s here, so without the discovery fallback this reports "unknown" and the
    // agent budgets against a 16K guess for what is really a 64K model.
    const r: any = await page.evaluate(([u]) => (window as any).electronAPI.localContext('openai-compatible', u, 'test-text:q4'), [base]);
    expect(r?.ok).toBe(true);
    expect(r?.tokens).toBe(65536);
    expect(r?.source).toBe('configured');
  } finally {
    await app.close();
    await new Promise<void>(r => server.close(() => r()));
  }
});

test('local chat: reasoning stays out of the answer and a trailing /v1 is tolerated', async () => {
  let body: any = null;
  const { server, seen } = fakeLlamaCpp(b => { body = b; });
  const base = await baseUrlOf(server);
  const { app, page } = await launch();
  try {
    // A trailing /v1 must not become /v1/v1/chat/completions.
    await page.evaluate(([u]) => (window as any).electronAPI.setLocalProvider('openai-compatible', '', `${u}/v1`, 'test-vision:q8'), [base]);
    const result: any = await page.evaluate(() => (window as any).electronAPI.aiChat('hi', undefined, false, true, 't-reason'));
    // reasoning_content arrives in its own field and must never be glued to the answer.
    expect(result?.response).toBe('hello-local');
    expect(seen.paths.some(p => p.includes('/v1/v1'))).toBe(false);
    expect(seen.paths.filter(p => p.includes('/v1/chat/completions')).length).toBeGreaterThan(0);
    // The exact selected model must be honoured — a compatible server routes on it.
    expect(body?.model).toBe('test-vision:q8');
  } finally {
    await app.close();
    await new Promise<void>(r => server.close(() => r()));
  }
});
