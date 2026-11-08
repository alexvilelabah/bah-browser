// Freio da candidatura: "Submit application" sempre pergunta; "Submit" puro só numa tarefa de vaga.
import { test } from 'node:test';
import assert from 'node:assert';
import { classifyRisk, riskForAction } from '../../src/renderer/risk.ts';

test('explicit "submit application" buttons always ask', () => {
  for (const label of ['Submit your application', 'Submit Application', 'Send application', 'Enviar candidatura']) {
    assert.strictEqual(classifyRisk('click_ref', label)?.kind, 'application', label);
  }
});

test('a bare Submit/Send asks only in a job task', () => {
  assert.strictEqual(classifyRisk('click_ref', 'Submit'), null);
  assert.strictEqual(classifyRisk('click_ref', 'Submit', undefined, undefined, { jobs: true })?.kind, 'application');
  assert.strictEqual(classifyRisk('click_ref', 'Send', undefined, undefined, { jobs: true })?.kind, 'application');
});

test('ordinary steps of an application do not ask', () => {
  const jobs = { jobs: true };
  for (const label of ['Apply now', 'Continue', 'Next', 'Review your application', 'Upload resume', 'Search jobs', 'Back']) {
    assert.strictEqual(classifyRisk('click_ref', label, undefined, undefined, jobs), null, label);
  }
  // Long labels starting with "submit" are links/text, not the form's button.
  assert.strictEqual(classifyRisk('click_ref', 'Submit a resume to be considered for future roles', undefined, undefined, jobs), null);
  // Filling a field named "application" is just typing.
  assert.strictEqual(classifyRisk('fill_ref', 'Submit application notes', undefined, undefined, jobs), null);
});

test('Enter on an application review page asks in a job task', () => {
  const url = 'https://smartapply.indeed.com/beta/indeedapply/form/review';
  assert.strictEqual(riskForAction({ type: 'press', key: 'Enter' }, undefined, url, { jobs: true })?.kind, 'application');
  assert.strictEqual(riskForAction({ type: 'press', key: 'Enter' }, undefined, url), null);
  assert.strictEqual(riskForAction({ type: 'press', key: 'Tab' }, undefined, url, { jobs: true }), null);
});

test('payment still wins over application', () => {
  assert.strictEqual(classifyRisk('click_ref', 'Place order', undefined, undefined, { jobs: true })?.kind, 'payment');
});
