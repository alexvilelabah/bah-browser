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
  const isDownloadMedia = /\b(baix\w*|download|downloading|salv\w*|baixar|save|saving|get|grab)\b/.test(normalizedCommand)
    && /\b(musica|video|videos|audio|som|clipe|cancao|mp3|mp4|m[uú]sica|v[ií]deo|song|songs|track|movie|clip|sound)\b/.test(normalizedCommand);
  if (isDownloadMedia) return null;

  // Criar playlist: NÃO fast-path pro YouTube — deixa o agente emitir create_playlist
  // (monta a playlist por URL), em vez de só abrir a busca do YouTube.
  if (/\bplaylist\b/.test(normalizedCommand) && /\b(cri\w+|mont\w+|fa[cz]\w+|gera\w+|junt\w+|creat\w+|make|made|build|generat\w+|add)\b/.test(normalizedCommand)) return null;

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
  | { type: 'make_supercut'; phrase: string; count?: number }
  | { type: 'stock_movers'; direction: 'gainers' | 'losers'; count?: number }
  | { type: 'compare_prices'; query: string }
  | { type: 'google_news'; query: string }
  | { type: 'harvest_images'; query: string; count?: number; min_width?: number }
  | { type: 'find_file'; query: string; filetype: string };

const NUM_WORDS: Record<string, number> = {
  dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, doze: 12, quinze: 15, vinte: 20, trinta: 30, cinquenta: 50, cem: 100,
  // EN — paridade pro público open-source (mesmos atalhos de 0 token em inglês).
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50, hundred: 100,
};

// "baixe 3 músicas...", "baixe vinte músicas..." → quantos arquivos pegar (default 1).
function parseCount(n: string): number {
  const NOUN = '(?:musicas?|videos?|cancao|cancoes|clipes?|sons?|mp3|mp4|songs?|tracks?|clips?|movies?|sounds?)';
  const d = n.match(new RegExp('\\b(\\d{1,3})\\s+' + NOUN));
  if (d) return Math.min(Math.max(parseInt(d[1], 10), 1), 50);   // teto de seguranca 50
  const w = n.match(new RegExp('\\b(dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|doze|quinze|vinte|trinta|cinquenta|cem|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|fifty|hundred)\\s+' + NOUN));
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
   'mp3 mp4 musica musicas audio video videos som cancao cancoes clipe clipes clip clips arquivo arquivos ' +
   'qualidade boa alta maxima otima hd 4k uhd fullhd baixa resolucao resolução menor low 360p 480p 720p 1080p ruim ' +
   'pdf documento documentos planilha planilhas manual manuais apostila ebook livro formato ' +
   // EN — stopwords seguras pra não poluir a query (só removem ruído, não disparam ação).
   'save get grab fetch want need please my the of for to in on by this that some ' +
   'song songs track tracks file files movie movies sound sounds quality best high res resolution')
    .split(' '));

// "na melhor qualidade", "qualidade boa", "em hd/4k" → best quality. Must be detected
// AND removed before the question-blocker runs ("melhor" alone blocks) and before the
// query is built (so "qualidade" doesn't pollute the YouTube search).
const QUALITY_RE = /\b(?:n[ao]|em|com|de|in)?\s*(?:(?:melhor|boa|alta|m[aá]xima|[oó]tima|max)\s+qualidade|qualidade\s+(?:melhor|boa|alta|m[aá]xima|[oó]tima|max|hd|4k)|(?:best|high|highest)\s+quality|high\s+res(?:olution)?|full\s*hd|4k|uhd|hd|1080p?|1440p?|2160p?|alta\s+resolu[cç][aã]o)\b/gi;
// Cópia SEM flag /g pro .test() — regex global é stateful em .test() (avança lastIndex).
// QUALITY_RE fica só pros .replace() (que precisam do /g e zeram lastIndex sozinhos).
const QUALITY_TEST_RE = new RegExp(QUALITY_RE.source, 'i');

export function detectQuickAction(command: string): QuickAction | null {
  let n = normalize(command);

  // CRIAR PLAYLIST é tarefa do agente (o modelo nomeia as músicas → create_playlist).
  // Guarda no TOPO: "crie uma playlist e SALVE 10 MÚSICAS" tem 'salve'/'musicas'/'10',
  // que o detector de download capturaria por engano (vira download_video 10x). 0 captura aqui.
  if (/\bplaylist\b/.test(n) && /\b(cri\w+|mont\w+|fa[cz]\w+|gera\w+|junt\w+|adicion\w+|creat\w+|make|made|build|generat\w+|add)\b/.test(n)) return null;

  // SUPERCUT DE VERDADE (vídeo editado) — "faça um supercut de 10 pessoas falando
  // 'X'", "monte um vídeo com várias pessoas dizendo Y". Mais específico que o
  // open_video_cuts (abrir abas), então testa PRIMEIRO.
  {
    const sp0 = n.replace(/([a-z])(\d)/g, '$1 $2');
    const isSupercut = /\bsuper\s*cut\b|\bsupercorte\b/.test(sp0)
      || ((/\b(pessoas|gente)\s+(falando|dizendo)\b/.test(sp0) || /\b(people|persons?)\s+(talking|saying)\b/.test(sp0))
          && /\b(fa\w+|mont\w+|cri\w+|ger\w+|junt\w+|edit\w+|video|make|made|build|creat\w+|generat\w+)\b/.test(sp0));
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
        return { type: 'make_supercut', phrase, count: Math.min(Math.max(cnt, 1), 15) };
      }
    }
  }

  // COLHEITA DE IMAGENS EM MASSA — "baixe 10 imagens do Superman em alta qualidade",
  // "quero 20 fotos de gatos". Volume sob demanda de buscador → Downloads/<tema>/.
  // (Diferente de search_images, que traz poucas e "limpas".) ANTES de outras regras.
  {
    const sp = n.replace(/([a-z])(\d)/g, '$1 $2'); // "baixe10 imagens" → "baixe 10 imagens"
    if (/\b(imagens|fotos|imagem|fotografias|figuras|wallpapers?|papeis?\s+de\s+parede|images?|photos?|pictures?|pics?)\b/.test(sp)
        && /\b(baix\w*|quero|queria|salv\w*|pega\w*|arruma|me\s+da|junta|colhe|coleta|download|downloading|want|save|saving|get|getting|grab|grabbing|fetch)\b/.test(sp)) {
      // quantidade: dígito ("3") OU por extenso ("tres") OU "varias/um monte". N>=2.
      const IMG_NUM: Record<string, number> = { uma: 1, duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, doze: 12, quinze: 15, vinte: 20, trinta: 30, cinquenta: 50, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50 };
      const noun = '(imagens|fotos|imagem|foto|figuras|wallpapers?|images?|photos?|pictures?|pics?)';
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
    if (/\b(noticias?|not[ií]cia|manchetes?|ultimas?\s+not|o\s+que\s+(?:est[aá]|ta)\s+acontecendo|aconteceu\s+(?:hoje|com)|novidades?\s+(?:sobre|de|do|da)|news|headlines?|latest|what'?s\s+happening|what\s+happened)\b/.test(n)) {
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
    const isPrice = /\b(prec[oô]s?|quanto\s+custa|quanto\s+(?:ta|esta|é)|barat[oa]s?|onde\s+(?:comprar|compro|acho)|compar\w*\s+(?:de\s+)?prec\w*|menor\s+preco|valor\s+d[eo]|prices?|how\s+much|cheap(?:est|er)?|where\s+to\s+buy|compare\s+prices?)\b/.test(n);
    // cotação (ações/moedas/cripto) NÃO é produto — deixa pro fluxo certo
    const isQuote = /\b(acoes?|bolsa|d[oó]lar|euro|bitcoin|cripto|cota[cç][aã]o|ibovespa|stocks?|shares?|dollar|crypto)\b/.test(n);
    if (isPrice && !isQuote) {
      const STRIP = new Set(('procur\\w preco precos preço preços quanto custa ta esta é mais barato barata baratos baratas ' +
        'onde comprar compro acho compare comparar comparacao de do da dos das o a os as um uma menor valor por favor me ' +
        'quero queria achar encontrar ver mostra mostrar lista qual quais melhor ' +
        'price prices how much cheap cheapest cheaper where to buy compare of the a an for find show best value cost').split(' '));
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
    const hasVerb = /\b(?:abr\w*|encontr\w*|econtr\w*|ach\w*|busc\w*|procur\w*|mostr\w*|quero|open|find|show|search|want)\b/.test(sp);
    if (hasVideo && hasCue && hasVerb) {
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
    if (/\b(acoes|stocks?|shares?)\b/.test(sp2) && /\b(valoriz\w+|subiram|sobem|alta(s)?|ganha\w+|cair\w*|cairam|caem|queda(s)?|desvaloriz\w+|perde\w+|gain\w*|rose|rising|rallied|up|fell|fall\w*|dropp?\w*|down|losers?|gainers?)\b/.test(sp2)) {
      const direction: 'gainers' | 'losers' = /\b(cair\w*|cairam|caem|queda(s)?|desvaloriz\w+|perde\w+|baixa(s)?|fell|fall\w*|dropp?\w*|down|losers?|losing)\b/.test(sp2) ? 'losers' : 'gainers';
      const cm = sp2.match(/\b(\d{1,3})\s+(?:acoes|stocks?|shares?)\b/) || sp2.match(/\b(?:acoes?|stocks?|shares?)\D{0,12}\b(\d{1,3})\b/);
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
    const watchVerb = /\b(abr\w+|mostr\w+|toc\w+|toqu\w+|coloc\w+|coloqu\w+|p[oõ]e\b|bota\w*|reproduz\w+|assist\w+|open\w*|play\w*|show\w*|watch\w*)\b/.test(sp);
    const mediaWord = /\b(video|videos|clipe|clipes|musica|musicas|cancao|cancoes|song|songs|track|tracks|clip|clips)\b/.test(sp);
    const cm = sp.match(/\b(\d{1,2}|duas|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|two|three|four|five|six|seven|eight|nine|ten)\s+(?:abas?|guias?|tabs?|musicas?|videos?|cancoes|clipes?|songs?|tracks?|clips?)\b/);
    const cnt = cm ? (NUM_WORDS[cm[1]] || parseInt(cm[1], 10) || 0) : 0;
    if (!isDl && watchVerb && mediaWord && cnt >= 2) {
      const STRIP = new Set(('abre abra abrir mostra mostre mostrar toca tocar toque coloca colocar coloque poe poem bota botar reproduz reproduzir assistir assista navegador aba abas guia guias cada uma com no na do da de dos das o a os as e em uns umas open play show watch tab tabs each one with in on the of a an song songs track tracks video videos clip clips musica musicas cancao cancoes clipe clipes filme').split(' '));
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
    // toc\w+ pega "tocar/toca" mas NÃO "toque" (t-o-q-u-e); idem coloc/coloque → cobre os dois.
    const watchVerb = /\b(mostr\w+|veja|vejam|assist\w+|abr\w+|toc\w+|toqu\w+|coloc\w+|coloqu\w+|reproduz\w+|bota\b|botar\b|p[oõ]e\b|poem\b|quero\s+ver|ver\s+(?:um|uma)\b|watch|watching|play|playing|open|opening|show|showing|see|put\s+on)\b/.test(n);
    const mediaWord = /\b(video|videos|clipe|clipes|musica|musicas|cancao|filme|tutorial|aula|show|song|songs|track|movie|clip|clips)\b/.test(n);
    const someoneDoing = /\b(mostr\w+|veja|quero\s+ver|show\s+me|i\s+want\s+to\s+see|watch)\b/.test(n)
      && /\b(alguem|gente|como|someone|somebody|people|how\s+to)\b/.test(n)
      && /\b(faz\w+|fazendo|cozinh\w+|prepar\w+|toc\w+|jog\w+|consert\w+|troc\w+|ensin\w+|dan[cç]\w+|cant\w+|pint\w+|desenh\w+|making|doing|cooking|preparing|playing|fixing|changing|teaching|dancing|singing|painting|drawing)\b/.test(n);
    if (!isDownload && !phraseCue && ((watchVerb && mediaWord) || someoneDoing)) {
      const STRIP = new Set(('mostre mostra mostrar mostrem me te ver veja vejam quero queria assistir assista abre abra abrir ' +
        'toca tocar toque coloca colocar coloque poe poem bota botar reproduz reproduzir alguem gente algum alguma ' +
        'um uma uns umas o a os as de do da dos das video videos clipe clipes musica musicas cancao filme tutorial aula show por favor pra para ' +
        'watch play open show see put on someone somebody people how to a an the of for me i want to song songs track movie clip clips').split(' '));
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
  // Não sequestrar perguntas / pesquisa / tutoriais ("como baixar", "qual o melhor app")
  if (/\b(como|o que|oque|qual|quais|porque|por que|melhor|recomend\w*|tutorial|ensina|explica|aprende|significa|diferenca|site|aplicativo|app|programa|how|what|which|why|best|recommend\w*|teaches?|explains?|software|program)\b/.test(n)) return null;

  const hasGet = /\b(baix\w*|download|downloading|salv\w*|pega\w*|quero|queria|gostaria|arruma|consegue|save|saving|get|getting|grab|grabbing|fetch|want|need)\b/.test(n);
  // "quero VER o vídeo" / "quero OUVIR a música" é consumo, não download — só
  // sequestra se houver verbo explícito de baixar junto.
  const hasWatch = /\b(ver|assistir|veja|assista|olh\w*|ouvir|escut\w*|toc\w*|coloc\w*|abr\w*|watch|watching|see|seeing|view|viewing|listen|listening|play|playing|open|opening)\b/.test(n);
  const hasDl = /\b(baix\w*|download|downloading|salv\w*|arquiv\w*|save|saving|file)\b/.test(n);
  const wantsDownload = hasDl || (hasGet && !hasWatch);
  const count = parseCount(n);
  // Drop helper words, the count digit (e.g. "3"), number-words and quality words so they
  // don't pollute the search query.
  const cleanQuery = () => stripAgentMeta(command).replace(QUALITY_RE, ' ').split(/\s+/)
    .filter(w => { const nw = normalize(w); return w && !QUICK_STRIP.has(nw) && !/^\d{1,2}$/.test(nw) && !(nw in NUM_WORDS); })
    .join(' ').trim();

  // ARQUIVAR A PÁGINA ATUAL — "baixe o vídeo/áudio desta página", "arquive esse vídeo",
  // "baixe o vídeo daqui". Sem assunto = mídia da aba aberta → download_video sem query
  // (o handler usa a URL atual). Instantâneo, 0 tokens.
  if (wantsDownload && /\b(video|audio|musica|mp3|mp4|clipe|filme|som|song|track|movie|clip|sound)\b/.test(n)
      && /\b(desta|dessa|deste|desse|esta|essa|este|esse|aqui|daqui|dali|atual|da\s+pagina|do\s+site|dessa\s+aba|que\s+(esta|ta)\s+(aberto|tocando|na\s+tela)|this|here|current|the\s+(page|site|tab|video)|on\s+(?:screen|the\s+page)|playing)\b/.test(n)) {
    return { type: 'download_video', query: '', audio_only: /\b(audio|musica|mp3|som|song|track|sound)\b/.test(n) };
  }

  // ARQUIVO (pdf/doc/xls/ppt) — mais específico primeiro
  if (/\b(pdf|docx?|xlsx?|pptx?|planilha|documento|manual|apostila|ebook|spreadsheet|document|slides?|presentation)\b/.test(n) && (hasGet || /\bpdf\b/.test(n))) {
    const filetype = /\b(xlsx?|planilha|spreadsheet)\b/.test(n) ? 'xlsx'
      : /\b(docx?|documento|word|document)\b/.test(n) ? 'docx'
      : /\b(pptx?|slide|apresentacao|slides?|presentation)\b/.test(n) ? 'pptx'
      : 'pdf';
    const q = cleanQuery();
    if (q.length >= 3) return { type: 'find_file', query: q, filetype };
  }

  // MÚSICA (mp3 / música / áudio) — dispara com mp3 OU com intenção de download
  if (/\b(mp3|musica|musicas|audio|som|cancao|song|songs|track|tracks|sound)\b/.test(n) && (wantsDownload || /\bmp3\b/.test(n))) {
    const q = cleanQuery();
    if (q.length >= 2) return { type: 'download_video', query: q, audio_only: true, count };
  }

  // VÍDEO (mp4 / vídeo / clipe) — exige intenção de download (evita "veja o vídeo")
  if (/\b(mp4|video|videos|clipe|clipes|clip|clips|movie|movies)\b/.test(n) && wantsDownload) {
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

function safeHost(url?: string): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}
