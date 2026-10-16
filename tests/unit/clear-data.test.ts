import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_RANGES, isTimeRange, rangeSince, inRange, splitHistory, originsVisited, keepDownloads,
  webOrigin, sanitizeClearRequest, planClear, extensionOrigins, SITE_DATA_TYPES, MAX_ORIGINS,
} from '../../src/shared/clear-data.ts';

// "Limpar dados de navegação": período, o que sai do histórico e o que vai pro session.clearData.

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const H = 3_600_000;
const EXT_A = 'a'.repeat(32);
const EXT_B = 'abcdefghijklmnopabcdefghijklmnop';

test('período: os 5 do Chrome, nessa ordem', () => {
  assert.deepEqual([...TIME_RANGES], ['hour', 'day', 'week', 'month', 'all']);
  assert.ok(isTimeRange('week'));
  assert.ok(!isTimeRange('year'));
  assert.ok(!isTimeRange(undefined));
});

test('período: "a partir de quando" de cada opção (4 semanas = 28 dias)', () => {
  assert.equal(rangeSince('hour', NOW), NOW - H);
  assert.equal(rangeSince('day', NOW), NOW - 24 * H);
  assert.equal(rangeSince('week', NOW), NOW - 7 * 24 * H);
  assert.equal(rangeSince('month', NOW), NOW - 28 * 24 * H);
  assert.equal(rangeSince('all', NOW), -Infinity);
});

test('período: a borda exata entra (>=), um ms antes fica', () => {
  const since = rangeSince('hour', NOW);
  assert.equal(inRange(since, since), true);
  assert.equal(inRange(since - 1, since), false);
  assert.equal(inRange(NOW, since), true);
});

test('período: sem data válida só sai no "Todo o período"', () => {
  const since = rangeSince('day', NOW);
  for (const bad of [undefined, null, NaN, 'ontem', Infinity]) assert.equal(inRange(bad, since), false);
  assert.equal(inRange(undefined, -Infinity), true);
});

test('histórico: tira só o período e mantém a ordem', () => {
  const list = [
    { url: 'https://a.com/1', title: 'A', ts: NOW - 10 * 60_000 },
    { url: 'https://b.com/', title: 'B', ts: NOW - 2 * H },
    { url: 'https://c.com/', title: 'C', ts: NOW - 30 * 24 * H },
  ];
  const r = splitHistory(list, rangeSince('hour', NOW));
  assert.deepEqual(r.removed.map(h => h.url), ['https://a.com/1']);
  assert.deepEqual(r.kept.map(h => h.url), ['https://b.com/', 'https://c.com/']);
  assert.equal(splitHistory(list, rangeSince('month', NOW)).kept.length, 1);
  assert.equal(splitHistory(list, rangeSince('all', NOW)).kept.length, 0);
});

test('sites do período: origem sem repetir, só http(s), só dentro do período', () => {
  const list = [
    { url: 'https://www.g1.globo.com/noticia?x=1', ts: NOW - 60_000 },
    { url: 'https://www.g1.globo.com/outra', ts: NOW - 120_000 },
    { url: 'http://exemplo.com.br:8080/a', ts: NOW - 5 * 60_000 },
    { url: 'chrome-extension://' + EXT_A + '/popup.html', ts: NOW - 60_000 },
    { url: 'file:///C:/x.html', ts: NOW - 60_000 },
    { url: 'nem é url', ts: NOW - 60_000 },
    { url: 'https://antigo.com/', ts: NOW - 3 * H },
  ];
  assert.deepEqual(originsVisited(list, rangeSince('hour', NOW)), ['https://www.g1.globo.com', 'http://exemplo.com.br:8080']);
  assert.deepEqual(originsVisited([], rangeSince('hour', NOW)), []);
});

test('downloads: em andamento nunca sai; terminado sai se começou no período', () => {
  const list = [
    { filename: 'a', state: 'progress', at: NOW - 60_000 },
    { filename: 'b', state: 'completed', at: NOW - 60_000 },
    { filename: 'c', state: 'failed', at: NOW - 5 * H },
    { filename: 'd', state: 'queued', at: NOW - 60_000 },
    { filename: 'e', state: 'started' },
  ];
  assert.deepEqual(keepDownloads(list, rangeSince('hour', NOW)).map(d => d.filename), ['a', 'c', 'd', 'e']);
  assert.deepEqual(keepDownloads(list, rangeSince('all', NOW)).map(d => d.filename), ['a', 'd', 'e']);
});

test('origem: normaliza e recusa o que não é site', () => {
  assert.equal(webOrigin('https://Site.COM/caminho?q=1#x'), 'https://site.com');
  assert.equal(webOrigin('https://site.com:443/'), 'https://site.com');
  assert.equal(webOrigin('chrome-extension://' + EXT_A), null);
  assert.equal(webOrigin('javascript:alert(1)'), null);
  assert.equal(webOrigin(42), null);
});

test('IPC: recusa pedido torto (período desconhecido, não-objeto)', () => {
  assert.equal(sanitizeClearRequest(null), null);
  assert.equal(sanitizeClearRequest([]), null);
  assert.equal(sanitizeClearRequest({ range: 'forever', cookies: true }), null);
  assert.equal(sanitizeClearRequest('all'), null);
});

test('IPC: só booleano de verdade marca caixa; nada de lista livre de storages', () => {
  const r = sanitizeClearRequest({ range: 'all', cookies: 'yes', cache: 1, storages: ['shadercache'], origins: ['https://a.com'] });
  assert.deepEqual(r, { range: 'all', cookies: false, cache: false, origins: [] });
});

test('IPC: origens só http(s) já normalizadas, sem repetir, com teto', () => {
  const r = sanitizeClearRequest({
    range: 'hour', cookies: true, cache: false,
    origins: ['https://a.com', 'https://a.com', 'chrome-extension://' + EXT_A, 'https://b.com/caminho', 'https://user:pw@c.com', 'file:///x', 7, 'http://d.com:81'],
  });
  assert.deepEqual(r?.origins, ['https://a.com', 'http://d.com:81']);
  const many = Array.from({ length: MAX_ORIGINS + 50 }, (_, i) => `https://s${i}.com`);
  assert.equal(sanitizeClearRequest({ range: 'day', cookies: true, cache: true, origins: many })?.origins.length, MAX_ORIGINS);
});

test('plano: nada marcado → nenhuma chamada', () => {
  assert.deepEqual(planClear({ range: 'all', cookies: false, cache: false, origins: [] }, [EXT_A]), { browser: null, googleLogin: null });
});

test('plano: "Todo o período" protege TODAS as extensões e zera o login antigo do Google só com cookies', () => {
  const p = planClear({ range: 'all', cookies: true, cache: true, origins: [] }, [EXT_A, EXT_B, 'lixo', EXT_A]);
  assert.deepEqual(p.browser, {
    dataTypes: [...SITE_DATA_TYPES, 'cache'],
    excludeOrigins: [`chrome-extension://${EXT_A}`, `chrome-extension://${EXT_B}`],
  });
  assert.deepEqual(p.googleLogin, { dataTypes: [...SITE_DATA_TYPES, 'cache'] });
  const soCache = planClear({ range: 'all', cookies: false, cache: true, origins: [] }, [EXT_A]);
  assert.deepEqual(soCache.browser, { dataTypes: ['cache'], excludeOrigins: [`chrome-extension://${EXT_A}`] });
  assert.equal(soCache.googleLogin, null);
});

test('plano: sem extensão nenhuma não manda excludeOrigins vazio', () => {
  const p = planClear({ range: 'all', cookies: true, cache: false, origins: [] }, []);
  assert.deepEqual(p.browser, { dataTypes: [...SITE_DATA_TYPES] });
  assert.ok(!('excludeOrigins' in (p.browser as object)));
});

test('plano: período menor = só os sites do período; nunca o login do Google', () => {
  const p = planClear({ range: 'hour', cookies: true, cache: true, origins: ['https://a.com', 'https://b.com'] }, [EXT_A]);
  assert.deepEqual(p.browser, { dataTypes: [...SITE_DATA_TYPES, 'cache'], origins: ['https://a.com', 'https://b.com'] });
  assert.equal(p.googleLogin, null);
});

test('plano: período menor SEM site visitado não chama (sem filtro apagaria tudo)', () => {
  assert.deepEqual(planClear({ range: 'week', cookies: true, cache: true, origins: [] }, [EXT_A]), { browser: null, googleLogin: null });
});

test('plano: cookies não inclui cache HTTP e vice-versa', () => {
  const c = planClear({ range: 'all', cookies: true, cache: false, origins: [] }, []).browser!;
  assert.ok(!c.dataTypes.includes('cache'));
  assert.ok(c.dataTypes.includes('cookies') && c.dataTypes.includes('localStorage') && c.dataTypes.includes('indexedDB') && c.dataTypes.includes('serviceWorkers'));
  const k = planClear({ range: 'all', cookies: false, cache: true, origins: [] }, []).browser!;
  assert.deepEqual(k.dataTypes, ['cache']);
});

test('extensões: só ids no formato do Chrome viram origem', () => {
  assert.deepEqual(extensionOrigins([EXT_A, 'ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP', 'z'.repeat(32), '..', 5, EXT_A]), [`chrome-extension://${EXT_A}`]);
});
