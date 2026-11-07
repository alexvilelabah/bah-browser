// Sessões do agente na barra de abas (shared/agent-sessions.ts).
import { test } from 'node:test';
import assert from 'node:assert';
import {
  threadKey, pickSessionColor, sessionNameFor, uniqueSessionName, joinSession, leaveSession,
  sessionAfterMove, chipStarts, liveSessions, SESSION_COLORS, type AgentSession,
} from '../../src/shared/agent-sessions.ts';

const T = (id: string, sessionId?: string, extra: object = {}) => ({ id, ...(sessionId ? { sessionId } : {}), ...extra });
const ids = (tabs: Array<{ id: string }>) => tabs.map(t => t.id).join(',');

test('thread key: the session, or the tab itself when it has none', () => {
  assert.equal(threadKey(T('a')), 'a');
  assert.equal(threadKey(T('b', 'a')), 'a');
});

test('colour: first unused one; all used → the least used', () => {
  assert.equal(pickSessionColor([]), 'blue');
  assert.equal(pickSessionColor(['blue', 'red']), 'yellow');
  const all = [...SESSION_COLORS, 'blue', 'red'];
  assert.equal(pickSessionColor(all), 'yellow');
});

test('name from the first request', () => {
  assert.equal(sessionNameFor("browse to linkedin, find a job that's top of my list"), 'Job hunt');
  assert.equal(sessionNameFor('add bananas to my Walmart cart'), 'Groceries');
  assert.equal(sessionNameFor('find a hotel in Lisbon for May'), 'Trip');
  assert.equal(sessionNameFor('open github.com/beadon'), 'Github');
  assert.equal(sessionNameFor('summarize quantum computing basics'), 'Summarize Quantum');
  assert.equal(sessionNameFor('', 'https://www.wikipedia.org/wiki/X'), 'Wikipedia');
  assert.equal(uniqueSessionName('Job hunt', ['Job hunt']), 'Job hunt 2');
  assert.equal(uniqueSessionName('Job hunt', ['Job hunt', 'Job hunt 2']), 'Job hunt 3');
});

test('joining moves the tab next to the session\'s other tabs (never into the pinned area)', () => {
  const tabs = [T('p', undefined, { pinned: true }), T('a', 'a'), T('x'), T('b', 'a'), T('y'), T('z')];
  assert.equal(ids(joinSession(tabs, 'z', 'a')), 'p,a,x,b,z,y');
  assert.equal(joinSession(tabs, 'z', 'a').find(t => t.id === 'z')!.sessionId, 'a');
  // first tab of a brand-new session stays put
  assert.equal(ids(joinSession(tabs, 'y', 'new')), ids(tabs));
  // a pinned tab keeps its place
  assert.equal(ids(joinSession(tabs, 'p', 'a')), ids(tabs));
});

test('leaving: out of the middle of the group → right after it', () => {
  const tabs = [T('a', 's'), T('b', 's'), T('c', 's'), T('d')];
  const out = leaveSession(tabs, 'b');
  assert.equal(ids(out), 'a,c,b,d');
  assert.equal(out.find(t => t.id === 'b')!.sessionId, undefined);
  assert.equal(ids(leaveSession(tabs, 'c')), ids(tabs));   // already at the edge
});

test('drag: dropped between two tabs of a session → joins; dragged away from its session → leaves', () => {
  assert.equal(sessionAfterMove([T('a', 's'), T('x'), T('b', 's')], 'x').find(t => t.id === 'x')!.sessionId, 's');
  assert.equal(sessionAfterMove([T('a', 's'), T('b', 's'), T('y'), T('c', 's')], 'c').find(t => t.id === 'c')!.sessionId, undefined);
  // still touching its session → stays
  assert.equal(sessionAfterMove([T('a', 's'), T('b', 's'), T('y')], 'b').find(t => t.id === 'b')!.sessionId, 's');
  // the only tab of its session stays in it wherever it goes
  assert.equal(sessionAfterMove([T('y'), T('a', 'a'), T('z')], 'a').find(t => t.id === 'a')!.sessionId, 'a');
});

test('chips go before the first tab of each run; empty sessions disappear', () => {
  assert.deepEqual([...chipStarts([T('a', 's'), T('b', 's'), T('c'), T('d', 't'), T('e', 's')])], ['a', 'd', 'e']);
  const s = (id: string): AgentSession => ({ id, name: id, color: 'blue', createdAt: 0 });
  assert.deepEqual(liveSessions([s('s'), s('gone')], [T('a', 's')]).map(x => x.id), ['s']);
});
