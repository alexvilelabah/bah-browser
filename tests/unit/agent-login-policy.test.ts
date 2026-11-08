// Parede de login numa tarefa que precisa da conta da pessoa: Bah pausa e ela entra (o agente nunca digita senha).
import { test } from 'node:test';
import assert from 'node:assert';
import { commandLikelyNeedsAccount, detectManualHelpNeed, accountStateOf, noteAccountState, accountStateLine, resetAccountStates } from '../../src/renderer/agent-login-policy.ts';

const page = (url: string, title: string, els: Array<{ tag: string; text?: string; placeholder?: string; aria?: string }>, text = '') => ({
  url, title, text_sample: text,
  interactive_elements: els.map((e, i) => ({ id: i + 1, x: 0, y: 0, w: 10, h: 10, text: '', ...e })),
});

test('"top of my list" / "my jobs" need the account; "my downloads" does not', () => {
  assert.ok(commandLikelyNeedsAccount('browse to linkedin, find a job that\'s top of my list, and begin the application'));
  assert.ok(commandLikelyNeedsAccount('open my saved jobs on indeed'));
  assert.ok(!commandLikelyNeedsAccount('find the ubuntu iso in my downloads'));
  assert.ok(!commandLikelyNeedsAccount('search for running shoes'));
});

test('a password field on an account task pauses at once (no stuck steps needed)', () => {
  const login = page('https://example.com/jobs', 'Example', [
    { tag: 'input', placeholder: 'Email or phone' }, { tag: 'input', aria: 'Password' }, { tag: 'button', text: 'Sign in' },
  ]);
  const r = detectManualHelpNeed('find a job at the top of my list', login, 0, 0);
  assert.equal(r?.kind, 'login');
  assert.match(r!.instruction, /saved in Bah's password manager/);
  assert.match(r!.instruction, /never see your password/);
});

test('the same login form on a public task does not pause', () => {
  const login = page('https://example.com/', 'Example', [{ tag: 'input', aria: 'Password' }]);
  assert.equal(detectManualHelpNeed('search for running shoes', login, 0, 0), null);
});

test('already signed in (Sign out visible) does not pause', () => {
  const home = page('https://example.com/login', 'Example', [{ tag: 'input', aria: 'Password' }, { tag: 'a', text: 'Sign out' }]);
  assert.equal(detectManualHelpNeed('open my saved jobs', home, 0, 0), null);
});

test('account state: Sign in / Join now buttons = signed out; Me / Sign out = signed in; unclear = null', () => {
  assert.equal(accountStateOf(page('https://www.linkedin.com/', 'Log In or Sign Up | LinkedIn', [{ tag: 'a', text: 'Join now' }, { tag: 'a', text: 'Sign in' }])), 'signed-out');
  assert.equal(accountStateOf(page('https://www.linkedin.com/feed/', 'Feed | LinkedIn', [{ tag: 'button', text: 'Me' }, { tag: 'a', text: 'Jobs' }])), 'signed-in');
  assert.equal(accountStateOf(page('https://x.com/a', 'Article', [{ tag: 'a', text: 'Read more' }])), null);
  assert.equal(accountStateOf(page('https://x.com/login', 'Login', [{ tag: 'input', aria: 'Password' }])), 'signed-out');
});

test('account state carries per site across steps until the page shows otherwise', () => {
  resetAccountStates();
  noteAccountState(page('https://www.linkedin.com/', 'LinkedIn', [{ tag: 'a', text: 'Sign in' }]));
  // a página seguinte não diz nada → segue "signed out"
  assert.equal(noteAccountState(page('https://www.linkedin.com/jobs', 'Jobs', [{ tag: 'a', text: 'Jobs' }])), 'signed-out');
  assert.match(accountStateLine(page('https://www.linkedin.com/jobs', '', [])), /signed out on linkedin\.com/);
  // a pessoa entrou → passa a "signed in"
  assert.equal(noteAccountState(page('https://www.linkedin.com/feed/', 'Feed', [{ tag: 'button', text: 'Me' }])), 'signed-in');
  // outro site não herda
  assert.equal(accountStateLine(page('https://www.indeed.com/', '', [])), '');
});

test('signed in (Me in the nav): "Premium" on the page is not a paywall', () => {
  const feed = page('https://www.linkedin.com/feed/', '(28) Feed | LinkedIn', [{ tag: 'button', text: 'Me' }, { tag: 'a', text: 'Your Premium features' }, { tag: 'a', text: 'Jobs' }], 'Premium Profile viewers 110');
  assert.equal(detectManualHelpNeed('find a job that is top of my list', feed, 3, 3), null);
});
