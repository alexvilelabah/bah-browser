// Locks the cloud request bodies in ai-engine.ts against tests/goldens/cloud-bodies.json,
// so the local-AI work cannot silently change what cloud providers receive.
// Bodies are located structurally by function name - no marker comments in the source.

// Local-only knobs must never appear in a cloud body.
//   node scripts/golden-cloud-bodies.mjs            -> check
//   node scripts/golden-cloud-bodies.mjs --write    -> re-record (explicit decision only)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src', 'main', 'ai-engine.ts');
const GOLDEN = join(root, 'tests', 'goldens', 'cloud-bodies.json');

/** fnName -> golden key. Only CLOUD providers live here; the OpenAI-compatible
 *  function is shared with local servers and is pinned by decision-level unit tests
 *  (tests/unit/local-decisions.test.ts) instead of by source text. */
const TARGETS = [
  ['callAnthropic', 'anthropic'],
  ['callMistral', 'mistral'],
  ['callNim', 'nvidia'],
  ['callDeepSeek', 'deepseek'],
];

/** Local-only knobs that must never appear inside a cloud request body. */
const LOCAL_ONLY = ['stream_options', 'chat_template_kwargs', 'num_predict', 'num_ctx', 'firstChunkMs', 'inactivityMs', 'ollamaNumCtx', 'enable_thinking'];

/** Remove comments and redundant whitespace. `://` is protected so URLs survive. */
function normalize(text) {
  return text
    .split('\n')
    .map(line => {
      let out = '';
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '/' && line[i + 1] === '/' && line[i - 1] !== ':') break;
        out += line[i];
      }
      return out.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean)
    .join('\n');
}

/** Index just past the closing brace that matches the first `{` at/after `from`. */
function matchBrace(src, from) {
  const open = src.indexOf('{', from);
  if (open < 0) throw new Error(`no opening brace at/after offset ${from}`);
  let depth = 0;
  let inStr = null;
  let esc = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('unbalanced braces');
}

function functionBody(src, fnName) {
  const re = new RegExp(`private async ${fnName}\\s*\\(`);
  const m = re.exec(src);
  if (!m) throw new Error(`function not found: ${fnName}`);
  const braceAt = src.indexOf(')', m.index);
  if (braceAt < 0) throw new Error(`no parameter list close in ${fnName}`);
  const start = src.indexOf('{', braceAt);
  if (start < 0) throw new Error(`no body for ${fnName}`);
  const end = matchBrace(src, start);
  return src.slice(start + 1, end - 1);
}

/** The `const body ...` literal plus every immediately following `if (...) body.x = ...`
 *  statement. Stops at the first statement after the body that does not mention `body`. */
function requestBodySpan(bodySrc, fnName) {
  const m = /const body[^=]*=/.exec(bodySrc);
  if (!m) throw new Error(`no request body literal in ${fnName}`);
  const literalEnd = matchBrace(bodySrc, m.index);
  let end = literalEnd;
  // include the terminating semicolon
  while (end < bodySrc.length && /[;\s]/.test(bodySrc[end]) && bodySrc[end] === ';') end++;
  const rest = bodySrc.slice(end);
  for (const line of rest.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
    if (/^if\s*\(/.test(t) && t.includes('body.')) { end += line.length + 1; continue; }
    if (/^if\s*\(/.test(t) && /^\s*if\s*\([^)]*\)\s*\{?\s*$/.test(line)) {
      // multi-line conditional that mutates body below — take until its closing brace
      const blockEnd = matchBrace(bodySrc, end);
      if (bodySrc.slice(end, blockEnd).includes('body.')) { end = blockEnd; continue; }
    }
    break;
  }
  return bodySrc.slice(m.index, end);
}

export function extractCloudBodies(src) {
  const out = {};
  for (const [fn, key] of TARGETS) {
    out[key] = normalize(requestBodySpan(functionBody(src, fn), fn));
  }
  return out;
}

/** Compare the current source against the golden file. Returns the drift map (empty = ok). */
export function check() {
  const current = extractCloudBodies(readFileSync(SRC, 'utf8'));
  let golden = null;
  try {
    golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  } catch { golden = null; }
  return {
    current,
    golden,
    missingGolden: !golden,
    drift: golden ? Object.keys(current).filter(k => golden[k] !== current[k]) : Object.keys(current),
    leaks: Object.entries(current).flatMap(([k, text]) => LOCAL_ONLY.filter(t => text.includes(t)).map(t => `${k}: ${t}`)),
  };
}

// CLI only — importing this module (the unit tests do) must not run or exit anything.
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) {
  if (process.argv.includes('--write')) {
    mkdirSync(dirname(GOLDEN), { recursive: true });
    writeFileSync(GOLDEN, JSON.stringify(extractCloudBodies(readFileSync(SRC, 'utf8')), null, 2) + '\n');
    console.log(`golden written: ${TARGETS.length} cloud bodies`);
    process.exit(0);
  }
  const r = check();
  if (r.missingGolden) {
    console.error(`missing golden (${GOLDEN}) — run: node scripts/golden-cloud-bodies.mjs --write`);
    process.exit(1);
  }
  if (r.drift.length) {
    console.error('CLOUD REQUEST BODY DRIFT — cloud paths must stay byte-identical:');
    for (const k of r.drift) console.error(`\n--- ${k} ---\nexpected:\n${r.golden[k]}\n\nactual:\n${r.current[k]}`);
    process.exit(1);
  }
  if (r.leaks.length) { console.error('local-only knob leaked into a cloud request body:', r.leaks); process.exit(1); }
  console.log(`cloud bodies unchanged (${TARGETS.length} providers, ${LOCAL_ONLY.length} forbidden tokens clear)`);
}
