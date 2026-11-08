// Classificador genérico de "a página quer uma PESSOA" (shared/human-check.ts): checagem de robô de
// qualquer estilo e parede de login — por sinais (frames de provedores, ids/classes, título, texto),
// nunca por site. Fixtures: Target (press & hold por cima da página longa), Walmart, Cloudflare,
// reCAPTCHA checkbox, e o contra-exemplo "robot vacuum".
import { test } from 'node:test';
import assert from 'node:assert';
import { classifyHumanCheck, humanCheckCleared, HUMAN_CHECK_SIGNALS_JS } from '../../src/shared/human-check.ts';

const longProduct = 'Apple AirPods Pro 3\n$249.99\nAdd to cart\n' + 'Product details and specifications. '.repeat(400);

test('Target: "Quick verification / Press & hold" drawn over a long product page', () => {
  const v = classifyHumanCheck({ url: 'https://www.target.com/p/apple-airpods-pro-3/-/A-85978609', title: 'Apple AirPods Pro 3 : Target',
    text: `${longProduct}\nQuick verification\nPress & hold to confirm you're a human (and not a bot).` });
  assert.strictEqual(v?.kind, 'captcha');
  // Same page, the overlay only seen through its element (text not yet rendered).
  const m = classifyHumanCheck({ url: 'https://www.target.com/p/x', title: 'Target', text: longProduct, markers: ['px-captcha'] });
  assert.deepStrictEqual([m?.kind, m?.provider], ['captcha', 'perimeterx']);
});

test('Walmart "Robot or human?"', () => {
  const v = classifyHumanCheck({ url: 'https://www.walmart.com/blocked?url=L3NlYXJjaA==', title: 'Robot or human?',
    text: "Robot or human?\nActivate and hold the button to confirm that you're human. Thank You!\nPress & Hold", markers: ['px-captcha'] });
  assert.strictEqual(v?.kind, 'captcha');
});

test('Cloudflare "Just a moment…" interstitial', () => {
  const v = classifyHumanCheck({ url: 'https://www.example-shop.com/search?q=tv', title: 'Just a moment...',
    text: 'www.example-shop.com\nVerify you are human by completing the action below.\nwww.example-shop.com needs to review the security of your connection before proceeding.',
    frames: ['https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/abc/managed/light/normal'], markers: ['challenge-running'] });
  assert.strictEqual(v?.kind, 'captcha');
  // Title only (frame not visible yet).
  assert.strictEqual(classifyHumanCheck({ url: 'https://a.com/', title: 'Just a moment...', text: 'Checking your browser before accessing a.com.' })?.kind, 'captcha');
});

test('reCAPTCHA checkbox iframe on a gate page; image puzzle frame anywhere', () => {
  const v = classifyHumanCheck({ url: 'https://shop.example/verify', title: 'shop.example', text: 'Please complete the security check to continue.',
    frames: ['https://www.google.com/recaptcha/api2/anchor?ar=1&k=6Lc&co=aHR0&hl=en&v=x&size=normal&cb=1'], markers: ['g-recaptcha'] });
  assert.deepStrictEqual([v?.kind, v?.provider], ['captcha', 'recaptcha']);
  // The image puzzle (bframe) open over any page.
  assert.strictEqual(classifyHumanCheck({ url: 'https://shop.example/p', title: 'Shop', text: longProduct, frames: ['https://www.google.com/recaptcha/api2/bframe?hl=en&v=x&k=6Lc'] })?.kind, 'captcha');
  // Other providers by frame.
  assert.strictEqual(classifyHumanCheck({ url: 'https://a.com/', title: 'a', text: longProduct, frames: ['https://client-api.arkoselabs.com/fc/gc/?token=1'] })?.provider, 'arkose');
  assert.strictEqual(classifyHumanCheck({ url: 'https://a.com/', title: 'a', text: 'x', frames: ['https://geo.captcha-delivery.com/captcha/?initialCid=1'] })?.provider, 'datadome');
  assert.strictEqual(classifyHumanCheck({ url: 'https://a.com/', title: 'a', text: longProduct, frames: ['https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=challenge&id=1'] })?.provider, 'hcaptcha');
});

test('NOT a check: results page mentioning "robot vacuum", newsletter reCAPTCHA, invisible v3 badge, articles', () => {
  const results = 'Results\n' + Array.from({ length: 60 }, (_, i) => `iRobot Roomba robot vacuum ${i}\n$${199 + i}.99`).join('\n');
  assert.strictEqual(classifyHumanCheck({ url: 'https://www.amazon.com/s?k=robot+vacuum', title: 'Amazon.com : robot vacuum', text: results }), null);
  // Optional form with a reCAPTCHA widget on a content page (AnyDesk "thank you" page).
  assert.strictEqual(classifyHumanCheck({ url: 'https://anydesk.com/en/downloads/thank-you', title: 'Thank you for downloading AnyDesk', text: longProduct,
    frames: ['https://www.google.com/recaptcha/api2/anchor?ar=1&k=6Lc&size=normal'], markers: ['g-recaptcha'] }), null);
  // reCAPTCHA v3 badge (size=invisible) on a short page.
  assert.strictEqual(classifyHumanCheck({ url: 'https://a.com/contact', title: 'Contact us', text: 'Contact us. Write to us and we answer in a day. Name, email, message, send.',
    frames: ['https://www.google.com/recaptcha/api2/anchor?ar=1&k=6Lc&size=invisible&cb=1'] }), null);
  // An article about captchas is not a captcha.
  assert.strictEqual(classifyHumanCheck({ url: 'https://news.example/captcha-history', title: 'The strange history of CAPTCHA', text: 'CAPTCHA was invented in 2000. Just a moment of history. '.repeat(80) }), null);
  assert.strictEqual(classifyHumanCheck({ url: 'about:blank', title: 'Just a moment...', text: '' }), null);
});

test('sign-in walls: login address, "sign in to continue", password field on a short page', () => {
  assert.strictEqual(classifyHumanCheck({ url: 'https://www.amazon.com/ap/signin?openid=1', title: 'Amazon Sign-In', text: 'Sign in Email or mobile phone number Continue' })?.kind, 'signin');
  assert.strictEqual(classifyHumanCheck({ url: 'https://shop.example/account', title: 'Account', text: 'Please sign in to continue to your orders.' })?.kind, 'signin');
  assert.strictEqual(classifyHumanCheck({ url: 'https://shop.example/x', title: 'Shop', text: 'Welcome back. Email Password Forgot password?', passwordField: true })?.kind, 'signin');
  // A long homepage with a small login box in the header is not a wall.
  assert.strictEqual(classifyHumanCheck({ url: 'https://forum.example/', title: 'Forum', text: longProduct, passwordField: true }), null);
  // A human check wins over the sign-in address.
  assert.strictEqual(classifyHumanCheck({ url: 'https://shop.example/login', title: 'Robot or human?', text: 'Press & Hold' })?.kind, 'captcha');
});

test('cleared: classifier sees nothing any more; unclassified entry needs a new address; loading page never clears', () => {
  const entry = { url: 'https://www.walmart.com/blocked?u=1', verdict: { kind: 'captcha' as const, why: 'x' } };
  assert.strictEqual(humanCheckCleared(entry, { url: 'https://www.walmart.com/blocked?u=1', title: 'Robot or human?', text: 'Robot or human? Activate and hold the button to confirm that you are human.' }), false);
  assert.strictEqual(humanCheckCleared(entry, { url: 'https://www.walmart.com/search?q=airpods', title: '', text: '' }), false);
  assert.strictEqual(humanCheckCleared(entry, { url: 'https://www.walmart.com/search?q=airpods', title: 'airpods - Walmart.com', text: longProduct }), true);
  const unclassified = { url: 'https://site.example/account', verdict: null };
  assert.strictEqual(humanCheckCleared(unclassified, { url: 'https://site.example/account', title: 'Account', text: longProduct }), false);
  assert.strictEqual(humanCheckCleared(unclassified, { url: 'https://site.example/orders', title: 'Orders', text: longProduct }), true);
});

test('the signals script is a passive read (no clicks, focus, scroll or events) and parses', () => {
  new Function(`return ${HUMAN_CHECK_SIGNALS_JS}`);
  assert.doesNotMatch(HUMAN_CHECK_SIGNALS_JS, /\.click\(|\.focus\(|scroll|dispatchEvent|addEventListener|\.submit\(|\.value\s*=|postMessage|contentWindow|contentDocument/);
});
