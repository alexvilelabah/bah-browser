// Lista suspensa com busca (react-select, Workday): qual opção casa, o que digitar, e o passo a passo
// abrir → escolher → conferir com uma página falsa.
import { test } from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { dropdownQueries, fillDropdown, matchDropdownOption, type DropdownScripts } from '../../src/shared/dropdown-fill.ts';
import { DROPDOWN_SCRIPTS, ddReadScript } from '../../src/renderer/dropdown-page.ts';
import { FORM_SCAN_SCRIPT, applyFill, formApplyScript, readDropdownOptions } from '../../src/renderer/form-filler.ts';
import { FORM_FIELDS_SCRIPT } from '../../src/renderer/form-progress.ts';

test('match: yes/no, decline variants, exact, prefix, aliases, unique word', () => {
  assert.strictEqual(matchDropdownOption(['Yes', 'No'], 'no'), 1);
  assert.strictEqual(matchDropdownOption(['Yes, I will require sponsorship', 'No, I will not'], 'no'), 1);
  assert.strictEqual(matchDropdownOption(['Man', 'Woman', "I don't wish to answer"], 'decline'), 2);
  assert.strictEqual(matchDropdownOption(['Prefer not to say', 'Yes', 'No'], 'decline'), 0);
  assert.strictEqual(matchDropdownOption(['Canada', 'United States', 'United States Minor Outlying Islands'], 'United States'), 1);
  assert.strictEqual(matchDropdownOption(['Canada', 'United States of America'], 'USA'), 1);
  assert.strictEqual(matchDropdownOption(['Brasil', 'Portugal'], 'Brazil'), 0);
  assert.strictEqual(matchDropdownOption(['Company website', 'Job board: LinkedIn', 'Referral'], 'LinkedIn'), 1);
  assert.strictEqual(matchDropdownOption(['LinkedIn post', 'LinkedIn job ad'], 'LinkedIn'), 0, 'prefix wins first');
  assert.strictEqual(matchDropdownOption(['Job board: LinkedIn', 'Social: LinkedIn'], 'linkedin'), -1, 'two candidates → ask');
});

test('match: notices are not options', () => {
  assert.strictEqual(matchDropdownOption(['No options'], 'no'), -1);
  assert.strictEqual(matchDropdownOption(['Loading...'], 'loading'), -1);
  assert.strictEqual(matchDropdownOption(['Select...', 'Yes', 'No'], 'select'), -1);
  assert.strictEqual(matchDropdownOption([], 'x'), -1);
  assert.strictEqual(matchDropdownOption(['A'], ''), -1);
});

test('queries: type the value, then an alias, then the full list; decline never typed', () => {
  assert.deepStrictEqual(dropdownQueries('United States'), ['United States', '']);
  assert.deepStrictEqual(dropdownQueries('USA'), ['USA', 'united states', '']);
  assert.deepStrictEqual(dropdownQueries('decline'), ['']);
  assert.deepStrictEqual(dropdownQueries(''), ['']);
  assert.deepStrictEqual(dropdownQueries('no'), ['no', '']);
});

// Página falsa: cada lista tem opções; abrir filtra por "contém" (como o react-select), escolher grava.
function fakePage(lists: Record<number, string[]>) {
  const picked: Record<number, string> = {}, log: string[] = [];
  const s: DropdownScripts = { open: (i, q) => JSON.stringify({ op: 'open', i, q }), pick: (i, t) => JSON.stringify({ op: 'pick', i, t }), close: (i) => JSON.stringify({ op: 'close', i }) };
  const exec = async (js: string) => {
    if (!js.startsWith('{')) return [];   // formApplyScript (campos comuns)
    const c = JSON.parse(js); log.push(`${c.op}:${c.i}:${c.q ?? c.t ?? ''}`);
    const all = lists[c.i];
    if (!all) return { ok: false, gone: true };
    if (c.op === 'open') { const o = all.filter(x => x.toLowerCase().includes(String(c.q).toLowerCase())); return o.length ? { ok: true, options: o } : { ok: false, options: [] }; }
    if (c.op === 'pick') { picked[c.i] = c.t; return { ok: true, shown: c.t }; }
    return { ok: true };
  };
  return { s, exec, picked, log };
}

test('fillDropdown: typed filter finds it; unmatched value falls back to the full list; nothing → options returned', async () => {
  const p = fakePage({ 1: ['Canada', 'United States'], 2: ['Yes', 'No'], 3: ['Amsterdam', 'London'], 4: ['Man', 'Woman', 'Prefer not to say'] });
  assert.deepStrictEqual(await fillDropdown(p.exec, p.s, 1, 'United States'), { ok: true, text: 'United States' });
  assert.deepStrictEqual(p.log.splice(0), ['open:1:United States', 'pick:1:United States']);
  assert.deepStrictEqual(await fillDropdown(p.exec, p.s, 4, 'decline'), { ok: true, text: 'Prefer not to say' });
  assert.deepStrictEqual(p.log.splice(0), ['open:4:', 'pick:4:Prefer not to say']);
  assert.deepStrictEqual(await fillDropdown(p.exec, p.s, 3, 'Berlin'), { ok: false, options: ['Amsterdam', 'London'] });
  assert.deepStrictEqual(p.log.splice(0), ['open:3:Berlin', 'close:3:', 'open:3:', 'close:3:']);
  assert.deepStrictEqual(await fillDropdown(p.exec, p.s, 9, 'x'), { ok: false, options: undefined });
});

test('applyFill: plain fields in one go, dropdowns one by one; failures carry the options seen', async () => {
  const p = fakePage({ 1: ['Yes', 'No'], 2: ['Amsterdam', 'London'], 3: ['BSc', 'MSc'] });
  const fields = [
    { idx: 0, label: 'Email', type: 'email' },
    { idx: 1, label: 'Sponsorship?', type: 'combobox' },
    { idx: 2, label: 'Office', type: 'combobox' },
    { idx: 3, label: 'Degree', type: 'combobox', options: ['BSc', 'MSc'] },
  ];
  const r = await applyFill(async (js) => (js.startsWith('{') ? p.exec(js) : [0]), [
    { idx: 0, label: 'Email', value: 'a@b.c', source: 'profile' },
    { idx: 1, label: 'Sponsorship?', value: 'no', source: 'profile' },
    { idx: 2, label: 'Office', value: 'Berlin', source: 'saved' },
    { idx: 3, label: 'Degree', option: 1, source: 'saved' },
  ], fields, p.s);
  assert.deepStrictEqual(r.done, [0, 1, 3]);
  assert.deepStrictEqual(r.texts, { 1: 'No', 3: 'MSc' });
  assert.deepStrictEqual(r.failed.map(f => [f.idx, f.options]), [[2, ['Amsterdam', 'London']]]);
});

test('readDropdownOptions: only comboboxes without options are opened', async () => {
  const seen: string[] = [];
  const out = await readDropdownOptions(async (js) => { seen.push(js); return { ok: true, options: ['A', 'B'] }; }, [
    { idx: 0, label: 'Why us?', type: 'textarea' },
    { idx: 1, label: 'Office', type: 'combobox' },
    { idx: 2, label: 'Degree', type: 'combobox', options: ['BSc'] },
  ]);
  assert.strictEqual(seen.length, 1);
  assert.ok(seen[0].includes('[1]'));
  assert.deepStrictEqual(out.map(f => f.options), [undefined, ['A', 'B'], ['BSc']]);
});

test('page scripts are valid JavaScript', () => {
  for (const js of [FORM_SCAN_SCRIPT, FORM_FIELDS_SCRIPT, formApplyScript([{ idx: 0, label: 'x', value: 'y', source: 'profile' }]),
    DROPDOWN_SCRIPTS.open(1, 'Uni"ted'), DROPDOWN_SCRIPTS.pick(1, "Don't"), DROPDOWN_SCRIPTS.close(1), ddReadScript(2)]) {
    assert.doesNotThrow(() => new vm.Script(js));
  }
});
