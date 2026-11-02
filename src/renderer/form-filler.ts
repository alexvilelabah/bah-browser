// O lado da página do preenchimento por código (regras em shared/form-fill.ts).
// SCAN: numera os campos (data-bah-ff) — rádios/caixas do mesmo grupo viram UMA pergunta com
// opções — e devolve FieldInfo[]. APPLY: grava os valores do jeito que React/Vue enxergam
// (setter nativo + input/change), escolhe opção de select e clica o rádio/caixa certo.
// Lista suspensa com busca (react-select, combobox ARIA, prompt do Workday) entra como type
// 'combobox' e é preenchida por applyFill → fillDropdown (abre, digita, escolhe a opção, confere).
import type { FieldInfo, FillDecision } from '../shared/form-fill.ts';
import { fillDropdown, type DropdownScripts, type PageExec } from '../shared/dropdown-fill.ts';
import { FORM_ROOT_JS } from './form-progress.ts';
import { DD_JS, DROPDOWN_SCRIPTS, ddReadScript } from './dropdown-page.ts';

export const FORM_SCAN_SCRIPT = `(function(){
  ${DD_JS}
  var clean = function(s){ return String(s || '').replace(/\\s+/g, ' ').replace(/\\s*\\*\\s*$/, '').trim().slice(0, 160); };
  var vis = function(e){ var cs = getComputedStyle(e); var r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && (r.width > 0 && r.height > 0); };
  var labelOf = function(el){
    if (el.labels && el.labels[0]) return clean(el.labels[0].innerText);
    var lb = el.getAttribute('aria-labelledby'); if (lb) { var t = lb.split(/\\s+/).map(function(id){ var n = document.getElementById(id); return n ? n.innerText : ''; }).join(' '); if (clean(t)) return clean(t); }
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    if (el.placeholder) return clean(el.placeholder);
    return '';
  };
  // Pergunta de um grupo de rádio/caixa: legend, rótulo do grupo ou o 1º texto do contêiner que não é opção.
  var questionOf = function(el){
    var fs = el.closest('fieldset'); if (fs && fs.querySelector('legend')) return clean(fs.querySelector('legend').innerText);
    var g = el.closest('[role=radiogroup],[role=group]');
    if (g) { var gl = g.getAttribute('aria-label') || (g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')) ? document.getElementById(g.getAttribute('aria-labelledby')).innerText : ''); if (clean(gl)) return clean(gl); }
    for (var p = el.parentElement, k = 0; p && k < 6; p = p.parentElement, k++) {
      if (p.querySelectorAll('input[type=radio],input[type=checkbox]').length < 1) continue;
      var lab = Array.prototype.find.call(p.querySelectorAll('label,legend,p,h3,h4,div,span'), function(n){ return !n.querySelector('input') && !n.closest('label') && n.children.length === 0 && clean(n.innerText).length > 3; });
      if (lab && !(el.labels && el.labels[0] && el.labels[0].contains(lab))) return clean(lab.innerText);
    }
    return clean(el.name);
  };
  var root = (${FORM_ROOT_JS})();
  var fields = [], groups = {}, store = [];
  // Rótulo de lista suspensa: o aria-label do Workday traz "Select One Required" junto — tira; sem rótulo, o texto do contêiner.
  var ddLabel = function(el){
    var l = labelOf(el), sh = DD.shown(el) || clean(el.innerText);
    if (l && !(el.labels && el.labels.length) && !el.getAttribute('aria-labelledby')) l = clean(l.split(sh).join(' ').replace(/\\b(select one|required)\\b/gi, ''));
    if (l && l !== sh) return l;
    for (var p = el.parentElement, k = 0; p && k < 4; p = p.parentElement, k++) {
      var n = p.querySelector('label,legend,[data-automation-id*=formLabel]');
      if (n && !n.contains(el) && clean(n.innerText)) return clean(n.innerText);
    }
    return l;
  };
  Array.prototype.forEach.call(root.querySelectorAll('input,textarea,select,button[aria-haspopup=listbox],[role=combobox]:not(input)'), function(el){
    var t = (el.type || el.tagName).toLowerCase();
    if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA') {
      // botão/div que abre listbox (Workday). Div combobox que embrulha um input: o input é que conta.
      if (el.disabled || !vis(el) || (el.tagName !== 'BUTTON' && el.querySelector('input,select,textarea,button'))) return;
      var dl = ddLabel(el), dlab = el.labels && el.labels[0] ? el.labels[0].innerText : '';
      fields.push({ idx: store.length, label: dl, type: 'combobox', name: el.name || el.id || '', autocomplete: '', required: el.getAttribute('aria-required') === 'true' || /\\*\\s*$/.test(String(dlab).trim()) || /\\brequired\\b/i.test(el.getAttribute('aria-label') || ''), filled: !!DD.shown(el) });
      store.push([el]); return;
    }
    // input escondido de apoio (react-select guarda o "required" num input aria-hidden fora do tab): não é campo.
    if (el.getAttribute('aria-hidden') === 'true' && el.tabIndex < 0 && t !== 'radio' && t !== 'checkbox') return;
    if (/^(hidden|submit|button|reset|image|search)$/.test(t) || el.name === 'g-recaptcha-response' || el.disabled) return;
    if (t !== 'file' && !vis(el) && !(t === 'radio' || t === 'checkbox')) return;
    var req = el.required || el.getAttribute('aria-required') === 'true';
    if (t === 'radio' || (t === 'checkbox' && el.name && root.querySelectorAll('input[type=checkbox][name="' + CSS.escape(el.name) + '"]').length > 1)) {
      var key = t + ':' + (el.name || questionOf(el));
      var g = groups[key];
      if (!g) { g = groups[key] = { idx: store.length, label: questionOf(el), type: t, required: req, options: [], filled: false }; store.push([]); fields.push(g); }
      g.required = g.required || req; g.filled = g.filled || el.checked;
      g.options.push(labelOf(el) || clean(el.value)); store[g.idx].push(el);
      return;
    }
    var f = { idx: store.length, label: labelOf(el) || questionOf(el), type: el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.getAttribute('role') === 'combobox' ? 'combobox' : t),
      name: el.name || el.id || '', autocomplete: el.getAttribute('autocomplete') || '', required: req, filled: false };
    if (f.type === 'combobox') { if (!DD.is(el)) f.type = 'text'; else { f.label = ddLabel(el) || f.label; f.filled = !!DD.shown(el); } }
    if (el.tagName === 'SELECT') { f.options = Array.prototype.map.call(el.options, function(o){ return clean(o.text); }); f.filled = el.selectedIndex > 0; }
    else if (t === 'checkbox') { f.options = ['checked']; f.filled = el.checked; }
    else if (t === 'file') f.filled = !!(el.files && el.files.length);
    else if (f.type !== 'combobox') f.filled = !!String(el.value || '').trim();
    store.push([el]); fields.push(f);
  });
  window.__bahFF = store;
  return fields.slice(0, 80);
})()`;

export function formApplyScript(decisions: FillDecision[]): string {
  return `(function(ds){
    var store = window.__bahFF || [], done = [];
    var setVal = function(el, v){
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var set = Object.getOwnPropertyDescriptor(proto, 'value').set;
      el.focus(); set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.blur();
    };
    ds.forEach(function(d){
      var els = store[d.idx]; if (!els || !els.length) return;
      try {
        var el = els[0];
        if (el.tagName === 'SELECT') { el.selectedIndex = d.option; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); done.push(d.idx); return; }
        if (d.option != null) { var o = els[d.option] || (els.length === 1 ? els[0] : null); if (o && !o.checked) o.click(); if (o) done.push(d.idx); return; }
        setVal(el, d.value); done.push(d.idx);
      } catch (e) {}
    });
    return done;
  })(${JSON.stringify(decisions)})`;
}

/**
 * Aplica as decisões: campos comuns de uma vez (formApplyScript); listas suspensas uma a uma
 * (abrir → digitar → escolher → conferir). failed = listas que não aceitaram o valor (nenhuma
 * opção casou) — vão pro cartão de perguntas com as opções vistas. texts = o que ficou escolhido.
 */
export async function applyFill(exec: PageExec, decisions: FillDecision[], fields: FieldInfo[], scripts: DropdownScripts = DROPDOWN_SCRIPTS): Promise<{ done: number[]; failed: FieldInfo[]; texts: Record<number, string> }> {
  const byIdx = new Map(fields.map(f => [f.idx, f]));
  const isDd = (d: FillDecision) => byIdx.get(d.idx)?.type === 'combobox';
  const plain = decisions.filter(d => !isDd(d));
  const done: number[] = plain.length ? ((await exec(formApplyScript(plain)).catch(() => [])) || []) : [];
  const failed: FieldInfo[] = [], texts: Record<number, string> = {};
  for (const d of decisions.filter(isDd).slice(0, 25)) {
    const f = byIdx.get(d.idx)!;
    const value = d.value ?? (f.options || [])[d.option ?? -1];
    if (!value) continue;
    const r = await fillDropdown(exec, scripts, d.idx, value);
    if (r.ok) { done.push(d.idx); texts[d.idx] = r.text || value; }
    else failed.push({ ...f, options: f.options?.length ? f.options : r.options });
  }
  return { done, failed, texts };
}

/** Opções das listas suspensas sem opção conhecida (abre, lê, fecha) — pro cartão mostrar escolhas, não texto livre. */
export async function readDropdownOptions(exec: PageExec, fields: FieldInfo[]): Promise<FieldInfo[]> {
  const out: FieldInfo[] = [];
  let reads = 0;
  for (const f of fields) {
    if (f.type !== 'combobox' || f.options?.length || ++reads > 15) { out.push(f); continue; }
    const r = await exec(ddReadScript(f.idx)).catch(() => null);
    out.push(r && r.ok && r.options?.length ? { ...f, options: r.options } : f);
  }
  return out;
}

export type { FieldInfo, FillDecision };
