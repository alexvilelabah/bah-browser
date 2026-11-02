// Gerente do roteador local — ponte entre o renderer e o motor ISOLADO (router/engine.mjs num
// utilityProcess), no molde do torrent-manager. O modelo (Qwen2.5-1.5B-Instruct, Apache-2.0) fica
// em <userData>/models/; sobe sozinho depois que a janela aparece, SE o arquivo existir. Baixar
// só acontece quando o renderer pede (depois do "sim" da pessoa). Qualquer falha → status 'error'
// e a caixa segue com as regras de palavras; o main nunca cai por causa do motor.
import { app, ipcMain, utilityProcess, type UtilityProcess } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { ROUTER_MODEL, type RouterStatus, type RouteContext } from '../shared/router-routes';
import { downloadModel } from './router/model-download';

interface Deps {
  getMainWindow: () => Electron.BrowserWindow | null;
  modelsDir: string;
}

const CLASSIFY_TIMEOUT_MS = 4000;
const BINDING_TEST_FILE = path.join('node_modules', 'node-llama-cpp', 'dist', 'bindings', 'utils', 'testBindingBinary.js');

export function setupRouterManager(deps: Deps) {
  const modelPath = path.join(deps.modelsDir, ROUTER_MODEL.file);
  let child: UtilityProcess | null = null;
  let status: RouterStatus = { state: 'not-downloaded' };
  let rss = 0;
  let seq = 0;
  let downloading: Promise<unknown> | null = null;
  const pending = new Map<number, (v: { route: string | null; ms: number } | null) => void>();
  const tests = new Map<number, UtilityProcess>();

  const setStatus = (s: RouterStatus) => {
    status = s;
    try { deps.getMainWindow()?.webContents.send('router:status', s); } catch {}
  };
  const log = (msg: string) => console.log('[Router]', msg);
  const modelPresent = () => { try { return fs.statSync(modelPath).size === ROUTER_MODEL.size; } catch { return false; } };
  if (!modelPresent()) status = { state: 'not-downloaded' };

  const flushPending = () => { for (const r of pending.values()) r(null); pending.clear(); };

  // gpu 'auto' primeiro; se o motor morrer ou falhar ao carregar, uma segunda vez só CPU.
  function start(gpu: 'auto' | false = 'auto') {
    if (child || !modelPresent()) return;
    setStatus({ state: 'loading' });
    // engine.mjs (bundle ESM) fica DENTRO do asar junto com o node-llama-cpp (que resolve as
    // próprias dependências de lá); só os binários nativos vão pro app.asar.unpacked.
    const enginePath = path.join(__dirname, 'router', 'engine.mjs');
    let ready = false;
    let failed = false;
    const fail = (why: string) => {
      if (failed) return;
      failed = true;
      log('engine failed: ' + why);
      try { c.kill(); } catch {}
      child = null;
      flushPending();
      if (gpu !== false && !ready) { start(false); return; }
      setStatus({ state: 'error', error: why });
    };
    let c: UtilityProcess;
    try {
      c = utilityProcess.fork(enginePath, [], { serviceName: 'bah-router' });
    } catch (e: any) {
      setStatus({ state: 'error', error: String(e?.message || e) });
      return;
    }
    child = c;
    c.on('exit', (code) => { if (child === c) fail(`engine exited (${code})`); });
    c.on('message', (m: any) => {
      switch (m?.t) {
        case 'ready':
          ready = true;
          rss = Number(m.rss) || 0;
          log(`ready: backend=${m.backend} load=${m.loadMs}ms rss=${Math.round(rss / 1048576)}MB`);
          setStatus({ state: 'ready', backend: String(m.backend || 'cpu'), loadMs: m.loadMs });
          break;
        case 'error':
          fail(String(m.msg || 'load error'));
          break;
        case 'result': {
          const r = pending.get(m.id);
          if (r) { pending.delete(m.id); r(m.route ? { route: m.route, ms: m.ms } : null); }
          break;
        }
        case 'log':
          log(String(m.msg));
          break;
        // Teste do binário nativo do node-llama-cpp: ele precisa de um processo filho, e dentro de
        // um utilityProcess não há como criar um (o fuse RunAsNode está desligado). O motor pede
        // aqui e o main abre o utilityProcess do teste — só o arquivo de teste do próprio pacote.
        case 'bt-fork': {
          const file = path.resolve(String(m.file || ''));
          if (!file.endsWith(path.sep + BINDING_TEST_FILE) || !file.startsWith(path.resolve(app.getAppPath()))) {
            c.postMessage({ t: 'bt-exit', tid: m.tid, code: -1 });
            break;
          }
          log('testing the native binary in a separate process');
          try {
            const p = utilityProcess.fork(file, [], { serviceName: 'bah-router-test', env: { ...process.env, TEST_BINDING_CP: 'true' } });
            tests.set(m.tid, p);
            p.on('message', (msg) => { try { c.postMessage({ t: 'bt-msg', tid: m.tid, msg }); } catch {} });
            p.on('exit', (code) => { tests.delete(m.tid); try { c.postMessage({ t: 'bt-exit', tid: m.tid, code }); } catch {} });
          } catch {
            c.postMessage({ t: 'bt-exit', tid: m.tid, code: -1 });
          }
          break;
        }
        case 'bt-send':
          try { tests.get(m.tid)?.postMessage(m.msg); } catch {}
          break;
        case 'bt-kill':
          try { tests.get(m.tid)?.kill(); } catch {}
          break;
      }
    });
    c.postMessage({ t: 'init', modelPath, gpu });
  }

  function classify(text: string, ctx?: RouteContext): Promise<{ route: string; ms: number } | null> {
    if (!child || status.state !== 'ready') return Promise.resolve(null);
    const id = ++seq;
    return new Promise((resolve) => {
      pending.set(id, resolve as any);
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(null); } }, CLASSIFY_TIMEOUT_MS);
      try {
        child!.postMessage({ t: 'classify', id, text: String(text || '').slice(0, 2000), ctx: sanitizeCtx(ctx) });
      } catch { pending.delete(id); resolve(null); }
    });
  }

  function download(): Promise<{ ok: boolean; error?: string }> {
    if (modelPresent()) { start(); return Promise.resolve({ ok: true }); }
    if (downloading) return downloading as Promise<{ ok: boolean; error?: string }>;
    fs.mkdirSync(deps.modelsDir, { recursive: true });
    setStatus({ state: 'downloading', progress: 0, bytes: 0, total: ROUTER_MODEL.size });
    const p = downloadModel({
      url: ROUTER_MODEL.url,
      dest: modelPath,
      sha256: ROUTER_MODEL.sha256,
      size: ROUTER_MODEL.size,
      onProgress: (bytes, total) => setStatus({ state: 'downloading', progress: total ? bytes / total : 0, bytes, total }),
    }).then(
      () => { downloading = null; start(); return { ok: true }; },
      (e: any) => { downloading = null; const error = String(e?.message || e); setStatus({ state: 'error', error }); return { ok: false, error }; },
    );
    downloading = p;
    return p;
  }

  ipcMain.handle('router:status', () => ({ ...status, rss }));
  ipcMain.handle('router:classify', (_e, text: string, ctx?: RouteContext) => classify(text, ctx));
  ipcMain.handle('router:download', () => download());

  return {
    /** Sobe o motor se o modelo já estiver em disco (chamado depois que a janela aparece). */
    start: () => { if (modelPresent()) start(); },
    status: () => status,
    dispose: () => { try { child?.kill(); } catch {} child = null; for (const t of tests.values()) { try { t.kill(); } catch {} } },
  };
}

// Só o que o prompt usa, com tamanho limitado (o renderer não manda nada além de texto).
function sanitizeCtx(ctx?: RouteContext): RouteContext {
  const s = (v: unknown, n: number) => String(v ?? '').slice(0, n);
  const lr = ctx?.lastRun;
  return {
    url: s(ctx?.url, 500),
    title: s(ctx?.title, 300),
    lastRun: lr && lr.request ? { request: s(lr.request, 400), outcome: s(lr.outcome, 400) } : null,
  };
}
