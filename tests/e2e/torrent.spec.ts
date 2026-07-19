import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// Torrent viewer end to end no app BUILDADO. Gated (E2E_TORRENT=1) — a parte de metadata
// usa rede real. Prova: (1) o card "Salvar ou Tocar" aparece ao colar um magnet na barra;
// (2) a corrente renderer -> preload -> main -> utilityProcess(motor) -> metadata -> stream
// funciona pelo IPC real (não só pelo spike).
test('torrent: sheet opens on magnet and the engine streams a real torrent', async () => {
  test.skip(process.env.E2E_TORRENT !== '1', 'Set E2E_TORRENT=1 to run (uses the network).');
  test.setTimeout(120_000);

  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/electron/dist/electron.exe'),
    args: [path.resolve(__dirname, '../..')],
    env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  try {
    // (1) Colar um magnet na barra de endereço abre o card (estado "fetching") na hora.
    const bar = page.locator('.url-input');
    await bar.fill('magnet:?xt=urn:btih:0000000000000000000000000000000000000000&dn=teste');
    await bar.press('Enter');
    await expect(page.locator('.torrent-sheet')).toBeVisible({ timeout: 8000 });
    // Fecha o card do magnet-fantasma (sem peers) antes do teste real.
    await page.locator('.tsheet-x').click();
    await expect(page.locator('.torrent-sheet')).toHaveCount(0);

    // (2) Corrente real pelo IPC: add de um .torrent legal (metadata imediata) + stream URL.
    const TORRENT = 'https://cdimage.debian.org/debian-cd/current/amd64/bt-cd/debian-13.6.0-amd64-netinst.iso.torrent';
    const added: any = await page.evaluate((url) => (window as any).electronAPI.torrentAdd(url), TORRENT);
    expect(added.ok).toBe(true);
    expect(String(added.name)).toContain('debian');
    expect(added.files.length).toBeGreaterThan(0);

    const stream: any = await page.evaluate(
      (args: any) => (window as any).electronAPI.torrentPlay(args.id, 0),
      { id: added.id },
    );
    expect(stream.ok).toBe(true);
    expect(String(stream.url)).toContain('127.0.0.1');
    expect(String(stream.url)).toContain('/webtorrent/');

    await page.evaluate((args: any) => (window as any).electronAPI.torrentRemove(args.id, true), { id: added.id });
  } finally {
    await app.close();
  }
});
