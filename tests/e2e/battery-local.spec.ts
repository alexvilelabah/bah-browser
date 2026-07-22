import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// ── BATERIA DE DIAGNÓSTICO (Fase 1) ────────────────────────────────────────────
// Roda uma lista curada de comandos REAIS contra o modelo LOCAL (Ollama) e deixa o
// próprio agent-run-logger do app capturar tudo (observação → ação → resultado →
// status) em userData/agent-dataset/runs.jsonl. NÃO muda nada no produto: é só
// medição. O modelo fraco serve de MARTELO — quebra onde o navegador é frágil.
//
// Rodar:  E2E_BATTERY=1 npx playwright test battery-local
// Opções: E2E_BATTERY_MODEL=gpt-oss:20b   (padrão)
//         E2E_BATTERY_MODE=drive|normal   (padrão drive = IA pura, sem atalhos)
//         E2E_BATTERY_LIMIT=3             (só os N primeiros — spot-check rápido)
//         E2E_BATTERY_TIMEOUT=240         (segundos por tarefa)
//
// SEGURANÇA: a lista evita de propósito qualquer ação de risco (comprar/pagar/
// enviar/excluir) — essas abrem o diálogo de confirmação e travariam a bateria.

interface Cmd { cat: string; text: string }

const BATTERY: Cmd[] = [
  // A) Ferramenta única — o que o modelo fraco DEVERIA conseguir (1 decisão + executor)
  { cat: 'ferramenta-unica', text: 'toque uma música do 2pac' },
  { cat: 'ferramenta-unica', text: 'abra um vídeo sobre gatos' },
  { cat: 'ferramenta-unica', text: 'gere uma imagem de um gato astronauta' },
  { cat: 'ferramenta-unica', text: 'preço de iphone 15' },
  { cat: 'ferramenta-unica', text: 'notícias sobre inteligência artificial' },
  { cat: 'ferramenta-unica', text: 'baixe a música california love do 2pac' },

  // B) Navegar + contexto de página (precisa de página real na tela)
  { cat: 'navegar', text: 'abra o site pt.wikipedia.org/wiki/Inteligência_artificial' },
  { cat: 'pagina', text: 'resuma esta página' },
  { cat: 'pagina', text: 'o que diz nesta página?' },

  // C) Busca / find — inclui os sinônimos que consertamos
  { cat: 'busca', text: 'encontre uma gpu com 24gb de memoria' },
  { cat: 'busca', text: 'ache uma placa de video de 16gb' },
  { cat: 'busca', text: 'o que é fotossíntese?' },
  { cat: 'busca', text: 'qual a capital da Austrália?' },

  // D) Bordas de roteamento (os fixes recentes)
  { cat: 'roteamento', text: 'vc pode me ajudar a achar uma rtx 5070ti barata?' },

  // E) Multi-passo — onde o modelo fraco costuma se perder (o dado mais valioso)
  { cat: 'multi-passo', text: 'abra o youtube e busque por lofi' },
  { cat: 'multi-passo', text: 'vá no pt.wikipedia.org e busque por computação quântica e abra o primeiro resultado' },
];

test('battery: diagnostic run against the local model', async () => {
  test.skip(process.env.E2E_BATTERY !== '1', 'Set E2E_BATTERY=1 to run (slow: real local AI).');

  const MODEL = process.env.E2E_BATTERY_MODEL || 'gpt-oss:20b';
  const MODE = (process.env.E2E_BATTERY_MODE || 'drive') as 'drive' | 'normal';
  const PER_TASK_MS = Number(process.env.E2E_BATTERY_TIMEOUT || 240) * 1000;
  const list = process.env.E2E_BATTERY_LIMIT ? BATTERY.slice(0, Number(process.env.E2E_BATTERY_LIMIT)) : BATTERY;
  test.setTimeout(list.length * (PER_TASK_MS + 20_000) + 120_000);

  // IA REAL: garantir que o mock NÃO está ligado.
  const { ELECTRON_RUN_AS_NODE: _n, E2E_MOCK_AI: _m, ...env } = process.env;
  const app = await electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/electron/dist/electron.exe'),
    args: [path.resolve(__dirname, '../..')],
    env: { ...env, NODE_ENV: 'test' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const userData: string = await app.evaluate(async ({ app: a }) => a.getPath('userData'));
  const jsonl = path.join(userData, 'agent-dataset', 'runs.jsonl');
  const linesBefore = fs.existsSync(jsonl) ? fs.readFileSync(jsonl, 'utf-8').split('\n').filter(Boolean).length : 0;

  const results: Array<{ cat: string; text: string; ms: number; finished: boolean }> = [];
  try {
    // Semeia o estado: modo local (Ollama+modelo), coletor de dataset ON, modo de rota.
    await page.evaluate(({ model, mode }) => {
      localStorage.setItem('localSettings', JSON.stringify({ enabled: true, provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model }));
      localStorage.setItem('datasetCollect', 'on');
      localStorage.setItem('agentDrive', mode === 'drive' ? '1' : '0');
    }, { model: MODEL, mode: MODE });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const input = page.locator('[data-testid="agent-command-input"]');
    await expect(input).toBeVisible({ timeout: 20_000 });

    console.log(`\n===== BATERIA (${list.length} tarefas · modelo ${MODEL} · modo ${MODE}) =====\n`);
    for (const [i, cmd] of list.entries()) {
      await expect(input).toBeEnabled({ timeout: 60_000 });
      await input.fill(cmd.text);
      const t0 = Date.now();
      await input.press('Enter');
      // A caixa desabilita enquanto roda; esperar ela voltar = tarefa terminou.
      await expect(input).toBeDisabled({ timeout: 20_000 }).catch(() => {});
      let finished = true;
      try {
        await expect(input).toBeEnabled({ timeout: PER_TASK_MS });
      } catch {
        finished = false;
        // Travou: aperta Stop pra destravar e seguir a bateria.
        const stop = page.locator('[data-testid="agent-stop"]');
        if (await stop.count()) await stop.click().catch(() => {});
        await expect(input).toBeEnabled({ timeout: 60_000 }).catch(() => {});
      }
      const ms = Date.now() - t0;
      results.push({ cat: cmd.cat, text: cmd.text, ms, finished });
      console.log(`  [${String(i + 1).padStart(2)}/${list.length}] ${finished ? 'fim ' : 'TRAVOU'} ${String(Math.round(ms / 1000)).padStart(4)}s  ${cmd.cat.padEnd(16)} ${cmd.text}`);
      await page.waitForTimeout(1500);
    }
  } finally {
    // Dá um tempo pro último finishAgentRun gravar no disco antes de fechar.
    await page.waitForTimeout(2500);
    await app.close();
  }

  const linesAfter = fs.existsSync(jsonl) ? fs.readFileSync(jsonl, 'utf-8').split('\n').filter(Boolean).length : 0;
  const travadas = results.filter(r => !r.finished).length;
  const totalMin = Math.round(results.reduce((s, r) => s + r.ms, 0) / 60000);
  console.log(`\n===== RESUMO =====`);
  console.log(`tarefas: ${results.length} · travaram (timeout): ${travadas} · tempo total: ~${totalMin} min`);
  console.log(`runs gravadas no dataset: ${linesAfter - linesBefore} (arquivo: ${jsonl})`);
  console.log(`==================\n`);
});
