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
    || /\b(todas|todos|cada)\b.*\b(m[uú]sicas?|v[ií]deos?|clipes?|faixas?|canciones)\b/.test(c);
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
