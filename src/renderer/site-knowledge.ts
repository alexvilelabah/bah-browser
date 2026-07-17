import type { ObservedState } from './page-executor';
import { googleLocaleParams } from './i18n';

export interface SiteShortcut {
  id: string;
  names: string[];
  url: string;
  searchUrl?: string;
  notes: string[];
}

export interface LearnedSiteProfile {
  host: string;
  lastUrl: string;
  title: string;
  visits: number;
  updatedAt: number;
  urls: string[];
  landmarks: {
    searchFields: LearnedElement[];
    submitButtons: LearnedElement[];
    likeButtons: LearnedElement[];
    loginButtons: LearnedElement[];
  };
  successfulActions: LearnedAction[];
  failedActions: LearnedAction[];
  elements: LearnedElement[];
}

export interface LearnedElement {
  text: string;
  role?: string;
  tag: string;
  placeholder?: string;
  href?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface LearnedAction {
  type: string;
  key: string;
  url: string;
  title?: string;
  ts: number;
  success: boolean;
  note?: string;
}

export interface ActionMemoryInput {
  actionType: string;
  success: boolean;
  url: string;
  title?: string;
  element?: Partial<LearnedElement>;
  note?: string;
}

export interface LearnedProfiles {
  [host: string]: LearnedSiteProfile;
}

const LEARNED_SITES_KEY = 'learnedSiteProfiles.v1';
const MAX_URLS_PER_SITE = 20;
const MAX_ACTIONS_PER_SITE = 80;
const MAX_ELEMENTS_PER_SITE = 80;

export const SITE_SHORTCUTS: SiteShortcut[] = [
  {
    id: 'google',
    names: ['google'],
    url: 'https://www.google.com/webhp?pws=0&gws_rd=cr',
    searchUrl: 'https://www.google.com/search?pws=0&q={query}',
    notes: ['Use Google for broad web search. The query field is usually name=q. Press Enter after filling it.'],
  },
  {
    id: 'youtube',
    names: ['youtube', 'you tube'],
    url: 'https://www.youtube.com',
    searchUrl: 'https://www.youtube.com/results?search_query={query}',
    notes: [
      'For requests like "play/click a video about X", navigate directly to the YouTube search URL.',
      'On a video page, the like control is usually a toggle button with aria/text containing Like or Gostei.',
      'Click the like toggle only once. If pressed=true after observation, the goal is complete.',
    ],
  },
  {
    id: 'facebook',
    names: ['facebook', 'face'],
    url: 'https://www.facebook.com',
    notes: ['May require login. Prefer direct navigation, then observe available fields/buttons.'],
  },
  { id: 'instagram', names: ['instagram'], url: 'https://www.instagram.com', notes: ['May require login.'] },
  { id: 'x', names: ['x', 'twitter'], url: 'https://x.com', searchUrl: 'https://x.com/search?q={query}', notes: ['Use search URL for public searches.'] },
  { id: 'wikipedia', names: ['wikipedia'], url: 'https://www.wikipedia.org', searchUrl: 'https://pt.wikipedia.org/w/index.php?search={query}', notes: ['Good fallback for factual research.'] },
  { id: 'github', names: ['github'], url: 'https://github.com', searchUrl: 'https://github.com/search?q={query}', notes: ['Use for code, repos and issues.'] },
  { id: 'amazon', names: ['amazon'], url: 'https://www.amazon.com.br', searchUrl: 'https://www.amazon.com.br/s?k={query}', notes: ['Use for product searches.'] },
  { id: 'mercadolivre', names: ['mercado livre', 'mercadolivre'], url: 'https://www.mercadolivre.com.br', searchUrl: 'https://lista.mercadolivre.com.br/{query}', notes: ['Use for Brazilian product searches.'] },
  { id: 'reddit', names: ['reddit'], url: 'https://www.reddit.com', searchUrl: 'https://www.reddit.com/search/?q={query}', notes: ['The home page may show a challenge. Prefer direct search URLs for safe exploration.'] },
  { id: 'gmail', names: ['gmail'], url: 'https://mail.google.com', notes: ['Requires Google login/cookies.'] },
];

export function findShortcutForCommand(command: string): SiteShortcut | undefined {
  const normalized = normalize(command);
  return SITE_SHORTCUTS.find(site => site.names.some(name => {
    const n = normalize(name);
    if (n.length <= 2) return new RegExp(`(^|\\W)${escapeRegExp(n)}(\\W|$)`).test(normalized);
    return normalized.includes(n);
  }));
}

export function buildKnownSitesBlock(observation?: ObservedState): string {
  const learned = loadLearnedProfiles();
  const currentHost = safeHost(observation?.url);
  const currentProfile = currentHost ? learned[currentHost] : undefined;
  const shortcuts = SITE_SHORTCUTS
    .map(site => `- ${site.id}: ${site.url}${site.searchUrl ? ` | search: ${site.searchUrl}` : ''}`)
    .join('\n');

  const learnedBlock = currentProfile
    ? [
        `LEARNED CURRENT SITE (${currentProfile.host}, visits=${currentProfile.visits}):`,
        currentProfile.landmarks.searchFields.length
          ? `SEARCH FIELDS:\n${currentProfile.landmarks.searchFields.slice(0, 5).map(formatLearnedElement).join('\n')}`
          : 'SEARCH FIELDS: (none learned yet)',
        currentProfile.landmarks.submitButtons.length
          ? `SUBMIT BUTTONS:\n${currentProfile.landmarks.submitButtons.slice(0, 5).map(formatLearnedElement).join('\n')}`
          : 'SUBMIT BUTTONS: (none learned yet)',
        currentProfile.landmarks.likeButtons.length
          ? `LIKE BUTTONS:\n${currentProfile.landmarks.likeButtons.slice(0, 5).map(formatLearnedElement).join('\n')}`
          : '',
        currentProfile.successfulActions.length
          ? `RECENT SUCCESSFUL ACTIONS:\n${currentProfile.successfulActions.slice(0, 6).map(a => `- ${a.type}: ${a.key} (${a.note ?? a.url})`).join('\n')}`
          : '',
        ...currentProfile.elements.slice(0, 12).map(el => {
          const bits = [el.tag, el.role, el.placeholder ? `placeholder=${el.placeholder}` : '', el.text ? `text=${el.text}` : '']
            .filter(Boolean)
            .join(' ');
          return `- ${bits}`;
        }),
      ].join('\n')
    : 'LEARNED CURRENT SITE: (no saved profile yet)';

  return [
    'KNOWN SITE SHORTCUTS:',
    shortcuts,
    '',
    'FAST PATH RULES:',
    '- If the user names a known site, prefer navigate/new_tab directly to that site or its searchUrl.',
    '- For safe exploration/search tasks, prefer each known site searchUrl over manually filling search fields.',
    '- For YouTube video tasks, search YouTube directly, open a likely result, then use the Like/Gostei toggle once.',
    '- For YouTube comment tasks, after opening a video, scroll to the comments area, click/fill the comment box, then click the visible "Comentar"/"Comment" submit button. Do not navigate away after typing a comment.',
    '- For social login tasks with Gmail/Google, first try visible buttons/text like "Continuar com Google", "Entrar com Google", "Sign in with Google", "Continue with Google", or "Gmail" before changing sites.',
    '- Google login may open a popup/new tab. If it does, follow the new active tab and continue the login there.',
    '- For Gmail compose/send-email tasks, prefer Gmail known fields: To/Para/Destinatarios, Subject/Assunto, and message body/body textbox. Use direct Gmail compose helpers when available instead of visually hunting every field.',
    '',
    learnedBlock,
  ].join('\n');
}

export function getInitialShortcutAction(command: string): { action: { type: 'navigate'; url: string }; reason: string } | null {
  const normalizedCommand = normalize(command);

  // DOWNLOAD media tasks must NOT fast-path to YouTube search — that drops the user
  // on a results page full of Shorts and the agent then picks a random clip. The
  // download_video { query } action finds + downloads the right result by itself
  // (with a duration filter), so let the agent go straight to it.
  const isDownloadMedia = /\b(baix\w*|baj\w*|download|downloading|salv\w*|descarg\w*|guard\w*|pega\w*|quiero|save|saving|get|grab|fetch)\b/.test(normalizedCommand)
    && /\b(musica|musicas|music|video|videos|vid|audio|audios|som|clipe|cancao|cancoes|cancion|canciones|faixas?|temas?|mp3|mp4|song|songs|track|tracks|tunes?|movie|movies|filmes?|films?|peliculas?|peli|clip|sound)\b/.test(normalizedCommand);
  if (isDownloadMedia) return null;

  // Criar playlist: NÃO fast-path pro YouTube — o detectQuickAction (ou o modelo, no
  // fallback) emite create_playlist e monta a playlist por URL, em vez de só abrir busca.
  if (/\b(playlist|play\s?list|lista\s+de\s+(?:reproducao|reproduccion|musicas?|canciones))\b/.test(normalizedCommand)
      && /\b(cri\w+|crea\w*|mont\w+|arm\w+|fa[cz]\w+|haz(?:me)?\b|hacer\b|gera\w+|junt\w+|adicion\w+|separ\w+|prepar\w+|quero|queria|quiero|creat\w+|make|made|build|generat\w+|put\s+together|add)\b/.test(normalizedCommand)) return null;

  if (normalizedCommand.includes('gmail') && /mandar|enviar|escrever|email|e-mail|compose|send|write/.test(normalizedCommand)) {
    return {
      action: { type: 'navigate', url: 'https://mail.google.com/mail/u/0/#inbox?compose=new' },
      reason: 'fast path: open Gmail compose',
    };
  }

  if (normalizedCommand.includes('gmail') && /promocoes|promotions|promocao|promo/.test(normalizedCommand)) {
    return {
      action: { type: 'navigate', url: 'https://mail.google.com/mail/u/0/#category/promotions' },
      reason: 'fast path: open Gmail Promotions category',
    };
  }

  // Se o usuário deu uma URL/site explícito, NÃO fast-pathar pra um site conhecido —
  // deixa o agente navegar pra URL que ele pediu. (Gmail compose acima continua, pois
  // e-mail não conta como URL.)
  if (commandHasExplicitUrl(command)) return null;

  const site = findShortcutForCommand(command) ?? inferShortcutFromIntent(command);
  if (!site) return null;

  const query = extractSearchQuery(command, site);
  if (site.id === 'google' && query && wantsGoogleImages(command)) {
    return {
      action: { type: 'navigate', url: `https://www.google.com/search?${googleLocaleParams()}&pws=0&tbm=isch&q=${encodeURIComponent(query)}` },
      reason: `fast path: google images search for "${query}"`,
    };
  }

  if (site.searchUrl && query) {
    return {
      action: { type: 'navigate', url: site.searchUrl.replace('{query}', encodeURIComponent(query)) },
      reason: `fast path: ${site.id} search for "${query}"`,
    };
  }

  return {
    action: { type: 'navigate', url: site.url },
    reason: `fast path: open ${site.id}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// QUICK INTENT ROUTER — encapsula pedidos de leigo em UMA ação direta, SEM API.
// "mp3 musica X" / "baixar musica X" → download_video (audio); "baixar video X" →
// download_video; "pdf de X" / "planilha de X" → find_file. O agente executa essa
// ação no passo 0 sem chamar o DeepSeek (instantâneo e de graça). Conservador: só
// dispara quando a intenção é clara; perguntas/tutoriais caem pro fluxo normal.
// ─────────────────────────────────────────────────────────────────────────────
export type QuickAction =
  | { type: 'download_video'; query: string; audio_only?: boolean; count?: number; quality?: 'best' | 'low' }
  | { type: 'open_video_cuts'; phrase: string; count?: number }
  | { type: 'open_video'; query: string }
  | { type: 'open_videos'; query: string; count: number }
  | { type: 'stock_movers'; direction: 'gainers' | 'losers'; count?: number }
  | { type: 'compare_prices'; query: string }
  | { type: 'google_news'; query: string }
  | { type: 'harvest_images'; query: string; count?: number; min_width?: number }
  | { type: 'generate_image'; prompt: string; count?: number }
  | { type: 'find_file'; query: string; filetype: string }
  // Playlist determinística: com songs[] (usuário listou) OU artist+count (o executor
  // resolve as top-N faixas no YouTube via resolveManyVideos — sem depender do modelo).
  | { type: 'create_playlist'; songs: string[]; artist?: string; count?: number; name?: string; private?: boolean };

const NUM_WORDS: Record<string, number> = {
  dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, doze: 12, quinze: 15, vinte: 20, trinta: 30, cinquenta: 50, cem: 100,
  // EN — paridade pro público open-source (mesmos atalhos de 0 token em inglês).
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50, hundred: 100,
  // ES — paridade trilingue.
  dos: 2, cuatro: 4, siete: 7, ocho: 8, nueve: 9, diez: 10,
};

// "baixe 3 músicas...", "baixe vinte músicas..." → quantos arquivos pegar (default 1).
function parseCount(n: string): number {
  const NOUN = '(?:musicas?|music|videos?|cancao|cancoes|cancion(?:es)?|faixas?|temas?|clipes?|sons?|audios?|mp3|mp4|songs?|tracks?|tunes?|clips?|movies?|filmes?|films?|peliculas?|sounds?)';
  const d = n.match(new RegExp('\\b(\\d{1,3})\\s+' + NOUN));
  if (d) return Math.min(Math.max(parseInt(d[1], 10), 1), 50);   // teto de seguranca 50
  const w = n.match(new RegExp('\\b(dois|duas|dos|tres|quatro|cuatro|cinco|seis|sete|siete|oito|ocho|nove|nueve|dez|diez|doze|quinze|vinte|trinta|cinquenta|cem|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|fifty|hundred)\\s+' + NOUN));
  if (w) return Math.min(NUM_WORDS[w[1]] || 1, 50);
  return 1;
}

// Remove a "cauda" conversacional/meta dirigida ao agente que polui a query:
// "…dentro do q(ue) vc pode fazer", "…se você puder", "…do jeito que der", "…por favor".
// Mantém o termo de verdade (ex.: "iphone se" sobrevive — exige um verbo-meta depois).
function stripAgentMeta(s: string): string {
  return (s || '')
    .replace(/[\s,]+(?:dentro\s+d[oa]\s+q(?:ue)?|no\s+q(?:ue)?|d[oa]\s+jeito\s+q(?:ue)?|o\s+q(?:ue)?|se|caso|contanto\s+q(?:ue)?)\s+(?:voc[eê]s?|vc)?\s*(?:pode|puder|poder|consegue|conseguir|der|quiser|achar|encontrar|fizer|fazer|consiga|poss[ií]vel)\b.*$/i, '')
    .replace(/[\s,]+(?:por\s+favor|pfv|pf)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const QUICK_STRIP = new Set(
  ('baixar baixa baixe baixame baixar download salvar salva salve pega pegue quero queria gostaria me ' +
   'pra para mim por favor o a os as um uma uns umas de do da dos das e em no na ' +
   'mp3 mp4 musica musicas music audio audios video videos vid som sons cancao cancoes clipe clipes clip clips arquivo arquivos ' +
   'faixa faixas tema temas filme filmes documentario ' +
   'qualidade boa alta maxima otima hd 4k uhd fullhd baixa resolucao resolução menor low 360p 480p 720p 1080p ruim ' +
   'pdf documento documentos planilha planilhas manual manuais apostila ebook livro formato ' +
   // ES — só VERBOS/nouns de download que poluem a query ("descarga la canción…").
   // Artigos (la/el/los/las) NÃO entram: fazem parte de títulos ("La La Land").
   'descarga descargar descargue descargame baja bajar bajame guarda guardar guardame quiero ' +
   'cancion canciones pelicula peliculas peli ' +
   // EN — stopwords seguras pra não poluir a query (só removem ruído, não disparam ação).
   'save get grab fetch want need please my the of for to in on by this that some ' +
   'song songs track tracks tune tunes file files movie movies film films sound sounds quality best high res resolution')
    .split(' '));

// "na melhor qualidade", "qualidade boa", "em hd/4k" → best quality. Must be detected
// AND removed before the question-blocker runs ("melhor" alone blocks) and before the
// query is built (so "qualidade" doesn't pollute the YouTube search).
const QUALITY_RE = /\b(?:n[ao]|em|com|de|in)?\s*(?:(?:melhor|boa|alta|m[aá]xima|[oó]tima|max)\s+qualidade|qualidade\s+(?:melhor|boa|alta|m[aá]xima|[oó]tima|max|hd|4k)|(?:best|high|highest)\s+quality|high\s+res(?:olution)?|full\s*hd|4k|uhd|hd|1080p?|1440p?|2160p?|alta\s+resolu[cç][aã]o)\b/gi;
// Cópia SEM flag /g pro .test() — regex global é stateful em .test() (avança lastIndex).
// QUALITY_RE fica só pros .replace() (que precisam do /g e zeram lastIndex sozinhos).
const QUALITY_TEST_RE = new RegExp(QUALITY_RE.source, 'i');

// O pedido é sobre o documento/página que JÁ ESTÁ ABERTO ou já foi DADO ao agente ("resuma
// o pdf aberto", "acha o capítulo X no manual que já está aberto", "resuma o pdf anexado",
// "esse pdf está errado, tente de novo"). Buscar um arquivo NOVO no Google é o contrário do
// que a pessoa quer — e "anexado/attached" colide de frente com a feature real de anexar
// documento (📎): o usuário já deu o arquivo, é o modelo que tem que ler, não o Google buscar
// outro. Cede pro agente/doc-QA, que enxergam o de verdade. Testado contra `n` (normalize já
// tirou acento e maiúscula: "já" → "ja"). Bare esta/essa/este/esse é seguro aqui porque esta
// checagem só roda dentro do gate de find_file (nunca nos outros atalhos).
const REFERS_TO_OPEN_DOC = /\b(?:aberto|aberta|abierto|abierta|opened|already\s+open|is\s+open|are\s+open|ja\s+(?:esta|ta)|ya\s+(?:se\s+)?esta|est[ea]s?|ess[ea]s?|nest[ea]s?|ness[ea]s?|dest[ea]s?|dess[ea]s?|(?:n|d)a\s+tela|on\s+(?:screen|the\s+page)|current|atual|this|anex\w*|attach\w*|adjunt\w*)\b/;

// Sinal de que a frase fala do item que JÁ ESTÁ na tela (não pede um NOVO, fresco, de um
// buscador) — usado pelas famílias de busca "nova" (preço/notícia/ações/imagem/vídeo/
// supercut). SEM 'current'/'atual' soltos: colidiria com "current events" (pedido de
// notícia de verdade). Em vez disso usa demonstrativos + "on/na página".
const REFERS_TO_OPEN_ITEM = /\b(?:aberto|aberta|abierto|abierta|opened|already\s+open|is\s+open|are\s+open|ja\s+(?:esta|ta)|ya\s+(?:se\s+)?esta|est[ea]s?|ess[ea]s?|nest[ea]s?|ness[ea]s?|dest[ea]s?|dess[ea]s?|these|those|this|(?:n|d)a\s+(?:tela|pagina)|en\s+la\s+pagina|on\s+(?:screen|the\s+page)|aqui|daqui)\b/;

// "quem/who/quién" — pergunta sobre AUTORIA/pessoa (quem canta, quem tirou a foto, quem
// criou), não pedido de buscar algo novo. Curiosidade sobre o que já existe na tela.
const IS_WHO_QUESTION = /\b(quem|qui[eé]n|whose|who)\b/;

// "minha/my playlist" — uma coleção EXISTENTE do usuário, não um tema pra buscar do zero.
// O executor só sabe montar/abrir playlist NOVA no YouTube; mexer numa salva é tarefa do
// agente (ele enxerga a aba). Sem isto "abra minha playlist do Djavan" virava uma busca
// nova por "Djavan", e "baixe as músicas da minha playlist" um download de query-lixo.
// "minha playlist" OU "a playlist que eu salvei" (mesma coleção existente, sem o
// possessivo direto na frente) — ambas são uma coleção SALVA do usuário, não um tema novo.
const REFERS_TO_MY_PLAYLIST = /\b(?:minha|meu|mi|my|sua|seu|tu|su|your)\s+(?:playlist|play\s?list|lista)\b|(?:playlist|play\s?list|lista)\b[^.!?]{0,25}\b(?:que\s+(?:eu\s+)?(?:salvei|guardei)|i\s+saved)\b/;

// Verbo de PARAR/FECHAR ("feche/pausa/pare"). Sem isto, "abr\w+"/"toc\w+" casavam com o
// PASSADO ("...que você ABRIU", "vídeo que está TOCANDO") mesmo quando o verbo de verdade
// da frase era o OPOSTO — fechar/pausar algo que já está aberto não é abrir um novo.
const IS_STOP_CONTROL_VERB = /\b(fecha\w*|close[ds]?|closing|pausa\w*|pause[ds]?|pausing|para\b|pare\b|parar|stop(?:ped|ping)?|tela\s+cheia|fullscreen|volume|zoom)\b/;

// "não consigo ouvir"/"can't"/"won't" — reclamação de que algo NÃO funciona, não pedido
// de abrir um vídeo novo. Sem isto "não consigo ouvir a música" abria um vídeo aleatório.
const IS_CANNOT = /\b(nao\s+consigo|não\s+consigo|no\s+puedo|can\W?t|cannot|won\W?t|does\s?n\W?t|doesn\W?t)\b/;

// Negação/correção de uma ação anterior ("não pedi pra baixar", "never said download",
// "pare de baixar"). Sem isto, "não, eu não pedi pra baixar vídeo nenhum" tinha 'baixar'
// e virava um NOVO download — o oposto do que a frase pede.
const IS_NEGATING_PRIOR_ACTION = /\b(nao\s+pedi|não\s+pedi|no\s+ped[ií]|no\s+dije|nunca\s+disse|never\s+said|did\s?n[o']?t\s+(?:ask|say)|did\s+not\s+(?:ask|say)|errad[oa]|wrong|stop\s+download\w*|pare\s+de\s+baixar)\b/;

// Verbo de AÇÃO sobre o documento que já EXISTE (apagar/mandar/fechar/imprimir/converter/
// responder) — bem diferente de "pdf de biologia" (só o tema, sem verbo, que É o atalho
// pretendido). Sem isto "mande o pdf por email"/"apague o pdf que você baixou" disparavam
// só por citar 'pdf', mesma armadilha do OR cru que causou o bug original do ucraniano.
const ACTS_ON_EXISTING_DOC = /\b(apag\w*|delet\w*|remov\w*|exclu\w*|mand\w*|envia\w*|send\w*|fech\w*|close\w*|imprim\w*|print\w*|convert\w*|respond\w*|reply|answer|role\w*|rol\w*|scroll\w*|zoom)\b/;

// "de acordo com o pdf"/"according to the pdf" cita o documento como FONTE de uma pergunta
// (ex.: preço) — o pdf já está com o usuário, não é o assunto da busca. Sem isto essa
// citação escapava do guard de preço e ainda acertava o find_file (pdf mencionado, sem
// nenhum "essa/aberto" pra barrar).
const CITES_DOC_AS_SOURCE = /\b(de\s+acordo\s+com|according\s+to|conforme|segundo\s+o|segun\s+el)\b/;

export function detectQuickAction(command: string, opts?: { forceImage?: boolean; weakModel?: boolean }): QuickAction | null {
  // MODO IMAGEM (caixinha do chat marcada): trata o texto INTEIRO como prompt de imagem,
  // sem depender de palavra-gatilho/idioma. Vem antes de tudo (até de URL) — marcou, é imagem.
  if (opts?.forceImage) {
    const prompt = stripAgentMeta(command).trim() || command.trim();
    if (prompt) return { type: 'generate_image', prompt, count: 1 };
  }
  // URL/site explícito no comando → cede pro agente NAVEGAR pra lá (não sequestrar pra
  // um atalho de busca tipo google_news). Conserta "vá no site X e busque Y" virar uma
  // query-lixo no Google News. Baixar por URL não passa por aqui (a quick action de
  // download só pega "desta página", sem URL), então não quebra.
  if (commandHasExplicitUrl(command)) return null;
  // Idioma que estes atalhos NÃO falam → cede pro modelo (que é multilíngue). Sem isto,
  // um gatilho latino solto ("PDF", "MP3") dispara e, como nenhuma palavra da frase é
  // reconhecida pra ser removida, a FRASE INTEIRA vira a busca. Um usuário ucraniano
  // dizendo "você não entendeu, o manual em PDF já está aberto" virou uma busca no
  // Google pela própria reclamação dele.
  if (isForeignScript(command)) return null;
  let n = normalize(command);

  // CRIAR PLAYLIST — atalho DETERMINÍSTICO **só quando a IA é FRACA** (modo local Ollama
  // OU nuvem keyless/Pollinations — o gpt-oss grátis falha em criar playlist e devolve JSON
  // inválido → a "mão" resolve top-N e monta). Com CHAVE de nuvem forte (DeepSeek) NÃO
  // intercepta: o modelo cura as músicas de verdade — respeita [[local-nao-mexer-na-api]].
  // Em AMBOS os casos, um comando de criar playlist NUNCA cai no detector de download
  // (retorna null → modelo). No TOPO: "crie uma playlist e SALVE 10 MÚSICAS" tem 'salve'.
  {
    const PL_NOUN = /\b(playlist|play\s?list|lista\s+de\s+(?:reproducao|reproduccion|musicas?|canciones))\b/;
    // Verbos de CRIAR. 'adicion/add' saíram (isso é mexer numa playlist existente). 'quero/
    // queria/quiero' FICAM (pra "quero uma playlist do Djavan"), mas os guards abaixo barram
    // "quero OUVIR minha playlist" (abrir) e "quero adicionar…" (mexer numa existente).
    const PL_VERB = /\b(cri\w+|crea\w*|creame\b|mont\w+|arm\w+|fa[cz]\w+|haz(?:me)?\b|hacer\b|gera\w+|junt\w+|separ\w+|prepar\w+|quero|queria|quiero|creat\w+|make|made|build|generat\w+|put\s+together)\b/;
    // BAIL (deixa pro modelo): (a) é PERGUNTA — "como criar uma playlist?"; (b) quer ABRIR
    // uma EXISTENTE — verbo de ouvir/abrir + "minha/sua playlist"; (c) ADICIONAR a uma
    // existente — "adiciona X na playlist". Nenhum desses é "criar do zero".
    const PL_QUESTION = /\b(como|o\s?que|oque|qual|quais|porque|por\s?que|how|what|which|why|when|where|cual|c[oó]mo|cu[aá]ndo)\b/.test(n) || /\?\s*$/.test(command);
    const PL_OPEN_EXISTING = /\b(ouv\w*|escu(?:t|ch)\w*|oye\b|oir\b|abr\w+|toc\w+|toqu\w+|reprodu\w+|open|play|listen\w*)\b/.test(n)
      && /\b(minha|meu|sua|seu|mi|tu|su|my|your|aquela|essa|esta|the)\s+(?:play\s?list|playlist|lista)\b/.test(n);
    const PL_ADD_EXISTING = /\b(adicion\w+|acrescent\w+|p[oõ]e\b|poe\w*|bota\w*|add|a[nñ]ad\w*|agreg\w*)\b/.test(n)
      && /\b(?:na|no|a|à|ao|em|to|in|en)\s+(?:minha|meu|sua|seu|mi|my|the|essa|esta|aquela)?\s*(?:play\s?list|playlist|lista)\b/.test(n);
    if (PL_NOUN.test(n) && PL_VERB.test(n)) {
      // Pergunta / abrir existente / adicionar → sempre pro modelo (nunca vira download).
      if (PL_QUESTION || PL_OPEN_EXISTING || PL_ADD_EXISTING) return null;
      // Serviço que NÃO é YouTube ("playlist no Spotify") → o executor só sabe montar no
      // YouTube; cede pro agente/modelo tentar no site citado. YouTube (Music) não baila.
      if (/\b(spotify|deezer|apple\s*music|itunes|tidal|amazon\s*music|soundcloud|napster|pandora)\b/.test(n)) return null;
      // IA forte (nuvem com chave, DeepSeek): cede pro modelo curar. Fraca (local ou
      // keyless): usa o atalho — senão o gpt-oss grátis falha o JSON e não cria nada.
      if (!opts?.weakModel) return null;
      const sp1 = n.replace(/([a-z])(\d)/g, '$1 $2');
      const nRaw = parseCount(sp1);
      // Nome ("com o nome X", "chamada X") + privacidade → vão na PRÓPRIA action (o
      // executor não re-parseia: evita nome-lixo "Treino com 8 músicas do Eminem").
      // Lazy + lookahead: captura SÓ o nome, parando em com/with/que/privada/…
      const NAME_RE = /\b(?:nome|chamad[ao]|chame\s+de|t[ií]tulo|titulo|named?|called|llamad[ao])\s*:?\s*["'“”]?([^\n"'“”,]{1,40}?)(?=\s+(?:com|with|con|que|e\s|and\s|y\s|privad\w*|particular|secret\w*|private)|["'“”,]|$)/i;
      const nameHit = stripAgentMeta(command).match(NAME_RE);
      const plName = nameHit ? nameHit[1].trim() : '';
      const wantPrivate = /\b(privad[ao]|particular|secret[ao]|private|s[oó]\s+(?:pra|para)\s+mim)\b/.test(n);
      const rawNoName = stripAgentMeta(command).replace(NAME_RE, ' ');
      // Usuário ENUMEROU as músicas? ("com Hit'em Up, California Love e Changes"). Trava
      // conservadora: sem "N músicas", com vírgula, SEM marcador de descrição (tipo/estilo/
      // gênero/like), o 1º item não pode ser genérico (músicas/canciones/…) e a lista não
      // pode ser toda de palavras soltas (senão "rock, pop e mpb" viraria 3 "músicas").
      let songs: string[] = [];
      const descMark = /\b(tipo|estilo|g[eê]?ner[oa]|g[eé]nero|like|such\s+as|kind\s+of|estilo\s+de)\b/i.test(rawNoName);
      if (nRaw <= 1 && rawNoName.includes(',') && !descMark) {
        const listPart = rawNoName.split(/\b(?:com|with|con)\b/i).slice(1).join(' ');
        const items = listPart.split(/,|\se\s|\sy\s|\sand\s|&/i).map(s => s.trim()).filter(s => s.length >= 2 && s.length <= 80).slice(0, 25);
        // Genéricos que denunciam "lista de vibe" e não títulos ("com músicas de rock…").
        // NÃO inclui hits/sucessos/top — colidiriam com títulos reais ("Hit 'em Up").
        const GENERIC = /^(musicas?|music|cancao|cancoes|cancion(?:es)?|song|songs|track|tracks|faixas?|temas?|som|sons|video|videos|clipes?|clips?)\b/i;
        const firstOk = items[0] && !GENERIC.test(normalize(items[0]));
        const anyMultiWord = items.some(s => s.trim().split(/\s+/).length >= 2);
        if (items.length >= 2 && firstOk && anyMultiWord) songs = items;
      }
      // Artista/tema: remove o par "N músicas" (dígito OU por extenso), os termos de
      // playlist e stopwords — o que sobra é o tema. Dígitos soltos FICAM ("anos 80").
      const CNT_RE = new RegExp('\\b(\\d{1,3}|' + Object.keys(NUM_WORDS).join('|') + ')\\s+(musicas?|music|cancao|cancoes|cancion(?:es)?|songs?|tracks?|faixas?|temas?|videos?|clipes?|clips?|tunes?)\\b', 'gi');
      const PL_STRIP = new Set(('playlist playlists play list lista listas reproducao reproduccion cria crie criar crea crear creame cria-la arma arme armar armame monta monte montar faz faca fazer haz hazme hacer gera gere gerar junta junte juntar separa separe separar prepara prepare preparar create creates make made build building generate generating put together named called nome chamada chamado chame titulo llamada llamado ' +
        'com with con de do da dos das del la el las los the of by para pra e and y uma um una one a o as os minha meu mi my sua seu tu su nova novo new ' +
        'essa esse esta este isso aquela aquele na no nas nos em ao aos que youtube ' +
        'musica musicas music cancao cancoes cancion canciones song songs track tracks faixa faixas tema temas tune tunes ' +
        'privada privado particular secreta secreto private salva salve salvar guarda guarde guardar save tocando favor').split(' '));
      const artist = rawNoName.replace(CNT_RE, ' ').split(/\s+/)
        .filter(w => { const wn = normalize(w).replace(/[.,!?;:'"]+$/g, '').replace(/^[.,!?;:'"]+/g, ''); return wn && !PL_STRIP.has(wn); })
        .join(' ').replace(/[,;:!?]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      if (songs.length >= 2) return { type: 'create_playlist', songs, count: songs.length, name: plName || undefined, private: wantPrivate || undefined };
      if (artist.length >= 2) return { type: 'create_playlist', songs: [], artist, count: Math.min(Math.max(nRaw > 1 ? nRaw : 10, 2), 12), name: plName || undefined, private: wantPrivate || undefined };
      return null;   // sem tema e sem lista → deixa o modelo nomear as músicas
    }
  }

  // "faça um supercut de X", "10 pessoas falando 'Y'" → LOCALIZA onde a frase é dita e
  // ABRE cada vídeo numa aba pausada no segundo exato (open_video_cuts). Não baixa mais os
  // trechos como arquivo (removido — ninguém usava nesse sentido). Testa antes do genérico.
  {
    const sp0 = n.replace(/([a-z])(\d)/g, '$1 $2');
    // Pergunta definicional ("o que é um supercut?", "what is a supercut") NÃO é pedido de criar.
    const defQ = /\b(o que (e|é)|oque (e|é)|que (e|é)\s+(um|uma|o|a)|what\s*(is|'s|are)|qu[eé]\s+es)\b/.test(sp0);
    const isSupercut = !defQ && (/\bsuper\s*cut\b|\bsupercorte\b/.test(sp0)
      || ((/\b(pessoas|gente)\s+(falando|dizendo)\b/.test(sp0) || /\b(people|persons?)\s+(talking|saying)\b/.test(sp0))
          && /\b(fa\w+|mont\w+|cri\w+|ger\w+|junt\w+|edit\w+|video|make|made|build|creat\w+|generat\w+)\b/.test(sp0)));
    if (isSupercut) {
      const cm = sp0.match(/\b(\d{1,2}|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:pessoas|videos|trechos|cortes|gente|people|clips?|cuts?)\b/);
      const cnt = cm ? (NUM_WORDS[cm[1]] || parseInt(cm[1], 10) || 6) : 6;
      const quoted = command.match(/["'“”‘’]([^"'“”‘’]{2,80})["'“”‘’]/);
      let phrase = quoted ? quoted[1].trim() : '';
      if (!phrase) {
        const after = command.split(/\b(?:falando|dizendo|falam|dizem|frase|palavra|talking|saying|say|word|phrase)\b/i).pop() || '';
        phrase = after.replace(/^[\s:,."']+/, '').replace(/[\s"'?!.]+$/, '').trim();
      }
      if (phrase.length >= 2 && phrase.length <= 80) {
        return { type: 'open_video_cuts', phrase, count: Math.min(Math.max(cnt, 1), 15) };
      }
    }
  }

  // GERAR IMAGEM (texto->imagem) — "gere uma imagem de X", "crie/desenhe uma imagem de Y".
  // Pollinations grátis (sem chave). Diferente de BAIXAR imagem (colheita). 0 token.
  {
    const sp = n.replace(/([a-z])(\d)/g, '$1 $2');
    const isGen = /\b(ger[ae]\w*|gener[ae]r?|cri[ae]\w*|cre[ae]\w*|desenh\w*|dibuj\w*|imagin\w*|generate|create|draw|imagine|make)\b/.test(sp)
      && /\b(imagem|imagens|figura|figuras|desenho|foto|fotos|arte|wallpapers?|image|images?|picture|pictures?|photos?|imagen|imagenes|dibujos?|drawing|art)\b/.test(sp)
      && !/\b(baix\w*|download|downloading|salv\w*|save|saving|pega\w*|descarg\w*)\b/.test(sp)
      // "quem criou essa imagem?"/"can you draw conclusions from this image?" são perguntas
      // sobre a imagem NA TELA (autoria/conteúdo), não pedido de gerar uma nova — 'draw' e
      // 'create' aqui são verbos de PERGUNTA ("draw conclusions"), não de GERAR arte.
      && !IS_WHO_QUESTION.test(sp) && !REFERS_TO_OPEN_ITEM.test(sp)
      && !/^\s*(como|c[oó]mo|how|o que|oque|whats?|what's|qual|quais|cu[aá]l|por que|porqu[eê]|why|does|can\s+you)\b/.test(sp);   // "como criar uma imagem?" é pergunta, não pedido de gerar
    if (isGen) {
      const cm = sp.match(/\b(\d{1,2})\s+(?:imagens|imagem|figuras|fotos?|images?|pictures?|photos?|imagenes)\b/);
      const count = cm ? Math.min(Math.max(parseInt(cm[1], 10), 1), 4) : 1;
      const STRIP = new Set(('gere gera gerar crie cria criar desenhe desenha desenhar faca faça facam imagine imagina ' +
        'uma um de do da dos das uns umas imagem imagens figura figuras desenho arte wallpaper wallpapers foto fotos por favor me pra ' +
        'generate create draw make imagine an a the of image images picture pictures drawing art please').split(' '));
      const prompt = stripAgentMeta(command).replace(/([a-z])(\d)/gi, '$1 $2').split(/\s+/)
        .filter(w => { const nw = normalize(w); return w && !STRIP.has(nw) && !/^\d{1,2}$/.test(nw); })
        .join(' ').trim();
      if (prompt.length >= 2) return { type: 'generate_image', prompt, count };
    }
  }

  // COLHEITA DE IMAGENS EM MASSA — "baixe 10 imagens do Superman em alta qualidade",
  // "quero 20 fotos de gatos". Volume sob demanda de buscador → Downloads/<tema>/.
  // (Diferente de search_images, que traz poucas e "limpas".) ANTES de outras regras.
  {
    const sp = n.replace(/([a-z])(\d)/g, '$1 $2'); // "baixe10 imagens" → "baixe 10 imagens"
    if (/\b(imagens?|imagem|imagen(?:e?s)?|fotos?|fotografias?|figuras?|wallpapers?|pap(?:el|eis)\s+de\s+parede|images?|photos?|pictures?|pics?)\b/.test(sp)
        && /\b(baix\w*|baj\w*|quero|queria|precis\w*|arranj\w*|consegue|consiga|salv\w*|pega\w*|arruma|me\s+da|junta|colhe|coleta|descarg\w*|quiero|guard\w*|download|downloading|want|need|save|saving|get|getting|grab|grabbing|fetch)\b/.test(sp)
        && !/\b(desta|dessa|deste|desse|nesta|nessa|aqui|daqui|da\s+p[aá]gina|do\s+site|this\s+page|from\s+(this|the)\s+page|on\s+(this|the)\s+page|here|current\s+page|esta\s+p[aá]gina)\b/.test(sp)
        // "quero saber se essa foto é verdadeira"/"who took this picture" são perguntas
        // sobre a foto NA TELA, não pedido de baixar um lote novo do buscador.
        && !IS_WHO_QUESTION.test(sp) && !REFERS_TO_OPEN_ITEM.test(sp)) {
      // quantidade: dígito ("3") OU por extenso ("tres") OU "varias/um monte". N>=2.
      const IMG_NUM: Record<string, number> = { uma: 1, duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, doze: 12, quinze: 15, vinte: 20, trinta: 30, cinquenta: 50, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50 };
      const noun = '(imagens?|imagen(?:e?s)?|fotos?|imagem|fotografias?|figuras?|wallpapers?|images?|photos?|pictures?|pics?)';
      const dm = sp.match(new RegExp('\\b(\\d{1,3})\\s+' + noun));
      const wm = sp.match(new RegExp('\\b(uma|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|doze|quinze|vinte|trinta|cinquenta|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|fifty)\\s+' + noun));
      const many = /\b(varias|varios|um\s+monte|monte\s+de|diversas|v[aá]rias|several|many|a\s+bunch|bunch\s+of|lots?\s+of|a\s+lot)\b/.test(sp);
      // Sem número explícito ("baixe imagens de gatos") cai num default sensato (12)
      // pra ir pela colheitadeira GRÁTIS, em vez de cair no agente pago.
      const count = dm ? Math.min(Math.max(parseInt(dm[1], 10), 1), 100)
        : wm ? (IMG_NUM[wm[1]] || 0)
        : (many ? 20 : 12);
      if (count >= 1) {   // 1, 2, 4, 10, 100… qualquer quantidade pedida vai pela colheitadeira
        const minW = /\b(alta|hd|4k|qualidade|resolu[cç][aã]o|grandes?|wallpapers?|high|big|large)\b/.test(sp) ? 1000 : 600;
        // limpa o termo: tira números, palavras de comando e de qualidade
        const STRIP = new Set(('baixar baixa baixe baixe me quero queria salvar salva salve pega pegue arruma colhe coleta junta ' +
          'imagens imagem fotos foto fotografias figuras figura wallpaper wallpapers papel papeis de parede ' +
          'em alta hd 4k qualidade resolucao resolução grandes grande varias varios diversas monte por favor ' +
          'um uma dois duas tres quatro cinco seis sete oito nove dez doze quinze vinte trinta cinquenta ' +
          'o a os as uns umas do da dos das de ' +
          'download want save get grab fetch images image photos photo pictures picture pics pic ' +
          'high big large several many bunch lots lot the of for to a an').split(' '));
        const q = stripAgentMeta(command).split(/\s+/)
          .filter(w => { const nw = normalize(w); return w && !STRIP.has(nw) && !/^\d{1,3}$/.test(nw); })
          .join(' ').trim();
        if (q.length >= 2) return { type: 'harvest_images', query: q, count, min_width: minW };
      }
    }
  }

  // NOTÍCIAS — "notícias de X", "últimas notícias sobre Y", "o que está acontecendo
  // com Z". Vai direto na aba Notícias do Google e raspa as manchetes → painel.
  {
    // !REFERS_TO_OPEN_ITEM: "resuma essa notícia"/"a notícia já está aberta" fala do artigo
    // NA TELA — buscar manchetes novas é o oposto do pedido. Cede pro agente, que lê a aba.
    // 'latest' sozinho é um gatilho FRACO: "download the LATEST song"/"play the LATEST
    // video" têm palavra de mídia própria (música/vídeo) sem NENHUMA palavra de notícia —
    // aí 'latest' descreve a MÍDIA, não pede manchete, e o pedido de verdade é das famílias
    // de download/vídeo mais abaixo. "latest version"/"meu download" (status, não notícia)
    // também cedem.
    const hasNewsWord = /\b(noticias?|not[ií]cia|manchetes?|headlines?|news)\b/.test(n);
    const stealsFromMediaFamily = !hasNewsWord && /\b(song|songs|video|videos|music|musica|musicas|track|tracks|mp3|mp4|clipe|clip)\b/.test(n);
    const isStatusOrVersionQ = !hasNewsWord && /\b(version|meu\s+download|my\s+download|esse\s+download|this\s+download)\b/.test(n);
    if (/\b(noticias?|not[ií]cia|manchetes?|ultimas?\s+not|o\s+que\s+(?:est[aá]|ta)\s+acontecendo|aconteceu\s+(?:hoje|com)|novidades?\s+(?:sobre|de|do|da)|news|headlines?|latest|what'?s\s+happening|what\s+happened)\b/.test(n)
        && !REFERS_TO_OPEN_ITEM.test(n) && !stealsFromMediaFamily && !isStatusOrVersionQ) {
      const STRIP = new Set(('noticia noticias notícia notícias manchete manchetes ultima ultimas última últimas ' +
        'me da de do da dos das sobre acerca o a os as um uma sobre quero ver mostra mostrar lista quais qual ' +
        'que esta ta acontecendo aconteceu hoje agora novidade novidades por favor recentes recente do dia ' +
        'news headlines headline latest about on of the a an what whats happening happened today now show me give').split(' '));
      const q = stripAgentMeta(command).split(/\s+/)
        .filter(w => { const nw = normalize(w); return w && !STRIP.has(nw); })
        .join(' ').trim();
      // sem assunto = "notícias do dia" (manchetes gerais)
      return { type: 'google_news', query: q.length >= 2 ? q : 'top news today' };
    }
  }

  // PREÇO / COMPRA — "preço de X", "quanto custa X", "X mais barato", "onde comprar
  // X", "compare preços de Y". Vai direto pro Google Shopping (agrega ML/Amazon/
  // Magalu) e raspa os preços. ANTES do filtro anti-pergunta ("qual o mais barato").
  {
    const isPrice = /\b(prec[oô]s?|precio|quanto\s+custa|cuanto\s+cuesta|quanto\s+(?:ta|esta|é)|barat[oa]s?|onde\s+(?:comprar|compro|acho)|donde\s+comprar|compar\w*\s+(?:de\s+)?prec\w*|menor\s+preco|valor\s+d[eo]|prices?|how\s+much|cheap(?:est|er)?|where\s+to\s+buy|compare\s+prices?)\b/.test(n);
    // cotação (ações/moedas/cripto) NÃO é produto — deixa pro fluxo certo
    const isQuote = /\b(acoes?|bolsa|d[oó]lar|euro|bitcoin|cripto|cota[cç][aã]o|ibovespa|stocks?|shares?|dollar|crypto)\b/.test(n);
    // Fala do pdf/documento anexado ("de acordo com o pdf, quanto custa") → é doc-QA, não
    // preço de produto. E "essa página"/"this"/"aberto" → o preço já está NA TELA; buscar
    // de novo no Shopping é o oposto do pedido — cede pro agente, que lê o preço exibido.
    const isDocOrOpenRef = /\b(pdf|documento|anexad\w*|attach\w*|adjunt\w*)\b/.test(n) || REFERS_TO_OPEN_ITEM.test(n);
    if (isPrice && !isQuote && !isDocOrOpenRef) {
      const STRIP = new Set(('procur\\w preco precos preço preços quanto custa ta esta é mais barato barata baratos baratas ' +
        'onde comprar compro acho compare comparar comparacao de do da dos das o a os as um uma menor valor por favor me ' +
        'quero queria achar encontrar ver mostra mostrar lista qual quais melhor ' +
        'price prices how much cheap cheapest cheaper where to buy compare of the a an for find show best value cost precio cuanto cuesta donde').split(' '));
      const toks = stripAgentMeta(command).split(/\s+/)
        .filter(w => { const nw = normalize(w); return w && !STRIP.has(nw) && !/^procur/.test(nw) && !/^compar/.test(nw) && !/^barat/.test(nw) && !/^localiz/.test(nw) && !(nw in NUM_WORDS); });
      // Tira um número de CONTAGEM no início ("3 raspberry" → "raspberry"), mas mantém
      // specs/modelos no meio (iPhone 15, RTX 5070, raspberry 8gb).
      if (toks.length > 1 && /^\d{1,2}$/.test(toks[0])) toks.shift();
      const q = toks.join(' ').trim();
      if (q.length >= 2) return { type: 'compare_prices', query: q };
    }
  }

  // SUPERCUT — "abrir 4 vídeos com a frase 'X'", "encontre 2 videos na minutagem
  // quando pronunciam a palavra Y", "abra vídeos onde falam Z".
  // Detectado ANTES do filtro anti-pergunta: a frase citada pode conter palavras
  // que o filtro bloqueia ("como", "qual", "melhor").
  {
    const sp = n.replace(/([a-z])(\d)/g, '$1 $2'); // "econtre2 videos" → "econtre 2 videos"
    const hasVideo = /\b(?:videos?|clipes?|clips?)\b/.test(sp);
    const hasCue = /\b(?:frase|palavra|expressao|falam|fala|dizem|diz|pronunci\w+|minutagem|momento\s+exato|exatamente\s+quando|phrase|word|says?|saying|pronounce\w*|exact\s+moment|exactly\s+when)\b/.test(sp);
    // 'quero/want' sozinho é fraco: "quero SABER a frase" é curiosidade (pergunta), não
    // "ache/abra a frase X" (o pedido de verdade). Só conta 'quero' se não vier com 'saber'.
    const hasVerb = /\b(?:abr\w*|encontr\w*|econtr\w*|ach\w*|busc\w*|procur\w*|mostr\w*|open|find|show|search)\b/.test(sp)
      || (/\b(?:quero|want)\b/.test(sp) && !/\b(?:saber|know|conhecer|conocer)\b/.test(sp));
    // Refere-se ao vídeo que JÁ ESTÁ aberto → o agente busca dentro da aba, não o executor
    // ytsearch+abre-nova-aba (que ignoraria o vídeo certo e traria um genérico).
    if (hasVideo && hasCue && hasVerb && !REFERS_TO_OPEN_ITEM.test(sp)) {
      const cm = sp.match(/\b(\d{1,2}|dois|duas|tres|quatro|cinco|seis|one|two|three|four|five|six)\s+(?:videos?|clipes?|clips?)/);
      const cnt = cm ? (NUM_WORDS[cm[1]] || parseInt(cm[1], 10) || 4) : 4;
      // Frase: preferir o trecho entre aspas do comando ORIGINAL (mantém acentos).
      const quoted = command.match(/["'“”‘’]([^"'“”‘’]{2,80})["'“”‘’]/);
      let phrase = quoted ? quoted[1].trim() : '';
      if (!phrase) {
        const after = command.split(/\b(?:frase|palavra|express\w+|falam|dizem|pronunci\w+|aparece|cont[eé]m|phrase|word|say|says|saying|pronounce\w*|contains?)\b/i).pop() || '';
        phrase = after.replace(/^[\s:,."']+/, '').replace(/[\s"'?!.]+$/, '').trim();
      }
      // "falam SOBRE futebol" é tema, não frase dita — deixa pro fluxo normal.
      if (/^(?:sobre|a respeito|do tema|about|regarding)\b/i.test(phrase)) phrase = '';
      if (phrase.length >= 2 && phrase.length <= 80) {
        return { type: 'open_video_cuts', phrase, count: Math.min(Math.max(cnt, 1), 15) };
      }
    }
  }

  // AÇÕES DA BOLSA — "tabela com as 100 ações que mais valorizaram hoje",
  // "quais ações mais caíram". Dado direto da fonte (BRAPI/Yahoo) + página local.
  {
    const sp2 = n.replace(/([a-z])(\d)/g, '$1 $2');
    // 'up'/'down' soltos saíram do gatilho: "scroll DOWN"/"sign UP" não têm nada a ver com
    // bolsa — só as palavras de movimento de fato (subiram/caiu/rose/gainers…) contam.
    // !REFERS_TO_OPEN_ITEM: "essas ações"/"dessa tabela na tela" é a TABELA JÁ ABERTA —
    // buscar dados novos é o oposto; e "o que significa"/"por que" é pergunta, não pedido.
    const isDefinitionalQ = /\b(o\s+que\s+significa|significa\b|what\s+does.*mean|por\s+que|porque|why|whats?)\b/.test(sp2);
    if (/\b(acoes|acciones|stocks?|shares?)\b/.test(sp2)
        && /\b(valoriz\w+|subi\w+|sobem|alta(s)?|ganha\w+|cair\w*|cairam|caem|baj\w+|cay\w+|queda(s)?|desvaloriz\w+|perde\w+|gain\w*|rose|rising|rallied|fell|fall\w*|dropp?\w*|losers?|gainers?)\b/.test(sp2)
        && !REFERS_TO_OPEN_ITEM.test(sp2) && !isDefinitionalQ) {
      const direction: 'gainers' | 'losers' = /\b(cair\w*|cairam|caem|baj\w*|cay\w*|queda(s)?|desvaloriz\w+|perde\w+|baixa(s)?|fell|fall\w*|dropp?\w*|down|losers?|losing)\b/.test(sp2) ? 'losers' : 'gainers';
      const cm = sp2.match(/\b(\d{1,3})\s+(?:acoes|acciones|stocks?|shares?)\b/) || sp2.match(/\b(?:acoes?|acciones|stocks?|shares?)\D{0,12}\b(\d{1,3})\b/);
      const count = cm ? Math.min(Math.max(parseInt(cm[1], 10), 5), 100) : 50;
      return { type: 'stock_movers', direction, count };
    }
  }

  // ABRIR N ABAS, CADA UMA COM UM VÍDEO/MÚSICA DE X — "abre 3 abas cada uma com uma
  // música do 2pac", "toca 3 músicas do Pink Floyd", "abre 3 vídeos do X". Resolve N
  // vídeos reais (ytsearchN, sem Shorts) e abre cada um numa aba tocando. 0 token.
  // ANTES do open_video (singular) por ser mais específico. Exige palavra de mídia +
  // contagem >= 2, então não captura "abre 3 abas do google".
  {
    const sp = n.replace(/([a-z])(\d)/g, '$1 $2');
    const isDl = /\b(baix\w*|download|downloading|salv\w*|save|saving)\b/.test(sp);
    const watchVerb = /\b(abr\w+|mostr\w+|toc\w+|toqu\w+|coloc\w+|coloqu\w+|p[oõ]e\b|pon\b|poner\b|pong\w+|ponme\b|ponte\b|bota\w*|reprodu\w+|assist\w+|ouv\w*|escu(?:t|ch)\w*|oye\b|oir\b|open\w*|play\w*|show\w*|watch\w*|listen\w*)\b/.test(sp);
    const mediaWord = /\b(video|videos|clipe|clipes|musica|musicas|music|cancao|cancoes|cancion|canciones|faixas?|temas?|song|songs|track|tracks|tunes?|clip|clips)\b/.test(sp);
    const cm = sp.match(/\b(\d{1,2}|duas|dois|dos|tres|quatro|cuatro|cinco|seis|sete|siete|oito|ocho|nove|nueve|dez|diez|two|three|four|five|six|seven|eight|nine|ten)\s+(?:abas?|guias?|tabs?|musicas?|videos?|cancoes|canciones|faixas?|temas?|clipes?|songs?|tracks?|tunes?|clips?)\b/);
    const cnt = cm ? (NUM_WORDS[cm[1]] || parseInt(cm[1], 10) || 0) : 0;
    // !IS_STOP_CONTROL_VERB: "fecha as 3 abas que voce abriu"/"pausa os 2 videos que estao
    // tocando" casam watchVerb via 'abriu'/'tocando' (PASSADO), mas o verbo de verdade é
    // FECHAR/PAUSAR — o oposto de abrir N vídeos novos. !REFERS_TO_MY_PLAYLIST: coleção
    // EXISTENTE do usuário, não um tema pra buscar do zero.
    if (!isDl && watchVerb && mediaWord && cnt >= 2 && !IS_STOP_CONTROL_VERB.test(sp) && !REFERS_TO_MY_PLAYLIST.test(sp) && !REFERS_TO_OPEN_ITEM.test(sp)) {
      const STRIP = new Set(('abre abra abrir mostra mostre mostrar toca tocar toque coloca colocar coloque poe poem pon poner ponme ponga ponte bota botar reproduz reproduzir reproducir reproduce assistir assista ouvir ouca ouve escuta escutar escute escucha escuchar oye oir navegador aba abas guia guias cada uma com no na do da de dos das o a os as e em uns umas un una open play show watch listen tab tabs each one with in on the of a an song songs track tracks tune tunes video videos clip clips musica musicas music cancao cancoes cancion canciones faixa faixas tema temas clipe clipes filme').split(' '));
      const q = stripAgentMeta(command).replace(/([a-z])(\d)/gi, '$1 $2').split(/\s+/)
        .filter(w => { const nw = normalize(w); return w && !STRIP.has(nw) && !/^\d{1,2}$/.test(nw) && !(nw in NUM_WORDS); })
        .join(' ').trim();
      if (q.length >= 2) return { type: 'open_videos', query: q, count: Math.min(cnt, 12) };
    }
  }

  // ABRIR/TOCAR UM VÍDEO DE VERDADE (não baixar, não supercut) — "mostre um vídeo de X",
  // "abra um vídeo de gato", "toque uma música do Pink Floyd", "mostre alguém fazendo um
  // bolo de cenoura", "me mostre como trocar um pneu". Resolve o 1º vídeo real (pula
  // Shorts via yt-dlp) e abre TOCANDO. ANTES do bloqueador de perguntas (pega "mostre COMO…").
  {
    const isDownload = /\b(baix\w*|download|downloading|salv\w*|save|saving)\b/.test(n);
    const phraseCue = /\b(onde\s+(?:falam|dizem|aparece)|frase|supercut|trecho|where\s+(?:they\s+)?(?:say|says)|phrase)\b/.test(n);  // → open_video_cuts, não isso
    // "veja o vídeo DESTA PÁGINA"/"o video ja esta tocando"/"esse video que voce abriu" falam
    // do vídeo JÁ ABERTO — abrir um vídeo aleatório do YouTube seria sequestro. Cede pro
    // agente/modelo, que enxerga a página. REFERS_TO_OPEN_ITEM cobre mais formas que o
    // pageCue original (aberto/already/essa/this soltos, não só "desta página").
    // 'atual/current' bare são seguros AQUI (família de vídeo não tem o risco de colisão
    // com "current events" que a de notícias tem) — "abre o vídeo atual" fala do que já
    // está tocando. 'quantos/how many' e "what X is playing" são perguntas de status.
    const pageCue = /\b(desta|dessa|deste|desse|da\s+pagina|do\s+site|dessa\s+aba|this\s+page|the\s+page|current\s+(?:page|tab)|on\s+screen|atual|current)\b/.test(n)
      || REFERS_TO_OPEN_ITEM.test(n)
      || /\b(quantos|quantas|how\s+many)\b/.test(n)
      || /\bwhat\s+\w+\s+is\s+playing\b|\bque\s+\w+\s+esta\s+tocando\b/.test(n);
    // toc\w+ pega "tocar/toca" mas NÃO "toque" (t-o-q-u-e); idem coloc/coloque → cobre os dois.
    const watchVerb = /\b(mostr\w+|veja|vejam|assist\w+|abr\w+|toc\w+|toqu\w+|coloc\w+|coloqu\w+|reprodu\w+|bota\b|botar\b|p[oõ]e\b|poem\b|pon\b|poner\b|pong\w+|ponme\b|ponte\b|ouv\w*|escu(?:t|ch)\w*|oye\b|oir\b|quero\s+ver|quiero\s+ver|ver\s+(?:un|una|um|uma)\b|watch|watching|play|playing|open|opening|show|showing|see|listen\w*|put\s+on)\b/.test(n);
    // 'show' fora: colide com "ir no show"/"comprar ingresso do show" (concerto físico).
    const mediaWord = /\b(video|videos|clipe|clipes|musica|musicas|music|cancao|cancoes|cancion|canciones|faixas?|temas?|filmes?|films?|peliculas?|peli|tutorial|aula|song|songs|track|tracks|tunes?|movie|clip|clips)\b/.test(n);
    const someoneDoing = /\b(mostr\w+|veja|quero\s+ver|show\s+me|i\s+want\s+to\s+see|watch)\b/.test(n)
      && /\b(alguem|gente|como|someone|somebody|people|how\s+to)\b/.test(n)
      && /\b(faz\w+|fazendo|cozinh\w+|prepar\w+|toc\w+|jog\w+|consert\w+|troc\w+|ensin\w+|dan[cç]\w+|cant\w+|pint\w+|desenh\w+|making|doing|cooking|preparing|playing|fixing|changing|teaching|dancing|singing|painting|drawing)\b/.test(n);
    // !IS_STOP_CONTROL_VERB: "coloca em tela cheia o video"/"pause the song that is playing"
    // casam watchVerb via 'coloc'/'toc' (do particípio "playing"), mas o pedido de verdade
    // é CONTROLAR o que já toca, não abrir um novo. !REFERS_TO_MY_PLAYLIST: coleção salva
    // do usuário. !IS_WHO_QUESTION: "quem é o cara que aparece no vídeo" é curiosidade.
    if (!isDownload && !phraseCue && !pageCue && !IS_STOP_CONTROL_VERB.test(n) && !REFERS_TO_MY_PLAYLIST.test(n) && !IS_WHO_QUESTION.test(n) && !IS_CANNOT.test(n)
        && ((watchVerb && mediaWord) || someoneDoing)) {
      const STRIP = new Set(('mostre mostra mostrar mostrem me te ver veja vejam quero queria quiero assistir assista abre abra abrir ' +
        'toca tocar toque coloca colocar coloque poe poem bota botar pon poner ponme ponga ponte reproduz reproduzir reproducir reproduce alguem gente algum alguma ' +
        'ouvir ouca ouve escuta escutar escute escucha escuchar oye oir ' +
        'um uma uns umas un una o a os as de do da dos das video videos clipe clipes musica musicas music cancao cancoes cancion canciones faixa faixas tema temas filme filmes film films pelicula peliculas peli tutorial aula show por favor pra para ' +
        'algum alguma alguns algumas algo qualquer some any unos unas ' +
        'watch play open show see listen listening put on someone somebody people how to a an the of for me i want to song songs track tracks tune tunes movie clip clips').split(' '));
      const q = stripAgentMeta(command).split(/\s+/)
        .filter(w => { const nw = normalize(w); return w && !STRIP.has(nw); })
        .join(' ').trim();
      if (q.length >= 2) return { type: 'open_video', query: q };
    }
  }

  // Vídeo já baixa na MELHOR qualidade por padrão. Só marcamos 'low' quando o
  // usuário PEDE baixa resolução; "alta/hd" → 'best' (mesmo efeito do padrão).
  const wantsLow = /\b(baixa\s+(resolu[cç][aã]o|qualidade)|menor\s+(resolu[cç][aã]o|qualidade)|resolu[cç][aã]o\s+baixa|low|360p?|480p?|pode\s+ser\s+ruim|qualidade\s+ruim|low\s+(?:res|quality|resolution)|bad\s+quality)\b/.test(n);
  const quality: 'best' | 'low' | undefined = wantsLow ? 'low' : (QUALITY_TEST_RE.test(n) ? 'best' : undefined);
  if (quality) n = n.replace(QUALITY_RE, ' ').replace(/\s+/g, ' ').trim();
  // CONTROLE da mídia (não é download) — "baixa/abaixa o volume", "baja el volumen",
  // "diminui o brilho", "baixa a velocidade". 'baixa/baja' aqui é ABAIXAR, não BAIXAR.
  // Cede pro agente (que mexe na página). Cobre PT e ES; conserta um buraco pré-existente.
  if (/\b(volume|volumen|brilho|brillo|brightness|velocidade|velocidad|speed|zoom)\b/.test(n)
      && /\b(baix\w*|baj\w*|abaix\w*|abaj\w*|diminu\w*|aument\w*|sub\w*|lower|raise|turn|increase|decrease)\b/.test(n)) return null;
  // TEMA = aparência da UI ("mudar o tema", "cambiar el tema"), não faixa de música. Só
  // cede quando o verbo é de TROCAR/personalizar tema — "descarga el tema de Rosalía"
  // (baixar a faixa) segue normal, porque ali não tem verbo de mudar tema.
  if (/\btema\b/.test(n) && /\b(mud\w*|troc\w*|cambi\w*|altera\w*|muda\w*|change|switch|personaliz\w*|customiz\w*)\b/.test(n)) return null;

  // Não sequestrar perguntas / pesquisa / tutoriais ("como baixar", "qual o melhor app").
  const hasHardDl = /\b(baix\w*|baj\w*|download|downloading|salv\w*|descarg\w*|guard\w*|save|saving|grab|grabbing|fetch)\b/.test(n);
  // 'quem/who/quién' faltava aqui — "quero saber QUEM canta essa música" tinha 'quero'
  // (hasGet) e não caía em NENHUMA outra palavra de pergunta da lista, então virava
  // download. É pergunta igual a "o que"/"qual" — mesma regra, faltava o pronome.
  if (/\b(como|o que|oque|qual|quais|quem|quién|quien|whose|porque|por que|tutorial|ensina|explica|aprende|significa|diferenca|site|aplicativo|app|programa|how|what|which|who|why|teaches?|explains?|software|program)\b/.test(n)) return null;
  // "melhor/best/top/recomenda" SEM verbo forte de baixar = recomendação ("quero o melhor
  // filme de 2024") → deixa pro modelo. Mas "baixe a melhor música do Queen" (tem 'baixe')
  // é download legítimo e passa. 'quero/want' sozinho não conta como verbo forte.
  if (/\b(melhor(es)?|mejor(es)?|best|top|recomend\w*|recommend\w*)\b/.test(n) && !hasHardDl) return null;

  // 'quero/queria/want/need' é um desejo FRACO — só prova intenção de baixar se não vier
  // grudado num verbo de CONTROLE/CONVERSA (pausar, saber, comentar, curtir…). Sem isto,
  // "quero pausar a música" e "quero saber quem canta" viravam download só por causa do
  // 'quero'. Só entra em ação quando não há verbo FORTE de baixar (hasHardDl) na frase.
  const NOT_ACQUIRE_VERB = /\b(pausar|pause|parar|paus[ae]|stop|stopping|saber|know|knowing|conversar|comentar|comment|commenting|curtir|like|liking|dizer|say|saying|contar|tell|telling|perguntar|ask|asking)\b/;
  const hasGet = /\b(baix\w*|baj\w*|download|downloading|salv\w*|pega\w*|quero|queria|gostaria|arruma|consegue|descarg\w*|quiero|guard\w*|save|saving|get|getting|grab|grabbing|fetch|want|need)\b/.test(n)
    && !(!hasHardDl && NOT_ACQUIRE_VERB.test(n));
  // "quero VER o vídeo" / "quero OUVIR a música" é consumo, não download — só
  // sequestra se houver verbo explícito de baixar junto.
  const hasWatch = /\b(ver|assistir|veja|assista|olh\w*|ouvir|escut\w*|toc\w*|coloc\w*|abr\w*|watch|watching|see|seeing|view|viewing|listen|listening|play|playing|open|opening)\b/.test(n);
  const hasDl = /\b(baix\w*|baj\w*|download|downloading|salv\w*|arquiv\w*|descarg\w*|guard\w*|save|saving|file)\b/.test(n);
  const wantsDownload = !IS_NEGATING_PRIOR_ACTION.test(n) && (hasDl || (hasGet && !hasWatch));
  const count = parseCount(n);
  // Drop helper words, the count digit (e.g. "3"), number-words and quality words so they
  // don't pollute the search query.
  const cleanQuery = () => stripAgentMeta(command).replace(QUALITY_RE, ' ').split(/\s+/)
    .filter(w => { const nw = normalize(w); return w && !QUICK_STRIP.has(nw) && !/^\d{1,2}$/.test(nw) && !(nw in NUM_WORDS); })
    .join(' ').trim();

  // ARQUIVAR A PÁGINA ATUAL — "baixe o vídeo/áudio desta página", "arquive esse vídeo",
  // "baixe o vídeo daqui". Sem assunto = mídia da aba aberta → download_video sem query
  // (o handler usa a URL atual). Instantâneo, 0 tokens.
  if (wantsDownload && /\b(video|vid|audio|musica|music|mp3|mp4|clipe|filme|film|pelicula|peli|som|cancao|cancion|faixa|tema|song|track|tune|movie|clip|sound)\b/.test(n)
      && /\b(desta|dessa|deste|desse|esta|essa|este|esse|aqui|daqui|dali|atual|da\s+pagina|do\s+site|dessa\s+aba|que\s+(esta|ta)\s+(aberto|tocando|(?:n|d)a\s+tela)|aberto|aberta|abierto|abierta|already|open|opened|this|here|current|the\s+(page|site|tab|video)|on\s+(?:screen|the\s+page)|playing)\b/.test(n)) {
    return { type: 'download_video', query: '', audio_only: /\b(audio|musica|music|mp3|som|cancao|cancion|faixa|tema|song|track|tune|sound)\b/.test(n) };
  }

  // ARQUIVO (pdf/doc/xls/ppt) — mais específico primeiro.
  // O !REFERS_TO_OPEN_DOC é essencial: sem ele "resuma o pdf aberto" virava uma busca no
  // Google por "resuma aberto". Falar do documento que já está na tela é o OPOSTO de
  // pedir um arquivo novo — quem lê a aba aberta é o agente (ou o 📎 anexar documento).
  if (/\b(pdf|docx?|xlsx?|pptx?|planilha|documento|manual|apostila|ebook|spreadsheet|document|slides?|presentation)\b/.test(n)
      && (hasGet || /\bpdf\b/.test(n))
      && !REFERS_TO_OPEN_DOC.test(n)
      && !IS_NEGATING_PRIOR_ACTION.test(n)
      && !ACTS_ON_EXISTING_DOC.test(n)
      && !CITES_DOC_AS_SOURCE.test(n)) {
    const filetype = /\b(xlsx?|planilha|spreadsheet)\b/.test(n) ? 'xlsx'
      : /\b(docx?|documento|word|document)\b/.test(n) ? 'docx'
      : /\b(pptx?|slide|apresentacao|slides?|presentation)\b/.test(n) ? 'pptx'
      : 'pdf';
    const q = cleanQuery();
    if (q.length >= 3) return { type: 'find_file', query: q, filetype };
  }

  // MÚSICA (mp3 / música / áudio) — dispara com mp3 OU com intenção de download.
  // 'tema(s)' = faixa em ES; o guard de tema-UI lá em cima já barrou "mudar o tema".
  // !REFERS_TO_MY_PLAYLIST: "baixe as músicas da minha playlist" — coleção EXISTENTE do
  // usuário, o executor só sabe buscar+baixar um tema NOVO no YouTube, não mexer na sua
  // playlist salva; viraria download de query-lixo. O `|| /\bmp3\b/` é o MESMO padrão do
  // bug do PDF (menção crua = gatilho, sem checar intenção) — "esse mp3 é bom?" disparava
  // só por citar 'mp3'; agora exige que não seja pergunta/opinião sobre o que já toca.
  if (/\b(mp3|musica|musicas|music|audio|audios|som|sons|cancao|cancoes|cancion|canciones|faixas?|temas?|song|songs|track|tracks|tunes?|sound)\b/.test(n)
      && !REFERS_TO_MY_PLAYLIST.test(n)
      && (wantsDownload || (/\bmp3\b/.test(n) && !REFERS_TO_OPEN_ITEM.test(n) && !IS_WHO_QUESTION.test(n) && !IS_CANNOT.test(n) && !IS_NEGATING_PRIOR_ACTION.test(n)))) {
    const q = cleanQuery();
    if (q.length >= 2) return { type: 'download_video', query: q, audio_only: true, count };
  }

  // VÍDEO (mp4 / vídeo / clipe / filme) — exige intenção de download (evita "veja o vídeo").
  // 'show(s)' fora: colide com "ir no show"/"assistir ao show" (concerto/programa).
  if (/\b(mp4|video|videos|vid|clipe|clipes|clip|clips|filmes?|films?|peliculas?|peli|movie|movies|documentarios?)\b/.test(n) && wantsDownload && !REFERS_TO_MY_PLAYLIST.test(n)) {
    const q = cleanQuery();
    if (q.length >= 2) return { type: 'download_video', query: q, count, quality };
  }

  return null;
}

function inferShortcutFromIntent(command: string): SiteShortcut | undefined {
  const normalized = normalize(command);
  if (/\b(imagem|imagens|foto|fotos|image|images|photo|photos|picture|pictures)\b/.test(normalized) && /\b(google|pesquise|pesquisar|busque|buscar|procure|search|find|look\s+up)\b/.test(normalized)) {
    return SITE_SHORTCUTS.find(site => site.id === 'google');
  }
  // Do NOT fast-path to YouTube when the user wants to FIND or CREATE something on
  // the web (a site, tool, generator) rather than WATCH a video. Tasks like
  // "encontrar um site que gera video", "ferramenta gratis sem login", "criar video"
  // are web-research tasks — let the agent decide (it will use Google).
  const findOrCreateIntent = /\b(gerar|gera|gere|gerador|criar|cria|crie|produzir|montar|encontrar|encontre|achar|ache|recomend\w*|melhor(es)?|site|sites|ferramenta|ferramentas|plataforma|aplicativo|gratis|gratuito|sem\s+login|sem\s+cadastro|sem\s+conta|generat\w*|creat\w*|make|build|find|search|best|tool|tools|platform|app|free|without\s+(?:login|account|signup))\b/.test(normalized);
  if (findOrCreateIntent) return undefined;
  // "video"/"videos" alone is ambiguous — only treat as a YouTube intent when paired
  // with a watch/play verb. Music/clip/show context is YouTube on its own.
  const musicContext = /\b(clipe|clip|musica|musicas|cancao|show|ao vivo|song|songs|track|live)\b/.test(normalized);
  const watchVideo = /\b(video|videos)\b/.test(normalized) && /\b(assistir|assista|tocar|toque|play|ver|veja|abrir|abra|ouvir|youtube|watch|open|see|listen)\b/.test(normalized);
  const watchVerbOnly = /\b(assistir|tocar|play|watch)\b/.test(normalized);
  if (musicContext || watchVideo || watchVerbOnly) return SITE_SHORTCUTS.find(site => site.id === 'youtube');
  return undefined;
}

export function rememberObservedSite(observation: ObservedState): void {
  const host = safeHost(observation.url);
  if (!host) return;

  const profiles = loadLearnedProfiles();
  const previous = normalizeProfile(profiles[host], host);
  const usefulElements = observation.interactive_elements
    .filter(el => el.text || el.aria || el.placeholder || el.href)
    .slice(0, 40)
    .map(el => ({
      text: (el.text || el.aria || '').slice(0, 100),
      role: el.role,
      tag: el.tag,
      placeholder: el.placeholder,
      href: el.href?.slice(0, 120),
      x: el.x,
      y: el.y,
      w: el.w,
      h: el.h,
    }));
  const mergedElements = mergeElements(previous.elements, usefulElements).slice(0, MAX_ELEMENTS_PER_SITE);
  const discovered = inferLandmarks(mergedElements);

  profiles[host] = {
    host,
    lastUrl: observation.url,
    title: observation.title,
    visits: previous.visits + 1,
    updatedAt: Date.now(),
    urls: rememberUrl(previous.urls, observation.url),
    landmarks: {
      searchFields: mergeElements(previous.landmarks.searchFields, discovered.searchFields).slice(0, 12),
      submitButtons: mergeElements(previous.landmarks.submitButtons, discovered.submitButtons).slice(0, 12),
      likeButtons: mergeElements(previous.landmarks.likeButtons, discovered.likeButtons).slice(0, 12),
      loginButtons: mergeElements(previous.landmarks.loginButtons, discovered.loginButtons).slice(0, 12),
    },
    successfulActions: previous.successfulActions,
    failedActions: previous.failedActions,
    elements: mergedElements,
  };

  persistLearnedProfiles();
}

export function rememberActionForSite(input: ActionMemoryInput): void {
  const host = safeHost(input.url);
  if (!host) return;

  const profiles = loadLearnedProfiles();
  const profile = normalizeProfile(profiles[host], host);
  const key = actionKey(input);
  const item: LearnedAction = {
    type: input.actionType,
    key,
    url: input.url,
    title: input.title,
    ts: Date.now(),
    success: input.success,
    note: input.note,
  };

  if (input.element?.tag) {
    const el: LearnedElement = {
      text: (input.element.text || '').slice(0, 100),
      role: input.element.role,
      tag: input.element.tag,
      placeholder: input.element.placeholder,
      href: input.element.href?.slice(0, 120),
      x: input.element.x,
      y: input.element.y,
      w: input.element.w,
      h: input.element.h,
    };
    profile.elements = mergeElements([el], profile.elements).slice(0, MAX_ELEMENTS_PER_SITE);
    const discovered = inferLandmarks([el]);
    profile.landmarks.searchFields = mergeElements(profile.landmarks.searchFields, discovered.searchFields).slice(0, 12);
    profile.landmarks.submitButtons = mergeElements(profile.landmarks.submitButtons, discovered.submitButtons).slice(0, 12);
    profile.landmarks.likeButtons = mergeElements(profile.landmarks.likeButtons, discovered.likeButtons).slice(0, 12);
    profile.landmarks.loginButtons = mergeElements(profile.landmarks.loginButtons, discovered.loginButtons).slice(0, 12);
  }

  if (input.success) {
    profile.successfulActions = mergeActions([item], profile.successfulActions).slice(0, MAX_ACTIONS_PER_SITE);
  } else {
    profile.failedActions = mergeActions([item], profile.failedActions).slice(0, MAX_ACTIONS_PER_SITE);
  }
  profile.lastUrl = input.url;
  profile.title = input.title ?? profile.title;
  profile.urls = rememberUrl(profile.urls, input.url);
  profile.updatedAt = Date.now();
  profiles[host] = profile;

  persistLearnedProfiles();
}

// Cache vivo dos perfis aprendidos. Antes, cada passo do agente fazia JSON.parse do
// blob inteiro (em buildKnownSitesBlock E em rememberObservedSite) + JSON.stringify
// na escrita — trabalho de CPU na main thread do renderer toda iteração, crescendo
// com N hosts × 80 elementos. Agora lê do cache e persiste com debounce.
let profileCache: LearnedProfiles | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function loadLearnedProfiles(): LearnedProfiles {
  if (profileCache) return profileCache;
  try {
    const raw = localStorage.getItem(LEARNED_SITES_KEY);
    profileCache = raw ? JSON.parse(raw) : {};
  } catch {
    profileCache = {};
  }
  return profileCache!;
}

// Coalescing das escritas: o store aprendido é não-crítico (reconstruído ao navegar),
// então um debounce curto tira o custo de stringify+setItem do loop quente do agente.
// Flush imediato no unload da página (abaixo) garante que nada se perde ao fechar.
function persistLearnedProfiles(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(flushLearnedProfiles, 1500);
}

function flushLearnedProfiles(): void {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  if (!profileCache) return;
  try { localStorage.setItem(LEARNED_SITES_KEY, JSON.stringify(profileCache)); } catch {}
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushLearnedProfiles);
}

function mergeElements(
  oldElements: LearnedElement[],
  newElements: LearnedElement[],
): LearnedElement[] {
  const map = new Map<string, LearnedElement>();
  for (const el of [...newElements, ...oldElements]) {
    const key = `${el.tag}|${el.role ?? ''}|${el.placeholder ?? ''}|${el.text}`;
    if (!map.has(key)) map.set(key, el);
  }
  return Array.from(map.values());
}

function mergeActions(oldActions: LearnedAction[], newActions: LearnedAction[]): LearnedAction[] {
  const map = new Map<string, LearnedAction>();
  for (const action of [...oldActions, ...newActions]) {
    const key = `${action.success}|${action.type}|${action.key}`;
    if (!map.has(key)) map.set(key, action);
  }
  return Array.from(map.values()).sort((a, b) => b.ts - a.ts);
}

function normalizeProfile(profile: LearnedSiteProfile | undefined, host: string): LearnedSiteProfile {
  return {
    host: profile?.host ?? host,
    lastUrl: profile?.lastUrl ?? '',
    title: profile?.title ?? '',
    visits: profile?.visits ?? 0,
    updatedAt: profile?.updatedAt ?? Date.now(),
    urls: profile?.urls ?? [],
    landmarks: {
      searchFields: profile?.landmarks?.searchFields ?? [],
      submitButtons: profile?.landmarks?.submitButtons ?? [],
      likeButtons: profile?.landmarks?.likeButtons ?? [],
      loginButtons: profile?.landmarks?.loginButtons ?? [],
    },
    successfulActions: profile?.successfulActions ?? [],
    failedActions: profile?.failedActions ?? [],
    elements: profile?.elements ?? [],
  };
}

function inferLandmarks(elements: LearnedElement[]): LearnedSiteProfile['landmarks'] {
  const searchFields = elements.filter(el => {
    const haystack = normalize(`${el.text} ${el.role ?? ''} ${el.placeholder ?? ''}`);
    return (el.tag === 'input' || el.tag === 'textarea' || el.role === 'searchbox' || el.role === 'textbox')
      && /search|pesquisa|pesquisar|buscar|busca|procure|query/.test(haystack);
  });
  const submitButtons = elements.filter(el => {
    const haystack = normalize(`${el.text} ${el.role ?? ''} ${el.placeholder ?? ''}`);
    return /button|submit|a|div/.test(el.tag) || el.role === 'button'
      ? /buscar|pesquisar|search|ir|go|submit|enviar/.test(haystack)
      : false;
  });
  const likeButtons = elements.filter(el => {
    const haystack = normalize(`${el.text} ${el.role ?? ''} ${el.placeholder ?? ''}`);
    return /gostei|like|curtir/.test(haystack);
  });
  const loginButtons = elements.filter(el => {
    const haystack = normalize(`${el.text} ${el.role ?? ''} ${el.placeholder ?? ''}`);
    return /entrar|login|sign in|acessar|conta/.test(haystack);
  });
  return { searchFields, submitButtons, likeButtons, loginButtons };
}

function rememberUrl(urls: string[], url: string): string[] {
  return [url, ...urls.filter(u => u !== url)].slice(0, MAX_URLS_PER_SITE);
}

function actionKey(input: ActionMemoryInput): string {
  const el = input.element;
  if (!el) return input.note ?? input.url;
  return `${el.tag ?? ''}|${el.role ?? ''}|${el.placeholder ?? ''}|${el.text ?? ''}`.slice(0, 180);
}

function formatLearnedElement(el: LearnedElement): string {
  const coords = el.x !== undefined && el.y !== undefined ? ` @(${Math.round(el.x)},${Math.round(el.y)})` : '';
  const label = [el.tag, el.role, el.placeholder ? `placeholder=${el.placeholder}` : '', el.text ? `text=${el.text}` : '']
    .filter(Boolean)
    .join(' ');
  return `- ${label}${coords}`;
}

function extractSearchQuery(command: string, site: SiteShortcut): string {
  const quoted = command.match(/["“”'‘’]([^"“”'‘’]{2,})["“”'‘’]/);
  if (quoted?.[1]) return quoted[1].replace(/\s+/g, ' ').trim();

  let q = command;
  for (const name of site.names) q = q.replace(new RegExp(escapeRegExp(name), 'ig'), ' ');
  q = q
    .replace(/\b(abrir|abre|abr[aã]|entrar|ir|vai|va|no|na|em|de|do|da|dos|das|um|uma|uns|umas|o|a|os|as|me|diga|dizer|fale|qual|titulo|t[ií]tulo|nome|aberto|aberta|pesquisar|pesquise|buscar|busque|procure|clicar|clique|clip|clipe|video|v[ií]deo|videos|v[ií]deos|musica|m[uú]sica|musicas|m[uú]sicas|can[cç][aã]o|show|ao vivo|dar|like|curtir|gostei|assistir|tocar|play|deixar|deixe|fazer|postar|publicar|coment[aá]rio|comentar|comment|comments|legal|bom|boa|top|massa|ingles|ingl[eê]s|portugues|portugu[eê]s|open|watch|search|find|look|show|listen|download|save|get|grab|the|of|for|to|on|song|songs|track|movie)\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(e|and|com)\s+/i, '')
    .replace(/\s+(e|and|com|do|da|de|no|na|o|a)[\s.,;:!?]*$/i, '')
    .replace(/\bsnoop\s+doog\b/i, 'snoop dogg')
    .replace(/\s+(e|and|com|do|da|de|no|na|o|a)[\s.,;:!?]*$/i, '')
    .trim();
  return q;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wantsGoogleImages(command: string): boolean {
  const normalized = normalize(command);
  return /\b(imagem|imagens|foto|fotos|image|images|photo|photos|picture|pictures)\b/.test(normalized);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Detecta uma URL/site EXPL\u00cdCITO no comando ("v\u00e1 em example.com", "https://\u2026",
// "busque em zoom.com.br") \u2014 sinal de que o usu\u00e1rio quer NAVEGAR pra um site espec\u00edfico,
// e n\u00e3o cair num atalho de busca (Google News/Shopping). Quando isso acontece, os atalhos
// determin\u00edsticos CEDEM (retornam null) e o agente navega pra URL e interage com ela.
// Ignora e-mails: o dom\u00ednio colado num '@' n\u00e3o casa (o '@' n\u00e3o entra na fronteira inicial).
// O roteador determinístico só fala pt/en/es: os gatilhos e a limpeza de query são
// listas de palavras nessas três línguas. Numa quarta língua ele fica cego — reconhece
// só o token latino solto ("PDF"/"MP3"/"HD") e não consegue remover NADA, então a frase
// crua vira a query. Maioria das letras fora do alfabeto latino = não é língua nossa.
// Um título estrangeiro dentro de um comando nosso continua passando ("baixe a música
// 米津玄師": o latino é maioria). Ceder é sempre seguro — só custa tokens.
// Sinal FORTE, sozinho: qualquer letra Han/Hiragana/Katakana/Hangul/Árabe/Cirílico/Grego/
// Hebraico já prova que não é pt/en/es — não precisa de maioria. Sem isto, uma frase real
// de erro ("Google Drive的PDF打不开", "Adobe Acrobat Reader не открывает PDF") tem tantas
// letras latinas de MARCA (Google/Drive/Adobe/Chrome/PDF) que a PROPORÇÃO passava batido.
const NON_LATIN_SCRIPT = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Arabic}|\p{Script=Cyrillic}|\p{Script=Greek}|\p{Script=Hebrew}/u;

function isForeignScript(command: string): boolean {
  if (NON_LATIN_SCRIPT.test(command || '')) return true;
  const letters = (command || '').match(/\p{L}/gu);
  if (!letters || letters.length < 4) return false;
  const latin = letters.filter(c => /\p{Script=Latin}/u.test(c)).length;
  return latin * 2 < letters.length;
}

export function commandHasExplicitUrl(command: string): boolean {
  const s = command || '';
  if (/\bhttps?:\/\/\S+/i.test(s)) return true;
  return /(^|[\s(/"'])([a-z0-9-]+\.)+(com|org|net|gov|edu|io|co|info|app|dev|me|tv|br|uk|us|ca|de|fr|es|pt|it|nl|ai|gg|xyz)(\b|\/)/i.test(s);
}

function safeHost(url?: string): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}
