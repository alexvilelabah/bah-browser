// Pergunta sobre o que o agente ACABOU de fazer ("did you click it, or block it?", "why did you stop?",
// "o que aconteceu?"). Antes ia pra busca na web — o "it" não apontava pra nada e a resposta falava de
// links suspeitos. Agora vai pro chat COM o resumo da última tarefa (o que foi pedido, cada passo e
// como terminou), então "it/that/you" têm a que se referir.

const ABOUT_RUN_RE = /\b(did|didn'?t|do|does|were|was|wasn'?t|have|haven'?t|has|why|how come)\s+(you|it|bah|that|the agent)\b|\byou\s+(just|did|didn'?t|clicked|blocked|stopped|tried|skipped|refused|opened|filled)\b|\bwhat\s+(happened|went wrong|did (you|it) do|are you doing|is (it|bah) doing)\b|\b(is|was)\s+(it|that)\s+(done|blocked|clicked|stuck|working|finished)\b|\b(voc[eê]|vc)\s+(clicou|bloqueou|fez|parou|abriu|preencheu|tentou)\b|\bo que\s+(aconteceu|voc[eê] fez|houve)\b|\bpor que\s+(voc[eê]|vc|parou|bloqueou)\b|\b(qu[eé]\s+pas[oó]|por qu[eé]\s+(paraste|bloqueaste))\b/i;

// Relato de que a última tarefa ficou pela metade ou errou ("one window was opened, but not the
// second", "you only opened one", "it didn't play"). Não é pergunta: é pedido pra CONSERTAR — vai pro
// agente, que recebe o pedido anterior e como terminou (PREVIOUS REQUESTS) e termina o que faltou.
const INCOMPLETE_RE = /\bbut not the (second|other|rest|last|next)\b|\bnot the (second|other) one\b|\bonly (one|1|the first)\b|\byou only\b|\b(didn'?t|did not|never|failed to|forgot to|missed)\b.{0,40}\b(open|opened|work|load|play|show|do|click|finish|save|send|start)\b|\b(nothing|no window|no tab) (happened|opened)\b|\b(wrong|incorrect) (one|video|tab|window|page|job|item|song)\b|\bs[oó] (abriu|abriste) (uma|um)\b|\bmas n[aã]o (o|a) segund[oa]\b|\bn[aã]o (abriu|funcionou|tocou)\b/i;

/** A mensagem diz que a última tarefa ficou incompleta / errada (e não é uma pergunta). */
export function reportsIncompleteRun(msg: string): boolean {
  const m = msg.trim();
  return m.length <= 200 && !/\?\s*$/.test(m) && INCOMPLETE_RE.test(m);
}

/** A mensagem pergunta sobre a última tarefa (não é pedido novo nem pergunta geral). */
export function isAboutLastRun(msg: string): boolean {
  const m = msg.trim();
  return m.length <= 200 && ABOUT_RUN_RE.test(m);
}

/** Forma mínima dos itens do feed que o resumo lê (o AgentCommandBar tem a completa). */
export type RunFeedItem =
  | { kind: 'task'; text: string }
  | { kind: 'event'; event: { kind: string; message?: string; action?: unknown } }
  | { kind: 'step'; step: { actionLabel: string; success: boolean; urlAfter?: string } }
  | { kind: 'report' | 'error'; text: string }
  | { kind: string; [k: string]: unknown };

/**
 * Resumo da ÚLTIMA tarefa do agente no feed (do último 'task' em diante), pronto pra ir como
 * contexto do chat. '' quando não houve tarefa.
 */
export function lastRunDigest(items: RunFeedItem[], fmt: (action: unknown) => string, max = 3000): string {
  let start = -1;
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'task') { start = i; break; }
  if (start < 0) return '';
  const lines: string[] = [];
  let lastUrl = '';
  for (const it of items.slice(start)) {
    const x = it as any;
    if (x.kind === 'task') lines.push(`The user asked: "${String(x.text).slice(0, 300)}"`);
    else if (x.kind === 'step') { lines.push(`- step: ${x.step.actionLabel} → ${x.step.success ? 'done' : 'FAILED'}`); if (x.step.urlAfter) lastUrl = x.step.urlAfter; }
    else if (x.kind === 'event' && x.event?.kind === 'action') lines.push(`- tried: ${fmt(x.event.action)}`);
    else if (x.kind === 'event' && x.event?.kind === 'status' && x.event.message) lines.push(`- Bah: ${String(x.event.message).slice(0, 300)}`);
    else if (x.kind === 'report') lines.push(`Result: ${String(x.text).slice(0, 600)}`);
    else if (x.kind === 'error') lines.push(`Ended with: ${String(x.text).slice(0, 600)}`);
  }
  // Os mais recentes importam mais: corta do começo (mantém o pedido).
  let body = lines.slice(1).join('\n');
  if (body.length > max) body = '…\n' + body.slice(body.length - max);
  return [
    'WHAT BAH\'S AGENT DID ON THE LAST TASK (you are Bah; "you"/"it"/"that" in the question refer to this run).',
    'Answer from this log only — plainly say what was clicked, what was blocked and why, and how it ended. Do not search the web.',
    lines[0],
    body,
    lastUrl ? `Last page: ${lastUrl}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * A última tarefa em uma linha cada (pedido e como terminou) — o contexto curto do roteador local.
 * null quando não houve tarefa.
 */
export function lastRunSummary(items: RunFeedItem[]): { request: string; outcome: string } | null {
  let start = -1;
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'task') { start = i; break; }
  if (start < 0) return null;
  let outcome = 'unknown';
  for (const it of items.slice(start + 1)) {
    const x = it as any;
    if (x.kind === 'report') outcome = 'done: ' + String(x.text);
    else if (x.kind === 'error') outcome = 'ended with: ' + String(x.text);
  }
  const one = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  return { request: one(String((items[start] as any).text || ''), 200), outcome: one(outcome, 200) };
}
