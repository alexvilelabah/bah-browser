// site-knowledge.ts: atalho local pro site nomeado (lista curada).
// site-knowledge importa a UI (i18n, localStorage) → empacota com esbuild.
import { test } from 'node:test';
import assert from 'node:assert';
import { buildSync } from 'esbuild';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve(import.meta.dirname, '../..');
async function load() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-ns-'));
  const entry = path.join(dir, 'entry.ts');
  fs.writeFileSync(entry, `(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
(globalThis as any).window = Object.assign(globalThis, { addEventListener() {}, removeEventListener() {} });
export const { getInitialShortcutAction, detectQuickAction, buildKnownSitesBlock } = await import(${JSON.stringify(path.join(ROOT, 'src/renderer/site-knowledge.ts'))});`);
  const out = path.join(dir, 'out.mjs');
  buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
  return (await import(pathToFileURL(out).href)) as any;
}

test('fast path opens the official site of a named site; unknown names and explicit URLs are left to the agent', async () => {
  const { getInitialShortcutAction } = await load();
  assert.deepStrictEqual(getInitialShortcutAction('browse to linkedin, find a job as a nurse in Seattle')?.action, { type: 'navigate', url: 'https://www.linkedin.com/' });
  assert.deepStrictEqual(getInitialShortcutAction('go to walmart and find a cheap TV')?.action, { type: 'navigate', url: 'https://www.walmart.com/' });
  assert.deepStrictEqual(getInitialShortcutAction('find a remote job on indeed')?.action, { type: 'navigate', url: 'https://www.indeed.com/' });
  assert.strictEqual(getInitialShortcutAction('browse to zorblax, find a job as a nurse'), null);
  assert.strictEqual(getInitialShortcutAction('this is indeed a good laptop'), null);
  assert.strictEqual(getInitialShortcutAction('go to jobs.example.org and look at linkedin openings'), null);
});

test('known-sites block tells the model to navigate directly', async () => {
  const { buildKnownSitesBlock } = await load();
  const b = buildKnownSitesBlock();
  assert.match(b, /OFFICIAL SITES/);
  assert.match(b, /linkedin: https:\/\/www\.linkedin\.com\//);
  assert.match(b, /do not web_search its name/);
});
