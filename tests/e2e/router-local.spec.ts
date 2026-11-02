import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Roteador local (Qwen2.5-1.5B no utilityProcess) de ponta a ponta no app BUILDADO: o modelo sobe
// sozinho depois que a janela aparece, o card das configurações diz "ligado" e o IPC rotula frases
// reais. Pula quando o arquivo do modelo não está na máquina (BAH_ROUTER_MODEL ou o lugar padrão).
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const MODEL = process.env.BAH_ROUTER_MODEL
  || path.join(os.homedir(), 'Library/Application Support/bah-browser-agent-test/models/qwen2.5-1.5b-instruct-q4_k_m.gguf');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('local router: loads after the window shows and labels messages', async () => {
  test.skip(!fs.existsSync(MODEL), `routing model not found (${MODEL})`);
  test.setTimeout(240_000);
  // Perfil novo; o modelo entra por link simbólico (só leitura, sem copiar 1,1 GB).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-router-'));
  fs.mkdirSync(path.join(tmp, 'models'));
  fs.symlinkSync(MODEL, path.join(tmp, 'models', path.basename(MODEL)));
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    let st: any = null;
    for (let i = 0; i < 180; i++) {
      // A tela pode recarregar no começo (contexto destruído) → tenta de novo.
      st = await page.evaluate(() => (window as any).electronAPI.routerStatus()).catch(() => null);
      if (st?.state === 'ready' || st?.state === 'error') break;
      await sleep(1000);
    }
    expect(st?.state, JSON.stringify(st)).toBe('ready');
    expect(['metal', 'vulkan', 'cuda', 'cpu']).toContain(st.backend);

    const classify = (text: string, ctx: any = {}) => page.evaluate((a) => (window as any).electronAPI.routerClassify(a.text, a.ctx), { text, ctx });
    const a = await classify('open 2 windos and show me a different youtube video for michael jackson in each one');
    expect(a?.route).toBe('ACTION');
    expect(typeof a?.ms).toBe('number');
    const w = await classify('what is the capital of australia?');
    expect(w?.route).toBe('WEB');
    const f = await classify('one window was opened, but not the second.', {
      url: 'https://www.youtube.com/watch?v=x', title: 'Thriller - YouTube',
      lastRun: { request: 'open 2 windows with a different michael jackson video in each', outcome: 'opened 1 window; the second was not opened' },
    });
    expect(f?.route).toBe('FIX');

    // O card nas configurações do assistente mostra "ligado".
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.locator('button[title="Settings"], button[title="Configurações"], button[title="Configuración"]').first().click();
    await expect(page.getByTestId('router-card')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  } finally {
    await app.close();
  }
});
