// Região da rede + fuso dos sites (painel 🌍 Região e hora). Ver src/shared/region.ts.
// Detecção: UMA requisição ao /cdn-cgi/trace da Cloudflare pelo motor (mesmo proxy/VPN das abas),
// só no modo "auto", no início de tarefa ou ao abrir o painel; cache de 10 min, zerado quando o
// proxy muda. Nos modos "computador"/"fixo" nada é consultado.
import { app, ipcMain, session } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_REGION, parseTrace, sanitizeRegion, shoppingCountry, timezoneOverride, type RegionSettings } from '../shared/region';

const file = () => path.join(app.getPath('userData'), 'region.json');
let settings: RegionSettings = { ...DEFAULT_REGION };
let cache: { country: string; at: number } | null = null;
let inflight: Promise<string> | null = null;
const TTL = 10 * 60_000;

export const osCountry = () => { try { return (app.getLocaleCountryCode() || '').toUpperCase(); } catch { return ''; } };
export const osTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || '';
/** Fuso que os sites devem ver ('' = o do computador). */
export const getTimezoneOverride = () => timezoneOverride(settings);
export function invalidateNetworkCountry(): void { cache = null; }

async function detect(force = false): Promise<string> {
  if (settings.shopping !== 'auto') return '';
  if (!force && cache && Date.now() - cache.at < TTL) return cache.country;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await session.fromPartition('persist:browser').fetch('https://www.cloudflare.com/cdn-cgi/trace', { signal: AbortSignal.timeout(8000) } as any);
      const country = parseTrace(await r.text());
      cache = { country, at: Date.now() };
      return country;
    } catch { return cache?.country || ''; }
    finally { inflight = null; }
  })();
  return inflight;
}

async function state(force = false) {
  const network = await detect(force);
  const os = osCountry();
  return { settings, network, os, osTz: osTimeZone(), shopping: shoppingCountry(settings, network, os), tzOverride: getTimezoneOverride(), checkedAt: cache?.at || 0 };
}

function peek() {
  const network = settings.shopping === 'auto' ? cache?.country || '' : '';
  const os = osCountry();
  return { settings, network, os, osTz: osTimeZone(), shopping: shoppingCountry(settings, network, os), tzOverride: getTimezoneOverride(), checkedAt: cache?.at || 0 };
}

export function setupRegion(applyTimezoneEverywhere: () => void, getMainWindow: () => Electron.BrowserWindow | null): void {
  try { settings = sanitizeRegion(JSON.parse(fs.readFileSync(file(), 'utf8'))); } catch { settings = { ...DEFAULT_REGION }; }
  // Fuso de viagem é temporário: volta pro do computador ao reiniciar, a não ser que a pessoa marque "manter".
  if (settings.tz !== 'os' && !settings.keepTz) { settings = { ...settings, tz: 'os' }; try { fs.writeFileSync(file(), JSON.stringify(settings, null, 2)); } catch {} }

  // 'peek' = só o que já se sabe (sem consultar a rede) — a UI usa ao abrir; tarefa/painel consultam.
  ipcMain.handle('region:get', (_e, mode?: boolean | 'peek') => mode === 'peek' ? peek() : state(mode === true));
  ipcMain.handle('region:set', async (_e, s: RegionSettings) => {
    const before = getTimezoneOverride();
    settings = sanitizeRegion(s);
    try { fs.writeFileSync(file(), JSON.stringify(settings, null, 2)); } catch {}
    if (getTimezoneOverride() !== before) applyTimezoneEverywhere();
    getMainWindow()?.webContents.send('region:changed');
    return state();
  });
}
