// Cursor do agente: o caminho é um arco que começa e termina nos pontos certos.
import { test } from 'node:test';
import assert from 'node:assert';
import { arcPoint, arcSide, easeInOut, arcPath } from '../../src/shared/agent-cursor-path.ts';

test('arc starts at the origin, ends on the target and bows away from the straight line', () => {
  const a = { x: 100, y: 100 }, b = { x: 500, y: 100 };
  assert.deepStrictEqual(arcPoint(a, b, 0, 1), a);
  assert.deepStrictEqual(arcPoint(a, b, 1, 1), b);
  const mid = arcPoint(a, b, 0.5, 1), midOther = arcPoint(a, b, 0.5, -1);
  assert.ok(Math.abs(mid.y - 100) > 30, `should curve, got y=${mid.y}`);
  assert.ok(Math.sign(mid.y - 100) === -Math.sign(midOther.y - 100), 'side flips the curve');
});

test('side follows the direction of travel; easing starts at 0 and ends at 1', () => {
  assert.equal(arcSide({ x: 0, y: 0 }, { x: 10, y: 0 }), 1);
  assert.equal(arcSide({ x: 10, y: 0 }, { x: 0, y: 0 }), -1);
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(easeInOut(0.5), 0.5);
});

test('arcPath: ends exactly on the target, curves, and follows the same arc the overlay draws', () => {
  const a = { x: 100, y: 300 }, b = { x: 700, y: 300 };
  const pts = arcPath(a, b, 18);
  assert.equal(pts.length, 18);
  assert.deepStrictEqual(pts[pts.length - 1], b);
  assert.ok(Math.max(...pts.map(p => Math.abs(p.y - 300))) > 50, 'the path bows away from the straight line');
  const mid = arcPoint(a, b, easeInOut(9 / 18), arcSide(a, b));
  assert.deepStrictEqual(pts[8], { x: Math.round(mid.x), y: Math.round(mid.y) });
});
