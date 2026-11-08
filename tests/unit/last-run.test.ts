// Pergunta sobre a última tarefa → chat com o resumo dela (não busca na web).
import { test } from 'node:test';
import assert from 'node:assert';
import { isAboutLastRun, lastRunDigest, reportsIncompleteRun, type RunFeedItem } from '../../src/renderer/last-run.ts';

test('questions about the last run are recognised; new requests and general questions are not', () => {
  for (const q of ['did you click, or block it ?', 'why did you stop?', 'what happened?', 'did it work?', 'was that blocked?', 'você clicou?', 'o que aconteceu?'])
    assert.ok(isAboutLastRun(q), q);
  for (const q of ['what is the capital of France?', 'find a job on indeed', 'how do I apply for a visa?', 'click the second job'])
    assert.ok(!isAboutLastRun(q), q);
});

test('digest covers only the last task: request, steps, Bah notes and how it ended', () => {
  const feed: RunFeedItem[] = [
    { kind: 'task', text: 'an older task' },
    { kind: 'report', text: 'old result' },
    { kind: 'task', text: 'click the Brelle listing' },
    { kind: 'event', event: { kind: 'action', action: { type: 'click_ref', ref: 32 } } },
    { kind: 'step', step: { actionLabel: 'click_ref(@32)', success: false, urlAfter: 'https://www.linkedin.com/jobs/' } },
    { kind: 'event', event: { kind: 'status', message: '🛡️ linkedin.com forbids automated browsing — "click_ref" is not done automatically on this site.' } },
    { kind: 'error', text: 'linkedin.com is in careful mode: no clicking or typing.' },
  ];
  const d = lastRunDigest(feed, a => `${(a as any).type}(@${(a as any).ref})`);
  assert.match(d, /The user asked: "click the Brelle listing"/);
  assert.match(d, /tried: click_ref\(@32\)/);
  assert.match(d, /step: click_ref\(@32\) → FAILED/);
  assert.match(d, /forbids automated browsing/);
  assert.match(d, /Ended with: linkedin\.com is in careful mode/);
  assert.match(d, /Last page: https:\/\/www\.linkedin\.com\/jobs\//);
  assert.match(d, /Do not search the web/);
  assert.doesNotMatch(d, /older task|old result/);
});

test('no task in the feed → no digest (the question goes the normal way)', () => {
  assert.equal(lastRunDigest([{ kind: 'chat-user', text: 'hi' }], () => ''), '');
});

test('a report that the last task fell short goes back to the agent (not a question)', () => {
  for (const m of ['one window was opened, but not the second.', 'you only opened one', "it didn't open the second video", 'wrong video', 'só abriu um', 'mas não o segundo'])
    assert.ok(reportsIncompleteRun(m), m);
  for (const m of ['did it open both?', 'open the second one', 'thanks, looks good', 'what is a window manager'])
    assert.ok(!reportsIncompleteRun(m), m);
});
