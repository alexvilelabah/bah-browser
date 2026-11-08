// Freio do carrinho de mercado: pagar/fechar pedido/reservar horário pergunta; pôr e tirar do carrinho não.
import { test } from 'node:test';
import assert from 'node:assert';
import { classifyRisk, riskForAction } from '../../src/renderer/risk.ts';
import { diagnose } from '../../src/renderer/agent-recovery.ts';

const cart = { cart: true };

test('checkout, payment, place order and time-slot buttons of grocery stores ask', () => {
  for (const label of [
    'Continue to checkout', 'Check out', 'Checkout', 'Check out Whole Foods Market Cart', 'Proceed to checkout',
    'Continue to payment', 'Proceed to payment', 'Place order', 'Place your order', 'Submit order', 'Pay now',
    'Reserve time slot', 'Reserve a time slot', 'Reserve pickup time', 'Book a delivery slot', 'Buy now',
  ]) {
    assert.strictEqual(classifyRisk('click_ref', label)?.kind, 'payment', label);
    assert.strictEqual(classifyRisk('click_ref', label, undefined, undefined, cart)?.kind, 'payment', label + ' (cart task)');
  }
});

test('adding to the cart and changing quantities never ask', () => {
  for (const label of [
    'Add', 'Add to cart', 'Add to cart - Great Value Whole Vitamin D Milk, Gallon', 'Add Grade A Large Eggs - 12ct to cart',
    'Increase quantity by one', 'Decrease quantity by one', 'Increase quantity Lactaid Whole Milk, Current Quantity 1',
    'View cart', 'Cart contains 3 items Total Amount $12.38', 'Get in-stock alert', 'Search Walmart',
    'Check out our weekly deals', 'Pickup', 'Delivery',
  ]) assert.strictEqual(classifyRisk('click_ref', label, undefined, undefined, cart), null, label);
});

test('removing a line from the cart is editing the cart in a cart task', () => {
  assert.strictEqual(classifyRisk('click_ref', 'Delete 365 by Whole Foods Market Plain Bagels', undefined, undefined, cart), null);
  assert.strictEqual(classifyRisk('click_ref', 'Remove', undefined, undefined, cart), null);
  assert.strictEqual(classifyRisk('click_ref', 'Remove from cart Thomas\' Plain Bagels'), null);
  // outside a cart task, a bare Delete still asks; account deletion always asks
  assert.strictEqual(classifyRisk('click_ref', 'Delete 365 by Whole Foods Market Plain Bagels')?.kind, 'deletion');
  assert.strictEqual(classifyRisk('click_ref', 'Delete account', undefined, undefined, cart)?.kind, 'deletion');
});

test('Enter: the cart page is fine in a cart task, checkout pages still ask', () => {
  assert.strictEqual(riskForAction({ type: 'press', key: 'Enter' }, undefined, 'https://www.walmart.com/cart', cart), null);
  assert.strictEqual(riskForAction({ type: 'press', key: 'Enter' }, undefined, 'https://www.walmart.com/cart')?.kind, 'payment');
  assert.strictEqual(riskForAction({ type: 'press', key: 'Enter' }, undefined, 'https://www.walmart.com/checkout/review-order', cart)?.kind, 'payment');
});

test('recovery: deleting a cart line does not stop the task; clicking checkout still does', () => {
  const base = { goal: 'add milk to my cart', url: 'https://www.amazon.com/cart/localmarket', title: 'Shopping Cart', textSample: 'Whole Foods Market Cart '.repeat(20),
    elements: Array.from({ length: 30 }, (_, i) => ({ id: i, tag: 'a', text: `link ${i}` })), lastResult: { success: true }, lastActionType: 'click_ref',
    noEffectCount: 0, stepsOnSameUrl: 1, step: 3, blockedDomains: new Set<string>(), popupCloseAttempts: 0, commandRequiresThisSite: false };
  assert.notStrictEqual(diagnose({ ...base, cartTask: true, lastActionTargetText: 'Delete 365 by Whole Foods Market Plain Bagels' } as any).blocker, 'sensitive_action');
  assert.strictEqual(diagnose({ ...base, lastActionTargetText: 'Delete 365 by Whole Foods Market Plain Bagels' } as any).blocker, 'sensitive_action');
  assert.strictEqual(diagnose({ ...base, cartTask: true, lastActionTargetText: 'Proceed to checkout' } as any).blocker, 'sensitive_action');
});

test('recovery: after the brake asked (declined or approved) there is no second confirmation', () => {
  const base = { goal: 'add milk to my cart', url: 'https://www.walmart.com/cart', title: 'Cart', textSample: 'Cart '.repeat(50),
    elements: Array.from({ length: 30 }, (_, i) => ({ id: i, tag: 'a', text: `link ${i}` })), lastActionType: 'click_ref', lastActionTargetText: 'Continue to checkout',
    noEffectCount: 0, stepsOnSameUrl: 1, step: 5, blockedDomains: new Set<string>(), popupCloseAttempts: 0, commandRequiresThisSite: false, cartTask: true };
  assert.notStrictEqual(diagnose({ ...base, lastResult: { success: false, reason: 'user_cancelled' } } as any).blocker, 'sensitive_action');
  assert.notStrictEqual(diagnose({ ...base, lastResult: { success: true }, brakeAsked: true } as any).blocker, 'sensitive_action');
  assert.strictEqual(diagnose({ ...base, lastResult: { success: true } } as any).blocker, 'sensitive_action');
});
