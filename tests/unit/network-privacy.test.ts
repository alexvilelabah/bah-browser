// ⋮ → Rede: política de WebRTC, versão de IP e avisos de vazamento.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  webRtcPolicyFor, webRtcFieldTrials, sanitizeNetworkPrefs, literalFamily, isLoopback, proxyHost, urlHost, machineFamilies,
  leakWarnings, IP_FAMILY_SUPPORT, DEFAULT_NETWORK_PREFS, type LeakInput,
} from '../../src/shared/network-privacy.ts';

test('WebRTC policy: protect → proxy-only UDP with a proxy, public interface only without; override → default', () => {
  const p = DEFAULT_NETWORK_PREFS;
  assert.strictEqual(webRtcPolicyFor(p, true), 'disable_non_proxied_udp');
  assert.strictEqual(webRtcPolicyFor(p, false), 'default_public_interface_only');
  assert.strictEqual(webRtcPolicyFor({ ...p, webrtc: 'default' }, true), 'default');
  assert.strictEqual(webRtcPolicyFor({ ...p, webrtc: 'default' }, false), 'default');
});

test('prefs: defaults and sanitising; IPv4-only WebRTC is a boot field trial', () => {
  assert.deepStrictEqual(sanitizeNetworkPrefs(null), { webrtc: 'protect', webrtcIpv4Only: false });
  assert.deepStrictEqual(sanitizeNetworkPrefs({ webrtc: 'weird', webrtcIpv4Only: 'yes' }), { webrtc: 'protect', webrtcIpv4Only: false });
  assert.deepStrictEqual(sanitizeNetworkPrefs({ webrtc: 'default', webrtcIpv4Only: true }), { webrtc: 'default', webrtcIpv4Only: true });
  assert.strictEqual(webRtcFieldTrials(DEFAULT_NETWORK_PREFS), null);
  assert.strictEqual(webRtcFieldTrials({ webrtc: 'protect', webrtcIpv4Only: true }), 'WebRTC-IPv6Default/Disabled/');
  assert.deepStrictEqual(IP_FAMILY_SUPPORT, { auto: true, v4: false, v6: false });   // measured on Electron 44
});

test('address families of literals, loopback, proxy and DoH hosts', () => {
  assert.strictEqual(literalFamily('192.168.1.10'), '4');
  assert.strictEqual(literalFamily('[2001:db8::1]'), '6');
  assert.strictEqual(literalFamily('fe80::1%en0'), '6');
  assert.strictEqual(literalFamily('999.1.1.1'), null);
  assert.strictEqual(literalFamily('proxy.corp'), null);
  assert.ok(isLoopback('127.0.0.1') && isLoopback('::1') && isLoopback('localhost') && !isLoopback('10.0.0.1'));
  assert.strictEqual(proxyHost('proxy.corp:8080'), 'proxy.corp');
  assert.strictEqual(proxyHost('socks5://192.168.1.10:1080'), '192.168.1.10');
  assert.strictEqual(proxyHost('http=a.corp:80;https=a.corp:443'), 'a.corp');
  assert.strictEqual(proxyHost('http://[2001:db8::5]:3128'), '2001:db8::5');
  assert.strictEqual(proxyHost(''), null);
  assert.strictEqual(urlHost('https://192.168.1.2/dns-query'), '192.168.1.2');
  assert.strictEqual(urlHost('https://[2001:db8::53]/dns-query{?dns}'), '2001:db8::53');
  assert.strictEqual(urlHost('nope'), null);
});

test('machine families ignore loopback, link-local and ULA; only families leave this function', () => {
  const ifaces = {
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }, { family: 'IPv6', address: '::1', internal: true }],
    en0: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '192.168.1.5', internal: false }],
    utun0: [{ family: 'IPv6', address: 'fd00::5', internal: false }],
  };
  assert.deepStrictEqual(machineFamilies(ifaces), { v4: true, v6: false });
  assert.deepStrictEqual(machineFamilies({ en0: [{ family: 6, address: '2a01:4f8::2', internal: false }, { family: 'IPv4', address: '169.254.3.3', internal: false }] }), { v4: false, v6: true });
});

const base: LeakInput = { proxyActive: false, proxyFamilies: null, dnsActive: false, dnsFamilies: null, webrtc: 'protect', ipFamily: 'auto', machine: { v4: true, v6: true } };

test('no warnings when nothing is configured', () => {
  assert.deepStrictEqual(leakWarnings(base), []);
  assert.deepStrictEqual(leakWarnings({ ...base, webrtc: 'default' }), []);   // no proxy to bypass
});

test('IPv4-only proxy on a dual-stack machine → family warning with the OS-settings fix', () => {
  assert.deepStrictEqual(leakWarnings({ ...base, proxyActive: true, proxyFamilies: ['4'] }),
    [{ id: 'family-proxy', level: 'warn', family: '4', other: '6', fix: 'os-settings' }]);
  assert.deepStrictEqual(leakWarnings({ ...base, proxyActive: true, proxyFamilies: ['6'] }),
    [{ id: 'family-proxy', level: 'warn', family: '6', other: '4', fix: 'os-settings' }]);
  // machine has no IPv6 → nothing to leak through; proxy reachable over both / unknown → no warning
  assert.deepStrictEqual(leakWarnings({ ...base, proxyActive: true, proxyFamilies: ['4'], machine: { v4: true, v6: false } }), []);
  assert.deepStrictEqual(leakWarnings({ ...base, proxyActive: true, proxyFamilies: ['4', '6'] }), []);
  assert.deepStrictEqual(leakWarnings({ ...base, proxyActive: true, proxyFamilies: null }), []);
  assert.deepStrictEqual(leakWarnings({ ...base, proxyActive: true, proxyFamilies: ['4'], ipFamily: 'v4' }), []);
});

test('secure DNS: single-family server warns; behind a proxy is informational', () => {
  assert.deepStrictEqual(leakWarnings({ ...base, dnsActive: true, dnsFamilies: ['4', '4'] }),
    [{ id: 'family-dns', level: 'warn', family: '4', other: '6', fix: 'os-settings' }]);
  assert.deepStrictEqual(leakWarnings({ ...base, dnsActive: true, dnsFamilies: ['4', '6'], proxyActive: true }),
    [{ id: 'dns-behind-proxy', level: 'info' }]);
});

test('proxy + WebRTC override → bypass warning with a one-click fix', () => {
  assert.deepStrictEqual(leakWarnings({ ...base, proxyActive: true, webrtc: 'default' }),
    [{ id: 'webrtc-bypass', level: 'warn', fix: 'protect-webrtc' }]);
});
