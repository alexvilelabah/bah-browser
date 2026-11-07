// Política do agente pra alert/confirm: armado > alert fecha > confirm comum aceito > exclusão/pagamento pergunta.
import { test } from 'node:test';
import assert from 'node:assert';
import { agentDecision, armDialog, agentDialogsStart } from '../../src/renderer/js-dialogs.ts';

const d = (type: 'alert' | 'confirm' | 'prompt', message: string) => ({ id: 1, wcId: 7, type, message, defaultText: '', origin: 'https://shop.example' });

test('unarmed: alert closes, ordinary confirm is accepted, risky confirm goes to the user', () => {
  agentDialogsStart();
  assert.deepStrictEqual(agentDecision(d('alert', 'Saved!'))?.accept, true);
  assert.strictEqual(agentDecision(d('confirm', 'Continue to step 2?'))?.accept, true);
  assert.strictEqual(agentDecision(d('confirm', 'Delete this item permanently?')), null);
  assert.strictEqual(agentDecision(d('confirm', 'Place order now?')), null);
});

test('armed answer wins once, then expires back to the default', () => {
  agentDialogsStart();
  armDialog(7, false);
  const r = agentDecision(d('confirm', 'Delete this item permanently?'));
  assert.strictEqual(r?.accept, false);
  assert.match(r!.note, /as you armed it/);
  assert.strictEqual(agentDecision(d('confirm', 'Continue?'))?.accept, true);
});
