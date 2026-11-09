// ─────────────────────────────────────────────────────────────────────────────
// DEMO RECORDER (macOS) — records ONLY the Bah window, from inside Electron. Never the screen:
// no desktopCapturer, no avfoundation, no screencapture, no screen-recording permission.
//
//   record  Launches Bah (temp profile, mock keychain, local models only), runs each scene with
//           the REAL agent, and captures the window ~12 fps: mainWindow.webContents.capturePage()
//           for the shell, plus the active <webview> guest's own capturePage() composited at its
//           on-screen rect wherever the shell shows the webview's key colour (the guest isn't
//           always part of the shell capture). Frames + markers go to <take>/<scene>/.
//   edit    Turns a take into assets/demo.mp4 (+ assets/demo.gif): speeds up the waiting between
//           markers, cuts dead time, adds a title card and a caption per scene.
//
// Usage (Electron only under the shared e2e lock):
//   lockf -t 14400 /tmp/bah-e2e.lock node tools/record-demo-mac.mjs record --take ~/build/bah-demo-takes/take1 [mj hotel prices steam]
//   node tools/record-demo-mac.mjs edit --take ~/build/bah-demo-takes/take1 [--out assets] [--only mj,hotel]
//
// Models: main = llama.cpp on darkstar (LLM / MODEL env to override); router = the local
// Qwen2.5-1.5B gguf (ROUTER_GGUF), symlinked read-only into the temp profile. No cloud provider.
// Downloads go to a temp folder that is deleted at the end (Steam's partial file included).
// Captions are rendered as PNGs with Python/Pillow (Homebrew's ffmpeg 9 has no drawtext).
// ─────────────────────────────────────────────────────────────────────────────
import { _electron as electron } from '@playwright/test';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const expand = (p) => p && p.replace(/^~(?=\/|$)/, os.homedir());
const take = path.resolve(expand(opt('take', path.join(os.homedir(), 'build/bah-demo-takes/take'))));
fs.mkdirSync(path.join(take, 'prompts'), { recursive: true });

const LOCAL = { enabled: true, provider: 'openai-compatible', baseUrl: process.env.LLM || 'http://darkstar:8080', model: process.env.MODEL || 'unsloth/Qwen3-VL-8B-Instruct-GGUF:Q4_K_M' };
const ROUTER_GGUF = process.env.ROUTER_GGUF || path.join(os.homedir(), 'Library/Application Support/bah-browser-agent-test/models/qwen2.5-1.5b-instruct-q4_k_m.gguf');
const START = 'https://www.bing.com/';
const WIN = { w: 1440, h: 900 };
const FPS = 12;
const FRAME_W = 1920;   // takes are encoded 1920 wide (the window is 1440 pt = 2880 px on Retina)
const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find(p => fs.existsSync(p)) || 'ffmpeg';

// ── Scenes. `focus` = markers the edit keeps at 1× (the rest is sped up / trimmed). ──
export const SCENES = {
  mj: {
    cmd: "Find Michael Jackson's most famous songs and download all of their music videos, just the top 3",
    caption: 'Finds the 3 most famous Michael Jackson music videos and downloads them',
    budget: 42, limitMin: 25, quality: 'low', showDownloads: true,   // ≤480p: the 4K Thriller alone was 647 MB
  },
  hotel: {
    cmd: process.env.HOTEL_CMD || 'find a hotel in Los Angeles for next weekend under $200 a night on Booking.com',
    caption: 'Hotel search: compares the options and stops before booking',
    budget: 20, limitMin: 10,
  },
  prices: {
    cmd: 'compare prices for AirPods Pro on Amazon and other stores',
    caption: 'Visits Amazon, Best Buy, Walmart and Target, reads each price, and compares them in one table',
    budget: 20, limitMin: 10,
  },
  steam: {
    cmd: 'download Steam for this Mac',
    caption: "Downloads software from the vendor's own site",
    budget: 16, limitMin: 8, cancelDownload: true,
  },
  news: {
    cmd: process.env.NEWS_CMD || "summarize today's top tech news on Hacker News",
    caption: "Today's top tech news, summarized",
    budget: 18, limitMin: 8,
  },
  flight: {
    cmd: 'find the cheapest flight from SFO to JFK next Friday',
    caption: 'Finds the cheapest flight (results only, nothing booked)',
    budget: 20, limitMin: 10,
  },
};

// ═════════════════════════════════ RECORD ═════════════════════════════════
// Runs inside Electron's main process (Playwright app.evaluate). Captures the window until stop,
// and streams the raw frames (BGRA) into an ffmpeg child that encodes the take. Each frame is
// written as many times as the wall clock says, so the take is constant-rate and in sync with
// the markers (frame n ≈ t0 + n/fps).
async function recStart(electronMod, o) {
  const { BrowserWindow, webContents, nativeImage } = electronMod;
  const fs = process.mainModule.require('fs');
  const { spawn } = process.mainModule.require('child_process');
  const g = globalThis;
  if (g.__demoRec && g.__demoRec.running) return 'busy';
  const win = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).sort((a, b) => b.getContentSize()[0] - a.getContentSize()[0])[0];
  const rec = { running: true, done: false, t0: 0, written: 0, captured: 0, stats: { composited: 0, errors: 0, capMs: 0, shotMs: 0, jsMs: 0, bmpMs: 0, writeMs: 0 }, lastError: '' };
  g.__demoRec = rec;
  // Key colour painted behind the <webview> (CSS injected by the driver): where the shell capture
  // shows it, the guest wasn't included, so the guest's own capture goes there.
  const isKey = (b, i) => b[i] < 40 && b[i + 1] > 215 && b[i + 2] < 40;   // BGRA ≈ rgb(1,254,3)
  const FIND = `(() => { let best = null; for (const w of document.querySelectorAll('webview')) {
    const r = w.getBoundingClientRect(), cs = getComputedStyle(w);
    if (r.width < 50 || r.height < 50 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    const a = r.width * r.height; let id = null; try { id = w.getWebContentsId(); } catch {}
    if (!best || a > best.a) best = { a, x: r.x, y: r.y, w: r.width, h: r.height, id }; } return best; })()`;
  let size = null, ffp = null, closed = null;
  const write = (buf) => new Promise((res) => { if (ffp.stdin.write(buf)) res(); else ffp.stdin.once('drain', res); });
  (async () => {
    while (rec.running) {
      const ts = Date.now();
      try {
        let img = await win.webContents.capturePage();
        const t1 = Date.now(); rec.stats.shotMs += t1 - ts;
        let sz = img.getSize();
        const sc = sz.width / win.getContentSize()[0];
        const box = await win.webContents.executeJavaScript(FIND, true).catch(() => null);
        const t2 = Date.now(); rec.stats.jsMs += t2 - t1;
        let bmp = null;
        if (box) {
          const x0 = Math.max(0, Math.round(box.x * sc)), y0 = Math.max(0, Math.round(box.y * sc));
          const rw = Math.min(sz.width - x0, Math.round(box.w * sc)), rh = Math.min(sz.height - y0, Math.round(box.h * sc));
          bmp = img.toBitmap();
          let hits = 0;
          for (let sy = 0; sy < 16; sy++) for (let sx = 0; sx < 16; sx++) {
            const px = x0 + Math.floor((sx + 0.5) * rw / 16), py = y0 + Math.floor((sy + 0.5) * rh / 16);
            if (isKey(bmp, (py * sz.width + px) * 4)) hits++;
          }
          if (hits > 0) {
            let gb = null, gs = null;
            const gwc = box.id != null ? webContents.fromId(box.id) : null;
            if (gwc && !gwc.isDestroyed()) { const gi = await gwc.capturePage(); gs = gi.getSize(); if (gs.width > 0) gb = gi.toBitmap(); }
            let fastDone = false;
            // Guest fills (almost) the whole rect at the same scale → row copies (fast path).
            if (gb && hits >= 230 && Math.abs(gs.width - rw) <= 2 && Math.abs(gs.height - rh) <= 2) {
              const w = Math.min(rw, gs.width) * 4;
              for (let y = 0; y < Math.min(rh, gs.height); y++) gb.copy(bmp, ((y0 + y) * sz.width + x0) * 4, y * gs.width * 4, y * gs.width * 4 + w);
              fastDone = true; rec.stats.fast = (rec.stats.fast || 0) + 1;
            }
            for (let y = 0; !fastDone && y < rh; y++) {
              const row = (y0 + y) * sz.width;
              const gy = gb ? Math.min(gs.height - 1, Math.floor(y * gs.height / rh)) : 0;
              for (let x = 0; x < rw; x++) {
                const i = (row + x0 + x) * 4;
                if (!isKey(bmp, i)) continue;
                // A transparent guest pixel (page without a background) is white, as in a normal browser.
                const j = gb ? (gy * gs.width + Math.min(gs.width - 1, Math.floor(x * gs.width / rw))) * 4 : -1;
                if (gb && gb[j + 3] >= 128 && !isKey(gb, j)) { bmp[i] = gb[j]; bmp[i + 1] = gb[j + 1]; bmp[i + 2] = gb[j + 2]; }
                else { bmp[i] = bmp[i + 1] = bmp[i + 2] = 255; }
                bmp[i + 3] = 255;
              }
            }
            rec.stats.composited++;
          }
        }
        // Downscale here (Electron) → 2.25× fewer bytes through the pipe and no scaling in ffmpeg.
        const t3 = Date.now();
        if (bmp) img = nativeImage.createFromBitmap(bmp, sz);
        const outW = o.width && sz.width > o.width ? o.width : sz.width;
        const outH = Math.round(sz.height * outW / sz.width / 2) * 2;
        if (outW !== sz.width || outH !== sz.height) img = img.resize({ width: outW, height: outH, quality: 'good' });
        if (!size) {
          size = { width: outW, height: outH };
          rec.t0 = ts;
          rec.size = { capture: sz, out: size };
          ffp = spawn(o.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-use_wallclock_as_timestamps', '1', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${size.width}x${size.height}`, '-i', 'pipe:0',
            '-vf', 'format=yuv420p', '-fps_mode', 'cfr', '-r', String(o.fps), '-c:v', 'h264_videotoolbox', '-b:v', '24M', o.out], { stdio: ['pipe', 'ignore', 'pipe'] });
          ffp.stderr.on('data', (d) => { rec.lastError = String(d).slice(-300); });
          closed = new Promise(r => ffp.on('close', r));
        }
        if (outW !== size.width || outH !== size.height) img = img.resize({ width: size.width, height: size.height });
        const buf = img.toBitmap();
        const t4 = Date.now(); rec.stats.bmpMs += t4 - t3;
        // One write per capture; ffmpeg stamps each frame with the wall clock when it reads it
        // (-use_wallclock_as_timestamps) and fills the gaps itself to a constant rate.
        await write(buf); rec.written++;
        rec.stats.writeMs += Date.now() - t4;
        rec.captured++;
        rec.stats.capMs += Date.now() - ts;
      } catch (e) { rec.stats.errors++; rec.lastError = String(e && e.message || e); }
      const spent = Date.now() - ts;
      await new Promise(r => setTimeout(r, Math.max(4, 1000 / o.fps - spent)));
    }
    if (ffp) { ffp.stdin.end(); await closed; }
    rec.done = true;
  })();
  return 'ok';
}

async function recStop(_e) {
  const rec = globalThis.__demoRec;
  if (!rec) return null;
  rec.running = false;
  for (let i = 0; i < 1200 && !rec.done; i++) await new Promise(r => setTimeout(r, 50));
  globalThis.__demoRec = null;
  const s = rec.stats;
  const avg = (v) => rec.captured ? Math.round(v / rec.captured) : 0;
  return { t0: rec.t0, size: rec.size, captured: rec.captured, avgMs: { total: avg(s.capMs), shot: avg(s.shotMs), js: avg(s.jsMs), bitmap: avg(s.bmpMs), write: avg(s.writeMs) }, composited: s.composited, fastComposite: s.fast || 0, errors: s.errors, lastError: rec.lastError };
}

async function record(sceneIds) {
  fs.mkdirSync(take, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-demo-profile-'));
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-demo-downloads-'));
  // Router: the local gguf, read-only symlink (never copied, never touched).
  if (fs.existsSync(ROUTER_GGUF)) {
    fs.mkdirSync(path.join(tmp, 'models'));
    fs.symlinkSync(ROUTER_GGUF, path.join(tmp, 'models', path.basename(ROUTER_GGUF)));
  } else console.log(`[rec] WARNING: router model not found at ${ROUTER_GGUF}`);
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    args: [root, `--user-data-dir=${tmp}`, '--use-mock-keychain'],
    env: { ...env, E2E_MOCK_AI: '', BAH_DUMP_PROMPTS: path.join(take, 'prompts') },
  });
  const pid = app.process().pid;
  // Main-process stdout/stderr → <take>/main.log (diagnostics for the take).
  const mainLog = fs.createWriteStream(path.join(take, 'main.log'), { flags: 'a' });
  app.process().stdout?.on('data', (d) => mainLog.write(d));
  app.process().stderr?.on('data', (d) => mainLog.write(d));
  fs.writeFileSync(path.join(take, 'electron.pid'), String(pid));
  console.log(`[rec] Electron pid ${pid}, profile ${tmp}, downloads ${dlDir}`);
  // Every download lands in the temp folder (getDownloadDir() falls back to the 'downloads' path).
  await app.evaluate(({ app: a }, d) => a.setPath('downloads', d), dlDir);
  // Re-recording some scenes into an existing take keeps the others (and their order).
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(path.join(take, 'summary.json'), 'utf8')); } catch {}
  const summary = { started: new Date().toISOString(), win: WIN, fps: FPS, model: LOCAL.model, scenes: prev?.scenes || [] };
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate((ls) => {
      localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1');
      localStorage.setItem('localSettings', JSON.stringify(ls));
    }, LOCAL);
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2500);
    await app.evaluate(({ BrowserWindow }, s) => {
      const w = BrowserWindow.getAllWindows().sort((a, b) => b.getContentSize()[0] - a.getContentSize()[0])[0];
      if (w.isMaximized()) w.unmaximize();
      w.setContentSize(s.w, s.h); w.center(); w.show(); w.focus();
    }, WIN);
    // Router ready before the first command.
    let st = null;
    for (let i = 0; i < 180; i++) {
      st = await page.evaluate(() => window.electronAPI?.routerStatus?.()).catch(() => null);
      if (st?.state === 'ready' || st?.state === 'error') break;
      await sleep(1000);
    }
    console.log(`[rec] router: ${JSON.stringify(st)}`);
    if (st?.state !== 'ready') throw new Error('router not ready: ' + JSON.stringify(st));
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await sleep(800);
    const header = await page.getByTestId('agent-command-bar').innerText().catch(() => '');
    if (!/llama\.cpp/i.test(header) || !/Qwen3-VL-8B/i.test(header) || /deepseek|not configured/i.test(header.split('\n').slice(0, 4).join(' '))) {
      throw new Error('panel is not on the local model: ' + header.slice(0, 200));
    }
    console.log('[rec] panel header OK (llama.cpp · Qwen3-VL-8B)');
    // Key colour behind the webview (only visible where the guest isn't painted in the shell capture).
    await page.addStyleTag({ content: 'webview{background:rgb(1,254,3)!important}' });
    // The agent's searches start on Bing (Google showed this machine a captcha in rehearsal).
    await page.evaluate(() => localStorage.setItem('agentSearchEngine', 'bing'));

    for (const id of sceneIds) {
      const sc = SCENES[id];
      if (!sc) { console.log(`[rec] unknown scene ${id}`); continue; }
      const r = await runScene(app, page, id, sc, dlDir);
      const at = summary.scenes.findIndex(x => x.id === id);
      if (at >= 0) summary.scenes[at] = r; else summary.scenes.push(r);
      fs.writeFileSync(path.join(take, 'summary.json'), JSON.stringify(summary, null, 2));
    }
  } catch (e) {
    console.log('[rec] ERROR', e?.message || e);
    summary.error = String(e?.message || e);
  } finally {
    await app.evaluate(recStop).catch(() => {});
    fs.writeFileSync(path.join(take, 'summary.json'), JSON.stringify(summary, null, 2));
    try { fs.copyFileSync(path.join(tmp, 'agent.log'), path.join(take, 'agent.log')); } catch {}
    await app.close().catch(() => {});
    try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch {}
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(dlDir, { recursive: true, force: true });
    console.log(`[rec] done; temp profile and downloads (${dlDir}) deleted`);
  }
}

async function closeMenus(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(300);
  const ov = page.locator('.menu-overlay').first();
  if (await ov.isVisible().catch(() => false)) await ov.click({ force: true }).catch(() => {});
  await sleep(300);
}

async function runScene(app, page, id, sc, dlDir) {
  const dir = path.join(take, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const markers = [];
  const mark = (label, extra) => { markers.push({ label, t: Date.now(), ...extra }); console.log(`[${id}] ${label}${extra ? ' ' + JSON.stringify(extra) : ''}`); };
  const vis = (loc) => loc.isVisible().catch(() => false);
  await closeMenus(page);
  // Fresh tab = fresh feed for this scene; the previous scene's tabs (and their groups) go away.
  await page.locator('.tab-new').click().catch(() => {});
  await sleep(1200);
  for (let i = 0; i < 12; i++) {
    const n = await page.locator('.tab-close').count().catch(() => 0);
    if (n <= 1) break;
    await page.locator('.tab-close').first().click({ force: true }).catch(() => {});
    await sleep(350);
  }
  await sleep(800);
  if (sc.startUrl ?? START) {
    const url = page.locator('.url-input-wrapper input').first();
    await url.click(); await url.fill(sc.startUrl ?? START); await url.press('Enter');
    await sleep(3500);
  }
  const r0 = await app.evaluate(recStart, { out: path.join(dir, 'raw.mp4'), fps: FPS, width: FRAME_W, ffmpeg: FFMPEG });
  if (r0 !== 'ok') throw new Error('recorder busy');
  const t0 = Date.now();
  mark('start');
  await sleep(1200);
  const input = page.getByTestId('agent-command-input');
  await input.click();
  await input.pressSequentially(sc.cmd, { delay: 28 });
  mark('typed');
  await sleep(700);
  await input.press('Enter');
  mark('sent');
  const seen = new Set();
  let outcome = 'timeout', idle = 0, started = false, ringAt = 0, cancelled = false;
  const dlFiles = () => { try { return fs.readdirSync(dlDir); } catch { return []; } };
  while (Date.now() - t0 < sc.limitMin * 60_000) {
    await sleep(700);
    if (await vis(page.getByTestId('plan-approve'))) {
      if (!seen.has('plan')) { seen.add('plan'); mark('plan'); await sleep(1500); }
      await page.getByTestId('plan-approve').click().catch(() => {});
      continue;
    }
    const best = page.getByRole('button', { name: sc.quality === 'low' ? /Smaller files/ : /Best quality/ }).last();
    if (await vis(best)) {
      mark('card', { text: (await page.locator('.feed-confirm-card').last().innerText().catch(() => '')).slice(0, 600) }); await sleep(3000);
      await best.click().catch(() => {});
      mark('chosen', { quality: sc.quality || 'best' });
      continue;
    }
    const pause = page.getByText(/Safety pause/).last();
    if (await vis(pause) && await vis(page.locator('.feed-confirm-card .confirm-no').last())) {
      mark('brake', { text: (await pause.innerText().catch(() => '')).slice(0, 160) });
      await sleep(1500);
      await page.locator('.feed-confirm-card .confirm-no').last().click().catch(() => {});
      continue;
    }
    if (await vis(page.getByTestId('agent-manual-continue'))) {
      mark('help-needed', { text: (await page.locator('.feed-help-card').last().innerText().catch(() => '')).slice(0, 200) });
      await page.getByTestId('agent-stop').click().catch(() => {});
      outcome = 'blocked';
      break;
    }
    const ringKind = await page.getByTestId('dl-ring').getAttribute('data-ring').catch(() => null);
    const ring = !!ringKind && ringKind !== 'idle';
    if (ring && !ringAt) { ringAt = Date.now(); mark('ring'); }
    if (sc.cancelDownload && ringAt && !cancelled && Date.now() - ringAt > 7000) {
      // Never install or run anything: cancel the download and the partial file goes with the temp folder.
      await page.evaluate(async () => {
        for (let i = 1; i <= 30; i++) { await window.electronAPI?.cancelDownload?.(`dl_${i}`); await window.electronAPI?.cancelDownload?.(`agdl_${i}`); }
      }).catch(() => {});
      cancelled = true;
      mark('cancelled', { files: dlFiles() });
    }
    const running = await vis(page.getByTestId('agent-stop'));
    if (running) { started = true; idle = 0; continue; }
    if (!started) { if (Date.now() - t0 > 30_000) started = true; continue; }
    if (sc.cancelDownload && ringAt && !cancelled) continue;   // still waiting to cancel
    if (++idle >= 4) { outcome = 'finished'; break; }
  }
  if (outcome === 'timeout') { await page.getByTestId('agent-stop').click().catch(() => {}); }
  mark('done', { outcome });
  // render_view opens the table in its own tab (in the background): bring it to the front.
  const feedNow = await page.getByTestId('agent-command-bar').innerText().catch(() => '');
  if (/opened in a new tab/i.test(feedNow)) {
    const tabs = page.locator('.tab');
    const n = await tabs.count().catch(() => 0);
    if (n > 1) { await sleep(1200); await tabs.nth(n - 1).click().catch(() => {}); mark('table'); }
  }
  // The table / summary: give it a moment on screen.
  await sleep(3500);
  if (sc.showDownloads) {
    await page.locator('button[title^="Downloads ("]').first().click().catch(() => {});
    mark('downloads-panel');
    await sleep(4500);
    await closeMenus(page);
  }
  mark('end');
  const rec = await app.evaluate(recStop);
  const feed = await page.getByTestId('agent-command-bar').innerText().catch(() => '');
  const files = dlFiles().map(f => { try { return `${f} (${fs.statSync(path.join(dlDir, f)).size} bytes)`; } catch { return f; } });
  fs.writeFileSync(path.join(dir, 'feed.txt'), feed);
  const result = { id, cmd: sc.cmd, caption: sc.caption, outcome, seconds: Math.round((Date.now() - t0) / 1000), rec, downloads: files };
  fs.writeFileSync(path.join(dir, 'markers.json'), JSON.stringify({ ...result, markers }, null, 2));
  console.log(`[${id}] ${JSON.stringify({ outcome, seconds: result.seconds, rec, downloads: files })}`);
  // Downloads of this scene are not kept between scenes.
  for (const f of dlFiles()) fs.rmSync(path.join(dlDir, f), { recursive: true, force: true });
  return result;
}

// ═════════════════════════════════ EDIT ═════════════════════════════════
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';
const FONT_B = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';
const OUT_W = 1920, OUT_H = 1200;

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${String(r.stderr).slice(-1500)}`);
  return String(r.stdout);
}
const ff = (args) => sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const probeDur = (f) => Number(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).trim());

// Caption / title PNGs (Pillow): the ffmpeg build has no drawtext.
function renderPng(out, spec) {
  const py = `
import json,sys
from PIL import Image,ImageDraw,ImageFont
s=json.loads(sys.argv[1]); W,H=s['w'],s['h']
im=Image.new('RGBA',(W,H),tuple(s.get('bg',[0,0,0,0])))
d=ImageDraw.Draw(im)
if s['kind']=='caption':
    f=ImageFont.truetype(s['font'],s['size']); t=s['text']
    b=d.textbbox((0,0),t,font=f); tw,th=b[2]-b[0],b[3]-b[1]; px,py=34,20
    x=(W-tw)//2; y=H-th-2*py-s['bottom']
    d.rounded_rectangle([x-px,y-py,x+tw+px,y+th+py],radius=22,fill=(20,20,20,215))
    d.text((x-b[0],y-b[1]),t,font=f,fill=(255,255,255,255))
elif s['kind']=='badge':
    f=ImageFont.truetype(s['font'],s['size']); t=s['text']
    b=d.textbbox((0,0),t,font=f); tw,th=b[2]-b[0],b[3]-b[1]; px,py=18,10
    x=W-tw-2*px-s['right']; y=s['top']
    d.rounded_rectangle([x,y,x+tw+2*px,y+th+2*py],radius=14,fill=(217,119,87,235))
    d.text((x+px-b[0],y+py-b[1]),t,font=f,fill=(255,255,255,255))
else:
    y=s['y0']
    for (t,font,size,col) in s['lines']:
        f=ImageFont.truetype(font,size); b=d.textbbox((0,0),t,font=f)
        d.text(((W-(b[2]-b[0]))//2-b[0],y-b[1]),t,font=f,fill=tuple(col)); y+=(b[3]-b[1])+s['gap']
im.save(s['out'])
`;
  sh('python3', ['-I', '-c', py, JSON.stringify({ ...spec, out })]);
}

/** The take is already constant-rate (frame n ≈ rec.t0 + n/fps). */
function rawVideo(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'markers.json'), 'utf8'));
  const out = path.join(dir, 'raw.mp4');
  return { out, t0: m.rec.t0, dur: probeDur(out) };
}

// Each marker keeps a 1× window around it; everything between is sped up, and if still too
// long, the middle of the longest fast stretches is cut.
const FOCUS = {
  start: [0, 1.0], typed: [-2.5, 1.2], sent: [0, 2.5], plan: [-0.5, 2.5], card: [-0.8, 4.2], chosen: [0, 2.5], table: [-0.3, 4.5],
  brake: [-0.5, 2.0], ring: [-1.0, 3.0], cancelled: [-1.0, 2.0], done: [-2.0, 4.0], 'downloads-panel': [-0.3, 4.5], end: [-0.5, 0],
};

function planScene(m, raw) {
  const rel = (t) => Math.max(0, Math.min(raw.dur, (t - raw.t0) / 1000));
  let keep = [];
  for (const x of m.markers) {
    const w = FOCUS[x.label]; if (!w) continue;
    keep.push([Math.max(0, rel(x.t) + w[0]), Math.min(raw.dur, rel(x.t) + w[1])]);
  }
  keep.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const k of keep) { const l = merged[merged.length - 1]; if (l && k[0] <= l[1] + 0.3) l[1] = Math.max(l[1], k[1]); else merged.push([...k]); }
  const segs = [];
  let cur = 0;
  for (const [a, b] of merged) { if (a > cur + 0.05) segs.push({ a: cur, b: a, fast: true }); segs.push({ a, b, fast: false }); cur = b; }
  const endT = rel(m.markers.find(x => x.label === 'end')?.t ?? raw.t0 + raw.dur * 1000);
  if (endT > cur + 0.05) segs.push({ a: cur, b: endT, fast: true });
  const slow = segs.filter(s => !s.fast).reduce((s, x) => s + x.b - x.a, 0);
  const fastRaw = segs.filter(s => s.fast).reduce((s, x) => s + x.b - x.a, 0);
  const room = Math.max(3, m.budget - slow);
  let speed = Math.min(6, Math.max(2, fastRaw / room));
  if (fastRaw / speed > room) {
    // Still too long at 6×: cut the dead middle of each fast stretch, keeping its ends.
    const keepEach = room * speed / fastRaw;
    const out = [];
    for (const s of segs) {
      if (!s.fast || (s.b - s.a) * keepEach > s.b - s.a - 1) { out.push(s); continue; }
      const k = (s.b - s.a) * keepEach / 2;
      out.push({ a: s.a, b: s.a + k, fast: true }, { a: s.b - k, b: s.b, fast: true, cutBefore: true });
    }
    return { segs: out, speed: 6 };
  }
  return { segs, speed: Math.round(speed * 10) / 10 };
}

function edit() {
  const work = path.join(take, 'edit');
  fs.mkdirSync(work, { recursive: true });
  const outDir = path.resolve(expand(opt('out', path.join(root, 'assets'))));
  const summary = JSON.parse(fs.readFileSync(path.join(take, 'summary.json'), 'utf8'));
  const only = opt('only', '') ? opt('only').split(',') : null;
  const ids = summary.scenes.map(s => s.id).filter(id => (!only || only.includes(id)) && fs.existsSync(path.join(take, id, 'raw.mp4')));
  const enc = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS)];
  const parts = [];
  const timeline = [];   // where the highlights land in the final video (for the GIF)
  let clock = 0;

  // Title card.
  const titlePng = path.join(work, 'title.png');
  renderPng(titlePng, { kind: 'title', w: OUT_W, h: OUT_H, bg: [31, 30, 29, 255], y0: 470, gap: 38, lines: [
    ['Bah', FONT_B, 150, [217, 119, 87, 255]],
    ['the AI browser that does it for you', FONT_B, 64, [245, 240, 232, 255]],
    ['Real agent, running on a local model. Sped up where it waits.', FONT, 36, [170, 165, 158, 255]],
  ] });
  const titleMp4 = path.join(work, '00-title.mp4');
  ff(['-loop', '1', '-t', '3.2', '-i', titlePng, '-vf', `fade=in:0:8,fade=out:st=2.7:d=0.5,format=yuv420p`, ...enc, titleMp4]);
  parts.push(titleMp4); clock += 3.2;

  ids.forEach((id, n) => {
    const dir = path.join(take, id);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'markers.json'), 'utf8'));
    m.budget = SCENES[id]?.budget || 20;
    const raw = rawVideo(dir);
    const { segs, speed } = planScene(m, raw);
    const cap = path.join(work, `${id}-caption.png`);
    renderPng(cap, { kind: 'caption', w: OUT_W, h: OUT_H, font: FONT_B, size: 44, bottom: 46, text: SCENES[id]?.caption || m.caption });
    const badge = path.join(work, `${id}-badge.png`);
    renderPng(badge, { kind: 'badge', w: OUT_W, h: OUT_H, font: FONT_B, size: 34, right: 40, top: 128, text: `>> ${speed}x` });
    // Each segment cut on its own (seek + speed + badge on the fast ones), joined, then the caption.
    let tOut = 0;
    const marks = [];
    const segFiles = [];
    segs.forEach((s, i) => {
      const k = s.fast ? speed : 1;
      const f = path.join(work, `${id}-seg${String(i).padStart(2, '0')}.mp4`);
      const vf = `setpts=PTS/${k},fps=${FPS}`;
      ff(['-ss', s.a.toFixed(3), '-to', s.b.toFixed(3), '-i', raw.out, ...(s.fast ? ['-i', badge] : []),
        '-filter_complex', s.fast ? `[0:v]${vf}[a];[a][1:v]overlay=0:0:eof_action=repeat,format=yuv420p[v]` : `[0:v]${vf},format=yuv420p[v]`,
        '-map', '[v]', ...enc, f]);
      segFiles.push(f);
      for (const x of m.markers) {
        const r = (x.t - raw.t0) / 1000;
        if (r >= s.a && r < s.b) marks.push({ label: x.label, t: clock + tOut + (r - s.a) / k });
      }
      tOut += probeDur(f);
    });
    const segList = path.join(work, `${id}-segs.txt`);
    fs.writeFileSync(segList, segFiles.map(f => `file '${f}'`).join('\n'));
    const cat = path.join(work, `${id}-cat.mp4`);
    ff(['-f', 'concat', '-safe', '0', '-i', segList, '-c', 'copy', cat]);
    const out = path.join(work, `${String(n + 1).padStart(2, '0')}-${id}.mp4`);
    ff(['-i', cat, '-i', cap, '-filter_complex', `[0:v][1:v]overlay=0:0:eof_action=repeat,fade=in:0:5,format=yuv420p[v]`, '-map', '[v]', ...enc, out]);
    const d = probeDur(out);
    console.log(`[edit] ${id}: raw ${raw.dur.toFixed(1)}s → ${d.toFixed(1)}s (fast ${speed}×, ${segs.length} segments)`);
    timeline.push({ id, start: clock, dur: d, marks });
    parts.push(out); clock += d;
  });

  // End card.
  const endPng = path.join(work, 'end.png');
  renderPng(endPng, { kind: 'title', w: OUT_W, h: OUT_H, bg: [31, 30, 29, 255], y0: 520, gap: 40, lines: [
    ['Bah', FONT_B, 120, [217, 119, 87, 255]],
    ['Type what you want. Bah does the rest.', FONT_B, 56, [245, 240, 232, 255]],
  ] });
  const endMp4 = path.join(work, '99-end.mp4');
  ff(['-loop', '1', '-t', '2.8', '-i', endPng, '-vf', 'fade=in:0:6,format=yuv420p', ...enc, endMp4]);
  parts.push(endMp4); clock += 2.8;

  const list = path.join(work, 'parts.txt');
  fs.writeFileSync(list, parts.map(p => `file '${p}'`).join('\n'));
  const joined = path.join(work, 'joined.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
  const total = probeDur(joined);
  // Fit under ~24 MB.
  const kbps = Math.floor(Math.min(6000, (24 * 8 * 1024 * 0.95) / total));
  const mp4 = path.join(outDir, 'demo.mp4');
  ff(['-i', joined, '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.6)}k`, '-bufsize', `${kbps * 2}k`,
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', '-an', mp4]);
  fs.writeFileSync(path.join(work, 'timeline.json'), JSON.stringify({ total, timeline }, null, 2));
  console.log(`[edit] demo.mp4: ${total.toFixed(1)}s, ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB (${kbps} kbps)`);

  // GIF: ~4 s per scene around its best moment.
  const pick = { mj: ['card', 'downloads-panel', 'done'], hotel: ['table', 'done'], prices: ['table', 'done'], steam: ['ring'], news: ['table', 'done'], flight: ['table', 'done'] };
  const clips = [];
  for (const s of timeline) {
    const want = pick[s.id] || ['done'];
    const hits = want.map(l => s.marks.find(x => x.label === l)).filter(Boolean);
    const lens = s.id === 'mj' ? [3.2, 3.2] : [4.0];
    hits.slice(0, lens.length).forEach((h, i) => {
      const st = Math.max(s.start, Math.min(h.t - 0.4, s.start + s.dur - lens[i]));
      clips.push([st, lens[i]]);
    });
  }
  const gparts = clips.map(([st, d], i) => `[0:v]trim=start=${st.toFixed(2)}:duration=${d},setpts=PTS-STARTPTS[g${i}]`);
  const gfc = `${gparts.join(';')};${clips.map((_, i) => `[g${i}]`).join('')}concat=n=${clips.length}:v=1:a=0,fps=10,scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  const gif = path.join(outDir, 'demo.gif');
  ff(['-i', joined, '-filter_complex', gfc, '-loop', '0', gif]);
  console.log(`[edit] demo.gif: ${clips.reduce((s, c) => s + c[1], 0).toFixed(1)}s, ${(fs.statSync(gif).size / 1e6).toFixed(2)} MB`);

  // Review stills.
  const stills = path.join(take, 'stills');
  fs.mkdirSync(stills, { recursive: true });
  const shots = [['00-title', 1.5]];
  for (const s of timeline) for (const x of s.marks) if (['card', 'chosen', 'ring', 'done', 'table', 'downloads-panel', 'plan'].includes(x.label)) shots.push([`${s.id}-${x.label}`, Math.min(x.t + (x.label === 'table' ? 2.3 : 1.2), s.start + s.dur - 0.2)]);
  for (const [name, t] of shots) ff(['-ss', t.toFixed(2), '-i', mp4, '-frames:v', '1', path.join(stills, `${name}.png`)]);
  console.log(`[edit] stills → ${stills}`);
}

if (mode === 'record') {
  const ids = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] || '').startsWith('--'));
  await record(ids.length ? ids : ['mj', 'hotel', 'prices', 'steam']);
} else if (mode === 'edit') {
  edit();
} else {
  console.log('usage: node tools/record-demo-mac.mjs record --take <dir> [scenes…] | edit --take <dir> [--out assets] [--only a,b]');
}
