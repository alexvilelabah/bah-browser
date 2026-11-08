// ⋮ → Rede: WebRTC (proteção contra vazamento de IP), versão de IP e avisos de vazamento.
// A lógica pura (política, famílias, avisos) fica em src/shared/network-privacy.ts.
// A política de WebRTC é aplicada em proxy.ts (que já a recalcula quando o proxy muda); aqui só a escolha.
import { app, ipcMain, session, shell } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  sanitizeNetworkPrefs, webRtcFieldTrials, leakWarnings, literalFamily, isLoopback, proxyHost, urlHost, machineFamilies,
  DEFAULT_NETWORK_PREFS, IP_FAMILY_SUPPORT, type NetworkPrefs, type Fam,
} from '../shared/network-privacy';
import { resolveSecureDns, SECURE_DNS_PRESETS, type SecureDnsSetting } from '../shared/secure-dns';
import type { ProxyConfig } from './proxy-config';

const cfgPath = () => path.join(app.getPath('userData'), 'network.json');
const isE2E = () => process.env.NODE_ENV === 'test' && process.env.E2E_MOCK_AI === '1';

let prefs: NetworkPrefs = { ...DEFAULT_NETWORK_PREFS };
let bootPrefs: NetworkPrefs = { ...DEFAULT_NETWORK_PREFS };   // o que valeu no boot (switches)

function load(): NetworkPrefs {
  try { return sanitizeNetworkPrefs(JSON.parse(fs.readFileSync(cfgPath(), 'utf8'))); } catch { return { ...DEFAULT_NETWORK_PREFS }; }
}
export const getNetworkPrefs = (): NetworkPrefs => prefs;

/** ANTES do 'ready': switches que o Chromium só lê no boot (WebRTC sem IPv6). */
export function applyNetworkStartupSwitches(): void {
  prefs = bootPrefs = load();
  const trials = webRtcFieldTrials(prefs);
  if (!trials) return;
  const prev = app.commandLine.getSwitchValue('force-fieldtrials');
  app.commandLine.appendSwitch('force-fieldtrials', prev ? `${prev.replace(/\/?$/, '/')}${trials}` : trials);
}

/** Famílias pelas quais um host é alcançável: literal → a dele; loopback/sem host → não sei; nome → DNS. */
async function hostFamilies(host: string | null): Promise<Fam[] | null> {
  if (!host || isLoopback(host)) return null;
  const lit = literalFamily(host);
  if (lit) return [lit];
  try {
    const r = await Promise.race([
      session.defaultSession.resolveHost(host),
      new Promise<never>((_, j) => setTimeout(() => j(new Error('timeout')), 3000)),
    ]);
    const fams = [...new Set(r.endpoints.map(e => (e.family === 'ipv6' ? '6' : '4') as Fam))];
    return fams.length ? fams : null;
  } catch { return null; }
}

function machine(): { v4: boolean; v6: boolean } {
  // Teste: E2E_NET_IFACES="v4,v6" simula as interfaces (o e2e não depende da rede da máquina).
  if (isE2E() && process.env.E2E_NET_IFACES !== undefined) {
    const f = process.env.E2E_NET_IFACES.split(',');
    return { v4: f.includes('v4'), v6: f.includes('v6') };
  }
  return machineFamilies(os.networkInterfaces() as any);
}

function dohHost(s: SecureDnsSetting): string | null {
  const r = resolveSecureDns(s);
  if (r.error || s.mode === 'system') return null;
  if (s.mode === 'preset') return urlHost(SECURE_DNS_PRESETS.find(p => p.id === r.setting.preset)?.url || '');
  return urlHost(r.config.secureDnsServers[0] || '');
}

export function setupNetworkPrivacy(deps: { getProxy: () => ProxyConfig; getSecureDns: () => SecureDnsSetting; refreshWebRtc: () => Promise<void> }): void {
  const status = async () => {
    const proxy = deps.getProxy(), dns = deps.getSecureDns();
    const proxyActive = proxy.mode === 'manual' || proxy.mode === 'pac';
    const dnsActive = dns.mode !== 'system';
    const m = machine();
    const warnings = leakWarnings({
      proxyActive, proxyFamilies: proxy.mode === 'manual' ? await hostFamilies(proxyHost(proxy.server)) : null,
      dnsActive, dnsFamilies: dnsActive ? await hostFamilies(dohHost(dns)) : null,
      webrtc: prefs.webrtc, ipFamily: 'auto', machine: m,
    });
    // Pro renderer só vão famílias/flags — nunca os endereços da máquina.
    return {
      prefs, machine: m, warnings, ipFamilySupport: IP_FAMILY_SUPPORT,
      restartNeeded: prefs.webrtcIpv4Only !== bootPrefs.webrtcIpv4Only,
      platform: process.platform,
    };
  };
  ipcMain.handle('net:get', status);
  ipcMain.handle('net:set', async (_e, p: Partial<NetworkPrefs>) => {
    prefs = sanitizeNetworkPrefs({ ...prefs, ...(p || {}) });
    try { fs.writeFileSync(cfgPath(), JSON.stringify(prefs, null, 2)); } catch {}
    await deps.refreshWebRtc();
    return { ok: true, ...(await status()) };
  });
  // Conserto de um clique pro aviso de família: abre os ajustes de rede do SO (o Bah não consegue
  // desligar o IPv6 sozinho no Electron 44). URL fixa — nada vem do renderer.
  ipcMain.handle('net:open-os-settings', async () => {
    const url = process.platform === 'darwin' ? 'x-apple.systempreferences:com.apple.Network-Settings.extension'
      : process.platform === 'win32' ? 'ms-settings:network-status' : null;
    if (!url) return { ok: false };
    try { await shell.openExternal(url); return { ok: true }; } catch { return { ok: false }; }
  });
}
