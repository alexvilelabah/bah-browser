// Suite de benchmark: roda varios cenarios diversos no agente, um por um,
// e imprime um resumo consolidado (status, passos, bloqueios, onde falhou).
// Uso: DEEPSEEK_API_KEY=sk-... node tools/claude-suite.mjs
import { _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const apiKey = process.env.DEEPSEEK_API_KEY || '';
if (!apiKey) { console.error('defina DEEPSEEK_API_KEY'); process.exit(2); }
const PER_TASK_MS = Number(process.env.PER_TASK_MS || 150000);

// Cenarios variados — cada um estressa uma adversidade diferente
const TASKS = [
  { id: 'fato',        cmd: 'pesquisar no Google a altura da torre Eiffel e me dizer a altura em metros' },
  { id: 'infobox',     cmd: 'abrir a Wikipedia em portugues sobre o Japao e me dizer a populacao aproximada do pais' },
  { id: 'artigo',      cmd: "no Google, pesquisar 'melhor notebook custo beneficio 2024', abrir um artigo de um resultado e me dizer um modelo de notebook recomendado" },
  { id: 'noticia',     cmd: 'abrir o site cnnbrasil.com.br e me dizer qual e a manchete principal do topo da pagina' },
  { id: 'github',      cmd: 'no GitHub, encontrar o repositorio oficial do editor VS Code (microsoft/vscode) e me dizer aproximadamente quantas estrelas ele tem' },
  { id: 'cotacao',     cmd: 'pesquisar no Google a cotacao do dolar hoje em reais e me dizer o valor atual' },
  { id: 'imdb',        cmd: 'abrir o IMDb e descobrir a nota (rating) do filme Interestelar (Interstellar) e me dizer a nota' },
  { id: 'pesq_dificil', cmd: 'encontrar um site que converte PDF para Word de graca e sem precisar de cadastro; abrir o site para confirmar e me dizer o nome e o link' },
];

const { ELECTRON_RUN_AS_NODE, ...env } = process.env;

async function runTask(task) {
  const app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [root],
    env: { ...env, E2E_MOCK_AI: '', NODE_ENV: 'test' },
  });
  const page = await app.firstWindow();
  const consoleLines = [];
  page.on('console', (m) => { const t = m.text(); if (/\[Agent\]|\[Recovery\]|error/i.test(t)) consoleLines.push(t.slice(0, 200)); });
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((k) => localStorage.setItem('aiSettings', JSON.stringify({ provider: 'deepseek', apiKey: k, baseUrl: '' })), apiKey);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  const t0 = Date.now();
  await page.getByTestId('agent-command-input').fill(task.cmd);
  await page.getByTestId('agent-run').click();

  const done = page.locator('.result-report, .result-error, [data-testid="agent-manual-continue"]').first();
  let outcome = 'timeout';
  try {
    await done.waitFor({ state: 'visible', timeout: PER_TASK_MS });
    if (await page.getByTestId('agent-manual-continue').isVisible().catch(() => false)) outcome = 'manual_help';
    else if (await page.locator('.result-error').first().isVisible().catch(() => false)) outcome = 'error';
    else outcome = 'done';
  } catch { outcome = 'timeout'; }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(__dirname, `_suite_${task.id}.png`) }).catch(() => {});
  const runLog = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('agentRuns.v1') || '[]').sort((a,b)=>b.startedAt-a.startedAt)[0] || null; } catch { return null; }
  });
  await app.close().catch(() => {});

  const steps = runLog?.steps || [];
  const blockers = steps.filter(s => s.recovery).map(s => s.recovery.blocker || s.recovery.decision);
  const fails = steps.filter(s => s.success === false).length;
  return {
    id: task.id, outcome, secs,
    status: runLog?.status || '?',
    nSteps: steps.length,
    fails,
    blockers: [...new Set(blockers)],
    finalReason: (runLog?.finalReason || '').slice(0, 160),
  };
}

const results = [];
for (const task of TASKS) {
  process.stdout.write(`\n>>> [${task.id}] ${task.cmd}\n`);
  try {
    const r = await runTask(task);
    results.push(r);
    console.log(`    => ${r.outcome} | status=${r.status} | ${r.nSteps} passos (${r.fails} falhas) | ${r.secs}s | bloqueios=[${r.blockers.join(',')}]`);
    console.log(`    => resposta: ${r.finalReason || '(sem resumo)'}`);
  } catch (e) {
    results.push({ id: task.id, outcome: 'crash', error: String(e).slice(0, 200) });
    console.log(`    => CRASH: ${String(e).slice(0, 200)}`);
  }
}

console.log('\n\n================ RESUMO DA SUITE ================');
for (const r of results) {
  const mark = r.outcome === 'done' && r.status === 'success' ? 'OK ' : r.outcome === 'manual_help' ? 'HELP' : 'FALHA';
  console.log(`[${mark}] ${r.id.padEnd(12)} ${String(r.outcome).padEnd(11)} passos=${r.nSteps ?? '?'} ${r.secs ? r.secs + 's' : ''} bloqueios=[${(r.blockers||[]).join(',')}]`);
}
console.log('================================================');
