import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

// Preferência de buscador do AGENTE x mecanismo da barra (⋮): chaves separadas, uma não apaga a outra.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};
(globalThis as any).window = Object.assign(globalThis, { addEventListener() {}, removeEventListener() {} });
// search-engines.ts puxa a UI (i18n, região): empacota com esbuild, como quick-video.test.ts.
const ROOT = path.resolve(import.meta.dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-sp-'));
const out = path.join(dir, 'out.mjs');
buildSync({ entryPoints: [path.join(ROOT, 'src/renderer/search-engines.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
const { preferredEngine, setPreferredEngine } = await import(pathToFileURL(out).href) as typeof import('../../src/renderer/search-engines.ts');

test('agent preference has its own key and never overwrites the address-bar engine', () => {
  store.clear();
  store.set('searchEngine', JSON.stringify({ id: 'duckduckgo' }));
  assert.equal(preferredEngine(), 'duckduckgo');            // follows the ⋮ choice when unset
  setPreferredEngine('bing');
  assert.equal(preferredEngine(), 'bing');
  assert.equal(store.get('searchEngine'), JSON.stringify({ id: 'duckduckgo' }));   // bar setting untouched
  setPreferredEngine('auto');
  assert.equal(store.has('agentSearchEngine'), false);
});

test('an old plain value under the shared key is migrated once', () => {
  store.clear();
  store.set('searchEngine', 'bing');
  assert.equal(preferredEngine(), 'bing');
  assert.equal(store.get('agentSearchEngine'), 'bing');
  assert.equal(store.has('searchEngine'), false);
});
