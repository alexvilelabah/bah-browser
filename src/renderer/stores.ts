// "A pessoa nomeou um lugar pra comprar?" — sem lista de lojas (nunca daria pra manter uma lista
// mundial). Basta o FORMATO do pedido: "... at/on/from <nome>" (fora horários/datas) ou um domínio
// citado. Quem descobre o site da loja é o agente (web_search pelo nome). Usado pelo roteador (vai
// pro agente, não pra pesquisa), pelo atalho de preço do Google Shopping (cede) e pelo tipo de
// tarefa `shopping` (skills de compra).
const DOMAIN_RE = /\b[a-z0-9-]+\.(com|net|org|co|shop|store|com\.[a-z]{2}|co\.[a-z]{2}|[a-z]{2})\b/i;
// at/on/from + até 4 palavras, terminando a frase ou antes de "for/under/with/that/near/,".
const AT_PLACE_RE = /\b(?:at|on|from|na|no|em|en)\s+(?:the\s+|a\s+)?([a-z0-9][\w'’&.-]*(?:\s+[a-z0-9][\w'’&.-]*){0,3}?)\s*(?=$|[.!?,;]|\s+(?:for|under|below|with|that|which|near|and|or|para|com|por)\b)/i;
// O que vem depois de at/on e NÃO é loja: horário, dia, data, "sale", "night"... e obra/mídia ("from the
// movie top gun", "from the album thriller") — senão o pedido de clipes virava tarefa de COMPRA.
const NOT_A_PLACE_RE = /^(noon|night|midnight|morning|evening|night|lunch|dinner|weekends?|this weekend|next weekend|weekdays?|today|tonight|tomorrow|(mon|tues|wednes|thurs|fri|satur|sun)days?|sale|discount|clearance|time|once|all|least|most|first|last|home|work|the moment|\d.*|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*( \d.*)?|(movie|film|filme|album|álbum|soundtrack|series|s[eé]rie|show|band|banda|artist|artista|playlist|channel|canal|video|v[ií]deo|book|livro|game|jogo|episode|epis[oó]dio)\b.*)$/i;

export function namedPlace(text: string): string | null {
  if (DOMAIN_RE.test(text)) return (text.match(DOMAIN_RE) || [''])[0];
  const m = AT_PLACE_RE.exec(text.trim());
  if (!m) return null;
  const place = m[1].trim().replace(/[.!?,;]+$/, '');
  return NOT_A_PLACE_RE.test(place) ? null : place;
}

export function namesStore(text: string): boolean {
  return namedPlace(text) !== null;
}
