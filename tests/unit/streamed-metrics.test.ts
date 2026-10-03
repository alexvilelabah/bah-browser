// C6: streamed metrics must exist end-to-end (engine -> IPC -> preload -> UI) and stay
// honest: estimated from characters until the usage chunk makes them exact.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rd = (p: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', p), 'utf8');

test('engine reports metrics, throttled, exact once usage arrives', () => {
  const src = rd('src/main/ai-engine.ts');
  assert.ok(/onMetrics\?: \(m: AiMetrics\) => void/.test(src), 'engine must expose onMetrics');
  assert.ok(/if \(!exact && now - this\.lastMetricsAt < 1000\) return;/.test(src), 'must be throttled to ~1/s, not per token');
  assert.ok(/emitMetrics\('thinking'/.test(src), 'thinking deltas must report');
  assert.ok(/emitMetrics\('answer'/.test(src), 'the answer must report');
  assert.ok(/exact: boolean/.test(src), 'the UI must know when a number is only an estimate');
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
