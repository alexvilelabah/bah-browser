// Texto das tarefas agendadas na tela ("Weekdays at 8:00 AM", "Every 2 h"). Dias e horas vêm do
// Intl no idioma do Bah — só as frases em volta passam pelo i18n.
import { getLang, t } from './i18n';
import { EVERY_DAY, WEEKDAYS, type ScheduleSpec, type Ambiguity } from '../shared/schedule';

const locale = () => (getLang() === 'pt' ? 'pt-BR' : getLang() === 'es' ? 'es' : 'en-US');
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function fmtClock(hour: number, minute: number): string {
  try { return new Date(2000, 0, 2, hour, minute).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }); }
  catch { return `${hour}:${String(minute).padStart(2, '0')}`; }
}

function dayName(d: number): string {
  // 2000-01-02 foi domingo: +d dias = o dia da semana d.
  try { return new Date(2000, 0, 2 + d, 12).toLocaleDateString(locale(), { weekday: 'long' }); } catch { return String(d); }
}

export function describeSchedule(spec: ScheduleSpec): string {
  if (spec.kind === 'interval') {
    if (spec.everyMin === 60) return t('sched.everyHour');
    if (spec.everyMin % 60 === 0) return t('sched.everyHours', { n: spec.everyMin / 60 });
    return t('sched.everyMinutes', { n: spec.everyMin });
  }
  const time = fmtClock(spec.hour, spec.minute);
  const days = [...spec.days].sort((a, b) => a - b);
  if (same(days, EVERY_DAY)) return t('sched.daily', { time });
  if (same(days, WEEKDAYS)) return t('sched.weekdays', { time });
  if (same(days, [0, 6])) return t('sched.weekends', { time });
  return t('sched.weekly', { days: days.map(dayName).join(', '), time });
}

export function fmtWhen(ts: number): string {
  try { return new Date(ts).toLocaleString(locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return new Date(ts).toISOString(); }
}

export function ambiguityNote(a: Ambiguity[]): string {
  const key: Record<Ambiguity, string> = { 'no-time': 'noTime', ampm: 'ampm', 'min-interval': 'minInterval' };
  return a.map(x => t(`sched.amb.${key[x]}`)).join(' ');
}
