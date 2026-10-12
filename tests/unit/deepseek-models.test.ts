// DeepSeek: o Bah usa o Flash (rápido e barato), nunca cai no Pro por causa de um nome antigo.
import { test } from 'node:test';
import assert from 'node:assert';
import { chooseDeepSeekModel, isModelMissingError } from '../../src/main/deepseek-models.ts';

test('chooseDeepSeekModel: o nome novo do Flash ganha; o Pro não é escolhido sozinho', () => {
  // lista de hoje: o v4-flash saiu, ficou deepseek-flash + v4-pro (era aqui que caía no Pro)
  assert.strictEqual(chooseDeepSeekModel(new Set(['deepseek-flash', 'deepseek-v4-pro'])), 'deepseek-flash');
  // lista antiga
  assert.strictEqual(chooseDeepSeekModel(new Set(['deepseek-v4-flash', 'deepseek-v4-pro'])), 'deepseek-v4-flash');
  // as duas: o atual primeiro
  assert.strictEqual(chooseDeepSeekModel(new Set(['deepseek-v4-flash', 'deepseek-flash'])), 'deepseek-flash');
  // um nome novo de Flash amanhã
  assert.strictEqual(chooseDeepSeekModel(new Set(['deepseek-v5-flash', 'deepseek-v4-pro'])), 'deepseek-v5-flash');
  // experimental não conta
  assert.strictEqual(chooseDeepSeekModel(new Set(['deepseek-flash-vision-exp', 'deepseek-v4-pro'])), 'deepseek-flash');
  // sem lista (a consulta falhou): Flash pelo nome atual
  assert.strictEqual(chooseDeepSeekModel(null), 'deepseek-flash');
  // só o Pro na lista: ainda tenta o Flash (é aceito mesmo fora da lista)
  assert.strictEqual(chooseDeepSeekModel(new Set(['deepseek-v4-pro'])), 'deepseek-flash');
});

test('chooseDeepSeekModel: Flash que respondeu "não existe" sai; todos fora → Pro', () => {
  const list = new Set(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro']);
  assert.strictEqual(chooseDeepSeekModel(list, new Set(['deepseek-flash'])), 'deepseek-v4-flash');
  assert.strictEqual(chooseDeepSeekModel(list, new Set(['deepseek-flash', 'deepseek-v4-flash'])), 'deepseek-v4-pro');
  assert.strictEqual(chooseDeepSeekModel(null, new Set(['deepseek-flash', 'deepseek-v4-flash'])), 'deepseek-v4-pro');
});

test('isModelMissingError: só "modelo não existe", não qualquer erro que fale em "model"', () => {
  assert.strictEqual(isModelMissingError(404, ''), true);
  assert.strictEqual(isModelMissingError(400, '{"error":{"message":"Model Not Exist","code":"model_not_found"}}'), true);
  assert.strictEqual(isModelMissingError(400, 'The model `deepseek-x` does not exist'), true);
  assert.strictEqual(isModelMissingError(503, 'The model is overloaded, please try again later'), false);
  assert.strictEqual(isModelMissingError(400, "This model's maximum context length is 131072 tokens"), false);
  assert.strictEqual(isModelMissingError(429, 'Rate limit reached for model deepseek-flash'), false);
});
