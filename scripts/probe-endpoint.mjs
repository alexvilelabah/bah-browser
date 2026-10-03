#!/usr/bin/env node
// probe-endpoint.mjs — what is actually behind this URL?
//
// Ollama, llama.cpp and MLX-style servers all speak enough OpenAI to look identical in
// a log, but they differ in the ways that break an agent: who reports the context
// window, whether stream_options survives, whether response_format is accepted, and
// whether a metadata request silently loads a model.
//
// Usage:
//   node scripts/probe-endpoint.mjs http://192.168.2.162:11434 [model] [apiKey]
//
// Read-only. Never triggers generation on a real model unless a model argument is
// given, and never loads a model on purpose (props is queried with autoload=false).

const BASE_RAW = process.argv[2];
const MODEL = process.argv[3];
const API_KEY = process.argv[4] || process.env.OPENAI_API_KEY || process.env.LOCAL_API_KEY;

if (!BASE_RAW) {
  console.error('usage: node scripts/probe-endpoint.mjs <baseUrl> [model] [apiKey]');
  process.exit(2);
}

const BASE = BASE_RAW.replace(/\/+$/, '').replace(/\/v1$/i, '');
const H = { 'Content-Type': 'application/json', ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) };
const ok = (r) => r.status >= 200 && r.status < 300;
const pad = (s, n) => String(s).padEnd(n);

async function get(path, ms = 6000) {
  const t = Date.now();
  try {
    const r = await fetch(BASE + path, { headers: H, signal: AbortSignal.timeout(ms) });
    let body = null;
    try { body = await r.json(); } catch { /* non-json */ }
    return { status: r.status, body, ms: Date.now() - t };
  } catch (e) {
    return { status: 0, body: null, ms: Date.now() - t, error: e.name === 'TimeoutError' ? 'timeout' : e.message };
  }
}

function verdict(label, value, note = '') {
  const s = String(value ?? '');
  const no = value === false || value === null || value === undefined
    || /absent|not advertised|unrecognised|not llama\.cpp|^none\b|unknown|\b40[49]\b|\b50\d\b|timeout|error/i.test(s);
  const mark = no ? 'NO  ' : 'YES ';
  console.log(`  ${pad(label, 26)} ${mark} ${pad(s, 40)} ${note}`);
}

console.log(`\nprobing ${BASE}${MODEL ? `  (model: ${MODEL})` : ''}\n`);

// ── Which runtime ─────────────────────────────────────────────────────────────
const tags = await get('/api/tags');
const v1models = await get('/v1/models');
const isOllama = ok(tags) && Array.isArray(tags.body?.models);
const isOpenAI = ok(v1models) && Array.isArray(v1models.body?.data);

const runtime = isOllama ? 'ollama (native API present)'
  : isOpenAI ? 'openai-compatible'
  : 'unrecognised';

verdict('runtime', runtime);
verdict('/api/tags', ok(tags) ? `present, ${tags.body.models.length} models` : `absent (${tags.status || tags.error})`);
verdict('/v1/models', ok(v1models) ? `present, ${v1models.body.data.length} models` : `absent (${v1models.status || v1models.error})`);

// ── Context window: which name does this server use ───────────────────────────
const names = ['max_model_len', 'context_length', 'max_context_tokens', 'n_ctx', 'num_ctx', 'max_context_window'];
let advertised = null, viaName = null;
const list = isOllama ? (tags.body.models || [])
  : isOpenAI ? v1models.body.data : [];
for (const m of list) {
  for (const n of names) {
    // ollama nests under details, LM Studio under metadata/parameters, most servers flat.
    const v = Number(m?.[n] ?? m?.details?.[n] ?? m?.metadata?.[n] ?? m?.parameters?.[n] ?? m?.model_card?.[n]);
    if (Number.isFinite(v) && v > 0) { advertised = v; viaName = `${n} on ${m.id || m.name || m.model || '?'}`; break; }
  }
  if (advertised) break;
}
verdict('advertised window', advertised ? `${advertised} tokens` : 'not advertised', viaName || 'unknown until a model is loaded');

// ── Runtime allocation, without loading anything ──────────────────────────────
if (isOllama) {
  const ps = await get('/api/ps');
  const running = ok(ps) ? (ps.body.models || []) : [];
  verdict('loaded now', running.length ? running.map((m) => `${m.name} ctx=${m.context_length ?? '?'}`).join(', ') : 'none',
    '/api/ps is the only trusted window; /v1 does not report it');
} else {
  const props = await get('/props?model=any&autoload=false');
  const nctx = Number(props.body?.default_generation_settings?.n_ctx);
  verdict('/props (llama.cpp)', ok(props) ? (Number.isFinite(nctx) && nctx > 0 ? `n_ctx ${nctx}` : 'present, n_ctx 0 = unknown') : `${props.status || props.error} — not llama.cpp`,
    'queried with autoload=false so nothing is loaded as a side effect');
}

// ── Streaming: does the usage block survive ────────────────────────────────────
if (MODEL) {
  console.log('');
  const body = { model: MODEL, stream: true, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the single word: ok' }] };
  const withOpts = await postChat({ ...body, stream_options: { include_usage: true } }, 'stream_options accepted');
  console.log(`  ${pad('stream + include_usage', 26)} ${pad(withOpts.accepted ? 'yes ' : 'no  ', 22)} ${withOpts.note}`);
  if (withOpts.accepted && !withOpts.usage) {
    console.log('    ! server accepted stream_options but returned no usage block — token accounting will be blind');
  }
  const jsonMode = await postChat({ ...body, response_format: { type: 'json_object' } }, 'response_format accepted');
  console.log(`  ${pad('response_format json', 26)} ${pad(jsonMode.accepted ? 'yes ' : 'no  ', 22)} ${jsonMode.note}`);
} else {
  console.log('\n  (pass a model name to test streaming and JSON mode — nothing was generated)\n');
}

async function postChat(body) {
  const t = Date.now();
  try {
    const r = await fetch(`${BASE}/v1/chat/completions`, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    if (!ok(r)) {
      const err = await r.text();
      return { accepted: false, note: `HTTP ${r.status}: ${err.slice(0, 90).replace(/\s+/g, ' ')}` };
    }
    let usage = null, chars = 0, first = null;
    const reader = r.body.getReader(); const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (first === null) first = Date.now() - t;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const p = line.slice(5).trim();
        if (p === '[DONE]') continue;
        try {
          const ev = JSON.parse(p);
          chars += (ev.choices?.[0]?.delta?.content || '').length;
          if (ev.usage) usage = ev.usage;
        } catch { /* skip */ }
      }
    }
    return { accepted: true, usage, note: `first token ${first ?? 0}ms, ${chars} chars, total ${Date.now() - t}ms${usage ? `, usage completion=${usage.completion_tokens}` : ''}` };
  } catch (e) {
    return { accepted: false, note: `${e.name}: ${String(e.message).slice(0, 90)}` };
  }
}

console.log('');
