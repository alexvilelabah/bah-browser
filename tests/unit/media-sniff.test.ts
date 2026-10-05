// Botão "Baixar" em qualquer site: reconhecer o vídeo no tráfego da aba (estilo IDM),
// "mesmo site" e os cookies no formato que o yt-dlp lê.
import { test } from 'node:test';
import assert from 'node:assert';
import { classifyMediaResponse, MediaLog, sameSite, siteOf, toNetscapeCookies } from '../../src/main/media-sniff.ts';
import { buildVideoChoices, pickMediaEntry, youtubeVideoId } from '../../src/main/video-formats.ts';
import { buildGenericVideoButtonScript } from '../../src/main/generic-video-button-script.ts';
import { DEFAULT_VIDEO_BUTTON_LABELS } from '../../src/main/video-button-script.ts';

const resp = (url: string, headers: Record<string, string>, extra: Record<string, unknown> = {}) =>
  ({ url, statusCode: 200, resourceType: 'xhr', responseHeaders: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, [v]])), ...extra });

test('classifyMediaResponse: HLS e DASH pelo tipo ou pela extensão', () => {
  assert.strictEqual(classifyMediaResponse(resp('https://cdn.x.com/v/master.m3u8', {}))?.kind, 'hls');
  assert.strictEqual(classifyMediaResponse(resp('https://cdn.x.com/play?id=1', { 'Content-Type': 'application/vnd.apple.mpegurl' }))?.kind, 'hls');
  assert.strictEqual(classifyMediaResponse(resp('https://cdn.x.com/v/stream.mpd', {}))?.kind, 'dash');
});

test('classifyMediaResponse: arquivo de vídeo inteiro, com tamanho pelo Content-Range', () => {
  const m = classifyMediaResponse({ ...resp('https://cdn.x.com/v/filme.mp4', { 'content-type': 'video/mp4', 'content-range': 'bytes 0-1023/52428800' }), statusCode: 206, resourceType: 'media' });
  assert.deepStrictEqual(m, { url: 'https://cdn.x.com/v/filme.mp4', kind: 'file', mime: 'video/mp4', size: 52428800 });
});

test('classifyMediaResponse: pedaço de stream, prévia curta, YouTube e não-vídeo ficam de fora', () => {
  assert.strictEqual(classifyMediaResponse(resp('https://cdn.x.com/seg/001.ts', { 'content-type': 'video/mp2t' })), null);
  assert.strictEqual(classifyMediaResponse(resp('https://cdn.x.com/seg/001.m4s', { 'content-type': 'video/iso.segment' })), null);
  assert.strictEqual(classifyMediaResponse(resp('https://cdn.x.com/p.mp4', { 'content-type': 'video/mp4', 'content-length': '40000' })), null);
  assert.strictEqual(classifyMediaResponse(resp('https://scontent.cdninstagram.com/v.mp4?bytestart=0&byteend=999', { 'content-type': 'video/mp4' })), null);
  assert.strictEqual(classifyMediaResponse(resp('https://rr1.googlevideo.com/videoplayback?x=1', { 'content-type': 'video/mp4', 'content-length': '9000000' })), null);
  assert.strictEqual(classifyMediaResponse(resp('https://x.com/api.json', { 'content-type': 'application/json' })), null);
  assert.strictEqual(classifyMediaResponse({ ...resp('https://cdn.x.com/v.mp4', { 'content-type': 'video/mp4' }), statusCode: 404 }), null);
});

test('MediaLog: mais novo primeiro, sem repetir, só da página aberta', () => {
  const log = new MediaLog(3);
  log.add(7, { url: 'https://a/1.m3u8', kind: 'hls', mime: '', pageUrl: 'https://site/p1', at: 1 });
  log.add(7, { url: 'https://a/2.mp4', kind: 'file', mime: '', pageUrl: 'https://site/p2#t=3', at: 2 });
  log.add(7, { url: 'https://a/1.m3u8', kind: 'hls', mime: '', pageUrl: 'https://site/p2', at: 3 });
  assert.deepStrictEqual(log.list(7).map(m => m.url), ['https://a/1.m3u8', 'https://a/2.mp4']);
  assert.deepStrictEqual(log.list(7, 'https://site/p2').map(m => m.url), ['https://a/1.m3u8', 'https://a/2.mp4']);
  assert.deepStrictEqual(log.list(7, 'https://site/p1'), []);
  log.forget(7);
  assert.deepStrictEqual(log.list(7), []);
});

test('siteOf / sameSite: subdomínio é o mesmo site; com.br não junta sites diferentes', () => {
  assert.strictEqual(siteOf('g1.globo.com'), 'globo.com');
  assert.strictEqual(siteOf('www.uol.com.br'), 'uol.com.br');
  assert.strictEqual(siteOf('www.bbc.co.uk'), 'bbc.co.uk');
  assert.ok(sameSite('https://www.instagram.com/reel/ABC/', 'https://instagram.com/'));
  assert.ok(sameSite('https://twitter.com/a/status/1', 'https://x.com/home'));
  assert.ok(!sameSite('https://www.uol.com.br/x', 'https://www.terra.com.br/y'));
  assert.ok(!sameSite('https://evil.com/?u=instagram.com', 'https://www.instagram.com/'));
  assert.ok(!sameSite('lixo', 'https://x.com'));
});

test('toNetscapeCookies: domínio, subdomínios, HttpOnly, sessão e valor inválido', () => {
  const txt = toNetscapeCookies([
    { domain: '.instagram.com', path: '/', secure: true, httpOnly: true, expirationDate: 1893456000.5, name: 'sessionid', value: 'abc' },
    { domain: 'www.instagram.com', hostOnly: true, path: '/', secure: false, name: 'csrftoken', value: 'x' },
    { domain: '.instagram.com', name: 'quebrado', value: 'a\tb' },
  ]);
  assert.strictEqual(txt,
    '# Netscape HTTP Cookie File\n'
    + '#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t1893456000\tsessionid\tabc\n'
    + 'www.instagram.com\tFALSE\t/\tFALSE\t0\tcsrftoken\tx\n');
});

test('youtubeVideoId: player embutido (iframe) também vale', () => {
  assert.strictEqual(youtubeVideoId('https://www.youtube.com/embed/aqz-KE-bpKQ?autoplay=1'), 'aqz-KE-bpKQ');
  assert.strictEqual(youtubeVideoId('https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ'), 'aqz-KE-bpKQ');
});

test('buildVideoChoices fora do YouTube: carrossel usa a 1ª mídia; sem altura vira "Vídeo"', () => {
  const carrossel = { title: 'post', entries: [{ id: 'img' }, { id: 'v1', title: 'reel', formats: [
    { format_id: 'dash-720', vcodec: 'avc1.64001f', acodec: 'none', width: 720, height: 1280, filesize: 3e6 },
    { format_id: 'dash-a', vcodec: 'none', acodec: 'mp4a.40.2', filesize: 4e5 },
  ] }] };
  assert.strictEqual(pickMediaEntry(carrossel).id, 'v1');
  assert.deepStrictEqual(buildVideoChoices(carrossel).choices.map(c => c.label), ['720p', 'MP3']);

  const direto = { id: 'x', title: 'clip', formats: [{ format_id: '0', url: 'https://a/v.mp4', ext: 'mp4', vcodec: null, acodec: null, filesize: 9e6 }] };
  const c = buildVideoChoices(direto).choices;
  assert.deepStrictEqual(c.map(x => [x.key, x.kind, x.label]), [['best', 'video', ''], ['mp3', 'audio', 'MP3']]);
  assert.strictEqual(c[0].approxBytes, 9e6);
});

test('buildVideoChoices: sem tamanho informado (HLS da Globo) estima por taxa × duração', () => {
  const globo = { id: '15020472', title: 'JN', duration: 84, formats: [
    { format_id: 'hls-4407', protocol: 'm3u8_native', vcodec: 'avc1.640028', acodec: 'mp4a.40.2', width: 1920, height: 1080, tbr: 4407 },
    { format_id: 'hls-455', protocol: 'm3u8_native', vcodec: 'avc1.64001E', acodec: 'mp4a.40.2', width: 640, height: 360, tbr: 455 },
  ] };
  const by = Object.fromEntries(buildVideoChoices(globo).choices.map(c => [c.key, c.approxBytes]));
  assert.strictEqual(by.r1080, Math.round(4407 * 125 * 84));   // ~44 MiB, como o "~44.13MiB" do yt-dlp
  assert.strictEqual(by.r360, Math.round(455 * 125 * 84));
});

test('script dos outros sites compila, usa shadow DOM e não usa innerHTML', () => {
  const src = buildGenericVideoButtonScript(DEFAULT_VIDEO_BUTTON_LABELS);
  assert.doesNotThrow(() => new Function(src));
  assert.ok(src.includes("attachShadow({ mode: 'closed' })"));
  assert.ok(!/innerHTML/.test(src));
});
