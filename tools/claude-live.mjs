// Harness AO VIVO: roda UMA tarefa real usando a chave JÁ SALVA no app (não injeta
// nem imprime a chave). Entende os dois caminhos da caixa unificada:
//   - tarefa de agente  → .result-report / .result-error / step cards
//   - resposta de chat   → .chat-msg.assistant .msg-content (não-typing)
// Despeja diagnóstico estruturado (passos, ações, auto-avaliação, recovery) + texto final.
//
// Uso: node tools/claude-live.mjs "sua tarefa aqui"   [TASK_TIMEOUT_MS=150000]
import { _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const command = process.argv[2];
if (!command) { console.error('ERRO: passe a tarefa.'); process.exit(2); }
const TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS || 160000);
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;

const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [root],
  env: { ...env, E2E_MOCK_AI: '', NODE_ENV: 'test' },
});
const page = await app.firstWindow();

const consoleLines = [];
const tStart = Date.now();
page.on('console', (msg) => {
  const t = msg.text();
  if (/\[Agent\]|\[Recovery\]|\[DeepSeek\]|thinking|pensando|CANCEL|error|Error|aborted/i.test(t)) {
    const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
    consoleLines.push(`[${elapsed}s] ${msg.type()}: ${t}`.slice(0, 300));
  }
});
page.on('pageerror', (e) => consoleLines.push(`pageerror: ${String(e).slice(0, 300)}`));

await page.waitForLoadState('domcontentloaded');
// Confere se há chave salva (sem imprimir). Se não houver, aborta com aviso claro.
const keyLen = await page.evaluate(() => {
  try { const s = JSON.parse(localStorage.getItem('aiSettings') || 'null'); return s?.apiKey ? String(s.apiKey).length : 0; } catch { return 0; }
});
if (!keyLen) { console.log('SEM_CHAVE: nenhuma chave DeepSeek salva neste perfil.'); await app.close(); process.exit(3); }
// Dá tempo do efeito de boot aplicar a chave salva ao processo main (setAIProvider).
await page.waitForTimeout(1500);

// Pré-navegação opcional (pra testar "resuma esta página" etc.)
if (process.env.START_URL) {
  await page.evaluate((u) => { const wv = document.querySelector('webview'); if (wv) wv.loadURL(u); }, process.env.START_URL);
  await page.waitForTimeout(4000);
}
const tabsBefore = await page.evaluate(() => document.querySelectorAll('webview').length);

console.log(`\n=== TAREFA: ${command} === (abas antes: ${tabsBefore})\n`);
await page.getByTestId('agent-command-input').fill(command);
await page.getByTestId('agent-run').click();

// Fim: relatório/erro do agente, pedido de ajuda manual, OU resposta de chat (não-typing).
const done = page.locator('.result-report, .result-error, [data-testid="agent-manual-continue"], .chat-msg.assistant .msg-content:not(.typing)').first();
let outcome = 'timeout';
try {
  await done.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
  if (await page.getByTestId('agent-manual-continue').isVisible().catch(() => false)) outcome = 'manual_help';
  else if (await page.locator('.result-error').first().isVisible().catch(() => false)) outcome = 'error';
  else if (await page.locator('.result-report').first().isVisible().catch(() => false)) outcome = 'agent_done';
  else outcome = 'chat_reply';
} catch { outcome = 'timeout'; }

await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(__dirname, '_live_final.png') });

const runLog = await page.evaluate(() => {
  try { const r = JSON.parse(localStorage.getItem('agentRuns.v1') || '[]'); return r.sort((a, b) => b.startedAt - a.startedAt)[0] || null; } catch { return null; }
});
// Texto final visível (relatório do agente OU resposta do chat).
const finalText = await page.evaluate(() => {
  const rep = document.querySelector('.result-report');
  if (rep) return 'REPORT: ' + (rep.textContent || '').trim().slice(0, 700);
  const msgs = [...document.querySelectorAll('.chat-msg.assistant .msg-content:not(.typing)')];
  const last = msgs[msgs.length - 1];
  if (last) return 'CHAT: ' + (last.textContent || '').trim().slice(0, 700);
  const err = document.querySelector('.result-error');
  if (err) return 'ERROR: ' + (err.textContent || '').trim().slice(0, 400);
  return '(sem texto final)';
});
// Há botão "⚡ Fazer isso" (proposta de ação da caixa unificada)?
const hasActionBtn = await page.evaluate(() => !!document.querySelector('.chat-action-btn'));

const tabsAfter = await page.evaluate(() => document.querySelectorAll('webview').length);
// Estado do vídeo na aba ativa (pra testes de play/playlist): paused/muted/segundos.
const videoState = await page.evaluate(async () => {
  const wvs = [...document.querySelectorAll('webview')];
  const wv = wvs.find(w => w.style.display !== 'none') || wvs[0];
  if (!wv || !wv.executeJavaScript) return null;
  try { return await wv.executeJavaScript("(function(){var v=document.querySelector('video');return v?{paused:v.paused,muted:v.muted,sec:Math.round(v.currentTime||0)}:'sem-video';})()"); }
  catch (e) { return 'erro:' + (e && e.message); }
});
const elapsedTotal = ((Date.now() - tStart) / 1000).toFixed(1);
console.log(`\n=== RESULTADO: ${outcome}  (${elapsedTotal}s) ===`);
console.log(`abas: antes=${tabsBefore} depois=${tabsAfter}${tabsAfter > tabsBefore ? '  ⚠️ VAZOU ABA' : ''}`);
console.log('VIDEO: ' + JSON.stringify(videoState));
// Pesquisa rápida / chat não gravam run estruturado — não mostrar o run antigo (confunde).
if (runLog && outcome !== 'chat_reply') {
  console.log(`status=${runLog.status}  passos=${runLog.steps?.length ?? 0}  finalReason: ${runLog.finalReason || '(nenhum)'}`);
  console.log('--- PASSOS ---');
  for (const s of (runLog.steps || [])) {
    const ok = s.success === false ? 'X' : 'v';
    console.log(`[${ok}] passo ${s.step ?? '?'} ${s.actionType || ''} ${s.action || ''}`.slice(0, 160));
    if (s.evaluation) console.log(`     eval: ${String(s.evaluation).slice(0, 150)}`);
    if (s.recovery) console.log(`     recovery: ${s.recovery.decision} (${s.recovery.blocker || ''})`);
  }
}
console.log(`\nbotão "Fazer isso": ${hasActionBtn ? 'SIM' : 'não'}`);
console.log('FINAL → ' + finalText);
console.log('\n--- CONSOLE (relevante) ---');
for (const l of consoleLines.slice(-22)) console.log(l);
await app.close();
console.log('=== FIM ===');
