// Partes do yt-dlp (media-parts.ts): pedaço .f313.webm nunca vira "download pronto", a decisão
// sucesso × falha (código de saída + arquivos + ffprobe), a escolha do contêiner pra juntar e o
// diário dos downloads interrompidos (só apaga o que o próprio download anotou, na pasta dele).
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  classifyRun, componentInfo, ffmpegMergeArgs, isComponentFile, isFinalMedia, isTempArtifact, leftoversToDelete,
  looksFormatUnavailable, mergeContainer, needsAudioCheck, pairForMerge, parseFfmpegInfo, parseFfprobeStreams,
  readJournal, writeJournal,
} from '../../src/main/media-parts.ts';

const D = '/Users/x/Downloads';
const BEAT = `${D}/Michael Jackson - Beat It (Official 4K Video) (2160p) [oRdxUFDoQe0]`;

test('component files: .f<id>.<ext> is a yt-dlp part, never a result', () => {
  assert.deepStrictEqual(componentInfo(`${BEAT}.f313.webm`), { base: BEAT, formatId: '313', ext: 'webm' });
  assert.ok(isComponentFile(`${BEAT}.f140.m4a`));
  assert.ok(isComponentFile(`${D}/clip.fhls-1080p.mp4`));
  assert.ok(isComponentFile(`${D}/manifest (240p) [manifest].f0.mp4`));
  assert.ok(!isComponentFile(`${BEAT}.mp4`));
  assert.ok(!isComponentFile(`${D}/Song.final.mp4`), 'a title word starting with f is not a format id');
  assert.ok(!isFinalMedia(`${BEAT}.f313.webm`));
  assert.ok(isFinalMedia(`${BEAT}.mp4`));
  assert.ok(isTempArtifact(`${BEAT}.temp.mp4`));
  assert.ok(!isFinalMedia(`${BEAT}.temp.mp4`));
  assert.ok(isTempArtifact(`${BEAT}.f313.webm.part`));
});

const has = (...files: string[]) => (p: string) => files.includes(p);

test('classifyRun: merged output + exit 0 → ok, stray parts are cleaned', () => {
  const r = classifyRun({ exitCode: 0, reported: [`${BEAT}.mp4`], written: [`${BEAT}.f313.webm`, `${BEAT}.f140.m4a`, `${BEAT}.mp4`], exists: has(`${BEAT}.mp4`) });
  assert.strictEqual(r.verdict, 'ok');
  assert.deepStrictEqual(r.finals, [`${BEAT}.mp4`]);
  assert.deepStrictEqual(r.cleanup, []);
});

test('classifyRun: the Beat It bug — killed after the video part, only .f313.webm left → not merged, removed', () => {
  const r = classifyRun({ exitCode: null, reported: [], written: [`${BEAT}.f313.webm`], exists: has(`${BEAT}.f313.webm`) });
  assert.strictEqual(r.verdict, 'not-merged');
  assert.deepStrictEqual(r.finals, []);
  assert.deepStrictEqual(r.cleanup, [`${BEAT}.f313.webm`]);
});

test('classifyRun: exit 0 but the reported/fallback path is a part → not merged (never success)', () => {
  const r = classifyRun({ exitCode: 0, reported: [`${BEAT}.f313.webm`], written: [`${BEAT}.f313.webm`, `${BEAT}.f140.m4a`], exists: has(`${BEAT}.f313.webm`, `${BEAT}.f140.m4a`) });
  assert.strictEqual(r.verdict, 'not-merged');
  assert.deepStrictEqual(r.finals, []);
  assert.deepStrictEqual(r.components.sort(), [`${BEAT}.f140.m4a`, `${BEAT}.f313.webm`]);
});

test('classifyRun: non-zero exit with nothing usable → failed; leftovers (partial single file) are ours to delete', () => {
  const r = classifyRun({ exitCode: 1, reported: [], written: [`${D}/a [x].mp4`], exists: has(`${D}/a [x].mp4`) });
  assert.strictEqual(r.verdict, 'failed');
  assert.deepStrictEqual(r.cleanup, [`${D}/a [x].mp4`]);
});

test('classifyRun: cleanup never includes files this download did not write', () => {
  const foreign = `${D}/someone else.f313.webm`;
  const r = classifyRun({ exitCode: 1, reported: [], written: [`${BEAT}.f313.webm`], exists: has(`${BEAT}.f313.webm`, foreign) });
  assert.ok(!r.cleanup.includes(foreign));
  const c = classifyRun({ exitCode: 0, cancelled: true, reported: [], written: [`${BEAT}.f313.webm`], exists: has(`${BEAT}.f313.webm`, foreign) });
  assert.strictEqual(c.verdict, 'cancelled');
  assert.deepStrictEqual(c.cleanup, [`${BEAT}.f313.webm`]);
});

test('classifyRun: playlist that stopped on item 3 keeps items 1-2', () => {
  const a = `${D}/a [1].mp3`, b = `${D}/b [2].mp3`, c = `${D}/c [3].f251.webm`;
  const r = classifyRun({ exitCode: 1, reported: [a, b], written: [a, b, c], exists: has(a, b, c) });
  assert.deepStrictEqual(r.finals, [a, b]);
  assert.deepStrictEqual(r.cleanup, [c]);
});

test('probe parsers: ffprobe csv and ffmpeg -i stderr', () => {
  assert.deepStrictEqual(parseFfprobeStreams('vp9,video\n'), { video: 'vp9', audio: null });
  assert.deepStrictEqual(parseFfprobeStreams('h264,video\naac,audio\n'), { video: 'h264', audio: 'aac' });
  assert.deepStrictEqual(parseFfprobeStreams('aac,audio\nmjpeg,video\n'), { video: 'mjpeg', audio: 'aac' });
  assert.deepStrictEqual(parseFfprobeStreams(''), { video: null, audio: null });
  const err = `Input #0, matroska,webm, from 'x.webm':\n  Stream #0:0(eng): Video: vp9 (Profile 0), yuv420p(tv), 3840x2160\n  Stream #0:1(eng): Audio: opus, 48000 Hz, stereo`;
  assert.deepStrictEqual(parseFfmpegInfo(err), { video: 'vp9', audio: 'opus' });
  assert.deepStrictEqual(parseFfmpegInfo(`Stream #0:0[0x1](und): Video: h264 (avc1 / 0x31637661)`), { video: 'h264', audio: null });
});

test('success needs sound only for a normal video request', () => {
  assert.strictEqual(needsAudioCheck({}), true);
  assert.strictEqual(needsAudioCheck({ audioOnly: true }), false);
  assert.strictEqual(needsAudioCheck({ videoOnly: true }), false);
  assert.ok(looksFormatUnavailable('ERROR: [generic] x: Requested format is not available. Use --list-formats'));
  assert.ok(!looksFormatUnavailable('ERROR: unable to download video data: HTTP Error 403'));
});

test('merge container and ffmpeg args', () => {
  assert.strictEqual(mergeContainer('vp9', 'aac'), 'mp4');
  assert.strictEqual(mergeContainer('h264', 'opus'), 'mp4');
  assert.strictEqual(mergeContainer('vp8', 'vorbis'), 'mkv');
  assert.strictEqual(mergeContainer('h264', 'vorbis'), 'mkv');
  const a = ffmpegMergeArgs('v.webm', 'a.m4a', 'o.temp.mp4', 'mp4');
  assert.deepStrictEqual(a.slice(a.indexOf('-map')), ['-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', 'o.temp.mp4']);
  assert.ok(ffmpegMergeArgs('v', 'a', 'o.temp.mkv', 'mkv').includes('matroska'));
});

test('pairForMerge: one complete video part + one complete audio part of the same video', () => {
  const v = { path: `${BEAT}.f313.webm`, probe: { video: 'vp9', audio: null }, complete: true };
  const a = { path: `${BEAT}.f140.m4a`, probe: { video: null, audio: 'aac' }, complete: true };
  assert.deepStrictEqual(pairForMerge([v, a]), { video: v.path, audio: a.path, base: BEAT });
  assert.strictEqual(pairForMerge([v, { ...a, complete: false }]), null, 'half-downloaded audio is never merged');
  assert.strictEqual(pairForMerge([v]), null);
  assert.strictEqual(pairForMerge([v, { ...a, path: `${D}/other [y].f140.m4a` }]), null, 'parts of different videos');
  assert.strictEqual(pairForMerge([{ ...v, probe: null }, a]), null);
});

test('journal: round trip, and leftovers are only recorded files inside the entry dir, newer than the download', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-journal-'));
  try {
    const file = path.join(tmp, 'media-downloads.json');
    assert.deepStrictEqual(readJournal(file), []);
    const dl = path.join(tmp, 'dl');
    fs.mkdirSync(dl);
    const startedAt = Date.now() - 60_000;
    const entry = {
      id: 'yt_1', dir: dl, startedAt,
      files: [path.join(dl, 'a [x].f313.webm'), path.join(dl, 'old.f140.m4a'), path.join(tmp, 'outside.f313.webm'), path.join(dl, 'gone.f1.m4a'), 'relative.f1.mp4', path.join(dl, 'sub', '..', '..', 'escape.f2.mp4')],
      meta: { kind: 'agent', url: 'https://example.com/v' },
    };
    writeJournal(file, [entry]);
    assert.deepStrictEqual(readJournal(file), [entry]);
    const stat = (p: string) => p.endsWith('gone.f1.m4a') ? null : { mtimeMs: p.endsWith('old.f140.m4a') ? startedAt - 3_600_000 : startedAt + 1000 };
    assert.deepStrictEqual(leftoversToDelete(entry, stat), [path.join(dl, 'a [x].f313.webm')]);
    writeJournal(file, []);
    assert.ok(!fs.existsSync(file));
    fs.writeFileSync(file, '{not json');
    assert.deepStrictEqual(readJournal(file), []);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
