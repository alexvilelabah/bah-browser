// schedule.ts — regras PURAS das tarefas agendadas (sem React, sem DOM, sem electron).
// A pessoa diz "every weekday at 8am check my Indeed recommendations" (ou "toda segunda às 9h
// resuma as notícias", "cada lunes a las 9 ..."): daqui sai QUANDO (a regra) e O QUÊ (o pedido
// que o agente vai rodar). Rodam só com o Bah aberto; o que passou com ele fechado é OFERECIDO na
// próxima abertura (nunca roda escondido). Horário = o relógio local do sistema (com horário de
// verão: a conta é feita em data/hora local, não em "+24h").
// Usado pelo main (validação do que vai pro disco), pelo renderer (relógio, painel, cartão) e
// pelos testes (tests/unit/schedule.test.ts).

/** Dias: 0 = domingo … 6 = sábado (como Date.getDay()). Todos os 7 = todo dia. */
export type ScheduleSpec =
  | { kind: 'interval'; everyMin: number }
  | { kind: 'weekly'; days: number[]; hour: number; minute: number };

export type RunOutcome = 'success' | 'failed' | 'cancelled' | 'error' | 'skipped';
export interface RunRecord { at: number; outcome: RunOutcome; summary: string; missed?: boolean }

export interface ScheduledTask {
  id: string;
  name: string;          // nome curto (chip da sessão da tarefa)
  command: string;       // o pedido que o agente roda
  spec: ScheduleSpec;
  enabled: boolean;
  createdAt: number;
  nextAt: number;        // próxima vez (ms, relógio do sistema)
  lastRunAt?: number;
  /** "Adiar N dias" no cartão das perdidas: nada roda antes disto; depois volta a regra normal. */
  snoozedUntil?: number;
  history: RunRecord[];  // mais nova por último
}

/** Agente custa dinheiro e mexe na conta da pessoa: nada de "a cada 1 minuto". */
export const MIN_INTERVAL_MIN = 15;
export const MAX_INTERVAL_MIN = 7 * 24 * 60;
export const MAX_TASKS = 50;
export const MAX_COMMAND = 1000;
export const MAX_NAME = 24;
export const MAX_HISTORY = 20;
export const MAX_SUMMARY = 240;
/** Com o Bah aberto, uma hora que passou há mais que isto (computador dormindo) vira "perdida". */
export const DUE_GRACE_MS = 10 * 60_000;
/** Escolhas do "Adiar" no cartão das perdidas (dias). */
export const SNOOZE_DAYS = [1, 3, 7];
export const MAX_SNOOZE_DAYS = 30;

export const WEEKDAYS = [1, 2, 3, 4, 5];
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

// ── PARSER ───────────────────────────────────────────────────────────────────

/** Por que vale perguntar antes de salvar (o cartão mostra as próximas 3 vezes). */
export type Ambiguity = 'no-time' | 'ampm' | 'min-interval';

export interface ParsedSchedule {
  spec: ScheduleSpec;
  command: string;
  ambiguous: Ambiguity[];
}

// Minúsculas e sem acento, mantendo o MESMO comprimento do texto (NFC) pra recortar o original.
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, 'forty-five': 45,
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, oito: 8, dez: 10, doze: 12,
  quinze: 15, vinte: 20, trinta: 30,
  uno: 1, dos: 2, cuatro: 4, diez: 10, quince: 15, veinte: 20, treinta: 30,
};
const NUM_RE = `\\d{1,4}|${Object.keys(NUM).sort((a, b) => b.length - a.length).join('|')}`;

const DAY_NAMES: Array<[string, number]> = [
  ['sunday', 0], ['monday', 1], ['tuesday', 2], ['wednesday', 3], ['thursday', 4], ['friday', 5], ['saturday', 6],
  ['domingo', 0], ['segunda', 1], ['terca', 2], ['quarta', 3], ['quinta', 4], ['sexta', 5], ['sabado', 6],
  ['lunes', 1], ['martes', 2], ['miercoles', 3], ['jueves', 4], ['viernes', 5],
];
const DAY = `(?:${DAY_NAMES.map(d => d[0]).join('|')})s?(?:[- ]feiras?)?`;
const DAY_PREFIX = '(?:every|each|toda|todo|todas\\s+as|todos\\s+os|aos|nas|nos|cada|todos\\s+los|los)';
const DAY_JOIN = '\\s*(?:,|and|&|e|y)\\s*(?:on\\s+|as\\s+|aos\\s+|nas\\s+|los\\s+)?';

interface Hit { start: number; end: number }

/** Dias citados num trecho ("monday and thursday" → [1, 4]). */
function daysIn(s: string): number[] {
  const out = new Set<number>();
  const re = new RegExp(`\\b(${DAY_NAMES.map(d => d[0]).join('|')})`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) { const d = DAY_NAMES.find(x => x[0] === m![1]); if (d) out.add(d[1]); }
  return [...out].sort((a, b) => a - b);
}

interface Recur { spec: ScheduleSpec | { kind: 'weekly-days'; days: number[]; defaultHour?: number; period?: 'am' | 'pm' }; hit: Hit; interval: boolean; clampedMin?: boolean }

function findRecurrence(n: string): Recur | null {
  let m: RegExpExecArray | null;
  const hit = (mm: RegExpExecArray): Hit => ({ start: mm.index, end: mm.index + mm[0].length });
  // A cada N minutos/horas (e "hourly", "de hora em hora", "every half hour").
  const ivRe = new RegExp(`\\b(?:every|each|a\\s+cada|cada)\\s+(?:(half\\s+an?|half|meia|media)\\s+)?(?:(${NUM_RE})\\s*)?(minutes?|mins?|hours?|hrs?|h|minutos?|horas?|hora)\\b`);
  m = ivRe.exec(n);
  if (m) {
    const half = !!m[1];
    const v = m[2] ? (NUM[m[2]] ?? parseInt(m[2], 10)) : 1;
    const isHour = /^h/.test(m[3]);
    let min = half ? 30 : v * (isHour ? 60 : 1);
    const clamped = min < MIN_INTERVAL_MIN;
    min = Math.min(Math.max(min, MIN_INTERVAL_MIN), MAX_INTERVAL_MIN);
    return { spec: { kind: 'interval', everyMin: min }, hit: hit(m), interval: true, clampedMin: clamped };
  }
  m = /\b(?:hourly|de\s+hora\s+em\s+hora)\b/.exec(n);
  if (m) return { spec: { kind: 'interval', everyMin: 60 }, hit: hit(m), interval: true };
  // Dias úteis / fim de semana.
  m = /\b(?:(?:every|each|on)\s+weekdays?|weekdays|(?:todo|todos\s+os|nos|em)\s+dias?\s+uteis|dias?\s+uteis|de\s+segunda\s+a\s+sexta(?:[- ]feira)?|(?:every\s+|on\s+)?monday\s+(?:to|through|thru|-)\s+friday|(?:todos\s+los\s+|los\s+)?dias\s+(?:habiles|laborables)|de\s+lunes\s+a\s+viernes|entre\s+semana)\b/.exec(n);
  if (m) return { spec: { kind: 'weekly-days', days: WEEKDAYS }, hit: hit(m), interval: false };
  m = /\b(?:(?:every|on)\s+(?:the\s+)?weekends?|weekends|(?:todo|nos|aos)\s+fins?\s+de\s+semana|(?:todos\s+los|los|cada)\s+fin(?:es)?\s+de\s+semana)\b/.exec(n);
  if (m) return { spec: { kind: 'weekly-days', days: [0, 6] }, hit: hit(m), interval: false };
  // Dias da semana com prefixo de repetição ("every monday and thursday", "toda segunda", "los lunes").
  // "on mondays"/"às segundas" (plural) também; "on monday" sozinho é uma vez só — não agenda.
  const wkRe = new RegExp(`\\b(?:${DAY_PREFIX}\\s+${DAY}|(?:on|as)\\s+(?:${DAY_NAMES.map(d => d[0]).join('|')})s(?:[- ]feiras)?)(?:${DAY_JOIN}${DAY})*\\b`);
  m = wkRe.exec(n);
  if (m) return { spec: { kind: 'weekly-days', days: daysIn(m[0]) }, hit: hit(m), interval: false };
  // Manhã / noite todo dia.
  m = /\b(?:every\s+morning|each\s+morning|toda\s+manha|todas\s+as\s+manhas|cada\s+manana|todas\s+las\s+mananas)\b/.exec(n);
  if (m) return { spec: { kind: 'weekly-days', days: EVERY_DAY, defaultHour: 8, period: 'am' }, hit: hit(m), interval: false };
  m = /\b(?:every\s+(?:evening|night)|each\s+(?:evening|night)|toda\s+noite|todas\s+as\s+noites|cada\s+noche|todas\s+las\s+noches)\b/.exec(n);
  if (m) return { spec: { kind: 'weekly-days', days: EVERY_DAY, defaultHour: 19, period: 'pm' }, hit: hit(m), interval: false };
  m = /\b(?:every\s*day|everyday|each\s+day|daily|todo\s+(?:o\s+)?dia|todos\s+os\s+dias|diariamente|cada\s+dia|todos\s+los\s+dias|a\s+diario)\b/.exec(n);
  if (m) return { spec: { kind: 'weekly-days', days: EVERY_DAY }, hit: hit(m), interval: false };
  return null;
}

interface TimeHit { hour: number; minute: number; ambiguous: boolean; hit: Hit }

function findTime(n: string): TimeHit | null {
  let m: RegExpExecArray | null;
  const hit = (mm: RegExpExecArray): Hit => ({ start: mm.index, end: mm.index + mm[0].length });
  m = /\b(?:at\s+|ao\s+|al\s+|as\s+|a\s+las\s+)?(noon|midday|meio[- ]dia|mediodia)\b/.exec(n);
  if (m) return { hour: 12, minute: 0, ambiguous: false, hit: hit(m) };
  m = /\b(?:at\s+|a\s+|a\s+la\s+)?(midnight|meia[- ]noite|medianoche)\b/.exec(n);
  if (m) return { hour: 0, minute: 0, ambiguous: false, hit: hit(m) };
  // Período ("in the morning", "da tarde", "de la noche") decide am/pm quando a hora não diz.
  const PERIOD = '(?:\\s+(in\\s+the\\s+morning|in\\s+the\\s+afternoon|in\\s+the\\s+evening|at\\s+night|da\\s+manha|da\\s+tarde|da\\s+noite|de\\s+la\\s+manana|de\\s+la\\s+tarde|de\\s+la\\s+noche))?';
  const withPrefix = new RegExp(`(?:^|\\s|,)(?:at|@|as|a\\s+las|a\\s+la|by)\\s+(\\d{1,2})(?:[:.h](\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?|h(?:rs?)?|horas?|o'?clock)?${PERIOD}(?=$|[\\s,.;:!?])`);
  const bare = new RegExp(`(?:^|\\s|,)(\\d{1,2})(?:[:.](\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)${PERIOD}(?=$|[\\s,.;:!?])|(?:^|\\s|,)(\\d{1,2})h(\\d{2})?(?=$|[\\s,.;:!?])`);
  m = withPrefix.exec(n);
  let hour: number, minute: number, suffix: string | undefined, period: string | undefined, raw: string;
  if (m) { hour = +m[1]; minute = m[2] ? +m[2] : 0; suffix = m[3]; period = m[4]; raw = m[1]; }
  else {
    m = bare.exec(n);
    if (!m) return null;
    if (m[1] !== undefined) { hour = +m[1]; minute = m[2] ? +m[2] : 0; suffix = m[3]; period = m[4]; raw = m[1]; }
    else { hour = +m[5]; minute = m[6] ? +m[6] : 0; suffix = 'h'; raw = m[5]; }
  }
  if (hour > 23 || minute > 59) return null;
  // O casamento pode ter começado no espaço/vírgula antes: o recorte começa no texto.
  const lead = /^[\s,]*/.exec(m[0])![0].length;
  const h = { start: m.index + lead, end: m.index + m[0].length };
  const sfx = (suffix || '').replace(/\./g, '');
  const pm = sfx === 'pm' || /afternoon|evening|night|tarde|noite|noche/.test(period || '');
  const am = sfx === 'am' || /morning|manha|manana/.test(period || '');
  if (pm || am) {
    if (hour > 12) return { hour, minute, ambiguous: false, hit: h };
    if (pm && hour < 12) hour += 12;
    if (am && hour === 12) hour = 0;
    return { hour, minute, ambiguous: false, hit: h };
  }
  // "8h", "20:00", "08:00": relógio de 24 horas, sem dúvida. "at 8" / "at 8:30": manhã ou noite?
  const h24 = /^h|hora/.test(sfx) || hour > 12 || hour === 0 || raw.length === 2 && raw.startsWith('0');
  if (h24) return { hour, minute, ambiguous: false, hit: h };
  // Palpite: 7–11 de manhã, 12 meio-dia, 1–6 de tarde. O cartão mostra e a pessoa confirma.
  if (hour >= 1 && hour <= 6) hour += 12;
  return { hour, minute, ambiguous: true, hit: h };
}

const VERB = /^\s*(?:please\s+|por\s+favor\s+)?(?:schedule(?:\s+a\s+task)?|set\s+up\s+a\s+(?:scheduled\s+)?task|agend[ae]r?(?:\s+uma\s+tarefa)?|program[ae]r?(?:\s+uma\s+tarefa|\s+una\s+tarea)?)\s*(?:to\s+|para\s+|pra\s+|que\s+|:\s*)?/;

/**
 * "every weekday at 8am check my Indeed recommendations" → a regra + o pedido.
 * null = não é pedido de agendamento (segue o fluxo normal).
 */
export function parseSchedule(text: string): ParsedSchedule | null {
  const orig = String(text || '').normalize('NFC').slice(0, MAX_COMMAND + 200);
  let n = fold(orig);
  // Sem o mesmo comprimento não dá pra recortar o original pelos índices: usa o texto dobrado.
  const src = n.length === orig.length ? orig : n;
  // "repete a cada 5 min" é replay de macro (macros.ts), não agendamento.
  if (/\brepet\w*\b|\brepeat\b/.test(n)) return null;
  const verb = VERB.exec(n);
  const verbEnd = verb ? verb[0].length : 0;
  const r = findRecurrence(n);
  if (!r) return null;
  // Hora só conta fora do trecho da repetição ("every 2 hours" não é "às 2").
  const blank = (s: string, h: Hit) => s.slice(0, h.start) + ' '.repeat(h.end - h.start) + s.slice(h.end);
  const tm = r.interval ? null : findTime(blank(n, r.hit));
  // Começar pela repetição (ou pelo verbo) = é um agendamento; no meio da frase só com hora, intervalo
  // ou verbo ("check the news every day" sozinho é ambíguo demais: pode ser só conversa).
  const atStart = r.hit.start <= verbEnd + 1;
  if (!(verb || tm || r.interval || atStart)) return null;
  const cut: Hit[] = [r.hit, ...(tm ? [tm.hit] : []), ...(verb ? [{ start: 0, end: verbEnd }] : [])].sort((a, b) => b.start - a.start);
  let cmd = src;
  for (const h of cut) cmd = cmd.slice(0, h.start) + ' ' + cmd.slice(h.end);
  cmd = cleanCommand(cmd);
  if (cmd.replace(/[^\p{L}\p{N}]/gu, '').length < 3) return null;
  const ambiguous: Ambiguity[] = [];
  let spec: ScheduleSpec;
  if (r.spec.kind === 'interval') {
    spec = r.spec;
    if (r.clampedMin) ambiguous.push('min-interval');
  } else {
    const days = r.spec.kind === 'weekly-days' ? r.spec.days : EVERY_DAY;
    let hour: number, minute = 0;
    if (tm) {
      hour = tm.hour; minute = tm.minute;
      // "every morning at 8": a manhã tira a dúvida; "every evening at 7" → 19h.
      if (tm.ambiguous && r.spec.kind === 'weekly-days' && r.spec.period) {
        const base = tm.hour % 12;
        hour = r.spec.period === 'pm' ? base + 12 : base;
      } else if (tm.ambiguous) ambiguous.push('ampm');
    } else {
      hour = (r.spec.kind === 'weekly-days' && r.spec.defaultHour) || 9;
      ambiguous.push('no-time');
    }
    spec = { kind: 'weekly', days, hour, minute };
  }
  return { spec, command: cmd.slice(0, MAX_COMMAND), ambiguous };
}

function cleanCommand(s: string): string {
  let c = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4; i++) {
    const before = c;
    c = c.replace(/^(?:[,;:.\-–—]+|and then|and|then|e depois|e|y luego|y|to|para|pra|que|please|por favor)(?:\s+|$)/i, '').trim();
    c = c.replace(/^[,;:.\-–—]+/, '').trim();
    c = c.replace(/(?:\s+(?:and|e|y|on|at|as|às|a las|nas|nos|los))+\s*$/i, '').replace(/[,;:\-–—]+$/, '').trim();
    if (c === before) break;
  }
  return c;
}

// ── PRÓXIMAS VEZES (hora local, horário de verão incluído) ───────────────────

/** A primeira vez DEPOIS de `after` (ms). Intervalo: `after` + N minutos. */
export function nextRunAfter(spec: ScheduleSpec, after: number): number {
  if (spec.kind === 'interval') return after + Math.max(spec.everyMin, MIN_INTERVAL_MIN) * 60_000;
  const days = spec.days.length ? spec.days : EVERY_DAY;
  const base = new Date(after);
  for (let d = 0; d <= 8; d++) {
    // Dia da semana pelo meio-dia local: meia-noite pode não existir (horário de verão em alguns fusos).
    const noon = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d, 12, 0, 0, 0);
    if (!days.includes(noon.getDay())) continue;
    // Data/hora LOCAL: 8h é 8h antes e depois da troca de horário. Hora que não existe (salto da
    // primavera, 2h30) o Date empurra pra frente (3h30) — roda logo depois, não some.
    const at = new Date(noon.getFullYear(), noon.getMonth(), noon.getDate(), spec.hour, spec.minute, 0, 0).getTime();
    if (at > after) return at;
  }
  return after + 24 * 3600_000;   // inalcançável (dias vazios já viraram todos)
}

/** As próximas `n` vezes a partir de `from`. */
export function nextRuns(spec: ScheduleSpec, from: number, n = 3): number[] {
  const out: number[] = [];
  let t = from;
  for (let i = 0; i < n; i++) { t = nextRunAfter(spec, t); out.push(t); }
  return out;
}

/**
 * Depois de disparar (ou pular) a vez `due`, a próxima que ainda está no futuro (`now`).
 * Intervalo segue a grade (não acumula atraso); semanal pula pro próximo dia/hora.
 */
export function advance(spec: ScheduleSpec, due: number, now: number): number {
  if (spec.kind === 'interval') {
    const step = Math.max(spec.everyMin, MIN_INTERVAL_MIN) * 60_000;
    if (due > now) return due;
    return due + (Math.floor((now - due) / step) + 1) * step;
  }
  return nextRunAfter(spec, Math.max(due, now));
}

// ── ADIAR (cartão das perdidas) ──────────────────────────────────────────────

/** A mesma hora do relógio `days` dias depois (data local: o dia da troca de horário tem 23/25h). */
export function addLocalDays(at: number, days: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime();
}

/** A primeira vez da regra em `at` ou depois (intervalo: na grade que começa em `due`). */
function firstRunFrom(spec: ScheduleSpec, due: number, at: number): number {
  return spec.kind === 'interval' ? advance(spec, due, at - 1) : nextRunAfter(spec, at - 1);
}

/**
 * "Adiar N dias" uma vez perdida (`due`, agora `now`): nada roda até a mesma hora daqui a N dias;
 * a próxima vez é a primeira da regra a partir daí (semanal: no dia/hora de sempre; intervalo: na
 * grade). A tarefa continua na lista e a regra segue normal depois.
 */
export function snoozeUntil(spec: ScheduleSpec, due: number, now: number, days: number): { until: number; nextAt: number } {
  const n = Math.min(Math.max(Math.round(Number(days)) || 1, 1), MAX_SNOOZE_DAYS);
  const until = addLocalDays(now, n);
  return { until, nextAt: firstRunFrom(spec, due, until) };
}

/**
 * Próxima vez depois de `at` respeitando um adiamento ainda valendo (editar a regra ou religar a
 * tarefa no meio do adiamento não o desfaz).
 */
export function nextRunRespectingSnooze(spec: ScheduleSpec, at: number, snoozedUntil?: number): number {
  return snoozedUntil && snoozedUntil > at ? firstRunFrom(spec, snoozedUntil, snoozedUntil) : nextRunAfter(spec, at);
}

// ── VEZES PERDIDAS ───────────────────────────────────────────────────────────

export type DueState = 'not-due' | 'due' | 'missed';

/**
 * Na abertura do Bah, toda vez que já passou foi perdida (ele estava fechado): é oferecida, nunca
 * roda sozinha. Com ele aberto, passou há pouco = roda; passou há muito (o computador dormiu) =
 * também vira oferta.
 */
export function dueState(task: Pick<ScheduledTask, 'enabled' | 'nextAt'>, now: number, atLaunch: boolean, graceMs = DUE_GRACE_MS): DueState {
  if (!task.enabled || !(task.nextAt > 0) || task.nextAt > now) return 'not-due';
  if (atLaunch || now - task.nextAt > graceMs) return 'missed';
  return 'due';
}

/** Quantas vezes passaram entre `nextAt` e `now` (pro "perdeu 3 vezes"). Teto 999. */
export function missedCount(spec: ScheduleSpec, nextAt: number, now: number): number {
  if (nextAt > now) return 0;
  let n = 0, t = nextAt;
  while (t <= now && n < 999) { n++; t = nextRunAfter(spec, t); }
  return n;
}

// ── VALIDAÇÃO (o que vem do renderer / do disco) ─────────────────────────────

export function sanitizeSpec(s: any): ScheduleSpec | null {
  if (!s || typeof s !== 'object') return null;
  if (s.kind === 'interval') {
    const m = Math.round(Number(s.everyMin));
    if (!Number.isFinite(m)) return null;
    return { kind: 'interval', everyMin: Math.min(Math.max(m, MIN_INTERVAL_MIN), MAX_INTERVAL_MIN) };
  }
  if (s.kind === 'weekly') {
    const days = [...new Set((Array.isArray(s.days) ? s.days : []).map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() as number[];
    const hour = Math.round(Number(s.hour)), minute = Math.round(Number(s.minute));
    if (!days.length || !(hour >= 0 && hour <= 23) || !(minute >= 0 && minute <= 59)) return null;
    return { kind: 'weekly', days, hour, minute };
  }
  return null;
}

const OUTCOMES: RunOutcome[] = ['success', 'failed', 'cancelled', 'error', 'skipped'];
const str = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

export function sanitizeTask(t: any): ScheduledTask | null {
  if (!t || typeof t !== 'object') return null;
  const spec = sanitizeSpec(t.spec);
  const command = str(t.command, MAX_COMMAND);
  const id = str(t.id, 64);
  if (!spec || !command || !/^[\w-]+$/.test(id)) return null;
  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
  const history = (Array.isArray(t.history) ? t.history : [])
    .filter((r: any) => r && OUTCOMES.includes(r.outcome) && num(r.at))
    .map((r: any) => ({ at: Number(r.at), outcome: r.outcome as RunOutcome, summary: str(r.summary, MAX_SUMMARY), ...(r.missed ? { missed: true } : {}) }))
    .slice(-MAX_HISTORY);
  return {
    id, spec, command,
    name: str(t.name, MAX_NAME) || 'Task',
    enabled: t.enabled !== false,
    createdAt: num(t.createdAt) ?? Date.now(),
    nextAt: num(t.nextAt) ?? 0,
    ...(num(t.lastRunAt) ? { lastRunAt: num(t.lastRunAt) } : {}),
    ...(num(t.snoozedUntil) ? { snoozedUntil: num(t.snoozedUntil) } : {}),
    history,
  };
}

export function sanitizeTasks(list: unknown): ScheduledTask[] {
  const out: ScheduledTask[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(list) ? list : []) {
    const t = sanitizeTask(raw);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id); out.push(t);
    if (out.length >= MAX_TASKS) break;
  }
  return out;
}

/** Guarda o resultado de uma vez (mais nova por último, teto MAX_HISTORY). */
export function withRun(task: ScheduledTask, rec: RunRecord): ScheduledTask {
  const r = { ...rec, summary: str(rec.summary, MAX_SUMMARY) };
  return { ...task, lastRunAt: rec.outcome === 'skipped' ? task.lastRunAt : rec.at, history: [...task.history, r].slice(-MAX_HISTORY) };
}

/** Só o QUANDO (campo do painel): "every weekday at 8am" → a regra. null = não entendeu. */
export function parseWhen(text: string): { spec: ScheduleSpec; ambiguous: Ambiguity[] } | null {
  const s = String(text || '').trim();
  if (!s) return null;
  const p = parseSchedule(`${s} — zzqtask`);
  return p && p.command === 'zzqtask' ? { spec: p.spec, ambiguous: p.ambiguous } : null;
}
