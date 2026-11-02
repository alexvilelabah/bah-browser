// Lista de conferência do formulário (tarefa de candidatura): o modelo pequeno se perdia num
// formulário longo — inventava campo, esquecia o currículo, parava antes das perguntas. Aqui o Bah
// lê os campos da página e diz o que já está preenchido e o que falta, com o rótulo de cada um.

export interface FormField {
  label: string;
  kind: 'text' | 'file' | 'choice' | 'check' | 'select';
  required: boolean;
  done: boolean;
  /** Opções (grupo de rádio/select) — curtas. */
  options?: string[];
  /** Grupo de autoidentificação voluntária (gênero, raça, veterano, deficiência). */
  voluntary?: boolean;
}

// Onde está o formulário: um diálogo aberto com campos (Easy Apply do LinkedIn, modais de ATS)
// vence; senão o <form> com mais campos (a página pode ter um form de busca antes); senão o body.
export const FORM_ROOT_JS = `function(){
    var fieldsIn = function(n, skipChecks){ return Array.prototype.filter.call(n.querySelectorAll('input,textarea,select'), function(e){ var t = (e.type || '').toLowerCase(); return !/^(hidden|submit|button|reset|image|search)$/.test(t) && !(skipChecks && t === 'checkbox'); }).length; };
    var shown = function(e){ var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    var dlg = Array.prototype.filter.call(document.querySelectorAll('[role=dialog],dialog[open],[aria-modal=true]'), function(d){ return shown(d) && fieldsIn(d, true) > 0; }).pop();
    if (dlg) return dlg;
    var best = null, n = 0;
    Array.prototype.forEach.call(document.querySelectorAll('form'), function(f){ var c = fieldsIn(f, false); if (c > n) { n = c; best = f; } });
    return best || document.body;
  }`;

// Roda na página (executeJavaScript). Rádios/caixas agrupados por name; rótulo = <label>, aria,
// legenda do grupo ou o texto logo antes.
export const FORM_FIELDS_SCRIPT = `(function(){
  var vis = function(e){ var r = e.getBoundingClientRect(); var cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && (r.width > 0 || e.type === 'file'); };
  var clean = function(s){ return String(s || '').replace(/\\s+/g, ' ').replace(/\\*+/g, '').trim().slice(0, 90); };
  var labelOf = function(el){
    if (el.labels && el.labels[0]) return clean(el.labels[0].innerText);
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    var lb = el.getAttribute('aria-labelledby'); if (lb && document.getElementById(lb)) return clean(document.getElementById(lb).innerText);
    if (el.placeholder) return clean(el.placeholder);
    return clean(el.name || el.id);
  };
  var groupLabel = function(el){
    var fs = el.closest('fieldset'); if (fs && fs.querySelector('legend')) return clean(fs.querySelector('legend').innerText);
    var g = el.closest('[role=radiogroup],[role=group]'); if (g && (g.getAttribute('aria-label'))) return clean(g.getAttribute('aria-label'));
    for (var p = el.parentElement, k = 0; p && k < 6; p = p.parentElement, k++) {
      var h = p.querySelector('label:not(:has(input)),legend,h3,h4,p,span');
      var t = p.firstElementChild && p.firstElementChild !== el && !p.firstElementChild.contains(el) ? clean(p.firstElementChild.innerText) : '';
      if (t && t.length > 3) return t;
    }
    return clean(el.name);
  };
  var form = (${FORM_ROOT_JS})();
  var out = [], groups = {};
  Array.prototype.forEach.call(form.querySelectorAll('input,textarea,select'), function(el){
    var t = (el.type || '').toLowerCase();
    if (t === 'hidden' || t === 'submit' || t === 'button' || t === 'search' || el.name === 'g-recaptcha-response') return;
    if (t !== 'file' && !vis(el)) return;
    var req = el.required || el.getAttribute('aria-required') === 'true';
    if (t === 'radio' || t === 'checkbox') {
      var key = t + ':' + (el.name || groupLabel(el));
      var g = groups[key];
      if (!g) { g = groups[key] = { label: groupLabel(el), kind: t === 'radio' ? 'choice' : 'check', required: req, done: false, options: [] }; out.push(g); }
      g.required = g.required || req; g.done = g.done || el.checked;
      if (g.options.length < 8) g.options.push(labelOf(el));
      return;
    }
    if (t === 'file') { out.push({ label: labelOf(el) || 'File', kind: 'file', required: req, done: !!(el.files && el.files.length) }); return; }
    if (el.tagName === 'SELECT') { out.push({ label: labelOf(el), kind: 'select', required: req, done: el.selectedIndex > 0 || !!(el.value && !/^(select|choose|--)/i.test(el.options[el.selectedIndex] && el.options[el.selectedIndex].text)), options: Array.prototype.slice.call(el.options, 0, 8).map(function(o){ return clean(o.text); }) }); return; }
    out.push({ label: labelOf(el), kind: 'text', required: req, done: !!String(el.value || '').trim() });
  });
  return out.slice(0, 40);
})()`;

const VOLUNTARY = /\b(gender|sex|race|ethnic|hispanic|veteran|disabilit|self[- ]identif|pronoun|sexual orientation|transgender)\b/i;

/** resumeRead: o agente já leu um currículo nesta tarefa (sem isso, "pergunte à pessoa" virava desistir). */
export function formatFormProgress(fields: FormField[], resumeRead = true, facts: { name?: string; email?: string; phone?: string } = {}): string {
  const list = (fields || []).filter(f => f && f.label);
  if (list.length < 2) return '';
  const vol = (f: FormField) => VOLUNTARY.test(`${f.label} ${(f.options || []).join(' ')}`);
  const todo = list.filter(f => !f.done && (f.required || f.kind === 'file' || vol(f) || f.kind === 'choice'));
  const line = (f: FormField) => {
    const mark = f.done ? '✓' : '✗';
    const req = f.required ? ' (required)' : '';
    let how = '';
    if (!f.done) {
      if (f.kind === 'file') how = ' → upload the résumé: { "action": "upload", "ref": <the upload button or field next to it> }';
      else if (vol(f)) how = ` → voluntary: pick "${(f.options || []).find(o => /decline|prefer not|don.t wish|not to (say|answer|disclose)|i do not want/i.test(o)) || 'Decline to self-identify'}" unless the user said otherwise`;
      else if (f.kind === 'choice' || f.kind === 'select') how = ` → choose one${f.options?.length ? `: ${f.options.map(o => `"${o}"`).join(' / ')}` : ''} (only from facts you have; else ask the user)`;
      else if (f.kind === 'check') how = ' → check it only if it is true for the user';
      else how = resumeRead ? ' → fill from the résumé/request; not in them → ask the user' : ' → from the résumé (read it first)';
    }
    return `  ${mark} ${f.label}${req}${how}`;
  };
  const head = todo.length
    ? `APPLICATION FORM on this page — ${list.length - todo.length} of ${list.length} done. Work down the ✗ items (use the [N] refs in INTERACTIVE ELEMENTS whose label matches). Do not invent fields that are not listed. Submit only when no required ✗ is left.`
    : `APPLICATION FORM on this page — everything listed is done. Check it, then click the submit button (Bah asks the user before sending).`;
  const first = !resumeRead && todo.length
    ? `\nFIRST: you have not read a résumé yet. Do list_files, then read_file the résumé that fits this job — the name, email, phone, history and answers come from it. Ask the user only for what the résumé and the request do not say.`
    : '';
  const known = [facts.name && `name "${facts.name}"`, facts.email && `email "${facts.email}"`, facts.phone && `phone "${facts.phone}"`].filter(Boolean);
  const factsLine = known.length ? `\nFROM THE RÉSUMÉ YOU READ: ${known.join(', ')} — use these exactly; they ARE in the résumé.` : '';
  return `${head}${first}${factsLine}\n${list.map(line).join('\n')}`;
}

/** Contato no topo do currículo: nome (1ª linha curta), e-mail, telefone. */
export function resumeFacts(text: string): { name?: string; email?: string; phone?: string } {
  const t = String(text || '');
  const email = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(t)?.[0];
  const phone = /(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.exec(t)?.[0];
  const first = t.split(/\r?\n/).map(l => l.trim()).find(Boolean) || '';
  const name = /^[A-ZÀ-Ý][\p{L}'’.-]+(\s+[A-ZÀ-Ý][\p{L}'’.-]+){1,3}$/u.test(first) && first.length <= 40
    ? first.toLowerCase().replace(/(^|[\s'’.-])\p{L}/gu, m => m.toUpperCase()) : undefined;
  return { ...(name ? { name } : {}), ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
}
