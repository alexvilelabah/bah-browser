// Roteador local (Qwen2.5-1.5B-Instruct): as rotas, o prompt fixo, o JSON da resposta e o
// mapeamento pro caminho da caixa do assistente. Puro (sem Electron/node-llama-cpp) → usado pelo
// motor (utilityProcess), pelo main, pelo renderer e pelo scripts/router-eval.mjs.
// Ideia (não pesos nem texto) do Arch-Router: rotas {name, description}, resposta
// {"route": "<name>"} e uma rota `other` de escape.

export const ROUTE_NAMES = ['ACTION', 'PAGE', 'WEB', 'CHAT', 'LAST_RUN', 'FIX', 'other'] as const;
export type RouteName = typeof ROUTE_NAMES[number];

/** Caminho da caixa do assistente (o que o AgentCommandBar despacha). */
export type RoutedIntent = 'action' | 'page' | 'web' | 'chat' | 'last_run' | 'fix';

// `key` é o nome que o MODELO vê e escreve: nomes que descrevem a intenção acertam bem mais num
// modelo de 1,5B do que siglas (medido no scripts/router-eval.mjs). `name` é o rótulo interno.
export interface RouteDef { name: RouteName; key: string; description: string }

export const ROUTES: RouteDef[] = [
  { name: 'ACTION', key: 'browser_task', description: 'An order for the browser to DO something: open/go to/browse a site, search for or look for or find products, jobs, hotels, flights or videos, compare prices on sites, open tabs or windows, play or show videos, click, fill or submit a form, apply, log in, download, subscribe. Commands that start with search/find/look for/show me/pesquisa/procura/busca/encuentra are browser_task, even with typos.' },
  { name: 'PAGE', key: 'about_this_page', description: 'A question or request about the page that is open right now: summarize/translate/explain this page, article or video, what does it say, is this product good, how much is this.' },
  { name: 'WEB', key: 'web_question', description: 'A question that only wants a written answer from the web: facts, news, definitions, how-to, "what is X", "who is Y", "best X for Y". It is phrased as a question, not as an order, and it is not about the open page.' },
  { name: 'CHAT', key: 'greeting_or_chat', description: 'Greetings (hi, hello, good morning, oi, hola), thanks (thanks, valeu, gracias), small talk, questions about the assistant itself (who are you, what can you do), or writing a poem/text with no web.' },
  { name: 'LAST_RUN', key: 'explain_last_task', description: 'A QUESTION asking what the agent did on the last task: did you click it, did it work, what happened, why did you stop, was it blocked, which one did you open. Only when there is a last task.' },
  { name: 'FIX', key: 'redo_last_task', description: 'A STATEMENT (not a question) that the last task fell short or went wrong, asking to finish or correct it: only one window opened, not the second one, wrong video, it did not work, you forgot X, try again. Only when there is a last task.' },
  { name: 'other', key: 'other', description: 'None of the above.' },
];


const keyOf = (n: RouteName) => ROUTES.find(r => r.name === n)!.key;

// Exemplos curtos no prefixo fixo: entram no cache uma vez (custo zero por consulta) e ensinam
// os casos que as regras de palavras erravam (erros de digitação, follow-ups, pt/es). Nenhum é
// cópia de um caso do tests/fixtures/routing-cases.json (o teste unitário confere).
// (Testado e pior no eval: os mesmos exemplos como turnos de conversa, e mais exemplos — com 1,5B
// o acerto oscila ±3 casos a cada mudança de prompt; esta versão foi a melhor medida.)
const EXAMPLES: Array<[string, RouteName, boolean?]> = [
  ['opne 3 tabs with a diferent cat video in each', 'ACTION'],
  ['look for new runnign shoes under $100', 'ACTION'],
  ['search for cheap flights to rome', 'ACTION'],
  ['go to indeed, find a remote job and open it', 'ACTION'],
  ['procura uma geladeira frost free', 'ACTION'],
  ['busca zapatillas para correr', 'ACTION'],
  ['what are the best running shoes for flat feet?', 'WEB'],
  ['quem ganhou a copa de 2002?', 'WEB'],
  ['give me the key points of this article', 'PAGE'],
  ['¿este producto vale la pena?', 'PAGE'],
  ['hello!', 'CHAT'],
  ['obrigado!', 'CHAT'],
  ['how can you help me?', 'CHAT'],
  ['did you press the button or not?', 'LAST_RUN', true],
  ['why did it fail?', 'LAST_RUN', true],
  ['o que você fez?', 'LAST_RUN', true],
  ['only the first video played, the other tab is empty', 'FIX', true],
  ['it still is not working, do it again', 'FIX', true],
  ['now find a cheaper one', 'ACTION', true],
];

/** Prefixo FIXO (system): rotas + regras + exemplos. Não muda entre consultas → reaproveitado. */
export function buildSystemPrompt(): string {
  const routes = ROUTES.map(r => `- ${r.key}: ${r.description}`).join('\n');
  const ex = EXAMPLES.map(([m, r, last]) => `${last ? '[after a task] ' : ''}"${m}" -> {"route": "${keyOf(r)}"}`).join('\n');
  return [
    'You route messages typed into a web browser\'s assistant box. Pick the ONE route that best matches the user\'s intent.',
    'The message may be in English, Portuguese or Spanish and may contain typos.',
    '',
    'Routes:',
    routes,
    '',
    'Rules:',
    '- An order to search/find/look for/open/show/buy/compare/apply is browser_task, not web_question.',
    '- Greetings and thanks are always greeting_or_chat.',
    `- After a task: a question about it is ${keyOf('LAST_RUN')}; a complaint that it went wrong is ${keyOf('FIX')}; a new request is browser_task.`,
    `- ${keyOf('LAST_RUN')} and ${keyOf('FIX')} need "Last task" to be present.`,
    '',
    'Examples:',
    ex,
    '',
    'Reply with JSON only: {"route": "<route>"}.',
  ].join('\n');
}

// Pergunta x afirmação (só a FORMA da frase, não o assunto): o 1,5B acerta "é sobre a última
// tarefa" mas confunde "perguntou o que houve" com "disse que deu errado". Medido no eval.
const QUESTION_SHAPE_RE = /\?\s*$|^\s*(did|do|does|was|were|is|are|why|what|which|how|when|where|who|have|has|can|could|o\s+que|oq|por\s*que|qual|como|cad[eê]|voc[eê]\s+\w+ou\b|qu[eé]|cu[aá]l|c[oó]mo|d[oó]nde)\b/i;

/** Ajusta LAST_RUN ↔ FIX pela forma da frase; as outras rotas passam direto. */
export function refineRoute(route: RouteName | null, text: string): RouteName | null {
  if (route !== 'LAST_RUN' && route !== 'FIX') return route;
  return QUESTION_SHAPE_RE.test(String(text || '').trim()) ? 'LAST_RUN' : 'FIX';
}

export interface RouteContext {
  url?: string;
  title?: string;
  /** Última tarefa do agente nesta conversa (uma linha cada), se houver. */
  lastRun?: { request: string; outcome: string } | null;
}

const clip = (s: string, n: number) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/** Parte VARIÁVEL (user): contexto curto + a mensagem. Só isto é processado por consulta. */
export function buildUserMessage(text: string, ctx: RouteContext = {}): string {
  const url = clip(ctx.url || '', 160);
  const title = clip(ctx.title || '', 100);
  const page = url && !/^(about:|bah:|chrome:)/i.test(url) ? `${title ? title + ' — ' : ''}${url}` : '(none)';
  const last = ctx.lastRun && ctx.lastRun.request
    ? `"${clip(ctx.lastRun.request, 160)}" → ${clip(ctx.lastRun.outcome || 'unknown', 160)}`
    : 'none';
  return `Open page: ${page}\nLast task: ${last}\nMessage: ${clip(text, 500)}`;
}

/** JSON schema da resposta (vira gramática no node-llama-cpp): exatamente uma rota. */
export const ROUTE_JSON_SCHEMA = {
  type: 'object',
  properties: { route: { type: 'string', enum: ROUTES.map(r => r.key) } },
  required: ['route'],
  additionalProperties: false,
} as const;

/** Lê a resposta do modelo ({"route": "<key>"}, ou só a key/nome). null se não for uma rota válida. */
export function parseRoute(out: unknown): RouteName | null {
  let v: unknown = out;
  if (typeof out === 'string') {
    const s = out.trim();
    try { v = JSON.parse(s); } catch { v = s.replace(/^["'\s]+|["'\s.]+$/g, ''); }
  }
  if (v && typeof v === 'object') v = (v as any).route;
  if (typeof v !== 'string') return null;
  const k = v.trim().toLowerCase();
  const hit = ROUTES.find(r => r.key === k || r.name.toLowerCase() === k);
  return hit ? hit.name : null;
}

/**
 * Rota → caminho da caixa. LAST_RUN/FIX sem tarefa anterior não fazem sentido: viram chat / agente.
 * `other` (ou nada) → null = fica com as regras de palavras.
 */
export function routeToIntent(route: RouteName | null, hasLastRun: boolean): RoutedIntent | null {
  switch (route) {
    case 'ACTION': return 'action';
    case 'PAGE': return 'page';
    case 'WEB': return 'web';
    case 'CHAT': return 'chat';
    case 'LAST_RUN': return hasLastRun ? 'last_run' : 'chat';
    case 'FIX': return hasLastRun ? 'fix' : 'action';
    default: return null;
  }
}

// ── Modelo (Hugging Face, oficial da Qwen) ──
export const ROUTER_MODEL = {
  file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  sha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
  size: 1117320736,
  license: 'Apache-2.0',
} as const;

export type RouterStatus =
  | { state: 'not-downloaded' }
  | { state: 'downloading'; progress: number; bytes: number; total: number }
  | { state: 'loading' }
  | { state: 'ready'; backend: string; loadMs?: number }
  | { state: 'error'; error: string };
