// Expansão do pedido pelo roteador local: quando entra, o prompt e a conferência da saída (lixo,
// longa demais, sem as palavras-chave, intenção mudada → vale o original).
import { test } from 'node:test';
import assert from 'node:assert';
import { shouldExpandRequest, buildExpandSystemPrompt, buildExpandUserMessage, parseExpansion, checkExpansion, validateExpansion, keyTerms, understoodNote, EXPAND_JSON_SCHEMA } from '../../src/shared/request-expansion.ts';

const TOP = 'find all the music videos from the movie top gun with tom cruise and download them';
const GOOD = 'find all the music videos from the soundtrack of the 1986 film Top Gun (Tom Cruise), not Top Gun: Maverick (2022), and download them';

test('gate: find/download requests about a named work expand; plain commands do not', () => {
  for (const c of [TOP, 'download every song from the lion king soundtrack', 'find all the music videos from top gun with tom cruise',
    'baixe todas as músicas da trilha sonora de titanic', 'descarga todas las canciones del álbum thriller', 'download the dune soundtrack'])
    assert.ok(shouldExpandRequest(c), c);
  for (const c of ['open gmail', 'click the submit button', 'hello!', 'what is the capital of australia?', 'download the vlc installer',
    'download this video https://www.youtube.com/watch?v=abc from the page', 'log in to my bank', 'abra o g1 e me diga as notícias'])
    assert.ok(!shouldExpandRequest(c), c);
});

test('prompt: fixed prefix with the rules, examples that are not the Top Gun case, and a capped user line', () => {
  const sys = buildExpandSystemPrompt();
  assert.match(sys, /ONLY adding disambiguation/);
  assert.match(sys, /never list songs/i);
  assert.match(sys, /\{"understood":/);
  assert.ok(!/top gun/i.test(sys), 'the measured case is not in the examples');
  assert.equal(buildExpandUserMessage('  find   x '), 'Request: find x');
  assert.ok(buildExpandUserMessage('a'.repeat(1000)).length <= 'Request: '.length + 300);
  assert.deepEqual(EXPAND_JSON_SCHEMA.required, ['understood']);
});

test('parse: JSON, bare text, quotes', () => {
  assert.equal(parseExpansion('{"understood": " the  1986 film "}'), 'the 1986 film');
  assert.equal(parseExpansion('"just text"'), 'just text');
  assert.equal(parseExpansion({ understood: 'x y' }), 'x y');
  assert.equal(parseExpansion(42), '');
  assert.equal(parseExpansion('{"route": "x"}'), '');
});

test('key terms keep the work, the people, the media and the quantity; drop verbs and function words', () => {
  assert.deepEqual(keyTerms(TOP), ['all', 'music', 'videos', 'movie', 'top', 'gun', 'tom', 'cruise']);
});

test('accepts a disambiguation that keeps the request', () => {
  assert.equal(validateExpansion(TOP, `{"understood": "${GOOD}"}`), GOOD);
  // typo fixed by the model ("cruse" → "Cruise") and movie → film still count as the same words
  assert.ok(validateExpansion('download all the songs from the movie top gun with tom cruse', 'download all the songs from the 1986 film Top Gun with Tom Cruise'));
  assert.ok(validateExpansion('baixe todas as músicas da trilha sonora de titanic', 'baixe todas as músicas da trilha sonora do filme Titanic (1997)'));
  // a composer the user never named is a new name → original wins
  assert.equal(validateExpansion('baixe todas as músicas da trilha sonora de titanic', 'baixe todas as músicas da trilha sonora do filme Titanic (1997, James Horner)'), null);
});

test('falls back on junk, too long, missing key nouns, changed intent', () => {
  const why = (raw: string) => { const v = checkExpansion(TOP, raw); return v.ok ? 'ok' : v.reason; };
  assert.equal(why(''), 'empty');
  assert.equal(why('{"understood": ""}'), 'empty');
  assert.equal(why(TOP), 'same');
  assert.equal(why('{"understood": "Find all the music videos from the movie Top Gun with Tom Cruise and download them."}'), 'same');
  assert.equal(why('Sorry, I cannot help with that request about Top Gun music videos movie all tom cruise'), 'junk');
  assert.equal(why('{"understood": "find all the music videos from the 1986 film Top Gun'), 'junk');   // cut mid-JSON
  assert.notEqual(why('all music videos movie top gun tom cruise: 1. Danger Zone\n2. Take My Breath Away'), 'ok');   // a track list
  assert.equal(why(GOOD + ' ' + 'with extra words '.repeat(20)), 'too-long');
  assert.equal(why('find all the music videos from the 1986 film Top Gun'), 'missing-terms');   // dropped Tom Cruise
  assert.equal(why('find all the music videos from the 2022 film Top Gun: Maverick'), 'missing-terms');
  assert.equal(why('find all the music videos from the 1986 film Top Gun (Tom Cruise) and buy them'), 'new-action');
  assert.equal(why('find all the music videos from the 1986 film Top Gun (Tom Cruise) and play them'), 'new-action');
  assert.equal(why('find all the music videos from the 1986 film Top Gun (Tom Cruise) and email them'), 'new-action');
  assert.equal(why('find 5 music videos (all) from the 1986 film Top Gun (Tom Cruise)'), 'new-number');
  assert.equal(why('find all the music videos from the 1986 film Top Gun (Tom Cruise) on youtube.com'), 'new-site');
  assert.equal(validateExpansion(TOP, 'nonsense'), null);
});

test('the note for the big model carries the expansion and says the original wins', () => {
  assert.equal(understoodNote(''), '');
  const n = understoodNote(GOOD);
  assert.match(n, /^\nUNDERSTOOD AS/);
  assert.match(n, /GOAL wins/);
  assert.ok(n.endsWith(GOOD));
});

test('a new name (album, artist, work) is rejected: it narrows or changes the request', () => {
  const mj = "Find Michael Jackson's most famous songs and download all of their music videos, just the top 3";
  assert.deepStrictEqual(checkExpansion(mj, mj + ' songs from his 1982 album Thriller'), { ok: false, reason: 'new-name' });
  assert.deepStrictEqual(checkExpansion('download all the music videos from the album bad', 'download all the music videos from the album Bad by The Beatles'), { ok: false, reason: 'new-name' });
  // the year and capitalising the user's own words are fine; an exclusion may name the other work
  assert.ok(checkExpansion(TOP, 'find all the music videos from the movie Top Gun (1986) featuring Tom Cruise, download them').ok);
  assert.ok(checkExpansion(TOP, GOOD).ok);
});
