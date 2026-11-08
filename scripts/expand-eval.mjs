// Mede a expansão do pedido (request-expansion.ts) com o modelo REAL, em node puro, pelo MESMO
// núcleo do motor (router-core.mjs). Imprime, por pedido: a saída crua do modelo, o veredito da
// conferência (validateExpansion) e o tempo.
//
//   node scripts/expand-eval.mjs [--model <arquivo.gguf>] [--gpu false] ["pedido" ...]
//
// Sem pedidos na linha de comando, usa a lista abaixo (pedidos ambíguos de achar/baixar mídia e
// alguns que NÃO devem mudar).
import os from 'os';
import path from 'path';
import { checkExpansion, shouldExpandRequest } from '../src/shared/request-expansion.ts';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const MODEL = opt('--model', path.join(os.homedir(), 'Library/Application Support/bah-browser-agent-test/models/qwen2.5-1.5b-instruct-q4_k_m.gguf'));
const GPU = opt('--gpu', 'auto');

const CASES = args.length ? args : [
  'find all the music videos from the movie top gun with tom cruise and download them',
  'find all the music videos from top gun with tom cruise',
  'download every song from the lion king soundtrack',
  'download all the songs from the dune soundtrack',
  'download all the music videos from the album bad',
  'download every song from the movie footloose',
  'download all the songs from the soundtrack of the movie the karate kid',
  'download all the songs from the movie a star is born with lady gaga',
  'download all the music videos from the album 1989 by taylor swift',
  'download all the songs from the batman movie soundtrack',
  'baixe todas as músicas da trilha sonora do filme o rei leão',
  'baixe todos os clipes do álbum thriller',
  'descarga todas las canciones de la banda sonora de la película titanic',
  'download every song from the movie grease',
  'find and download all the songs from the album abbey road',
];

const { loadRouter } = await import('../src/main/router/router-core.mjs');
const router = await loadRouter(MODEL, { gpu: GPU === 'false' ? false : GPU });
console.log(`backend=${router.backend} load=${router.loadMs}ms expand=${router.expand ? 'yes' : 'NO'}\n`);
for (const c of CASES) {
  if (!shouldExpandRequest(c)) { console.log(`- ${c}\n  (gate: not expanded)\n`); continue; }
  const r = await router.expand(c);
  const v = checkExpansion(c, r.raw);
  console.log(`- ${c}\n  model: ${r.raw}\n  verdict: ${v.ok ? 'ACCEPTED' : 'fallback (' + v.reason + ')'}  ${r.ms}ms\n`);
}
await router.dispose();
