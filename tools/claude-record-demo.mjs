// ─────────────────────────────────────────────────────────────────────────────
// GRAVADOR DA DEMO — lança o navegador via Playwright, deixa ele se demonstrar
// sozinho (sequência de quick-actions determinísticas), e GRAVA a tela em FHD
// 30fps com a RTX (ffmpeg gdigrab + h264_nvenc). Marca o instante de cada
// "momento UAU" em tools/_demo_markers.json pra a edição cortar no ponto certo.
//
// ffmpeg e o driver compartilham o MESMO relógio (o ffmpeg é filho deste processo),
// então os markers batem com o vídeo.
//
// Uso:  node tools/claude-record-demo.mjs            (chave via DEEPSEEK_API_KEY ou --key=)
// ─────────────────────────────────────────────────────────────────────────────
import { _electron as electron } from '@playwright/test';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const downloads = path.join(os.homedir(), 'Downloads');
const rawPath = path.join(downloads, '_demo_raw.mp4');
const markersPath = path.join(__dirname, '_demo_markers.json');

const keyArg = process.argv.find(a => a.startsWith('--key='));
const apiKey = keyArg ? keyArg.slice('--key='.length) : (process.env.DEEPSEEK_API_KEY || '');

// Sequência da demo: cada item é um comando + a legenda que vai no teaser.
// Tudo determinístico (quick action, 0 token) → rápido e confiável.
const SEQUENCE = [
  { cmd: 'baixe 3 músicas do tim maia', label: 'musica', caption: 'Baixe músicas num clique', waitMs: 150000 },
  { cmd: 'baixe 12 imagens de paisagens 4k', label: 'imagens', caption: 'Imagens em massa, em segundos', waitMs: 90000 },
  { cmd: 'preço do iphone 15', label: 'preco', caption: 'Compara preço sozinho', waitMs: 70000 },
  { cmd: 'notícias de tecnologia', label: 'noticias', caption: 'As notícias, organizadas', waitMs: 70000 },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
  console.log('[rec] lançando o app…');
  const app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [root],
    env: { ...env, E2E_MOCK_AI: '', NODE_ENV: 'test' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // injeta a chave (quick actions nem usam IA, mas deixa pronto p/ tomada de agente)
  if (apiKey) {
    await page.evaluate((k) => localStorage.setItem('aiSettings', JSON.stringify({ provider: 'deepseek', apiKey: k, baseUrl: '' })), apiKey);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
  }
  await sleep(1200);

  // maximiza pra ocupar a tela (janela sem moldura)
  try { await page.evaluate(() => (window).electronAPI?.maximize?.()); } catch {}
  await sleep(1500);

  // ── começa a GRAVAR (ffmpeg filho deste processo = relógio compartilhado) ──
  console.log('[rec] iniciando ffmpeg (gdigrab + h264_nvenc)…');
  const ff = spawn('ffmpeg', [
    '-y',
    '-f', 'gdigrab', '-framerate', '30',
    '-video_size', '1920x1080', '-offset_x', '0', '-offset_y', '0',
    '-i', 'desktop',
    '-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '21', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    rawPath,
  ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  ff.stderr.on('data', () => {}); // dreno (ffmpeg fala muito)

  await sleep(1800);             // warmup do gdigrab; depois disso o relógio "vale"
  const t0 = Date.now();
  const markers = [];
  const mark = (label, caption) => {
    const t = (Date.now() - t0) / 1000;
    markers.push({ label, caption, t: Math.round(t * 100) / 100 });
    console.log(`[rec] marcador "${label}" @ ${t.toFixed(1)}s`);
  };

  const reportCount = () => page.locator('.result-report').count();

  for (const step of SEQUENCE) {
    try {
      console.log(`[rec] >>> ${step.cmd}`);
      const before = await reportCount();
      await page.getByTestId('agent-command-input').fill(step.cmd);
      await page.getByTestId('agent-run').click();
      // espera um NOVO relatório de conclusão (ou erro) aparecer
      const deadline = Date.now() + step.waitMs;
      let done = false;
      while (Date.now() < deadline) {
        await sleep(800);
        const now = await reportCount().catch(() => before);
        const errs = await page.locator('.result-error').count().catch(() => 0);
        if (now > before) { done = true; break; }
        if (errs > 0) { console.log('[rec] (erro reportado nesse passo)'); done = true; break; }
      }
      if (done) {
        mark(step.label, step.caption);   // instante da conclusão (✅/media-strip na tela)
        await sleep(2600);                // deixa o ✅ + miniaturas respirarem na tela
      } else {
        console.log(`[rec] (timeout em "${step.label}", seguindo)`);
      }
    } catch (e) {
      console.log(`[rec] falhou "${step.label}": ${String(e?.message || e)}`);
    }
  }

  await sleep(1000);
  // ── para a gravação com 'q' (finaliza o mp4) e mata se demorar ──
  console.log('[rec] parando ffmpeg…');
  try { ff.stdin.write('q'); } catch {}
  await new Promise((res) => {
    let settled = false;
    ff.on('close', () => { if (!settled) { settled = true; res(); } });
    setTimeout(() => { if (!settled) { settled = true; try { ff.kill('SIGKILL'); } catch {} res(); } }, 6000);
  });

  fs.writeFileSync(markersPath, JSON.stringify({ raw: rawPath, t0, markers }, null, 2));
  console.log(`[rec] markers: ${markers.length} -> ${markersPath}`);
  console.log(`[rec] raw -> ${rawPath} (${fs.existsSync(rawPath) ? fs.statSync(rawPath).size : 0} bytes)`);

  await app.close();
  console.log('[rec] FIM');
}

main().catch((e) => { console.error('[rec] ERRO FATAL:', e); process.exit(1); });
