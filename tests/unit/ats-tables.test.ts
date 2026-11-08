// Tabelas por ATS: inventários de formulários públicos (tests/fixtures/ats) → itens do perfil.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ATS_IDS, classifyAtsField, detectAts, eeoGroupOf } from '../../src/shared/ats-tables.ts';
import { classifyField, planFill, type FieldInfo } from '../../src/shared/form-fill.ts';

const DIR = path.join(import.meta.dirname, '../fixtures/ats');
interface Fixture { ats: string; source: string; reachable: boolean; synthetic?: boolean; notes: string; fields: Array<Partial<FieldInfo> & { id?: string; expect: string | null }> }
const fixtures: Array<[string, Fixture]> = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort()
  .map(f => [f, JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))]);
// Como o scan da página entrega: name = name || id.
const asScanned = (fx: Fixture): FieldInfo[] => fx.fields.map((f, idx) => ({ idx, label: f.label || '', type: f.type || 'text', name: f.name || f.id || '', automationId: f.automationId, autocomplete: f.autocomplete, required: f.required, options: f.options }));
const atsOf = (fx: Fixture, fields: FieldInfo[]) => detectAts(fx.source, { names: fields.map(f => f.name || ''), automationIds: fields.map(f => f.automationId || '') });

test('fixtures: every inventory is minimized (no HTML, no values) and names a known ATS', () => {
  assert.ok(fixtures.length >= 12);
  for (const [fn, fx] of fixtures) {
    assert.ok(ATS_IDS.includes(fx.ats as any), fn);
    assert.ok(fx.notes, `${fn} explains what was reachable`);
    for (const f of fx.fields) {
      assert.deepStrictEqual(Object.keys(f).filter(k => !['label', 'type', 'name', 'id', 'automationId', 'autocomplete', 'required', 'options', 'expect'].includes(k)), [], fn);
      assert.ok(!/<[a-z]/i.test(f.label || ''), `${fn}: label without markup`);
    }
  }
});

test('detection: each fixture page is recognised from its URL', () => {
  for (const [fn, fx] of fixtures) assert.strictEqual(detectAts(fx.source), fx.ats, fn);
});

test('detection: hosts, embedded forms by field names, and unknown pages', () => {
  assert.strictEqual(detectAts('https://boards.greenhouse.io/acme/jobs/123'), 'greenhouse');
  assert.strictEqual(detectAts('https://job-boards.eu.greenhouse.io/acme/jobs/123'), 'greenhouse');
  assert.strictEqual(detectAts('https://careers.example.com/positions/8306554?gh_jid=8306554'), 'greenhouse');
  assert.strictEqual(detectAts('https://jobs.eu.lever.co/acme/abc/apply'), 'lever');
  assert.strictEqual(detectAts('https://acme.wd1.myworkdayjobs.com/en-US/External/job/x/apply'), 'workday');
  assert.strictEqual(detectAts('https://wd3.myworkdaysite.com/recruiting/acme/External'), 'workday');
  assert.strictEqual(detectAts('https://careers-acme.icims.com/jobs/1/x/job?mode=apply'), 'icims');
  assert.strictEqual(detectAts('https://jobs.smartrecruiters.com/oneclick-ui/company/Acme/publication/x'), 'smartrecruiters');
  assert.strictEqual(detectAts('https://ats.rippling.com/acme/jobs/x/apply'), 'rippling');
  assert.strictEqual(detectAts('https://www.rippling.com/careers'), null, 'Rippling\'s marketing site is not the ATS');
  // Formulário embutido no site da empresa: pelos nomes dos campos.
  assert.strictEqual(detectAts('https://acme.com/careers/apply', { names: ['name', 'email', 'urls[LinkedIn]'] }), 'lever');
  assert.strictEqual(detectAts('https://acme.com/jobs', { names: ['job_application[first_name]'] }), 'greenhouse');
  assert.strictEqual(detectAts('https://acme.com/jobs', { names: ['_systemfield_name'] }), 'ashby');
  assert.strictEqual(detectAts('https://acme.com/jobs', { automationIds: ['formField-legalName--firstName'] }), 'workday');
  assert.strictEqual(detectAts('https://acme.com/contact', { names: ['name', 'email', 'message'] }), null);
  assert.strictEqual(detectAts('not a url'), null);
});

test('every fixture field classifies to its reviewed profile key', () => {
  for (const [fn, fx] of fixtures) {
    const fields = asScanned(fx);
    const ats = atsOf(fx, fields);
    assert.strictEqual(ats, fx.ats, fn);
    assert.deepStrictEqual(fields.map(f => classifyField(f, ats)), fx.fields.map(f => f.expect), fn);
  }
});

test('coverage per ATS: table + rules recognise at least what the generic rules did, and the identity fields', () => {
  const by: Record<string, { total: number; ats: number; generic: number }> = {};
  for (const [, fx] of fixtures) {
    const all = asScanned(fx), ats = atsOf(fx, all);
    const fields = all.filter(f => f.type !== 'file');
    const s = by[fx.ats] ||= { total: 0, ats: 0, generic: 0 };
    s.total += fields.length;
    s.ats += fields.filter(f => classifyField(f, ats) !== null).length;
    // Genérico "acerta" = concorda com a classificação revisada (pôr telefone no campo de busca não conta).
    s.generic += fields.filter(f => classifyField(f, null) !== null && classifyField(f, null) === fx.fields[f.idx].expect).length;
    // Nome, e-mail e telefone (quando o formulário tem) sempre reconhecidos.
    for (const f of fields) if (/^(first|last|full|legal)? ?name$|^e-?mail( address)?$|^phone( number)?$/i.test(f.label.replace(/[✱*]/g, '').trim()) && f.type !== 'checkbox') assert.notStrictEqual(classifyField(f, ats), null, `${fx.source} ${f.label}`);
  }
  const lines = Object.entries(by).map(([a, s]) => `${a.padEnd(16)} ${String(s.ats).padStart(3)}/${String(s.total).padEnd(3)} recognised (generic rules alone get ${s.generic} right)`);
  console.log(`ATS coverage (non-file fields; recognised = profile key, voluntary or skip):\n${lines.join('\n')}`);
  for (const s of Object.values(by)) assert.ok(s.ats >= s.generic);
});

test('the table wins over the label: stable ids beat odd or missing labels', () => {
  assert.strictEqual(classifyField({ label: 'Start typing...', type: 'combobox', automationId: '_systemfield_location' }, 'ashby'), 'location');
  assert.strictEqual(classifyField({ label: 'Other website', type: 'text', name: 'urls[Other]' }, 'lever'), 'skip');
  assert.strictEqual(classifyField({ label: 'Other website', type: 'text', name: 'urls[Other]' }, null), 'website');
  assert.strictEqual(classifyField({ label: 'Phone', type: 'text', name: '' }, 'greenhouse'), 'skip', 'react-select internals inherit the "Phone" label');
  assert.strictEqual(classifyField({ label: 'Phone Device Type', type: 'select', automationId: 'formField-phoneType' }, 'workday'), 'skip');
  assert.strictEqual(classifyField({ label: 'Enter website', type: 'text', name: 'website', automationId: 'beecatcher' }, 'workday'), 'skip');
  assert.strictEqual(classifyField({ label: 'Field 3', type: 'text', automationId: 'linkedin_link' }, 'rippling'), 'linkedin');
  assert.strictEqual(classifyField({ label: 'X', type: 'text', automationId: 'PersonProfileFields.FirstName' }, 'icims'), 'firstName');
  // Sem ATS, a tabela não se aplica: cai nas regras genéricas.
  assert.strictEqual(classifyField({ label: 'Field 3', type: 'text', automationId: 'linkedin_link' }, null), null);
});

test('EEO groups by options, decline-only boxes, honeypots and passwords', () => {
  assert.strictEqual(eeoGroupOf(['Man', 'Woman', 'Non-Binary', 'I prefer not to answer']), 'gender');
  assert.strictEqual(eeoGroupOf(['Under 30', '30-39', '40-49', 'I prefer not to answer']), 'age');
  assert.strictEqual(eeoGroupOf(['White', 'Asian', 'Decline to self-identify']), 'race');
  assert.strictEqual(eeoGroupOf(['Yes', 'No']), null);
  assert.strictEqual(eeoGroupOf(['Man', 'Woman']), null, 'needs a decline option');
  assert.strictEqual(classifyAtsField({ label: '', type: 'checkbox', options: ['I prefer not to answer', 'I prefer not to answer'] }, 'ashby'), 'voluntary');
  assert.strictEqual(classifyAtsField({ label: 'White', type: 'checkbox', options: ['checked'] }, 'ashby'), 'skip');
  assert.strictEqual(classifyAtsField({ label: 'White', type: 'checkbox', options: ['checked'] }, null), null);
  assert.strictEqual(classifyAtsField({ label: 'Leave this field blank', type: 'text', name: 'hp' }, null), 'skip');
  assert.strictEqual(classifyAtsField({ label: "This input is for robots only, do not enter if you're human.", type: 'text' }, null), 'skip');
  assert.strictEqual(classifyAtsField({ label: 'Legal Name (if different than above)', type: 'text' }, null), 'skip');
  assert.strictEqual(classifyAtsField({ label: 'Password', type: 'password' }, null), 'skip');
});

test('planFill: real Greenhouse inventory — no phone in hidden widget inputs, EEO declined, nothing skipped is asked', () => {
  const fx = fixtures.find(([f]) => f === 'greenhouse-1.json')![1];
  const fields = asScanned(fx);
  const r = planFill(fields, { firstName: 'Pat', lastName: 'Example', email: 'pat@example.com', phone: '555-0100', linkedin: 'https://linkedin.com/in/pat' }, {}, {}, { url: fx.source });
  const byIdx = Object.fromEntries(r.fill.map(d => [d.idx, d]));
  const unnamed = fields.filter(f => !f.name && f.type === 'text').map(f => f.idx);
  assert.ok(unnamed.length >= 2);
  for (const i of unnamed) assert.ok(!byIdx[i], `unnamed widget input ${i} left alone`);
  assert.ok(!r.missing.some(f => unnamed.includes(f.idx)), 'and not asked either');
  assert.strictEqual(byIdx[fields.find(f => f.name === 'phone')!.idx]?.value, '555-0100');
  assert.strictEqual(byIdx[fields.find(f => f.name === 'first_name')!.idx]?.value, 'Pat');
  assert.strictEqual(byIdx[fields.find(f => f.name === 'question_38503739002')!.idx]?.value, 'https://linkedin.com/in/pat');
});

test('planFill: Workday create-account step — honeypot and passwords neither filled nor asked', () => {
  const fx = fixtures.find(([f]) => f === 'workday-1.json')![1];
  const fields = asScanned(fx);
  const r = planFill(fields, { email: 'pat@example.com', website: 'https://pat.dev' }, {}, {}, { url: fx.source });
  assert.deepStrictEqual(r.fill.map(d => d.value), ['pat@example.com']);
  assert.deepStrictEqual(r.missing.map(f => f.label), [fields.find(f => f.automationId === 'createAccountCheckbox')!.label]);
});

test('planFill: ATS comes from the fields when no URL is given (embedded Lever form)', () => {
  const fields: FieldInfo[] = [
    { idx: 0, label: 'Full name', type: 'text', name: 'name' },
    { idx: 1, label: 'Portfolio URL', type: 'text', name: 'urls[Portfolio]' },
    { idx: 2, label: 'Other website', type: 'text', name: 'urls[Other]' },
  ];
  const r = planFill(fields, { firstName: 'Pat', lastName: 'Example', website: 'https://pat.dev' });
  assert.deepStrictEqual(r.fill.map(d => [d.idx, d.value]), [[0, 'Pat Example'], [1, 'https://pat.dev']]);
});
