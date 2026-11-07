// Captcha só pausa o agente em página-porteira de verdade, não por um widget de formulário
// opcional numa página de conteúdo (ex.: newsletter na página "thank you" de download).
import { test } from 'node:test';
import assert from 'node:assert';
import { diagnose } from '../../src/renderer/agent-recovery.ts';

const base = {
  goal: 'download AnyDesk for my machine', url: 'https://anydesk.com/en/downloads/thank-you?dv=mac_dmg',
  lastResult: { success: true }, lastActionType: 'click_text', noEffectCount: 0, stepsOnSameUrl: 1, step: 2,
  blockedDomains: new Set<string>(), popupCloseAttempts: 0, commandRequiresThisSite: true,
};
const longText = 'Thank You for Your Download! Would you like to try enhanced AnyDesk features? '.repeat(20);
const manyEls = Array.from({ length: 30 }, (_, i) => ({ id: i, tag: 'a', text: `link ${i}` }));
const recaptcha = { id: 99, tag: 'iframe', aria: 'reCAPTCHA' };

test('captcha widget in an optional form on a content page does not stop the agent', () => {
  const v = diagnose({ ...base, title: 'Thank you for downloading AnyDesk', textSample: longText, elements: [...manyEls, recaptcha] } as any);
  assert.notStrictEqual(v.blocker, 'captcha', JSON.stringify(v));
});

test('captcha widget on an interstitial gate still asks the user', () => {
  const v = diagnose({ ...base, title: 'anydesk.com', textSample: 'Please complete the security check to continue.', elements: [recaptcha] } as any);
  assert.strictEqual(v.blocker, 'captcha');
});

test('a challenge title always counts', () => {
  const v = diagnose({ ...base, title: 'Just a moment...', textSample: longText, elements: manyEls } as any);
  assert.strictEqual(v.blocker, 'captcha');
});
