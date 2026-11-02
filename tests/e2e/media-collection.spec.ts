import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

// Coleção ("todos os clipes do filme X"): o modelo acha e GUARDA a lista; o Bah pergunta a qualidade uma vez,
// baixa faixa por faixa (yt-dlp falso, sem rede) e termina com uma tabela.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const FFMPEG_DIR = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].find(d => fs.existsSync(path.join(d, 'ffmpeg')) && fs.existsSync(path.join(d, 'ffprobe')));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => { const r = spawnSync(path.join(FFMPEG_DIR!, 'ffmpeg'), ['-v', 'error', '-y', ...args]); if (r.status !== 0) throw new Error(String(r.stderr)); };

test('collection: the stored track list is downloaded by Bah, one by one, after one quality question', async () => {
  test.skip(process.platform === 'win32' || !FFMPEG_DIR, 'needs ffmpeg + ffprobe and a POSIX shell');
  test.setTimeout(180_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-coll-'));
  const fix = path.join(tmp, 'fix'), dl = path.join(tmp, 'dl'), ud = path.join(tmp, 'ud');
  for (const d of [fix, dl, ud]) fs.mkdirSync(d);
  ff(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10', '-t', '1', '-c:v', 'libvpx-vp9', '-b:v', '50k', '-an', path.join(fix, 'video.webm')]);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', '-c:a', 'aac', '-b:a', '32k', path.join(fix, 'audio.m4a')]);
  const fake = path.join(tmp, 'yt-dlp-fake');
  fs.writeFileSync(fake, `#!/bin/sh\nexec "${process.execPath}" "${path.join(ROOT, 'tests/fixtures/fake-yt-dlp.mjs')}" "$@"\n`, { mode: 0o755 });
  const script = [
    { type: 'store', key: 'tracks', value: ['Danger Zone', 'Take My Breath Away', 'Mighty Wings'] },
    { type: 'done', reason: 'MODEL SHOULD NOT GET HERE', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${ud}`, '--use-mock-keychain'],
    env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test', BAH_TEST_YTDLP: fake, FAKE_FIX_DIR: fix, FAKE_YTDLP_MODE: 'good' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate((d) => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); localStorage.setItem('dlDir', d); }, dl);
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('find all the music videos from the movie top gun with tom cruise and download them');
    await page.getByTestId('agent-command-input').press('Enter');
    // One quality question with the list.
    await expect(page.getByText(/3 music videos found/).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Take My Breath Away/).first()).toBeVisible();
    await page.getByRole('button', { name: /Smaller files/ }).last().click();
    // Bah downloads all three and finishes with a table; the model's own "done" never runs.
    await expect(page.getByText(/Downloaded 3 of 3 music videos from top gun/).first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('MODEL SHOULD NOT GET HERE')).toHaveCount(0);
    const prompts: string[] = await app.evaluate(() => (global as any).__e2ePrompts || []);
    expect(prompts.length).toBe(1);   // only the step that stored the list
  } finally { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
