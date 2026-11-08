// agent-sessions.ts — regras PURAS das sessões do agente (sem React, sem DOM, sem electron).
// Uma SESSÃO é a linha de trabalho que o assistente acompanha: uma aba sozinha, ou um grupo de abas
// que compartilham a mesma conversa ("Job hunt": LinkedIn + o formulário da empresa + o currículo).
// Na barra de abas ela aparece como no Chrome (grupos de abas): um chip com COR + NOME antes das abas
// dela, e a mesma cor sublinhando cada aba. Clicar numa aba mostra no painel a conversa da sessão dela.
// O renderer (store.ts, TabBar, AgentCommandBar) e os testes (tests/unit/agent-sessions.test.ts)
// usam a MESMA conta:
//  • a chave da conversa (thread) de uma aba: o id da sessão, ou o da própria aba sem sessão;
//  • o id da 1ª sessão de uma aba é o id DELA — a conversa que já existia não muda de chave;
//  • nome a partir do primeiro pedido; cor que ainda não está em uso;
//  • as abas de uma sessão ficam juntas na barra (entrar = ir pra perto das outras);
//  • arrastar: soltar entre duas abas da mesma sessão = entrar nela; sair de perto = sair dela.

export const SESSION_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'] as const;
export type SessionColor = typeof SESSION_COLORS[number];

/** Cor do chip (fundo claro + texto escuro, como os grupos de abas do Chrome no tema escuro). */
export const SESSION_COLOR_HEX: Record<SessionColor, string> = {
  blue: '#8ab4f8', red: '#f28b82', yellow: '#fdd663', green: '#81c995', pink: '#ff8bcb',
  purple: '#c58af9', cyan: '#78d9ec', orange: '#fcad70', grey: '#dadce0',
};

export interface AgentSession { id: string; name: string; color: SessionColor; createdAt: number }
export interface SessionTab { id: string; hidden?: boolean; pinned?: boolean; sessionId?: string }

export const MAX_SESSION_NAME = 24;

/** Chave da conversa da aba: a da sessão, ou a da própria aba quando ela não tem sessão. */
export function threadKey(tab: { id: string; sessionId?: string }): string {
  return tab.sessionId || tab.id;
}

/** A primeira cor da paleta que nenhuma sessão aberta usa (todas em uso → a menos usada). */
export function pickSessionColor(inUse: readonly string[]): SessionColor {
  const free = SESSION_COLORS.find(c => !inUse.includes(c));
  if (free) return free;
  let best: SessionColor = SESSION_COLORS[0], min = Infinity;
  for (const c of SESSION_COLORS) { const n = inUse.filter(x => x === c).length; if (n < min) { min = n; best = c; } }
  return best;
}

export function isSessionColor(c: unknown): c is SessionColor {
  return typeof c === 'string' && (SESSION_COLORS as readonly string[]).includes(c);
}

// Tipo de trabalho → nome curto. O mais específico primeiro.
const KINDS: Array<[RegExp, string]> = [
  [/\b(jobs?|vagas?|apply|applying|application|candidat\w+|r[eé]sum[eé]|curr[ií]culo|cover letter|hiring|career)\b/i, 'Job hunt'],
  [/\b(grocer\w*|supermarket|mercado|whole foods|walmart|instacart)\b/i, 'Groceries'],
  [/\b(hotel|hotels|flight|flights|trip|travel|airbnb|booking|voo|viagem|hospedagem)\b/i, 'Trip'],
  [/\b(buy|shop|shopping|cart|cheapest|price|prices|compra\w*|pre[cç]o)\b/i, 'Shopping'],
  [/\b(download|downloads|baix\w+|iso|installer)\b/i, 'Downloads'],
  [/\b(email|e-mail|gmail|inbox)\b/i, 'Email'],
  [/\b(news|not[ií]cias?)\b/i, 'News'],
];
const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'on', 'in', 'for', 'and', 'or', 'me', 'my', 'please', 'can', 'you', 'go', 'open', 'browse', 'find', 'search', 'show', 'get', 'what', 'is', 'are', 'how', 'o', 'a', 'os', 'as', 'de', 'do', 'da', 'no', 'na', 'em', 'e', 'um', 'uma', 'para', 'pra']);

const title = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** Nome de 1–3 palavras para a sessão, a partir do primeiro pedido (e do site, se ajudar). */
export function sessionNameFor(command: string, url?: string): string {
  const c = String(command || '');
  for (const [re, name] of KINDS) if (re.test(c)) return name;
  const site = /\b([a-z0-9-]{3,})\.(com|org|net|io|ai|dev|br|co)\b/i.exec(c)?.[1];
  if (site) return title(site.toLowerCase()).slice(0, MAX_SESSION_NAME);
  const words = c.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
  if (words.length) return words.slice(0, 2).map(title).join(' ').slice(0, MAX_SESSION_NAME);
  try { const h = new URL(String(url)).hostname.replace(/^www\./, '').split('.')[0]; if (h) return title(h).slice(0, MAX_SESSION_NAME); } catch {}
  return 'Session';
}

/** Nome sem repetir um já aberto: "Job hunt" → "Job hunt 2". */
export function uniqueSessionName(name: string, taken: readonly string[]): string {
  const base = (String(name || '').replace(/\s+/g, ' ').trim() || 'Session').slice(0, MAX_SESSION_NAME);
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 100; n++) { const v = `${base.slice(0, MAX_SESSION_NAME - 3)} ${n}`; if (!taken.includes(v)) return v; }
  return base;
}

/**
 * A aba entra na sessão e vai pra logo depois da última aba dela na barra (as abas de uma sessão
 * ficam juntas). Fixada não sai do lugar (fica na fronteira das fixadas). Sem outra aba na
 * sessão, fica onde está.
 */
export function joinSession<T extends SessionTab>(tabs: readonly T[], tabId: string, sessionId: string): T[] {
  const me = tabs.find(t => t.id === tabId);
  if (!me) return tabs.slice();
  const updated = { ...me, sessionId } as T;
  const rest = tabs.filter(t => t.id !== tabId);
  let lastMember = -1;
  rest.forEach((t, i) => { if (!t.hidden && t.sessionId === sessionId) lastMember = i; });
  if (lastMember < 0 || me.pinned) return tabs.map(t => (t.id === tabId ? updated : t));
  // Não entra no meio das fixadas: no mínimo, logo depois da última fixada.
  let lastPinned = -1;
  rest.forEach((t, i) => { if (!t.hidden && t.pinned) lastPinned = i; });
  const at = Math.max(lastMember, lastPinned) + 1;
  return [...rest.slice(0, at), updated, ...rest.slice(at)];
}

/** A aba sai da sessão; se estava no meio das outras abas dela, vai pra logo depois delas. */
export function leaveSession<T extends SessionTab>(tabs: readonly T[], tabId: string): T[] {
  const me = tabs.find(t => t.id === tabId);
  if (!me || !me.sessionId) return tabs.slice();
  const sid = me.sessionId;
  const updated = { ...me, sessionId: undefined } as T;
  const rest = tabs.filter(t => t.id !== tabId);
  let lastMember = -1;
  rest.forEach((t, i) => { if (!t.hidden && t.sessionId === sid) lastMember = i; });
  const myPos = tabs.findIndex(t => t.id === tabId);
  const anyAfter = tabs.slice(myPos + 1).some(t => !t.hidden && t.sessionId === sid);
  if (!anyAfter || me.pinned || lastMember < 0) return tabs.map(t => (t.id === tabId ? updated : t));
  return [...rest.slice(0, lastMember + 1), updated, ...rest.slice(lastMember + 1)];
}

/**
 * Depois de arrastar uma aba (como o Chrome com grupos): soltou entre duas abas da MESMA sessão →
 * entra nela; senão, se não ficou encostada em nenhuma aba da sessão dela → sai.
 */
export function sessionAfterMove<T extends SessionTab>(tabs: readonly T[], movedId: string): T[] {
  const vis = tabs.filter(t => !t.hidden);
  const i = vis.findIndex(t => t.id === movedId);
  if (i < 0) return tabs.slice();
  const me = vis[i], left = vis[i - 1], right = vis[i + 1];
  if (left?.sessionId && left.sessionId === right?.sessionId && left.sessionId !== me.sessionId) {
    return tabs.map(t => (t.id === movedId ? { ...t, sessionId: left.sessionId } as T : t));
  }
  if (me.sessionId && left?.sessionId !== me.sessionId && right?.sessionId !== me.sessionId
      && vis.some(t => t.id !== movedId && t.sessionId === me.sessionId)) {
    return tabs.map(t => (t.id === movedId ? { ...t, sessionId: undefined } as T : t));
  }
  return tabs.slice();
}

/** Na barra: as abas antes das quais vai um chip (a 1ª de cada trecho de uma sessão). */
export function chipStarts(visible: readonly SessionTab[]): Set<string> {
  const out = new Set<string>();
  visible.forEach((t, i) => { if (t.sessionId && visible[i - 1]?.sessionId !== t.sessionId) out.add(t.id); });
  return out;
}

/** As sessões que ainda têm aba (as outras somem — a Fase 3 guarda no histórico de conversas). */
export function liveSessions(sessions: readonly AgentSession[], tabs: readonly SessionTab[]): AgentSession[] {
  const used = new Set(tabs.map(t => t.sessionId).filter(Boolean));
  return sessions.filter(s => used.has(s.id));
}
