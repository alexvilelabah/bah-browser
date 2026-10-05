// Botão "Baixar" do YouTube: id do vídeo pela URL, lista de resoluções com tamanho a
// partir do JSON real do yt-dlp (Big Buck Bunny 4K, trecho), soma do progresso das
// partes e o script injetado (compila e não deixa texto virar código).
import { test } from 'node:test';
import assert from 'node:assert';
import { youtubeVideoId, buildVideoChoices, formatBytes, PartsProgress, selectorArgs } from '../../src/main/video-formats.ts';
import { buildVideoButtonScript, sanitizeVideoButtonLabels, DEFAULT_VIDEO_BUTTON_LABELS } from '../../src/main/video-button-script.ts';

test('youtubeVideoId: watch, shorts, live, youtu.be — e nada fora disso', () => {
  assert.strictEqual(youtubeVideoId('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30s'), 'aqz-KE-bpKQ');
  assert.strictEqual(youtubeVideoId('https://m.youtube.com/watch?v=aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
  assert.strictEqual(youtubeVideoId('https://www.youtube.com/shorts/15XhVwLeopc'), '15XhVwLeopc');
  assert.strictEqual(youtubeVideoId('https://www.youtube.com/live/15XhVwLeopc?si=x'), '15XhVwLeopc');
  assert.strictEqual(youtubeVideoId('https://youtu.be/aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
  assert.strictEqual(youtubeVideoId('https://www.youtube.com/'), null);
  assert.strictEqual(youtubeVideoId('https://www.youtube.com/results?search_query=x'), null);
  assert.strictEqual(youtubeVideoId('https://www.youtube.com/watch?v=curto'), null);
  assert.strictEqual(youtubeVideoId('https://www.youtube.com.evil.com/watch?v=aqz-KE-bpKQ'), null);
  assert.strictEqual(youtubeVideoId('javascript:alert(1)'), null);
});

// Formatos de verdade (yt-dlp -J, 2026-10-04), cortados ao que importa.
const BBB = {
  id: 'aqz-KE-bpKQ',
  title: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film',
  duration: 635,
  formats: [
    { format_id: '139', acodec: 'mp4a.40.5', vcodec: 'none', abr: 48, filesize: 3871021 },
    { format_id: '140-drc', acodec: 'mp4a.40.2', vcodec: 'none', abr: 129, filesize: 10271496 },
    { format_id: '140', acodec: 'mp4a.40.2', vcodec: 'none', abr: 129, filesize: 10271496 },
    { format_id: '251', acodec: 'opus', vcodec: 'none', abr: 128, filesize: 10202210 },
    { format_id: '160', vcodec: 'avc1.4d400c', acodec: 'none', width: 256, height: 144, fps: 30, protocol: 'https', filesize: 4323893 },
    { format_id: '269', vcodec: 'avc1.4D400C', acodec: 'none', width: 256, height: 144, fps: 30, protocol: 'm3u8_native' },
    { format_id: '394', vcodec: 'av01.0.00M.08', acodec: 'none', width: 256, height: 144, fps: 30, protocol: 'https', filesize: 4639733 },
    { format_id: '134', vcodec: 'avc1.4d401e', acodec: 'none', width: 640, height: 360, fps: 30, protocol: 'https', filesize: 18294110 },
    { format_id: '298', vcodec: 'avc1.4d4020', acodec: 'none', width: 1280, height: 720, fps: 60, protocol: 'https', filesize: 150524867 },
    { format_id: '299', vcodec: 'avc1.64002a', acodec: 'none', width: 1920, height: 1080, fps: 60, protocol: 'https', filesize: 257619653 },
    { format_id: '303', vcodec: 'vp9', acodec: 'none', width: 1920, height: 1080, fps: 60, protocol: 'https', filesize: 168736189 },
    { format_id: '399', vcodec: 'av01.0.09M.08', acodec: 'none', width: 1920, height: 1080, fps: 60, protocol: 'https', filesize: 124386876 },
    { format_id: '308', vcodec: 'vp9', acodec: 'none', width: 2560, height: 1440, fps: 60, protocol: 'https', filesize: 473363704 },
    { format_id: '400', vcodec: 'av01.0.12M.08', acodec: 'none', width: 2560, height: 1440, fps: 60, protocol: 'https', filesize: 312554313 },
    { format_id: '315', vcodec: 'vp9', acodec: 'none', width: 3840, height: 2160, fps: 60, protocol: 'https', filesize: 1362269481 },
    { format_id: '401', vcodec: 'av01.0.13M.08', acodec: 'none', width: 3840, height: 2160, fps: 60, protocol: 'https', filesize: 712445280 },
    { format_id: 'sb0', vcodec: 'none', acodec: 'none', width: 48, height: 27, protocol: 'mhtml' },
  ],
};

test('buildVideoChoices: maior resolução primeiro, MP3 no fim, rótulo estilo YouTube', () => {
  const c = buildVideoChoices(BBB);
  assert.strictEqual(c.title, BBB.title);
  assert.deepStrictEqual(c.choices.map(x => x.label), ['2160p60', '1440p60', '1080p60', '720p60', '360p', '144p', 'MP3']);
  assert.deepStrictEqual(c.choices.map(x => x.key), ['r2160', 'r1440', 'r1080', 'r720', 'r360', 'r144', 'mp3']);
  assert.deepStrictEqual(c.choices.map(x => x.hint), ['4K', '2K', 'Full HD', 'HD', undefined, undefined, undefined]);
});

test('buildVideoChoices: tamanho = o vídeo que o yt-dlp escolhe (H.264 quando existe) + áudio AAC sem DRC', () => {
  const by = Object.fromEntries(buildVideoChoices(BBB).choices.map(x => [x.key, x.approxBytes]));
  assert.strictEqual(by.r1080, 257619653 + 10271496);   // 299 (avc1), não o AV1 menor
  assert.strictEqual(by.r1440, 473363704 + 10271496);   // sem H.264 → VP9 antes de AV1
  assert.strictEqual(by.r2160, 1362269481 + 10271496);
  assert.strictEqual(by.r144, 4323893 + 10271496);      // https antes do m3u8
  assert.strictEqual(by.mp3, Math.round(635 * 245000 / 8));
});

test('buildVideoChoices: Short em pé usa o lado menor (1080x1920 = 1080p)', () => {
  const c = buildVideoChoices({ id: 'x', title: 's', duration: 30, formats: [
    { format_id: '137', vcodec: 'avc1', acodec: 'none', width: 1080, height: 1920, fps: 30, protocol: 'https', filesize: 9e6 },
    { format_id: '140', vcodec: 'none', acodec: 'mp4a.40.2', abr: 129, filesize: 5e5 },
  ] });
  assert.deepStrictEqual(c.choices.map(x => x.label), ['1080p', 'MP3']);
});

test('buildVideoChoices: JSON vazio ou estranho não quebra', () => {
  assert.deepStrictEqual(buildVideoChoices(null).choices, []);
  assert.deepStrictEqual(buildVideoChoices({ formats: 'x' }).choices, []);
});

test('selectorArgs: resolução escolhida, H.264+AAC primeiro, MP4', () => {
  assert.deepStrictEqual(selectorArgs(1080, true), ['-f', 'bv*+ba/b', '-S', 'res:1080,+codec:avc:m4a', '--merge-output-format', 'mp4']);
  assert.deepStrictEqual(selectorArgs(720, false), ['-f', 'b', '-S', 'res:720,+codec:avc:m4a']);
});

test('formatBytes: MB/GB com o separador do idioma', () => {
  assert.strictEqual(formatBytes(257619653 + 10271496, ','), '255 MB');
  assert.strictEqual(formatBytes(1362269481 + 10271496, ','), '1,3 GB');
  assert.strictEqual(formatBytes(14_200_000, '.'), '13.5 MB');
  assert.strictEqual(formatBytes(undefined), '');
});

test('PartsProgress: vídeo e áudio somam numa barra só, sem voltar pra trás', () => {
  const p = new PartsProgress(100);
  p.update('299', 50, 80);
  assert.deepStrictEqual(p.snapshot(), { bytes: 50, totalBytes: 100, percent: 50 });
  p.update('299', 80, 80);
  p.update('140', 10, 20);
  assert.strictEqual(p.snapshot().percent, 90);
  p.update('140', 20, undefined);   // total "NA" no fim: mantém o último conhecido
  assert.deepStrictEqual(p.snapshot(), { bytes: 100, totalBytes: 100, percent: 100 });
});

test('script injetado compila e texto da tradução não vira código', () => {
  const evil = { ...DEFAULT_VIDEO_BUTTON_LABELS, btn: "'); throw new Error('x'); //", title: '</script><img src=x onerror=alert(1)>`${1}`' };
  const src = buildVideoButtonScript(sanitizeVideoButtonLabels(evil));
  assert.doesNotThrow(() => new Function(src));
  assert.ok(src.includes(JSON.stringify(evil.btn)));
  assert.ok(!/innerHTML/.test(src), 'YouTube exige Trusted Types: nada de innerHTML');
});

test('sanitizeVideoButtonLabels: só string curta; o resto cai no padrão', () => {
  const l = sanitizeVideoButtonLabels({ btn: 'Baixar', title: 42, loading: 'x'.repeat(500), extra: 'y' });
  assert.strictEqual(l.btn, 'Baixar');
  assert.strictEqual(l.title, DEFAULT_VIDEO_BUTTON_LABELS.title);
  assert.strictEqual(l.loading, DEFAULT_VIDEO_BUTTON_LABELS.loading);
  assert.ok(!('extra' in l));
});
