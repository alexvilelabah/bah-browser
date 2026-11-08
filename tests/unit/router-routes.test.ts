// Roteador local: prompt fixo, mensagem com contexto, leitura da resposta e mapeamento pro caminho
// da caixa (src/shared/router-routes.ts).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import {
  ROUTES, ROUTE_NAMES, ROUTE_JSON_SCHEMA, buildSystemPrompt, buildUserMessage, isIntegratedGpu, parseRoute, refineRoute, routeToIntent,
} from '../../src/shared/router-routes.ts';

test('system prompt is fixed and lists every route with its description', () => {
  const a = buildSystemPrompt();
  assert.equal(a, buildSystemPrompt(), 'same text every call → reusable prefix');
  for (const r of ROUTES) assert.ok(a.includes(`- ${r.key}: ${r.description}`), r.name);
  assert.match(a, /\{"route": "<route>"\}/);
  assert.ok(!/\$\{|undefined/.test(a));
});

test('few-shot examples never copy a test case word for word', () => {
  const fx = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../fixtures/routing-cases.json'), 'utf8'));
  const sys = buildSystemPrompt().toLowerCase();
  for (const c of fx.cases) assert.ok(!sys.includes(`"${c.text.toLowerCase()}"`), c.text);
});

test('user message: page, last task and message; blank / internal pages read as none', () => {
  const m = buildUserMessage('did you click it?', {
    url: 'https://www.linkedin.com/jobs/view/1', title: 'PM | LinkedIn',
    lastRun: { request: 'open the first job', outcome: 'ended with: blocked' },
  });
  assert.equal(m, 'Open page: PM | LinkedIn — https://www.linkedin.com/jobs/view/1\nLast task: "open the first job" → ended with: blocked\nMessage: did you click it?');
  assert.equal(buildUserMessage('hi'), 'Open page: (none)\nLast task: none\nMessage: hi');
  assert.match(buildUserMessage('hi', { url: 'about:blank', title: 'x' }), /^Open page: \(none\)/);
  // Texto longo e quebras de linha não incham o prompt.
  const long = buildUserMessage('a\n'.repeat(2000), { title: 'T'.repeat(500), url: 'https://x.com/' + 'p'.repeat(500) });
  assert.ok(long.length < 900, String(long.length));
  assert.equal(long.split('\n').length, 3);
});

test('route parsing: JSON, bare name, case, junk', () => {
  assert.equal(parseRoute('{"route": "browser_task"}'), 'ACTION');
  assert.equal(parseRoute('{"route": "redo_last_task"}'), 'FIX');
  assert.equal(parseRoute('greeting_or_chat'), 'CHAT');
  assert.equal(parseRoute('{"route": "ACTION"}'), 'ACTION');
  assert.equal(parseRoute('{"route":"last_run"}'), 'LAST_RUN');
  assert.equal(parseRoute({ route: 'FIX' }), 'FIX');
  assert.equal(parseRoute(' WEB. '), 'WEB');
  assert.equal(parseRoute('"other"'), 'other');
  assert.equal(parseRoute('{"route": "DELETE_ALL"}'), null);
  assert.equal(parseRoute('{"route": 3}'), null);
  assert.equal(parseRoute(''), null);
  assert.equal(parseRoute(null), null);
  assert.equal(parseRoute(undefined), null);
});

test('schema allows exactly the route names', () => {
  assert.deepEqual([...ROUTE_JSON_SCHEMA.properties.route.enum], ROUTES.map(r => r.key));
  assert.deepEqual(ROUTES.map(r => r.name), [...ROUTE_NAMES]);
  assert.deepEqual([...ROUTE_JSON_SCHEMA.required], ['route']);
});

test('mapping to the assistant box; LAST_RUN/FIX need a last task; other → word rules', () => {
  assert.equal(routeToIntent('ACTION', false), 'action');
  assert.equal(routeToIntent('PAGE', false), 'page');
  assert.equal(routeToIntent('WEB', false), 'web');
  assert.equal(routeToIntent('CHAT', false), 'chat');
  assert.equal(routeToIntent('LAST_RUN', true), 'last_run');
  assert.equal(routeToIntent('FIX', true), 'fix');
  assert.equal(routeToIntent('LAST_RUN', false), 'chat');
  assert.equal(routeToIntent('FIX', false), 'action');
  assert.equal(routeToIntent('other', true), null);
  assert.equal(routeToIntent(null, true), null);
});

test('LAST_RUN ↔ FIX settled by the shape of the sentence; other routes untouched', () => {
  for (const q of ['why did you stop?', '¿por qué paraste?', 'did it work', 'o que aconteceu', 'você clicou no botão?', 'which video did you open'])
    assert.equal(refineRoute('FIX', q), 'LAST_RUN', q);
  for (const s of ['one window was opened, but not the second.', 'you only opened one', 'não funcionou, tenta de novo', 'that\'s the wrong video'])
    assert.equal(refineRoute('LAST_RUN', s), 'FIX', s);
  assert.equal(refineRoute('ACTION', 'why did you stop?'), 'ACTION');
  assert.equal(refineRoute('CHAT', 'you only opened one'), 'CHAT');
  assert.equal(refineRoute(null, 'x'), null);
});

test('isIntegratedGpu: só Vulkan com memória toda compartilhada vai pra CPU', () => {
  const GB = 1024 ** 3;
  assert.equal(isIntegratedGpu('vulkan', { total: 12 * GB, unifiedSize: 12 * GB }), true);   // Intel Iris Xe
  assert.equal(isIntegratedGpu('vulkan', { total: 16 * GB, unifiedSize: 0 }), false);        // placa dedicada
  assert.equal(isIntegratedGpu('metal', { total: 16 * GB, unifiedSize: 16 * GB }), false);   // Apple Silicon
  assert.equal(isIntegratedGpu('cuda', { total: 16 * GB, unifiedSize: 0 }), false);
  assert.equal(isIntegratedGpu(false, { total: 0, unifiedSize: 0 }), false);
});
