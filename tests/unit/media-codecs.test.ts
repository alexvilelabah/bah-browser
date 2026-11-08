// Codecs do arquivo baixado → rótulo + se o QuickTime abre (senão, recomenda VLC).
import { test } from 'node:test';
import assert from 'node:assert';
import { codecReport } from '../../src/shared/media-codecs.ts';

test('4K YouTube (AV1 + Opus) plays in VLC, not QuickTime; H.264 + AAC plays everywhere', () => {
  assert.deepEqual(codecReport('av1', 'opus'), { label: 'AV1 video + Opus audio', quicktime: false, blocker: 'AV1' });
  assert.deepEqual(codecReport('vp9', 'aac'), { label: 'VP9 video + AAC audio', quicktime: false, blocker: 'VP9' });
  assert.deepEqual(codecReport('h264', 'aac'), { label: 'H.264 video + AAC audio', quicktime: true, blocker: '' });
  assert.deepEqual(codecReport('h264', 'opus'), { label: 'H.264 video + Opus audio', quicktime: false, blocker: 'Opus' });
  assert.deepEqual(codecReport(null, 'mp3'), { label: 'MP3 audio', quicktime: true, blocker: '' });
  assert.equal(codecReport(null, null), null);
});
