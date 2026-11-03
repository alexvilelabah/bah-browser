// Expansão do pedido pelo roteador local (Qwen2.5-1.5B): antes do modelo grande começar uma tarefa
// de "achar/baixar" com uma obra ambígua ("top gun", "o rei leão", "dune"), o modelo pequeno reescreve
// o pedido com a desambiguação (ano, artista, qual filme da franquia, nome completo) → o grande age
// sobre o texto preciso. Puro (sem Electron/node-llama-cpp): usado pelo motor, pelo main, pelo
// renderer e pelo scripts/expand-eval.mjs.
//
// Estreito e seguro de propósito:
//  - só entra em pedidos de achar/baixar mídia com uma obra nomeada (shouldExpandRequest); ordens
//    comuns ("abra o gmail", "clique em enviar") nunca passam por aqui;
//  - o modelo SÓ acrescenta desambiguação; nada de listar faixas (1,5B não sabe) nem mudar o pedido;
//  - a saída é conferida (validateExpansion): lixo, longa demais, sem as palavras-chave do pedido,
//    com ação/número/site novo → descartada, e vale o texto original;
//  - o modelo grande recebe os DOIS textos, e o original manda quando discordarem.

/** Teto da expansão (caracteres). Também limita o que o motor gera (EXPAND_MAX_TOKENS). */
export const EXPAND_MAX_CHARS = 320;
export const EXPAND_MAX_TOKENS = 96;

const fold = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Verbo de achar/baixar (en/pt/es) e uma obra/mídia nomeada → vale desambiguar.
const FIND_VERB_RE = /\b(find|get|download|search( for)?|look( for| up)?|grab|fetch|show me|baixe?|baixar|baix[ae]\w*|ach[ae]r?|ache|encontr[ae]\w*|procur[ae]\w*|busc[ae]\w*|pesquis[ae]\w*|descarg[ae]\w*)\b/;
const MEDIA_RE = /\b(movie|film|soundtrack|album|songs?|tracks?|music\s+videos?|videos?|clips?|series|show|season|episodes?|discography|tracklist|band|artist|singer|filme|trilha\s+sonora|banda\s+sonora|[aá]lbum|m[uú]sicas?|faixas?|clipes?|v[ií]deos?|s[eé]rie|temporada|epis[oó]dios?|discografia|cantor[a]?|pel[ií]cula|canci[oó]n(es)?|cantante)\b/;

/**
 * O pedido merece expansão? Achar/baixar + mídia + uma obra depois de "from/of/do/da/de…"
 * (ou "the soundtrack/album X"). Sem URL, tamanho razoável. Ordens comuns ficam de fora.
 */
export function shouldExpandRequest(text: string): boolean {
  const t = String(text || '').trim();
  if (t.length < 12 || t.length > 300) return false;
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|org|net|io|br|app|dev)\b/i.test(t)) return false;
  const c = fold(t);
  if (!FIND_VERB_RE.test(c) || !MEDIA_RE.test(c)) return false;
  // Uma obra nomeada: "from/of/do/da/de/del [the] <algo>" ou "<soundtrack|album> <algo>".
  return /\b(from|of|by|with|do|da|dos|das|de|del|com|con)\s+(the\s+|o\s+|a\s+|el\s+|la\s+)?(movie\s+|film\s+|filme\s+|pel[ií]cula\s+|album\s+|show\s+|series\s+|serie\s+)?[a-z0-9]/.test(c)
    || /\b(soundtrack|album|trilha sonora|banda sonora|discography|discografia)\b/.test(c);
}

// Exemplos curtos no prefixo fixo. De propósito NENHUM é o Top Gun (o teste real mede ele).
const EXAMPLES: Array<[string, string]> = [
  ['download every song from the lion king soundtrack', 'download every song from the soundtrack of the 1994 animated film The Lion King, not the 2019 remake'],
  ['find all the music videos from the album thriller', 'find all the music videos from the 1982 album Thriller by Michael Jackson'],
  ['baixe todas as músicas da trilha sonora de titanic', 'baixe todas as músicas da trilha sonora do filme Titanic (1997)'],
  ['download the songs from the album abc', 'download the songs from the album abc'],
];

/** Prefixo FIXO (system) da expansão. */
export function buildExpandSystemPrompt(): string {
  const ex = EXAMPLES.map(([a, b]) => `"${a}" -> {"understood": "${b}"}`).join('\n');
  return [
    'You make a user\'s request to a browser agent more precise, so a larger AI can act on it.',
    'Rewrite the request, ONLY adding disambiguation: the year of a film, album or show, its main artist or actor,',
    'which entry of a franchise is meant (the original or a sequel/remake), and full proper names.',
    '',
    'Rules:',
    '- Keep the user\'s words, action, quantity and media type. Never add a new task, site, step or number of items.',
    '- Never answer the request and never list songs, tracks or titles.',
    '- Add a year or a name ONLY when you are certain. Never add composers, directors, producers or writers.',
    '- Mention a sequel or remake only if it really exists. If you are not sure, leave it out.',
    '- If nothing is ambiguous or you do not know the work, repeat the request unchanged.',
    '- Keep the language of the request. At most 45 words, one sentence.',
    '',
    'Examples:',
    ex,
    '',
    'Reply with JSON only: {"understood": "<the request, made precise>"}.',
  ].join('\n');
}

export function buildExpandUserMessage(text: string): string {
  return `Request: ${String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300)}`;
}

/** JSON schema da resposta (vira gramática no node-llama-cpp). */
export const EXPAND_JSON_SCHEMA = {
  type: 'object',
  properties: { understood: { type: 'string' } },
  required: ['understood'],
  additionalProperties: false,
} as const;

/** Lê {"understood": "..."} (ou texto cru). '' se não der. */
export function parseExpansion(out: unknown): string {
  let v: unknown = out;
  if (typeof out === 'string') {
    const s = out.trim();
    try { v = JSON.parse(s); } catch { v = s; }
  }
  if (v && typeof v === 'object') v = (v as any).understood;
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
}

// Palavras que não carregam o "o quê" do pedido (en/pt/es): artigos, preposições, pronomes e os
// verbos de achar/baixar. O resto (obras, nomes, mídia, "all/todas") tem que sobreviver à expansão.
const STOP = new Set(('a an the of from to for in on at by with and or me my i you it them this that these those please pls ' +
  'find get download downloads search look up grab fetch show give want need would like can could some any ' +
  'o os as um uma uns umas do da dos das de no na nos nas em com por para pra pro e ou me eu voce isso esse essa ' +
  'baixe baixa baixar ache acha achar encontre encontrar procure procurar busque buscar pesquise pesquisar quero ' +
  'el la los las un una unos unas del con y en por para mi yo descarga descargar encuentra encontrar busca').split(/\s+/));

/** Palavras-chave do pedido (o que a expansão TEM que manter). */
export function keyTerms(text: string): string[] {
  const words = fold(text).match(/[a-z0-9]+/g) || [];
  return words.filter((w, i, a) => (w.length >= 3 || /^\d+$/.test(w)) && !STOP.has(w) && a.indexOf(w) === i);
}

// Distância de edição ≤ 1 (o modelo pode corrigir um erro de digitação: "cruse" → "cruise").
function nearlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
// Sinônimos que o modelo troca à toa ("movie" → "film"): contam como a mesma palavra.
const SAME: Record<string, string> = { movie: 'film', movies: 'film', films: 'film', filme: 'film', filmes: 'film', pelicula: 'film', peliculas: 'film',
  song: 'track', songs: 'track', tracks: 'track', musica: 'track', musicas: 'track', faixa: 'track', faixas: 'track', cancion: 'track', canciones: 'track',
  clip: 'video', clips: 'video', clipe: 'video', clipes: 'video', videos: 'video', videoclipe: 'video', videoclipes: 'video' };
const stem = (w: string) => SAME[w] || (w.length > 4 ? w.replace(/(es|s)$/, '') : w);
function hasTerm(term: string, words: string[]): boolean {
  const st = stem(term);
  return words.some(w => w === term || stem(w) === st || (term.length >= 5 && nearlyEqual(w, term)));
}

// Ações que mudam o pedido se aparecerem do nada (comprar, apagar, mandar, logar…). "Achar/baixar"
// já estão no pedido; uma ação NOVA desta lista = a expansão mudou a intenção → descarta.
const ACTIONS: Array<[string, RegExp]> = [
  ['buy', /\b(buy|purchase|order|pay|checkout|compr[ae]\w*|pag[ae]\w*|pedir)\b/],
  ['delete', /\b(delete|remove|erase|apag[ae]\w*|exclu[ai]\w*|borr[ae]\w*|elimin[ae]\w*)\b/],
  ['send', /\b(send|email|e-mail|post|share|upload|envi[ae]\w*|mand[ae]\w*|compartilh\w*|compart\w*|postar?)\b/],
  ['install', /\b(install|uninstall|instal[ae]\w*|desinstal\w*)\b/],
  ['play', /\b(play|watch|stream|toc[ae]r?|toque|assist[ai]\w*|reproduz\w*|reproduc\w*|ver)\b/],
  ['account', /\b(log ?in|sign ?(in|up)|subscribe|register|logar|entrar|assin[ae]\w*|inscrev\w*|suscrib\w*)\b/],
  ['open', /\b(open|click|abr[ae]\w*|abrir|cliqu\w*|clic\w*)\b/],
  ['print', /\b(print|imprim\w*)\b/],
];

// Recusa/conversa do modelo em vez de um pedido.
const JUNK_RE = /\b(sorry|i can(no|')t|as an ai|i'?m not sure|here (is|are)|desculp\w*|lo siento|n[aã]o (posso|sei)|no (puedo|s[eé]))\b|[{}<>\[\]`]|\n/i;

export type ExpansionVerdict =
  | { ok: true; expanded: string }
  | { ok: false; reason: 'empty' | 'same' | 'junk' | 'too-long' | 'missing-terms' | 'new-action' | 'new-number' | 'new-site' };

/**
 * Confere a expansão contra o pedido original. Só passa o que acrescenta desambiguação:
 * mesmas palavras-chave, nenhuma ação/número/site novo, sem lixo, dentro do teto.
 */
export function checkExpansion(original: string, raw: unknown): ExpansionVerdict {
  const orig = String(original || '').replace(/\s+/g, ' ').trim();
  const out = parseExpansion(raw);
  if (!out || out.length < 3) return { ok: false, reason: 'empty' };
  if (fold(out).replace(/[^a-z0-9]+/g, ' ').trim() === fold(orig).replace(/[^a-z0-9]+/g, ' ').trim()) return { ok: false, reason: 'same' };
  if (JUNK_RE.test(out)) return { ok: false, reason: 'junk' };
  if (out.length > Math.min(EXPAND_MAX_CHARS, orig.length + 200)) return { ok: false, reason: 'too-long' };
  const fo = fold(orig), fe = fold(out);
  const words = fe.match(/[a-z0-9]+/g) || [];
  if (!keyTerms(orig).every(k => hasTerm(k, words))) return { ok: false, reason: 'missing-terms' };
  for (const [, re] of ACTIONS) if (re.test(fe) && !re.test(fo)) return { ok: false, reason: 'new-action' };
  // Números novos: só anos (1900–2099) entram; "10 videos" no lugar de "all" muda o pedido.
  const origNums = new Set(fo.match(/\d+/g) || []);
  for (const n of fe.match(/\d+/g) || []) if (!origNums.has(n) && !/^(19|20)\d\d$/.test(n)) return { ok: false, reason: 'new-number' };
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|org|net|io|br|app|dev)\b/.test(fe) && !/https?:\/\/|www\.|\.(com|org|net|io|br|app|dev)\b/.test(fo)) return { ok: false, reason: 'new-site' };
  return { ok: true, expanded: out };
}

/** A expansão aceita, ou null (vale o original). */
export function validateExpansion(original: string, raw: unknown): string | null {
  const v = checkExpansion(original, raw);
  return v.ok ? v.expanded : null;
}

/** Linha que vai pro modelo grande, junto do GOAL original. */
export function understoodNote(expanded: string): string {
  return expanded
    ? `\nUNDERSTOOD AS (a small local model made the GOAL precise — same intent; its year/artist/edition is a GUESS: confirm it on the page or the web before relying on it; the GOAL wins if they disagree): ${expanded}`
    : '';
}
