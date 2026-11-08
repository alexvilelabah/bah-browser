// Motor do roteador local — roda num utilityProcess (como o motor de torrent), NUNCA no main:
// se o llama.cpp travar ou faltar memória, morre só este processo e a caixa volta pras regras.
// Carrega o Qwen2.5-1.5B-Instruct (GGUF) uma vez e só ROTULA texto: {route, ms} — ou reescreve um
// pedido ambíguo com a desambiguação (expand → {raw, ms}; o main confere). Não executa nada.
//
// Protocolo (process.parentPort): {t:'init', modelPath, gpu} → {t:'ready', backend, loadMs, rss} | {t:'error', msg}
//                                 {t:'classify', id, text, ctx} → {t:'result', id, route, ms}
//                                 {t:'expand', id, text} → {t:'expanded', id, raw, ms}
//                                 bt-fork/bt-send/bt-kill ↔ bt-msg/bt-exit: teste do binário (abaixo)
import cp from 'child_process';
import { syncBuiltinESMExports } from 'module';
import { EventEmitter } from 'events';
import { loadRouter } from './router-core.mjs';

process.on('uncaughtException', (e) => { post({ t: 'log', msg: 'router uncaught: ' + (e && e.message) }); });
process.on('unhandledRejection', (e) => { post({ t: 'log', msg: 'router rejection: ' + (e && (e.message || e)) }); });

const port = process.parentPort;
function post(m) { try { port.postMessage(m); } catch {} }

// No Windows (GPU) e no Linux o node-llama-cpp testa o binário nativo num processo filho antes de
// carregar. Daqui (utilityProcess) o fork dele cairia no child_process.fork, que com o fuse RunAsNode
// desligado abriria OUTRO Bah. Então o fork do arquivo de teste vira um pedido pro main, que abre o
// teste como utilityProcess (o próprio arquivo de teste fala por process.parentPort).
const tests = new Map();
let tseq = 0;
const realFork = cp.fork;
cp.fork = function (file, ...rest) {
  if (!/testBindingBinary[^/\\]*\.js$/.test(String(file))) return realFork.call(this, file, ...rest);
  const tid = ++tseq;
  const child = new EventEmitter();
  Object.assign(child, {
    exitCode: null, killed: false, stdout: null, stderr: null,
    send: (msg) => { post({ t: 'bt-send', tid, msg }); return true; },
    kill: () => { if (child.exitCode == null && !child.killed) { child.killed = true; post({ t: 'bt-kill', tid }); } return true; },
  });
  tests.set(tid, child);
  post({ t: 'bt-fork', tid, file: String(file) });
  return child;
};
syncBuiltinESMExports();

let router = null;

port.on('message', (e) => {
  const m = e.data;
  if (m?.t === 'init') {
    loadRouter(m.modelPath, { gpu: m.gpu === false ? false : 'auto' }).then(
      (r) => { router = r; post({ t: 'ready', backend: r.backend, loadMs: r.loadMs, rss: process.memoryUsage().rss }); },
      (err) => post({ t: 'error', msg: String(err?.message || err) }),
    );
  } else if (m?.t === 'classify') {
    if (!router) { post({ t: 'result', id: m.id, route: null, ms: 0 }); return; }
    router.classify(m.text, m.ctx).then(
      (r) => post({ t: 'result', id: m.id, route: r.route, ms: r.ms }),
      (err) => post({ t: 'result', id: m.id, route: null, ms: 0, error: String(err?.message || err) }),
    );
  } else if (m?.t === 'expand') {
    if (!router?.expand) { post({ t: 'expanded', id: m.id, raw: '', ms: 0 }); return; }
    router.expand(m.text).then(
      (r) => post({ t: 'expanded', id: m.id, raw: r.raw, ms: r.ms }),
      (err) => post({ t: 'expanded', id: m.id, raw: '', ms: 0, error: String(err?.message || err) }),
    );
  } else if (m?.t === 'bt-msg') {
    tests.get(m.tid)?.emit('message', m.msg);
  } else if (m?.t === 'bt-exit') {
    const c = tests.get(m.tid);
    if (c) { tests.delete(m.tid); c.exitCode = m.code ?? -1; c.emit('exit', c.exitCode); }
  }
});
