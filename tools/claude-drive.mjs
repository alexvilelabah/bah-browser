// Driver para o Claude (ou qualquer script) assumir o controle do navegador Electron.
// Lança o app via Playwright, executa uma sequencia de acoes e salva screenshots.
// Uso: node tools/claude-drive.mjs
import { _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const shot = (n) => path.join(__dirname, `_shot_${n}.png`);

const { ELECTRON_RUN_AS_NODE, ...env } = process.env;

const app = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [root],
  env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' },
});

const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1800);

// 1) Tela inicial
await page.screenshot({ path: shot(1) });
console.log('screenshot 1: tela inicial');

// 2) Digitar um comando na barra do agente (sem rodar — nao gasta API)
try {
  const input = page.getByTestId('agent-command-input');
  await input.fill('abrir o YouTube e buscar racionais mcs');
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot(2) });
  console.log('screenshot 2: comando digitado');
  const runEnabled = await page.getByTestId('agent-run').isEnabled().catch(() => false);
  console.log('botao run habilitado:', runEnabled);
} catch (e) {
  console.log('nao achei o input do agente:', e.message);
}

await app.close();
console.log('DONE');
