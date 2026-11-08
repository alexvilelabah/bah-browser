// Permissões do agente: abas da pessoa e histórico — perguntar / sempre / nunca.
import { test } from 'node:test';
import assert from 'node:assert';
import { getPerm, setPerm, nextMode, applyAnswer } from '../../src/renderer/agent-permissions.ts';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

test('defaults to ask; modes are independent per kind', () => {
  const s = mem();
  assert.strictEqual(getPerm('userTabs', s), 'ask');
  setPerm('history', 'allow', s);
  assert.strictEqual(getPerm('history', s), 'allow');
  assert.strictEqual(getPerm('userTabs', s), 'ask');
});

test('answers: once/deny do not change the preference; always/never save it', () => {
  const s = mem();
  assert.strictEqual(applyAnswer('userTabs', 'once', s), true);
  assert.strictEqual(getPerm('userTabs', s), 'ask');
  assert.strictEqual(applyAnswer('userTabs', 'deny', s), false);
  assert.strictEqual(getPerm('userTabs', s), 'ask');
  assert.strictEqual(applyAnswer('userTabs', 'always', s), true);
  assert.strictEqual(getPerm('userTabs', s), 'allow');
  assert.strictEqual(applyAnswer('history', 'never', s), false);
  assert.strictEqual(getPerm('history', s), 'deny');
});

test('menu cycles ask → allow → deny → ask; corrupt storage falls back to ask', () => {
  assert.deepStrictEqual([nextMode('ask'), nextMode('allow'), nextMode('deny')], ['allow', 'deny', 'ask']);
  const s = mem(); s.setItem('agentPerms', '{bad');
  assert.strictEqual(getPerm('history', s), 'ask');
});
