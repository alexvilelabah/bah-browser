import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// GPU, núcleos e memória que os sites veem: os valores REAIS do motor, iguais na página e no worker
// dela. O remendo antigo ("Intel Iris 6100", 8 núcleos, 8 GB) só valia na página — o worker via o
// real, e essa contradição é o que os detectores de robô procuram. Núcleos: o Chrome 156 de verdade
// também diz 6 num i7 de 6 núcleos/12 threads — o valor do motor é o do Chrome.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<title>hw</title><script>
  const worker = new Worker(URL.createObjectURL(new Blob(['postMessage({ cores: navigator.hardwareConcurrency, mem: navigator.deviceMemory })'], { type: 'text/javascript' })));
  worker.onmessage = (e) => { window.__worker = e.data; };
</script><h1>hardware</h1>`;

test('sites see the real GPU, cores and memory — the same in the page and in its worker', async () => {
  test.setTimeout(90_000);
  const server = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html'); res.end(PAGE); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-hw-'));
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    const a = page.locator('.url-input'); await a.click(); await a.fill(T); await a.press('Enter'); await sleep(3000);
    const seen = await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w => w.getType() === 'webview').pop()!
      .executeJavaScript(`(async () => {
        for (let i = 0; i < 40 && !window.__worker; i++) await new Promise(r => setTimeout(r, 100));
        const gl = document.createElement('canvas').getContext('webgl');
        const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
        return { cores: navigator.hardwareConcurrency, mem: navigator.deviceMemory, worker: window.__worker,
          renderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '' };
      })()`));
    // Chromium's own count (on Apple silicon it can be lower than os.cpus(): plain Electron reports 6 on a 12-core Mac).
    expect(seen.worker).toBeTruthy();
    expect(seen.cores).toBeGreaterThan(0);
    expect(seen.cores).toBeLessThanOrEqual(os.cpus().length);
    expect(seen.worker.cores).toBe(seen.cores);
    expect(seen.worker.mem).toBe(seen.mem);
    expect(Math.log2(seen.mem) % 1).toBe(0);   // Chromium's own power-of-two rounding (16 on a 16 GB Mac: no cap at 8 in this engine)
    expect(seen.renderer).not.toMatch(/Iris\(TM\) Graphics 6100/);
  } finally {
    await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true });
  }
});
