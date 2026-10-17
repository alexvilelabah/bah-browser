import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { searchParallel, setupResearchSearch, parseSearchResults, PARALLEL_MCP_URL, RESEARCH_USER_AGENT } from '../../src/main/research-search.ts';
import { runQuickResearch, loadResearchProvider, normalizeResearchProvider, type ResearchBridge } from '../../src/shared/research.ts';

const sessionId = 'a632a786-aee1-4383-8b79-0bbdfcfa4597';
const payload = { results: [
  { title: 'Electron docs', url: 'https://www.electronjs.org/docs/latest/', excerpts: ['Electron combines Chromium and Node.js.'] },
  { title: 'Bad', url: 'javascript:alert(1)', excerpts: ['ignored'] },
  { title: 'Credentials', url: 'https://user:secret@example.com/', excerpts: [] },
  { title: 'Duplicate', url: 'https://www.electronjs.org/docs/latest/', excerpts: [] },
] };

async function fixture(mode = 'json') {
  const requests: Array<{ method: string; headers: http.IncomingHttpHeaders; body: any }> = [];
  let socketClosed = false;
  let callStarted!: () => void;
  const started = new Promise<void>(resolve => { callStarted = resolve; });
  const server = http.createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {};
    requests.push({ method: req.method!, headers: req.headers, body });
    res.on('close', () => { if (!res.writableFinished) socketClosed = true; });
    if (req.method === 'GET') { res.writeHead(405).end(); return; }
    if (!body.id && body.id !== 0) { res.writeHead(202).end(); return; }
    if (body.method === 'tools/call') {
      callStarted();
      if (mode === 'slow-headers') return;
      if (mode === 'slow-body') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); return; }
      if (mode === 'http-error') { res.writeHead(503).end('Unavailable'); return; }
    }
    const result = body.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
      : body.method === 'tools/list'
        ? { tools: [{ name: 'web_search', inputSchema: { type: 'object', properties: {} } }] }
        : mode === 'tool-error'
          ? { isError: true, content: [{ type: 'text', text: 'quota exhausted' }] }
          : mode === 'malformed'
            ? { content: [{ type: 'text', text: '{not json' }] }
            : { content: [{ type: 'text', text: JSON.stringify(payload) }], ...(mode === 'text' ? {} : { structuredContent: payload }) };
    const json = JSON.stringify({ jsonrpc: '2.0', id: body.id, result });
    res.writeHead(200, { 'Content-Type': mode === 'sse' ? 'text/event-stream' : 'application/json', 'Mcp-Session-Id': 'fixture-session' });
    res.end(mode === 'sse' ? `event: message\ndata: ${json}\n\n` : json);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/mcp`;
  const fetchFixture: typeof fetch = (input, init) => {
    assert.equal(String(input), PARALLEL_MCP_URL, 'production destination cannot be chosen by the renderer');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    return fetch(url, init);
  };
  return { requests, started, fetch: fetchFixture, wasClosed: () => socketClosed, close: () => { server.closeAllConnections(); server.close(); } };
}

function dispatcher(fetchImpl: typeof fetch, timeoutMs = 1000) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const allowed = { sender: {}, senderFrame: {} };
  setupResearchSearch({ handle: (name, fn) => { handlers.set(name, fn); } }, e => e === allowed,
    (query, session, options) => searchParallel(query, session, { ...options, fetch: fetchImpl, timeoutMs }));
  const invoke = (channel: string, ...args: any[]) => Promise.resolve(handlers.get(channel)!(allowed, ...args));
  const prompts: string[] = [];
  const api: ResearchBridge = {
    researchSearch: (query, id, session) => invoke('research:search', query, id, session),
    researchCancel: id => invoke('research:cancel', id),
    chatCancel: async () => true,
    aiChat: async (...args) => {
      assert.deepEqual(args.slice(1, 6), ['', true, true, undefined, undefined]);
      prompts.push(args[0]);
      return { response: 'Electron combines Chromium and Node.js (electronjs.org).' };
    },
  };
  return { api, prompts, handlers, allowed };
}

for (const mode of ['json', 'sse', 'text']) test(`normal resolver -> registered IPC -> MCP ${mode} -> synthesis and source links`, async () => {
  const f = await fixture(mode);
  try {
    const d = dispatcher(f.fetch);
    const result = await runQuickResearch('What is Electron?', { provider: 'parallel', language: 'English', local: true, sessionId }, {
      browser: async () => { throw new Error('explicit Parallel must not use Google'); }, api: d.api,
    });
    assert.equal(result.isError, false);
    assert.match(result.answer, /Chromium and Node.js/);
    assert.deepEqual(result.sources, [{ title: 'Electron docs', url: 'https://www.electronjs.org/docs/latest/' }]);
    assert.match(d.prompts[0], /Electron combines Chromium and Node.js/);
    assert.match(d.prompts[0], /untrusted source material/);
    const call = f.requests.find(x => x.body.method === 'tools/call')!;
    assert.deepEqual(call.body.params, { name: 'web_search', arguments: { objective: 'What is Electron?', search_queries: ['What is Electron?'], session_id: sessionId } });
    for (const request of f.requests) {
      assert.equal(request.headers['user-agent'], RESEARCH_USER_AGENT, 'observed discovery and tool request User-Agent');
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.headers.cookie, undefined);
      if (request.body.method !== 'initialize' && request.method === 'POST') assert.equal(request.headers['mcp-session-id'], 'fixture-session');
    }
    assert.ok(f.requests.some(x => x.body.method === 'tools/list'));
  } finally { f.close(); }
});

test('fresh, saved, override and off choices preserve the keyless browser default', async () => {
  assert.equal(loadResearchProvider({ getItem: () => null }), 'browser');
  assert.equal(loadResearchProvider({ getItem: () => 'parallel' }), 'parallel');
  assert.equal(loadResearchProvider({ getItem: () => 'off' }), 'off');
  assert.equal(loadResearchProvider({ getItem: () => { throw new Error('denied'); } }), 'browser');
  assert.equal(normalizeResearchProvider('unknown'), 'browser');
  let browserCalls = 0;
  const browser = async () => { browserCalls++; return { answer: 'browser result', sources: [] }; };
  const options = { provider: 'browser' as const, language: 'English', local: false, sessionId };
  assert.equal((await runQuickResearch('question', options, { browser })).answer, 'browser result');
  const disabled = await runQuickResearch('question', { ...options, provider: 'off' }, { browser });
  assert.equal(disabled.isError, true);
  assert.equal(browserCalls, 1, 'off must perform no search or inference');
  assert.equal((await runQuickResearch('question', { ...options, provider: 'parallel' }, { browser })).isError, true);
  assert.equal(browserCalls, 1, 'missing selected provider must not fall back');
});

for (const mode of ['http-error', 'tool-error', 'malformed', 'slow-headers', 'slow-body']) test(`selected provider reports ${mode} without fallback or synthesis`, async () => {
  const f = await fixture(mode);
  try {
    const d = dispatcher(f.fetch, mode.startsWith('slow') ? 120 : 1000);
    const result = await runQuickResearch('question', { provider: 'parallel', language: 'English', local: true, sessionId }, {
      browser: async () => { throw new Error('must not fall back'); }, api: d.api,
    });
    assert.equal(result.isError, true);
    assert.deepEqual(result.sources, []);
    assert.equal(d.prompts.length, 0);
    if (mode.startsWith('slow')) {
      assert.match(result.answer, /timed out/);
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(f.wasClosed(), true, 'timeout closes the socket, including after headers');
    }
  } finally { f.close(); }
});

test('Stop reaches the registered cancel handler and closes the MCP socket', async () => {
  const f = await fixture('slow-body');
  try {
    const d = dispatcher(f.fetch);
    const controller = new AbortController();
    const pending = runQuickResearch('question', { provider: 'parallel', language: 'English', local: true, sessionId, signal: controller.signal }, {
      browser: async () => { throw new Error('must not fall back'); }, api: d.api,
    });
    const rejection = assert.rejects(pending, /CHAT_CANCELLED/);
    await f.started;
    controller.abort();
    await rejection;
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(f.wasClosed(), true);
    assert.equal(d.prompts.length, 0);
  } finally { f.close(); }
});

test('only trusted interface requests execute search; invalid or duplicate IDs cannot steal cancellation', async () => {
  let calls = 0;
  const handlers = new Map<string, (...args: any[]) => any>();
  const trusted = { sender: {} };
  let finish!: () => void;
  setupResearchSearch({ handle: (name, fn) => { handlers.set(name, fn); } }, e => e === trusted, async () => {
    calls++;
    await new Promise<void>(resolve => { finish = resolve; });
    return [];
  });
  const invoke = (channel: string, event: any, ...args: any[]) => Promise.resolve(handlers.get(channel)!(event, ...args));
  assert.ok((await invoke('research:search', {}, 'question', sessionId, sessionId)).error);
  assert.ok((await invoke('research:search', trusted, 'question', 'bad-id', sessionId)).error);
  assert.ok((await invoke('research:search', trusted, 'x'.repeat(2001), sessionId, sessionId)).error);
  assert.equal(calls, 0);
  const pending = invoke('research:search', trusted, 'question', sessionId, sessionId);
  assert.ok((await invoke('research:search', trusted, 'question', sessionId, sessionId)).error);
  assert.equal(await invoke('research:cancel', {}, sessionId), false);
  finish(); await pending;
  assert.equal(calls, 1);
});

test('source parser rejects invalid contracts and bounds titles, snippets and result count', () => {
  assert.throws(() => parseSearchResults({ content: [] }), /invalid search response/);
  assert.deepEqual(parseSearchResults({ structuredContent: { results: [] } }), []);
  const items = Array.from({ length: 12 }, (_, i) => ({ title: 't'.repeat(1000), url: `https://example.com/${i}`, excerpts: ['s'.repeat(10000)] }));
  const results = parseSearchResults({ structuredContent: { results: items } });
  assert.equal(results.length, 6);
  assert.equal(results[0].title.length, 300);
  assert.equal(results[0].snippet.length, 3000);
});

test('Stop during synthesis cancels inference and discards the late answer', async () => {
  const controller = new AbortController();
  let chatCancelled = false;
  let finish!: (value: { response: string }) => void;
  let started!: () => void;
  const synthesisStarted = new Promise<void>(resolve => { started = resolve; });
  const api: ResearchBridge = {
    researchSearch: async () => ({ results: [{ title: 'source', url: 'https://example.com/', snippet: 'evidence' }] }),
    researchCancel: async () => true,
    chatCancel: async () => { chatCancelled = true; },
    aiChat: async () => { started(); return new Promise(resolve => { finish = resolve; }); },
  };
  const pending = runQuickResearch('question', { provider: 'parallel', language: 'English', local: true, sessionId, signal: controller.signal }, {
    browser: async () => { throw new Error('must not fall back'); }, api,
  });
  const rejection = assert.rejects(pending, /CHAT_CANCELLED/);
  await synthesisStarted;
  controller.abort(); finish({ response: 'late answer' });
  await rejection;
  assert.equal(chatCancelled, true);
});

test('no results avoids synthesis; inference failures remain errors with source evidence', async () => {
  let summaries = 0;
  const options = { provider: 'parallel' as const, language: 'English', local: true, sessionId };
  const api: ResearchBridge = {
    researchSearch: async () => ({ results: [] }),
    researchCancel: async () => true, chatCancel: async () => true,
    aiChat: async () => { summaries++; return { error: 'Local model unavailable.' }; },
  };
  const deps = { browser: async () => { throw new Error('must not fall back'); }, api };
  assert.equal((await runQuickResearch('question', options, deps)).isError, true);
  assert.equal(summaries, 0);
  api.researchSearch = async () => ({ results: [{ title: 'Source', url: 'https://example.com/', snippet: 'evidence' }] });
  const failed = await runQuickResearch('question', options, deps);
  assert.equal(failed.isError, true);
  assert.match(failed.answer, /Local model unavailable/);
  assert.equal(failed.sources.length, 1);
  assert.equal(summaries, 1);
  // The new provider's request limit must not change the existing browser path.
  let browserQuery = '';
  await runQuickResearch('x'.repeat(2001), { ...options, provider: 'browser' }, { browser: async query => {
    browserQuery = query; return { answer: 'legacy', sources: [] };
  } });
  assert.equal(browserQuery.length, 2001);
});
