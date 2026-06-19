// Runner de pesquisa: roda perguntas atomicas e imprime o relatorio completo de cada.
import { _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const apiKey = process.env.DEEPSEEK_API_KEY || '';
const PER = Number(process.env.PER_TASK_MS || 160000);
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;

const Q = [
  'q1_widget', 'pesquisar no Google se App Widgets ainda sao suportados no Android 14 e 15 e qual a biblioteca moderna recomendada para criar widgets (Jetpack Glance); me diga a resposta resumida',
  'q2_glance', 'pesquisar no Google o que e o Jetpack Glance, se usa Jetpack Compose e se e a forma recomendada atual de fazer App Widgets no Android; me diga a resposta',
  'q3_interval', 'pesquisar no Google qual o intervalo minimo de atualizacao automatica de um App Widget Android via updatePeriodMillis e me dizer o valor em minutos',
  'q4_awesome', 'pesquisar no Google o endpoint da AwesomeAPI (economia.awesomeapi.com.br) para cotacao do dolar para real USD-BRL e se precisa de chave de API; me diga',
  'q5_apis', 'pesquisar no Google 3 APIs gratuitas de cotacao de moedas (forex) que nao precisam de cartao de credito, por exemplo Frankfurter, exchangerate.host e AwesomeAPI, e me dizer se cada uma e gratuita e se exige chave',
];

async function run(id, cmd) {
  const app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [root], env: { ...env, E2E_MOCK_AI: '', NODE_ENV: 'test' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((k) => localStorage.setItem('aiSettings', JSON.stringify({ provider: 'deepseek', apiKey: k, baseUrl: '' })), apiKey);
  await page.reload(); await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(900);
  await page.getByTestId('agent-command-input').fill(cmd);
  await page.getByTestId('agent-run').click();
  const done = page.locator('.result-report, .result-error, [data-testid="agent-manual-continue"]').first();
  let outcome = 'timeout';
  try { await done.waitFor({ state: 'visible', timeout: PER }); outcome = 'done'; } catch {}
  const runLog = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('agentRuns.v1')||'[]').sort((a,b)=>b.startedAt-a.startedAt)[0]||null; } catch { return null; } });
  await app.close().catch(()=>{});
  return { id, outcome, reason: runLog?.finalReason || '(sem resposta — timeout)', steps: runLog?.steps?.length ?? 0 };
}

for (let i = 0; i < Q.length; i += 2) {
  const id = Q[i], cmd = Q[i+1];
  const r = await run(id, cmd);
  console.log(`\n######## ${r.id} (${r.outcome}, ${r.steps} passos) ########`);
  console.log(r.reason);
}
console.log('\nRESEARCH_DONE');
