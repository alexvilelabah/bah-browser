// Lado da página das listas suspensas com busca (regras/ordem em shared/dropdown-fill.ts).
// Tipos cobertos: <input role=combobox> (react-select do Greenhouse, autocomplete ARIA) e o
// "prompt" do Workday (<button aria-haspopup=listbox> que abre uma lista, às vezes com busca).
// Por que eventos de ponteiro completos: algumas versões do react-select só escolhem a opção com
// mousedown/mouseup/click na sequência — .click() puro é ignorado.
// Por que NÃO usar Escape pra fechar: dentro de modal (Easy Apply do LinkedIn) o Escape sobe e
// fecha o diálogo inteiro. Fecha com blur / clique fora; Escape só fora de diálogo.
import type { DropdownScripts } from '../shared/dropdown-fill.ts';

/** Ajudantes de página: define `DD` no escopo do script. Usado pelo scan, pela lista de conferência e pelo preenchimento. */
export const DD_JS = `var DD = (function(){
  var clean = function(s){ return String(s || '').replace(/\\s+/g, ' ').replace(/\\s*\\*\\s*$/, '').trim().slice(0, 160); };
  var vis = function(e){ if (!e || !e.getBoundingClientRect) return false; var cs = getComputedStyle(e); var r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  var EMPTY = /^(select|choose|pick one|search|type to search|start typing|--|—|selecione|seleccione|escolha|elija)\\b/i;
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  // É lista suspensa? input combobox com lista (não o de busca puro) ou botão/div que abre listbox.
  var is = function(el){
    var role = el.getAttribute('role');
    if (el.tagName === 'INPUT') return role === 'combobox' && el.type !== 'search';
    if (el.tagName === 'BUTTON') return el.getAttribute('aria-haspopup') === 'listbox';
    return role === 'combobox';
  };
  var ctrlClass = function(n){ return Array.prototype.some.call(n.classList || [], function(c){ return /__control$|^[a-z-]*css-[a-z0-9]+-control$/i.test(c); }); };
  // Contêiner visual do campo (onde o valor escolhido aparece).
  var control = function(el){
    for (var p = el.parentElement, k = 0; p && k < 6; p = p.parentElement, k++) if (ctrlClass(p)) return p;
    var c = null;
    for (var q = el.parentElement, j = 0; q && j < 3; q = q.parentElement, j++) {
      if (q.querySelector('label,legend') || q.querySelectorAll('input:not([aria-hidden=true]),select,textarea,button[aria-haspopup]').length > 1) break;
      c = q;
    }
    return c;
  };
  // Texto que o campo mostra agora ('' = vazio). react-select deixa o <input> vazio e põe o valor num div ao lado.
  var shown = function(el){
    if (el.tagName !== 'INPUT') {
      var t = clean(el.innerText || el.textContent || el.value || '');
      return EMPTY.test(t) ? '' : t;
    }
    var c = control(el);
    if (c) {
      var vals = c.querySelectorAll('[class*="single-value"],[class*="singleValue"],[class*="multi-value__label"],[class*="multiValue"]');
      if (vals.length) return clean(Array.prototype.map.call(vals, function(v){ return v.innerText; }).join(', '));
    }
    if (String(el.value || '').trim()) return clean(el.value);
    if (!c) return '';
    var txt = c.innerText || '';
    Array.prototype.forEach.call(c.querySelectorAll('[class*="placeholder"],[class*="Placeholder"]'), function(p){ txt = txt.split(p.innerText || '\\u0000').join(' '); });
    txt = clean(txt);
    return EMPTY.test(txt) ? '' : txt;
  };
  var optsIn = function(l){
    if (!l) return [];
    var o = l.querySelectorAll('[role=option]');
    if (!o.length) o = l.querySelectorAll('[class*="__option"]');
    return Array.prototype.filter.call(o, function(x){ return vis(x) && x.getAttribute('aria-disabled') !== 'true'; });
  };
  var menuClass = function(n){ return Array.prototype.some.call(n.classList || [], function(c){ return /__menu(-list)?$|^[a-z-]*css-[a-z0-9]+-menu$/i.test(c); }); };
  var lists = function(){
    return Array.prototype.filter.call(document.querySelectorAll('[role=listbox],[class*="menu"]'), function(l){
      return (l.getAttribute('role') === 'listbox' || menuClass(l)) && vis(l);
    });
  };
  // A lista aberta deste campo: aria-controls/owns, aria-activedescendant, senão a que apareceu
  // depois de abrir (portal no fim do <body>, fora do formulário e do diálogo).
  var listFor = function(el, before){
    var ids = ((el.getAttribute('aria-controls') || '') + ' ' + (el.getAttribute('aria-owns') || '')).trim().split(/\\s+/).filter(Boolean);
    for (var i = 0; i < ids.length; i++) { var n = document.getElementById(ids[i]); if (n && vis(n) && optsIn(n).length) return n; }
    var ad = el.getAttribute('aria-activedescendant');
    if (ad && document.getElementById(ad)) { var a = document.getElementById(ad); var al = a.closest('[role=listbox]') || a.parentElement; if (vis(al)) return al; }
    var now = lists().filter(function(l){ return !l.contains(el) && optsIn(l).length; });
    var fresh = now.filter(function(l){ return (before || []).indexOf(l) < 0; });
    var pick = fresh.length ? fresh : now.filter(function(l){ return el.getAttribute('aria-expanded') === 'true'; });
    return pick.length ? pick[pick.length - 1] : null;
  };
  var busy = function(l){ return !!(l && (l.getAttribute('aria-busy') === 'true' || l.querySelector('[class*="loading"],[aria-busy=true]'))); };
  // Espera as opções aparecerem e pararem de mudar (carregamento assíncrono), com teto.
  // Menu novo que já disse "No options": não adianta esperar o teto inteiro.
  var noneMsg = function(before){ return lists().some(function(l){ return before.indexOf(l) < 0 && !optsIn(l).length && !busy(l) && /no (options|results|matches)|nothing found|not found|nenhum|sin (opciones|resultados)/i.test(l.innerText || ''); }); };
  var waitList = function(el, before, ms){
    var t0 = Date.now(), last = -1, same = 0;
    return new Promise(function(res){
      (function tick(){
        var l = listFor(el, before), n = optsIn(l).length;
        if ((n && n === last && !busy(l)) || (!n && noneMsg(before))) same++; else same = 0;
        last = n;
        if (same >= 3 || Date.now() - t0 > ms) return res(n ? l : null);
        setTimeout(tick, 80);
      })();
    });
  };
  var key = function(el, k){
    var o = { key: k, code: k, bubbles: true, cancelable: true, composed: true, keyCode: k === 'Enter' ? 13 : k === 'ArrowDown' ? 40 : k === 'Escape' ? 27 : 0 };
    o.which = o.keyCode;
    el.dispatchEvent(new KeyboardEvent('keydown', o)); el.dispatchEvent(new KeyboardEvent('keyup', o));
  };
  // Clique "de verdade": pointer + mouse down/up + click, com coordenadas no meio do elemento.
  var click = function(n){
    try { n.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    var r = n.getBoundingClientRect();
    var o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1, detail: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    var P = window.PointerEvent || MouseEvent;
    n.dispatchEvent(new P('pointerover', o)); n.dispatchEvent(new MouseEvent('mouseover', o));
    n.dispatchEvent(new P('pointermove', o)); n.dispatchEvent(new MouseEvent('mousemove', o));
    n.dispatchEvent(new P('pointerdown', o)); n.dispatchEvent(new MouseEvent('mousedown', o));
    o.buttons = 0;
    n.dispatchEvent(new P('pointerup', o)); n.dispatchEvent(new MouseEvent('mouseup', o));
    n.dispatchEvent(new MouseEvent('click', o));
  };
  var type = function(inp, v){
    var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    inp.focus(); set.call(inp, v);
    inp.dispatchEvent(new InputEvent('input', { bubbles: true, data: v, inputType: v ? 'insertText' : 'deleteContentBackward' }));
  };
  // Caixa de busca do popup (Workday com busca): o foco foi pra ela, ou é um input novo perto da lista.
  var searchIn = function(el, l, beforeInputs){
    var a = document.activeElement;
    if (a && a !== el && a.tagName === 'INPUT' && !/^(hidden|checkbox|radio)$/.test(a.type)) return a;
    var cand = Array.prototype.filter.call(document.querySelectorAll('input'), function(i){ return vis(i) && i !== el && beforeInputs.indexOf(i) < 0 && !/^(hidden|checkbox|radio)$/.test(i.type); });
    return cand.filter(function(i){ for (var p = l, k = 0; p && k < 4; p = p.parentElement, k++) if (p.contains(i)) return true; return false; })[0] || null;
  };
  var opened = function(el){ var x = el.getAttribute('aria-expanded'); return x != null ? x === 'true' : !!listFor(el, []); };
  var open = async function(el, query, ms){
    var before = lists(), beforeInputs = Array.prototype.filter.call(document.querySelectorAll('input'), vis);
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    var l = null;
    if (el.tagName === 'INPUT') {
      el.focus();
      if (query) type(el, query); else key(el, 'ArrowDown');
      l = await waitList(el, before, query ? ms : 600);
      if (!l && !query) { click(el); var c = control(el); if (c && c !== el) click(c); l = await waitList(el, before, ms); }
      return l;
    }
    click(el);
    l = await waitList(el, before, 1200);
    if (!l) { key(el, 'ArrowDown'); l = await waitList(el, before, 800); }
    var s = l ? searchIn(el, l, beforeInputs) : null;
    if (s && query) { type(s, query); key(s, 'Enter'); await sleep(150); l = await waitList(el, before, ms) || l; }
    return l;
  };
  var close = async function(el){
    var s = document.activeElement;
    if (s && s.tagName === 'INPUT' && String(s.value || '') && (s === el || s.getAttribute('role') !== 'combobox' || s.type === 'search')) type(s, '');
    if (el.tagName === 'INPUT') el.blur(); else if (s && s.blur) s.blur();
    await sleep(80);
    if (!opened(el)) return;
    if (el.tagName !== 'INPUT') { click(el); await sleep(120); if (!opened(el)) return; }
    ['mousedown', 'mouseup', 'click'].forEach(function(t){ document.body.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); });
    await sleep(80);
    if (opened(el) && !el.closest('[role=dialog],dialog,[aria-modal=true]')) key(el, 'Escape');
  };
  var same = function(a, b){
    var n = function(s){ return String(s || '').toLowerCase().replace(/\\s+/g, ' ').trim(); };
    a = n(a); b = n(b);
    return !!a && !!b && (a === b || a.indexOf(b.slice(0, 40)) >= 0 || b.indexOf(a.slice(0, 40)) >= 0);
  };
  return { clean: clean, vis: vis, is: is, shown: shown, optsIn: optsIn, listFor: listFor, open: open, close: close, click: click, key: key, same: same, sleep: sleep };
})();`;

const el = (idx: number) => `var els = (window.__bahFF || [])[${idx}]; var el = els && els[0]; if (!el || !el.isConnected) return { ok: false, gone: true };`;

/** Abre a lista (digitando query) e devolve as opções que apareceram. */
export const ddOpenScript = (idx: number, query: string, ms = 2500): string => `(async function(){ ${DD_JS}
  ${el(idx)}
  var l = await DD.open(el, ${JSON.stringify(query)}, ${ms});
  if (!l) return { ok: false, options: [] };
  return { ok: true, options: DD.optsIn(l).slice(0, 300).map(function(o){ return DD.clean(o.innerText || o.textContent); }) };
})()`;

/** Escolhe a opção pelo texto e confere que o campo mostra o valor; Enter como 2ª tentativa. */
export const ddPickScript = (idx: number, text: string): string => `(async function(){ ${DD_JS}
  ${el(idx)}
  var want = ${JSON.stringify(text)};
  var find = function(){ var l = DD.listFor(el, []); var os = DD.optsIn(l); return os.filter(function(o){ return DD.clean(o.innerText || o.textContent) === want; })[0] || os.filter(function(o){ return DD.same(DD.clean(o.innerText), want); })[0] || null; };
  var o = find();
  if (!o) return { ok: false, reason: 'option_gone' };
  DD.click(o);
  for (var i = 0; i < 8 && !DD.same(DD.shown(el), want); i++) await DD.sleep(60);
  if (!DD.same(DD.shown(el), want) && el.tagName === 'INPUT') {
    // Enter escolhe a opção em foco: desce até ela (aria-activedescendant ou classe "focused").
    var o2 = find();
    if (o2) { for (var k = 0; k < 60; k++) { var ad = el.getAttribute('aria-activedescendant'); var cur = ad ? document.getElementById(ad) : null; if (cur === o2 || /focused/.test(o2.className || '')) break; DD.key(el, 'ArrowDown'); await DD.sleep(10); } DD.key(el, 'Enter'); await DD.sleep(150); }
  }
  var ok = DD.same(DD.shown(el), want);
  if (ok && el.tagName === 'INPUT') el.blur();
  return { ok: ok, shown: DD.shown(el) };
})()`;

/** Fecha sem mudar o valor. */
export const ddCloseScript = (idx: number): string => `(async function(){ ${DD_JS}
  ${el(idx)}
  await DD.close(el); return { ok: true };
})()`;

/** Só lê as opções (abre sem filtro e fecha) — pro cartão de perguntas mostrar as escolhas. */
export const ddReadScript = (idx: number): string => `(async function(){ ${DD_JS}
  ${el(idx)}
  if (DD.shown(el)) return { ok: false };
  var l = await DD.open(el, '', 1500);
  var out = l ? DD.optsIn(l).slice(0, 300).map(function(o){ return DD.clean(o.innerText || o.textContent); }) : [];
  await DD.close(el);
  return { ok: !!out.length, options: out };
})()`;

export const DROPDOWN_SCRIPTS: DropdownScripts = { open: ddOpenScript, pick: ddPickScript, close: ddCloseScript };
