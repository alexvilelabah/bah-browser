// Página que proíbe scripts: o leitor do Bah cai pro mundo isolado — mas um erro de verdade do script
// é repassado e o script NUNCA roda duas vezes.
import { test } from 'node:test';
import assert from 'node:assert';
import { withIsolatedFallback } from '../../src/renderer/page-eval.ts';

const fail = () => Promise.reject(new Error('Script failed to execute, this normally means an error was thrown.'));

test('page allows scripts: runs in the page world only', async () => {
  const calls: string[] = [];
  const ev = withIsolatedFallback(async c => { calls.push('main:' + c); return 1; }, async c => { calls.push('iso:' + c); return 2; }, () => 'https://a/');
  assert.equal(await ev('x'), 1);
  assert.deepEqual(calls, ['main:x']);
});

test('page blocks scripts (CSP sandbox): falls back to the isolated world and remembers it per address', async () => {
  const calls: string[] = [];
  let url = 'https://hf.co/README.md';
  const ev = withIsolatedFallback(c => { calls.push('main:' + c); return fail(); }, async c => { calls.push('iso:' + c); return 'text'; }, () => url);
  assert.equal(await ev('read'), 'text');
  assert.deepEqual(calls, ['main:read', 'main:0', 'iso:read']);
  calls.length = 0;
  assert.equal(await ev('again'), 'text');
  assert.deepEqual(calls, ['iso:again']);            // no more probing on the same address
  calls.length = 0;
  url = 'https://example.com/';                        // navigated away → page world first again
  await ev('next');
  assert.deepEqual(calls, ['main:next', 'main:0', 'iso:next']);
});

test('a script that really throws is passed through, not re-run in the isolated world', async () => {
  const calls: string[] = [];
  const ev = withIsolatedFallback(c => { calls.push('main:' + c); return c === '0' ? Promise.resolve(0) : fail(); }, async c => { calls.push('iso:' + c); return 'x'; }, () => 'https://a/');
  await assert.rejects(ev('click()'), /Script failed/);
  assert.deepEqual(calls, ['main:click()', 'main:0']);
});
