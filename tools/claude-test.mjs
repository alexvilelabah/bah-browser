// Harness autonomo: roda uma tarefa REAL no navegador, espera terminar,
// e despeja o diagnostico estruturado (status, passos, acoes, resultados,
// auto-avaliacoes, recovery) + um screenshot final.
//
// Uso:  node tools/claude-test.mjs "abrir o YouTube e buscar racionais mcs"
// Chave: lida de DEEPSEEK_API_KEY no ambiente (ou do arg --key=sk-...).
import { _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const command = process.argv[2];
if (!command) { console.error('ERRO: passe o comando. Ex: node tools/claude-test.mjs "abrir YouTube"'); process.exit(2); }
const keyArg = process.argv.find(a => a.startsWith('--key='));
const apiKey = keyArg ? keyArg.slice('--key='.length) : (process.env.DEEPSEEK_API_KEY || '');
if (!apiKey) { console.error('ERRO: defina DEEPSEEK_API_KEY ou passe --key=sk-...'); process.exit(2); }

const TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS || 210000);
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;

const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [root],
  env: { ...env, E2E_MOCK_AI: '', NODE_ENV: 'test' },
});

const page = await app.firstWindow();

// Captura o console do app (mostra "[Agent] step N", erros, cancelamentos)
const consoleLines = [];
const tStart = Date.now();
page.on('console', (msg) => {
  const t = msg.text();
  if (/\[Agent\]|\[Recovery\]|\[DeepSeek\]|CANCEL|error|Error|aborted/i.test(t)) {
    const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
    consoleLines.push(`[${elapsed}s] ${msg.type()}: ${t}`.slice(0, 300));
  }
});
page.on('pageerror', (e) => consoleLines.push(`pageerror: ${String(e).slice(0, 300)}`));

await page.waitForLoadState('domcontentloaded');

// Injeta a chave e o provider, depois recarrega para o app aplicar
await page.evaluate((k) => {
  localStorage.setItem('aiSettings', JSON.stringify({ provider: 'deepseek', apiKey: k, baseUrl: '' }));
}, apiKey);
await page.reload();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1200);

console.log(`\n=== TAREFA: ${command} ===\n`);
await page.getByTestId('agent-command-input').fill(command);
await page.getByTestId('agent-run').click();

// Espera terminar: resultado, erro, ou pedido de ajuda manual
const done = page.locator('.result-report, .result-error, [data-testid="agent-manual-continue"]').first();
let outcome = 'timeout';
try {
  await done.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
  if (await page.getByTestId('agent-manual-continue').isVisible().catch(() => false)) outcome = 'manual_help';
  else if (await page.locator('.result-error').first().isVisible().catch(() => false)) outcome = 'error';
  else outcome = 'done';
} catch { outcome = 'timeout'; }

await page.waitForTimeout(800);
await page.screenshot({ path: path.join(__dirname, '_test_final.png') });

// Extrai o ultimo run estruturado do logger
const runLog = await page.evaluate(() => {
  try {
    const runs = JSON.parse(localStorage.getItem('agentRuns.v1') || '[]');
    return runs.sort((a, b) => b.startedAt - a.startedAt)[0] || null;
  } catch { return null; }
});

console.log(`\n=== RESULTADO: ${outcome} ===`);
if (runLog) {
  console.log(`status=${runLog.status}  passos=${runLog.steps?.length ?? 0}`);
  console.log(`finalReason: ${runLog.finalReason || '(nenhum)'}`);
  console.log('\n--- PASSOS ---');
  for (const s of (runLog.steps || [])) {
    const ok = s.success === false ? 'X' : 'v';
    console.log(`[${ok}] passo ${s.step ?? '?'} ${s.actionType || ''} ${s.action || ''}`);
    if (s.evaluation) console.log(`     eval: ${s.evaluation}`);
    if (s.recovery) console.log(`     recovery: ${s.recovery.decision} (${s.recovery.blocker || ''}) — ${s.recovery.reason}`);
    if (s.manualHelp) console.log(`     manualHelp: ${s.manualHelp.kind} — ${s.manualHelp.reason}`);
    if (s.success === false && s.result) console.log(`     result: ${JSON.stringify(s.result).slice(0, 200)}`);
  }
} else {
  console.log('(sem run estruturado no log — o agente pode nem ter iniciado)');
}

console.log('\n--- CONSOLE DO APP (ultimas 30 linhas relevantes) ---');
for (const l of consoleLines.slice(-30)) console.log(l);

await app.close();
console.log('\n=== FIM ===');
