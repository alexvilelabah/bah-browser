// Carrinho de mercado ("add milk, eggs, bananas and a dozen bagels to my Walmart cart").
// O modelo pequeno se perdia nas grades de produto: dezenas de botões "Add" iguais, sem saber qual é
// de qual produto, e não via o que já estava no carrinho. Aqui o Bah lê os cartões de produto
// (nome, preço, preço por unidade, esgotado, quantos no carrinho, e a ref dos botões Add / + / −) e,
// na página do carrinho, as linhas e o subtotal. A tarefa termina NO carrinho: o freio (risk.ts)
// pergunta antes de checkout/pagamento/reserva de horário.

export interface Pt { x: number; y: number }
export interface ProductTile {
  name: string;
  price: string;
  unit: string;
  oos: boolean;
  sponsored: boolean;
  inCart: number;
  href: string;
  add?: Pt; inc?: Pt; dec?: Pt;
  /** Nome tirado do h1 da página, fora do cartão: palpite, não barra um ADD. */
  guessed?: boolean;
}
export interface CartLine { name: string; qty: number; price: string; inc?: Pt; dec?: Pt; select?: Pt }
export interface CartPage { isCart: boolean; lines: CartLine[]; subtotal: string; count: number; checkout?: Pt & { label: string } }
export interface ListItem { text: string; count?: number; raw: string }

// ── tarefa ──────────────────────────────────────────────────────────────────
const CART_WORD = /\b(cart|basket|trolley|carrinho|carrito|cesta)\b/i;
const ADD_VERB = /\b(add|put|fill|get|buy|order|throw|adiciona\w*|coloca\w*|p[oõ]e|bota|agrega\w*|añad\w*|pon)\b/i;
const NEGATED_ADD = /\b(don'?t|do not|never|without|n[aã]o|sin|no)\s+(add|put|buy|adicion\w*|coloc\w*|agreg\w*|compr\w*)/i;
const GROCERY_WORD = /\b(grocer(y|ies)|shopping list|lista de (compras|mercado)|supermarket|supermercado|instacart)\b/i;

/** O pedido é encher um carrinho (de mercado)? Liga a skill grocery-cart, os blocos daqui e o freio de carrinho. */
export function commandIsGrocery(command: string): boolean {
  const c = command || '';
  if (NEGATED_ADD.test(c)) return false;
  return GROCERY_WORD.test(c) || (CART_WORD.test(c) && ADD_VERB.test(c));
}

// ── a lista do pedido ───────────────────────────────────────────────────────
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, 'três': 3, uno: 1, dos: 2 };

/** "add milk, eggs, bananas and a dozen bagels to my Walmart cart" → milk, eggs, bananas, bagels (12). */
export function parseGroceryList(command: string): ListItem[] {
  let s = ` ${command || ''} `.replace(/\s+/g, ' ');
  // tira o verbo do começo e o destino do fim ("to my Walmart cart", "on target.com", "at Whole Foods")
  s = s.replace(/^\s*(please\s+|can you\s+|could you\s+)?(add|put|get|buy|order|throw|adicion\w*|coloc\w*|agreg\w*|añad\w*)\s+/i, ' ');
  s = s.replace(/\s+(to|into|in|on|at|from|na|no|em|al|en)\s+(my|the|our|a|meu|minha|o|a|mi)?\s*[\w'’&. -]*?\b(cart|basket|trolley|carrinho|carrito|cesta)\b.*$/i, ' ');
  s = s.replace(/\s+(on|at|from|na|no|em|en)\s+(walmart|whole ?foods|target|kroger|amazon|costco|safeway|aldi|publix|instacart)\b.*$/i, ' ');
  const parts = s.split(/,|;|\n|\s+and\s+|\s+e\s+|\s+y\s+|\s*&\s*/i).map(x => x.trim()).filter(Boolean);
  const out: ListItem[] = [];
  for (const raw of parts.slice(0, 30)) {
    let t = raw.replace(/^(some|a few|the|this|that|these|those|my|our|uns|umas|algun[oa]s)\s+/i, '');
    let count: number | undefined;
    const doz = /^(a|one|\d+|two|three|half a)?\s*dozen\s+(of\s+)?/i.exec(t);
    if (doz) {
      const n = !doz[1] || /^(a|one)$/i.test(doz[1]) ? 1 : /half/i.test(doz[1]) ? 0.5 : NUM[doz[1].toLowerCase()] ?? Number(doz[1]);
      count = Math.round(12 * n); t = t.slice(doz[0].length);
    } else {
      const m = /^(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|um|uma|dois|duas|tr[eê]s|uno|dos)\s+(x\s+)?/i.exec(t);
      if (m && !/^(a|an)$/i.test(m[1])) { count = NUM[m[1].toLowerCase()] ?? Number(m[1]); t = t.slice(m[0].length); }
      else if (m) t = t.slice(m[0].length);
    }
    t = t.replace(/^(of|de)\s+/i, '').replace(/[.!?]+$/, '').trim();
    if (t && t.length <= 60) out.push({ text: t, ...(count && isFinite(count) ? { count } : {}), raw });
  }
  return out;
}

// ── leitores (rodam na página via executeJavaScript) ────────────────────────
// Botões pelo rótulo: texto visível, aria-label ou value (input de submit da Amazon).
// Cartão = maior ancestral do botão que não contém o botão de OUTRO produto (e com texto curto).
export const GROCERY_TILES_SCRIPT = `(function(){
  var lab = function(e){ return String(e.getAttribute('aria-label') || e.innerText || e.value || e.getAttribute('title') || '').replace(/\\s+/g, ' ').trim(); };
  var vis = function(e){ var r = e.getBoundingClientRect(); var cs = getComputedStyle(e); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  var ADD = /^(\\+\\s*)?(add|add to (cart|basket|trolley|bag)|adicionar|agregar)\\b/i, NOT_ADD = /\\b(list|registry|wish ?list|lista|address|card|payment|note|review|photo)\\b/i;
  var INC = /^(increase|increment|aumentar|incrementar|add one)\\b|^\\+$/i, DEC = /^(decrease|decrement|diminuir|reduzir|disminuir)\\b|^[−-]$/i, DEL = /^(remove|delete|excluir|remover|eliminar)\\b/i;
  var OOS = /\\b(out of stock|currently unavailable|sold out|unavailable|esgotado|agotado|indispon[ií]vel)\\b/i;
  var btns = Array.prototype.slice.call(document.querySelectorAll('button,[role=button],input[type=submit],input[type=button]')).filter(vis);
  var kind = function(b){ var l = lab(b); if (ADD.test(l) && !NOT_ADD.test(l) && l.length < 160) return 'add'; if (INC.test(l)) return 'inc'; if (DEC.test(l)) return 'dec'; if (DEL.test(l) && l.length < 160) return 'del'; return ''; };
  var anchors = [];
  btns.forEach(function(b){ var k = kind(b); if (k === 'add' || k === 'inc') anchors.push(b); });
  // Esgotado sem botão: o aviso de estoque também ancora um cartão.
  Array.prototype.slice.call(document.querySelectorAll('div,span,p')).forEach(function(e){
    // textContent primeiro (barato); innerText força layout e a página da loja tem milhares de nós
    if (e.children.length > 2) return; var t = (e.textContent || '').trim(); if (t.length > 0 && t.length < 120 && OOS.test(t) && vis(e)) anchors.push(e);
  });
  var tileOf = function(a){
    var card = a;
    while (card.parentElement && card.parentElement !== document.body) {
      var p = card.parentElement;
      if ((p.innerText || '').length > 1500) break;
      // qualquer outra âncora (inclusive o aviso de esgotado de outro cartão) marca a borda do cartão
      var other = anchors.some(function(x){ return x !== a && p.contains(x) && !card.contains(x) && !x.contains(a); });
      if (other) break;
      card = p;
    }
    return card;
  };
  var at = function(e){ var r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };
  var tiles = [], seen = [];
  anchors.forEach(function(a){
    var t = tileOf(a); if (seen.indexOf(t) >= 0) return;
    if (seen.some(function(s){ return s.contains(t) || t.contains(s); })) return;
    seen.push(t);
    var text = (t.innerText || '').replace(/\\s+/g, ' ').trim();
    // Nome: título do cartão (h2/h3, product-title) antes de link; link solto ("Learn more") não serve.
    var pick = function(sel){ return Array.prototype.slice.call(t.querySelectorAll(sel))
      .map(function(e){ return String(e.getAttribute('aria-label') || e.innerText || '').replace(/\\s+/g, ' ').trim(); })
      .filter(function(s){ return s.length >= 4 && s.length <= 200 && !/^\\$|^(sponsored|options|see options|add|more|\\d+(\\.\\d)? out of)|learn more|discover more|see more|sustainability/i.test(s); })
      .sort(function(x, y){ return y.length - x.length; })[0] || ''; };
    var h1 = document.querySelector('h1');
    var name = (h1 && t.contains(h1)) ? (h1.innerText || '').replace(/\\s+/g, ' ').trim() : (pick('h2,h3,h4,[data-automation-id=product-title],[data-test=product-title]') || pick('a[href]'));
    var bs = Array.prototype.slice.call(t.querySelectorAll('button,[role=button],input[type=submit],input[type=button]')).filter(vis);
    var add = null, inc = null, dec = null;
    bs.forEach(function(b){ var k = kind(b); if (k === 'add' && !add) add = b; else if (k === 'inc' && !inc) inc = b; else if ((k === 'dec' || k === 'del') && !dec) dec = b; });
    if (!name && add) name = lab(add).replace(/^(add( to (cart|basket|trolley|bag))?)\\s*[-–:]?\\s*/i, '').replace(/\\s+to (cart|basket)$/i, '');
    // Cartão sem título (só "Toaster [Add to cart]"): o texto do próprio cartão sem os botões e preços.
    if (!name) { var own = text; bs.forEach(function(b){ var l = lab(b); if (l) own = own.split(l).join(' '); }); own = own.replace(/\\$\\s?\\d[\\d.,]*/g, ' ').replace(/\\s+/g, ' ').trim(); if (own.length >= 3 && own.length <= 80) name = own; }
    // O h1 da página fora do cartão é palpite (página de produto: o h1 é o produto; numa lista é "Shop").
    var guessed = false;
    if ((!name || name.length < 6) && h1) { guessed = !t.contains(h1); name = (h1.innerText || '').trim(); }
    var price = (/\\$\\s?\\d{1,4}(?:[.,]\\d{2})?/.exec(text) || [''])[0].replace(/\\s/g, '');
    var unit = (/\\(?((?:\\$\\s?\\d+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?\\s?¢)\\s?\\/\\s?(?:fl\\.? ?oz|fluid ounce|ounce|oz|lb|pound|count|ct|each|ea|item|kg|g|l|ml))\\)?/i.exec(text) || ['', ''])[1];
    var q = /(\\d+)\\s+in cart\\b/i.exec(text) || /current quantity\\s*(\\d+)/i.exec(bs.map(lab).join(' ')) || /quantity is\\s*(\\d+)/i.exec(Array.prototype.map.call(t.querySelectorAll('[aria-label]'), function(e){ return e.getAttribute('aria-label'); }).join(' '));
    var inCart = q ? +q[1] : (inc && !add ? 1 : 0);
    var a0 = t.querySelector('a[href]');
    if (!name) return;
    tiles.push({ el: t, name: name.slice(0, 160), guessed: guessed, price: price, unit: unit, oos: !add && !inc && OOS.test(text), sponsored: text.length < 700 && /\\bsponsored\\b/i.test(text), inCart: inCart,
      href: a0 ? a0.href : '', add: add ? at(add) : undefined, inc: inc ? at(inc) : undefined, dec: dec ? at(dec) : undefined });
  });
  // ordem da página (os esgotados entraram por último na lista de âncoras)
  return tiles.sort(function(a, b){ return (a.el.compareDocumentPosition(b.el) & 4) ? -1 : 1; }).slice(0, 40).map(function(x){ delete x.el; return x; });
})()`;

// Página do carrinho: endereço ou título de carrinho; linhas = blocos com controle de quantidade.
export const CART_PAGE_SCRIPT = `(function(){
  var isCart = /\\/(cart|basket|trolley|carrinho|carrito)\\b|\\/gp\\/cart|cart\\/view/i.test(location.pathname) || /^(shopping )?(cart|basket)\\b|\\bcart\\s*[:|-]|carrinho/i.test(document.title);
  if (!isCart) return { isCart: false, lines: [], subtotal: '', count: 0 };
  var lab = function(e){ return String(e.getAttribute('aria-label') || e.innerText || e.value || '').replace(/\\s+/g, ' ').trim(); };
  var vis = function(e){ var r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden'; };
  var at = function(e){ var r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };
  var ctrls = Array.prototype.slice.call(document.querySelectorAll('select,input[type=number],button,[role=button],input[type=submit],[aria-label]')).filter(vis).filter(function(e){
    var l = lab(e); return (e.tagName === 'SELECT' && /qty|quantit|quantidade|cantidad/i.test(l + ' ' + (e.name || '') + ' ' + ((e.closest('label') || {}).innerText || ''))) || e.type === 'number' || /^(increase|decrease|remove|delete|excluir|remover|eliminar)\\b|quantity is \\d+/i.test(l);
  });
  var lines = [], seen = [];
  ctrls.forEach(function(c){
    var card = c;
    while (card.parentElement && card.parentElement !== document.body) {
      var p = card.parentElement;
      var links = Array.prototype.slice.call(p.querySelectorAll('a[href]')).filter(function(a){ return (a.innerText || '').trim().length > 6; });
      if (links.length > 1 || (p.innerText || '').length > 800) break;
      card = p;
    }
    if (seen.indexOf(card) >= 0 || seen.some(function(s){ return s.contains(card); })) return;
    var link = Array.prototype.slice.call(card.querySelectorAll('a[href]')).map(function(a){ return (a.innerText || '').replace(/\\s+/g, ' ').trim(); }).filter(function(s){ return s.length > 6; })[0];
    if (!link) return;
    seen.push(card);
    var text = (card.innerText || '').replace(/\\s+/g, ' ');
    var sel = card.querySelector('select'), num = card.querySelector('input[type=number]');
    var qa = Array.prototype.map.call(card.querySelectorAll('[aria-label],[data-quantity]'), function(e){ return (e.getAttribute('aria-label') || '') + ' q=' + (e.getAttribute('data-quantity') || ''); }).join(' ');
    var qty = sel ? +sel.value : num ? +num.value : +((/(\\d+)\\s+in cart\\b/i.exec(text) || /quantity is\\s*(\\d+)/i.exec(qa) || /current quantity\\s*(\\d+)/i.exec(qa) || /q=(\\d+)/.exec(qa) || /\\b(?:qty|quantity)\\s*:?\\s*(\\d+)/i.exec(text) || [0, card.getAttribute('data-quantity') || 1])[1]);
    var bs = Array.prototype.slice.call(card.querySelectorAll('button,[role=button],input[type=submit]')).filter(vis);
    var inc = bs.filter(function(b){ return /^(increase|increment|\\+$)/i.test(lab(b)); })[0];
    var dec = bs.filter(function(b){ return /^(decrease|decrement|−$|-$)/i.test(lab(b)); })[0] || bs.filter(function(b){ return /^(remove|delete)\\b/i.test(lab(b)); })[0];
    lines.push({ name: link.slice(0, 160), qty: qty || 1, price: (/\\$\\s?\\d{1,4}(?:[.,]\\d{2})?/.exec(text) || [''])[0].replace(/\\s/g, ''), inc: inc ? at(inc) : undefined, dec: dec ? at(dec) : undefined, select: sel ? at(sel) : undefined });
  });
  var body = (document.body.innerText || '').replace(/\\s+/g, ' ');
  var st = /subtotal\\s*\\(?\\s*(\\d+)\\s*items?\\s*\\)?\\s*:?\\s*(\\$\\s?[\\d,.]+)/i.exec(body);
  var co = Array.prototype.slice.call(document.querySelectorAll('button,a,input[type=submit],[role=button]')).filter(vis).filter(function(b){ return /check ?out|proceed to (checkout|payment)|continue to (checkout|payment)/i.test(lab(b)) && lab(b).length < 60; })[0];
  return { isCart: true, lines: lines.slice(0, 40), subtotal: st ? st[2].replace(/\\s/g, '') : '', count: st ? +st[1] : lines.reduce(function(n, l){ return n + l.qty; }, 0), checkout: co ? Object.assign(at(co), { label: lab(co).slice(0, 60) }) : undefined };
})()`;

// ── do ponto na tela à ref do agente ───────────────────────────────────────
/** A ref (id do INTERACTIVE ELEMENTS) cujo centro bate com o ponto (os dois vêm da mesma viewport). */
export function refAt(elements: Array<{ id: number; x: number; y: number; w?: number; h?: number }>, p?: Pt): number | undefined {
  if (!p) return undefined;
  let best: { id: number; d: number } | undefined;
  for (const e of elements || []) {
    const d = Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
    if (d <= 6 && (!best || d < best.d)) best = { id: e.id, d };
  }
  return best?.id;
}

type Elems = Array<{ id: number; x: number; y: number }>;
const ref = (els: Elems, p?: Pt) => { const r = refAt(els, p); return r == null ? '' : `[${r}]`; };

/** Bloco de produtos desta página: o que é cada botão Add / + / −. */
export function formatProductTiles(tiles: ProductTile[], els: Elems, max = 12): string {
  const list = (tiles || []).filter(t => t && t.name);
  if (!list.length) return '';
  const lines = list.slice(0, max).map((t, i) => {
    const bits = [`${t.price || 'no price'}${t.unit ? ` (${t.unit})` : ''}`];
    if (t.sponsored) bits.push('Sponsored');
    if (t.oos) bits.push('OUT OF STOCK');
    else if (t.inCart > 0) bits.push(`IN CART ×${t.inCart}${t.inc ? ` · + ${ref(els, t.inc) || '(scroll to it)'}` : ''}${t.dec ? ` · − ${ref(els, t.dec) || '(scroll to it)'}` : ''}`);
    else if (t.add) bits.push(`ADD ${ref(els, t.add) || '(scroll to it)'}`);
    return `  ${i + 1}. ${t.name.length > 110 ? t.name.slice(0, 109) + '…' : t.name} — ${bits.join(' · ')}`;
  });
  return `GROCERY PRODUCTS ON THIS PAGE (${list.length} found${list.length > max ? `, first ${max} shown` : ''}). ADD [ref] adds 1; then + [ref] adds one more each click — the store keeps the count ("IN CART ×n"). OUT OF STOCK → never substitute without asking the user.\n${lines.join('\n')}`;
}

/** Bloco do carrinho: as linhas, o subtotal, e o lembrete de PARAR aqui. */
export function formatCartPage(cart: CartPage | null | undefined, els: Elems): string {
  if (!cart?.isCart) return '';
  const lines = (cart.lines || []).map(l => `  - ${l.name} ×${l.qty}${l.price ? ` — ${l.price}` : ''}${l.inc ? ` · + ${ref(els, l.inc)}` : ''}${l.dec ? ` · − ${ref(els, l.dec)}` : ''}${l.select ? ` · qty list ${ref(els, l.select)} (select_option)` : ''}`);
  const head = lines.length
    ? `CART PAGE: ${lines.length} product${lines.length === 1 ? '' : 's'}${cart.count ? `, ${cart.count} item${cart.count === 1 ? '' : 's'}` : ''}${cart.subtotal ? `, subtotal ${cart.subtotal}` : ''}.`
    : 'CART PAGE: Bah sees no items in this cart.';
  const stop = `The task ENDS here: compare the cart with the user's list (product, quantity), fix a wrong quantity with + / −, then report a table (item asked, product, qty, price). Do NOT click ${cart.checkout ? `"${cart.checkout.label}" ${ref(els, cart.checkout)}` : 'checkout'} or any payment / place-order / time-slot button — the user does that.`;
  return `${head}\n${lines.join('\n')}${lines.length ? '\n' : ''}${stop}`;
}

const stem = (w: string) => w.toLowerCase().replace(/[^a-z0-9áéíóúãõç ]/g, ' ').replace(/(ies)\b/g, 'y').replace(/(es|s)\b/g, '').trim();

/** Unidades por embalagem pelo nome ("6 Count", "12 ct", "Pack of 4", "Each" = 1); 0 = não dá pra saber (galão, lb…). */
export function unitsPerPack(name: string): number {
  const m = /\b(\d{1,3})\s*(?:-\s*)?(count|ct|pack|pk|pc|pcs|pieces)\b/i.exec(name || '') || /\bpack of (\d{1,3})\b/i.exec(name || '') || /\/(\d{1,3})\s*ct\b/i.exec(name || '');
  if (m) return Number(m[1]);
  return /\b(each|1 each)\b/i.test(name || '') ? 1 : 0;
}

/** O campo de busca da loja entre os elementos interativos (pra dizer "fill_ref [N]" no próximo item). */
export function searchBoxRef(els: Array<{ id: number; tag?: string; role?: string; text?: string; aria?: string; placeholder?: string }>): number | undefined {
  return (els || []).find(e => /searchbox/i.test(e.role || '') || (/^(input|textbox|combobox)$/i.test(e.role || e.tag || '') && /search|what can we help|buscar|pesquis/i.test(`${e.aria || ''} ${e.placeholder || ''} ${e.text || ''}`)))?.id;
}

/** Item "esgotado" = algum produto que o atende foi visto esgotado e NENHUM que o atende foi visto à venda
 *  ("bagels" com o Everything esgotado mas o Plain à venda não está esgotado). */
function soldOut(it: ListItem, oos: string[], available: string[]): string | undefined {
  const gone = oos.find(n => matchesListItem(it, n));
  return gone && !available.some(n => matchesListItem(it, n)) ? gone : undefined;
}

/** O produto atende este item da lista? Todas as palavras do item (e os números: "12-count" ≠ 18 Count) no nome. */
export function matchesListItem(item: ListItem, productName: string): boolean {
  const words = stem(item.text).split(/\s+/).filter(w => w.length >= 3 || /^\d+$/.test(w));
  const sn = ` ${stem(productName)} `;
  return words.length > 0 && words.every(w => /^\d+$/.test(w) ? new RegExp(`\\b${w}\\b`).test(sn) : sn.includes(w));
}

/** A lista do pedido contra o que já está no carrinho (nomes vistos com "in cart" ou na página do carrinho) e o
 *  que a loja mostrou esgotado: o modelo pequeno trocava o item esgotado pelo "mais parecido" sem perguntar. */
export function formatListProgress(list: ListItem[], inCart: ReadonlyMap<string, number>, outOfStock: Iterable<string> = [], searchRef?: number, available: Iterable<string> = []): string {
  if (!list?.length) return '';
  const names = [...inCart.entries()].filter(([, q]) => q > 0);
  const oos = [...outOfStock];
  const avail = [...available];
  let next = -1;
  const rows = list.map((it, i) => {
    const hit = names.find(([n]) => matchesListItem(it, n));
    const gone = !hit && soldOut(it, oos, avail);
    // Quantas unidades o pedido quer: o número dito, ou 6 pra fruta vendida por unidade ("Each") sem número.
    const per = hit ? unitsPerPack(hit[0]) : 0;
    const wanted = it.count ?? (hit && per === 1 ? 6 : undefined);
    const want = it.count ? ` (${it.count} wanted${/dozen/i.test(it.raw) ? ' — a dozen; packs add up, e.g. 2 × 6-count' : ''})` : '';
    // Embalagem com contagem conhecida e menos que o pedido → faltam cliques no +.
    const short = hit && wanted && per > 0 && hit[1] * per < wanted ? Math.ceil(wanted / per) - hit[1] : 0;
    if ((!hit || short) && !gone && next < 0) next = i;
    const state = short ? `in cart ×${hit![1]} of ${hit![0].slice(0, 60)} = ${hit![1] * per} of ${wanted}${it.count ? '' : ' (sold each; 6 is the default)'} — click its + ${short} more time${short > 1 ? 's' : ''}`
      : hit ? `✓ in cart: ${hit[0].slice(0, 70)} ×${hit[1]}`
      : gone ? `OUT OF STOCK (${gone.slice(0, 60)}) — do NOT add another product instead; skip it and ask the user at the end`
      : 'not in cart yet';
    return `  - ${it.text}${want}: ${state}`;
  });
  const left = rows.filter(r => r.endsWith('not in cart yet') || / more times?$/.test(r)).length;
  // Próximo passo concreto: o modelo pequeno "decidia pular" o esgotado e mandava um click_ref sem ref.
  const nextItem = next >= 0 ? list[next] : null;
  const how = nextItem && rows[next].endsWith('not in cart yet') && searchRef != null
    ? ` → { "action": "fill_ref", "ref": ${searchRef}, "value": "${nextItem.text.replace(/"/g, '')}" } (Bah presses Enter for you)` : '';
  return `SHOPPING LIST (from the request; ${left ? `${left} left — next: ${nextItem ? nextItem.text : ''}${how}` : 'nothing left to add — open the cart and check it'}):\n${rows.join('\n')}`;
}

/** O clique em ADD põe um produto que nenhum item que FALTA na lista pede (ex.: os ovos de 18 no lugar dos de 12
 *  esgotados — o modelo dizia "vou pular" e clicava o Add do vizinho)? Devolve o nome do produto, ou null. */
export function offListAdd(tiles: ProductTile[], els: Elems, ref: number, list: ListItem[], inCart: ReadonlyMap<string, number>): string | null {
  if (!list?.length) return null;
  const tile = (tiles || []).find(t => t.add && refAt(els, t.add) === ref);
  if (!tile || tile.guessed) return null;
  const pending = list.filter(it => ![...inCart.entries()].some(([n, q]) => q > 0 && matchesListItem(it, n)));
  return pending.some(it => matchesListItem(it, tile.name)) ? null : tile.name;
}

/** O próximo item da lista que ainda não está no carrinho nem foi visto esgotado (null = nada a buscar). */
export function nextListItem(list: ListItem[], inCart: ReadonlyMap<string, number>, outOfStock: Iterable<string> = [], available: Iterable<string> = []): ListItem | null {
  const names = [...inCart.entries()].filter(([, q]) => q > 0).map(([n]) => n);
  const oos = [...outOfStock], avail = [...available];
  return (list || []).find(it => !names.some(n => matchesListItem(it, n)) && !soldOut(it, oos, avail)) || null;
}

/** Antes de encerrar uma tarefa de carrinho (done ou render_view): o que ainda falta, em ordem — itens que dá pra
 *  pôr (faltando ou com menos unidades que o pedido), o carrinho não conferido depois da última mudança, e o
 *  esgotado que o relatório não menciona. null = pode encerrar. */
export function cartFinishProblem(o: { list: ListItem[]; inCart: ReadonlyMap<string, number>; outOfStock: Iterable<string>; available?: Iterable<string>; cartPageSeen: boolean; report: string }): string | null {
  const oos = [...o.outOfStock], avail = [...(o.available || [])];
  const names = [...o.inCart.entries()].filter(([, q]) => q > 0);
  const missing: string[] = [];
  const gone: string[] = [];
  for (const it of o.list || []) {
    const hit = names.find(([n]) => matchesListItem(it, n));
    if (!hit) { if (soldOut(it, oos, avail)) gone.push(it.text); else missing.push(`"${it.text}" is not in the cart`); continue; }
    const per = unitsPerPack(hit[0]);
    if (it.count && per > 0 && hit[1] * per < it.count) missing.push(`"${it.text}": ${hit[1] * per} of ${it.count} in the cart — click its + ${Math.ceil(it.count / per) - hit[1]} more time(s)`);
  }
  if (missing.length) return `NOT DONE YET: ${missing.join('; ')}. Finish these first (see SHOPPING LIST), then open the cart.`;
  if (!names.length) return null;   // nada posto: é uma pergunta à pessoa
  if (!o.cartPageSeen) return `NOT DONE YET: open the cart (the store's cart link or icon) and check every line against the SHOPPING LIST — product and quantity — before you report. Do not check out.`;
  if (gone.length && !/out of stock|unavailable|sold out|esgotad|agotad/i.test(o.report || '')) {
    return `NOT DONE YET: your report must tell the user that ${gone.map(t => `"${t}"`).join(', ')} ${gone.length > 1 ? 'were' : 'was'} OUT OF STOCK and ask which substitute they want (name 1–2 options you saw). Then finish.`;
  }
  return null;
}
