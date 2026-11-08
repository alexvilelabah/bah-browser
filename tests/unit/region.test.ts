// Região/fuso: país de saída da rede, região de compras, fuso escolhido pela pessoa, linha do agente.
import { test } from 'node:test';
import assert from 'node:assert';
import { parseTrace, sanitizeRegion, shoppingCountry, timezoneOverride, regionLine, searchCountryParam, isTimeZone } from '../../src/shared/region.ts';

test('Cloudflare trace → country (unknown and Tor are ignored)', () => {
  assert.strictEqual(parseTrace('fl=1\nip=1.2.3.4\nloc=PT\ntls=TLSv1.3\n'), 'PT');
  assert.strictEqual(parseTrace('loc=XX\n'), '');
  assert.strictEqual(parseTrace('loc=T1\n'), '');
  assert.strictEqual(parseTrace('<html>blocked</html>'), '');
});

test('settings are sanitized; a bad zone or missing country falls back', () => {
  assert.deepStrictEqual(sanitizeRegion({ shopping: 'fixed', fixedCountry: 'de', tz: 'zone', zone: 'Asia/Tokyo', keepTz: 1 }),
    { shopping: 'fixed', fixedCountry: 'DE', tz: 'zone', zone: 'Asia/Tokyo', keepTz: true });
  assert.strictEqual(sanitizeRegion({ tz: 'zone', zone: 'Mars/Olympus' }).tz, 'os');
  assert.strictEqual(sanitizeRegion({ shopping: 'fixed' }).shopping, 'auto');
  assert.strictEqual(sanitizeRegion(null).shopping, 'auto');
  assert.ok(isTimeZone('America/Denver') && !isTimeZone('Nowhere/City') && !isTimeZone(''));
});

test('shopping country and time-zone override', () => {
  const auto = sanitizeRegion({});
  assert.strictEqual(shoppingCountry(auto, 'PT', 'US'), 'PT');
  assert.strictEqual(shoppingCountry(auto, '', 'US'), 'US');
  assert.strictEqual(shoppingCountry(sanitizeRegion({ shopping: 'os' }), 'PT', 'US'), 'US');
  assert.strictEqual(shoppingCountry(sanitizeRegion({ shopping: 'fixed', fixedCountry: 'JP' }), 'PT', 'US'), 'JP');
  assert.strictEqual(timezoneOverride(auto), '');
  assert.strictEqual(timezoneOverride(sanitizeRegion({ tz: 'utc' })), 'UTC');
  assert.strictEqual(timezoneOverride(sanitizeRegion({ tz: 'zone', zone: 'Europe/Lisbon' })), 'Europe/Lisbon');
});

test('agent line names the VPN country and the time zone sites see', () => {
  const l = regionLine(sanitizeRegion({}), 'PT', 'US', 'America/Los_Angeles');
  assert.match(l, /NETWORK LOCATION: Portugal \(PT\)/);
  assert.match(l, /computer's region is United States/);
  assert.match(l, /suggest_time_zone/);
  const t = regionLine(sanitizeRegion({ tz: 'zone', zone: 'Asia/Tokyo' }), 'US', 'US', 'America/Los_Angeles');
  assert.match(t, /sites see Asia\/Tokyo/);
  assert.doesNotMatch(t, /VPN/);
});

test('search country params', () => {
  assert.strictEqual(searchCountryParam('google', 'PT'), 'gl=PT');
  assert.strictEqual(searchCountryParam('bing', 'PT'), 'cc=PT');
  assert.strictEqual(searchCountryParam('google', ''), '');
});
