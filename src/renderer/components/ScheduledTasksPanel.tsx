import { useMemo, useState } from 'react';
import { t } from '../i18n';
import { nextRuns, parseWhen, SNOOZE_DAYS, type ScheduledTask, type RunOutcome } from '../../shared/schedule';
import { ambiguityNote, describeSchedule, fmtWhen } from '../schedule-format';
import type { Scheduler } from '../scheduler';

const OUTCOME_ICON: Record<RunOutcome, string> = { success: '✅', failed: '⚠️', cancelled: '✖️', error: '❌', skipped: '⏭️' };

/** ⏰ Tarefas agendadas (menu ⋮): criar, editar, pausar, apagar, rodar agora, ver o histórico. */
export function ScheduledTasksPanel({ sched, onClose }: { sched: Scheduler; onClose: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);   // id em edição; null = nova
  const [command, setCommand] = useState('');
  const [when, setWhen] = useState('');
  const [whenTouched, setWhenTouched] = useState(false);
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const current = editing ? sched.tasks.find(x => x.id === editing) : undefined;
  const parsed = useMemo(() => (whenTouched || !current ? parseWhen(when) : { spec: current.spec, ambiguous: [] }), [when, whenTouched, current]);
  const preview = parsed ? nextRuns(parsed.spec, sched.now(), 3) : [];

  const startEdit = (task: ScheduledTask) => {
    setEditing(task.id); setCommand(task.command); setWhen(describeSchedule(task.spec)); setWhenTouched(false);
  };
  const reset = () => { setEditing(null); setCommand(''); setWhen(''); setWhenTouched(false); };
  const save = () => {
    if (!parsed || !command.trim()) return;
    if (editing) sched.update(editing, { command, ...(whenTouched ? { spec: parsed.spec } : {}) });
    else sched.add(command, parsed.spec);
    reset();
  };

  const status = (task: ScheduledTask) => {
    const r = sched.run;
    if (r?.taskId === task.id) {
      return r.status === 'waiting'
        ? <span className="mon-chip err sched-waiting" title={r.waitMessage}>{t('sched.waiting')}</span>
        : <span className="mon-chip met">{t('sched.running')}</span>;
    }
    if (sched.missed.some(o => o.taskId === task.id)) return <span className="mon-chip err">{t('sched.missedChip')}</span>;
    if (sched.queue.includes(task.id)) return <span className="mon-chip watching">{t('sched.queued')}</span>;
    if (!task.enabled) return <span className="mon-chip off">{t('mon.paused')}</span>;
    if (task.snoozedUntil && task.snoozedUntil > sched.now()) return <span className="mon-chip off" data-testid="sched-snoozed">{t('sched.snoozedChip', { when: fmtWhen(task.nextAt) })}</span>;
    return <span className="mon-chip watching">{t('sched.next', { when: fmtWhen(task.nextAt) })}</span>;
  };

  return (
    <div className="tour-backdrop" onClick={onClose}>
      <div className="tour-card proxy-card sched-panel" data-testid="sched-panel" onClick={e => e.stopPropagation()}>
        <div className="tour-head">
          <span className="tour-title">⏰ {t('sched.title')}</span>
          <button className="tour-x" onClick={onClose} aria-label={t('proxy.close')}>✕</button>
        </div>
        <div className="proxy-hint">{t('sched.hint')}</div>
        {!sched.available && <div className="proxy-hint">{t('sched.noVault')}</div>}

        {sched.run && (
          <div className={`sched-now ${sched.run.status}`} data-testid="sched-now">
            <span>{sched.run.status === 'waiting' ? `⏸ ${t('sched.waitingFor', { name: sched.tasks.find(x => x.id === sched.run!.taskId)?.name || '' })}` : `▶ ${t('sched.runningNow', { name: sched.tasks.find(x => x.id === sched.run!.taskId)?.name || '' })}`}</span>
            {sched.run.waitMessage && <div className="sched-now-msg">{sched.run.waitMessage}</div>}
            <button className="tour-btn" onClick={() => { sched.focusRun(); onClose(); }}>{t('sched.show')}</button>
          </div>
        )}

        <div className="sched-form">
          <label className="proxy-row">
            <span>{t('sched.what')}</span>
            <input data-testid="sched-command" value={command} onChange={e => setCommand(e.target.value)} placeholder={t('sched.whatPh')} maxLength={1000} />
          </label>
          <label className="proxy-row">
            <span>{t('sched.when')}</span>
            <input data-testid="sched-when" value={when} onChange={e => { setWhen(e.target.value); setWhenTouched(true); }} placeholder={t('sched.whenPh')} />
          </label>
          <div className="sched-preview" data-testid="sched-preview">
            {parsed
              ? <>
                  <div>{describeSchedule(parsed.spec)}{parsed.ambiguous.length ? ` — ${ambiguityNote(parsed.ambiguous)}` : ''}</div>
                  <div className="sched-next3">{t('sched.next3')} {preview.map(fmtWhen).join(' · ')}</div>
                </>
              : when.trim() ? <div className="sched-bad">{t('sched.notUnderstood')}</div> : null}
          </div>
          <div className="tour-foot proxy-foot">
            {editing && <button className="tour-btn" onClick={reset}>{t('sched.cancel')}</button>}
            <button className="tour-btn tour-btn-primary" data-testid="sched-save" disabled={!parsed || !command.trim()} onClick={save}>{editing ? t('sched.saveEdit') : t('sched.add')}</button>
          </div>
        </div>

        {sched.tasks.length === 0
          ? <div className="history-empty">{t('sched.empty')}</div>
          : (
            <div className="sched-list">
              {sched.tasks.map(task => (
                <div key={task.id} className="mon-item sched-item" data-testid="sched-item">
                  <div className="mon-item-top">
                    {status(task)}
                    <span className="mon-item-cond" title={task.command}>{task.name}</span>
                  </div>
                  <div className="mon-item-url" title={task.command}>{task.command}</div>
                  <div className="mon-item-actions">
                    <span className="mon-item-meta">{describeSchedule(task.spec)}</span>
                    <div className="mon-item-btns">
                      <button data-testid="sched-run-now" onClick={() => sched.runNow(task.id)} title={t('sched.runNow')} disabled={sched.run?.taskId === task.id}>▶︎</button>
                      <button data-testid="sched-toggle" onClick={() => sched.update(task.id, { enabled: !task.enabled })} title={task.enabled ? t('mon.pause') : t('mon.resume')}>{task.enabled ? '⏸' : '⏵'}</button>
                      <button onClick={() => startEdit(task)} title={t('sched.edit')}>✎</button>
                      <button data-testid="sched-delete" onClick={() => { sched.remove(task.id); if (editing === task.id) reset(); }} title={t('mon.remove')} className="mon-del">🗑</button>
                    </div>
                  </div>
                  {task.history.length > 0 && (
                    <>
                      <button className="sched-hist-toggle" onClick={() => setOpenHistory(openHistory === task.id ? null : task.id)}>
                        {openHistory === task.id ? '▾' : '▸'} {t('sched.history', { n: task.history.length })}
                      </button>
                      {openHistory === task.id && (
                        <ul className="sched-history" data-testid="sched-history">
                          {[...task.history].reverse().map((h, i) => (
                            <li key={i} className={`sched-h-${h.outcome}`}>
                              {OUTCOME_ICON[h.outcome]} {fmtWhen(h.at)} — {t(`sched.out.${h.outcome}`)}{h.summary ? `: ${h.summary}` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

/** Na abertura: o que venceu com o Bah fechado. Nada roda sem a pessoa escolher. */
export function MissedRunsCard({ sched }: { sched: Scheduler }) {
  if (!sched.missed.length) return null;
  return (
    <div className="sched-missed" data-testid="sched-missed" role="dialog" aria-label={t('sched.missedTitle')}>
      <div className="tour-head">
        <span className="tour-title">⏰ {t('sched.missedTitle')}</span>
      </div>
      <div className="proxy-hint">{t('sched.missedHint')}</div>
      {sched.missed.map(o => {
        const task = sched.tasks.find(x => x.id === o.taskId);
        if (!task) return null;
        return <MissedRow key={o.taskId} sched={sched} task={task} count={o.count} dueAt={o.dueAt} />;
      })}
    </div>
  );
}

/** Uma perdida: Rodar agora / Pular / Adiar (1, 3 ou 7 dias) / Apagar (pede confirmação: não tem volta). */
function MissedRow({ sched, task, count, dueAt }: { sched: Scheduler; task: ScheduledTask; count: number; dueAt: number }) {
  const [mode, setMode] = useState<'snooze' | 'delete' | null>(null);
  return (
    <div className="sched-missed-row" data-testid="sched-missed-row">
      <div className="sched-missed-text">
        <b>{task.name}</b> — {task.command}
        <div className="mon-item-meta">{count > 1 ? t('sched.missedMany', { n: count, when: fmtWhen(dueAt) }) : t('sched.missedOne', { when: fmtWhen(dueAt) })}</div>
      </div>
      {mode === null && (
        <div className="sched-missed-btns">
          <button className="tour-btn tour-btn-primary" data-testid="sched-missed-run" onClick={() => sched.resolveMissed(task.id, 'run')}>{t('sched.runNow')}</button>
          <button className="tour-btn" data-testid="sched-missed-skip" onClick={() => sched.resolveMissed(task.id, 'skip')}>{t('sched.skip')}</button>
          <button className="tour-btn" data-testid="sched-missed-snooze" onClick={() => setMode('snooze')}>{t('sched.snooze')}</button>
          <button className="tour-btn sched-missed-del" data-testid="sched-missed-delete" onClick={() => setMode('delete')}>{t('sched.deleteTask')}</button>
        </div>
      )}
      {mode === 'snooze' && (
        <div className="sched-missed-choice" data-testid="sched-missed-snooze-choices">
          <span>{t('sched.snoozeFor')}</span>
          <div className="sched-missed-btns">
            {SNOOZE_DAYS.map(d => (
              <button key={d} className="tour-btn" data-testid={`sched-snooze-${d}`} onClick={() => sched.resolveMissed(task.id, 'snooze', d)}>
                {d === 1 ? t('sched.snooze1') : t('sched.snoozeN', { n: d })}
              </button>
            ))}
            <button className="tour-btn" onClick={() => setMode(null)}>{t('sched.cancel')}</button>
          </div>
        </div>
      )}
      {mode === 'delete' && (
        <div className="sched-missed-choice" data-testid="sched-missed-delete-confirm">
          <span>{t('sched.deleteConfirm', { name: task.name })}</span>
          <div className="sched-missed-btns">
            <button className="tour-btn sched-missed-del-yes" data-testid="sched-missed-delete-yes" onClick={() => sched.resolveMissed(task.id, 'delete')}>{t('sched.deleteYes')}</button>
            <button className="tour-btn" data-testid="sched-missed-delete-no" onClick={() => setMode(null)}>{t('sched.keep')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
