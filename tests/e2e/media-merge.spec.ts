import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Bug do "Beat It" em 4K: o Bah entregava o pedaço de vídeo SEM SOM (.f313.webm) como download
// pronto. Com um yt-dlp falso (tests/fixtures/fake-yt-dlp.mjs) e arquivos minúsculos feitos com
// ffmpeg aqui mesmo (nada de rede, nada na pasta Downloads de verdade), prova que:
//  - pedaço solto (saída ≠ 0, ou 0 sem juntar) = FALHA "não foram juntados", e os pedaços somem;
//  - as duas partes completas sem merge → o Bah junta sozinho e o arquivo tem som;
//  - merge normal continua dando certo, com som; MP4 sem som → tenta de novo e conserta;
//  - fechar o Bah no meio mata o yt-dlp; no próximo boot os restos anotados somem (só eles) e a
//    lista mostra "Interrompido" com ↻, que baixa de novo.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const FFMPEG_DIR = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].find(d => fs.existsSync(path.join(d, 'ffmpeg')) && fs.existsSync(path.join(d, 'ffprobe')));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const URL_ = 'https://example.com/watch/fake';

function ff(args: string[]) {
  const r = spawnSync(path.join(FFMPEG_DIR!, 'ffmpeg'), ['-v', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}
function streams(file: string): string[] {
  const r = spawnSync(path.join(FFMPEG_DIR!, 'ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return r.stdout.split(/\s+/).filter(Boolean).sort();
}
const media = (dir: string) => fs.readdirSync(dir).filter(f => !f.startsWith('.')).sort();

test('yt-dlp parts are never reported as the download; merged result has sound; quit mid-download is cleaned up', async () => {
  test.skip(process.platform === 'win32' || !FFMPEG_DIR, 'needs ffmpeg + ffprobe (brew install ffmpeg) and a POSIX shell');
  test.setTimeout(240_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-merge-'));
  const fix = path.join(tmp, 'fix'), dl = path.join(tmp, 'dl'), other = path.join(tmp, 'other'), ud = path.join(tmp, 'ud');
  for (const d of [fix, dl, other, ud]) fs.mkdirSync(d);
  // Partes como as do YouTube: VP9 só imagem (.f313.webm) e AAC só som (.f140.m4a); e um MP4 mudo.
  ff(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10', '-t', '1', '-c:v', 'libvpx-vp9', '-b:v', '50k', '-an', path.join(fix, 'video.webm')]);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', '-c:a', 'aac', '-b:a', '32k', path.join(fix, 'audio.m4a')]);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-an', path.join(fix, 'silent.mp4')]);
  const fake = path.join(tmp, 'yt-dlp-fake');
  fs.writeFileSync(fake, `#!/bin/sh\nexec "${process.execPath}" "${path.join(ROOT, 'tests/fixtures/fake-yt-dlp.mjs')}" "$@"\n`, { mode: 0o755 });

  const { ELECTRON_RUN_AS_NODE: _n, ...baseEnv } = process.env;
  const launch = (mode: string) => electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, `--user-data-dir=${ud}`, '--use-mock-keychain'],
    env: { ...baseEnv, E2E_MOCK_AI: '1', NODE_ENV: 'test', BAH_TEST_YTDLP: fake, FAKE_FIX_DIR: fix, FAKE_YTDLP_MODE: mode },
  });
  const ready = async (app: ElectronApplication, first: boolean): Promise<Page> => {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    if (first) {
      await page.evaluate((d) => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); localStorage.setItem('dlDir', d); }, dl);
      await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    }
    // A pasta escolhida vale no processo principal (nunca a Downloads de verdade).
    expect(await page.evaluate((d) => (window as any).electronAPI.setDownloadDir(d), dl)).toBe(dl);
    return page;
  };
  const setMode = (app: ElectronApplication, mode: string) => app.evaluate((_e, m) => { process.env.FAKE_YTDLP_MODE = m; }, mode);
  const download = (page: Page) => page.evaluate((u) => (window as any).electronAPI.downloadVideo(u, false, 1, 'best'), URL_) as Promise<any>;
  const clearDl = () => { for (const f of fs.readdirSync(dl)) fs.rmSync(path.join(dl, f), { force: true }); };

  let app = await launch('video-only-fail');
  try {
    const page = await ready(app, true);

    // 1. Só o vídeo baixou e o yt-dlp saiu com erro: falha clara, pedaço apagado.
    let r = await download(page);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not joined/i);
    expect(media(dl)).toEqual([]);

    // 2. Saiu 0 mas não juntou (e o vídeo nem chegou ao fim): falha, nada de .f313 como resultado.
    await setMode(app, 'video-only-exit0');
    r = await download(page);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not joined/i);
    expect(media(dl)).toEqual([]);

    // 3. As duas partes completas, sem merge: o Bah junta (ffmpeg -c copy) e o MP4 tem som.
    await setMode(app, 'parts-exit0');
    r = await download(page);
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(path.basename(r.path)).toBe('Fake Clip [fake123].mp4');
    expect(streams(r.path)).toEqual(['audio', 'video']);
    expect(media(dl)).toEqual(['Fake Clip [fake123].mp4']);
    clearDl();

    // 4. Merge normal do yt-dlp (o caminho de sempre) continua sucesso, com som.
    await setMode(app, 'good');
    r = await download(page);
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(streams(r.path)).toEqual(['audio', 'video']);
    expect(media(dl)).toEqual(['Fake Clip [fake123].mp4']);
    clearDl();

    // 5. Veio um MP4 sem som: tenta 1× com o seletor que garante áudio e entrega o bom.
    await setMode(app, 'silent-then-good');
    r = await download(page);
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(streams(r.path)).toEqual(['audio', 'video']);
    expect(media(dl)).toEqual(['Fake Clip [fake123].mp4']);
    clearDl();

    // 6. Fecha o Bah no meio do vídeo (o caso do "Beat It").
    await setMode(app, 'hang');
    await page.evaluate((u) => { (window as any).electronAPI.downloadVideo(u, false, 1, 'best'); }, URL_);
    const part = path.join(dl, 'Fake Clip [fake123].f313.webm');
    await expect.poll(() => fs.existsSync(part), { timeout: 30_000 }).toBe(true);
    await sleep(500);
  } finally {
    await app.close();
  }
  // O yt-dlp (falso) não pode ter ficado órfão escrevendo em Downloads.
  await sleep(1500);
  const ps = spawnSync('ps', ['-axo', 'command='], { encoding: 'utf8' }).stdout;
  expect(ps.includes(path.join(ROOT, 'tests/fixtures/fake-yt-dlp.mjs')) && ps.includes(dl)).toBe(false);

  // Um download "de outra sessão" no diário: só o arquivo anotado, na pasta dele, pode sumir.
  const journal = path.join(ud, 'media-downloads.json');
  const entries = fs.existsSync(journal) ? JSON.parse(fs.readFileSync(journal, 'utf8')) : [];
  expect(entries.length).toBe(1);   // o do item 6 (interrompido) ficou anotado
  const old = path.join(dl, 'Old [x].f313.webm'), foreign = path.join(dl, 'Not Bah [y].f313.webm'), outside = path.join(other, 'Old [x].f140.m4a');
  for (const f of [old, foreign, outside]) fs.writeFileSync(f, 'x');
  fs.writeFileSync(path.join(dl, 'Fake Clip [fake123].f313.webm'), 'x');   // como se o yt-dlp tivesse deixado o pedaço
  entries.push({ id: 'ag_old_1', dir: dl, startedAt: Date.now() - 60_000, files: [old, outside], meta: { kind: 'agent', url: 'https://example.com/watch/old', opts: {}, label: 'Old clip.mp4' } });
  fs.writeFileSync(journal, JSON.stringify(entries));

  app = await launch('good');
  try {
    const page = await ready(app, false);
    expect(fs.existsSync(path.join(dl, 'Fake Clip [fake123].f313.webm'))).toBe(false);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(foreign)).toBe(true);    // não foi o Bah que anotou → fica
    expect(fs.existsSync(outside)).toBe(true);    // fora da pasta do download → fica
    expect(fs.existsSync(journal)).toBe(false);

    // A lista de Downloads mostra os dois como "Interrompido", com ↻.
    await page.locator('.menu-btn[title^="Downloads"]').click();
    const rows = page.locator('.dl-item', { hasText: 'Interrupted' });
    await expect(rows).toHaveCount(2);
    const row = page.locator('.dl-item', { hasText: 'example.com' });
    await expect(row).toContainText('Interrupted');
    await row.locator('button[title="Retry"]').click();
    // Refeito: a mesma linha agora tem o nome de verdade e "Concluído".
    await expect(page.locator('.dl-item', { hasText: 'Fake Clip [fake123].mp4' })).toContainText('Done', { timeout: 30_000 });
    expect(media(dl)).toEqual(['Fake Clip [fake123].mp4', 'Not Bah [y].f313.webm']);
    expect(streams(path.join(dl, 'Fake Clip [fake123].mp4'))).toEqual(['audio', 'video']);
  } finally {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// O yt-dlp DE VERDADE com os argumentos do Bah (inclusive --no-quiet e o --print BAHSRC), num
// DASH local de 3 s (vídeo e áudio em faixas separadas, como o YouTube): baixa as duas partes,
// junta com o ffmpeg e o Bah confere que o MP4 tem som. Sem rede.
test('real yt-dlp: separate video/audio DASH tracks are merged and the result has sound', async () => {
  const YTDLP = ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp'].find(p => fs.existsSync(p));
  test.skip(process.platform === 'win32' || !FFMPEG_DIR || !YTDLP, 'needs yt-dlp + ffmpeg (brew install yt-dlp ffmpeg)');
  test.setTimeout(180_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-mpd-'));
  const srv = path.join(tmp, 'srv'), dl = path.join(tmp, 'dl'), ud = path.join(tmp, 'ud');
  for (const d of [srv, dl, ud]) fs.mkdirSync(d);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '3',
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-b:a', '64k',
    '-f', 'dash', '-seg_duration', '1', '-adaptation_sets', 'id=0,streams=v id=1,streams=a', path.join(srv, 'manifest.mpd')]);
  const server = http.createServer((q, res) => {
    const f = path.join(srv, path.basename(decodeURIComponent((q.url || '/').split('?')[0])));
    if (!fs.existsSync(f)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', f.endsWith('.mpd') ? 'application/dash+xml' : 'video/iso.segment');
    fs.createReadStream(f).pipe(res);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/manifest.mpd`;
  const { ELECTRON_RUN_AS_NODE: _n, BAH_TEST_YTDLP: _f, ...baseEnv } = process.env;
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, `--user-data-dir=${ud}`, '--use-mock-keychain'],
    env: { ...baseEnv, E2E_MOCK_AI: '1', NODE_ENV: 'test' },
  });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    expect(await page.evaluate((d) => (window as any).electronAPI.setDownloadDir(d), dl)).toBe(dl);
    const r = await page.evaluate((u) => (window as any).electronAPI.downloadVideo(u, false, 1, 'best'), url) as any;
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(r.path.startsWith(dl)).toBe(true);
    expect(r.path).toMatch(/\.mp4$/);
    expect(streams(r.path)).toEqual(['audio', 'video']);
    expect(media(dl)).toEqual([path.basename(r.path)]);   // nenhum .f0/.f1 sobrando
    expect(fs.existsSync(path.join(ud, 'media-downloads.json'))).toBe(false);   // diário limpo no fim
  } finally {
    await app.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
