import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// Prova: um vídeo baixado pela IA aparece no chat (card de mídia) MESMO depois de o
// usuário apertar Stop. Roda só sob demanda (E2E_STOP_DOWNLOAD=1) — baixa um vídeo real
// (o clássico "Me at the zoo", ~19s) via yt-dlp, então precisa de internet e é lento.
// Não fixa o cancelamento do Stop de propósito (decisão do Alex): a régua é só "fica visível".
test('a downloaded video still shows in the chat after pressing Stop', async () => {
  test.skip(process.env.E2E_STOP_DOWNLOAD !== '1', 'Set E2E_STOP_DOWNLOAD=1 to run (real download, ~1-3 min).');
  test.setTimeout(240_000);

  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron'),
    args: [path.resolve(__dirname, '../..'), '--use-mock-keychain'],
    env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' },   // download é quick action determinística; o mock não o toca
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  try {
    // "baixe o video ..." → detectQuickAction → download_video (sem nuvem).
    await page.getByTestId('agent-command-input').fill('baixe o video me at the zoo');
    await page.getByTestId('agent-run').click();

    // O download entrou em andamento (status aparece ANTES do await do yt-dlp). A 1ª vez
    // pode preparar o yt-dlp/ffmpeg antes — timeout generoso.
    await expect(page.getByText(/Downloading|Baixando/i).first()).toBeVisible({ timeout: 120_000 });

    // Aperta Stop AGORA, com o download em curso — é o cenário que queremos provar.
    await page.getByTestId('agent-stop').click();

    // A prova: quando o download termina, o card de mídia (🎬) aparece no chat mesmo
    // tendo apertado Stop. E nenhum erro de resultado.
    await expect(page.locator('.media-strip')).toBeVisible({ timeout: 150_000 });
    await expect(page.locator('.result-error')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
