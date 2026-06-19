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
    const runs = loadRuns().filter(r => r.id !== run.id);
    runs.push(run);
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
