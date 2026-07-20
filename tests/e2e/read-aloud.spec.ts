import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// "Read this page aloud" end to end in the BUILT app. Gated (E2E_TTS=1) because it
// launches Electron and plays a moment of audio. Hermetic (no network): we point the
// active <webview> at a data: URL with known text, then drive the ⋮ menu item and assert
// speechSynthesis actually starts and stops. Both the menu item and the per-answer 🔊
// button share the same tts.ts speak()/stopSpeaking(), so this covers the whole feature.
test('read aloud: ⋮ menu reads the page and stops on toggle', async () => {
  test.skip(process.env.E2E_TTS !== '1', 'Set E2E_TTS=1 to run (launches Electron + audio).');
  test.setTimeout(60_000);

  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/electron/dist/electron.exe'),
    args: [path.resolve(__dirname, '../..')],
    env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  try {
    // Give the active <webview> deterministic, offline text to read.
    await page.waitForSelector('webview', { timeout: 8000 });
    await page.evaluate(() => {
      const wv = document.querySelector('webview') as any;
      if (wv) wv.src = 'data:text/html,' + encodeURIComponent('<h1>Test</h1><p>' + 'palavra '.repeat(60) + '</p>');
    });
    await page.waitForTimeout(1800);

    // Open the ⋮ menu. Try nth(1) ([0]=downloads, [1]=menu); fall back to nth(0).
    await page.locator('.menu-btn').nth(1).click();
    if (!(await page.locator('.menu-panel').isVisible())) {
      await page.locator('.menu-btn').nth(0).click();
    }
    await expect(page.locator('.menu-panel')).toBeVisible();

    // Match the read-page item by its 🔊 icon (language-independent: en/pt/es).
    const readItem = page.locator('.menu-item', { hasText: '🔊' });
    await expect(readItem).toBeVisible();
    await readItem.click();

    // Speech should start (speaking or queued) shortly after.
    await expect.poll(
      () => page.evaluate(() => window.speechSynthesis.speaking || window.speechSynthesis.pending),
      { timeout: 6000 },
    ).toBe(true);

    // The same item now flips to ⏹️ (Stop); clicking it stops speech.
    const stopItem = page.locator('.menu-item', { hasText: '⏹️' });
    await expect(stopItem).toBeVisible();
    await stopItem.click();
    await expect.poll(
      () => page.evaluate(() => window.speechSynthesis.speaking || window.speechSynthesis.pending),
      { timeout: 4000 },
    ).toBe(false);
  } finally {
    await app.close();
  }
});
