import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Indicador de som na aba (estilo Chrome): a aba que EMITE audio mostra o alto-falante,
// e ele some quando o som para. Prova a corrente inteira: audio-state-changed (main) ->
// IPC tab-audio -> lookup do wcId -> Tab.audible -> icone na TabBar.
// So sob demanda (E2E_TAB_AUDIO=1): precisa de um dispositivo de audio real na maquina.
test('tab shows the speaker icon while audio plays and drops it when it stops', async () => {
  test.skip(process.env.E2E_TAB_AUDIO !== '1', 'Set E2E_TAB_AUDIO=1 to run (needs an audio device).');
  test.setTimeout(90_000);

  // Tom continuo e baixo. O app roda com autoplay-policy=no-user-gesture-required,
  // entao o AudioContext ja nasce tocando (sem clique).
  const tonePath = path.join(os.tmpdir(), 'bah-tone-e2e.html');
  fs.writeFileSync(tonePath, `<body>tone<script>
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.02;              // -34 dBFS: bem acima do limiar de silencio do Chromium
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    window.stopTone = () => { osc.stop(); ctx.close(); };
  </script></body>`);
  const toneUrl = 'file:///' + tonePath.replace(/\\/g, '/');

  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/electron/dist/electron.exe'),
    args: [path.resolve(__dirname, '../..')],
    env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  try {
    await expect(page.locator('.tab')).toHaveCount(1);
    await expect(page.locator('.tab-audio')).toHaveCount(0);   // pagina muda = sem icone

    await page.evaluate((url) => (document.querySelector('webview') as any).loadURL(url), toneUrl);

    // Tocando -> alto-falante aparece.
    await expect(page.locator('.tab .tab-audio')).toHaveCount(1, { timeout: 25_000 });

    // Parou -> alto-falante some (nao fica preso).
    await page.evaluate(() =>
      (document.querySelector('webview') as any).executeJavaScript('window.stopTone()'));
    await expect(page.locator('.tab .tab-audio')).toHaveCount(0, { timeout: 25_000 });
  } finally {
    await app.close();
    try { fs.unlinkSync(tonePath); } catch {}
  }
});
