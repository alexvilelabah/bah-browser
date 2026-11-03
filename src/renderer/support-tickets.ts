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
  const c = norm(command);
  // O primeiro citado manda: "Dell XPS … depois do update do Windows" é chamado com a Dell.
  let best: { s: SupportSite; at: number } | null = null;
  for (const s of SUPPORT_SITES) for (const n of s.names) {
    const m = new RegExp(`(?<![\\w.-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).exec(c);
    if (m && (!best || m.index < best.at)) best = { s, at: m.index };
  }
  return best?.s ?? null;
}

/** Chamado com fabricante conhecido: sair do domínio dele (notebookcheck, Gmail, busca) é recusado.
 *  Devolve o motivo, ou null se pode. Endereço escrito pela pessoa libera (ela escolheu). */
export function offSupportSite(action: { type: string; url?: string }, supportText: string, opts: { pageFailed?: boolean } = {}): string | null {
  const site = supportSiteFor(supportText);
  if (!site || /https?:\/\//i.test(supportText)) return null;
  // Página do fabricante que não carregou (Access Denied, 404, em branco): a busca na web acha o
  // endereço certo dela. Só a BUSCA é liberada — abrir um resultado continua restrito ao domínio dele.
  if (action.type === 'web_search') return opts.pageFailed ? null : `stay on ${site.vendor}'s own support site (${site.support}) — use its search or menus instead of a web search.`;
  if (action.type !== 'navigate' && action.type !== 'new_tab') return null;
  let host = '';
  try { host = new URL(/^https?:\/\//i.test(action.url || '') ? String(action.url) : `https://${action.url || ''}`).hostname.toLowerCase(); } catch { return null; }
  if (site.domains.some(d => host === d || host.endsWith('.' + d))) return null;
  return `${host} is not ${site.vendor}'s site — a support request goes only through ${site.support}. Stay there; if stuck, tell the user what blocks you.`;
}

export interface ContactProfile { firstName?: string; lastName?: string; email?: string; phone?: string; country?: string; postalCode?: string }

/** Bloco do prompt numa tarefa de suporte: site oficial + SÓ os dados de contato do perfil 📝. */
export function supportPromptBlock(command: string, profile: ContactProfile | null | undefined): string {
  const site = supportSiteFor(command);
  const forum = commandIsForum(command);
  const lines = ['SUPPORT TASK (see the support-ticket skill). The final Submit/Send/Post asks the user first — Bah shows them the text.'];
  // Endereço que a pessoa escreveu ganha do mapa (ela escolheu; ex.: cópia de treino, site do país).
  const given = /https?:\/\/[^\s"'<>]+/i.exec(command)?.[0]?.replace(/[).,;:]+$/, '');
  if (given) lines.push(`USER-GIVEN ADDRESS: ${given} — work there (the user chose it); do not switch to another site.`);
  else if (site) lines.push(`OFFICIAL ${site.vendor.toUpperCase()} ${forum && site.community ? 'COMMUNITY' : 'SUPPORT'}: ${forum && site.community ? site.community : site.support}${forum && site.community ? ` (support: ${site.support})` : ''} — use this domain; never a third-party "support" site or phone number from an ad.`);
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
