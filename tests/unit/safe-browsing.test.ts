import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHostsList } from '../../src/shared/safe-browsing.ts';

test('lê o formato hosts, com comentário, CRLF e maiúsculas', () => {
  const hosts = parseHostsList('# lista\n0.0.0.0 mau.example.com\r\n127.0.0.1\tOutro.Example.org\n\n');
  assert.deepEqual([...hosts].sort(), ['mau.example.com', 'outro.example.org']);
});

test('página de erro ou texto solto não vira lista', () => {
  assert.equal(parseHostsList('<html><body>410 Gone</body></html>\nnot found\n').size, 0);
  assert.equal(parseHostsList('google.com\nexample.com\n').size, 0);
});

test('ignora o que não é site', () => {
  assert.equal(parseHostsList('0.0.0.0 localhost\n0.0.0.0 0.0.0.0 extra\n0.0.0.0 <script>.com\n').size, 0);
});
