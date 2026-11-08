// Freio numa tarefa AGENDADA (ninguém olhando): mandar/publicar/reservar também espera a pessoa.
import { test } from 'node:test';
import assert from 'node:assert';
import { classifyRisk, riskForAction } from '../../src/renderer/risk.ts';

test('unattended: a bare Send / Post / Book asks; attended it does not', () => {
  for (const label of ['Send', 'Post', 'Publish now', 'Book', 'Reserve table', 'Place your order', 'Enviar', 'Publicar', 'Confirmar reserva']) {
    assert.ok(classifyRisk('click_ref', label, undefined, undefined, { unattended: true }), label);
  }
  assert.equal(classifyRisk('click_ref', 'Send', undefined, undefined, {}), null);
  assert.equal(riskForAction({ type: 'click_text', text: 'Send' }, undefined, undefined, { unattended: true })?.kind, 'sending');
});

test('unattended: reading and navigating still run on their own', () => {
  for (const label of ['Search', 'Next page', 'Show more jobs', 'Recommended for you', 'Sign in to see more', 'Sort by date']) {
    assert.equal(classifyRisk('click_ref', label, undefined, undefined, { unattended: true }), null, label);
  }
  assert.equal(classifyRisk('fill_ref', 'Search jobs', undefined, undefined, { unattended: true }), null);
});
