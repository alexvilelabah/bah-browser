// Proxy: conversão da config da pessoa pro formato do Electron + leitura do ambiente.
import { test } from 'node:test';
import assert from 'node:assert';
import { toElectronProxy, configFromEnv } from '../../src/main/proxy-config.ts';

test('system, direct and PAC modes', () => {
  assert.deepStrictEqual(toElectronProxy({ mode: 'system' }), { mode: 'system' });
  assert.deepStrictEqual(toElectronProxy({ mode: 'direct' }), { mode: 'direct' });
  assert.deepStrictEqual(toElectronProxy({ mode: 'pac', pacUrl: 'http://wpad/wpad.dat', bypass: 'localhost, *.corp' }),
    { mode: 'pac_script', pacScript: 'http://wpad/wpad.dat', proxyBypassRules: 'localhost,*.corp' });
});

test('manual: host:port covers http and https; scheme or rules pass through (socks5 for ssh -D tunnels)', () => {
  assert.strictEqual(toElectronProxy({ mode: 'manual', server: 'proxy.corp:8080' }).proxyRules, 'http=proxy.corp:8080;https=proxy.corp:8080');
  assert.strictEqual(toElectronProxy({ mode: 'manual', server: 'socks5://127.0.0.1:1080' }).proxyRules, 'socks5://127.0.0.1:1080');
  assert.strictEqual(toElectronProxy({ mode: 'manual', server: 'http=a:80;https=b:443' }).proxyRules, 'http=a:80;https=b:443');
  assert.deepStrictEqual(toElectronProxy({ mode: 'manual' }), { mode: 'system' });   // incomplete → stay on system
});

test('environment variables pre-configure a manual proxy', () => {
  assert.deepStrictEqual(configFromEnv({ HTTPS_PROXY: 'http://bluecoat:8080', NO_PROXY: 'localhost,.corp' } as any),
    { mode: 'manual', server: 'http://bluecoat:8080', bypass: 'localhost,.corp' });
  assert.strictEqual(configFromEnv({} as any), null);
});
