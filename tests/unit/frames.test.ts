import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  frameLabel, isExtensionFrameUrl, parseFrameKey, boxFromQuad, childFrames, MAX_FRAME_DEPTH,
  type FrameTreeNode,
} from '../../src/shared/frames.ts';

// Iframes pro agente: nome do frame na lista (frame="host"), chave do frame, caixa na viewport da
// página e quais frames entram (extensões ficam de fora).

test('frameLabel: host of the URL; srcdoc/about:blank/empty are "embedded"', () => {
  assert.equal(frameLabel('https://js.stripe.com/v3/elements-inner.html#abc'), 'js.stripe.com');
  assert.equal(frameLabel('http://localhost:8123/'), 'localhost:8123');
  assert.equal(frameLabel('about:srcdoc'), 'embedded');
  assert.equal(frameLabel('about:blank'), 'embedded');
  assert.equal(frameLabel(''), 'embedded');
  assert.equal(frameLabel(undefined), 'embedded');
  // Sem host (data:) ou inválida: os primeiros 40 caracteres.
  assert.equal(frameLabel('data:text/html,<p>hi</p>'), 'data:text/html,<p>hi</p>');
  assert.equal(frameLabel('not a url ' + 'x'.repeat(60)).length, 40);
});

test('isExtensionFrameUrl: only chrome-extension:// frames', () => {
  assert.equal(isExtensionFrameUrl('chrome-extension://hdokiejnpimakedhajhdlcegeplioahd/menu.html'), true);
  assert.equal(isExtensionFrameUrl('  CHROME-EXTENSION://abc/x'), true);
  assert.equal(isExtensionFrameUrl('https://example.com/chrome-extension://'), false);
  assert.equal(isExtensionFrameUrl('about:srcdoc'), false);
  assert.equal(isExtensionFrameUrl(null), false);
});

test('parseFrameKey: local:<frameId> and oopif:<sessionId>; anything else is null', () => {
  assert.deepEqual(parseFrameKey('local:ABC123'), { kind: 'local', frameId: 'ABC123' });
  assert.deepEqual(parseFrameKey('oopif:S:1'), { kind: 'oopif', sessionId: 'S:1' });   // só o 1º ':' separa
  assert.equal(parseFrameKey('other:1'), null);
  assert.equal(parseFrameKey('local:'), null);
  assert.equal(parseFrameKey(':x'), null);
  assert.equal(parseFrameKey('local'), null);
  assert.equal(parseFrameKey(42), null);
});

test('boxFromQuad: center + size, offset by the <iframe> content box', () => {
  const quad = [10, 20, 110, 20, 110, 60, 10, 60];
  assert.deepEqual(boxFromQuad(quad), { x: 60, y: 40, w: 100, h: 40 });
  assert.deepEqual(boxFromQuad(quad, 200, 300), { x: 260, y: 340, w: 100, h: 40 });
  // Quad girado: usa o retângulo que o envolve.
  assert.deepEqual(boxFromQuad([50, 0, 100, 50, 50, 100, 0, 50]), { x: 50, y: 50, w: 100, h: 100 });
  assert.equal(boxFromQuad(undefined), null);
  assert.equal(boxFromQuad([1, 2, 3]), null);
  assert.equal(boxFromQuad([0, 0, 1, 0, 1, 1, 0, NaN]), null);
});

test('childFrames: depth-first child frames, extension frames (and what is inside) left out', () => {
  const tree: FrameTreeNode = {
    frame: { id: 'main', url: 'https://shop.example/' },
    childFrames: [
      { frame: { id: 'a', url: 'about:srcdoc' }, childFrames: [{ frame: { id: 'a1', url: 'https://pay.example/' } }] },
      { frame: { id: 'ext', url: 'chrome-extension://abc/menu.html' }, childFrames: [{ frame: { id: 'ext1', url: 'https://x.example/' } }] },
      { frame: { id: 'b', url: 'https://book.example/' } },
    ],
  };
  assert.deepEqual(childFrames(tree).map(f => f.id), ['a', 'a1', 'b']);
  assert.deepEqual(childFrames(undefined), []);
  assert.deepEqual(childFrames({ frame: { id: 'main' } }), []);
});

test('childFrames: stops below MAX_FRAME_DEPTH', () => {
  let node: FrameTreeNode = { frame: { id: 'f9' } };
  for (let i = 8; i >= 0; i--) node = { frame: { id: `f${i}` }, childFrames: [node] };
  // f0 é o frame principal; f1..f(MAX+1) entram.
  assert.equal(childFrames(node).length, MAX_FRAME_DEPTH + 1);
});
