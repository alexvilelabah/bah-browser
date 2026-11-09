// Raízes do SO pro Node: extrai os PEMs e adiciona às raízes padrão sem duplicar.
import { test } from 'node:test';
import assert from 'node:assert';
import * as tls from 'node:tls';
import { parsePems, installCAs, loadSystemCAs } from '../../src/main/system-ca.ts';

test('parsePems pulls every certificate block out of mixed text', () => {
  const a = tls.rootCertificates[0], b = tls.rootCertificates[1];
  const text = `keychain: "x"\r\n${a.replace(/\n/g, '\r\n')}\nattributes...\n${b}\n`;
  assert.deepStrictEqual(parsePems(text), [a.trim(), b.trim()]);
  assert.deepStrictEqual(parsePems('no certs here'), []);
});

test('installCAs adds only certificates Node does not already have', () => {
  if (typeof (tls as any).setDefaultCACertificates !== 'function') return;   // older Node: nothing to test
  const already = tls.rootCertificates[0];
  assert.strictEqual(installCAs([already]), 0);
});

test('the OS store can be read on this machine', async () => {
  const pems = await loadSystemCAs();
  assert.ok(pems.length > 10, `expected the OS root store, got ${pems.length}`);
});
