// Medidor do computador: a conta do uso da CPU e a leitura da linha do nvidia-smi.
import { test } from 'node:test';
import assert from 'node:assert';
import { cpuPercent, cpuTimes, parseNvidiaSmi } from '../../src/main/hw-stats.ts';

const core = (user: number, idle: number) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } });

test('cpuPercent: parte ocupada do tempo entre duas leituras, somando os núcleos', () => {
  const a = cpuTimes([core(100, 900), core(100, 900)]);
  const b = cpuTimes([core(150, 950), core(200, 900)]);   // +50/+50 num, +100/+0 no outro
  assert.strictEqual(cpuPercent(a, b), 75);                // 150 ocupado de 200
  assert.strictEqual(cpuPercent(a, a), null);              // sem tempo passado
});

test('parseNvidiaSmi: linha da RTX vira números (GB, °C, W)', () => {
  const g = parseNvidiaSmi('0, 14994, 16303, 26, 30.06, NVIDIA GeForce RTX 5070 Ti');
  assert.ok(g);
  assert.strictEqual(g!.util, 0);
  assert.strictEqual(Math.round(g!.memUsedGb * 10) / 10, 14.6);
  assert.strictEqual(Math.round(g!.memTotalGb * 10) / 10, 15.9);
  assert.strictEqual(g!.temp, 26);
  assert.strictEqual(g!.watts, 30.06);
  assert.strictEqual(g!.name, 'NVIDIA GeForce RTX 5070 Ti');
});

test('parseNvidiaSmi: campo que a placa não informa vira null; lixo vira null', () => {
  const g = parseNvidiaSmi('35, 2048, 8192, [N/A], [Not Supported], Quadro');
  assert.strictEqual(g?.temp, null);
  assert.strictEqual(g?.watts, null);
  assert.strictEqual(parseNvidiaSmi(''), null);
  assert.strictEqual(parseNvidiaSmi('No devices were found'), null);
});
