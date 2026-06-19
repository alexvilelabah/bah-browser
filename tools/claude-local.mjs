// Testa o agente no TIER LOCAL (Ollama qwen2.5:14b). Liga o modo local apontando pro
// modelo, roda uma tarefa que exercita o loop (navegar + ler + reportar) e mede passos +
// tempo + se o 14B obedece o contrato de JSON. Pré-requisito: Ollama no ar com o modelo.
import { _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const command = process.argv[2] || 'navegue para https://example.com e me diga em uma frase do que se trata o site';
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root], env: { ...env, NODE_ENV: 'test' } });
const page = await app.firstWindow();
const consoleLines = [];
const tStart = Date.now();
page.on('console', (m) => { const t = m.text(); if (/\[Ollama\]|\[Agent\]|\[HybridRouter\]|tier=|engine=|local/i.test(t)) consoleLines.push(`[${((Date.now() - tStart) / 1000).toFixed(1)}s] ${t}`.slice(0, 240)); });
await page.waitForLoadState('domcontentloaded');
const LOCAL_MODEL = process.env.LOCAL_MODEL || 'qwen2.5:14b';
await page.evaluate((m) => { localStorage.setItem('localSettings', JSON.stringify({ enabled: true, provider: 'ollama', baseUrl: 'http://localhost:11434', model: m })); }, LOCAL_MODEL);
await page.reload();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(3500);
console.log(`\n=== TAREFA (LOCAL qwen2.5:14b): ${command} ===\n`);
await page.getByTestId('agent-command-input').fill(command);
await page.getByTestId('agent-run').click();
const done = page.locator('.result-report, .result-error, [data-testid="agent-manual-continue"], .chat-msg.assistant .msg-content:not(.typing)').first();
let outcome = 'timeout';
try { await done.waitFor({ state: 'visible', timeout: Number(process.env.TASK_TIMEOUT_MS || 200000) }); outcome = 'done'; } catch { outcome = 'timeout'; }
await page.waitForTimeout(800);
const runLog = await page.evaluate(() => { try { const r = JSON.parse(localStorage.getItem('agentRuns.v1') || '[]'); return r.sort((a, b) => b.startedAt - a.startedAt)[0] || null; } catch { return null; } });
const finalText = await page.evaluate(() => { const rep = document.querySelector('.result-report'); if (rep) return 'REPORT: ' + (rep.textContent || '').trim().slice(0, 300); const e = document.querySelector('.result-error'); if (e) return 'ERROR: ' + (e.textContent || '').trim().slice(0, 200); return '(sem texto)'; });
console.log(`\n=== RESULTADO: ${outcome}  (${((Date.now() - tStart) / 1000).toFixed(1)}s total) ===`);
if (runLog) {
  console.log(`status=${runLog.status}  passos=${runLog.steps?.length ?? 0}`);
  for (const s of (runLog.steps || [])) { console.log(`[${s.success === false ? 'X' : 'v'}] ${s.actionType || ''} ${s.action || ''}`.slice(0, 120)); if (s.evaluation) console.log('     eval: ' + String(s.evaluation).slice(0, 100)); }
}
console.log('FINAL → ' + finalText);
console.log('--- console (Ollama/Agent) ---');
for (const l of consoleLines.slice(-28)) console.log(l);
await app.close();
console.log('=== FIM ===');
