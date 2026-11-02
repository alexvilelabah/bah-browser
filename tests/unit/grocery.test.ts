// Carrinho de mercado: detecção da tarefa, a lista do pedido, e os blocos que dizem ao modelo qual botão
// Add/+/− é de qual produto e o que já está no carrinho. Os leitores de página (scripts) rodam no e2e.
import { test } from 'node:test';
import assert from 'node:assert';
import { commandIsGrocery, parseGroceryList, matchesListItem, offListAdd, unitsPerPack, searchBoxRef, nextListItem, cartFinishProblem, refAt, formatProductTiles, formatCartPage, formatListProgress, type ProductTile } from '../../src/renderer/grocery.ts';

test('a grocery-cart request is detected; a price comparison is not', () => {
  for (const c of [
    'add milk, eggs, bananas and a dozen bagels to my Walmart cart',
    'put 2 gallons of milk in my Target cart',
    'fill my Whole Foods cart from this shopping list: oat milk, apples',
    'order groceries: bread and butter',
    'adiciona leite e ovos no meu carrinho',
    'añade leche al carrito',
  ]) assert.ok(commandIsGrocery(c), c);
  for (const c of [
    'compare prices for AirPods at Best Buy',
    'find the cheapest milk at Walmart but do not add to cart',
    "what's in my cart?",
    'download the Walmart app',
    'apply to this job',
  ]) assert.ok(!commandIsGrocery(c), c);
});

test('the list: items, counts and dozens, without the verb or the store', () => {
  const l = parseGroceryList('add milk, eggs, bananas and a dozen bagels to my Walmart cart');
  assert.deepStrictEqual(l.map(x => [x.text, x.count]), [['milk', undefined], ['eggs', undefined], ['bananas', undefined], ['bagels', 12]]);
  const l2 = parseGroceryList('put 2 gallons of milk, 6 bananas & two dozen eggs in my Target cart');
  assert.deepStrictEqual(l2.map(x => [x.text, x.count]), [['gallons of milk', 2], ['bananas', 6], ['eggs', 24]]);
  const l3 = parseGroceryList('add organic whole milk and some apples on Whole Foods');
  assert.deepStrictEqual(l3.map(x => x.text), ['organic whole milk', 'apples']);
});

test('refAt: the element whose centre matches the button (same viewport)', () => {
  const els = [{ id: 3, x: 100, y: 200 }, { id: 4, x: 104, y: 260 }, { id: 5, x: 400, y: 200 }];
  assert.strictEqual(refAt(els, { x: 101, y: 202 }), 3);
  assert.strictEqual(refAt(els, { x: 104, y: 259 }), 4);
  assert.strictEqual(refAt(els, { x: 250, y: 200 }), undefined);   // nada perto: sem ref inventada
  assert.strictEqual(refAt(els, undefined), undefined);
});

const tiles: ProductTile[] = [
  { name: 'Great Value Whole Vitamin D Milk, Gallon, 128 fl oz', price: '$3.12', unit: '2.4 ¢/fl oz', oos: false, sponsored: false, inCart: 0, href: '/ip/1', add: { x: 50, y: 300 } },
  { name: 'Lactaid Whole Milk, 64 oz', price: '$4.48', unit: '', oos: false, sponsored: true, inCart: 0, href: '/ip/2', add: { x: 350, y: 300 } },
  { name: 'Great Value Large White Eggs, 12 Count', price: '$3.27', unit: '', oos: true, sponsored: false, inCart: 0, href: '/ip/3' },
  { name: "Thomas' Plain Bagels, 6 Count", price: '$3.98', unit: '19.9 ¢/oz', oos: false, sponsored: false, inCart: 2, href: '/ip/4', inc: { x: 700, y: 300 }, dec: { x: 640, y: 300 } },
  { name: 'Fresh Banana Fruit, Each', price: '$0.27', unit: '', oos: false, sponsored: false, inCart: 0, href: '/ip/5', add: { x: 50, y: 1400 } },
];
const els = [{ id: 7, x: 50, y: 300 }, { id: 9, x: 351, y: 301 }, { id: 12, x: 640, y: 300 }, { id: 13, x: 700, y: 300 }];

test('product block: each Add / + / − with its ref, out of stock and sponsored marked', () => {
  const b = formatProductTiles(tiles, els);
  assert.match(b, /GROCERY PRODUCTS ON THIS PAGE \(5 found\)/);
  assert.match(b, /1\. Great Value Whole Vitamin D Milk, Gallon, 128 fl oz — \$3\.12 \(2\.4 ¢\/fl oz\) · ADD \[7\]/);
  assert.match(b, /2\. Lactaid Whole Milk, 64 oz — \$4\.48 · Sponsored · ADD \[9\]/);
  assert.match(b, /3\. Great Value Large White Eggs, 12 Count — \$3\.27 · OUT OF STOCK$/m);
  assert.match(b, /4\. Thomas' Plain Bagels, 6 Count — \$3\.98 \(19\.9 ¢\/oz\) · IN CART ×2 · \+ \[13\] · − \[12\]/);
  assert.match(b, /5\. Fresh Banana Fruit, Each — \$0\.27 · ADD \(scroll to it\)/);
  assert.match(b, /never substitute without asking the user/);
  assert.strictEqual(formatProductTiles([], els), '');
});

test('cart block: lines, subtotal, and the stop before checkout', () => {
  const b = formatCartPage({ isCart: true, subtotal: '$12.38', count: 4, checkout: { x: 900, y: 120, label: 'Continue to checkout' },
    lines: [{ name: "Thomas' Plain Bagels, 6 Count", qty: 2, price: '$7.96', inc: { x: 700, y: 300 }, dec: { x: 640, y: 300 } }, { name: 'Great Value Milk, Gallon', qty: 1, price: '$3.12' }] },
  [...els, { id: 2, x: 900, y: 120 }]);
  assert.match(b, /^CART PAGE: 2 products, 4 items, subtotal \$12\.38\./);
  assert.match(b, /- Thomas' Plain Bagels, 6 Count ×2 — \$7\.96 · \+ \[13\] · − \[12\]/);
  assert.match(b, /Do NOT click "Continue to checkout" \[2\]/);
  assert.match(formatCartPage({ isCart: true, lines: [], subtotal: '', count: 0 }, []), /sees no items/);
  assert.strictEqual(formatCartPage({ isCart: false, lines: [], subtotal: '', count: 0 }, []), '');
});

test('list progress: what is in the cart and what is left', () => {
  const list = parseGroceryList('add milk, eggs, bananas and a dozen bagels to my Walmart cart');
  const inCart = new Map([["Thomas' Plain Bagels, 6 Count", 2], ['Great Value Whole Vitamin D Milk, Gallon', 1]]);
  const b = formatListProgress(list, inCart);
  assert.match(b, /SHOPPING LIST \(from the request; 2 left — next: eggs\)/);   // bagels: 2 × 6 = 12, done
  assert.match(b, /- milk: ✓ in cart: Great Value Whole Vitamin D Milk, Gallon ×1/);
  assert.match(b, /- eggs: not in cart yet/);
  assert.match(b, /- bagels \(12 wanted — a dozen; packs add up, e\.g\. 2 × 6-count\): ✓ in cart: Thomas' Plain Bagels, 6 Count ×2/);
  inCart.set("Eggland's Best Large Eggs, 12 Count", 1); inCart.set('Fresh Banana Fruit, Each', 6);
  assert.match(formatListProgress(list, inCart), /nothing left to add — open the cart and check it/);
  assert.strictEqual(formatListProgress([], inCart), '');
});

test('list progress: a named product out of stock is not replaced by a look-alike', () => {
  const list = parseGroceryList('add milk, Great Value 12-count large white eggs and bananas to my Walmart cart');
  assert.strictEqual(list[1].text, 'Great Value 12-count large white eggs');
  assert.ok(matchesListItem(list[1], 'Great Value Large White Eggs, 12 Count'));
  assert.ok(!matchesListItem(list[1], 'Great Value Large White Eggs, 18 Count'));   // o número conta
  const inCart = new Map([['Great Value Whole Vitamin D Milk, Gallon', 1], ['Great Value Large White Eggs, 18 Count', 1]]);
  const b = formatListProgress(list, inCart, ['Great Value Large White Eggs, 12 Count']);
  assert.match(b, /- Great Value 12-count large white eggs: OUT OF STOCK \(Great Value Large White Eggs, 12 Count\) — do NOT add another product instead/);
  assert.match(b, /1 left — next: bananas/);
});

test('an ADD that no missing list item asks for is flagged (the out-of-stock look-alike)', () => {
  const list = parseGroceryList('add milk, Great Value 12-count large white eggs and bananas to my Walmart cart');
  const t: ProductTile[] = [
    { name: 'Great Value Large White Eggs, 12 Count', price: '$3.27', unit: '', oos: true, sponsored: false, inCart: 0, href: '' },
    { name: 'Great Value Large White Eggs, 18 Count', price: '$4.62', unit: '', oos: false, sponsored: false, inCart: 0, href: '', add: { x: 10, y: 10 } },
    { name: 'Fresh Banana Fruit, Each', price: '$0.27', unit: '', oos: false, sponsored: false, inCart: 0, href: '', add: { x: 10, y: 60 } },
    { name: 'Great Value Whole Milk, Gallon', price: '$3.12', unit: '', oos: false, sponsored: false, inCart: 0, href: '', add: { x: 10, y: 110 } },
  ];
  const e = [{ id: 11, x: 10, y: 10 }, { id: 12, x: 10, y: 60 }, { id: 13, x: 10, y: 110 }];
  const inCart = new Map([['Great Value Whole Vitamin D Milk, Gallon', 1]]);
  assert.strictEqual(offListAdd(t, e, 11, list, inCart), 'Great Value Large White Eggs, 18 Count');
  assert.strictEqual(offListAdd(t, e, 12, list, inCart), null);                       // bananas: on the list
  assert.strictEqual(offListAdd(t, e, 13, list, inCart), 'Great Value Whole Milk, Gallon');   // milk is already in the cart
  assert.strictEqual(offListAdd(t, e, 13, list, new Map()), null);
  assert.strictEqual(offListAdd(t, e, 99, list, inCart), null);                       // not an ADD button
  assert.strictEqual(offListAdd(t, e, 11, [], inCart), null);                         // no parsed list: no opinion
  // name guessed from the page's h1 outside the tile ("Shop"): not enough to hold the click back
  const g: ProductTile[] = [{ name: 'Shop', guessed: true, price: '', unit: '', oos: false, sponsored: false, inCart: 0, href: '', add: { x: 10, y: 10 } }];
  assert.strictEqual(offListAdd(g, e, 11, parseGroceryList('add the toaster to the cart'), new Map()), null);
  assert.deepStrictEqual(parseGroceryList('add the toaster to the cart').map(i => i.text), ['toaster']);
});

test('quantities: pack sizes from names, and a short count asks for more +', () => {
  assert.strictEqual(unitsPerPack("Thomas' Plain Bagels, 6 Count, 20 oz"), 6);
  assert.strictEqual(unitsPerPack('Grade A Large Eggs - 12ct - Good & Gather'), 12);
  assert.strictEqual(unitsPerPack("Thomas' Plain Bagels - 20oz/6ct"), 6);
  assert.strictEqual(unitsPerPack('Fresh Banana Fruit, Each'), 1);
  assert.strictEqual(unitsPerPack('Great Value Whole Milk, Gallon'), 0);
  const list = parseGroceryList('add bananas and a dozen bagels to my cart');
  const b = formatListProgress(list, new Map([['Great Value Plain Bagels, 6 Count, 20 oz', 1], ['Fresh Banana Fruit, Each', 1]]));
  assert.match(b, /- bananas: in cart ×1 of Fresh Banana Fruit, Each = 1 of 6 \(sold each; 6 is the default\) — click its \+ 5 more times/);
  assert.match(b, /- bagels \(12 wanted[^\n]*: in cart ×1 of Great Value Plain Bagels, 6 Count, 20 oz = 6 of 12 — click its \+ 1 more time$/m);
  assert.match(b, /2 left — next: bananas/);
  assert.match(formatListProgress(list, new Map([['Great Value Plain Bagels, 6 Count, 20 oz', 2], ['Fresh Banana Fruit, Each', 6]])), /nothing left to add/);
});

test('the next item comes with the search box ref', () => {
  const els = [{ id: 3, tag: 'a', role: 'link', text: 'Cart' }, { id: 4, tag: 'input', role: 'searchbox', aria: 'Search Walmart' }];
  assert.strictEqual(searchBoxRef(els), 4);
  assert.strictEqual(searchBoxRef([{ id: 2, tag: 'input', role: 'textbox', placeholder: 'What can we help you find?' }]), 2);
  assert.strictEqual(searchBoxRef([{ id: 2, tag: 'input', role: 'textbox', aria: 'ZIP code' }]), undefined);
  const list = parseGroceryList('add milk and bananas to my cart');
  assert.match(formatListProgress(list, new Map([['Great Value Milk, Gallon', 1]]), [], 4), /1 left — next: bananas → \{ "action": "fill_ref", "ref": 4, "value": "bananas" \} \(Bah presses Enter for you\)/);
});

test('a cart task is not an account task: a header "Sign In" link does not pause a stuck grocery run', async () => {
  const { commandLikelyNeedsAccount } = await import('../../src/renderer/agent-login-policy.ts');
  assert.ok(!commandLikelyNeedsAccount('add milk and eggs to my cart on this Walmart site'));
  assert.ok(!commandLikelyNeedsAccount('põe leite no meu carrinho'));
  assert.ok(commandLikelyNeedsAccount('show my orders'));
});

test('next list item: skips what is in the cart and what was seen out of stock', () => {
  const list = parseGroceryList('add milk, Great Value 12-count large white eggs, bananas and a dozen bagels to my cart');
  const inCart = new Map([['Great Value Whole Vitamin D Milk, Gallon', 1]]);
  assert.strictEqual(nextListItem(list, inCart, ['Great Value Large White Eggs, 12 Count'])?.text, 'bananas');
  assert.strictEqual(nextListItem(list, inCart)?.text, 'Great Value 12-count large white eggs');
  inCart.set('Fresh Banana Fruit, Each', 6); inCart.set('Great Value Plain Bagels, 6 Count', 2);
  assert.strictEqual(nextListItem(list, inCart, ['Great Value Large White Eggs, 12 Count']), null);
});

test('finish check: missing or short items, then the cart, then the out-of-stock mention', () => {
  const list = parseGroceryList('add milk, Great Value 12-count large white eggs, bananas and a dozen bagels to my cart');
  const oos = ['Great Value Large White Eggs, 12 Count'];
  const inCart = new Map([['Great Value Whole Vitamin D Milk, Gallon', 1], ['Fresh Banana Fruit, Each', 1], ['Great Value Plain Bagels, 6 Count, 20 oz', 1]]);
  const base = { list, inCart, outOfStock: oos, cartPageSeen: true, report: 'done' };
  assert.match(cartFinishProblem(base)!, /"bagels": 6 of 12 in the cart — click its \+ 1 more time/);
  inCart.set('Great Value Plain Bagels, 6 Count, 20 oz', 2);
  assert.match(cartFinishProblem({ ...base, cartPageSeen: false })!, /open the cart/);
  assert.match(cartFinishProblem(base)!, /"Great Value 12-count large white eggs" was OUT OF STOCK/);
  assert.strictEqual(cartFinishProblem({ ...base, report: 'Eggs: out of stock — want Eggland\'s Best instead?' }), null);
  assert.strictEqual(cartFinishProblem({ ...base, inCart: new Map() , list: [] }), null);
});

test('a generic item is not "out of stock" while another product for it is on sale', () => {
  const list = parseGroceryList('add a dozen bagels to my cart');
  const oos = ['Everything Bagels, 6 Count'];
  assert.match(formatListProgress(list, new Map(), oos, 2, ['Plain Bagels, 6 Count']), /1 left — next: bagels/);
  assert.strictEqual(nextListItem(list, new Map(), oos, ['Plain Bagels, 6 Count'])?.text, 'bagels');
  assert.match(formatListProgress(list, new Map(), oos, 2), /OUT OF STOCK \(Everything Bagels, 6 Count\)/);   // nothing else seen
});
