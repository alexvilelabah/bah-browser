// Identidade Chrome: UA, sec-ch-ua e navigator.userAgentData saem da mesma fonte e concordam entre si.
import { test } from 'node:test';
import assert from 'node:assert';
import { chromeIdentity, userAgentOverrideParams, sendsClientHints, orderChromeHeaders, CURRENT_CHROME_MAJOR } from '../../src/main/chrome-identity.ts';

test('version: the current Chrome major in the reduced NNN.0.0.0 format, never older than the engine', () => {
  const older = chromeIdentity({ engineChrome: '148.0.7778.271', platform: 'win32', arch: 'x64' });
  assert.strictEqual(older.major, String(CURRENT_CHROME_MAJOR));
  assert.strictEqual(older.version, `${CURRENT_CHROME_MAJOR}.0.0.0`);
  assert.ok(!older.userAgent.includes('7778'), 'the full engine build number is never sent');
  const newer = chromeIdentity({ engineChrome: `${CURRENT_CHROME_MAJOR + 3}.0.1.2`, platform: 'win32', arch: 'x64' });
  assert.strictEqual(newer.version, `${CURRENT_CHROME_MAJOR + 3}.0.0.0`);
});

test('user agent and platform hints follow the real OS', () => {
  const win = chromeIdentity({ engineChrome: '148.0.0.0', platform: 'win32', arch: 'x64' });
  assert.match(win.userAgent, /^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
  assert.deepStrictEqual([win.chPlatform, win.navigatorPlatform], ['Windows', 'Win32']);
  const mac = chromeIdentity({ engineChrome: '148.0.0.0', platform: 'darwin', arch: 'arm64' });
  assert.match(mac.userAgent, /\(Macintosh; Intel Mac OS X 10_15_7\)/);   // Chrome keeps "Intel" even on Apple silicon
  assert.deepStrictEqual([mac.chPlatform, mac.navigatorPlatform, mac.architecture], ['macOS', 'MacIntel', 'arm']);
  const linux = chromeIdentity({ engineChrome: '148.0.0.0', platform: 'linux', arch: 'x64' });
  assert.match(linux.userAgent, /\(X11; Linux x86_64\)/);
  assert.deepStrictEqual([linux.chPlatform, linux.architecture, linux.bitness], ['Linux', 'x86', '64']);
  // x64 build running under Rosetta: the hardware is ARM.
  assert.strictEqual(chromeIdentity({ platform: 'darwin', arch: 'x64', arm64Translation: true }).architecture, 'arm');
});

test('sec-ch-ua header lists the same brands, in the same order, as navigator.userAgentData', () => {
  const id = chromeIdentity({ engineChrome: '148.0.0.0', platform: 'darwin', arch: 'arm64' });
  const m = id.major;
  assert.strictEqual(id.secChUa, `"Not:A-Brand";v="8", "Chromium";v="${m}", "Google Chrome";v="${m}"`);
  const p = userAgentOverrideParams(id, ['en-US', 'en'], '26.1');
  assert.strictEqual(p.userAgent, id.userAgent);
  assert.strictEqual(p.acceptLanguage, 'en-US,en');
  assert.strictEqual(p.platform, 'MacIntel');
  assert.strictEqual(p.userAgentMetadata.brands.map(b => `"${b.brand}";v="${b.version}"`).join(', '), id.secChUa);
  assert.deepStrictEqual(p.userAgentMetadata.fullVersionList.map(b => b.version), ['8.0.0.0', `${m}.0.0.0`, `${m}.0.0.0`]);
  assert.strictEqual(p.userAgentMetadata.platform, 'macOS');
  assert.strictEqual(p.userAgentMetadata.platformVersion, '26.1');
  assert.strictEqual(p.userAgentMetadata.mobile, false);
});

test('client hints only on secure origins (https, localhost), like Chrome', () => {
  assert.ok(sendsClientHints('https://example.com/'));
  assert.ok(sendsClientHints('http://localhost:3000/x'));
  assert.ok(sendsClientHints('http://127.0.0.1:8080/'));
  assert.ok(!sendsClientHints('http://example.com/'));
  assert.ok(!sendsClientHints('http://localhost.evil.com/'));
});

test('headers are put in Chrome order; unknown ones keep their order at the end', () => {
  const out = orderChromeHeaders({
    'X-Custom': '1', 'Accept-Language': 'en', 'User-Agent': 'ua', 'sec-ch-ua': 'b', Accept: '*/*', 'sec-ch-ua-platform': '"macOS"', 'X-Other': '2', 'sec-ch-ua-mobile': '?0',
  });
  assert.deepStrictEqual(Object.keys(out), ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'User-Agent', 'Accept', 'Accept-Language', 'X-Custom', 'X-Other']);
  assert.strictEqual(out['User-Agent'], 'ua');
});
