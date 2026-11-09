// alert/confirm/prompt das páginas (ver src/main/js-dialogs.ts). Durante uma tarefa, nas abas do agente:
//  • o agente pode "armar" a resposta do PRÓXIMO diálogo (ação dialog { accept, text }) — igual ao
//    `dialog accept/dismiss` do agent-browser;
//  • sem armar: alert → OK; confirm → OK, a não ser que o texto seja de pagamento/exclusão (aí pergunta
//    à pessoa). prompt() não existe no Electron (lança erro na página).
// Fora das abas do agente, a caixa é da pessoa.
import { classifyRisk } from './risk.ts';

export type JsDialog = { id: number; wcId: number; type: 'alert' | 'confirm' | 'prompt'; message: string; defaultText: string; origin: string };
const ARM_MS = 60_000;
const state = { active: false, wcIds: new Set<number>(), armed: new Map<number, { accept: boolean; text?: string; until: number }>(), log: [] as string[] };
const api = () => (typeof window === 'undefined' ? undefined : (window as any).electronAPI);

export function agentDialogsStart(): void { state.active = true; state.wcIds.clear(); state.armed.clear(); state.log = []; void api()?.jsDialogAgentTabs?.([]); }
export function agentDialogsStop(): void { state.active = false; state.wcIds.clear(); state.armed.clear(); void api()?.jsDialogAgentTabs?.([]); }
export function agentDialogsTab(wcId: number | undefined): void {
  if (wcId == null || !state.active || state.wcIds.has(wcId)) return;
  state.wcIds.add(wcId); void api()?.jsDialogAgentTabs?.([...state.wcIds]);
}
export function armDialog(wcId: number, accept: boolean, text?: string): void { state.armed.set(wcId, { accept, text, until: Date.now() + ARM_MS }); }
export function noteDialog(line: string): void { if (state.active) state.log.push(line); }
/** Linhas pro histórico do agente (e esvazia). */
export function drainDialogLog(): string { const s = state.log.map(l => `\nDIALOG: ${l}`).join(''); state.log = []; return s; }
export const isAgentTab = (wcId: number) => state.active && state.wcIds.has(wcId);

/** Resposta automática pra aba do agente; null = perguntar à pessoa. */
export function agentDecision(d: JsDialog): { accept: boolean; text?: string; note: string } | null {
  const q = `${d.type} "${d.message.slice(0, 160)}"`;
  const armed = state.armed.get(d.wcId);
  if (armed && armed.until > Date.now()) {
    state.armed.delete(d.wcId);
    return { accept: armed.accept, text: armed.text, note: `${q} → ${armed.accept ? 'accepted' : 'dismissed'}${d.type === 'prompt' && armed.accept ? ` with "${armed.text ?? ''}"` : ''} (as you armed it)` };
  }
  if (d.type === 'alert') return { accept: true, note: `${q} → closed (OK)` };
  if (d.type === 'prompt') return { accept: false, note: `${q} → dismissed. If the site needs an answer, arm it with { "action": "dialog", "accept": true, "text": "..." } and repeat the action.` };
  if (classifyRisk('click_ref', d.message)) return null;
  return { accept: true, note: `${q} → accepted (your action asked for it). To refuse next time, arm { "action": "dialog", "accept": false } first.` };
}
