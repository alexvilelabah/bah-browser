// Cursor do agente: o caminho é um arco que começa e termina nos pontos certos.
import { test } from 'node:test';
import assert from 'node:assert';
import { arcPoint, arcSide, easeInOut } from '../../src/shared/agent-cursor-path.ts';

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
