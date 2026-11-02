// O lado da página do preenchimento por código (regras em shared/form-fill.ts).
// SCAN: numera os campos (data-bah-ff) — rádios/caixas do mesmo grupo viram UMA pergunta com
// opções — e devolve FieldInfo[]. APPLY: grava os valores do jeito que React/Vue enxergam
// (setter nativo + input/change), escolhe opção de select e clica o rádio/caixa certo.
// Combobox com busca (react-select etc.) fica de fora: o agente ou a pessoa escolhe.
import type { FieldInfo, FillDecision } from '../shared/form-fill';
import { FORM_ROOT_JS } from './form-progress';

export const FORM_SCAN_SCRIPT = `(function(){
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
  // Identificador estável do ATS (ver shared/ats-tables.ts): Workday põe no input ou no contêiner formField-*, Ashby no contêiner (data-field-path), Rippling no input (data-input).
  var aidOf = function(el){ var w = el.closest('[data-automation-id^="formField-"],[data-field-path]'); return el.getAttribute('data-automation-id') || (w ? (w.getAttribute('data-automation-id') || w.getAttribute('data-field-path')) : '') || el.getAttribute('data-input') || ''; };
  var root = (${FORM_ROOT_JS})();
  var fields = [], groups = {}, store = [];
  Array.prototype.forEach.call(root.querySelectorAll('input,textarea,select'), function(el){
    var t = (el.type || el.tagName).toLowerCase();
    if (/^(hidden|submit|button|reset|image|search)$/.test(t) || el.name === 'g-recaptcha-response' || el.disabled) return;
    if (t !== 'file' && !vis(el) && !(t === 'radio' || t === 'checkbox')) return;
    var req = el.required || el.getAttribute('aria-required') === 'true';
    if (t === 'radio' || (t === 'checkbox' && el.name && root.querySelectorAll('input[type=checkbox][name="' + CSS.escape(el.name) + '"]').length > 1)) {
      var key = t + ':' + (el.name || questionOf(el));
      var g = groups[key];
      if (!g) { g = groups[key] = { idx: store.length, label: questionOf(el), type: t, name: el.name || '', automationId: aidOf(el), required: req, options: [], filled: false }; store.push([]); fields.push(g); }
      g.required = g.required || req; g.filled = g.filled || el.checked;
      g.options.push(labelOf(el) || clean(el.value)); store[g.idx].push(el);
      return;
    }
    var f = { idx: store.length, label: labelOf(el) || questionOf(el), type: el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.getAttribute('role') === 'combobox' ? 'combobox' : t),
      name: el.name || el.id || '', automationId: aidOf(el), autocomplete: el.getAttribute('autocomplete') || '', required: req, filled: false };
    if (el.tagName === 'SELECT') { f.options = Array.prototype.map.call(el.options, function(o){ return clean(o.text); }); f.filled = el.selectedIndex > 0; }
    else if (t === 'checkbox') { f.options = ['checked']; f.filled = el.checked; }
    else if (t === 'file') f.filled = !!(el.files && el.files.length);
    else f.filled = !!String(el.value || '').trim();
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

export type { FieldInfo, FillDecision };
