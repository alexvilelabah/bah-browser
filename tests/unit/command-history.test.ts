// Histórico ↑/↓ da caixa da IA.
import { test } from 'node:test';
import assert from 'node:assert';
import { CommandHistory } from '../../src/renderer/command-history.ts';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
}

test('up walks back from newest to oldest and stops there', () => {
  const h = new CommandHistory(mem());
  h.push('one'); h.push('two'); h.push('three');
  assert.strictEqual(h.up(''), 'three');
  assert.strictEqual(h.up(''), 'two');
  assert.strictEqual(h.up(''), 'one');
  assert.strictEqual(h.up(''), null);
});

test('down walks forward and past the newest restores the draft', () => {
  const h = new CommandHistory(mem());
  h.push('one'); h.push('two');
  assert.strictEqual(h.up('half typed'), 'two');
  assert.strictEqual(h.up('two'), 'one');
  assert.strictEqual(h.down(), 'two');
  assert.strictEqual(h.down(), 'half typed');
  assert.strictEqual(h.browsing, false);
  assert.strictEqual(h.down(), null);
});

test('consecutive duplicates and blanks are not stored', () => {
  const h = new CommandHistory(mem());
  h.push('a'); h.push('a'); h.push('  '); h.push('b'); h.push('a');
  assert.deepStrictEqual([h.up(''), h.up(''), h.up(''), h.up('')], ['a', 'b', 'a', null]);
});

test('editing resets navigation; empty history returns null', () => {
  const h = new CommandHistory(mem());
  assert.strictEqual(h.up('x'), null);
  h.push('a'); h.push('b');
  h.up(''); h.up('');
  h.reset();
  assert.strictEqual(h.up(''), 'b');
});

test('persists across instances and keeps only the last 100', () => {
  const s = mem();
  const h = new CommandHistory(s);
  for (let i = 0; i < 120; i++) h.push('cmd ' + i);
  const h2 = new CommandHistory(s);
  assert.strictEqual(h2.up(''), 'cmd 119');
  let last = '', n = 1;
  for (let r = h2.up(''); r !== null; r = h2.up('')) { last = r; n++; }
  assert.strictEqual(n, 100);
  assert.strictEqual(last, 'cmd 20');
});

test('corrupt storage is ignored', () => {
  const s = mem(); s.setItem('cmdHistory', '{not json');
  const h = new CommandHistory(s);
  assert.strictEqual(h.up(''), null);
});
