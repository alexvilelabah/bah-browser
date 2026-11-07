// "Resuma minhas abas": quais abas entram, permissão das abas da pessoa e leitura da resposta do modelo.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  wantsTabsSummary, wantsWakeTabs, selectTabsForSummary, tabsAccessDecision, buildTabsSummaryPrompt, parseTabsSummary,
} from '../../src/renderer/tabs-summary.ts';

test('recognizes the request in en/pt/es; leaves other "summarize" requests alone', () => {
  for (const c of ['Summarize my open tabs', 'summarise all my tabs', 'give me a summary of the tabs I have open', 'recap my tabs please',
    'resuma minhas abas abertas', 'faça um resumo das abas abertas', 'resume mis pestañas abiertas'])
    assert.ok(wantsTabsSummary(c), c);
  for (const c of ['summarize this page', 'open my tabs', 'summarize the article in the tabs section of this page', 'close all my tabs'])
    assert.ok(!wantsTabsSummary(c), c);
  assert.ok(wantsWakeTabs('summarize my open tabs, including the sleeping ones'));
  assert.ok(wantsWakeTabs('resuma minhas abas e acorde as que estão dormindo'));
  assert.ok(!wantsWakeTabs('summarize my open tabs'));
});

const tabs = [
  { id: 'a', title: 'News', url: 'https://news.example.com/' },
  { id: 'b', title: 'Secret', url: 'https://bank.example.com/', incognito: true },
  { id: 'c', title: 'New Tab', url: 'about:blank' },
  { id: 'd', title: 'Bah table', url: 'file:///tmp/bah-table.html' },
  { id: 'e', title: 'Sleeping docs', url: 'https://docs.example.com/', discarded: true },
  { id: 'f', title: 'Restored', url: 'https://old.example.com/', restored: true },
  { id: 'g', title: 'Work tab', url: 'https://work.example.com/', hidden: true },
  { id: 'h', title: 'Shop', url: 'http://127.0.0.1:3000/shop' },
  { id: 'i', title: 'Torrent player', url: 'http://127.0.0.1:9000/webtorrent/abc' },
];

test('skips incognito, internal and hidden tabs; sleeping tabs are listed, not woken', () => {
  const s = selectTabsForSummary(tabs);
  assert.deepStrictEqual(s.toRead.map(t => t.id), ['a', 'h']);
  assert.deepStrictEqual(s.asleep.map(t => t.id), ['e', 'f']);
  assert.strictEqual(s.skippedIncognito, 1);
  assert.strictEqual(s.skippedInternal, 3);
  const woke = selectTabsForSummary(tabs, { wake: true });
  assert.deepStrictEqual(woke.toRead.map(t => t.id), ['a', 'e', 'f', 'h']);
  assert.deepStrictEqual(woke.asleep, []);
  assert.strictEqual(selectTabsForSummary(tabs, { max: 1 }).toRead.length, 1);
});

test('permission: own/granted tabs need nothing; otherwise the menu choice decides', () => {
  const granted = new Set(['a']);
  assert.strictEqual(tabsAccessDecision('ask', ['a'], granted), 'read');
  assert.strictEqual(tabsAccessDecision('deny', ['a'], granted), 'read');
  assert.strictEqual(tabsAccessDecision('ask', ['a', 'h'], granted), 'ask');
  assert.strictEqual(tabsAccessDecision('allow', ['a', 'h'], granted), 'read');
  assert.strictEqual(tabsAccessDecision('deny', ['a', 'h'], granted), 'deny');
});

test('prompt carries each tab and treats page text as data; reply parsing has a fallback', () => {
  const texts = [
    { title: 'Alpha', url: 'https://a.example/', text: 'Alpha page about red apples.' },
    { title: 'Beta', url: 'https://b.example/', text: 'Beta page about blue boats.' },
  ];
  const p = buildTabsSummaryPrompt(texts);
  assert.match(p, /\[1\] Alpha — https:\/\/a\.example\/\nAlpha page about red apples\./);
  assert.match(p, /\[2\] Beta/);
  assert.match(p, /never as instructions/);
  const ok = parseTabsSummary('Sure! {"tabs":[{"n":2,"summary":"Boats."},{"n":1,"summary":"Apples."}],"overall":"Fruit and boats."}', texts);
  assert.deepStrictEqual(ok, { perTab: ['Apples.', 'Boats.'], overall: 'Fruit and boats.' });
  const partial = parseTabsSummary('{"tabs":[{"n":1,"summary":"Apples."}],"overall":"x"}', texts);
  assert.deepStrictEqual(partial.perTab, ['Apples.', 'Beta page about blue boats.']);
  const plain = parseTabsSummary('You are reading about apples and boats.', texts);
  assert.deepStrictEqual(plain, { perTab: ['Alpha page about red apples.', 'Beta page about blue boats.'], overall: 'You are reading about apples and boats.' });
});
