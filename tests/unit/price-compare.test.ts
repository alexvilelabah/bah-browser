// Preço em várias lojas: detectar o pedido, buscar só o produto, escolher as lojas e só aceitar
// preço lido no domínio da própria loja (artigo, blog de ofertas e agregador nunca viram linha).
import { test } from 'node:test';
import assert from 'node:assert';
import {
  isPriceComparison, priceCompareQuery, pickStores, namedStores, unknownNamedStores, storeSearchUrl, isStoreSource,
  blockedReason, parsePrice, priceOnPage, titleMatchesQuery, looksLikeAccessory, parseReadReply, checkRead,
  pageSnippets, compareTableSpec, compareSummary, priceStoresFor, type PriceStore,
} from '../../src/renderer/price-compare.ts';

const store = (id: string, country = 'US'): PriceStore => priceStoresFor(country).find(s => s.id === id)!;

test('detects multi-store price comparisons (en + pt-BR)', () => {
  for (const c of [
    'compare prices for AirPods Pro on Amazon and other stores',
    'compare AirPods Pro prices on Amazon, Best Buy and Walmart',
    'Amazon vs Best Buy price for Sony WH-1000XM5',
    'where to buy the cheapest Nintendo Switch 2',
    'find the cheapest place to buy a Kindle Paperwhite',
    'which store has the cheapest Dyson V15?',
    'check AirPods Pro prices across stores',
    'how much is the Steam Deck at other stores',
    'compare prices for AirPods Pro',
    'compare os preços do iPhone 16 na Amazon e em outras lojas',
    'onde comprar PS5 mais barato',
    'qual loja tem o air fryer mais barato?',
  ]) assert.strictEqual(isPriceComparison(c), true, c);
});

test('single-store, travel, quotes and cart requests are not multi-store comparisons', () => {
  for (const c of [
    'find the cheapest AirPods on Amazon',
    'compare prices at Whole Foods for oat milk',
    'price of iPhone 15',
    'compare hotel prices in Paris',
    'compare flight prices to Lisbon across sites',
    'add milk to my cart and compare prices',
    'compare these two laptops',
    'what is the price of bitcoin',
  ]) assert.strictEqual(isPriceComparison(c), false, c);
});

test('the store query is only the product — no instruction words, no store names', () => {
  const want: Record<string, string> = {
    'compare prices for AirPods Pro on Amazon and other stores': 'AirPods Pro',
    'compare AirPods Pro prices on Amazon, Best Buy and Walmart': 'AirPods Pro',
    'Amazon vs Best Buy price for Sony WH-1000XM5': 'Sony WH-1000XM5',
    'where to buy the cheapest Nintendo Switch 2': 'Nintendo Switch 2',
    'find the cheapest place to buy a Kindle Paperwhite': 'Kindle Paperwhite',
    'which store has the cheapest Dyson V15?': 'Dyson V15',
    'check AirPods Pro prices across stores': 'AirPods Pro',
    'please compare prices of the Echo Dot at Target and Walmart and show me a table': 'Echo Dot',
    'compare os preços do iPhone 16 na Amazon e em outras lojas': 'iPhone 16',
    'onde comprar PS5 mais barato': 'PS5',
    'qual loja tem o air fryer mais barato?': 'air fryer',
    'compare prices for AirPods Pro on Amazon and Micro Center': 'AirPods Pro',
  };
  for (const [c, q] of Object.entries(want)) assert.strictEqual(priceCompareQuery(c), q, c);
});

test('store list: the named stores, then the region\'s general retailers up to 4', () => {
  const ids = (c: string, country = 'US') => pickStores(c, country).map(s => s.id);
  assert.deepStrictEqual(ids('compare prices for AirPods Pro on Amazon and other stores'), ['amazon', 'bestbuy', 'walmart', 'target']);
  assert.deepStrictEqual(ids('compare prices for AirPods Pro on Costco and other stores'), ['costco', 'amazon', 'bestbuy', 'walmart']);
  // Named two and did not ask for others → only those two.
  assert.deepStrictEqual(ids('Amazon vs Best Buy price for Sony WH-1000XM5'), ['amazon', 'bestbuy']);
  assert.deepStrictEqual(ids('compare AirPods Pro prices on Amazon, Best Buy and Walmart'), ['amazon', 'bestbuy', 'walmart']);
  // Region: Brazil → Amazon.com.br + Brazilian retailers; UK → amazon.co.uk + UK retailers.
  assert.deepStrictEqual(ids('onde comprar PS5 mais barato', 'BR'), ['amazon', 'mercadolivre', 'magalu', 'casasbahia']);
  assert.strictEqual(pickStores('onde comprar PS5 mais barato', 'BR')[0].domain, 'amazon.com.br');
  assert.deepStrictEqual(ids('where to buy the cheapest Kindle', 'GB'), ['amazon', 'argos', 'currys', 'johnlewis']);
  assert.strictEqual(pickStores('where to buy the cheapest Kindle', 'GB')[0].domain, 'amazon.co.uk');
  // Unknown country → local Amazon + eBay, never a guessed domain.
  assert.deepStrictEqual(ids('where to buy the cheapest Kindle', 'NZ'), ['amazon', 'ebay']);
  // "target" only counts as a store in a store list, not as a word.
  assert.deepStrictEqual(namedStores('compare prices on target practice gear').map(s => s.id), ['target']);
  assert.deepStrictEqual(namedStores('price comparison for a target pistol stand').map(s => s.id), []);
  // A store we do not know is reported, not guessed.
  assert.deepStrictEqual(unknownNamedStores('compare prices for AirPods Pro on Amazon and Micro Center'), ['Micro Center']);
});

test('search URL is the store\'s own search with only the product', () => {
  assert.strictEqual(storeSearchUrl(store('bestbuy'), 'AirPods Pro'), 'https://www.bestbuy.com/site/searchpage.jsp?st=AirPods%20Pro');
  assert.strictEqual(storeSearchUrl(store('amazon'), 'AirPods Pro'), 'https://www.amazon.com/s?k=AirPods%20Pro');
});

test('source-domain check: only the store\'s own domain counts', () => {
  const bb = store('bestbuy');
  assert.ok(isStoreSource('https://www.bestbuy.com/site/apple-airpods-pro-2/6447382.p', bb));
  assert.ok(isStoreSource('https://bestbuy.com/site/searchpage.jsp?st=x', bb));
  for (const u of [
    'https://www.macprices.net/2026/04/27/airpods-deals-compared-amazon-vs-walmart-vs-apple-pricing-right-now/',
    'https://www.google.com/search?q=airpods+pro+best+buy',
    'https://bestbuy.com.evil.example/site',
    'https://notbestbuy.com/',
    'chrome-error://chromewebdata/',
    '',
  ]) assert.strictEqual(isStoreSource(u, bb), false, u);
});

test('blocked pages: error, captcha, bot check, sign-in, off-domain — but not a full results page', () => {
  const amz = store('amazon');
  assert.strictEqual(blockedReason({ url: 'https://www.amazon.com/s?k=x', title: 'Amazon.com', text: "Sorry! Something went wrong!\nWe're working on it." }, amz), 'error page');
  assert.strictEqual(blockedReason({ url: 'https://www.amazon.com/errors/validateCaptcha', title: 'Amazon.com', text: 'Enter the characters you see below. Sorry, we just need to make sure you\'re not a robot.' }, amz), 'bot check / captcha');
  assert.strictEqual(blockedReason({ url: 'https://www.walmart.com/blocked?url=x', title: 'Robot or human?', text: 'Activate and hold the button to confirm that you’re human. Press & Hold' }, store('walmart')), 'bot check / captcha');
  assert.strictEqual(blockedReason({ url: 'https://www.amazon.com/ap/signin?x', title: 'Amazon Sign-In', text: 'Sign in Email or mobile phone number' }, amz), 'sign-in wall');
  assert.strictEqual(blockedReason({ url: 'https://www.target.com/s?searchTerm=x', title: 'Access Denied', text: 'Access Denied' }, store('target')), 'access denied (blocked)');
  assert.match(blockedReason({ url: 'https://www.macprices.net/deals', title: 'AirPods deals', text: 'x'.repeat(5000) }, amz)!, /^left amazon\.com/);
  assert.strictEqual(blockedReason({ url: 'chrome-error://chromewebdata/', title: '', text: '' }, amz), "the page didn't load");
  // A real results page that happens to mention "robot" (a robot vacuum) is readable.
  const results = 'Results\n' + Array.from({ length: 60 }, (_, i) => `iRobot Roomba robot vacuum ${i}\n$${199 + i}.99`).join('\n');
  assert.strictEqual(blockedReason({ url: 'https://www.amazon.com/s?k=robot+vacuum', title: 'Amazon.com : robot vacuum', text: results }, amz), null);
});

test('prices: parsing and confirmation against the page text', () => {
  assert.strictEqual(parsePrice('$1,299.99'), 1299.99);
  assert.strictEqual(parsePrice('R$ 1.299,90'), 1299.9);
  assert.strictEqual(parsePrice('£249'), 249);
  assert.strictEqual(parsePrice('$199.00'), 199);
  assert.strictEqual(parsePrice('n/a'), null);
  assert.ok(priceOnPage('$199.99', 'Apple AirPods Pro 2\n$199.99\nFree shipping'));
  assert.ok(priceOnPage('$199.99', 'Apple AirPods Pro 2\n$\n199\n99\nList: $249.00'));   // Amazon split price
  assert.ok(priceOnPage('R$ 1.899,00', 'Fone AirPods Pro R$ 1.899'));
  assert.ok(!priceOnPage('$179.99', 'Apple AirPods Pro 2\n$199.99'));                   // invented price
  assert.ok(!priceOnPage('$19.99', 'Apple AirPods Pro 2\n$119.99'));
});

test('title must be the product, not an accessory', () => {
  assert.ok(titleMatchesQuery('Apple AirPods Pro 2 Wireless Earbuds with USB-C', 'AirPods Pro'));
  assert.ok(!titleMatchesQuery('Apple AirPods 4', 'AirPods Pro'));
  assert.ok(looksLikeAccessory('Silicone Case Cover for AirPods Pro 2', 'AirPods Pro'));
  assert.ok(looksLikeAccessory('Replacement ear tips compatible with AirPods Pro', 'AirPods Pro'));
  assert.ok(looksLikeAccessory('AirPods Pro 2 Case, Clear Shockproof', 'AirPods Pro'));
  assert.ok(!looksLikeAccessory('Apple AirPods Pro 2 with MagSafe Charging Case (USB-C)', 'AirPods Pro'));
});

test('model reply parsing tolerates fences and think tags', () => {
  assert.deepStrictEqual(parseReadReply('<think>hmm</think>```json\n{"found": true, "title": "Apple AirPods Pro 2", "price": "$199.99", "availability": "In stock"}\n```'),
    { found: true, title: 'Apple AirPods Pro 2', price: '$199.99', availability: 'In stock', blocked: '' });
  assert.strictEqual(parseReadReply('no json here'), null);
});

test('checkRead: a row counts only when read on the store page and confirmed there', () => {
  const bb = store('bestbuy');
  const page = { url: 'https://www.bestbuy.com/site/searchpage.jsp?st=AirPods%20Pro', text: 'Apple - AirPods Pro 2 (USB-C)\n$199.99\nWas $249.99\nPickup today' };
  const good = { found: true, title: 'Apple - AirPods Pro 2 (USB-C)', price: '$199.99', availability: 'Pickup today', blocked: '' };
  assert.strictEqual(checkRead(good, page, bb, 'AirPods Pro').status, 'read');
  assert.strictEqual(checkRead(good, page, bb, 'AirPods Pro').amount, 199.99);
  // Same numbers but read off a deals article → never a row.
  const article = { url: 'https://www.macprices.net/airpods-deals', text: page.text };
  assert.strictEqual(checkRead(good, article, bb, 'AirPods Pro').status, 'blocked');
  // Price the model "saw" but is not on the page → not counted.
  assert.strictEqual(checkRead({ ...good, price: '$179.00' }, page, bb, 'AirPods Pro').status, 'not_found');
  // Accessory → not the product.
  assert.strictEqual(checkRead({ ...good, title: 'Case for AirPods Pro 2' }, page, bb, 'AirPods Pro').status, 'not_found');
  // The model says the page is a captcha.
  assert.deepStrictEqual(checkRead({ ...good, found: false, blocked: 'captcha' }, page, bb, 'AirPods Pro').status, 'blocked');
  assert.strictEqual(checkRead(null, page, bb, 'AirPods Pro').status, 'not_found');
});

test('snippets keep the product lines and the price right after them', () => {
  const text = ['Menu', 'Deals', ...Array.from({ length: 200 }, (_, i) => `filler line ${i}`), 'Apple AirPods Pro 2', '4.7 stars', '$199.99', 'Free shipping', ...Array.from({ length: 50 }, (_, i) => `more ${i}`)].join('\n');
  const s = pageSnippets(text, 'AirPods Pro');
  assert.match(s, /Apple AirPods Pro 2\n4\.7 stars\n\$199\.99/);
  assert.ok(!s.includes('filler line 10\n'));
});

test('table lists every store attempted with links; summary counts read vs blocked', () => {
  const rows = [
    { store: 'Amazon', status: 'blocked' as const, url: 'https://www.amazon.com/s?k=AirPods%20Pro', reason: 'error page' },
    { store: 'Best Buy', status: 'read' as const, url: 'https://www.bestbuy.com/site/x', title: 'Apple - AirPods Pro 2', price: '$199.99', amount: 199.99, availability: 'In stock' },
    { store: 'Walmart', status: 'blocked' as const, url: 'https://www.walmart.com/blocked', reason: 'bot check / captcha' },
    { store: 'Target', status: 'read' as const, url: 'https://www.target.com/p/x', title: 'Apple AirPods Pro 2', price: '$189.99', amount: 189.99, availability: '' },
  ];
  const spec = compareTableSpec('AirPods Pro', rows, new Date(2026, 10, 2));
  assert.strictEqual(spec.rows.length, 4);
  assert.deepStrictEqual(spec.rows.map(r => r[0]), ['Target', 'Best Buy', 'Amazon', 'Walmart']);
  assert.deepStrictEqual(spec.links, ['https://www.target.com/p/x', 'https://www.bestbuy.com/site/x', 'https://www.amazon.com/s?k=AirPods%20Pro', 'https://www.walmart.com/blocked']);
  assert.strictEqual(spec.rows[2][4], "couldn't read — error page");
  assert.match(spec.subtitle, /2 of 4 stores read/);
  const msg = compareSummary('AirPods Pro', rows);
  assert.match(msg, /read 2 \(Target \$189\.99, Best Buy \$199\.99\)/);
  assert.match(msg, /blocked 2 \(Amazon — error page; Walmart — bot check \/ captcha\)/);
  assert.match(msg, /Cheapest: Target — \$189\.99/);
});
