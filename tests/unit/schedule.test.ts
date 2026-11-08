// Tarefas agendadas (shared/schedule.ts): parser en/pt/es, próximas vezes (dias úteis, horário de
// verão), vezes perdidas e validação do que vai pro disco.
// Fuso fixo ANTES de qualquer Date: a conta é em hora local, e o teste de DST precisa de um fuso com DST.
process.env.TZ = 'America/New_York';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSchedule, parseWhen, nextRunAfter, nextRuns, advance, dueState, missedCount, sanitizeTasks, withRun,
  addLocalDays, snoozeUntil, nextRunRespectingSnooze, SNOOZE_DAYS, MAX_SNOOZE_DAYS,
  MIN_INTERVAL_MIN, MAX_HISTORY, MAX_TASKS, WEEKDAYS, EVERY_DAY, type ScheduleSpec, type ScheduledTask,
} from '../../src/shared/schedule.ts';

const L = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const fmt = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]}`; };

test('en: weekdays at 8am, command extracted', () => {
  const p = parseSchedule('every weekday at 8am check my Indeed recommendations')!;
  assert.deepEqual(p.spec, { kind: 'weekly', days: WEEKDAYS, hour: 8, minute: 0 });
  assert.equal(p.command, 'check my Indeed recommendations');
  assert.deepEqual(p.ambiguous, []);
  const q = parseSchedule('check my Indeed recommendations every weekday at 8am')!;
  assert.equal(q.command, 'check my Indeed recommendations');
  assert.deepEqual(q.spec, p.spec);
});

test('en: weekly on a day, "at 9" is ambiguous (am/pm) but guessed as morning', () => {
  const p = parseSchedule('every Monday at 9 summarize the news')!;
  assert.deepEqual(p.spec, { kind: 'weekly', days: [1], hour: 9, minute: 0 });
  assert.equal(p.command, 'summarize the news');
  assert.deepEqual(p.ambiguous, ['ampm']);
  const q = parseSchedule('every monday and thursday at 5:30pm, check my bank balance')!;
  assert.deepEqual(q.spec, { kind: 'weekly', days: [1, 4], hour: 17, minute: 30 });
  assert.equal(q.command, 'check my bank balance');
  assert.deepEqual(parseSchedule('every friday at 3 send me the weather')!.spec, { kind: 'weekly', days: [5], hour: 15, minute: 0 });
});

test('en: daily, no time → 9:00 and asks; noon / 24h are clear', () => {
  const p = parseSchedule('daily summarize hacker news')!;
  assert.deepEqual(p.spec, { kind: 'weekly', days: EVERY_DAY, hour: 9, minute: 0 });
  assert.deepEqual(p.ambiguous, ['no-time']);
  assert.deepEqual(parseSchedule('every day at noon check the weather')!.spec, { kind: 'weekly', days: EVERY_DAY, hour: 12, minute: 0 });
  assert.deepEqual(parseSchedule('every day at 20:15 check the weather')!.ambiguous, []);
  assert.deepEqual(parseSchedule('every morning at 7 read my email')!.spec, { kind: 'weekly', days: EVERY_DAY, hour: 7, minute: 0 });
  assert.deepEqual(parseSchedule('every evening at 7 read my email')!.spec, { kind: 'weekly', days: EVERY_DAY, hour: 19, minute: 0 });
  assert.deepEqual(parseSchedule('on weekends at 10am check the forecast')!.spec, { kind: 'weekly', days: [0, 6], hour: 10, minute: 0 });
});

test('en: intervals with a sane minimum', () => {
  assert.deepEqual(parseSchedule('every 30 minutes check the price of bitcoin')!.spec, { kind: 'interval', everyMin: 30 });
  assert.deepEqual(parseSchedule('every 2 hours check my inbox')!.spec, { kind: 'interval', everyMin: 120 });
  assert.deepEqual(parseSchedule('every hour check my inbox')!.spec, { kind: 'interval', everyMin: 60 });
  assert.deepEqual(parseSchedule('every half hour check the score')!.spec, { kind: 'interval', everyMin: 30 });
  const p = parseSchedule('every 5 minutes reload the tickets page')!;
  assert.deepEqual(p.spec, { kind: 'interval', everyMin: MIN_INTERVAL_MIN });
  assert.deepEqual(p.ambiguous, ['min-interval']);
  assert.equal(p.command, 'reload the tickets page');
});

test('pt: toda segunda às 9h, dias úteis, a cada N horas', () => {
  const p = parseSchedule('toda segunda às 9h resuma as notícias')!;
  assert.deepEqual(p.spec, { kind: 'weekly', days: [1], hour: 9, minute: 0 });
  assert.equal(p.command, 'resuma as notícias');
  assert.deepEqual(p.ambiguous, []);
  assert.deepEqual(parseSchedule('de segunda a sexta às 8h30 veja minhas vagas no LinkedIn')!.spec, { kind: 'weekly', days: WEEKDAYS, hour: 8, minute: 30 });
  assert.deepEqual(parseSchedule('todos os dias às 20h veja a previsão do tempo')!.spec, { kind: 'weekly', days: EVERY_DAY, hour: 20, minute: 0 });
  assert.deepEqual(parseSchedule('a cada 2 horas veja meu email')!.spec, { kind: 'interval', everyMin: 120 });
  assert.deepEqual(parseSchedule('aos sábados às 10h veja as promoções')!.spec, { kind: 'weekly', days: [6], hour: 10, minute: 0 });
  assert.equal(parseSchedule('agende toda sexta-feira às 18h: veja os filmes da semana')!.command, 'veja os filmes da semana');
});

test('es: cada lunes a las 9, todos los días, cada 30 minutos', () => {
  const p = parseSchedule('cada lunes a las 9 resume las noticias')!;
  assert.deepEqual(p.spec, { kind: 'weekly', days: [1], hour: 9, minute: 0 });
  assert.equal(p.command, 'resume las noticias');
  assert.deepEqual(parseSchedule('todos los días a las 7 de la mañana revisa mi correo')!.spec, { kind: 'weekly', days: EVERY_DAY, hour: 7, minute: 0 });
  assert.deepEqual(parseSchedule('de lunes a viernes a las 8:30 revisa las ofertas de trabajo')!.spec, { kind: 'weekly', days: WEEKDAYS, hour: 8, minute: 30 });
  assert.deepEqual(parseSchedule('cada 30 minutos revisa el precio')!.spec, { kind: 'interval', everyMin: 30 });
});

test('not a schedule: plain requests, macro repeats, one-off days', () => {
  assert.equal(parseSchedule('summarize the news'), null);
  assert.equal(parseSchedule('repete a cada 5 minutos'), null);
  assert.equal(parseSchedule('repeat every 10 minutes'), null);
  assert.equal(parseSchedule('book a table on monday at 8pm'), null);   // uma vez, não toda segunda
  assert.equal(parseSchedule('what did I read every day last week'), null);   // no meio, sem hora: conversa
  assert.equal(parseSchedule('every day at 8am'), null);   // sem pedido
});

test('next run: weekdays skip the weekend; today if the time has not passed', () => {
  const spec: ScheduleSpec = { kind: 'weekly', days: WEEKDAYS, hour: 8, minute: 0 };
  // Sexta 2026-10-30 07:00 → hoje 8:00; depois disso → segunda.
  assert.equal(fmt(nextRunAfter(spec, L(2026, 10, 30, 7))), '2026-10-30 8:00 Fri');
  assert.equal(fmt(nextRunAfter(spec, L(2026, 10, 30, 8))), '2026-11-2 8:00 Mon');
  assert.deepEqual(nextRuns(spec, L(2026, 10, 30, 9)).map(fmt), ['2026-11-2 8:00 Mon', '2026-11-3 8:00 Tue', '2026-11-4 8:00 Wed']);
  const mon: ScheduleSpec = { kind: 'weekly', days: [1], hour: 9, minute: 0 };
  assert.deepEqual(nextRuns(mon, L(2026, 10, 27, 12)).map(fmt), ['2026-11-2 9:00 Mon', '2026-11-9 9:00 Mon', '2026-11-16 9:00 Mon']);
});

test('next run across DST: same wall-clock time, gap pushed forward, no double run on fall back', () => {
  const daily8: ScheduleSpec = { kind: 'weekly', days: EVERY_DAY, hour: 8, minute: 0 };
  // EUA: horário de verão termina 2026-11-01 (domingo) 2:00 → 1:00. 8h continua 8h.
  const runs = nextRuns(daily8, L(2026, 10, 31, 9), 2);
  assert.deepEqual(runs.map(fmt), ['2026-11-1 8:00 Sun', '2026-11-2 8:00 Mon']);
  assert.equal(runs[1] - runs[0], 24 * 3600_000);
  assert.equal(runs[0] - L(2026, 10, 31, 8), 25 * 3600_000);   // o dia da troca tem 25h
  // Começa 2026-03-08 2:00 → 3:00: 2:30 não existe → roda 3:30 daquele dia, não some.
  const gap: ScheduleSpec = { kind: 'weekly', days: EVERY_DAY, hour: 2, minute: 30 };
  assert.equal(fmt(nextRunAfter(gap, L(2026, 3, 7, 12))), '2026-3-8 3:30 Sun');
  assert.equal(fmt(nextRunAfter(gap, nextRunAfter(gap, L(2026, 3, 7, 12)))), '2026-3-9 2:30 Mon');
  // 1:30 do dia da volta acontece 2 vezes: depois de rodar na 1ª, a próxima é no dia seguinte.
  const dup: ScheduleSpec = { kind: 'weekly', days: EVERY_DAY, hour: 1, minute: 30 };
  const first = nextRunAfter(dup, L(2026, 10, 31, 12));
  assert.equal(fmt(first), '2026-11-1 1:30 Sun');
  assert.equal(fmt(nextRunAfter(dup, first + 1000)), '2026-11-2 1:30 Mon');
});

test('advance: intervals stay on the grid; weekly jumps past now', () => {
  const iv: ScheduleSpec = { kind: 'interval', everyMin: 30 };
  const due = L(2026, 11, 2, 10);
  assert.equal(advance(iv, due, due), due + 30 * 60_000);
  assert.equal(advance(iv, due, due + 65 * 60_000), due + 90 * 60_000);
  const wk: ScheduleSpec = { kind: 'weekly', days: [1], hour: 9, minute: 0 };
  assert.equal(fmt(advance(wk, L(2026, 11, 2, 9), L(2026, 11, 20, 12))), '2026-11-23 9:00 Mon');
});

test('missed runs: at launch anything past is offered; while open, only a long gap is', () => {
  const now = L(2026, 11, 2, 12);
  const t = { enabled: true, nextAt: now - 60_000 };
  assert.equal(dueState(t, now, true), 'missed');
  assert.equal(dueState(t, now, false), 'due');
  assert.equal(dueState({ enabled: true, nextAt: now - 3600_000 }, now, false), 'missed');   // o computador dormiu
  assert.equal(dueState({ enabled: true, nextAt: now + 1 }, now, true), 'not-due');
  assert.equal(dueState({ enabled: false, nextAt: now - 1 }, now, true), 'not-due');
  const daily: ScheduleSpec = { kind: 'weekly', days: EVERY_DAY, hour: 8, minute: 0 };
  assert.equal(missedCount(daily, L(2026, 10, 30, 8), now), 4);   // 30, 31, 1, 2
  assert.equal(missedCount(daily, now + 1, now), 0);
  assert.equal(missedCount({ kind: 'interval', everyMin: 15 }, now - 3600_000, now), 5);
});

test('snooze: nothing until the same time N days later, then the regular rule resumes', () => {
  assert.deepEqual(SNOOZE_DAYS, [1, 3, 7]);
  const wk: ScheduleSpec = { kind: 'weekly', days: WEEKDAYS, hour: 8, minute: 0 };
  // Perdida terça 2026-11-03 8:00, a pessoa abre o Bah às 10:00.
  const due = L(2026, 11, 3, 8), now = L(2026, 11, 3, 10);
  let s = snoozeUntil(wk, due, now, 1);
  assert.equal(fmt(s.until), '2026-11-4 10:00 Wed');
  assert.equal(fmt(s.nextAt), '2026-11-5 8:00 Thu');   // quarta 8h cai dentro do adiamento
  // Depois do adiamento a regra normal segue: sexta, segunda (pula o fim de semana)…
  assert.deepEqual(nextRuns(wk, s.nextAt, 2).map(fmt), ['2026-11-6 8:00 Fri', '2026-11-9 8:00 Mon']);
  assert.equal(fmt(advance(wk, s.nextAt, s.nextAt)), '2026-11-6 8:00 Fri');
  s = snoozeUntil(wk, due, now, 3);
  assert.equal(fmt(s.nextAt), '2026-11-9 8:00 Mon');    // sexta 10h + fim de semana
  s = snoozeUntil(wk, due, now, 7);
  assert.equal(fmt(s.nextAt), '2026-11-11 8:00 Wed');
  // Exatamente na hora em que o adiamento acaba conta (em ou depois).
  s = snoozeUntil(wk, due, L(2026, 11, 3, 8), 1);
  assert.equal(fmt(s.nextAt), '2026-11-4 8:00 Wed');
  // Semanal num dia só: a próxima segunda depois do adiamento.
  const mon: ScheduleSpec = { kind: 'weekly', days: [1], hour: 9, minute: 0 };
  assert.equal(fmt(snoozeUntil(mon, L(2026, 11, 2, 9), L(2026, 11, 2, 12), 3).nextAt), '2026-11-9 9:00 Mon');
  assert.equal(fmt(snoozeUntil(mon, L(2026, 11, 2, 9), L(2026, 11, 2, 12), 7).nextAt), '2026-11-16 9:00 Mon');
  // Dias fora da faixa: no mínimo 1, no máximo MAX_SNOOZE_DAYS.
  assert.equal(snoozeUntil(wk, due, now, 0).until, addLocalDays(now, 1));
  assert.equal(snoozeUntil(wk, due, now, 999).until, addLocalDays(now, MAX_SNOOZE_DAYS));
});

test('snooze: intervals stay on their grid', () => {
  const iv: ScheduleSpec = { kind: 'interval', everyMin: 120 };
  const due = L(2026, 11, 3, 8), now = L(2026, 11, 3, 10, 30);
  const s = snoozeUntil(iv, due, now, 1);
  assert.equal(fmt(s.until), '2026-11-4 10:30 Wed');
  assert.equal(fmt(s.nextAt), '2026-11-4 12:00 Wed');   // grade 8h, 10h, 12h… a primeira depois de 10:30
  assert.equal(advance(iv, s.nextAt, s.nextAt), s.nextAt + 120 * 60_000);
});

test('snooze across DST: N calendar days, same wall-clock time', () => {
  const daily8: ScheduleSpec = { kind: 'weekly', days: EVERY_DAY, hour: 8, minute: 0 };
  // EUA, fim do horário de verão 2026-11-01: adiar 1 dia no sábado 10h → domingo 10h (25h depois).
  const sat = L(2026, 10, 31, 10);
  let s = snoozeUntil(daily8, L(2026, 10, 31, 8), sat, 1);
  assert.equal(fmt(s.until), '2026-11-1 10:00 Sun');
  assert.equal(s.until - sat, 25 * 3600_000);
  assert.equal(fmt(s.nextAt), '2026-11-2 8:00 Mon');
  // Começo do horário de verão 2026-03-08: o dia tem 23h; 8h continua 8h.
  const mar7 = L(2026, 3, 7, 7);
  s = snoozeUntil(daily8, L(2026, 3, 6, 8), mar7, 1);
  assert.equal(fmt(s.until), '2026-3-8 7:00 Sun');
  assert.equal(s.until - mar7, 23 * 3600_000);
  assert.equal(fmt(s.nextAt), '2026-3-8 8:00 Sun');
  // Adiar até uma hora que não existe (2:30 no salto da primavera) empurra pra frente, não some.
  assert.equal(fmt(addLocalDays(L(2026, 3, 7, 2, 30), 1)), '2026-3-8 3:30 Sun');
});

test('snooze survives edits and restarts: rescheduling keeps it, storage keeps it', () => {
  const wk: ScheduleSpec = { kind: 'weekly', days: WEEKDAYS, hour: 8, minute: 0 };
  const until = L(2026, 11, 6, 10);   // sexta 10h
  // Mudar a regra (ou religar) no meio do adiamento: a próxima vez continua depois dele.
  assert.equal(fmt(nextRunRespectingSnooze(wk, L(2026, 11, 4, 9), until)), '2026-11-9 8:00 Mon');
  const eleven: ScheduleSpec = { kind: 'weekly', days: EVERY_DAY, hour: 11, minute: 0 };
  assert.equal(fmt(nextRunRespectingSnooze(eleven, L(2026, 11, 4, 9), until)), '2026-11-6 11:00 Fri');
  // Adiamento já acabou (ou não existe): regra normal.
  assert.equal(fmt(nextRunRespectingSnooze(wk, L(2026, 11, 9, 9), until)), '2026-11-10 8:00 Tue');
  assert.equal(fmt(nextRunRespectingSnooze(wk, L(2026, 11, 4, 9))), '2026-11-5 8:00 Thu');
  assert.equal(nextRunRespectingSnooze({ kind: 'interval', everyMin: 60 }, L(2026, 11, 4, 9), until), until);
  // O disco guarda o snoozedUntil (e descarta lixo).
  const base = { id: 'st_s', name: 'N', command: 'check the news', spec: wk, enabled: true, createdAt: 1, nextAt: L(2026, 11, 9, 8), history: [] };
  assert.equal(sanitizeTasks([{ ...base, snoozedUntil: until }])[0].snoozedUntil, until);
  assert.equal('snoozedUntil' in sanitizeTasks([{ ...base, snoozedUntil: 'x' }])[0], false);
  // Ainda adiada → não vence na abertura (não vira oferta de novo).
  assert.equal(dueState({ enabled: true, nextAt: L(2026, 11, 9, 8) }, L(2026, 11, 7, 12), true), 'not-due');
});

test('storage: sanitized, capped, history kept short', () => {
  const good = { id: 'st_1', name: 'News', command: 'summarize the news', spec: { kind: 'weekly', days: [1, 1, 9], hour: 9, minute: 0 }, enabled: true, createdAt: 1, nextAt: 2, history: [] };
  const list = sanitizeTasks([good, { ...good }, { ...good, id: 'bad id!' }, { ...good, id: 'x', spec: { kind: 'interval', everyMin: 1 } }, null, 'junk']);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0].spec, { kind: 'weekly', days: [1], hour: 9, minute: 0 });
  assert.deepEqual(list[1].spec, { kind: 'interval', everyMin: MIN_INTERVAL_MIN });
  assert.equal(sanitizeTasks(Array.from({ length: 80 }, (_, i) => ({ ...good, id: 't' + i }))).length, MAX_TASKS);
  let task: ScheduledTask = list[0];
  for (let i = 0; i < 30; i++) task = withRun(task, { at: 100 + i, outcome: 'success', summary: 'x'.repeat(500) });
  assert.equal(task.history.length, MAX_HISTORY);
  assert.equal(task.history.at(-1)!.at, 129);
  assert.equal(task.lastRunAt, 129);
  assert.ok(task.history[0].summary.length <= 240);
  assert.equal(withRun(task, { at: 999, outcome: 'skipped', summary: '' }).lastRunAt, 129);
});

test('panel "when" field: schedule text only (and what the panel shows parses back)', () => {
  assert.deepEqual(parseWhen('every weekday at 8am')!.spec, { kind: 'weekly', days: WEEKDAYS, hour: 8, minute: 0 });
  assert.deepEqual(parseWhen('Weekdays at 8:00 AM')!.spec, { kind: 'weekly', days: WEEKDAYS, hour: 8, minute: 0 });
  assert.deepEqual(parseWhen('Every 2 h')!.spec, { kind: 'interval', everyMin: 120 });
  assert.deepEqual(parseWhen('Dias úteis às 08:00')!.spec, { kind: 'weekly', days: WEEKDAYS, hour: 8, minute: 0 });
  assert.deepEqual(parseWhen('De lunes a viernes a las 8:00')!.spec, { kind: 'weekly', days: WEEKDAYS, hour: 8, minute: 0 });
  assert.deepEqual(parseWhen('Every day at 7:30 PM')!.spec, { kind: 'weekly', days: EVERY_DAY, hour: 19, minute: 30 });
  assert.deepEqual(parseWhen('Every Monday, Thursday at 9:00 AM')!.spec, { kind: 'weekly', days: [1, 4], hour: 9, minute: 0 });
  assert.deepEqual(parseWhen('Toda segunda-feira, quinta-feira às 09:00')!.spec, { kind: 'weekly', days: [1, 4], hour: 9, minute: 0 });
  assert.deepEqual(parseWhen('Cada lunes, jueves a las 9:00')!.spec, { kind: 'weekly', days: [1, 4], hour: 9, minute: 0 });
  assert.equal(parseWhen('every weekday check stuff'), null);
  assert.equal(parseWhen('tomorrow'), null);
});
