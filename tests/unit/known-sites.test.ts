// Site nomeado → endereço oficial (lista curada); nome desconhecido nunca vira domínio chutado.
import { test } from 'node:test';
import assert from 'node:assert';
import { officialSiteForName, namedOfficialSite, namedSiteHint, officialSitesPromptBlock, userAmazonDomain } from '../../src/renderer/known-sites.ts';

test('name → official domain for the curated sites', () => {
  const want: Record<string, string> = {
    linkedin: 'https://www.linkedin.com/', LinkedIn: 'https://www.linkedin.com/', indeed: 'https://www.indeed.com/',
    github: 'https://github.com/', walmart: 'https://www.walmart.com/', 'Whole Foods': 'https://www.wholefoodsmarket.com/',
    wholefoods: 'https://www.wholefoodsmarket.com/', youtube: 'https://www.youtube.com/', gmail: 'https://mail.google.com/',
    google: 'https://www.google.com/', 'google maps': 'https://www.google.com/maps', 'linkedin.com': 'https://www.linkedin.com/',
  };
  for (const [name, url] of Object.entries(want)) assert.strictEqual(officialSiteForName(name, 'en-US')?.url, url, name);
  assert.strictEqual(officialSiteForName('amazon', 'en-US')?.url, 'https://www.amazon.com/');
  assert.strictEqual(officialSiteForName('amazon', 'pt-BR')?.url, 'https://www.amazon.com.br/');
  assert.strictEqual(userAmazonDomain('en-GB'), 'amazon.co.uk');
});

test('unknown or look-alike names are never guessed', () => {
  for (const name of ['zorblax', 'linkedln', 'walmart store near me', 'wal-mart', 'acme corp', '', 'gooogle'])
    assert.strictEqual(officialSiteForName(name, 'en-US'), null, name);
  assert.strictEqual(namedOfficialSite('browse to zorblax and find a job as a nurse', 'en-US'), null);
  assert.strictEqual(namedSiteHint('go to acmejobs and apply', 'en-US'), '');
});

test('finds the named site inside a command', () => {
  const id = (c: string) => namedOfficialSite(c, 'en-US')?.id ?? null;
  assert.strictEqual(id('browse to linkedin, find a job as a nurse in Seattle'), 'linkedin');
  assert.strictEqual(id('find me a job on indeed'), 'indeed');
  assert.strictEqual(id('compare prices at Whole Foods for oat milk'), 'wholefoods');
  assert.strictEqual(id("check walmart's price for a TV"), 'walmart');
  assert.strictEqual(id('open google maps and find a cafe'), 'googlemaps');   // o mais específico vence
  assert.strictEqual(id('abra o linkedin e procure vagas'), 'linkedin');
  assert.strictEqual(id('busca trabajo en indeed'), 'indeed');
  assert.strictEqual(id('shop at target for a lamp'), 'target');
});

test('ambiguous names need a navigation cue; words inside other words do not count', () => {
  const id = (c: string) => namedOfficialSite(c, 'en-US')?.id ?? null;
  assert.strictEqual(id('this is indeed the best laptop'), null);
  assert.strictEqual(id('what is my target heart rate'), null);
  assert.strictEqual(id('click on x to close the popup'), null);
  assert.strictEqual(id('the outlook for the market'), null);
  assert.strictEqual(id('open the mylinkedinclone app'), null);
  assert.strictEqual(id('email me at bob@walmart'), null);
});

test('prompt block and first-step hint', () => {
  const block = officialSitesPromptBlock('en-US');
  assert.match(block, /never web_search its name/);
  assert.match(block, /linkedin: https:\/\/www\.linkedin\.com\//);
  assert.match(block, /wholefoods: https:\/\/www\.wholefoodsmarket\.com\//);
  const hint = namedSiteHint('browse to linkedin, find a job', 'en-US');
  assert.match(hint, /^NAMED SITE: the user named LinkedIn; its official address is https:\/\/www\.linkedin\.com\//);
  assert.match(hint, /do NOT web_search/);
});
