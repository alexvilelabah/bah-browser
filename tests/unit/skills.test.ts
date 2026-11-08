// Skills de navegação: parse do SKILL.md e escolha por site / estado da UI / tipo de tarefa.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { parseSkill, selectSkills, formatSkillsBlock, type Skill } from '../../src/shared/skills.ts';

const sk = (meta: string, body = 'Do the thing.') => parseSkill(`---\n${meta}\n---\n${body}\n`) as Skill;

test('parses front matter lists and body', () => {
  const s = sk('name: popup-dismiss\ndescription: "Close blocking dialogs"\nstates: [dialog]\npriority: 5', 'Close it first.');
  assert.deepStrictEqual([s.name, s.description, s.states, s.sites, s.tasks, s.priority, s.body],
    ['popup-dismiss', 'Close blocking dialogs', ['dialog'], [], [], 5, 'Close it first.']);
});

test('rejects files without front matter, name or body', () => {
  assert.strictEqual(parseSkill('# just markdown'), null);
  assert.strictEqual(parseSkill('---\ndescription: x\n---\nbody'), null);
  assert.strictEqual(parseSkill('---\nname: x\n---\n'), null);
});

test('a skill matches only when every list it declares matches', () => {
  const all = [
    sk('name: booking\nsites: [booking.com]\ntasks: [search]'),
    sk('name: datepicker\nstates: [datepicker]'),
    sk('name: download-chain\ntasks: [download]'),
    sk('name: eula\nstates: [eula]\ntasks: [download]'),
  ];
  const names = (ctx: any) => selectSkills(all, ctx).map(s => s.name);
  assert.deepStrictEqual(names({ url: 'https://www.booking.com/', states: ['datepicker'], tasks: ['search'] }), ['booking', 'datepicker']);
  assert.deepStrictEqual(names({ url: 'https://example.com/', states: ['eula'], tasks: ['download'] }), ['eula', 'download-chain']);
  assert.deepStrictEqual(names({ url: 'https://example.com/', states: ['eula'], tasks: [] }), []);   // eula needs the download task too
  assert.deepStrictEqual(names({ url: 'https://notbooking.com/', states: [], tasks: ['search'] }), []); // site must match (subdomains only)
});

test('caps the number of skills and formats the block', () => {
  const many = Array.from({ length: 6 }, (_, i) => sk(`name: s${i}\nstates: [dialog]\npriority: ${i}`));
  const picked = selectSkills(many, { url: 'https://x.com', states: ['dialog'], tasks: [] }, 3);
  assert.deepStrictEqual(picked.map(s => s.name), ['s5', 's4', 's3']);
  assert.match(formatSkillsBlock(picked, new Date(2026, 10, 1)), /^SKILLS FOR THIS PAGE[^\n]*\nTODAY: 2026-11-01 \(Sunday\)\. A date without a year[\s\S]*### s5\nDo the thing\./);
  assert.strictEqual(formatSkillsBlock([]), '');
});

test('every bundled skills/*/SKILL.md parses and is short enough for a small model', () => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'skills');
  const files = fs.readdirSync(dir).map(d => path.join(dir, d, 'SKILL.md')).filter(f => fs.existsSync(f));
  assert.ok(files.length >= 6, `expected the starter skills, found ${files.length}`);
  for (const f of files) {
    const s = parseSkill(fs.readFileSync(f, 'utf8'));
    assert.ok(s, `${f} does not parse`);
    assert.strictEqual(s!.name, path.basename(path.dirname(f)), `${f}: name must match its folder`);
    assert.ok(s!.sites.length + s!.states.length + s!.tasks.length > 0, `${f}: no triggers`);
    assert.ok(s!.body.split(/\s+/).length <= 220, `${f}: body too long for a small model (${s!.body.split(/\s+/).length} words)`);
  }
});

test('TODAY line gives the coming weekend (Fri→Sun) that has not started yet', async () => {
  const { todayLine } = await import('../../src/shared/skills.ts');
  assert.match(todayLine(new Date(2026, 10, 1)), /Coming weekend \("next weekend"\): Fri 2026-11-06 → Sun 2026-11-08/);   // Sunday
  assert.match(todayLine(new Date(2026, 10, 4)), /Fri 2026-11-06 → Sun 2026-11-08/);   // Wednesday
  assert.match(todayLine(new Date(2026, 10, 6)), /Fri 2026-11-13 → Sun 2026-11-15/);   // Friday → the following one
  assert.match(todayLine(new Date(2026, 11, 30)), /Fri 2027-01-01 → Sun 2027-01-03/);  // across the year
});
