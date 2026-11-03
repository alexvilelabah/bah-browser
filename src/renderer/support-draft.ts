// Chamado de suporte / post: o texto sai do que JÁ se sabe e o formulário é preenchido por código.
// Ensaio com modelo 8B: ele chegava ao formulário e deixava a descrição vazia, ou inventava detalhe
// (ano do modelo errado). Agora o Bah junta os FATOS (pedido, respostas da pessoa na mesma conversa,
// produto/serial que ela deu, o que o agente achou), pede ao modelo só a redação — com "só estes
// fatos" e conferência depois — e, se a chamada falhar ou inventar, usa um modelo fixo.
// Puro (sem DOM/Electron); testado em tests/unit/support-draft.test.ts.
import { SUPPORT_SITES, supportSiteFor, commandIsForum } from './support-tickets.ts';
import { classifyField, pickOption, type FieldInfo, type FillDecision, type ApplicantProfile } from '../shared/form-fill.ts';

const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export interface SupportFacts {
  vendor?: string;
  product?: string;
  serial?: string;
  contactMethod?: string;
  /** Frases do pedido (já sem "abra um chamado com a X"). */
  problem: string[];
  /** Frases das respostas seguintes da pessoa (sem "continue", "use chat", só o serial…). */
  followUps: string[];
  /** O que o agente achou na tarefa (ex.: um tópico parecido no fórum). */
  findings: string[];
  forum: boolean;
}

const URL_RE = /https?:\/\/[^\s"'<>)]+/gi;
// Serial / service tag: precisa ter dígito (ou ser só maiúsculas) — "serial number is" não vira serial.
const SERIAL_RE = /\b(?:serial(?:\s*(?:number|no\.?|#))?|service\s*tag|s\/n|n[uú]mero\s+de\s+s[eé]rie)\s*(?:is|é|es|:|=|#|-)?\s*([A-Z0-9][A-Z0-9-]{3,19})\b/i;
const CONTACT_RE = /\b(?:contact me|reach me|call me|i prefer|prefer|use|via|by|through|over|prefiro|por)\s+(?:the\s+|o\s+|el\s+)?(?:by\s+|via\s+|por\s+)?(chat|phone( call)?|telephone|call|e-?mail|telefone|liga[cç][aã]o|correo|tel[eé]fono)\b/i;
const MODEL_TOKEN = /^(\(?[a-z]{0,4}\d[\w.-]*\)?|pro|air|max|plus|mini|ultra|studio|carbon|flip|slim|x360|gen)$/i;

const splitSentences = (s: string): string[] => String(s || '')
  .split(/(?<=[.!?;])\s+|\n+|\s+[—–]\s+/).map(x => x.trim()).filter(x => /[a-z0-9]/i.test(x));
const capFirst = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
const endDot = (s: string) => /[.!?]$/.test(s) ? s : `${s}.`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Tira "abra um chamado com a Dell (cópia em …):" do começo — fica o problema, nas palavras da pessoa. */
export function stripSupportCommand(text: string): string {
  const t = String(text || '').replace(URL_RE, '').replace(/\(\s*(practice copy|copy|c[oó]pia)[^)]*\)/gi, '').replace(/\s+/g, ' ').trim();
  const head = /\b(open|file|create|submit|raise|log|start|make|ask|contact|reach out to|email|message|write to|chat with|get help from|call|post|abrir|abra|criar|crie|falar|contatar|contactar|escrever|publicar|perguntar|postar|preguntar)\b/i.exec(t);
  if (!head || head.index > 30) return t;
  const rest = t.slice(head.index);
  // Separadores: o que vem depois é o problema. "for my"/"why" ficam (fazem parte da frase).
  const seps: RegExp[] = [
    /\s*:\s+/, /\s+[—–-]\s+/, /,\s+(?=(?:my|our|the|it|i)\b)/i,
    /\s+(?:about|regarding|because|asking|saying|sobre|porque|acerca de)\s+/i,
    /\s+(?=(?:for|with|on)\s+(?:my|our)\b)/i, /\s+(?=(?:why|how|whether|por que|porqu[eé])\b)/i,
  ];
  let best = -1, cut = 0;
  for (const re of seps) {
    const m = re.exec(rest);
    if (m && m.index > 0 && (best < 0 || m.index < best)) { best = m.index; cut = m.index + m[0].length; }
  }
  if (best < 0) return t;
  return (t.slice(0, head.index) + rest.slice(cut)).replace(/^\s*(?:for|with|on)\s+(?=my\b|our\b)/i, '').trim();
}

/** Produto citado ("XPS 13 9310", "MacBook Air M2"): a linha de produto do fabricante + o modelo que vem colado. */
export function productFrom(text: string): string | undefined {
  const t = String(text || '').replace(URL_RE, ' ');
  const low = norm(t);
  let best: { at: number; len: number } | null = null;
  for (const s of SUPPORT_SITES) for (const n of s.names.slice(1)) {   // o 1º nome é o fabricante, não um produto
    const m = new RegExp(`(?<![\\w.-])${esc(n)}(?![\\w-])`).exec(low);
    if (m && (!best || m.index < best.at || (m.index === best.at && n.length > best.len))) best = { at: m.index, len: n.length };
  }
  if (!best) return undefined;
  let out = t.slice(best.at, best.at + best.len);
  for (const tok of t.slice(best.at + best.len).split(/\s+/).filter(Boolean).slice(0, 5)) {
    const clean = tok.replace(/[.,;:!?]+$/, '');
    if (!MODEL_TOKEN.test(clean)) break;
    out += ` ${clean}`;
    if (clean !== tok) break;   // "…9310," fecha o nome
  }
  return out.trim();
}

export function serialFrom(text: string): string | undefined {
  const m = SERIAL_RE.exec(String(text || '').replace(URL_RE, ' '));
  if (!m) return undefined;
  const v = m[1].replace(/-+$/, '');
  return /\d/.test(v) || /^[A-Z]{5,}$/.test(v) ? v : undefined;
}

export function contactMethodFrom(text: string): string | undefined {
  const m = CONTACT_RE.exec(String(text || ''));
  if (!m) return undefined;
  const w = norm(m[1]);
  return /chat/.test(w) ? 'chat' : /mail|correo/.test(w) ? 'email' : 'phone';
}

/** Frase que só dá ordem ao agente ("continue", "use chat", "o serial é X", "esse tópico não é o meu"): não vai pro chamado. */
function isDirective(sentence: string): boolean {
  if (/\b(that|this|the|esse|este|ese) (thread|post|discussion|topic|article|t[oó]pico|tema)\b/i.test(sentence)) return true;
  const s = sentence.replace(SERIAL_RE, ' ').replace(CONTACT_RE, ' ').replace(URL_RE, ' ')
    .replace(/\b(please|por favor|continue|go on|go ahead|proceed|carry on|keep going|yes|ok(ay)?|sure|thanks?|thank you|fill( in| out)?|draft|write|submit|send|post|open|create|new|a|an|the|it|is|and|then|now|request|ticket|case|form|question|discussion|fine|serial( number)?|service tag|number|contact me|i prefer|prefer|use|sim|pode|seguir|preencha|that|this|good|great|works|me|my)\b/gi, ' ');
  return (s.match(/[a-z0-9]{2,}/gi) || []).length < 2;
}

const cleanSentence = (s: string) => capFirst(s.replace(SERIAL_RE, '').replace(CONTACT_RE, '').replace(/[,;\s]+$/, '').replace(/\s+([.,;!?])/g, '$1').replace(/\s+/g, ' ').trim());

/**
 * Os fatos do chamado. request = o texto do pedido (supportRequestText: pode trazer "FOLLOW-UP: …");
 * followUps = mensagens seguintes da pessoa na mesma conversa; findings = o que o agente achou.
 */
export function supportFacts(request: string, followUps: string[] = [], findings: string[] = []): SupportFacts {
  const [root, ...inline] = String(request || '').split(/\nFOLLOW-UP:\s*/);
  const ups = [...inline, ...followUps].map(s => String(s || '').trim()).filter(Boolean)
    .filter((s, i, a) => a.indexOf(s) === i && s !== root.trim());
  const all = [root, ...ups].join('\n');
  const keep = (s: string) => /[a-z]{3}/i.test(s);
  const problem = splitSentences(stripSupportCommand(root)).filter(s => !isDirective(s)).map(cleanSentence).filter(keep);
  const more = ups.flatMap(u => splitSentences(u.replace(URL_RE, ' '))).filter(s => !isDirective(s)).map(cleanSentence).filter(keep);
  return {
    vendor: supportSiteFor(all)?.vendor,
    product: productFrom(all),
    serial: serialFrom(all),
    contactMethod: contactMethodFrom(all),
    problem,
    followUps: more.filter(s => !problem.includes(s)),
    findings: (findings || []).map(f => String(f || '').trim()).filter(Boolean).slice(0, 3),
    forum: commandIsForum(root),
  };
}

export interface SupportDraft { subject: string; description: string; source: 'model' | 'template' }

const TRIED_RE = /\b(tried|reset|restarted|rebooted|reinstalled|already|tentei|j[aá] (fiz|tentei|reiniciei)|reiniciei|reinstalei|intent[eé]|prob[eé])\b/i;
const WHEN_RE = /\b(since|after|started|starting|began|ago|last (week|month|night|update)|yesterday|desde|depois d[aoe]|come[cç]ou|despu[eé]s d[eo]|empez[oó])\b[^.;,]*/i;
const tagLabel = (f: SupportFacts) => f.vendor === 'Dell' ? 'Service tag' : 'Serial number';

/** Linha de assunto curta: produto + o sintoma, sem "desde quando". */
function subjectFrom(f: SupportFacts): string {
  const first = f.problem[0] || f.followUps[0] || '';
  let s = first.replace(WHEN_RE, '').replace(/[.!?;,\s]+$/, '');
  if (f.product) s = s.replace(new RegExp(esc(f.product), 'i'), '');
  if (f.vendor) s = s.replace(new RegExp(`\\b${esc(f.vendor)}\\b`, 'i'), '');
  s = s.replace(/^\s*(why|how)\s+((does|is|do|are)\s+)?/i, '').replace(/^\s*(my|our|the|meu|minha|mi)\s+/i, '')
    .replace(/\s+/g, ' ').replace(/^[\s,:'’s-]+(?=\w)/, '').replace(/^'s\s+/, '').trim();
  if (s.length > 70) s = s.slice(0, 70).replace(/\s+\S*$/, '') + '…';
  s = capFirst(s);
  const head = f.product || f.vendor || '';
  return (head && s ? `${head}: ${s}` : head || s || 'Support request').slice(0, 100);
}

/** Modelo fixo (sem IA): só as frases da pessoa, em seções. Nunca acrescenta fato. */
export function templateDraft(f: SupportFacts): SupportDraft {
  const all = [...f.problem, ...f.followUps];
  const tried = all.filter(s => TRIED_RE.test(s));
  const issue = f.problem.filter(s => !tried.includes(s));
  let extra = f.followUps.filter(s => !tried.includes(s));
  const lines: string[] = [];
  if (issue.length) lines.push(issue.map(endDot).join(' '));
  else if (extra.length) lines.push(endDot(extra.shift()!));
  // "Desde quando" só vira linha própria quando veio numa resposta seguinte (no pedido já está na frase).
  const whenS = WHEN_RE.test(lines.join(' ')) ? undefined : extra.find(s => WHEN_RE.test(s));
  if (whenS) { lines.push(`When it started: ${endDot(whenS)}`); extra = extra.filter(s => s !== whenS); }
  if (tried.length) lines.push(`What I already tried: ${tried.map(s => endDot(capFirst(s.replace(/^I\s+(have\s+)?(already\s+)?tried\s+/i, '')))).join(' ')}`);
  if (extra.length) lines.push(`More details: ${extra.map(endDot).join(' ')}`);
  if (f.product) lines.push(`Product: ${f.vendor && !norm(f.product).includes(norm(f.vendor)) ? `${f.vendor} ` : ''}${f.product}`);
  if (f.serial) lines.push(`${tagLabel(f)}: ${f.serial}`);
  if (f.findings.length) lines.push(`Related: ${f.findings.join('; ')}`);
  return { subject: subjectFrom(f), description: lines.join('\n') || 'Support request.', source: 'template' };
}

/** Pedido ao modelo: redigir com SÓ estes fatos. Resposta: SUBJECT / DESCRIPTION. */
export function draftPrompt(f: SupportFacts): string {
  const facts = [
    ...f.problem.map(s => `- The user said: ${s}`),
    ...f.followUps.map(s => `- The user added: ${s}`),
    f.product ? `- Product: ${f.product}` : '',
    f.serial ? `- ${tagLabel(f)}: ${f.serial}` : '',
    ...f.findings.map(s => `- Found while browsing: ${s}`),
  ].filter(Boolean).join('\n');
  const what = f.forum ? 'a question for a public support community forum (title + post body)' : 'a support ticket for the vendor (subject + description)';
  return `Write ${what} using ONLY the facts below. Do not add anything that is not in them: no model numbers, years, versions, dates, error codes, serial numbers, steps, causes or guesses. If something is unknown, leave it out — never say what the user did or did not try, change or check unless a fact says so. Write in first person, plain text, no markdown, at most 8 short lines. Cover: the symptom, when it started / what changed, what was already tried, product and serial (only if given).

FACTS:
${facts || '- (none)'}

Reply in exactly this shape:
SUBJECT: <one line, under 80 characters>
DESCRIPTION:
<the text>`;
}

/** Resposta do modelo → rascunho, ou null (formato errado). */
export function parseDraftReply(reply: string): { subject: string; description: string } | null {
  const r = String(reply || '').replace(/\r/g, '').replace(/\*\*/g, '');
  const sub = /^\s*(?:SUBJECT|TITLE)\s*:\s*(.+)$/im.exec(r);
  const di = /^\s*(?:DESCRIPTION|BODY|POST)\s*:\s*/im.exec(r);
  if (!sub || !di) return null;
  const description = r.slice(di.index + di[0].length).trim();
  const subject = sub[1].trim().replace(/^["']|["']$/g, '');
  if (!subject || description.length < 15) return null;
  return { subject: subject.slice(0, 120), description: description.slice(0, 2500) };
}

/** Número/código no rascunho que não está nos fatos (ano do modelo, versão, serial inventado). */
export function inventedTokens(draft: { subject: string; description: string }, f: SupportFacts): string[] {
  const known = norm([...f.problem, ...f.followUps, f.product, f.serial, f.vendor, ...f.findings].filter(Boolean).join(' ')).replace(/[^a-z0-9%]+/g, ' ');
  const words = new Set(known.split(' '));
  const knownJoined = known.replace(/\s+/g, '');
  const out: string[] = [];
  for (const tok of norm(`${draft.subject} ${draft.description}`).split(/[^a-z0-9%]+/)) {
    if (!tok || !/\d/.test(tok) || words.has(tok) || knownJoined.includes(tok)) continue;
    out.push(tok);
  }
  return [...new Set(out)];
}

// Palavras de ligação que um ticket usa sem afirmar fato nenhum.
const FILLER = new Set(('about also already anyone been could does from have hello help here into just know like please since some still than thanks thank that the their them then there these they this those what when where which while with would your yours issue problem product service serial number model happens happening started start begin began after before ever even every really very much more most tell anything someone something question details description subject title').split(' '));
const NEGATION = /\b(not|no|never|none|nothing|without)\b|n['’]t\b/i;
const stem = (w: string) => w.slice(0, 5);

/**
 * Frases do rascunho que afirmam o que a pessoa não disse. Ensaio (Qwen3-VL-8B): "I've not tried any
 * fixes yet", "I didn't change any settings", "I've tried restarting and resetting the SMC" — nada
 * disso estava no pedido. Regra: ≥70% das palavras de conteúdo da frase têm que estar nos fatos, e
 * negação só se a pessoa negou algo.
 */
export function unsupportedSentences(text: string, f: SupportFacts): string[] {
  const factText = norm([...f.problem, ...f.followUps, f.product, f.serial, f.vendor, ...f.findings].filter(Boolean).join(' '));
  const known = new Set(factText.split(/[^a-z0-9]+/).filter(w => w.length >= 4).map(stem));
  const factNeg = NEGATION.test(factText);
  const out: string[] = [];
  for (const s of splitSentences(text)) {
    const words = norm(s).replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !/\d/.test(w) && !FILLER.has(w));
    const ok = words.filter(w => known.has(stem(w))).length;
    if ((NEGATION.test(s) && !factNeg) || (words.length && ok / words.length < 0.7)) out.push(s);
  }
  return out;
}

/**
 * Rascunho final: o do modelo sem as frases que ele inventou (produto/serial garantidos no texto);
 * número que não está nos fatos, resposta fora do formato ou chamada que falhou → modelo fixo.
 */
export function finalDraft(f: SupportFacts, modelReply?: string | null): SupportDraft {
  const parsed = modelReply ? parseDraftReply(modelReply) : null;
  if (!parsed || inventedTokens(parsed, f).length) return templateDraft(f);
  const bad = new Set(unsupportedSentences(parsed.description, f));
  const kept = parsed.description.split('\n').map(line => splitSentences(line).filter(s => !bad.has(s)).join(' ')).filter(l => l.trim()).join('\n');
  if (kept.replace(/\s+/g, ' ').trim().length < 20 || !f.problem.concat(f.followUps).length) return templateDraft(f);
  if (unsupportedSentences(parsed.subject, f).length) parsed.subject = templateDraft(f).subject;
  let description = kept;
  if (f.product && !norm(description).includes(norm(f.product))) description += `\nProduct: ${f.product}`;
  if (f.serial && !description.includes(f.serial)) description += `\n${tagLabel(f)}: ${f.serial}`;
  return { subject: parsed.subject, description, source: 'model' };
}

// ── Preencher o formulário por código ──────────────────────────────────────────────────────────
const DESC_LABEL = /\b(describe|description|details?|issue|problem|message|question|body|comments?|explain|tell us|what happened|how can we help|descri\w*|detalh\w*|problema|mensagem|pergunta|coment\w*|explique|detall\w*|mensaje|conte[uú]do|contenido)\b/;
const SUBJECT_LABEL = /\b(subject|title|headline|summary|assunto|t[ií]tulo|resumo|asunto)\b/;
const SERIAL_LABEL = /\b(serial|service ?tag|s\/n|imei|express service code|n[uú]mero de s[eé]rie|numero de serie)\b/;
const PRODUCT_LABEL = /\b(product|model|device|computer|produto|modelo|dispositivo|equipamento|producto)\b/;
const SEARCH_LABEL = /\b(search|pesquis\w*|busca\w*|find)\b/;
// Do perfil 📝, só contato (o mesmo limite do supportPromptBlock).
const CONTACT_KEYS = new Set(['firstName', 'lastName', 'fullName', 'email', 'phone', 'country', 'postalCode']);
const TEXTY = /^(text|email|tel|textarea|number|url|select)$/;

export interface SupportFillDecision extends FillDecision { what: 'description' | 'subject' | 'serial' | 'product' | 'contact' }

/**
 * O que preencher num formulário de chamado/post: descrição, assunto, serial/produto (se a pessoa
 * deu), contato do perfil. Campo que a pessoa já preencheu fica como está; senha nunca. Formulário de
 * login (tem senha), sem caixa de texto, ou com a descrição já escrita → nada.
 */
export function planSupportFill(fields: FieldInfo[], draft: { subject: string; description: string }, facts: Pick<SupportFacts, 'product' | 'serial'>, profile?: ApplicantProfile | null): SupportFillDecision[] {
  const list = (fields || []).filter(Boolean);
  if (list.some(f => f.type === 'password')) return [];
  const label = (f: FieldInfo) => norm(`${f.label || ''} ${f.name || ''}`).replace(/[_-]+/g, ' ');
  const textareas = list.filter(f => f.type === 'textarea' && !SEARCH_LABEL.test(label(f)));
  const desc = textareas.find(f => DESC_LABEL.test(label(f))) || (textareas.length === 1 ? textareas[0] : undefined);
  if (!desc || desc.filled) return [];
  const out: SupportFillDecision[] = [];
  const push = (f: FieldInfo, what: SupportFillDecision['what'], value: string | undefined) => {
    if (!value) return;
    if (f.options && f.options.length) {
      const o = pickOption(f.options, value);
      if (o >= 0) out.push({ idx: f.idx, label: f.label, option: o, source: 'support', what });
    } else out.push({ idx: f.idx, label: f.label, value, source: 'support', what });
  };
  const p = profile || {};
  const contact = (key: string): string => key === 'fullName' ? [p.firstName, p.lastName].filter(Boolean).join(' ') : String((p as any)[key] || '').trim();
  for (const f of list) {
    if (f.filled || !TEXTY.test(f.type)) continue;
    const l = label(f);
    if (SEARCH_LABEL.test(l)) continue;
    if (f === desc) { push(f, 'description', draft.description); continue; }
    if (f.type === 'textarea') continue;   // outra caixa grande: o modelo/a pessoa decide
    if (SERIAL_LABEL.test(l)) { push(f, 'serial', facts.serial); continue; }
    const key = classifyField(f);
    if (key === 'skip') continue;
    if (key) { if (CONTACT_KEYS.has(key)) push(f, 'contact', contact(key)); continue; }
    if (f.type !== 'select' && SUBJECT_LABEL.test(l)) { push(f, 'subject', draft.subject); continue; }
    if (PRODUCT_LABEL.test(l)) push(f, 'product', facts.product);
  }
  return out;
}

/** Página que o agente viu e que serve de contexto (tópico parecido no fórum): "título — endereço". */
export function findingFrom(url: string, title: string, supportText: string): string | null {
  const site = supportSiteFor(supportText);
  let host = '', path = '';
  try { const u = new URL(url); host = u.hostname.toLowerCase(); path = u.pathname; } catch { return null; }
  if (site && !/https?:\/\//i.test(supportText) && !site.domains.some(d => host === d || host.endsWith('.' + d))) return null;
  if (!/\/(thread|threads|discussions?|td-p|m-p|topic|questions?)(\/|$)/i.test(path) || /\/(new|ask|create|post)(\/|$)/i.test(path)) return null;
  const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  return t ? `similar thread "${t}" (${url.slice(0, 200)})` : null;
}

/** Fim de tarefa de suporte "com sucesso" FORA do site do fabricante = desistiu (ex.: foi parar num blog). */
export function supportFinishProblem(supportText: string, finalUrl: string): string | null {
  const site = supportSiteFor(supportText);
  if (!site || /https?:\/\//i.test(supportText)) return null;
  let host = '';
  try { host = new URL(finalUrl).hostname.toLowerCase(); } catch { return null; }
  if (!host || site.domains.some(d => host === d || host.endsWith('.' + d))) return null;
  return `I did not get the ticket done: the task ended on ${host}, not on ${site.vendor}'s support site, so nothing was filed there.`;
}

/**
 * Conversa da sessão → o pedido de suporte de origem e as mensagens que a pessoa mandou depois
 * (tarefas e chat). Pula o pedido de agora (currentCommand). Só olha os últimos itens.
 */
export function supportThreadContext(entries: Array<{ kind: string; goal?: string; text?: string }>, isSupport: (s: string) => boolean): { root: string | null; followUps: string[] } {
  const recent = (entries || []).slice(-12);
  for (let i = recent.length - 1; i >= 0; i--) {
    const e = recent[i];
    if (e.kind === 'task' && e.goal && isSupport(e.goal.split('\nFOLLOW-UP:')[0])) {
      const followUps = recent.slice(i + 1).map(x => x.kind === 'task' ? x.goal : x.kind === 'user' ? x.text : '').filter((s): s is string => !!s && s.length <= 400);
      return { root: e.goal.split('\nFOLLOW-UP:')[0], followUps };
    }
  }
  return { root: null, followUps: [] };
}
