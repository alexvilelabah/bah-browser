// Preenchimento por código: campo → perfil, respostas salvas, currículo; autoidentificação → recusar.
import { test } from 'node:test';
import assert from 'node:assert';
import { classifyField, pickOption, planFill, questionKey } from '../../src/shared/form-fill.ts';

const c = (label: string, extra: any = {}) => classifyField({ label, type: 'text', ...extra });

test('labels, names and autocomplete map to profile items', () => {
  assert.strictEqual(c('First Name*'), 'firstName');
  assert.strictEqual(c('Preferred First Name'), 'preferredName');
  assert.strictEqual(c('Last name'), 'lastName');
  assert.strictEqual(c('Name'), 'fullName');
  assert.strictEqual(c('Full legal name'), 'fullName');
  assert.strictEqual(c('Email address'), 'email');
  assert.strictEqual(c('anything', { type: 'tel' }), 'phone');
  assert.strictEqual(c('x', { autocomplete: 'given-name' }), 'firstName');
  assert.strictEqual(c('LinkedIn Profile'), 'linkedin');
  assert.strictEqual(c('Website'), 'website');
  assert.strictEqual(c('Are you legally authorized to work in the United States?'), 'workAuthorized');
  assert.strictEqual(c('Will you now or in the future require sponsorship for employment visa status?'), 'needsSponsorship');
  assert.strictEqual(c('How did you hear about us?'), 'howHeard');
  assert.strictEqual(c('Gender'), 'voluntary');
  assert.strictEqual(c('Are you Hispanic/Latino?'), 'voluntary');
  assert.strictEqual(c('Why do you want to work at Serve Robotics?'), null);
  assert.strictEqual(c('', { name: 'job_application[first_name]' }), 'firstName');
});

test('options: yes/no, decline variants, exact text', () => {
  assert.strictEqual(pickOption(['Yes', 'No'], 'no'), 1);
  assert.strictEqual(pickOption(['Male', 'Female', 'Decline to self-identify'], 'decline'), 2);
  assert.strictEqual(pickOption(['I am a protected veteran', 'I am not a protected veteran', "I don't wish to answer"], 'decline'), 2);
  assert.strictEqual(pickOption(['United States', 'Canada'], 'United States'), 0);
  assert.strictEqual(pickOption(['A', 'B'], 'zzz'), -1);
});

test('plan: profile first, then saved answers, then résumé facts; the rest is missing', () => {
  const fields = [
    { idx: 0, label: 'Name', type: 'text', required: true },
    { idx: 1, label: 'Email', type: 'email', required: true },
    { idx: 2, label: 'Phone', type: 'tel' },
    { idx: 3, label: 'Resume', type: 'file', required: true },
    { idx: 4, label: 'Have you read the job description?', type: 'radio', required: true, options: ['I read this', 'I did not read this'] },
    { idx: 5, label: 'Gender', type: 'radio', options: ['Male', 'Female', 'Decline to self-identify'] },
    { idx: 6, label: 'Will you require sponsorship?', type: 'select', options: ['Select…', 'Yes', 'No'] },
    { idx: 7, label: 'Why us?', type: 'textarea', required: true },
    { idx: 8, label: 'LinkedIn', type: 'url', filled: true },
  ];
  const r = planFill(fields, { email: 'pat@example.com', needsSponsorship: 'no' }, { [questionKey('Have you read the job description?')]: 'I read this' }, { name: 'Pat Example', phone: '(555) 010-0100' });
  const by = Object.fromEntries(r.fill.map(d => [d.idx, d]));
  assert.deepStrictEqual(by[0], { idx: 0, label: 'Name', value: 'Pat Example', source: 'resume' });
  assert.deepStrictEqual(by[1], { idx: 1, label: 'Email', value: 'pat@example.com', source: 'profile' });
  assert.strictEqual(by[2].value, '(555) 010-0100');
  assert.deepStrictEqual(by[4], { idx: 4, label: 'Have you read the job description?', option: 0, source: 'saved' });
  assert.deepStrictEqual(by[5], { idx: 5, label: 'Gender', option: 2, source: 'voluntary' });
  assert.deepStrictEqual(by[6], { idx: 6, label: 'Will you require sponsorship?', option: 2, source: 'profile' });
  assert.ok(!by[3] && !by[8], 'file and already-filled fields are left alone');
  assert.deepStrictEqual(r.missing.map(f => f.idx), [7]);
});

test('voluntary: "ask" leaves it for the user', () => {
  const r = planFill([{ idx: 0, label: 'Veteran status', type: 'radio', options: ['Yes', 'No', 'Decline'] }], { voluntary: 'ask' });
  assert.deepStrictEqual(r.missing.map(f => f.idx), [0]);
});
