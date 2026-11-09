// scheduler.ts — o relógio, a fila e a execução das TAREFAS AGENDADAS (regras puras em
// shared/schedule.ts; guardadas cifradas no main: src/main/scheduled-tasks.ts).
//  • roda só com o Bah aberto: um tique confere quem venceu;
//  • uma de cada vez, em fila; nunca por cima de uma tarefa da pessoa (o painel do assistente
//    só tem um agente por vez — a fila espera ele ficar livre);
//  • cada tarefa roda numa aba com sessão própria ("⏰ News"): a mesma aba é reaproveitada nas
//    próximas vezes enquanto estiver aberta (nada de uma aba nova a cada 15 minutos);
//  • o que venceu com o Bah fechado (ou dormindo) vira OFERTA "Rodar agora / Pular / Adiar N dias /
//    Apagar" — quem escolhe é sempre a pessoa;
//  • parou numa confirmação (freio de risco, perguntas, login) → espera a pessoa, com aviso do
//    sistema. Nada arriscado acontece sozinho: quem decide é o cartão, como sempre.
// A ponte com o painel do assistente é por eventos de janela (AgentCommandBar escuta):
//   'bah:sched-busy'  → detail.busy = há um agente/chat rodando;
//   'bah:sched-run'   → { tabId, command, hooks } → detail.accepted / detail.reason.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  advance, dueState, missedCount, nextRunAfter, nextRunRespectingSnooze, snoozeUntil, withRun, MAX_TASKS, MAX_NAME,
  type RunOutcome, type ScheduleSpec, type ScheduledTask,
} from '../shared/schedule';
import { sessionNameFor } from '../shared/agent-sessions';
import { t } from './i18n';
import { fmtWhen } from './schedule-format';

export interface SchedRun { taskId: string; tabId: string; status: 'starting' | 'running' | 'waiting'; waitMessage?: string; startedAt: number }
export interface MissedOffer { taskId: string; count: number; dueAt: number }

/** O que o painel do assistente chama de volta durante uma vez agendada. */
export interface ScheduledRunHooks {
  onWaiting: (message: string) => void;
  onResumed: () => void;
  onDone: (outcome: RunOutcome, summary: string) => void;
}

export interface SchedulerDeps {
  /** Abre (ou reaproveita) a aba da tarefa e a deixa ativa. Devolve o id da aba. */
  openRunTab: (task: ScheduledTask, reuseTabId?: string) => string;
  /** Garante a sessão com o nome da tarefa. false = a aba ainda não chegou no estado (tenta de novo). */
  ensureRunSession: (tabId: string, task: ScheduledTask) => boolean;
  focusTab: (tabId: string) => void;
  openPanel: () => void;
}

const api = () => (window as any).electronAPI;
const TICK_MS = 15_000;

export const taskNameFor = (command: string) => sessionNameFor(command).slice(0, MAX_NAME);

export function useScheduler(deps: SchedulerDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const tasksRef = useRef<ScheduledTask[]>([]);
  const [missed, setMissed] = useState<MissedOffer[]>([]);
  const missedRef = useRef<MissedOffer[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const queueRef = useRef<string[]>([]);
  const [run, setRunState] = useState<SchedRun | null>(null);
  const runRef = useRef<SchedRun | null>(null);
  const [available, setAvailable] = useState(true);
  const loadedRef = useRef(false);
  const offsetRef = useRef(0);   // relógio dos testes (E2E_SCHED_NOW / __bahSched.setNow); 0 no app de verdade
  const tabOfTask = useRef(new Map<string, string>());

  const now = () => Date.now() + offsetRef.current;
  const setRun = (r: SchedRun | null) => { runRef.current = r; setRunState(r); };
  const setQ = (q: string[]) => { queueRef.current = q; setQueue(q); };
  const setM = (m: MissedOffer[]) => { missedRef.current = m; setMissed(m); };
  const commit = (next: ScheduledTask[]) => {
    tasksRef.current = next;
    setTasks(next);
    void api()?.schedSave?.(next).catch?.(() => {});
  };
  const patchTask = (id: string, fn: (t: ScheduledTask) => ScheduledTask) =>
    commit(tasksRef.current.map(x => (x.id === id ? fn(x) : x)));

  const agentBusy = () => {
    const d: { busy?: boolean } = {};
    window.dispatchEvent(new CustomEvent('bah:sched-busy', { detail: d }));
    return !!d.busy;
  };

  const notify = (body: string, taskId: string) => {
    void api()?.schedNotify?.({ title: t('sched.notifyWaiting'), body: body.slice(0, 180), taskId })?.catch?.(() => {});
  };

  // ── EXECUÇÃO ──
  const finish = (taskId: string, outcome: RunOutcome, summary: string) => {
    patchTask(taskId, x => withRun(x, { at: now(), outcome, summary }));
    if (runRef.current?.taskId === taskId) setRun(null);
    setTimeout(pump, 400);
  };

  const attempt = (task: ScheduledTask, tabId: string, n: number) => {
    const cur = runRef.current;
    if (!cur || cur.taskId !== task.id) return;
    if (!depsRef.current.ensureRunSession(tabId, task)) {
      if (n > 40) { finish(task.id, 'error', t('sched.err.noTab')); return; }
      setTimeout(() => attempt(task, tabId, n + 1), 250);
      return;
    }
    const hooks: ScheduledRunHooks = {
      onWaiting: (message) => {
        if (runRef.current?.taskId !== task.id) return;
        setRun({ ...runRef.current, status: 'waiting', waitMessage: message });
        notify(`${task.name}: ${message}`, task.id);
      },
      onResumed: () => { if (runRef.current?.taskId === task.id) setRun({ ...runRef.current, status: 'running', waitMessage: undefined }); },
      onDone: (outcome, summary) => finish(task.id, outcome, summary),
    };
    const detail: { tabId: string; command: string; hooks: ScheduledRunHooks; accepted?: boolean; reason?: string } = { tabId, command: task.command, hooks };
    window.dispatchEvent(new CustomEvent('bah:sched-run', { detail }));
    if (detail.accepted) { setRun({ ...cur, status: 'running' }); return; }
    if (detail.reason === 'busy') {
      // A pessoa começou uma tarefa nesse meio-tempo: volta pro começo da fila e espera.
      setRun(null);
      setQ([task.id, ...queueRef.current.filter(x => x !== task.id)]);
      return;
    }
    if (n > 40) { finish(task.id, 'error', t('sched.err.noTab')); return; }
    setTimeout(() => attempt(task, tabId, n + 1), 250);
  };

  const pump = () => {
    if (runRef.current || !queueRef.current.length || agentBusy()) return;
    const [id, ...rest] = queueRef.current;
    setQ(rest);
    const task = tasksRef.current.find(x => x.id === id);
    if (!task) { setTimeout(pump, 0); return; }
    const tabId = depsRef.current.openRunTab(task, tabOfTask.current.get(id));
    tabOfTask.current.set(id, tabId);
    depsRef.current.openPanel();
    setRun({ taskId: id, tabId, status: 'starting', startedAt: now() });
    setTimeout(() => attempt(task, tabId, 0), 300);
  };

  const enqueue = (id: string) => {
    if (queueRef.current.includes(id) || runRef.current?.taskId === id) return;
    setQ([...queueRef.current, id]);
  };

  // ── RELÓGIO ──
  const tick = () => {
    if (!loadedRef.current) return;
    const at = now();
    let changed = false;
    const offers = [...missedRef.current];
    const next = tasksRef.current.map(task => {
      if (offers.some(o => o.taskId === task.id)) return task;   // esperando "Rodar agora / Pular"
      const st = dueState(task, at, false);
      if (st === 'missed') { offers.push({ taskId: task.id, count: missedCount(task.spec, task.nextAt, at), dueAt: task.nextAt }); return task; }
      if (st !== 'due') return task;
      enqueue(task.id);
      changed = true;
      const { snoozedUntil: _s, ...rest } = task;   // venceu = o adiamento (se havia) já acabou
      return { ...rest, nextAt: advance(task.spec, task.nextAt, at) };
    });
    if (offers.length !== missedRef.current.length) setM(offers);
    if (changed) commit(next);
    pump();
  };
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let alive = true;
    (async () => {
      let test = false;
      try { const c = await api()?.schedClock?.(); offsetRef.current = Number(c?.offset) || 0; test = !!c?.test; } catch {}
      let list: ScheduledTask[] = [];
      try { const r = await api()?.schedList?.(); list = r?.tasks || []; setAvailable(r?.available !== false); } catch {}
      if (!alive) return;
      tasksRef.current = list;
      setTasks(list);
      // Abertura: o que venceu com o Bah fechado é oferecido, não roda.
      const at = now();
      setM(list.filter(x => dueState(x, at, true) === 'missed').map(x => ({ taskId: x.id, count: missedCount(x.spec, x.nextAt, at), dueAt: x.nextAt })));
      loadedRef.current = true;
      if (test) {
        // Gancho dos testes E2E: mexe no relógio sem esperar horas.
        (window as any).__bahSched = {
          setNow: (ms: number) => { offsetRef.current = ms - Date.now(); tickRef.current(); },
          now: () => now(),
          state: () => ({ tasks: tasksRef.current, queue: queueRef.current, run: runRef.current, missed: missedRef.current }),
        };
      }
      timer = setInterval(() => tickRef.current(), test ? 400 : TICK_MS);
    })();
    const off = api()?.onSchedFocus?.((taskId: string) => {
      const r = runRef.current;
      if (r && (!taskId || r.taskId === taskId)) depsRef.current.focusTab(r.tabId);
      depsRef.current.openPanel();
    });
    return () => { alive = false; if (timer) clearInterval(timer); try { off?.(); } catch {} };
  }, []);

  // ── AÇÕES (painel / cartão do assistente / oferta da abertura) ──
  const add = useCallback((command: string, spec: ScheduleSpec): ScheduledTask | null => {
    const cmd = command.trim();
    if (!cmd || tasksRef.current.length >= MAX_TASKS) return null;
    const at = now();
    const task: ScheduledTask = {
      id: 'st_' + at.toString(36) + Math.random().toString(36).slice(2, 7),
      name: taskNameFor(cmd), command: cmd, spec, enabled: true, createdAt: at,
      nextAt: nextRunAfter(spec, at), history: [],
    };
    commit([...tasksRef.current, task]);
    return task;
  }, []);

  const update = useCallback((id: string, patch: { command?: string; spec?: ScheduleSpec; enabled?: boolean }) => {
    const at = now();
    patchTask(id, x => {
      const spec = patch.spec ?? x.spec;
      const enabled = patch.enabled ?? x.enabled;
      const command = patch.command?.trim() || x.command;
      const reschedule = !!patch.spec || (enabled && !x.enabled);
      return { ...x, command, name: command !== x.command ? taskNameFor(command) : x.name, spec, enabled, nextAt: reschedule ? nextRunRespectingSnooze(spec, at, x.snoozedUntil) : x.nextAt };
    });
    if (patch.enabled === false || patch.spec) setM(missedRef.current.filter(o => o.taskId !== id));
    if (patch.enabled === false) setQ(queueRef.current.filter(x => x !== id));
  }, []);

  const remove = useCallback((id: string) => {
    commit(tasksRef.current.filter(x => x.id !== id));
    setM(missedRef.current.filter(o => o.taskId !== id));
    setQ(queueRef.current.filter(x => x !== id));
    tabOfTask.current.delete(id);
  }, []);

  const runNow = useCallback((id: string) => { enqueue(id); pump(); }, []);

  /**
   * A escolha da pessoa no cartão das perdidas. 'snooze' = a vez perdida é dispensada e nada roda
   * por `days` dias (fica gravado em snoozedUntil/nextAt, sobrevive a reiniciar); 'delete' sai da
   * lista (o cartão já pediu confirmação).
   */
  const resolveMissed = useCallback((id: string, choice: 'run' | 'skip' | 'snooze' | 'delete', days?: number) => {
    if (choice === 'delete') { remove(id); return; }
    const offer = missedRef.current.find(o => o.taskId === id);
    setM(missedRef.current.filter(o => o.taskId !== id));
    const at = now();
    const n = offer?.count ?? 1;
    patchTask(id, x => {
      if (choice === 'snooze') {
        const s = snoozeUntil(x.spec, x.nextAt, at, days ?? 1);
        return withRun({ ...x, nextAt: s.nextAt, snoozedUntil: s.until }, { at, outcome: 'skipped', summary: t('sched.snoozedMissed', { n, when: fmtWhen(s.nextAt) }), missed: true });
      }
      const { snoozedUntil: _s, ...rest } = x;
      const moved = { ...rest, nextAt: advance(x.spec, x.nextAt, at) };
      return choice === 'skip'
        ? withRun(moved, { at, outcome: 'skipped', summary: t('sched.skippedMissed', { n }), missed: true })
        : moved;
    });
    if (choice === 'run') { enqueue(id); pump(); }
  }, [remove]);

  const focusRun = useCallback(() => {
    const r = runRef.current;
    if (r) { depsRef.current.focusTab(r.tabId); depsRef.current.openPanel(); }
  }, []);

  return { tasks, missed, queue, run, available, now, add, update, remove, runNow, resolveMissed, focusRun };
}

export type Scheduler = ReturnType<typeof useScheduler>;
