// Login num site importa SÓ os cookies daquele site — não os de todo ".com.br".
import { test } from 'node:test';
import assert from 'node:assert';
import { makeDomainMatcher, siteOf } from '../../src/main/cookie-domain.ts';

test('siteOf: o site de verdade, inclusive em .com.br e .co.uk', () => {
  assert.strictEqual(siteOf('www.mercadolivre.com.br'), 'mercadolivre.com.br');
  assert.strictEqual(siteOf('lista.mercadolivre.com.br'), 'mercadolivre.com.br');
  assert.strictEqual(siteOf('www.bbc.co.uk'), 'bbc.co.uk');
  assert.strictEqual(siteOf('mail.google.com'), 'google.com');
  assert.strictEqual(siteOf('alex.github.io'), 'alex.github.io');   // cada página do github.io é um site
  assert.strictEqual(siteOf('localhost'), 'localhost');
  assert.strictEqual(siteOf('www.gov.br'), 'www.gov.br');   // gov.br é sufixo público: o site é o www
  assert.strictEqual(siteOf('Loja.Exemplo.COM.br.'), 'exemplo.com.br');
});

test('makeDomainMatcher: www.gov.br não puxa os cookies de todo .gov.br', () => {
  const gov = makeDomainMatcher('www.gov.br');
  assert.strictEqual(gov('www.gov.br'), true);
  assert.strictEqual(gov('.www.gov.br'), true);
  assert.strictEqual(gov('.receita.fazenda.gov.br'), false);
  assert.strictEqual(gov('sso.acesso.gov.br'), false);
});

test('makeDomainMatcher: um site .com.br não puxa os cookies de outro .com.br', () => {
  const ml = makeDomainMatcher('www.mercadolivre.com.br');
  assert.strictEqual(ml('.mercadolivre.com.br'), true);
  assert.strictEqual(ml('auth.mercadolivre.com.br'), true);
  assert.strictEqual(ml('.americanas.com.br'), false);   // era aqui que vazava
  assert.strictEqual(ml('.com.br'), false);
  assert.strictEqual(ml(''), false);
  const g = makeDomainMatcher('mail.google.com');
  assert.strictEqual(g('.google.com'), true);
  assert.strictEqual(g('accounts.google.com'), true);
  assert.strictEqual(g('.youtube.com'), false);
});
