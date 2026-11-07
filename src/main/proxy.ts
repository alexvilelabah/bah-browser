// Proxy corporativo (ex.: Blue Coat) — paridade com o Chrome:
//  • modo: system (padrão: config do SO, inclusive PAC/WPAD) | manual (http/https/socks5) | pac | direct
//  • vale pra TODAS as sessões do Bah (abas, janelas de login, requisições do próprio Bah)
//  • login no proxy (407): credencial salva (cifrada com o chaveiro do SO) ou pergunta pra pessoa
// Sem config salva, HTTPS_PROXY/HTTP_PROXY/NO_PROXY do ambiente (TI pode pré-configurar).
import { app, ipcMain, session, safeStorage, webContents, type BrowserWindow, type Session, type WebContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import { configFromEnv, toElectronProxy, type ProxyConfig } from './proxy-config';
import { invalidateNetworkCountry } from './region';
import { setBaseNetwork, extensionControlsProxy, extensionControlsRtc, type RtcPolicy } from './proxy-base';
import { getNetworkPrefs } from './network-privacy';
import { webRtcPolicyFor } from '../shared/network-privacy';
export type { ProxyConfig } from './proxy-config';

const cfgPath = () => path.join(app.getPath('userData'), 'proxy.json');
const credPath = () => path.join(app.getPath('userData'), 'proxy-auth.json');

export function loadProxyConfig(): ProxyConfig {
  try {
    const c = JSON.parse(fs.readFileSync(cfgPath(), 'utf8'));
    if (c && ['system', 'manual', 'pac', 'direct'].includes(c.mode)) return c;
  } catch { /* sem arquivo */ }
  return configFromEnv() || { mode: 'system' };
}

const knownSessions = new Set<Session>();
let current: ProxyConfig = { mode: 'system' };

async function applyTo(s: Session): Promise<void> {
  if (extensionControlsProxy(s)) return;   // VPN de extensão no controle desta sessão (ela vence, como no Chrome)
  try { await s.setProxy(toElectronProxy(current) as Electron.ProxyConfig); await s.closeAllConnections?.(); } catch (e: any) { console.warn('[Proxy] setProxy failed:', e?.message || e); }
}

// WebRTC fala UDP direto e ignora o proxy → o IP real vaza (STUN). Com proxy ativo, só UDP pelo
// proxy (na prática: TURN/TCP). Sem proxy, só a interface pública: o padrão do Electron ('default')
// entrega os IPs locais reais (IPv4 e IPv6, sem mDNS) pra qualquer página. A pessoa pode escolher
// 'default' em ⋮ → Rede ("melhor qualidade de chamada") — network-privacy.ts.
let rtcPolicy: RtcPolicy = 'default_public_interface_only';
const setRtc = (wc: WebContents) => { try { if (!wc.isDestroyed() && !extensionControlsRtc(wc.session)) wc.setWebRTCIPHandlingPolicy(rtcPolicy); } catch {} };
async function refreshRtcPolicy(): Promise<void> {
  const via = current.mode === 'direct' ? 'DIRECT' : await proxyFor('https://www.example.com/');
  rtcPolicy = webRtcPolicyFor(getNetworkPrefs(), !via.startsWith('DIRECT'));
  setBaseNetwork(toElectronProxy(current) as Electron.ProxyConfig, rtcPolicy);
  webContents.getAllWebContents().forEach(setRtc);
}

// ── credenciais do proxy (cifradas com o chaveiro do SO; nunca vão pro agente/modelo) ──
type SavedCred = { user: string; pass: string };
function loadCreds(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(credPath(), 'utf8')) || {}; } catch { return {}; }
}
function getSavedCred(key: string): SavedCred | null {
  const enc = loadCreds()[key];
  if (!enc || !safeStorage.isEncryptionAvailable()) return null;
  try { return JSON.parse(safeStorage.decryptString(Buffer.from(enc, 'base64'))); } catch { return null; }
}
function saveCred(key: string, cred: SavedCred): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  const all = loadCreds();
  all[key] = safeStorage.encryptString(JSON.stringify(cred)).toString('base64');
  try { fs.writeFileSync(credPath(), JSON.stringify(all), { mode: 0o600 }); } catch {}
}
function forgetCreds(): void { try { fs.unlinkSync(credPath()); } catch {} }

export function setupProxy(getMainWindow: () => BrowserWindow | null): void {
  current = loadProxyConfig();
  const track = (s: Session) => { if (!knownSessions.has(s)) { knownSessions.add(s); void applyTo(s); } };
  track(session.defaultSession);
  app.on('session-created', track);
  app.on('web-contents-created', (_e, wc) => setRtc(wc));
  void Promise.all([...knownSessions].map(applyTo)).then(refreshRtcPolicy);

  ipcMain.handle('proxy:get', () => ({ config: current, webrtc: rtcPolicy, fromEnv: !fs.existsSync(cfgPath()) && !!configFromEnv(), hasSavedPassword: Object.keys(loadCreds()).length > 0 }));
  ipcMain.handle('proxy:set', async (_e, c: ProxyConfig) => {
    if (!c || !['system', 'manual', 'pac', 'direct'].includes(c.mode)) return { ok: false, error: 'invalid mode' };
    current = { mode: c.mode, server: String(c.server || '').trim() || undefined, pacUrl: String(c.pacUrl || '').trim() || undefined, bypass: String(c.bypass || '').trim() || undefined };
    try { fs.writeFileSync(cfgPath(), JSON.stringify(current, null, 2)); } catch {}
    await Promise.all([...knownSessions].map(applyTo));
    await refreshRtcPolicy();
    invalidateNetworkCountry();   // outra rota → outro país de saída
    return { ok: true, config: current };
  });
  ipcMain.handle('proxy:forget-passwords', () => { forgetCreds(); return { ok: true }; });
  // Teste: o que o proxy resolve pra uma URL e se ela abre pelo motor do navegador.
  ipcMain.handle('proxy:test', async (_e, url?: string) => {
    const target = url || 'https://www.google.com/generate_204';
    const s = session.fromPartition('persist:browser');
    let via = '';
    try { via = await s.resolveProxy(target); } catch {}
    try {
      const r = await s.fetch(target, { signal: AbortSignal.timeout(15000) } as any);
      return { ok: r.ok || r.status === 204, status: r.status, via };
    } catch (e: any) {
      return { ok: false, via, error: String(e?.message || e) };
    }
  });

  // Login no proxy (HTTP 407): credencial salva → senão pergunta à pessoa (caixa do Bah).
  const pending = new Map<number, (r: { user?: string; pass?: string; remember?: boolean } | null) => void>();
  const triedSaved = new Set<string>();
  let seq = 0;
  ipcMain.handle('proxy:auth-response', (_e, id: number, r: { user?: string; pass?: string; remember?: boolean } | null) => {
    pending.get(id)?.(r); pending.delete(id); return { ok: true };
  });
  app.on('login', (event, _wc, _details, authInfo, callback) => {
    if (!authInfo.isProxy) return;   // login de SITE (basic auth) segue o comportamento normal
    event.preventDefault();
    const key = `${authInfo.host}:${authInfo.port}`;
    const saved = getSavedCred(key);
    // 1ª tentativa com a salva; se o proxy recusar (pede de novo), pergunta à pessoa.
    if (saved && !triedSaved.has(key)) { triedSaved.add(key); callback(saved.user, saved.pass); setTimeout(() => triedSaved.delete(key), 30_000); return; }
    const win = getMainWindow();
    if (!win) { callback(); return; }
    const id = ++seq;
    pending.set(id, (r) => {
      if (!r || !r.user) { callback(); return; }
      if (r.remember) saveCred(key, { user: r.user, pass: r.pass || '' });
      callback(r.user, r.pass || '');
    });
    win.webContents.send('proxy:auth-request', { id, host: authInfo.host, port: authInfo.port, realm: authInfo.realm, scheme: authInfo.scheme });
  });
}

/** Config de proxy em vigor (pros avisos de vazamento do painel Rede). */
export const getProxyConfig = (): ProxyConfig => current;
/** Recalcula e reaplica a política de WebRTC (a escolha em ⋮ → Rede mudou). */
export const refreshWebRtcPolicy = (): Promise<void> => refreshRtcPolicy();

/** O proxy que o motor usaria pra esta URL ("DIRECT" ou "PROXY host:port; ..."). */
export async function proxyFor(url: string): Promise<string> {
  try { return await session.fromPartition('persist:browser').resolveProxy(url); } catch { return 'DIRECT'; }
}
