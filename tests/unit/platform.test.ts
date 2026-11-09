import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM, ARCH, IS_MAC, IS_WINDOWS, IS_LINUX, shortcut } from '../../src/renderer/platform.ts';

// Fora do Electron, o sistema vem do próprio Node — nunca do navigator.
test('platform comes from the real process, not from the user agent', () => {
  assert.equal(PLATFORM, process.platform);
  assert.equal(ARCH, process.arch);
  assert.equal([IS_MAC, IS_WINDOWS, IS_LINUX].filter(Boolean).length <= 1, true);
  assert.equal(shortcut('⌘D', 'Ctrl+D'), process.platform === 'darwin' ? '⌘D' : 'Ctrl+D');
});
