// Vagas listadas na página (tarefa de vaga): o modelo pequeno procurava uma seção chamada
// "Recommended" e não reconhecia os cartões de "Matches your preferences" da home logada do
// Indeed como as vagas recomendadas. Aqui o Bah conta os cartões e diz: estas SÃO as vagas.
// O marcador de salvo (o "bookmark" pressionado no cartão) = vaga que a pessoa (ou o agente)
// guardou — escolha válida, e que não deve ser desmarcada.
// Também marca as vagas JÁ ABERTAS nesta tarefa (pelo ID da vaga no endereço) e diz qual é a
// próxima: sem isso o modelo reabria a 1ª vaga em círculo e recarregava a página.

export interface JobListing { title: string; text: string; href: string; saved: boolean }

/** Marca como aberta a vaga cujo título é o começo do título da página ("VP of IT … - Los Angeles, CA - Indeed.com"). */
export function noteOpenedByTitle(opened: Set<string>, pageTitle: string, items: JobListing[]): void {
  const t = (pageTitle || '').toLowerCase().trim();
  for (const j of items || []) { const jt = (j.title || '').toLowerCase(); if (jt.length >= 6 && t.startsWith(jt)) opened.add('t:' + jt); }
}

// ID da vaga num endereço: ?jk= / ?vjk= (Indeed), currentJobId (LinkedIn), gh_jid (Greenhouse)…
export function jobIdOf(url: string): string | null {
  try {
    const u = new URL(url);
    for (const k of ['jk', 'vjk', 'currentJobId', 'gh_jid', 'jobId', 'job_id']) {
      const v = u.searchParams.get(k);
      if (v && /^[\w-]{3,64}$/.test(v)) return v;
    }
    const m = /\/jobs?\/(?:view\/)?(?:[\w-]*?-)?(\d{5,})\b/i.exec(u.pathname);
    return m ? m[1] : null;
  } catch { return null; }
}

// Roda na página (executeJavaScript). Link de vaga = endereço com ID de vaga. Cartão = o maior
// ancestral do link que não contém OUTRO link de vaga (assim o marcador de salvo é deste cartão).
export const JOB_LISTINGS_SCRIPT = `(function(){
  // Caminho do link (não o parâmetro de rastreio: o menu do Indeed tem "from=gnav-viewjob").
  var JOB = /^(https?:\\/\\/[^\\/]+)?\\/(viewjob\\b|(rc|pagead)\\/clk\\b|jobs?\\/(view\\/)?[\\w-]*\\d{5,})|[?&](jk|vjk|currentJobId|gh_jid|jobId|job_id)=/i;
  var all = Array.prototype.slice.call(document.querySelectorAll('a[href]')).filter(function(a){ return JOB.test(a.getAttribute('href') || ''); });
  var isJob = function(a){ return all.indexOf(a) >= 0; };
  var out = [], seen = {};
  for (var i = 0; i < all.length && out.length < 40; i++) {
    var a = all[i];
    var r = a.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    var title = String(a.innerText || a.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().replace(/^full details of /i, '');
    if (title.length < 4 || title.length > 140 || /^(apply|save|share|see more|view all|more jobs)/i.test(title)) continue;
    var card = a;
    while (card.parentElement && card.parentElement !== document.body) {
      var others = Array.prototype.slice.call(card.parentElement.querySelectorAll('a[href]')).filter(function(x){ return x !== a && isJob(x) && String(x.innerText || '').trim() && String(x.innerText || '').trim() !== String(a.innerText || '').trim(); });
      if (others.length) break;
      card = card.parentElement;
    }
    var key = a.href.replace(/[?&](tk|bb|xkcb|mtk|from|advn|adid|ad|sjdu|acatk|pub|camk|jsa)=[^&]*/g, '');
    if (seen[title] || seen[key]) continue; seen[title] = 1; seen[key] = 1;
    var text = String(card.innerText || '').replace(/\\s+/g, ' ').trim();
    var saved = !!card.querySelector('[aria-pressed=true][aria-label*=save i],[aria-label^="Saved" i],[aria-label*="remove saved" i],[aria-label*="unsave" i]');
    out.push({ title: title, text: text.slice(0, 300), href: a.href, saved: saved });
  }
  return out;
})()`;

/** Linha "TÍTULO — o resto do cartão" curta: tira o título repetido do começo. */
function cardLine(j: JobListing): string {
  let rest = j.text.startsWith(j.title) ? j.text.slice(j.title.length) : j.text.replace(j.title, '');
  rest = rest.replace(/^[\s·|,-]+/, '').slice(0, 160);
  return `${j.title}${rest ? ' — ' + rest : ''}`;
}

export function formatJobListings(items: JobListing[], max = 8, opened: ReadonlySet<string> = new Set()): string {
  const jobs = (items || []).filter(j => j && j.title && j.href);
  if (jobs.length < 2) return '';
  // Aberta = ID da vaga visto no endereço, ou o título dela visto como título da página (vaga patrocinada não tem ID no link).
  const isOpen = (j: JobListing) => { const id = jobIdOf(j.href); return (!!id && opened.has(id)) || opened.has('t:' + j.title.toLowerCase()); };
  const shown = jobs.slice(0, max);
  const lines = shown.map((j, i) => `  ${i + 1}. ${isOpen(j) ? '✓ OPENED · ' : ''}${j.saved ? '★ SAVED · ' : ''}${cardLine(j)} → ${j.href}`);
  const savedN = jobs.filter(j => j.saved).length;
  const openN = shown.filter(isOpen).length;
  const next = shown.findIndex(j => !isOpen(j));
  const progress = openN
    ? `\nYou already opened ${openN} of these (✓ OPENED) — do not open them again.${next >= 0 ? ` NEXT unopened: #${next + 1}.` : ''}`
    : '';
  return `JOB LISTINGS ON THIS PAGE (${jobs.length} found${savedN ? `, ${savedN} ★ saved` : ''}). These ARE job postings. On a signed-in job board's home page they are the user's recommended / suggested jobs, whatever the heading says ("Matches your preferences", "Jobs for you"…). ★ SAVED = the user (or you) saved it with the card's bookmark badge: a valid pick — do not unsave it. To open one: navigate to its link, then extract_text and note its details before the next.${progress}\n${lines.join('\n')}${jobs.length > max ? `\n  … ${jobs.length - max} more` : ''}`;
}

/** Quantas vagas a pessoa pediu ("the first 2 jobs", "two postings", "3 vagas"); null = não disse. */
export function jobsAsked(command: string): number | null {
  const W: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, um: 1, uma: 1, dois: 2, duas: 2, 'três': 3, tres: 3 };
  const m = /\b(\d{1,2}|one|two|three|four|five|six|um|uma|dois|duas|tr[eê]s)\s+(?:\w+\s+){0,2}?(jobs?|postings?|openings?|positions?|roles?|vagas?|listings?)\b/i.exec(command || '');
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : W[m[1].toLowerCase()];
  return n && n > 0 && n <= 20 ? n : null;
}

/** A vaga (dos cartões vistos) que esta página é: ID no endereço ou título no título da página. */
export function openedJobOn(url: string, pageTitle: string, seen: JobListing[]): JobListing | null {
  const id = jobIdOf(url);
  const t = (pageTitle || '').toLowerCase().trim();
  for (const j of seen || []) {
    if (id && jobIdOf(j.href) === id) return j;
    const jt = (j.title || '').toLowerCase();
    if (jt.length >= 6 && t.startsWith(jt)) return j;
  }
  return null;
}

export interface OpenedJob { title: string; url: string; text: string }

/** Detalhes guardados das vagas abertas + quantas faltam: o modelo pequeno abria e saía sem ler. */
export function formatOpenedJobs(opened: OpenedJob[], asked: number | null, next?: JobListing | null): string {
  if (!opened.length) return '';
  const head = asked
    ? (opened.length >= asked
      ? `You opened ${opened.length} of the ${asked} job(s) asked — ALL DONE: report them now (title, company, location, pay, job type, key requirements, link) from the details below. Do not open more jobs.`
      : `You opened ${opened.length} of the ${asked} job(s) asked — open the NEXT unopened one${next ? `: "${next.title}" → navigate to ${next.href}` : ''}.`)
    : `Jobs you opened so far: ${opened.length}.`;
  return `DETAILS OF JOBS YOU OPENED (kept by Bah from each posting page — use them in your report): ${head}\n${opened.map((o, i) => `  ${i + 1}. ${o.title} — ${o.url}\n     ${o.text}`).join('\n')}`;
}
