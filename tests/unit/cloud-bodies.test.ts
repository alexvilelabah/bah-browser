// Cloud request bodies must stay byte-identical while all the local-AI work lands.
//
// Runs with `node --test tests/unit/` — zero dependencies, no build, no Electron.
// The guard lives in scripts/golden-cloud-bodies.mjs; this file only asserts its
// verdict and keeps one housekeeping rule: the source stays free of marker comments.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, extractCloudBodies } from '../../scripts/golden-cloud-bodies.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('cloud provider request bodies match the golden file', () => {
  const r = check();
  assert.equal(r.missingGolden, false, 'tests/goldens/cloud-bodies.json is missing — run: node scripts/golden-cloud-bodies.mjs --write');
  assert.deepEqual(r.drift, [], 'cloud request bodies changed; cloud paths must stay byte-identical. Regenerate only with an explicit decision.');
});

test('no local-only knob appears in a cloud request body', () => {
  assert.deepEqual(check().leaks, []);
});

test('the four cloud providers are all still locked', () => {
  const bodies = extractCloudBodies(readFileSync(join(root, 'src', 'main', 'ai-engine.ts'), 'utf8'));
  assert.deepEqual(Object.keys(bodies).sort(), ['anthropic', 'deepseek', 'mistral', 'nvidia']);
  for (const [name, text] of Object.entries(bodies)) {
    assert.ok(text.includes('const body'), `${name}: body literal not located — the guard is checking nothing`);
    assert.ok(/max_tokens/.test(text), `${name}: no max_tokens in the locked span — the span is wrong`);
  }
});

test('source stays free of golden marker comments', () => {
  const src = readFileSync(join(root, 'src', 'main', 'ai-engine.ts'), 'utf8');
  assert.equal(/GOLDEN-(BEGIN|END)/.test(src), false, 'marker comments were rejected: locators must be structural, not annotations');
});
