// Motor de torrent ISOLADO — roda num utilityProcess (processo Node separado), NÃO no
// main. Motivo crítico: o webtorrent 3.x lança erros internos não-tratados durante o
// streaming (piece-picker); inline no main isso derrubaria o navegador inteiro. Aqui,
// se o motor cair, morre só este processo filho — a janela do Bah sobrevive.
//
// Transportes: como é Node (não renderer sandbox), o cliente fala TCP + uTP + WebRTC →
// alcança o swarm BitTorrent de verdade (magnets normais acham peers). Um único cliente
// e um único servidor HTTP em 127.0.0.1 servem todos os torrents (o <video> aponta pra lá).
//
// Protocolo (via process.parentPort): mensagens {t, ...}. Ver torrent-manager.ts.
import WebTorrent from 'webtorrent';
import fs from 'fs';

// Blindagem: os throws internos do webtorrent NÃO podem derrubar o processo. Como estamos
// isolados, basta logar e seguir — a janela do Bah nunca é afetada por isto.
process.on('uncaughtException', (e) => { try { post({ t: 'log', msg: 'engine uncaught: ' + (e && e.message) }); } catch {} });
process.on('unhandledRejection', (e) => { try { post({ t: 'log', msg: 'engine rejection: ' + (e && (e.message || e)) }); } catch {} });

const port = process.parentPort;
const post = (m) => { try { port.postMessage(m); } catch {} };

let client = null;
let httpPort = 0;
let tmpDir = null;
const torrents = new Map();   // id -> { torrent, saving: Map<index, {ws, dest, timer}> }

function ensureClient() {
  if (client) return;
  client = new WebTorrent();
  client.on('error', (e) => post({ t: 'log', msg: 'client error: ' + (e && e.message) }));
  const server = client.createServer();
  server.listen(0, '127.0.0.1', () => {
    httpPort = server.server.address().port;
    post({ t: 'ready', port: httpPort });
  });
}

function fileList(torrent) {
  return torrent.files.map((f, index) => ({ index, name: f.name, length: f.length }));
}

// Stats de TODOS os torrents ativos, 1x/s (peers, progresso, velocidade) — pro card.
setInterval(() => {
  for (const [id, rec] of torrents) {
    const tr = rec.torrent;
    if (!tr) continue;
    post({
      t: 'stats', id,
      peers: tr.numPeers, progress: tr.progress,
      downloaded: tr.downloaded, downSpeed: tr.downloadSpeed, upSpeed: tr.uploadSpeed,
    });
  }
}, 1000);

port.on('message', (e) => {
  const m = e.data || {};
  try { handle(m); } catch (err) { post({ t: 'error', id: m.id, msg: String(err && err.message || err) }); }
});

function handle(m) {
  switch (m.t) {
    case 'init':
      tmpDir = m.tmp;
      ensureClient();
      break;

    case 'add': {
      ensureClient();
      const opts = { path: tmpDir, deselect: true };   // NADA baixa até o usuário escolher
      const src = m.buf ? Buffer.from(m.buf) : m.uri;
      const torrent = client.add(src, opts);
      const rec = { torrent, saving: new Map() };
      torrents.set(m.id, rec);
      const onErr = (e) => post({ t: 'error', id: m.id, msg: String(e && e.message || e) });
      torrent.on('error', onErr);
      const ready = () => {
        // Garante que nada está selecionado (metadata-first, sem baixar tudo).
        try { torrent.files.forEach((f) => f.deselect()); } catch {}
        post({ t: 'metadata', id: m.id, name: torrent.name, infoHash: torrent.infoHash, length: torrent.length, files: fileList(torrent) });
      };
      if (torrent.ready) ready(); else torrent.on('ready', ready);
      break;
    }

    case 'stream': {
      const rec = torrents.get(m.id);
      if (!rec) return;
      const f = rec.torrent.files[m.index];
      if (!f) return;
      f.select();   // prioriza os pedaços deste arquivo (streaming sequencial = default v2+)
      post({ t: 'stream', id: m.id, index: m.index, url: `http://127.0.0.1:${httpPort}${f.streamURL}` });
      break;
    }

    case 'save': {
      const rec = torrents.get(m.id);
      if (!rec) return;
      const f = rec.torrent.files[m.index];
      if (!f) return;
      f.select();
      const ws = fs.createWriteStream(m.dest);
      const rs = f.createReadStream();   // baixa+escreve em disco ao vivo (nunca .blob() = bomba de RAM)
      rs.on('error', (e) => { clearInterval(timer); post({ t: 'save-error', id: m.id, index: m.index, msg: String(e && e.message) }); });
      ws.on('error', (e) => { clearInterval(timer); post({ t: 'save-error', id: m.id, index: m.index, msg: String(e && e.message) }); });
      ws.on('finish', () => { clearInterval(timer); post({ t: 'save-done', id: m.id, index: m.index, dest: m.dest }); });
      const timer = setInterval(() => {
        post({ t: 'save-progress', id: m.id, index: m.index, dest: m.dest, bytes: f.downloaded, total: f.length, speed: rec.torrent.downloadSpeed });
      }, 500);
      rec.saving.set(m.index, { ws, dest: m.dest, timer });
      rs.pipe(ws);
      break;
    }

    case 'remove': {
      const rec = torrents.get(m.id);
      if (!rec) return;
      for (const s of rec.saving.values()) { try { clearInterval(s.timer); s.ws.destroy(); } catch {} }
      try { rec.torrent.destroy({ destroyStore: !!m.destroyStore }); } catch {}
      torrents.delete(m.id);
      break;
    }
  }
}
