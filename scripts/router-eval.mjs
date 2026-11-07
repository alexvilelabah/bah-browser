// Avalia o roteador local (Qwen2.5-1.5B-Instruct via node-llama-cpp, node puro) no conjunto
// tests/fixtures/routing-cases.json e compara com as regras de palavras de hoje.
//
//   node scripts/router-eval.mjs [--model <arquivo.gguf>] [--rules-only] [--gpu false] [--verbose]
//
// Imprime acerto por rota, confusões, p50/p95 de latência, tempo de carga e memória.
// "Caminho" junta PAGE e CHAT (os dois vão pro mesmo chat com a página anexada) — é o que muda
// pra pessoa. As regras de palavras rodam o código REAL do AgentCommandBar (helpers do topo do
// arquivo, empacotados com esbuild); a ORDEM do routeCommand e o pré-classificador do
// classifyIntent (App.tsx, dentro de um hook) são copiados aqui → aproximação.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { buildSync } from 'esbuild';
import { routeToIntent } from '../src/shared/router-routes.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const MODEL = opt('--model', path.join(os.homedir(), 'Library/Application Support/bah-browser-agent-test/models/qwen2.5-1.5b-instruct-q4_k_m.gguf'));
const RULES_ONLY = args.includes('--rules-only');
const VERBOSE = args.includes('--verbose');
const GPU = opt('--gpu', 'auto');

const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/routing-cases.json'), 'utf8'));
const cases = fx.cases.map(c => ({ ...c, context: fx.contexts[c.ctx] || {} }));
const LABELS = ['ACTION', 'PAGE', 'WEB', 'CHAT', 'LAST_RUN', 'FIX', 'other'];
// Caminho na caixa: PAGE e CHAT caem no mesmo runChat.
const pathOf = (r) => (r === 'PAGE' || r === 'CHAT') ? 'CHAT/PAGE' : (r || 'null');

// ── Regras de palavras (código real dos helpers, ordem copiada do routeCommand) ──
async function loadRules() {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer/components/AgentCommandBar.tsx'), 'utf8');
  const head = src.slice(0, src.indexOf('export default function AgentCommandBar'));
  const contents = `(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
(globalThis as any).window = Object.assign(globalThis, { addEventListener() {}, removeEventListener() {} });
${head}
import { isNewTabPage as __isNewTab } from '../search-engine';
export const R = { isQuestion, isInfoRequest, isPageOp, wantsDownload, wantsLiveBooking, wantsStoreBrowse, wantsPartLookup,
  isAboutCurrentPage, isImperativeAction, detectQuickAction, getInitialShortcutAction, commandHasExplicitUrl, pointsAtOpenScreen,
  vagueRequestKind, parseRepeatIntent, isNewTabPage: __isNewTab };`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-route-eval-'));
  const out = path.join(dir, 'rules.mjs');
  buildSync({
    stdin: { contents, resolveDir: path.join(ROOT, 'src/renderer/components'), loader: 'tsx', sourcefile: 'rules-entry.tsx' },
    bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', jsx: 'automatic',
    loader: { '.png': 'empty', '.svg': 'empty', '.css': 'empty', '.woff2': 'empty', '.woff': 'empty' },
  });
  const { R } = await import(pathToFileURL(out).href);
  return R;
}

function wordRoute(R, msg, ctx) {
  const url = ctx.url || '';
  const pageOpen = /^https?:\/\//.test(url) && !R.isNewTabPage(url);
  // routeCommand (AgentCommandBar.tsx), modo "IA dirige" desligado. As regras de hoje não têm
  // "pergunta sobre a última tarefa" nem "ficou incompleta": LAST_RUN/FIX caem nas outras.
  if (R.parseRepeatIntent(msg)) return 'ACTION';
  if (R.vagueRequestKind(msg)) return 'other';               // resposta fixa "peça direito"
  if (pageOpen && R.isQuestion(msg) && R.pointsAtOpenScreen(msg)) return 'PAGE';
  if (R.detectQuickAction(msg)) return 'ACTION';
  if (/\bplaylist\b/i.test(msg) && /\b(cri\w+|mont\w+|fa[cz]\w+|gera\w+|junt\w+|adicion\w+|creat\w+|make|made|build|generat\w+|add)\b/i.test(msg)) return 'ACTION';
  if (R.commandHasExplicitUrl(msg) && R.isImperativeAction(msg)) return 'ACTION';
  // classifyIntent (App.tsx): pré-classificador determinístico; no modo local devolve null depois.
  const m = msg.trim().toLowerCase();
  if (m.length <= 30 && /^(oi+|ol[áa]|e a[íi]|opa|eae|bom dia|boa tarde|boa noite|valeu|obrigad[oa]|hi|hello|hey|thanks|thank you|hola|buenos d[íi]as|buenas|gracias)[\s!,.?]*$/.test(m)) return 'CHAT';
  const hasUrl = /https?:\/\/|www\.[a-z0-9-]+|[a-z0-9-]+\.(com|org|net|gov|edu|io|co|br|app|dev|ai)\b/.test(m);
  const actionVerb = /\b(abra|abre|abrir|acesse|acessa|entre em|v[aá] (pra|para|em|no|na)|baixe|baixa|baixar|toque|toca|tocar|reproduza|clique|clica|clicar|compre|compra|comprar|pesquise|pesquisa|procure|busque|assine|assina|fa[çc]a login|logue|preencha|envie|mande|poste|crie|monte|gere|corte|open|go to|download|play|click|buy|search for|subscribe|log ?in|fill|send|post|create|make|generate|cut|abre|descarga|reproduce|compra|busca|crea)\b/.test(m);
  if (!actionVerb && !hasUrl) {
    const qs = /^(o ?que|oq\b|qual|quais|quem|como|por ?qu[eê]|pra ?que|para ?que|quando|onde|cad[êe]|what|who|whose|how|why|when|where|which|cu[áa]l(es)?|qu[ée]\b|qui[ée]n|c[óo]mo|por ?qu[ée]|cu[áa]ndo|d[óo]nde)\b/.test(m);
    if (qs || /\?\s*$/.test(m)) {
      if (/\b(voc[êe]|vc|you|tu|usted)\b/.test(m)) return 'CHAT';
      const aboutPage = /\b(ess[ae]|est[ae]|dess[ae]|dest[ae]|ness[ae]|nest[ae]) (p[áa]gina|aba|site|v[íi]deo|texto|artigo)|this (page|tab|site|video|article)|esta (p[áa]gina|pesta[ñn]a|web|video)|\bresum[air]|\bsummar|traduz|translate|traduce/.test(m);
      const priceish = /\b(quanto\s+custa|pre[çc]o|how\s+much|\bcost\b|barat)/i.test(m);
      if (aboutPage || (pageOpen && !priceish && R.pointsAtOpenScreen(m))) return 'PAGE';
      return 'WEB';
    }
  }
  // routeDeterministic
  const pointsAtScreen = pageOpen && R.isQuestion(msg) && R.pointsAtOpenScreen(msg);
  if (R.isAboutCurrentPage(msg) || pointsAtScreen) return 'PAGE';
  if (R.isPageOp(msg) && !R.isQuestion(msg)) return 'ACTION';
  if (R.wantsDownload(msg) || R.wantsLiveBooking(msg) || R.wantsStoreBrowse(msg) || R.wantsPartLookup(msg)) return 'ACTION';
  if (R.isInfoRequest(msg)) return 'WEB';
  if (R.getInitialShortcutAction(msg) || R.isImperativeAction(msg)) return 'ACTION';
  return 'CHAT';
}

// ── Relatório ──
function report(name, results) {
  const n = results.length;
  const strict = results.filter(r => r.got === r.want).length;
  const pathOk = results.filter(r => pathOf(r.got) === pathOf(r.want)).length;
  console.log(`\n=== ${name} ===`);
  console.log(`strict accuracy: ${strict}/${n} = ${(100 * strict / n).toFixed(1)}%   path accuracy (PAGE≡CHAT): ${pathOk}/${n} = ${(100 * pathOk / n).toFixed(1)}%`);
  const real = results.filter(r => r.real);
  console.log(`real failures fixed: ${real.filter(r => r.got === r.want).length}/${real.length}`);
  console.log('per route (strict):');
  for (const lab of LABELS) {
    const rows = results.filter(r => r.want === lab);
    if (!rows.length) continue;
    const ok = rows.filter(r => r.got === lab).length;
    const conf = {};
    for (const r of rows) if (r.got !== lab) conf[r.got ?? 'null'] = (conf[r.got ?? 'null'] || 0) + 1;
    const cs = Object.entries(conf).map(([k, v]) => `${k}×${v}`).join(', ');
    console.log(`  ${lab.padEnd(8)} ${String(ok).padStart(2)}/${String(rows.length).padEnd(2)} ${(100 * ok / rows.length).toFixed(0).padStart(3)}%${cs ? '   → ' + cs : ''}`);
  }
  const wrong = results.filter(r => r.got !== r.want);
  if (wrong.length) {
    console.log('misses:');
    for (const r of wrong) console.log(`  [${r.want} → ${r.got}] ${r.text}`);
  }
  return { strict, pathOk, n };
}

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const R = await loadRules();
const ruleResults = cases.map(c => ({ ...c, want: c.route, got: wordRoute(R, c.text, c.context) }));
report('word rules (approximation of local-mode routing, see header)', ruleResults);

if (!RULES_ONLY) {
  if (!fs.existsSync(MODEL)) { console.error(`\nmodel not found: ${MODEL}`); process.exit(1); }
  const { loadRouter } = await import('../src/main/router/router-core.mjs');
  const rss0 = process.memoryUsage().rss;
  const router = await loadRouter(MODEL, { gpu: GPU === 'false' ? false : GPU });
  const rss1 = process.memoryUsage().rss;
  console.log(`\nmodel loaded in ${router.loadMs} ms (incl. warm-up of the fixed prefix), backend=${router.backend}, rss +${Math.round((rss1 - rss0) / 1048576)} MB (total ${Math.round(rss1 / 1048576)} MB)`);
  const results = [];
  for (const c of cases) {
    const r = await router.classify(c.text, c.context);
    results.push({ ...c, want: c.route, got: r.route, raw: r.raw, ms: r.ms });
    if (VERBOSE) console.log(`${String(r.ms).padStart(5)} ms  ${c.route.padEnd(8)} ${String(r.route).padEnd(8)} ${c.text}`);
  }
  const rawOk = results.filter(r => r.raw === r.want).length;
  console.log(`\nmodel alone (before the question/statement check for LAST_RUN↔FIX): ${rawOk}/${results.length} = ${(100 * rawOk / results.length).toFixed(1)}%`);
  report(`local router (${path.basename(MODEL)})`, results);
  // Como o App usa: a saudação curta (regex do classifyIntent) sai antes do roteador.
  const GREET = /^(oi+|ol[áa]|e a[íi]|opa|eae|bom dia|boa tarde|boa noite|valeu|obrigad[oa]|hi|hello|hey|thanks|thank you|hola|buenos d[íi]as|buenas|gracias)[\s!,.?]*$/;
  const shipped = results.map(r => { const m = r.text.trim().toLowerCase(); return { ...r, got: m.length <= 30 && GREET.test(m) ? 'CHAT' : r.got }; });
  report('as wired in the app (greeting fast path, then the local router)', shipped);
  const ms = results.map(r => r.ms);
  console.log(`latency: p50 ${pct(ms, 0.5)} ms, p95 ${pct(ms, 0.95)} ms, max ${Math.max(...ms)} ms   peak rss ${Math.round(process.memoryUsage().rss / 1048576)} MB`);
  // Caminho final na caixa (como o App mapeia), pra conferência.
  const mapped = results.filter(r => routeToIntent(r.got, !!r.context.lastRun) === routeToIntent(r.want, !!r.context.lastRun)).length;
  console.log(`dispatch agreement after routeToIntent: ${mapped}/${results.length}`);
  await router.dispose();
}
