// Carrinho de mercado: detecção da tarefa, a lista do pedido, e os blocos que dizem ao modelo qual botão
// Add/+/− é de qual produto e o que já está no carrinho. Os leitores de página (scripts) rodam no e2e.
import { test } from 'node:test';
import assert from 'node:assert';
import { commandIsGrocery, parseGroceryList, refAt, formatProductTiles, formatCartPage, formatListProgress, type ProductTile } from '../../src/renderer/grocery.ts';

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
  assert.match(b, /SHOPPING LIST \(from the request; 2 left\)/);
  assert.match(b, /- milk: ✓ in cart: Great Value Whole Vitamin D Milk, Gallon ×1/);
  assert.match(b, /- eggs: not in cart yet/);
  assert.match(b, /- bagels \(12 wanted — a dozen; packs add up, e\.g\. 2 × 6-count\): ✓ in cart: Thomas' Plain Bagels, 6 Count ×2/);
  inCart.set("Eggland's Best Large Eggs, 12 Count", 1); inCart.set('Fresh Banana Fruit, Each', 6);
  assert.match(formatListProgress(list, inCart), /all in cart — open the cart and check it/);
  assert.strictEqual(formatListProgress([], inCart), '');
});
