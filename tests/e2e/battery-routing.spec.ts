import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// ── BATERIA DE ROTEAMENTO (comandos INÉDITOS) ──────────────────────────────────
// A bateria anterior estava viciada: usava o vocabulário que já tinha saído na
// conversa (gpu/rtx/2pac/gatos), então só exercitava caminhos já conhecidos. Esta
// usa assuntos totalmente novos e mede a pergunta que importa:
//   "esse pedido tomou o caminho CERTO?"
//     - pesquisa  = abriu aba oculta, buscou e respondeu NO CHAT com fontes  (ideal p/ fato)
//     - chat      = respondeu de memória, SEM pesquisar                      (frágil p/ fato)
//     - agente    = dirigiu o navegador                                      (ideal p/ mídia/ação)
//     - midia     = produziu arquivo (download/imagem)
// Roda em modo NORMAL (experiência real). No modo local o roteamento é 100%
// determinístico, então mede a decisão do roteador, não a sorte do modelo.
//
// Rodar: E2E_ROUTING=1 npx playwright test battery-routing

interface Cmd { esperado: string; text: string }

// `esperado` = o caminho que FAZ SENTIDO pra esse tipo de pedido (minha hipótese;
// o objetivo é justamente descobrir onde a realidade discorda).
const CMDS: Cmd[] = [
  // Fato puro → deveria PESQUISAR e responder no chat (memória de modelo falha)
  { esperado: 'pesquisa', text: 'quem descobriu o brasil?' },
  { esperado: 'pesquisa', text: 'qual a altura do monte everest' },
  { esperado: 'pesquisa', text: 'quantos jogadores tem um time de volei' },
  { esperado: 'pesquisa', text: 'qual a moeda oficial do japao' },
  // Fato que MUDA → memória não serve de jeito nenhum
  { esperado: 'pesquisa', text: 'quem ganhou o ultimo oscar de melhor filme' },
  { esperado: 'pesquisa', text: 'que horas sao em toquio agora' },
  // Mídia / ação → faz sentido abrir o navegador
  { esperado: 'agente',   text: 'toca uma musica do djavan' },
  { esperado: 'agente',   text: 'quero ver um video de receita de bolo de cenoura' },
  { esperado: 'midia',    text: 'baixa a musica garota de ipanema' },
  // Compra / preço
  { esperado: 'agente',   text: 'quanto custa uma bicicleta ergometrica' },
  { esperado: 'agente',   text: 'acha um fone de ouvido bluetooth bom e barato' },
  // Contexto de página (navega antes, depois pergunta sobre a tela)
  { esperado: 'agente',   text: 'abre o site g1.globo.com' },
  { esperado: 'chat',     text: 'do que fala essa pagina' },
  // Ambíguos — onde a decisão certa NÃO é óbvia (o dado mais interessante)
  { esperado: 'pesquisa', text: 'como fazer pao de queijo' },
  { esperado: 'pesquisa', text: 'me ensina a trocar um pneu' },
  { esperado: 'pesquisa', text: 'vale a pena comprar um carro eletrico?' },
  { esperado: 'chat',     text: 'traduz bom dia para japones' },
  { esperado: 'pesquisa', text: 'resume as noticias de hoje' },
];

test('routing: fresh commands, which path does each take', async () => {
  test.skip(process.env.E2E_ROUTING !== '1', 'Set E2E_ROUTING=1 to run.');
  const PER_TASK_MS = Number(process.env.E2E_ROUTING_TIMEOUT || 200) * 1000;
  const list = process.env.E2E_ROUTING_LIMIT ? CMDS.slice(0, Number(process.env.E2E_ROUTING_LIMIT)) : CMDS;
  test.setTimeout(list.length * (PER_TASK_MS + 20_000) + 120_000);

  const { ELECTRON_RUN_AS_NODE: _n, E2E_MOCK_AI: _m, ...env } = process.env;
  const app = await electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/electron/dist/electron.exe'),
    args: [path.resolve(__dirname, '../..')],
    env: { ...env, NODE_ENV: 'test' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const rows: Array<{ text: string; esperado: string; rota: string; ok: boolean; resp: string; s: number }> = [];
  try {
    await page.evaluate((model) => {
      localStorage.setItem('localSettings', JSON.stringify({ enabled: true, provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model }));
      localStorage.setItem('datasetCollect', 'on');
      localStorage.setItem('agentDrive', '0');   // modo NORMAL (experiência real)
    }, process.env.E2E_ROUTING_MODEL || 'gpt-oss:20b');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const input = page.locator('[data-testid="agent-command-input"]');
    await expect(input).toBeVisible({ timeout: 20_000 });

    // Estado do feed antes de cada comando → classifica pelo que APARECEU de novo.
    const snap = () => page.evaluate(() => ({
      runs: (() => { try { return JSON.parse(localStorage.getItem('agentRuns.v1') || '[]').length; } catch { return 0; } })(),
      sources: document.querySelectorAll('.chat-sources').length,
      assist: document.querySelectorAll('.chat-msg.assistant').length,
      report: document.querySelectorAll('.result-report').length,
      err: document.querySelectorAll('.result-error').length,
      media: document.querySelectorAll('.media-strip').length,
    }));

    console.log(`\n===== ROTEAMENTO (${list.length} comandos inéditos · modo normal) =====\n`);
    for (const c of list) {
      await expect(input).toBeEnabled({ timeout: 60_000 });
      const before = await snap();
      await input.fill(c.text);
      const t0 = Date.now();
      await input.press('Enter');
      await expect(input).toBeDisabled({ timeout: 20_000 }).catch(() => {});
      try { await expect(input).toBeEnabled({ timeout: PER_TASK_MS }); }
      catch {
        const stop = page.locator('[data-testid="agent-stop"]');
        if (await stop.count()) await stop.click().catch(() => {});
        await expect(input).toBeEnabled({ timeout: 60_000 }).catch(() => {});
      }
      const s = Math.round((Date.now() - t0) / 1000);
      const after = await snap();

      // Classificação: fontes novas = pesquisou; run de agente = dirigiu; mídia = arquivo.
      let rota = 'nada';
      if (after.media > before.media) rota = 'midia';
      else if (after.sources > before.sources) rota = 'pesquisa';
      else if (after.runs > before.runs) rota = 'agente';
      else if (after.assist > before.assist) rota = 'chat';
      else if (after.err > before.err) rota = 'erro';
      else if (after.report > before.report) rota = 'agente';

      const resp = await page.evaluate(() => {
        const all = document.querySelectorAll('.chat-msg.assistant .msg-content, .result-report, .result-error');
        const last = all[all.length - 1] as HTMLElement | undefined;
        return (last?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 110);
      });
      const ok = rota === c.esperado;
      rows.push({ text: c.text, esperado: c.esperado, rota, ok, resp, s });
      console.log(`  ${ok ? 'ok  ' : 'DIF '} ${String(s).padStart(3)}s  esperado=${c.esperado.padEnd(9)} real=${rota.padEnd(9)} | ${c.text}`);
      if (resp) console.log(`        -> ${resp}`);
      await page.waitForTimeout(1200);
    }
  } finally {
    await page.waitForTimeout(2000);
    await app.close();
  }

  console.log(`\n===== RESUMO POR ROTA =====`);
  const porRota: Record<string, number> = {};
  rows.forEach(r => { porRota[r.rota] = (porRota[r.rota] || 0) + 1; });
  console.log(Object.entries(porRota).map(([k, v]) => `${k}=${v}`).join(' · '));
  console.log(`bateu com a hipótese: ${rows.filter(r => r.ok).length}/${rows.length}`);
  console.log(`\n--- divergências (onde vale pensar) ---`);
  rows.filter(r => !r.ok).forEach(r => console.log(`  esperado ${r.esperado.padEnd(9)} deu ${r.rota.padEnd(9)} | ${r.text}`));
  console.log(`===========================\n`);
});
