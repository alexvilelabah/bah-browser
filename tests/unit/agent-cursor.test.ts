// Cursor do agente (só visual): o caminho é um arco que começa e termina nos pontos certos.
import { test } from 'node:test';
import assert from 'node:assert';
import { arcPoint } from '../../src/shared/agent-cursor-path.ts';

test('arc starts at the origin, ends on the target and bows away from the straight line', () => {
  const a = { x: 100, y: 100 }, b = { x: 500, y: 100 };
  assert.deepStrictEqual(arcPoint(a, b, 0, 1), a);
  assert.deepStrictEqual(arcPoint(a, b, 1, 1), b);
  const mid = arcPoint(a, b, 0.5, 1), midOther = arcPoint(a, b, 0.5, -1);
  assert.ok(Math.abs(mid.y - 100) > 30, `should curve, got y=${mid.y}`);
  assert.ok(Math.sign(mid.y - 100) === -Math.sign(midOther.y - 100), 'side flips the curve');
});

test('arcPath: ends exactly on the target, curves, and the side follows the direction of travel', async () => {
  const { arcPath, arcSide } = await import('../../src/shared/agent-cursor-path.ts');
  const a = { x: 100, y: 300 }, b = { x: 700, y: 300 };
  const pts = arcPath(a, b, 18);
  assert.equal(pts.length, 18);
  assert.deepStrictEqual(pts[pts.length - 1], b);
  assert.ok(Math.max(...pts.map(p => Math.abs(p.y - 300))) > 50, 'the path bows away from the straight line');
  assert.equal(arcSide(a, b), 1);
  assert.equal(arcSide(b, a), -1);
});
