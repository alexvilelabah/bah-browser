// C5: agent calls stream locally. Cloud must not change — including by accident,
// which is exactly what the structural checks below catch.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldStream, streamKey } from '../../src/main/cancellable-fetch.ts';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'main', 'ai-engine.ts'), 'utf8');

test('agent mode streams only locally; chat streams wherever there is a sink', () => {
  assert.equal(shouldStream({ hasDelta: true, isAgentMode: false, isLocal: true }), true);
  assert.equal(shouldStream({ hasDelta: true, isAgentMode: false, isLocal: false }), true);
  assert.equal(shouldStream({ hasDelta: true, isAgentMode: true, isLocal: true }), true);
  assert.equal(shouldStream({ hasDelta: true, isAgentMode: true, isLocal: false }), false);
  assert.equal(shouldStream({ hasDelta: false, isAgentMode: false, isLocal: true }), false);
  assert.equal(shouldStream({ hasDelta: true, isAgentMode: true, isLocal: true, noStream: true }), false);
  assert.equal(shouldStream({ hasDelta: true, isAgentMode: true, isLocal: true, rejected: true }), false);
});

test('capabilities are keyed per server+model, never global', () => {
  assert.equal(streamKey('http://a:1', 'm'), 'http://a:1::m');
  assert.notEqual(streamKey('http://a:1', 'm'), streamKey('http://b:1', 'm'));
});

test('stream_options is sent on the local path only', () => {
  const body = src.slice(src.indexOf('private async openAICompat'), src.indexOf('private async callMistral'));
  const at = body.indexOf('stream_options');
  assert.ok(at > 0, 'openAICompat must set stream_options somewhere');
  assert.ok(body.slice(Math.max(0, at - 200), at).includes('this.isLocal'), 'stream_options must be gated on this.isLocal');
});

test('cloud providers keep the old streaming rule', () => {
  for (const fn of ['callMistral', 'callNim', 'callDeepSeek', 'callAnthropic']) {
    const i = src.indexOf(`private async ${fn}(`);
    assert.ok(i > 0, `${fn} missing`);
    const head = src.slice(i, i + 1400);
    if (/streaming/.test(head)) {
      assert.ok(/const streaming = !!onDelta && !isAgentMode;/.test(head), `${fn}: cloud streaming rule must stay chat-only`);
      assert.equal(/stream_options/.test(head.split('return ')[0]), false, `${fn}: no stream_options on cloud`);
    }
  }
});

test('a stream that dies before the first delta falls back once, not forever', () => {
  assert.equal((src.match(/sawDelta = true/g) || []).length, 3, 'chat + both local agent readers track first-delta');
  assert.ok(/this\.streamRejected\.add\(key\)/.test(src), 'compat path must remember the rejection');
  assert.ok(/this\.streamRejected\.add\(sKey\)/.test(src), 'ollama path must remember the rejection');
  assert.ok(/noStream: true/.test(src), 'compat fallback must be bounded');
  assert.ok(/signal\?: AbortSignal, forceNoStream = false/.test(src), 'ollama fallback must be bounded');
});

test('temperature: cloud stays at 0, local thinking models get none', () => {
  const compat = src.slice(src.indexOf('private async openAICompat'), src.indexOf('private async callMistral'));
  assert.ok(/if \(!\(this\.isLocal && this\.isReasoningModel\(model\)\)\) body\.temperature = 0;/.test(compat),
    'local thinking models must not be pinned to temperature 0');
  const ollama = src.slice(src.indexOf('private async callOllama('));
  assert.ok(/\.\.\.\(isReasoning \? \{\} : \{ temperature: 0 \}\)/.test(ollama), 'ollama: same rule');
  // cloud providers are locked elsewhere (golden bodies) — this only guards the shared path.
  assert.ok(/deepseek/.test(src.toLowerCase()));
});

test('reasoning prior excludes instruct/no-think names', () => {
  const i = src.indexOf('private isReasoningModel');
  const body = src.slice(i, i + 400);
  assert.ok(/not\.\?think/.test(body), 'no-think names must not look like reasoning models');
});
