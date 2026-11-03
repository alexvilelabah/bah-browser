// Chamado de suporte / post em fórum: detectar o pedido, apontar o site OFICIAL de suporte do
// fabricante e montar o texto que o cartão de confirmação mostra antes de enviar.
// Puro (sem DOM/Electron) exceto o script de página, que é só uma string; testado em
// tests/unit/support-tickets.test.ts.

const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// "open a support ticket with Apple", "ask Dell support about…", "abrir um chamado", "contactar soporte".
const TICKET = /\b(support|service|help ?desk)\s+(ticket|case|request)s?\b|\b(open|file|create|submit|raise|log|start)\s+(a\s+|an\s+|my\s+)?(new\s+)?(support\s+|service\s+|repair\s+)?(ticket|case)\b|\b(ask|contact|reach( out to)?|email|message|write to|chat with|get help from|call)\s+(\w+\s+){0,2}(support|customer (service|care|support)|tech(nical)? support|help ?desk)\b|\b(abrir|abra|criar|crie)\s+(um\s+)?(chamado|ticket|caso)\b|\bchamado\s+(de|no|na|com)\b|\b(falar|contatar|contactar|contacte|escrever)\s+(com\s+|a\s+|al\s+|para\s+o\s+)?(o\s+|el\s+)?(suporte|soporte)\b|\b(suporte|soporte)\s+t[eé]cnico\b|\b(ticket|caso)\s+de\s+(suporte|soporte)\b/;
// Post em fórum de suporte: precisa da palavra do fórum E da ação de postar/perguntar.
const FORUM_WORD = /\b(forums?|community|communities|discussions|f[oó]rum|comunidade|comunidad|foro)\b/;
const FORUM_ACT = /\b(post|ask|question|thread|topic|reply|publish|postar|publicar|perguntar|pergunta|preguntar|pregunta|tema)\b/;

export function commandIsForum(command: string): boolean {
  const c = norm(command);
  return FORUM_WORD.test(c) && FORUM_ACT.test(c);
}

/** Pedido de abrir chamado com o suporte de um fabricante ou postar num fórum de suporte. */
export function commandIsSupport(command: string): boolean {
  const c = norm(command);
  return TICKET.test(c) || commandIsForum(command);
}

/** O pedido desta vez, com o anterior quando é continuação de um chamado ("use chat, the serial is…",
 *  "continue"): sem isso a resposta da pessoa virava tarefa nova sem skill, sem freio do envio e sem site. */
export function supportRequestText(command: string, previousGoal?: string | null): string | null {
  if (commandIsSupport(command)) return command;
  if (!previousGoal || !commandIsSupport(previousGoal)) return null;
  // Pedido novo e longo (outra tarefa) não herda; resposta curta herda.
  if (command.trim().length > 220) return null;
  return `${previousGoal}\nFOLLOW-UP: ${command}`;
}

// Endereços de suporte conferidos à mão. Golpe de "suporte técnico" é comum (anúncio com
// telefone falso no topo da busca): o agente vai direto ao domínio do fabricante.
export interface SupportSite { vendor: string; names: string[]; support: string; community?: string; domains: string[] }
export const SUPPORT_SITES: SupportSite[] = [
  { vendor: 'Apple', names: ['apple', 'macbook', 'imac', 'iphone', 'ipad', 'airpods', 'apple watch', 'mac mini', 'mac studio'], support: 'https://support.apple.com/', community: 'https://discussions.apple.com/', domains: ['apple.com'] },
  { vendor: 'Dell', names: ['dell', 'xps', 'alienware', 'inspiron', 'latitude', 'precision', 'optiplex'], support: 'https://www.dell.com/support/home/en-us', community: 'https://www.dell.com/community/', domains: ['dell.com', 'delltechnologies.com'] },
  { vendor: 'HP', names: ['hp', 'hewlett-packard', 'hewlett packard', 'pavilion', 'elitebook', 'omen', 'spectre', 'envy'], support: 'https://support.hp.com/', community: 'https://h30434.www3.hp.com/', domains: ['hp.com'] },
  { vendor: 'Lenovo', names: ['lenovo', 'thinkpad', 'ideapad', 'legion', 'yoga'], support: 'https://support.lenovo.com/', community: 'https://forums.lenovo.com/', domains: ['lenovo.com'] },
  { vendor: 'Microsoft', names: ['microsoft', 'surface', 'xbox'], support: 'https://support.microsoft.com/', community: 'https://answers.microsoft.com/', domains: ['microsoft.com', 'live.com'] },
];

/** Fabricante citado no pedido (nome ou linha de produto) → site oficial; nenhum → null, nunca palpite. */
export function supportSiteFor(command: string): SupportSite | null {
  return knownMention(norm(command))?.s ?? null;
}

// O primeiro citado manda: "Dell XPS … depois do update do Windows" é chamado com a Dell.
function knownMention(c: string): { s: SupportSite; at: number } | null {
  let best: { s: SupportSite; at: number } | null = null;
  for (const s of SUPPORT_SITES) for (const n of s.names) {
    const m = new RegExp(`(?<![\\w.-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).exec(c);
    if (m && (!best || m.index < best.at)) best = { s, at: m.index };
  }
  return best;
}

// ── Fabricante genérico: o da tabela ou um nome de marca citado no pedido ("Canon printer", "ask Sonos
// support"). O site de suporte é achado por BUSCA na web no 1º passo; abrir resultado só no domínio do fabricante.

/** Fabricante do pedido: `site` = linha da tabela (domínios conferidos), senão só o nome (domínio = o nome). */
export interface SupportVendor { vendor: string; key: string; site: SupportSite | null }

// Palavras que caem no lugar do nome ("ask customer support", "with my laptop", "open support…") e nunca são fabricante.
const NOT_VENDOR = new Set((
  'a an the my our your their his her its this that these those me us him them it someone somebody anyone ' +
  'support suporte soporte service services servico servicio care customer customers client tech technical tecnico online live official ' +
  'help helpdesk desk team staff agent agents people person company companies vendor vendors manufacturer maker brand seller store shop retailer ' +
  'ticket tickets case cases request requests chamado caso community communities forum forums discussions comunidade comunidad foro ' +
  'about regarding for with to from on in at of and or but so then also again please now today new old same other another ' +
  'ask contact open file create submit raise log start call get need want reach write post find go use visit send chat message email ' +
  'mail phone text sms warranty repair return refund order account billing ' +
  'laptop notebook computer pc desktop printer mouse keyboard smartphone tablet tv monitor router modem camera headphones headset ' +
  'speaker speakers device devices product products app apps software battery screen fan issue issues problem problems question questions ' +
  'um uma o os as meu minha seu sua de do da dos das com para por sobre el la los las mi su con del al abrir abra criar crie falar ' +
  'isp internet provider bank insurance airline landlord school work office government').split(/\s+/));
// Aparelho citado junto do nome ("my Canon printer"): marca o nome e entra na busca como o produto.
const DEVICE = 'printers?|mouse|mice|keyboards?|headsets?|headphones|earbuds|earphones|speakers?|soundbar|routers?|modems?|monitors?|tv|television|cameras?|webcams?|laptops?|notebooks?|computers?|pcs?|desktops?|phones?|smartphones?|tablets?|watch|consoles?|drives?|ssds?|projectors?|scanners?|vacuum|fridge|refrigerator|washer|dryer|dishwasher|thermostat|doorbell|impressora|teclado|celular|impresora';
const NAME = '([a-z][a-z0-9&+]*(?:-[a-z0-9]+)?)';
// [padrão, forte]. Forte = o nome está no lugar do fabricante mesmo com outro da tabela citado
// ("ask Logitech support about the mouse on my Dell" → Logitech). Fraco ("with X") só vale antes do da tabela.
const VENDOR_PATTERNS: Array<[RegExp, boolean]> = [
  // "with Canon", "contact Brother", "com a Canon", "soporte técnico de Epson"
  [new RegExp(`\\b(?:with|contact|contacting|ask|call|email|message|reach(?: out)? to|write to|chat with|com(?: a| o)?|con|contatar|contactar|falar com|suporte(?: t[eé]cnico)? d[aoe]|soporte(?: t[eé]cnico)? de)\\s+(?:the\\s+)?${NAME}(?![\\w-])`, 'gd'), false],
  // "Canon support", "Logitech's customer service", "Sonos community"
  [new RegExp(`(?<![\\w-])${NAME}(?:'s)?\\s+(?:tech(?:nical)?\\s+|customer\\s+)?(?:support|service|care|help ?desk|community|communities|forums?|discussions)\\b`, 'gd'), true],
  // "my Canon printer", "a new Logitech MX mouse"
  [new RegExp(`\\b(?:my|our|a|an|the|this|meu|minha|mi)\\s+(?:(?:new|old|wireless)\\s+)?${NAME}\\s+(?:[a-z0-9-]+\\s+)?(?:${DEVICE})\\b`, 'gd'), true],
];

const vendorKey = (name: string) => norm(name).replace(/[^a-z0-9]/g, '');
const siteNamed = (name: string) => SUPPORT_SITES.find(s => s.names.some(n => vendorKey(n) === vendorKey(name))) || null;
const fromSite = (s: SupportSite): SupportVendor => ({ vendor: s.vendor, key: vendorKey(s.vendor), site: s });

/**
 * Fabricante do pedido. Da tabela (nome ou linha de produto) quando citado; senão um nome de marca no lugar
 * do fabricante ("with Canon", "Sonos support", "my Logitech mouse"). Nenhum → null: nunca inventa.
 * Nome fora da tabela escrito em minúsculas só vale num pedido todo em minúsculas (quem não usa maiúscula).
 */
export function supportVendorFor(command: string): SupportVendor | null {
  // O pedido manda; a resposta seguinte ("it's a Canon") só quando o pedido não nomeou ninguém.
  for (const part of String(command || '').split(/\nFOLLOW-UP:/)) { const v = vendorIn(part); if (v) return v; }
  return null;
}

function vendorIn(text: string): SupportVendor | null {
  const raw = text.replace(/https?:\/\/\S+/gi, ' ').normalize('NFC');
  const c = norm(raw);
  const known = knownMention(c);
  const allLower = raw === raw.toLowerCase();
  let best: { name: string; at: number; strong: boolean } | null = null;
  for (const [re, strong] of VENDOR_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(c); m; m = re.exec(c)) {
      re.lastIndex = m.index + 1;   // nomes sobrepostos ("ask Sonos support"): testa a partir de cada posição
      const name = m[1];
      const pos = m.indices![1][0];
      if (NOT_VENDOR.has(name) || name.length < 2) continue;
      const orig = raw.slice(pos, pos + name.length);
      if (!allLower && !/^[A-Z0-9]/.test(orig) && !siteNamed(name)) continue;
      const prev = best as { at: number; strong: boolean } | null;
      if (!prev || pos < prev.at) best = { name: orig, at: pos, strong };
      else if (pos === prev.at && strong) best = { name: orig, at: pos, strong: true };
    }
  }
  if (best) {
    const k = siteNamed(best.name);
    if (k) return fromSite(k);
    // Nome da tabela citado antes de um "with X" qualquer ("ticket for my Dell laptop with Windows 11") → a tabela.
    if (known && !best.strong && known.at < best.at) return fromSite(known.s);
    const vendor = /^[a-z]/.test(best.name) ? best.name[0].toUpperCase() + best.name.slice(1) : best.name;
    return { vendor, key: vendorKey(best.name), site: null };
  }
  return known ? fromSite(known.s) : null;
}

// Sufixos de 2º nível de país (canon.co.uk, canon.com.br): o nome registrado fica um rótulo antes.
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'ne', 'or', 'ac', 'gov', 'edu', 'go', 'gob']);

/** Domínio registrável: "support.canon.co.uk" → "canon.co.uk", "www.dell.com" → "dell.com". */
export function registrableDomain(host: string): string {
  const labels = String(host || '').toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length < 2) return labels.join('.');
  const n = labels.length >= 3 && /^[a-z]{2}$/.test(labels[labels.length - 1]) && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-n).join('.');
}

const hostFrom = (url: string) => {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase(); } catch { return ''; }
};

/**
 * Endereço no site do próprio fabricante? Da tabela: os domínios dela. Fora dela: o domínio registrável tem
 * que ser O NOME (canon.com, canon.co.uk, canon.de) em .com/.net/.org ou de país — nunca um parecido
 * (canon-support-help.com, canonprintersupport.net, canon.support), nem IP/localhost.
 */
export function vendorUrlOk(url: string, v: SupportVendor): boolean {
  const host = hostFrom(String(url || '').trim());
  if (!host) return false;
  if (v.site) return v.site.domains.some(d => host === d || host.endsWith('.' + d));
  if (/^[\d.]+$|^\[|^localhost$/.test(host)) return false;
  const reg = registrableDomain(host);
  const dot = reg.indexOf('.');
  if (dot < 0) return false;
  return reg.slice(0, dot) === v.key && /^(com|net|org|[a-z]{2}|(co|com|net|org|ne|or)\.[a-z]{2})$/.test(reg.slice(dot + 1));
}

/** Como o prompt nomeia o domínio aceito. */
export function vendorDomainsLabel(v: SupportVendor): string {
  return v.site ? v.site.domains.join(' / ') : `${v.key}.com (or ${v.key}.<country>)`;
}

/** Busca do 1º passo: fabricante + produto + "support" + "contact"/"community" — nunca palavras da instrução. */
export function supportSearchQuery(command: string, v: SupportVendor, product?: string): string {
  let prod = String(product || '').trim();
  if (!prod) {
    // Aparelho citado ("my Canon printer" → "printer"); o produto da tabela vem de supportFacts.
    const m = new RegExp(`\\b(${DEVICE})\\b`).exec(norm(String(command || '').split(/\nFOLLOW-UP:/)[0].replace(/https?:\/\/\S+/gi, ' ')));
    if (m) prod = m[1];
  }
  const seen = new Set<string>();
  const words = [v.vendor, ...prod.split(/\s+/)].filter(w => { const k = norm(w); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  return [...words, 'support', commandIsForum(command) ? 'community' : 'contact'].join(' ');
}

/** Chamado com fabricante: sair do domínio dele (notebookcheck, Gmail, anúncio de "suporte") é recusado.
 *  Devolve o motivo, ou null se pode. A busca na web sempre pode (é como se acha o site; abrir um resultado
 *  continua restrito); endereço escrito pela pessoa libera (ela escolheu). */
export function offSupportSite(action: { type: string; url?: string }, supportText: string): string | null {
  // Webmail nunca (ensaio: "não deu no site" → o modelo abria o Gmail pra mandar por e-mail), com ou sem fabricante.
  if ((action.type === 'navigate' || action.type === 'new_tab') && /^(https?:\/\/)?(mail\.google\.com|outlook\.(live|office)\.com|mail\.yahoo\.com|mail\.proton\.me)\b/i.test(String(action.url || '').trim())
      && !/mail\.google|gmail|outlook|yahoo mail|proton/i.test(supportText)) {
    return 'a support request goes through the vendor\'s own form — never the user\'s mailbox. If the form is stuck, stop and tell the user what blocks you.';
  }
  if (action.type !== 'navigate' && action.type !== 'new_tab') return null;
  const v = supportVendorFor(supportText);
  if (!v || /https?:\/\//i.test(supportText)) return null;
  const url = String(action.url || '').trim();
  const host = hostFrom(url);
  if (!host || vendorUrlOk(url, v)) return null;
  return `${host} is not ${v.vendor}'s site — a support request goes only through ${v.vendor}'s own domain (${vendorDomainsLabel(v)}); "support" ads and look-alike domains are scams. Open a result on that domain${v.site ? ` or ${v.site.support}` : ''}; if stuck, tell the user what blocks you.`;
}

export interface ContactProfile { firstName?: string; lastName?: string; email?: string; phone?: string; country?: string; postalCode?: string }

/** Bloco do prompt numa tarefa de suporte: site oficial + SÓ os dados de contato do perfil 📝. */
export function supportPromptBlock(command: string, profile: ContactProfile | null | undefined): string {
  const v = supportVendorFor(command);
  const site = v?.site;
  const forum = commandIsForum(command);
  const lines = ['SUPPORT TASK (see the support-ticket skill). The final Submit/Send/Post asks the user first — Bah shows them the text.'];
  // Endereço que a pessoa escreveu ganha do mapa (ela escolheu; ex.: cópia de treino, site do país).
  const given = /https?:\/\/[^\s"'<>]+/i.exec(command)?.[0]?.replace(/[).,;:]+$/, '');
  if (given) lines.push(`USER-GIVEN ADDRESS: ${given} — work there (the user chose it); do not switch to another site.`);
  else if (v) {
    // O site é achado pela busca do 1º passo; o endereço da tabela é só o reserva.
    lines.push(`FIND THE SITE: open ${v.vendor}'s ${forum ? 'community/support' : 'support'} result from the web search — only a result on ${vendorDomainsLabel(v)}, ${v.vendor}'s own domain. Never a third-party "support" site, look-alike domain or phone number from an ad.`);
    if (site) lines.push(`OFFICIAL ${site.vendor.toUpperCase()} ${forum && site.community ? 'COMMUNITY' : 'SUPPORT'}: ${forum && site.community ? site.community : site.support}${forum && site.community ? ` (support: ${site.support})` : ''} — the fallback if the search shows no ${site.domains[0]} result.`);
    else lines.push(`No result on ${vendorDomainsLabel(v)} → web_search again with other words, or ask the user for ${v.vendor}'s site.`);
  } else lines.push('VENDOR: not named. Ask the user which company makes it, or web_search the product words + "support"; open only the maker\'s own site — never a "support" ad or phone number.');
  const p = profile || {};
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
  const facts = [name && `name ${name}`, p.email && `email ${p.email}`, p.phone && `phone ${p.phone}`, p.country && `country ${p.country}`, p.postalCode && `postal code ${p.postalCode}`].filter(Boolean);
  // Ensaio: "contact me by email" fez o modelo abrir o Gmail. O contato é uma opção DO formulário.
  lines.push('"Contact me by email/phone/chat" = the contact option on the vendor\'s form. Never open the user\'s mail (Gmail) or any other site to send it.');
  lines.push(facts.length
    ? `USER CONTACT (from Bah's profile — the only personal data you may type): ${facts.join('; ')}. Serial number / service tag: only if the user's request gives it — otherwise ask.`
    : 'USER CONTACT: none saved. Personal data (name, phone, serial number) only from the request — otherwise ask the user; never invent it.');
  return lines.join('\n');
}

export interface DraftField { label: string; value: string; type: string }

/** O que vai ser enviado, pro cartão de confirmação: a descrição inteira primeiro, o resto curto. */
export function formatSupportDraft(fields: DraftField[], max = 1400): string {
  const clean = (s: string) => String(s || '').replace(/\s+/g, ' ').trim();
  const shown = (fields || []).filter(f => f && clean(f.value) && !/^(password|hidden|search|file|submit|button)$/i.test(f.type))
    .filter(f => !/\b(password|senha|contrase[nñ]a|search|pesquisa|buscar)\b/i.test(f.label));
  const long = shown.filter(f => f.type === 'textarea' || f.type === 'contenteditable');
  const short = shown.filter(f => !long.includes(f));
  const out = [
    ...short.map(f => `${clean(f.label).slice(0, 50) || 'field'}: ${clean(f.value).slice(0, 120)}`),
    ...long.map(f => `${clean(f.label).slice(0, 50) || 'message'}:\n${String(f.value).trim()}`),
  ].join('\n');
  // Ensaio: o modelo mandava o chamado só com o assunto e a caixa de descrição vazia.
  const empty = (fields || []).filter(f => f && f.type === 'textarea' && !clean(f.value) && !/\b(search|pesquisa|buscar)\b/i.test(f.label));
  const warn = empty.length ? `\n⚠️ Empty: ${empty.map(f => clean(f.label).slice(0, 50) || 'message box').join(', ')}` : '';
  const body = out.length > max ? `${out.slice(0, max - 1)}…` : out;
  return body + warn;
}

/** Na página: os campos visíveis preenchidos (rótulo + valor), sem senha nem campo oculto. */
export const SUPPORT_DRAFT_SCRIPT = `(function(){
  var vis = function(e){ var r = e.getBoundingClientRect(); var cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  var lab = function(e){
    // <label> que embrulha um <select> traria o texto das opções junto: tira os controles do clone.
    var l = e.getAttribute('aria-label') || '';
    if (!l && e.labels && e.labels[0]) { var c = e.labels[0].cloneNode(true); Array.prototype.forEach.call(c.querySelectorAll('input,select,textarea'), function(x){ x.remove(); }); l = c.textContent || ''; }
    if (!l && e.getAttribute('aria-labelledby')) { var x = document.getElementById(e.getAttribute('aria-labelledby')); if (x) l = x.innerText; }
    return (l || e.getAttribute('placeholder') || e.name || e.id || '').replace(/\\s+/g, ' ').trim();
  };
  var out = [];
  Array.prototype.forEach.call(document.querySelectorAll('input,textarea,select,[contenteditable=true],[contenteditable=""]'), function(e){
    if (!vis(e)) return;
    var tag = e.tagName.toLowerCase(), type = tag === 'input' ? (e.type || 'text').toLowerCase() : (tag === 'select' ? 'select' : (tag === 'textarea' ? 'textarea' : 'contenteditable'));
    if (/^(password|hidden|file|submit|button|reset|image)$/.test(type)) return;
    var v = '';
    if (type === 'checkbox' || type === 'radio') { if (!e.checked) return; v = (e.labels && e.labels[0] ? e.labels[0].innerText : e.value) || 'on'; out.push({ label: (e.name || lab(e)), value: v, type: type }); return; }
    if (tag === 'select') v = e.selectedIndex > 0 || (e.options[e.selectedIndex] && e.options[e.selectedIndex].value) ? e.options[e.selectedIndex].text : '';
    else if (type === 'contenteditable') v = e.innerText;
    else v = e.value;
    if (v && String(v).trim()) out.push({ label: lab(e), value: String(v).slice(0, 4000), type: type });
    else if (type === 'textarea') out.push({ label: lab(e), value: '', type: type });   // caixa vazia: o cartão avisa
  });
  return out.slice(0, 30);
})()`;
