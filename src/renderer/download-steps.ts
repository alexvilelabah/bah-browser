// Download é o último passo do pedido, ou o pedido continua depois dele? Decide se a tarefa acaba quando
// o download COMEÇA (o progresso fica no botão de downloads) ou se o Bah espera todos terminarem antes do
// próximo passo (encadeado: "baixe e instale", "baixe os dois e compare").

/** O pedido continua DEPOIS do download ("e instale", "depois resuma", "then compare"). */
export function commandHasFollowUp(command: string): boolean {
  return /\b(then|and then|after(wards)?|once (it|its|it's|they)|next)\b|\band (open|install|run|launch|unzip|extract|attach|upload|send|email|move|copy|rename|compare|read|summari[sz]e|play|watch|print|import|convert|share|post)\b|\b(install|unzip|extract|attach|upload|summari[sz]e|compare|convert|import|print)\b|\b(depois|em seguida|e (abra|instale|execute|descompacte|extraia|anexe|envie|mande|compare|resuma|leia|toque|imprima))\b|\b(instale|instalar|instalem|instale-o|instala-o|inst[aá]lalo|instala|descompact[ae]\w*|anex[ae]|anexar|resum[ae]|resumir|compar[ae]|comparar)\b|\b(luego|despu[eé]s|y (abre|instala|ejecuta|descomprime|adjunta|env[ií]a|compara|resume))\b/i.test(command);
}

/** O pedido é de VÁRIOS arquivos ("os dois", "todos", "3 vídeos") — aí a tarefa não acaba no 1º download. */
export function commandWantsSeveralFiles(command: string): boolean {
  return /\b([2-9]|\d{2,}|two|three|four|five|six|seven|eight|nine|ten|both|all|every|several|dois|duas|tr[eê]s|quatro|cinco|ambos|ambas|todos|todas|v[aá]rios|v[aá]rias|dos|cuatro|varios|varias)\b/i.test(command);
}

/** O download é o fim do pedido (um arquivo, nada depois). */
export function downloadIsLastStep(command: string): boolean {
  return !commandWantsSeveralFiles(command) && !commandHasFollowUp(command);
}

// ── Coleção ("todas as músicas/clipes do filme X", "a trilha sonora", "o álbum") ──
// O modelo pequeno acha a lista (Wikipedia) e guarda com `store`, mas não consegue tocar um laço longo de
// downloads (nos testes: rodava em círculo em buscas e caía no captcha do IMDb). Quando a lista chega,
// o BAH baixa faixa por faixa — pergunta a qualidade uma vez e no fim mostra uma tabela.

/** Pedido de COLEÇÃO pra baixar (precisa pesquisar a lista antes). */
export function isMediaCollectionRequest(command: string): boolean {
  const c = command.toLowerCase();
  if (!/\b(down?load\w*|baix[ae]\w*|baixar|descarg\w+)\b/.test(c)) return false;
  return /\b(all|every|each|whole|entire|complete|full)\b.*\b(songs?|tracks?|music\s+videos?|videos?|clips?)\b/.test(c)
    || /\b(soundtrack|tracklist|track\s+list|album|discography|trilha\s+sonora|banda\s+sonora|discografia)\b/.test(c)
    || /\b(todas|todos|cada)\b.*\b(m[uú]sicas?|v[ií]deos?|clipes?|faixas?|canciones)\b/.test(c)
    // "os 3 maiores sucessos do X", "top 5 music videos of X", "the most famous X songs… 3 of them": lista do conhecimento do modelo
    || (/\b(top\s+\d+|most\s+(famous|popular|played|viewed)|greatest\s+hits|best[- ]known|biggest\s+hits|maiores\s+sucessos|mais\s+(famos[ao]s|populares|tocad[ao]s)|m[aá]s\s+(famos[ao]s|populares)|grandes\s+[eé]xitos)\b/.test(c)
      && /\b(songs|tracks|music\s+videos|videos|clips|hits|m[uú]sicas|clipes|v[ií]deos|faixas|sucessos|canciones|[eé]xitos)\b/.test(c));
}

// "Os 3 maiores sucessos do X" / "top 5 Queen videos": a lista vem do que o modelo SABE, não de uma página.
const TOP_N_RE = /\b(top\s+\d+|most\s+(famous|popular|played|viewed)|greatest\s+hits|best[- ]known|biggest\s+hits|maiores\s+sucessos|mais\s+(famos[ao]s|populares|tocad[ao]s)|m[aá]s\s+(famos[ao]s|populares)|grandes\s+[eé]xitos)\b/;
export function isTopNCollection(command: string): boolean {
  return isMediaCollectionRequest(command) && TOP_N_RE.test(command.toLowerCase())
    && !/\b(soundtrack|trilha\s+sonora|banda\s+sonora|album|[aá]lbum|movie|film|filme|pel[ií]cula)\b/i.test(command);
}
const NUM_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, dois: 2, duas: 2, 'três': 3, tres: 3, quatro: 4, cinco: 5, dos: 2, cuatro: 4 };
/** Quantos itens: "top 3", "3 of them", "os 5 maiores" → n; sem número → 5. Teto 10. */
export function collectionCount(command: string): number {
  const c = command.toLowerCase();
  const m = c.match(/\btop\s+(\d+)\b/) || c.match(/\b(\d+|two|three|four|five|six|seven|eight|nine|ten|dois|duas|tr[eê]s|quatro|cinco|dos|cuatro)\s+(of\s+them|most|maiores|mais|m[aá]s|songs|tracks|music|videos|clips|hits|m[uú]sicas|clipes|v[ií]deos|sucessos|canciones)\b/);
  const n = m ? (Number(m[1]) || NUM_WORDS[m[1]] || 5) : 5;
  return Math.max(2, Math.min(10, n));
}
/** Pergunta direta ao modelo (sem navegar): a lista em JSON. */
export function topNListPrompt(command: string, n: number): string {
  return `The user asked: "${command.slice(0, 300)}". From your own knowledge, list the ${n} items they mean, most famous first. `
    + `Reply with ONLY a JSON array of exactly ${n} strings, each "Title — Artist" (the performing artist), e.g. ["Song — Artist", …]. No other text.`;
}
/** Resposta do modelo → itens ("Title — Artist"); aceita JSON, lista numerada ou com marcadores. */
export function parseTopNList(text: string, n: number): string[] {
  const t = String(text || '');
  const arr = t.match(/\[[\s\S]*\]/);
  let items: string[] = [];
  if (arr) { try { const v = JSON.parse(arr[0]); if (Array.isArray(v)) items = listItems(v); } catch {} }
  if (!items.length) items = listItems(t.split(/\r?\n/).filter(l => /^\s*(\d+[.)]|[-•*])\s+/.test(l)));
  return items.filter(x => !/[{}]/.test(x)).map(x => x.replace(/^["'“”]+|["'“”]+$/g, '').trim()).filter(Boolean).slice(0, n);
}

/** Vídeo (com som) ou só áudio? "music video/clipe" = vídeo; "songs/tracks/mp3/músicas" sem vídeo = áudio. */
export function collectionWantsAudioOnly(command: string): boolean {
  const c = command.toLowerCase();
  if (/\b(videos?|v[ií]deos?|clips?|clipes?|videoclipes?)\b/.test(c)) return false;
  return /\b(songs?|tracks?|mp3|audio|m[uú]sicas?|faixas?|canciones)\b/.test(c);
}

/** O valor guardado pelo modelo como lista de faixas (array, ou texto com uma por linha / separado por vírgula). */
export function listItems(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map(String)
    : typeof value === 'string' ? value.split(/\r?\n|;|,(?![^(]*\))/) : [];
  return raw.map(s => s.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(s => s.length >= 2 && s.length <= 120)
    .filter((s, i, a) => a.indexOf(s) === i)
    .slice(0, 30);
}

/** De quem/de onde é a coleção: "from the movie top gun with tom cruise" → "top gun". */
export function collectionSubject(command: string): string {
  const m = command.toLowerCase().match(/\b(?:from|of|do|da|del|de)\s+(?:the\s+|o\s+|a\s+|el\s+|la\s+)?(?:(?:19|20)\d\d\s+)?(?:animated\s+|original\s+)?(?:movie|film|filme|pel[ií]cula|album|álbum|soundtrack|trilha sonora|banda sonora|show|series|s[eé]rie)\s+(.+?)(?=\s+(?:with|and|then|by|com|e|y|con|para|for|not|n[aã]o)\b|\s*\(|[.,!?;]|$)/);
  if (!m) return '';
  // "from the soundtrack of the 1986 film top gun" → a obra é a de dentro ("top gun").
  const inner = m[1] !== command.toLowerCase() ? collectionSubject(m[1]) : '';
  return (inner || m[1]).replace(/["“”]/g, '').trim().slice(0, 60);
}

/** Faixa guardada como "Título — Artista" (também "–", " - " ou '"Título" by Artista') → partes. */
export function parseTrackEntry(item: string): { title: string; artist: string } {
  const s = String(item || '').replace(/\s+/g, ' ').trim();
  // "by" só com o título entre aspas: "Stand by Me" é um título, não "Stand" de "Me".
  const m = s.match(/^(.+?)\s+[—–-]\s+(.+)$/) || s.match(/^(["“].+["”])\s+by\s+(.+)$/i);
  if (!m) return { title: s, artist: '' };
  return { title: m[1].replace(/^["“]|["”]$/g, '').trim(), artist: m[2].replace(/^["“]|["”]$/g, '').trim() };
}

/**
 * Ano da obra ("1986") no pedido ou na expansão do roteador local ("…the 1986 film Top Gun…, not Top
 * Gun: Maverick (2022)"). O que vem depois de "not/instead of/não…" é o que a pessoa NÃO quer → fora.
 * Prefere o ano mais perto do nome da obra.
 */
export function subjectYear(subject: string, ...texts: string[]): string {
  const subj = String(subject || '').toLowerCase();
  for (const raw of texts) {
    const t = String(raw || '').toLowerCase().split(/,?\s+(?:not|instead of|rather than|excluding|n[aã]o|en lugar de|y no)\b/)[0];
    const years = [...t.matchAll(/\b(19\d\d|20\d\d)\b/g)];
    if (!years.length) continue;
    const at = subj ? t.indexOf(subj) : -1;
    if (at < 0) return years[0][1];
    const near = years.map(y => ({ y: y[1], d: Math.min(Math.abs(y.index! - at), Math.abs(y.index! - (at + subj.length))) })).sort((a, b) => a.d - b.d)[0];
    return near.y;
  }
  return '';
}

/**
 * Busca no YouTube pra uma faixa da coleção: título + artista + obra + ano. Sem o artista e o ano,
 * "Hold My Hand" de Top Gun virava a da Lady Gaga (Maverick, 2022) e não a do filme de 1986.
 */
export function collectionQuery(item: string, subject: string, audioOnly: boolean, year = ''): string {
  const { title, artist } = parseTrackEntry(item);
  const low = item.toLowerCase();
  const s = subject && !low.includes(subject.toLowerCase()) ? ` ${subject}` : '';
  const y = year && !low.includes(year) && !subject.includes(year) ? ` ${year}` : '';
  return `${title}${artist ? ' ' + artist : ''}${s}${y} ${audioOnly ? 'official audio' : 'official music video'}`.replace(/\s+/g, ' ').trim();
}
