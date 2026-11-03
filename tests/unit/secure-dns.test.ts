// DNS seguro (DoH): configuração da pessoa → parâmetros do app.configureHostResolver.
import { test } from 'node:test';
import assert from 'node:assert';
import { resolveSecureDns, parseNextDnsId, validateDohTemplate, SECURE_DNS_PRESETS, SYSTEM_RESOLVER } from '../../src/shared/secure-dns.ts';

test('system (default) = Chromium defaults: automatic, no servers', () => {
  const r = resolveSecureDns({ mode: 'system', strict: true, preset: 'quad9' });
  assert.deepStrictEqual(r, { setting: { mode: 'system' }, config: { secureDnsMode: 'automatic', secureDnsServers: [] } });
  assert.deepStrictEqual(SYSTEM_RESOLVER, { secureDnsMode: 'automatic', secureDnsServers: [] });
});

test('presets map to their documented DoH endpoints; none needs signup or lets you manage lists', () => {
  const want: Record<string, string> = {
    adguard: 'https://dns.adguard-dns.com/dns-query',
    'mullvad-adblock': 'https://adblock.dns.mullvad.net/dns-query',
    quad9: 'https://dns.quad9.net/dns-query',
    cloudflare: 'https://cloudflare-dns.com/dns-query',
  };
  assert.strictEqual(SECURE_DNS_PRESETS.length, 4);
  for (const p of SECURE_DNS_PRESETS) {
    const r = resolveSecureDns({ mode: 'preset', preset: p.id });
    assert.strictEqual(r.error, undefined);
    assert.deepStrictEqual(r.config, { secureDnsMode: 'automatic', secureDnsServers: [want[p.id]] });
    assert.deepStrictEqual(r.setting, { mode: 'preset', preset: p.id, strict: false });
    assert.strictEqual(p.signup, false); assert.strictEqual(p.userManagedLists, false);
  }
  assert.deepStrictEqual(SECURE_DNS_PRESETS.filter(p => p.adBlocking).map(p => p.id), ['adguard', 'mullvad-adblock']);
});

test('strict → secure (no fallback to plain DNS); off → automatic', () => {
  assert.strictEqual(resolveSecureDns({ mode: 'preset', preset: 'adguard', strict: true }).config.secureDnsMode, 'secure');
  assert.strictEqual(resolveSecureDns({ mode: 'preset', preset: 'adguard', strict: false }).config.secureDnsMode, 'automatic');
  assert.strictEqual(resolveSecureDns({ mode: 'preset', preset: 'adguard', strict: 'yes' as any }).config.secureDnsMode, 'automatic');
  assert.strictEqual(resolveSecureDns({ mode: 'nextdns', nextdnsId: 'abc123', strict: true }).config.secureDnsMode, 'secure');
  assert.strictEqual(resolveSecureDns({ mode: 'custom', customUrl: 'https://pi.hole/dns-query', strict: true }).config.secureDnsMode, 'secure');
});

test('NextDNS: bare ID or full dns.nextdns.io URL', () => {
  assert.strictEqual(parseNextDnsId('abc123'), 'abc123');
  assert.strictEqual(parseNextDnsId('  ABC123 '), 'abc123');
  assert.strictEqual(parseNextDnsId('https://dns.nextdns.io/abc123'), 'abc123');
  assert.strictEqual(parseNextDnsId('https://dns.nextdns.io/abc123/'), 'abc123');
  for (const bad of ['', 'abc12', 'abc1234', 'xyz123', 'http://dns.nextdns.io/abc123', 'https://evil.example/abc123',
    'https://dns.nextdns.io/abc123?x=1', 'https://dns.nextdns.io/', 'https://dns.nextdns.io/abc123/extra', 'abc123.dns.nextdns.io'])
    assert.strictEqual(parseNextDnsId(bad), null, bad);
  const r = resolveSecureDns({ mode: 'nextdns', nextdnsId: 'https://dns.nextdns.io/0f9E2a' });
  assert.deepStrictEqual(r, { setting: { mode: 'nextdns', nextdnsId: '0f9e2a', strict: false }, config: { secureDnsMode: 'automatic', secureDnsServers: ['https://dns.nextdns.io/0f9e2a'] } });
});

test('custom: https only, {?dns} template allowed, LAN hosts and ports fine', () => {
  for (const ok of ['https://pihole.lan/dns-query', 'https://192.168.1.2:3443/dns-query', 'https://dns.example/dns-query{?dns}', '  https://adguard.home/dns-query  '])
    assert.ok(validateDohTemplate(ok).ok, ok);
  assert.deepStrictEqual(resolveSecureDns({ mode: 'custom', customUrl: ' https://dns.example/dns-query{?dns} ' }).config,
    { secureDnsMode: 'automatic', secureDnsServers: ['https://dns.example/dns-query{?dns}'] });
  for (const bad of ['', 'http://pihole.lan/dns-query', 'pihole.lan/dns-query', 'not a url', 'ftp://x/dns', 'https://', 'https://u:p@dns.example/dns-query',
    'https://dns.example/{name}', 'https://dns.example/dns-query{?dns}#x', 'javascript:alert(1)'])
    assert.strictEqual(validateDohTemplate(bad).ok, false, bad);
});

test('bad input falls back to system with an error', () => {
  for (const bad of [null, undefined, 'adguard', {}, { mode: 'vpn' }, { mode: 'preset', preset: 'opendns' }, { mode: 'preset' },
    { mode: 'nextdns', nextdnsId: 'nope' }, { mode: 'nextdns' }, { mode: 'custom', customUrl: 'http://x/dns-query' }, { mode: 'custom' }]) {
    const r = resolveSecureDns(bad);
    assert.ok(r.error, JSON.stringify(bad));
    assert.deepStrictEqual(r.setting, { mode: 'system' });
    assert.deepStrictEqual(r.config, { secureDnsMode: 'automatic', secureDnsServers: [] });
  }
});
