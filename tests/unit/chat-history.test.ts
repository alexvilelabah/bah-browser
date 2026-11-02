// O que das conversas vai pro disco: a conversa viva (só volta com "Continuar de onde parou") e o
// 🕘 histórico de conversas (shared/chat-history.ts).
import { test } from 'node:test';
import assert from 'node:assert';
import {
  liveToSave, liveToRestore, sanitizeLive, historyEntryFor, upsertHistory, sanitizeHistory, historyRows,
  removeHistorySince, capHistory, MAX_HISTORY, type LiveTab, type ChatHistoryEntry,
} from '../../src/shared/chat-history.ts';
import { emptyThread, addTurn, addTask, type Thread } from '../../src/shared/thread-store.ts';
import type { AgentSession } from '../../src/shared/agent-sessions.ts';

const S = (id: string, name = 'Job hunt'): AgentSession => ({ id, name, color: 'blue', createdAt: 100 });
const th = (key: string, text = 'find a job', at = 200): Thread => addTurn(emptyThread(key, at), 'user', text, at);

test('live state: restore on → it comes back; off → nothing', () => {
  const live = { sessions: [S('s1')], threads: [th('s1')] };
  assert.equal(liveToRestore('newtab', live), null);
  assert.deepEqual(liveToRestore('restore', live), live);
  assert.equal(liveToRestore('restore', null), null);
  assert.equal(liveToRestore('restore', { sessions: [], threads: [] }), null);
});

test('live state saved: only threads of visible, non-incognito tabs; empty threads skipped', () => {
  const tabs: LiveTab[] = [
    { id: 't1', url: 'https://jobs.example/', sessionId: 's1' },
    { id: 't2', url: 'https://a.example/' },                          // tab without a session
    { id: 't3', url: 'https://secret.example/', sessionId: 's2', incognito: true },
    { id: 't4', url: 'https://work.example/', hidden: true, sessionId: 's3' },
  ];
  const r = liveToSave([th('s1'), th('t2'), th('s2'), th('s3'), emptyThread('t9')], [S('s1'), S('s2'), S('s3')], tabs);
  assert.deepEqual(r.sessions.map(s => s.id), ['s1']);
  assert.deepEqual(r.threads.map(t => t.key).sort(), ['s1', 't2']);
});

test('a session with any incognito tab never reaches the disk', () => {
  const tabs: LiveTab[] = [{ id: 't1', url: 'https://x.example/', sessionId: 's1' }, { id: 't2', url: '', sessionId: 's1', incognito: true }];
  assert.equal(liveToSave([th('s1')], [S('s1')], tabs).threads.length, 0);
  assert.equal(historyEntryFor(S('s1'), th('s1'), tabs), null);
});

test('history entry: name, colour, sites, first request, tabs', () => {
  let t = th('s1', 'find a golf job', 300);
  t = addTask(t, { goal: 'find a golf job', status: 'success', target: '"Caddie" on careers.golf.com' }, 400);
  const e = historyEntryFor(S('s1'), t, [{ id: 'a', url: 'https://www.linkedin.com/jobs', title: 'Jobs', sessionId: 's1' }, { id: 'b', url: 'https://x.example', sessionId: 'other' }])!;
  assert.equal(e.name, 'Job hunt');
  assert.equal(e.firstRequest, 'find a golf job');
  assert.deepEqual(e.sites, ['linkedin.com', 'careers.golf.com']);
  assert.deepEqual(e.tabs, [{ url: 'https://www.linkedin.com/jobs', title: 'Jobs' }]);
  assert.equal(historyEntryFor(S('s1'), emptyThread('s1'), []), null);
});

test('upsert: same session updates in place, newest first, closed tabs remembered', () => {
  const a = historyEntryFor(S('s1'), th('s1', 'one', 10), [{ id: 'x', url: 'https://a.example/', sessionId: 's1' }])!;
  const b = historyEntryFor(S('s2'), th('s2', 'two', 20), [])!;
  let list = upsertHistory(upsertHistory([], a), b);
  assert.deepEqual(list.map(e => e.id), ['s2', 's1']);
  const a2 = { ...historyEntryFor(S('s1'), addTurn(th('s1', 'one', 10), 'user', 'more', 30), [])!, endedAt: 30 };
  list = upsertHistory(list, a2);
  assert.deepEqual(list.map(e => e.id), ['s1', 's2']);
  assert.equal(list[0].tabs.length, 1);          // tabs kept from when it was open
  assert.equal(list[0].firstRequest, 'one');
});

test('caps: count and size', () => {
  const many: ChatHistoryEntry[] = [];
  for (let i = 0; i < MAX_HISTORY + 20; i++) many.push({ ...historyEntryFor(S(`s${i}`), th(`s${i}`), [])!, endedAt: i });
  const capped = capHistory(many);
  assert.equal(capped.length, MAX_HISTORY);
  assert.equal(capped[0].id, `s${MAX_HISTORY + 19}`);   // newest kept
  const big = many.slice(0, 5).map(e => ({ ...e, thread: { ...e.thread, summary: 'z'.repeat(600_000) } }));
  assert.ok(JSON.stringify(capHistory(big)).length <= 2_000_000);
});

test('sanitize from disk and list rows', () => {
  const good = historyEntryFor(S('s1'), th('s1'), [])!;
  const list = sanitizeHistory([good, null, { id: 5 }, { id: 'x', thread: null }, { ...good, id: 's9', color: 'neon', tabs: [{ url: 'javascript:alert(1)' }] }]);
  assert.equal(list.length, 2);
  assert.equal(list.find(e => e.id === 's9')!.color, 'grey');
  assert.equal(list.find(e => e.id === 's9')!.tabs.length, 0);
  assert.equal(historyRows(list)[0].turns, 1);
  assert.ok(!('thread' in historyRows(list)[0]));
  assert.deepEqual(sanitizeLive({ sessions: [{ id: 's1', name: 'A', color: 'red' }, { id: 's2', name: 'B', color: 'nope' }], threads: [th('s1'), 'junk'] }).sessions.map(s => s.id), ['s1']);
});

test('clear browsing data: by period, or everything', () => {
  const list = [10, 20, 30].map(n => ({ ...historyEntryFor(S(`s${n}`), th(`s${n}`), [])!, endedAt: n }));
  assert.deepEqual(removeHistorySince(list, 20).map(e => e.endedAt), [10]);
  assert.deepEqual(removeHistorySince(list, -Infinity), []);
});
