import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

// Coleção ("todos os clipes do filme X"): o modelo acha e GUARDA a lista; o Bah pede uma confirmação,
// baixa faixa por faixa (yt-dlp falso, sem rede) e termina com o resultado de cada uma. Cada busca leva título + artista
// (+ ano da obra quando se sabe). Com o roteador local (aqui, falso: E2E_FAKE_ROUTER_EXPAND), o pedido
// ambíguo vira um texto preciso ("Understood as: …") que vai pro modelo grande junto do original.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const FFMPEG_DIR = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].find(d => fs.existsSync(path.join(d, 'ffmpeg')) && fs.existsSync(path.join(d, 'ffprobe')));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => { const r = spawnSync(path.join(FFMPEG_DIR!, 'ffmpeg'), ['-v', 'error', '-y', ...args]); if (r.status !== 0) throw new Error(String(r.stderr)); };

const COMMAND = 'find all the music videos from the movie top gun with tom cruise and download them';
const TRACKS = ['Danger Zone — Kenny Loggins', 'Take My Breath Away — Berlin', 'Mighty Wings — Cheap Trick'];
const EXPANDED = 'find all the music videos from the soundtrack of the 1986 film Top Gun (Tom Cruise), not Top Gun: Maverick (2022), and download them';

async function runCollection(opts: { fakeExpand?: string }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-coll-'));
  const fix = path.join(tmp, 'fix'), dl = path.join(tmp, 'dl'), ud = path.join(tmp, 'ud');
  for (const d of [fix, dl, ud]) fs.mkdirSync(d);   // perfil novo: sem models/ → sem roteador de verdade
  ff(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10', '-t', '1', '-c:v', 'libvpx-vp9', '-b:v', '50k', '-an', path.join(fix, 'video.webm')]);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', '-c:a', 'aac', '-b:a', '32k', path.join(fix, 'audio.m4a')]);
  const fake = path.join(tmp, 'yt-dlp-fake');
  fs.writeFileSync(fake, `#!/bin/sh\nexec "${process.execPath}" "${path.join(ROOT, 'tests/fixtures/fake-yt-dlp.mjs')}" "$@"\n`, { mode: 0o755 });
  const ytLog = path.join(tmp, 'yt-dlp-args.jsonl');
  const script = [
    { type: 'store', key: 'tracks', value: TRACKS },
    { type: 'done', reason: 'MODEL SHOULD NOT GET HERE', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, E2E_FAKE_ROUTER_EXPAND: _f, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${ud}`, '--use-mock-keychain'],
    env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test', BAH_TEST_YTDLP: fake, FAKE_FIX_DIR: fix, FAKE_YTDLP_MODE: 'good', FAKE_YTDLP_LOG: ytLog,
      ...(opts.fakeExpand !== undefined ? { E2E_FAKE_ROUTER_EXPAND: opts.fakeExpand } : {}) } });
  const cleanup = async () => { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); };
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate((d) => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); localStorage.setItem('dlDir', d); }, dl);
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill(COMMAND);
    await page.getByTestId('agent-command-input').press('Enter');
    // One confirmation card with the list.
    await expect(page.getByText(/3 music videos found/).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Take My Breath Away/).first()).toBeVisible();
    await page.locator('.confirm-yes').last().click();
    // Bah downloads all three and reports each one; the model's own "done" never runs.
    await expect(page.getByText(/Downloaded 3 of 3 music videos from top gun/).first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('MODEL SHOULD NOT GET HERE')).toHaveCount(0);
    const prompts: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
    expect(prompts.length).toBe(1);   // only the step that stored the list
    const queries = fs.readFileSync(ytLog, 'utf8').trim().split('\n').map(l => JSON.parse(l) as string[])
      .map(a => (a.find(x => x.startsWith('ytsearch')) || '').replace(/^ytsearch\d*:/, '')).filter(Boolean);   // o main alarga o poço (ytsearchN)
    const understoodShown = await page.getByText(/Understood as:/).count();
    return { page, prompts, queries, understoodShown, cleanup };
  } catch (e) { await cleanup(); throw e; }
}

test('collection: the stored track list is downloaded by Bah, one by one, after one confirmation (no routing model)', async () => {
  test.skip(process.platform === 'win32' || !FFMPEG_DIR, 'needs ffmpeg + ffprobe and a POSIX shell');
  test.setTimeout(180_000);
  const r = await runCollection({});
  try {
    // Sem modelo de roteamento: nada de "Understood as", o pedido vai como está.
    expect(r.understoodShown).toBe(0);
    expect(r.prompts[0]).toContain(`GOAL: ${COMMAND}`);
    expect(r.prompts[0]).not.toContain('UNDERSTOOD AS (');
    // Cada busca leva título + artista (o ano não é conhecido aqui).
    expect(r.queries).toEqual([
      'Danger Zone Kenny Loggins top gun official music video',
      'Take My Breath Away Berlin top gun official music video',
      'Mighty Wings Cheap Trick top gun official music video',
    ]);
  } finally { await r.cleanup(); }
});

test('collection: the local router makes the request precise — "Understood as" in the feed, both texts to the big model, year in every query', async () => {
  test.skip(process.platform === 'win32' || !FFMPEG_DIR, 'needs ffmpeg + ffprobe and a POSIX shell');
  test.setTimeout(180_000);
  const r = await runCollection({ fakeExpand: JSON.stringify({ understood: EXPANDED }) });
  try {
    expect(r.understoodShown).toBeGreaterThan(0);
    await expect(r.page.getByText(/Understood as: .*1986 film Top Gun/).first()).toBeVisible();
    expect(r.prompts[0]).toContain(`GOAL: ${COMMAND}`);
    expect(r.prompts[0]).toContain('UNDERSTOOD AS (');
    expect(r.prompts[0]).toContain(EXPANDED);
    expect(r.queries).toEqual([
      'Danger Zone Kenny Loggins top gun 1986 official music video',
      'Take My Breath Away Berlin top gun 1986 official music video',
      'Mighty Wings Cheap Trick top gun 1986 official music video',
    ]);
  } finally { await r.cleanup(); }
});

test('collection: a bad expansion (changes the intent) is dropped and the original request is used', async () => {
  test.skip(process.platform === 'win32' || !FFMPEG_DIR, 'needs ffmpeg + ffprobe and a POSIX shell');
  test.setTimeout(180_000);
  const r = await runCollection({ fakeExpand: JSON.stringify({ understood: 'find all the music videos from the 1986 film Top Gun (Tom Cruise) and buy them' }) });
  try {
    expect(r.understoodShown).toBe(0);
    expect(r.prompts[0]).not.toContain('UNDERSTOOD AS (');
    expect(r.queries.every(q => !q.includes('1986'))).toBe(true);
  } finally { await r.cleanup(); }
});
