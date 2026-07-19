// Gerente de torrent — a ponte CJS entre o renderer e o motor ISOLADO (engine.mjs num
// utilityProcess). Modelado no download-manager.ts. Traduz IPC 'torrent:*' em mensagens
// pro motor e relança os eventos do motor pro renderer. "Salvar" reusa o MESMO payload
// 'agent:download-event' → o painel Ctrl+J renderiza as linhas de torrent de graça; o
// card usa o 'agent:torrent-event' (mais rico: peers/seeders/buffer) que o download não tem.
import { ipcMain, utilityProcess, type UtilityProcess } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import fetch from 'cross-fetch';

interface Deps {
  getMainWindow: () => Electron.BrowserWindow | null;
  uniqueDownloadPath: (base: string) => string;
  blockedExtensions: RegExp;
}

interface TorrentRec {
  id: string;
  name?: string;
  infoHash?: string;
  files: Array<{ index: number; name: string; length: number }>;
}

export function setupTorrentManager(deps: Deps) {
  let child: UtilityProcess | null = null;
  let ready = false;
  let seq = 0;
  const reg = new Map<string, TorrentRec>();
  const pendingAdd = new Map<string, (v: any) => void>();
  const pendingStream = new Map<string, (v: any) => void>();
  const saveIds = new Map<string, string>();   // `${id}:${index}` -> download-event id (dl-panel row)

  const send = (channel: string, payload: any) => {
    try { deps.getMainWindow()?.webContents.send(channel, payload); } catch {}
  };

  function ensureChild() {
    if (child) return;
    // engine.mjs é bundle ESM em dist/main/torrent/. No app empacotado ele fica em
    // app.asar.unpacked (asarUnpack) — forçamos o caminho unpacked pra o utilityProcess ler
    // o arquivo real (ESM/.node não rodam de dentro do asar). Em dev o replace é no-op.
    const enginePath = path.join(__dirname, 'torrent', 'engine.mjs').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    child = utilityProcess.fork(enginePath, [], { serviceName: 'bah-torrent' });
    child.on('message', onEngineMessage);
    child.on('exit', () => { child = null; ready = false; });
    child.postMessage({ t: 'init', tmp: path.join(os.tmpdir(), 'bah-torrents') });
  }

  function onEngineMessage(m: any) {
    switch (m?.t) {
      case 'ready':
        ready = true;
        break;
      case 'log':
        console.log('[Torrent]', m.msg);
        break;
      case 'metadata': {
        const rec = reg.get(m.id);
        if (rec) { rec.name = m.name; rec.infoHash = m.infoHash; rec.files = m.files; }
        send('agent:torrent-event', { kind: 'metadata', id: m.id, name: m.name, infoHash: m.infoHash, length: m.length, files: m.files });
        const resolve = pendingAdd.get(m.id);
        if (resolve) { pendingAdd.delete(m.id); resolve({ ok: true, id: m.id, name: m.name, files: m.files }); }
        break;
      }
      case 'stats':
        send('agent:torrent-event', { kind: 'stats', id: m.id, peers: m.peers, progress: m.progress, downloaded: m.downloaded, downSpeed: m.downSpeed, upSpeed: m.upSpeed });
        break;
      case 'stream': {
        const key = `${m.id}:${m.index}`;
        const resolve = pendingStream.get(key);
        if (resolve) { pendingStream.delete(key); resolve({ ok: true, url: m.url }); }
        send('agent:torrent-event', { kind: 'stream', id: m.id, index: m.index, url: m.url });
        break;
      }
      case 'save-progress': {
        const key = `${m.id}:${m.index}`;
        const dlId = saveIds.get(key);
        // Reusa o painel de downloads: mesmo shape do download-manager.
        send('agent:download-event', { id: dlId, state: 'progress', filename: path.basename(m.dest), path: m.dest, bytes: m.bytes, totalBytes: m.total, speedBps: Math.round(m.speed || 0), paused: false });
        break;
      }
      case 'save-done': {
        const key = `${m.id}:${m.index}`;
        const dlId = saveIds.get(key);
        saveIds.delete(key);
        send('agent:download-event', { id: dlId, state: 'completed', filename: path.basename(m.dest), path: m.dest, bytes: 0 });
        send('agent:torrent-event', { kind: 'save-done', id: m.id, index: m.index, dest: m.dest });
        break;
      }
      case 'save-error': {
        const key = `${m.id}:${m.index}`;
        const dlId = saveIds.get(key);
        saveIds.delete(key);
        send('agent:download-event', { id: dlId, state: 'failed', filename: 'torrent', path: '' });
        send('agent:torrent-event', { kind: 'save-error', id: m.id, index: m.index, msg: m.msg });
        break;
      }
      case 'error':
        send('agent:torrent-event', { kind: 'error', id: m.id, msg: m.msg });
        { const r = pendingAdd.get(m.id); if (r) { pendingAdd.delete(m.id); r({ ok: false, error: m.msg }); } }
        break;
    }
  }

  // Adiciona um magnet ou uma URL/bytes de .torrent; resolve quando a metadata chega.
  async function addTorrent(uri: string): Promise<any> {
    ensureChild();
    const id = `tor_${++seq}`;
    reg.set(id, { id, files: [] });
    let buf: number[] | undefined;
    if (!/^magnet:/i.test(uri)) {
      // .torrent por URL → baixa os bytes aqui (cross-fetch já é dep) e passa o Buffer.
      try {
        const res = await fetch(uri);
        const ab = await res.arrayBuffer();
        buf = Array.from(new Uint8Array(ab));
      } catch (e: any) {
        reg.delete(id);
        return { ok: false, error: 'Could not fetch the .torrent: ' + (e?.message || e) };
      }
    }
    const p = new Promise<any>((resolve) => {
      pendingAdd.set(id, resolve);
      setTimeout(() => { if (pendingAdd.has(id)) { pendingAdd.delete(id); resolve({ ok: false, error: 'timeout', id }); } }, 30000);
    });
    child!.postMessage(buf ? { t: 'add', id, buf } : { t: 'add', id, uri });
    return p;
  }

  ipcMain.handle('torrent:add', (_e, uri: string) => addTorrent(uri));

  ipcMain.handle('torrent:play', (_e, id: string, index: number) => {
    if (!child) return { ok: false, error: 'no engine' };
    const key = `${id}:${index}`;
    const p = new Promise<any>((resolve) => {
      pendingStream.set(key, resolve);
      setTimeout(() => { if (pendingStream.has(key)) { pendingStream.delete(key); resolve({ ok: false, error: 'timeout' }); } }, 15000);
    });
    child.postMessage({ t: 'stream', id, index });
    return p;
  });

  ipcMain.handle('torrent:save-file', (_e, id: string, index: number) => {
    if (!child) return { ok: false, error: 'no engine' };
    const rec = reg.get(id);
    const file = rec?.files.find((f) => f.index === index);
    const name = file?.name || `torrent-${index}.bin`;
    // Mesma trava do download-manager: executável/script nunca é salvo.
    if (deps.blockedExtensions.test(name)) {
      send('agent:download-event', { state: 'blocked', filename: name, reason: 'executable/script blocked' });
      return { ok: false, blocked: true };
    }
    const dest = deps.uniqueDownloadPath(name);
    const dlId = `tor_dl_${++seq}`;
    saveIds.set(`${id}:${index}`, dlId);
    send('agent:download-event', { id: dlId, state: 'started', filename: path.basename(dest), path: dest, totalBytes: file?.length || 0, paused: false });
    child.postMessage({ t: 'save', id, index, dest });
    return { ok: true, dest };
  });

  ipcMain.handle('torrent:remove', (_e, id: string, destroyStore?: boolean) => {
    if (child) child.postMessage({ t: 'remove', id, destroyStore: destroyStore !== false });
    reg.delete(id);
    return { ok: true };
  });

  ipcMain.handle('torrent:list', () => Array.from(reg.values()));

  return {
    // Chamado pelo main quando intercepta um magnet:/.torrent (navegação/popup/omnibox).
    // Empurra o card no renderer, que então pede play/save.
    handleUri(uri: string) {
      send('agent:torrent-event', { kind: 'open', uri });
    },
  };
}
