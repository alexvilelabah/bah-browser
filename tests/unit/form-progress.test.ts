// Lista do formulário: o que falta, com o caminho de cada tipo (currículo, autoidentificação, escolha).
import { test } from 'node:test';
import assert from 'node:assert';
import { formatFormProgress } from '../../src/renderer/form-progress.ts';

const ashby = [
  { label: 'Name', kind: 'text' as const, required: true, done: true },
  { label: 'Email', kind: 'text' as const, required: true, done: false },
  { label: 'Resume', kind: 'file' as const, required: true, done: false },
  { label: 'Have you read the job description?', kind: 'choice' as const, required: true, done: false, options: ['I read this', 'I did not read this'] },
  { label: 'Gender', kind: 'choice' as const, required: false, done: false, options: ['Male', 'Female', 'Decline to self-identify'] },
];

test('lists done and missing fields with what to do for each', () => {
  const b = formatFormProgress(ashby);
  assert.match(b, /APPLICATION FORM on this page — 1 of 5 done/);
  assert.match(b, /✓ Name \(required\)\n/);
  assert.match(b, /✗ Email \(required\) → fill from the résumé\/request; not in them → ask the user/);
  assert.match(b, /✗ Resume \(required\) → upload the résumé/);
  assert.match(b, /✗ Have you read the job description\? \(required\) → choose one: "I read this" \/ "I did not read this"/);
  assert.match(b, /✗ Gender → voluntary: pick "Decline to self-identify"/);
  assert.match(b, /Do not invent fields/);
});

test('all done → submit; tiny or empty forms → nothing', () => {
  const b = formatFormProgress(ashby.map(f => ({ ...f, done: true })));
  assert.match(b, /everything listed is done\. Check it, then click the submit button/);
  assert.strictEqual(formatFormProgress([ashby[0]]), '');
  assert.strictEqual(formatFormProgress([]), '');
});

test('before any résumé is read, the checklist says to read it first', () => {
  const b = formatFormProgress(ashby, false);
  assert.match(b, /FIRST: you have not read a résumé yet\. Do list_files, then read_file/);
  assert.match(b, /✗ Email \(required\) → from the résumé \(read it first\)/);
  assert.doesNotMatch(formatFormProgress(ashby, true), /FIRST:/);
});

test('contact facts come from the top of the résumé and are shown to the model', async () => {
  const { resumeFacts } = await import('../../src/renderer/form-progress.ts');
  const f = resumeFacts('PAT EXAMPLE\npat.example@example.com · (555) 010-0100 · Los Angeles, CA\n\nSUMMARY ...');
  assert.deepStrictEqual(f, { name: 'Pat Example', email: 'pat.example@example.com', phone: '(555) 010-0100' });
  assert.deepStrictEqual(resumeFacts('Résumé of the candidate below\nno contact'), {});
  assert.match(formatFormProgress(ashby, true, f), /FROM THE RÉSUMÉ YOU READ: name "Pat Example", email "pat\.example@example\.com", phone "\(555\) 010-0100"/);
});
