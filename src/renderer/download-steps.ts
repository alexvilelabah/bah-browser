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
  const m = command.toLowerCase().match(/\b(?:from|of|do|da|del|de)\s+(?:the\s+|o\s+|a\s+|el\s+|la\s+)?(?:movie|film|filme|pel[ií]cula|album|álbum|soundtrack|trilha sonora|banda sonora|show|series|s[eé]rie)\s+(.+?)(?=\s+(?:with|and|then|by|com|e|y|con|para|for)\b|[.,!?]|$)/);
  return m ? m[1].replace(/["“”]/g, '').trim().slice(0, 60) : '';
}

/** Busca no YouTube pra uma faixa da coleção. */
export function collectionQuery(item: string, subject: string, audioOnly: boolean): string {
  const s = subject && !item.toLowerCase().includes(subject) ? ` ${subject}` : '';
  return `${item}${s} ${audioOnly ? 'official audio' : 'official music video'}`.replace(/\s+/g, ' ').trim();
}
