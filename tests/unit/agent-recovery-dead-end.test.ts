// "Get the app" numa página curta é beco sem saída numa tarefa comum (vai pro app em vez do conteúdo) — mas
// numa tarefa de BAIXAR é exatamente o objetivo: o agente não pode voltar dessa página.
import { test } from 'node:test';
import assert from 'node:assert';
import { diagnose } from '../../src/renderer/agent-recovery.ts';

const page = {
  url: 'https://example.com/', title: 'Get the app', textSample: 'Get the app. Our app is the best way to use Example. Download for Mac or Windows.',
  elements: [{ id: 1, tag: 'a', text: 'Download for Mac' }, { id: 2, tag: 'a', text: 'Download for Windows' }, { id: 3, tag: 'a', text: 'Home' }],
  lastResult: { success: true }, lastActionType: 'navigate', noEffectCount: 0, stepsOnSameUrl: 1, step: 1,
  blockedDomains: new Set<string>(), popupCloseAttempts: 0, commandRequiresThisSite: false,
};

test('an app-download page is not a dead end in a download task', () => {
  const v = diagnose({ ...page, goal: 'download the app for my mac from this page', commandWantsDownload: true } as any);
  assert.notStrictEqual(v.decision, 'go_back', JSON.stringify(v));
  assert.notStrictEqual(v.blocker, 'dead_end');
});

test('the same "get the app" interstitial is still a dead end for a reading task', () => {
  const v = diagnose({ ...page, goal: 'read the article on this page', commandWantsDownload: false } as any);
  assert.strictEqual(v.blocker, 'dead_end', JSON.stringify(v));
});
