// Teste simples da job-queue (roda sobre o BUILD: dist/main/job-queue.js).
// Uso: npm run build && node tools/test-job-queue.mjs
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { enqueueJob, getQueueState } = require(path.resolve(__dirname, '../dist/main/job-queue.js'));

const log = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(2);
const job = async (lane, name, ms) => { log.push(`${ts()} START ${lane}/${name}`); await sleep(ms); log.push(`${ts()} END   ${lane}/${name}`); return name; };
let pass = 0, fail = 0;
const check = (cond, label) => { if (cond) { pass++; console.log('OK  ', label); } else { fail++; console.log('FAIL', label); } };

(async () => {
  const waits = [];
  const pA1 = enqueueJob('A', () => job('A', 'a1', 200), a => waits.push(`a1:${a}`), { label: 'a1' });
  const pA2 = enqueueJob('A', () => job('A', 'a2', 200), a => waits.push(`a2:${a}`), { label: 'a2' });
  const pErr = enqueueJob('A', async () => { log.push(`${ts()} START A/BOOM`); throw new Error('boom'); }, a => waits.push(`boom:${a}`));
  const pA3 = enqueueJob('A', () => job('A', 'a3', 120), a => waits.push(`a3:${a}`));
  const pB1 = enqueueJob('B', () => job('B', 'b1', 200));

  // estado logo após enfileirar: A deve ter 1 rodando + 3 esperando
  const st = getQueueState();
  check(st.A && st.A.running === 1 && st.A.pending === 3, `getQueueState A running=1 pending=3 (got r=${st.A?.running} p=${st.A?.pending})`);
  check(st.B && st.B.running === 1, 'getQueueState B running=1');

  const errMsg = await pErr.then(() => null, e => e.message);
  await Promise.allSettled([pA1, pA2, pA3, pB1]);

  const iA1end = log.findIndex(l => l.includes('END   A/a1'));
  const iA2start = log.findIndex(l => l.includes('START A/a2'));
  check(iA1end >= 0 && iA1end < iA2start, 'serial na mesma faixa (a2 só após a1 terminar)');
  const bStart = parseFloat((log.find(l => l.includes('START B/b1')) || '99').split(' ')[0]);
  check(bStart < 0.15, `paralelo entre faixas (b1 começou junto, t=${bStart})`);
  check(log.some(l => l.includes('END   A/a3')), 'erro não travou a fila (a3 rodou)');
  check(errMsg === 'boom', 'erro propagado pro chamador');

  // maxPending: lane com teto 2 → 1 roda, 2 esperam, 4ª deve ser rejeitada
  enqueueJob('C', () => sleep(300), undefined, { maxPending: 2 });
  enqueueJob('C', () => sleep(300), undefined, { maxPending: 2 });
  enqueueJob('C', () => sleep(300), undefined, { maxPending: 2 });
  const over = await enqueueJob('C', () => sleep(10), undefined, { maxPending: 2 }).then(() => null, e => e.message);
  check(typeof over === 'string' && /fila/i.test(over), `maxPending rejeita excedente (got: ${over})`);

  // fila esvazia ao terminar
  await sleep(700);
  const st2 = getQueueState();
  check(st2.A.running === 0 && st2.A.pending === 0, 'fila A esvaziou ao terminar');

  console.log(`\n==== ${pass} PASS / ${fail} FAIL ====`);
  process.exit(fail ? 1 : 0);
})();
