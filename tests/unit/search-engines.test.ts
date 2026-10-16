import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEARCH_ENGINES, DEFAULT_SEARCH_ENGINE, CUSTOM_TEMPLATE_MAX, SEARCH_QUERY_MAX,
  validateCustomTemplate, normalizeSearchSetting, buildSearchUrl, buildSuggestUrl,
  parseSuggestResponse, engineHome, engineName, isEngineHome, selectionLabel, encodeQuery,
} from '../../src/shared/search-engines.ts';

// Mecanismo de pesquisa da barra de endereço: tabela, Personalizado, codificação, nova aba.

const PT = 'hl=pt-BR&gl=BR';

test('Google continua com os parâmetros de sempre do Bah', () => {
  assert.equal(buildSearchUrl({ id: 'google' }, 'gatos', { googleLocale: PT }),
    'https://www.google.com/search?hl=pt-BR&gl=BR&pws=0&q=gatos');
  assert.equal(buildSearchUrl({ id: 'google' }, 'cats', { googleLocale: 'hl=en' }),
    'https://www.google.com/search?hl=en&pws=0&q=cats');
  // sem locale → inglês, nunca "{google:locale}" cru
  assert.equal(buildSearchUrl({ id: 'google' }, 'x'), 'https://www.google.com/search?hl=en&pws=0&q=x');
  assert.equal(engineHome({ id: 'google' }, 'pt'), 'https://www.google.com.br/webhp?hl=pt-BR&gl=BR&pws=0&gws_rd=cr');
  assert.equal(engineHome({ id: 'google' }, 'es'), 'https://www.google.com/webhp?hl=es&pws=0');
  assert.equal(engineHome({ id: 'google' }, 'en'), 'https://www.google.com/webhp?hl=en&pws=0');
});

test('cada pronto monta a busca no próprio site', () => {
  const want: Record<string, string> = {
    bing: 'https://www.bing.com/search?q=a%20b',
    duckduckgo: 'https://duckduckgo.com/?q=a%20b',
    ecosia: 'https://www.ecosia.org/search?q=a%20b',
    brave: 'https://search.brave.com/search?q=a%20b',
    yahoo: 'https://search.yahoo.com/search?p=a%20b',
  };
  for (const [id, url] of Object.entries(want)) assert.equal(buildSearchUrl({ id } as any, 'a b'), url);
  // todos https, todos com %s uma vez só, nomes únicos
  for (const e of SEARCH_ENGINES) {
    assert.match(e.search, /^https:\/\//);
    assert.equal(e.search.split('%s').length, 2, e.id);
    if (e.suggest) { assert.match(e.suggest, /^https:\/\//); assert.equal(e.suggest.split('%s').length, 2, e.id); }
  }
  assert.equal(new Set(SEARCH_ENGINES.map(e => e.name)).size, SEARCH_ENGINES.length);
});

test('codificação: espaço, + & # = ? / %, acento e emoji', () => {
  const url = buildSearchUrl({ id: 'bing' }, 'c++ & c# = 100%? a/b');
  assert.equal(url, 'https://www.bing.com/search?q=c%2B%2B%20%26%20c%23%20%3D%20100%25%3F%20a%2Fb');
  const back = new URL(url).searchParams.get('q');
  assert.equal(back, 'c++ & c# = 100%? a/b');
  const uni = buildSearchUrl({ id: 'duckduckgo' }, 'ação São Paulo 🐱 日本');
  assert.equal(new URL(uni).searchParams.get('q'), 'ação São Paulo 🐱 日本');
  assert.ok(!/[^\x21-\x7e]/.test(uni), 'só ASCII no endereço');
  // espaços nas pontas saem; busca gigante é cortada
  assert.equal(encodeQuery('  oi  '), 'oi');
  assert.equal(decodeURIComponent(encodeQuery('x'.repeat(SEARCH_QUERY_MAX + 50))).length, SEARCH_QUERY_MAX);
});

test('"$&" e "$1" na busca não viram padrão do replace', () => {
  const url = buildSearchUrl({ id: 'custom', custom: 'https://s.example.com/?q=%s&x=1' }, '$& $1 $$');
  assert.equal(new URL(url).searchParams.get('q'), '$& $1 $$');
  assert.equal(new URL(url).searchParams.get('x'), '1');
  const g = buildSearchUrl({ id: 'google' }, '$&', { googleLocale: PT });
  assert.equal(new URL(g).searchParams.get('q'), '$&');
  // a busca com "{google:locale}" não é trocada (só o modelo é)
  const gl = buildSearchUrl({ id: 'google' }, '{google:locale}', { googleLocale: PT });
  assert.equal(new URL(gl).searchParams.get('q'), '{google:locale}');
});

test('Personalizado: aceita endereço https com um %s depois do domínio', () => {
  for (const ok of [
    'https://search.example.com/?q=%s',
    'https://example.com/search?q=%s&lang=pt',
    'https://example.com/busca/%s',
    'https://example.com/#q=%s',
    'https://xn--bsca-0na.com.br/?q=%s',
    '  https://example.com/?q=%s  ',
  ]) assert.equal(validateCustomTemplate(ok).ok, true, ok);
  const v = validateCustomTemplate('  https://example.com/?q=%s ');
  assert.ok(v.ok && v.template === 'https://example.com/?q=%s');
});

test('Personalizado: recusa javascript:, http, sem %s, dois %s, %s no domínio, credenciais', () => {
  const bad: Array<[unknown, string]> = [
    ['', 'empty'], ['   ', 'empty'], [null, 'empty'], [42, 'empty'],
    ['javascript:alert(1)//%s', 'notHttps'],
    ['data:text/html,<script>%s</script>', 'notHttps'],
    ['file:///C:/x?%s', 'notHttps'],
    ['http://example.com/?q=%s', 'notHttps'],
    ['https://example.com/?q=', 'placeholder'],
    ['https://example.com/?q=%s&r=%s', 'placeholder'],
    ['https://%s.example.com/', 'invalid'],
    ['https://example.com%s', 'invalid'],
    ['https://user:pw@example.com/?q=%s', 'invalid'],
    ['https://exa mple.com/?q=%s', 'invalid'],
    ['https://example.com/?q=%s\nx', 'invalid'],
    ['https://example.com/?q=%s\u0000', 'invalid'],
    ['https://javascript:alert(1)/?q=%s', 'invalid'],
    ['https://a$b.com/?q=%s', 'invalid'],
    ['https://example.com/?q=%s' + 'x'.repeat(CUSTOM_TEMPLATE_MAX), 'tooLong'],
  ];
  for (const [raw, error] of bad) {
    const v = validateCustomTemplate(raw);
    assert.equal(v.ok, false, String(raw));
    if (!v.ok) assert.equal(v.error, error, String(raw));
  }
});

test('salvo antigo/quebrado = Google; Personalizado fica guardado', () => {
  assert.deepEqual(normalizeSearchSetting(null), DEFAULT_SEARCH_ENGINE);
  assert.deepEqual(normalizeSearchSetting(undefined), { id: 'google' });
  assert.deepEqual(normalizeSearchSetting('bing'), { id: 'google' });
  assert.deepEqual(normalizeSearchSetting({ id: 'altavista' }), { id: 'google' });
  assert.deepEqual(normalizeSearchSetting({ id: 'bing' }), { id: 'bing' });
  assert.deepEqual(normalizeSearchSetting({ id: 'custom' }), { id: 'google' });
  assert.deepEqual(normalizeSearchSetting({ id: 'custom', custom: 'javascript:alert(1)%s' }), { id: 'google' });
  assert.deepEqual(normalizeSearchSetting({ id: 'custom', custom: 'https://e.com/?q=%s' }), { id: 'custom', custom: 'https://e.com/?q=%s' });
  // escolheu um pronto depois de um Personalizado: o endereço continua guardado, mas não é usado
  const s = normalizeSearchSetting({ id: 'ecosia', custom: 'https://e.com/?q=%s' });
  assert.deepEqual(s, { id: 'ecosia', custom: 'https://e.com/?q=%s' });
  assert.equal(buildSearchUrl(s, 'x'), 'https://www.ecosia.org/search?q=x');
  assert.deepEqual(normalizeSearchSetting({ id: 'ecosia', custom: 'http://e.com/?q=%s' }), { id: 'ecosia' });
  // modelo inválido que chegou por fora (IPC/disco) nunca é usado
  assert.equal(buildSearchUrl({ id: 'custom', custom: 'javascript:alert(1)//%s' }, 'x', { googleLocale: PT }),
    'https://www.google.com/search?hl=pt-BR&gl=BR&pws=0&q=x');
});

test('sugestões: só dos prontos, do endereço fixo; Personalizado não busca', () => {
  assert.equal(buildSuggestUrl({ id: 'google' }, 'café com', 'pt-BR'),
    'https://suggestqueries.google.com/complete/search?client=firefox&hl=pt-BR&q=caf%C3%A9%20com');
  assert.equal(buildSuggestUrl({ id: 'bing' }, 'a&b'), 'https://www.bing.com/osjson.aspx?query=a%26b');
  assert.equal(buildSuggestUrl({ id: 'duckduckgo' }, 'x'), 'https://duckduckgo.com/ac/?q=x&type=list');
  assert.equal(buildSuggestUrl({ id: 'custom', custom: 'https://e.com/?q=%s' }, 'x'), null);
  assert.equal(buildSuggestUrl({ id: 'nada' } as any, 'x')?.startsWith('https://suggestqueries.google.com/'), true);
  assert.deepEqual(parseSuggestResponse(['cafe', ['café com leite', 'café', '', 3, 'c3']]), ['café com leite', 'café', 'c3']);
  assert.deepEqual(parseSuggestResponse(['q', ['a', 'b', 'c', 'd', 'e', 'f', 'g']], 6).length, 6);
  assert.deepEqual(parseSuggestResponse({ q: 1 }), []);
  assert.deepEqual(parseSuggestResponse(['q']), []);
  assert.deepEqual(parseSuggestResponse(null), []);
});

test('nome e página inicial', () => {
  assert.equal(engineName({ id: 'brave' }), 'Brave Search');
  assert.equal(engineName({ id: 'custom', custom: 'https://www.busca.exemplo.com.br/?q=%s' }), 'busca.exemplo.com.br');
  assert.equal(engineHome({ id: 'custom', custom: 'https://busca.exemplo.com/s?q=%s' }), 'https://busca.exemplo.com/');
  assert.equal(engineHome({ id: 'duckduckgo' }, 'pt'), 'https://duckduckgo.com/');
  assert.equal(engineName({ id: 'x' } as any), 'Google');
});

test('nova aba: página inicial de qualquer mecanismo, mas não a de resultados', () => {
  assert.equal(isEngineHome('https://www.google.com.br/webhp?hl=pt-BR&gl=BR&pws=0&gws_rd=cr'), true);
  assert.equal(isEngineHome('https://www.google.com/'), true);
  assert.equal(isEngineHome('https://www.google.com/search?q=x'), false);
  assert.equal(isEngineHome('https://www.bing.com/'), true);
  assert.equal(isEngineHome('https://www.bing.com/?toWww=1&redig=ABC'), true);
  assert.equal(isEngineHome('https://www.bing.com/search?q=x'), false);
  assert.equal(isEngineHome('https://duckduckgo.com/'), true);
  assert.equal(isEngineHome('https://duckduckgo.com/?q=gatos'), false);   // resultado no "/"
  assert.equal(isEngineHome('https://duckduckgo.com/?t=h_'), true);
  assert.equal(isEngineHome('https://www.ecosia.org/'), true);
  assert.equal(isEngineHome('https://search.brave.com/'), true);
  assert.equal(isEngineHome('https://search.yahoo.com/'), true);
  assert.equal(isEngineHome('https://search.yahoo.com/search?p=x'), false);
  assert.equal(isEngineHome('https://www.youtube.com/'), false);
  assert.equal(isEngineHome('https://bing.com.evil.tld/'), false);
  assert.equal(isEngineHome(''), false);
  assert.equal(isEngineHome(undefined), false);
  assert.equal(isEngineHome('not a url'), false);
  // a raiz de um site comum nunca vira "nova aba" (Personalizado fica de fora)
  assert.equal(isEngineHome('https://www.youtube.com/'), false);
  assert.equal(isEngineHome('https://busca.exemplo.com/'), false);
  assert.equal(isEngineHome('javascript:alert(1)'), false);
});

test('rótulo do clique direito: espaços juntados, corta em 32 com reticências', () => {
  assert.equal(selectionLabel('  olá \n  mundo  '), 'olá mundo');
  assert.equal(selectionLabel('a'.repeat(40)), 'a'.repeat(32) + '…');
  assert.equal(selectionLabel('a'.repeat(32)), 'a'.repeat(32));
});
