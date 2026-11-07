// Roteador: ordem imperativa no começo → agente (não a Pesquisa Rápida).
import { test } from 'node:test';
import assert from 'node:assert';
import { startsWithActionVerb } from '../../src/renderer/route-words.ts';

test('leading action verbs are actions; questions and "find out" are not', () => {
  for (const m of ['search for a set of new golf clubs', 'Search for a set of new golf blubs', 'find me a hotel in Lisbon', 'look up the Acme store hours',
    'shop for running shoes', 'please search for a standing desk', 'browse to linkedin', 'procure tênis de corrida', 'pesquise passagens para Lisboa'])
    assert.ok(startsWithActionVerb(m), m);
  for (const m of ['what is the best golf club for beginners?', 'find out who won the open', 'how do I search on linkedin', 'golf clubs', 'searching is hard'])
    assert.ok(!startsWithActionVerb(m), m);
});
