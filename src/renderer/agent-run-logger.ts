import type { BrowserAction, ToolResult } from './page-executor';
import type { ManualHelpRequest } from './agent-login-policy';

const RUNS_KEY = 'agentRuns.v1';
const MAX_RUNS = 50;
const MAX_STEPS_PER_RUN = 120;

export interface AgentRunStepLog {
  /** Preenchido automaticamente por appendAgentRunStep quando omitido. */
  ts?: number;
  step?: number;
  urlBefore?: string;
  urlAfter?: string;
  titleAfter?: string;
  /**
   * O estado da página que o agente VIU antes de escolher a ação (url + elementos
   * interativos). É o "input" do par (observação → ação) — o dado de treino. Fica
   * SÓ no dataset em disco; é removido antes de salvar no localStorage (que é leve, só UI).
   */
  observation?: unknown;
  action?: string;
  actionType?: string;
  result?: unknown;
  success?: boolean;
  evaluation?: string;
  thought?: string;
  recovery?: { decision: string; reason: string; blocker?: string };
  manualHelp?: {
    kind: ManualHelpRequest['kind'];
    reason: string;
    beforeUrl: string;
    afterUrl?: string;
  };
  note?: string;
}

export interface AgentRunLog {
  id: string;
  command: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'success' | 'failed' | 'cancelled' | 'max_steps';
  finalReason?: string;
  steps: AgentRunStepLog[];
}

export function startAgentRun(command: string): AgentRunLog {
  const run: AgentRunLog = {
    id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    command,
    startedAt: Date.now(),
    status: 'running',
    steps: [],
  };
  saveRun(run);
  return run;
}

export function appendAgentRunStep(run: AgentRunLog, step: AgentRunStepLog): void {
  run.steps.push({
    ...step,
    ts: step.ts || Date.now(),
    result: trimForStorage(step.result),
  });
  if (run.steps.length > MAX_STEPS_PER_RUN) {
    run.steps = run.steps.slice(-MAX_STEPS_PER_RUN);
  }
  saveRun(run);
}

export function finishAgentRun(
  run: AgentRunLog,
  status: AgentRunLog['status'],
  finalReason?: string,
): void {
  run.status = status;
  run.finalReason = finalReason;
  run.endedAt = Date.now();
  saveRun(run);
  // Dataset em disco — OPT-IN, DESLIGADO por padrão. Só grava se o coletor estiver
  // ligado nesta máquina (localStorage 'datasetCollect' === 'on'). Pros usuários comuns
  // nada é gravado (privacidade + é inútil pra eles); quem quer coletar (o dono) liga na
  // própria máquina: localStorage.setItem('datasetCollect','on'). Nunca quebra o loop.
  try {
    if (localStorage.getItem('datasetCollect') === 'on') {
      (window as any).electronAPI?.appendDatasetRun?.(run);
    }
  } catch {}
}

export function summarizeAction(action: BrowserAction): { action: string; actionType: string } {
  return {
    action: JSON.stringify(action).slice(0, 600),
    actionType: action.type,
  };
}

export function summarizeResult(result: ToolResult | unknown): unknown {
  return trimForStorage(result);
}

function saveRun(run: AgentRunLog): void {
  try {
    // A versão do localStorage é leve (só pra UI de histórico): remove a `observation`
    // pesada dos passos. O dado completo (com observação) vai só pro dataset em disco.
    const lean: AgentRunLog = {
      ...run,
      steps: run.steps.map(({ observation, ...rest }) => rest),
    };
    const runs = loadRuns().filter(r => r.id !== lean.id);
    runs.push(lean);
    const trimmed = runs.sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_RUNS);
    localStorage.setItem(RUNS_KEY, JSON.stringify(trimmed));
  } catch {
    // Logging must never break the agent loop.
  }
}

function loadRuns(): AgentRunLog[] {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function trimForStorage(value: unknown): unknown {
  try {
    const text = JSON.stringify(value);
    if (!text) return value;
    if (text.length <= 1200) return value;
    return `${text.slice(0, 1190)}...`;
  } catch {
    return String(value).slice(0, 1200);
  }
}
