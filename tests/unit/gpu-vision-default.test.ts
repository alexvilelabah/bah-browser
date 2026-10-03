import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasCapableGpu, defaultVisionMode } from '../../src/shared/vision.ts';

// // Vision ON by default punished machines with no GPU: a 2s step became 30s.

test('a real GPU is capable, software rasterisers are not', () => {
  assert.equal(hasCapableGpu({ gpuDevice: [{ vendor: 'nvidia', renderer: 'GeForce RTX 4070' }] }), true);
  assert.equal(hasCapableGpu({ gpuDevice: [{ vendor: 'apple', renderer: 'Apple M2' }] }), true);
  assert.equal(hasCapableGpu({ gpuDevice: [{ renderer: 'Intel(R) Arc(TM) A770' }] }), true);

  // The ones that ship on a headless or driverless Windows box.
  assert.equal(hasCapableGpu({ gpuDevice: [{ renderer: 'SwiftShader' }] }), false);
  assert.equal(hasCapableGpu({ gpuDevice: [{ renderer: 'llvmpipe (LLVM 15.0, 256 bits)' }] }), false);
  assert.equal(hasCapableGpu({ gpuDevice: [{ renderer: 'Microsoft Basic Render Driver' }] }), false);
});

test('unknown answers no', () => {
  assert.equal(hasCapableGpu(null), false);
  assert.equal(hasCapableGpu(undefined), false);
  assert.equal(hasCapableGpu({}), false);
  assert.equal(hasCapableGpu({ gpuDevice: [] }), false);
});

test('an explicit choice beats the hardware', () => {
  const noGpu = { gpuDevice: [{ renderer: 'SwiftShader' }] };
  // user turned it on -> on, even without a GPU (their machine, their call)
  assert.equal(defaultVisionMode({ visionMode: 'always' }, noGpu), 'always');
  assert.equal(defaultVisionMode({ vision: true }, noGpu), 'auto');
  // user turned it off -> off, even on a capable GPU
  assert.equal(defaultVisionMode({ visionMode: 'off' }, { gpuDevice: [{ renderer: 'Apple M3' }] }), 'off');
});

test('no choice: on with a GPU, off without', () => {
  assert.equal(defaultVisionMode({}, { gpuDevice: [{ renderer: 'NVIDIA GeForce RTX 3060' }] }), 'auto');
  assert.equal(defaultVisionMode({}, { gpuDevice: [{ renderer: 'SwiftShader' }] }), 'off');
  assert.equal(defaultVisionMode({}, null), 'off');
});
