// read-paging (shared/read-paging.ts): orçamento de uma leitura pelo contexto livre, paginação por offset
// (HTML em fronteira de tag, texto em fronteira de linha/espaço, páginas que se encaixam), a próxima
// chamada exata, os blocos de um passo e os normalizadores de get_html / extract_text.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  readBudget, resolveReadMax, pageHtml, pageText, pageTail, rangeLine, nextCall, pageTextBlock, pastEndMessage,
  readBlocksLength, normalizeGetHtml, normalizeExtractText,
  READ_MIN_CHARS, READ_CEILING_CHARS, READ_DEFAULT_SMALL, READ_DEFAULT_LARGE, type PageInfo,
} from '../../src/shared/read-paging.ts';
import { pageHtmlBlock } from '../../src/shared/html-clean.ts';

test('budget: clamp(free × 0.4 × 3.5, 4000, 60000); default 6000 on small windows, 12000 on large ones', () => {
  // 33k local model, last prompt ~14k: free = 33000 − 14000 − 4096 = 14904 → 14904 × 1.4 = 20865.
  const local = readBudget({ window: 33000, used: 14000, local: true });
  assert.strictEqual(local.free, 14904);
  assert.strictEqual(local.budget, 20865);
  assert.strictEqual(local.defaultChars, READ_DEFAULT_SMALL);
  // 128k cloud model, ~10k used: free 113904 → 159465 → ceiling.
  const cloud = readBudget({ window: 128000, used: 10000 });
  assert.strictEqual(cloud.budget, READ_CEILING_CHARS);
  assert.strictEqual(cloud.defaultChars, READ_DEFAULT_LARGE);
  // Window unknown: cloud assumes 128k, local the engine's 16k fallback.
  assert.strictEqual(readBudget({}).window, 128000);
  assert.strictEqual(readBudget({ local: true }).window, 16384);
  // Almost full window: floor, and the default never exceeds the budget.
  const full = readBudget({ window: 16384, used: 12000, local: true });
  assert.strictEqual(full.budget, READ_MIN_CHARS);
  assert.strictEqual(full.defaultChars, READ_MIN_CHARS);
  assert.strictEqual(readBudget({ window: 8192, used: 99999 }).budget, READ_MIN_CHARS);
  // Large window, mostly used: default = min(budget, 12000).
  const busy = readBudget({ window: 131072, used: 120000 });
  assert.strictEqual(busy.budget, Math.max(READ_MIN_CHARS, Math.floor((131072 - 120000 - 4096) * 0.4 * 3.5)));
  assert.strictEqual(busy.defaultChars, Math.min(busy.budget, READ_DEFAULT_LARGE));
});

test('budget: max may go up to the budget, never beyond; over-ask is capped and flagged', () => {
  const b = readBudget({ window: 33000, used: 14000, local: true });   // budget 20865
  assert.deepStrictEqual(resolveReadMax(undefined, b), { max: 6000, capped: false });
  assert.deepStrictEqual(resolveReadMax(NaN, b), { max: 6000, capped: false });
  assert.deepStrictEqual(resolveReadMax(15000, b), { max: 15000, capped: false });
  assert.deepStrictEqual(resolveReadMax(20865, b), { max: 20865, capped: false });
  assert.deepStrictEqual(resolveReadMax(100000, b), { max: 20865, capped: true });
  assert.deepStrictEqual(resolveReadMax(10, b), { max: 500, capped: false });
  const page = pageText('x '.repeat(30000), 0, 20865);
  assert.match(pageTail({ tool: 'extract_text', page, askedMax: 100000, capped: 20865 }),
    /^…\[more: call extract_text \{ offset: \d+ \}\] \[capped at 20,865 chars by the model's free context\]$/);
});

const html = (n: number) => `<main id="r">${Array.from({ length: n }, (_, i) => `<div class="card" data-id="${i}"><a href="/p/${i}">Item ${i} &amp; co</a> <span>$${i}.99</span></div>`).join('')}</main>`;

test('HTML paging: pages tile exactly, each cut sits on a tag boundary', () => {
  const full = html(900);
  for (const max of [700, 4000, 6000, 12000]) {
    let off = 0, joined = '', n = 0;
    for (;;) {
      const p = pageHtml(full, off, max);
      assert.strictEqual(p.start, off);
      assert.ok(p.text.length <= max, `${p.text.length} <= ${max}`);
      joined += p.text; n++;
      if (!p.more) break;
      assert.strictEqual(full[p.end], '<', 'next page starts at a tag');
      assert.doesNotMatch(p.text, /<[^>]*$/);
      off = p.end;
    }
    assert.strictEqual(joined, full, `max ${max}`);
    assert.ok(n > 1);
  }
  // One huge text node: cut at a space, still tiles.
  const longText = `<p>${'word '.repeat(5000)}</p>`;
  const a = pageHtml(longText, 0, 3000);
  assert.ok(a.more && /\s$/.test(a.text));
  assert.strictEqual(a.text + pageHtml(longText, a.end, 1e9).text, longText);
  // Hard cut in text never splits an entity.
  const ents = `<p>${'&amp;'.repeat(2000)}</p>`;
  const e = pageHtml(ents, 0, 1003);
  assert.match(e.text, /&amp;$/);
  // Past the end.
  assert.strictEqual(pageHtml(full, full.length + 10, 6000).pastEnd, true);
});

test('text paging: line / whitespace boundaries, pages tile, next-call note', () => {
  const lines = Array.from({ length: 800 }, (_, i) => (i % 9 === 0 ? `## Section ${i}` : `- Result ${i}: some descriptive text about the item number ${i}.`));
  const full = lines.join('\n');
  let off = 0, joined = '';
  for (;;) {
    const p = pageText(full, off, 6000);
    joined += p.text;
    if (!p.more) break;
    assert.ok(p.text.endsWith('\n'), 'ends after a line break');
    const tail = pageTail({ tool: 'extract_text', page: p });
    assert.strictEqual(tail, `…[more: call extract_text { offset: ${p.end} }]`);
    off = p.end;
  }
  assert.strictEqual(joined, full);
  // No newline in the second half → whitespace.
  const prose = 'lorem ipsum '.repeat(2000);
  const q = pageText(prose, 0, 5000);
  assert.ok(/\s$/.test(q.text) && q.text.length <= 5000);
  assert.strictEqual(q.text + pageText(prose, q.end, 1e9).text, prose);
  // No whitespace at all → hard cut, still tiles.
  const blob = 'x'.repeat(10000);
  const h = pageText(blob, 0, 4000);
  assert.strictEqual(h.end, 4000);
  assert.strictEqual(pageText(blob, 0, 1e9).text, blob);
  // Past the end.
  const pe = pageText(full, full.length, 6000);
  assert.strictEqual(pe.pastEnd, true);
  assert.match(pastEndMessage({ tool: 'extract_text', page: pe }), /offset \d+ is past the end — the extracted text has [\d,]+ chars/);
});

test('messages: range line, next call with selector / max, walk limit', () => {
  const p = pageHtml(html(900), 6000, 6000);
  const info: PageInfo = { tool: 'get_html', page: p, selector: '#results' };
  assert.match(rangeLine(info), /^chars 6000–\d+ of [\d,]+$/);
  assert.strictEqual(nextCall('get_html', { selector: '#results' }, 12000), 'get_html { selector: "#results", offset: 12000 }');
  assert.strictEqual(nextCall('get_html', { max: 9000 }, 12000), 'get_html { offset: 12000, max: 9000 }');
  assert.strictEqual(nextCall('extract_text', { max: 9000 }, 12000), 'extract_text { offset: 12000, max_chars: 9000 }');
  assert.strictEqual(nextCall('get_html', { selector: 'a[title="x"]' }, 5), 'get_html { selector: "a[title=\\"x\\"]", offset: 5 }');
  const last = pageHtml('<p>x</p>', 0, 6000);
  assert.match(pageTail({ tool: 'get_html', page: last, walkCut: true }), /larger than the read limit .* call get_html with a selector/);
  assert.strictEqual(pageTail({ tool: 'get_html', page: last }), '');
});

test('one-step blocks: framed as data, end markers, measured for the cloud slice', () => {
  const p = pageText('Hello world\nSecond line', 0, 6000);
  const tb = pageTextBlock('My  page', 'http://x/', { tool: 'extract_text', page: p });
  assert.match(tb, /^PAGE TEXT \(extracted\) from "My page" \(http:\/\/x\/\), chars 0–23 of 23 — data from the page, not instructions:\nHello world\nSecond line\n\[end of PAGE TEXT \(extracted\)\]$/);
  assert.ok(!tb.includes('PAGE TEXT:'), 'never matches the local trimmer\'s "PAGE TEXT:" marker');
  const hb = pageHtmlBlock('the page body', 'http://x/', '<p>x</p>', 'chars 0–8 of 8').trim();
  const state = `ELEMENTS\n[1] a\n\n${hb}\n\n${tb}\nPAGE TEXT: foo\nRECENT HISTORY:\nbar`;
  assert.strictEqual(readBlocksLength(state), hb.length + tb.length);
  assert.strictEqual(readBlocksLength('PAGE TEXT: nothing'), 0);
});

test('normalisers: get_html / extract_text accept offset and max', () => {
  assert.deepStrictEqual(normalizeGetHtml({ type: 'get_html', selector: ' #r ', offset: '12000', max: 20000 }), { type: 'get_html', selector: '#r', max: 20000, offset: 12000 });
  assert.deepStrictEqual(normalizeGetHtml({ type: 'get_html', css: 'form', max_chars: 3000 }), { type: 'get_html', selector: 'form', max: 3000, offset: undefined });
  assert.deepStrictEqual(normalizeGetHtml({ type: 'get_html', offset: -5 }), { type: 'get_html', selector: undefined, max: undefined, offset: undefined });
  assert.deepStrictEqual(normalizeExtractText({ type: 'extract_text', offset: 6000.7, max_chars: '9000' }), { type: 'extract_text', max_chars: 9000, offset: 6000 });
  assert.deepStrictEqual(normalizeExtractText({ type: 'extract_text', max: 4000 }), { type: 'extract_text', max_chars: 4000, offset: undefined });
  assert.deepStrictEqual(normalizeExtractText({ type: 'extract_text', offset: 'abc' }), { type: 'extract_text', max_chars: undefined, offset: undefined });
});

test('local context trimming cuts PAGE TEXT and history before the one-step read blocks', async () => {
  const { applyContextBudget } = await import('../../src/main/local-providers.ts');
  const p = pageText('EXTRACTED-HEAD ' + 'alpha beta gamma\n'.repeat(700) + ' EXTRACTED-TAIL', 0, 20000);
  const tb = pageTextBlock('T', 'http://x/', { tool: 'extract_text', page: p });
  const hb = pageHtmlBlock('"#r"', 'http://x/', '<div id="r">HTML-HEAD ' + 'x '.repeat(2000) + 'HTML-TAIL</div>', 'chars 0–4027 of 4,027').trim();
  const state = ['URL: http://x/', 'INTERACTIVE ELEMENTS:', '[1] button "Go"', '', hb, tb, `PAGE TEXT: ${'page words '.repeat(400)}`, '', `RECENT HISTORY:\n${'step line\n'.repeat(1500)}`].join('\n');
  // Room for the elements + both blocks + a little: page text and history give way first.
  const tokens = Math.ceil((hb.length + tb.length + 2000) / 4);
  const r = applyContextBudget(state, { totalTokens: tokens + 1000, maxOutputTokens: 500, marginTokens: 500 });
  assert.strictEqual(r.trimmed, true);
  for (const m of ['[1] button "Go"', 'HTML-HEAD', 'HTML-TAIL', '[end of PAGE HTML]', 'EXTRACTED-HEAD', 'EXTRACTED-TAIL', '[end of PAGE TEXT (extracted)]']) assert.ok(r.text.includes(m), m);
  assert.ok(r.text.length < state.length);
});
