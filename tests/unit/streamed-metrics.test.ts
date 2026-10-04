// Streamed metrics exist end-to-end (engine -> IPC -> preload -> UI) and stay
// honest: estimated from characters until the usage chunk makes them exact.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rd = (p: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', p), 'utf8');

// The meter's behaviour is tested in stream-clocks.test.ts; here only the wiring.
test('engine reports metrics from both local streamed paths', () => {
  const src = rd('src/main/ai-engine.ts');
  assert.ok(/onMetrics\?: \(m: AiMetrics\) => void/.test(src), 'engine must expose onMetrics');
  assert.equal((src.match(/const live = this\.liveMeter\(\);/g) || []).length, 2, 'compat and Ollama both meter');
  assert.equal((src.match(/live\.done\(metrics\.usage\)/g) || []).length, 2, 'both report the final, exact numbers');
});

// Streaming turns on only when a delta sink is passed. The agent path passed none, so local
// agent steps never streamed: no first-token clock, no thinking budget, no live tok/s.
test('local agent steps pass a stream sink (cloud passes none)', () => {
  const src = rd('src/main/ai-engine.ts');
  const gen = src.slice(src.indexOf('async generateAction('), src.indexOf('private async callLLM('));
  assert.ok(/const streamSink = this\.isLocal \? \(_d: string\) => \{\} : undefined;/.test(gen), 'sink must exist for local only');
  assert.ok(/this\.callLLM\(msgs, true, tier, streamSink, signal\)/.test(gen), 'the agent call must pass it');
});

test('the metric crosses the IPC boundary on a documented channel', () => {
  const main = rd('src/main/main.ts');
  const preload = rd('src/preload/preload.ts');
  assert.ok(/webContents\.send\('ai:action-delta', m\)/.test(main), 'main must forward engine metrics');
  assert.ok(/attachLocalMetrics\(localEngine\)/.test(main), 'the local engine must actually be attached');
  assert.ok(/ipcRenderer\.on\('ai:action-delta', listener\)/.test(preload), 'preload must listen on the same channel');
});

test('the UI shows tokens and rate, and every language has the label', () => {
  const overlay = rd('src/renderer/components/AgentVisualOverlay.tsx');
  assert.ok(/tokPerSec\} tok\/s/.test(overlay), 'UI must show the rate');
  const i18n = rd('src/renderer/i18n.ts');
  for (const key of ["'overlay.thinking'", "'overlay.writing'"]) {
    assert.equal((i18n.match(new RegExp(key.replace('.', '\\.'), 'g')) || []).length, 3, `${key} needs en/pt/es`);
  }
});
