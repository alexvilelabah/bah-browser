// Runner de SESSAO UNICA: lanca o navegador UMA vez e roda varias tarefas
// na mesma janela (mais rapido, mantem cookies/sessao). Foco em sites novos.
import { _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const apiKey = process.env.DEEPSEEK_API_KEY || '';
if (!apiKey) { console.error('defina DEEPSEEK_API_KEY'); process.exit(2); }
const PER = Number(process.env.PER_TASK_MS || 130000);
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;

// Sites que NUNCA acessamos antes nesta jornada
const TASKS = [
  { id: 'tudogostoso',cmd: "abrir o site tudogostoso.com.br, buscar 'bolo de cenoura' e me dizer os ingredientes principais da primeira receita" },
  { id: 'climatempo', cmd: 'abrir o site climatempo.com.br e me dizer a temperatura maxima prevista para hoje em Sao Paulo' },
  { id: 'hackernews', cmd: 'abrir o site news.ycombinator.com (Hacker News) e me dizer o titulo da primeira noticia do topo da lista' },
];

const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [root], env: { ...env, E2E_MOCK_AI: '', NODE_ENV: 'test' },
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.evaluate((k) => localStorage.setItem('aiSettings', JSON.stringify({ provider: 'deepseek', apiKey: k, baseUrl: '' })), apiKey);
await page.reload();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1000);

const results = [];
for (const task of TASKS) {
  console.log(`\n>>> [${task.id}] ${task.cmd}`);
  const input = page.getByTestId('agent-command-input');
  // Se a tarefa anterior ainda estiver rodando (input desabilitado), pare-a pelo botao
  // de stop e aguarde o cancelamento propagar (so dispara no proximo checkpoint do loop,
  // que pode levar varios segundos se estiver no meio de um observe/settle).
  if (!(await input.isEnabled().catch(() => false))) {
    await page.getByTestId('agent-stop').click().catch(() => {});
    for (let i = 0; i < 60 && !(await input.isEnabled().catch(() => false)); i++) {
      await page.waitForTimeout(500);
    }
  }
  await input.fill('');
  await input.fill(task.cmd);
  const t0 = Date.now();
  await page.getByTestId('agent-run').click();
  const done = page.locator('.result-report, .result-error, [data-testid="agent-manual-continue"]').first();
  let outcome = 'timeout';
  try {
    await done.waitFor({ state: 'visible', timeout: PER });
    if (await page.getByTestId('agent-manual-continue').isVisible().catch(()=>false)) outcome = 'manual_help';
    else if (await page.locator('.result-error').first().isVisible().catch(()=>false)) outcome = 'error';
    else outcome = 'done';
  } catch { outcome = 'timeout'; }
  const secs = ((Date.now()-t0)/1000).toFixed(0);
  await page.screenshot({ path: path.join(__dirname, `_sess_${task.id}.png`) }).catch(()=>{});
  const runLog = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('agentRuns.v1')||'[]').sort((a,b)=>b.startedAt-a.startedAt)[0]||null; } catch { return null; } });
  const r = { id: task.id, outcome, secs, steps: runLog?.steps?.length ?? 0, reason: (runLog?.finalReason||'(sem resposta)').slice(0,300) };
  results.push(r);
  console.log(`    => ${r.outcome} | ${r.steps} passos | ${r.secs}s`);
  console.log(`    => ${r.reason}`);
  // se pausou pedindo ajuda manual, nao da pra continuar essa — segue para a proxima
  await page.waitForTimeout(800);
}

await app.close().catch(()=>{});
console.log('\n================ RESUMO (sessao unica, sites novos) ================');
for (const r of results) {
  const mark = r.outcome === 'done' ? 'OK ' : r.outcome === 'manual_help' ? 'HELP' : 'FALHA';
  console.log(`[${mark}] ${r.id.padEnd(12)} ${r.outcome.padEnd(11)} ${r.steps} passos ${r.secs}s`);
}
console.log('SESSION_DONE');
