// click_role: papel + nome (exato antes de parcial), nth na ordem da página.
import { test } from 'node:test';
import assert from 'node:assert';
import { matchRole } from '../../src/shared/role-target.ts';

const els = [
  { id: 0, tag: 'a', text: 'Add to cart guide' },
  { id: 1, tag: 'button', text: 'Add to cart' },
  { id: 2, tag: 'button', role: 'button', text: 'Add to cart' },
  { id: 3, tag: 'input', placeholder: 'Email address' },
  { id: 4, tag: 'button', text: 'Add to cart — gift' },
];

test('role + exact name first, then partial; links are not buttons', () => {
  assert.deepStrictEqual(matchRole(els, 'button', 'add to cart').map(e => e.id), [1, 2, 4]);
  assert.deepStrictEqual(matchRole(els, 'link', 'Add to cart').map(e => e.id), [0]);
  assert.deepStrictEqual(matchRole(els, 'textbox', 'email').map(e => e.id), [3]);
  assert.deepStrictEqual(matchRole(els, 'checkbox', 'x'), []);
});
