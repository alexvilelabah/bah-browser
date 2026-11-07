// Privacidade de rede — parte PURA (sem Electron), testável: política de WebRTC, versão de IP e os
// avisos de vazamento do painel ⋮ → Rede (proxy + DNS seguro + IP + WebRTC).
//
// Medido no Electron 44 (Chromium dele), não suposto:
//  • NÃO existe controle de família de IP pro tráfego das páginas: o switch --disable-ipv6 sumiu do
//    Chromium (o binário nem tem a string; com ele, "localhost" continua indo por ::1), e nem o
//    configureHostResolver nem as sessões têm opção de família. "Só IPv4"/"Só IPv6" ficam desligados.
//  • WebRTC: o padrão do Electron ('default') entrega os IPs REAIS das interfaces (IPv4 e IPv6 globais,
//    sem nome mDNS) pra qualquer página; 'default_public_interface_only' não gera candidato de host;
//    'disable_non_proxied_udp' não gera UDP nenhum fora do proxy.
//  • --force-fieldtrials=WebRTC-IPv6Default/Disabled/ tira os candidatos IPv6 do WebRTC (só no boot).

export type RtcPolicy = 'default' | 'default_public_and_private_interfaces' | 'default_public_interface_only' | 'disable_non_proxied_udp';
/** protect = automático (com proxy: só UDP pelo proxy; sem: só a interface pública, sem IPs locais). */
export type WebRtcChoice = 'protect' | 'default';
export type IpFamilyChoice = 'auto' | 'v4' | 'v6';
export type Fam = '4' | '6';

export interface NetworkPrefs {
  webrtc: WebRtcChoice;
  webrtcIpv4Only: boolean;   // WebRTC sem IPv6 (vale depois de reiniciar o Bah)
}
export const DEFAULT_NETWORK_PREFS: NetworkPrefs = { webrtc: 'protect', webrtcIpv4Only: false };

/** O que dá pra fazer de verdade no Electron 44 (ver o topo). */
export const IP_FAMILY_SUPPORT: Record<IpFamilyChoice, boolean> = { auto: true, v4: false, v6: false };

export function sanitizeNetworkPrefs(x: unknown): NetworkPrefs {
  const o = (x && typeof x === 'object') ? x as Partial<NetworkPrefs> : {};
  return { webrtc: o.webrtc === 'default' ? 'default' : 'protect', webrtcIpv4Only: o.webrtcIpv4Only === true };
}

export function webRtcPolicyFor(prefs: NetworkPrefs, proxied: boolean): RtcPolicy {
  if (prefs.webrtc === 'default') return 'default';
  return proxied ? 'disable_non_proxied_udp' : 'default_public_interface_only';
}

/** Valor do --force-fieldtrials (ou null). Só no boot: mudar pede reiniciar. */
export function webRtcFieldTrials(prefs: NetworkPrefs): string | null {
  return prefs.webrtcIpv4Only ? 'WebRTC-IPv6Default/Disabled/' : null;
}

// ── famílias de endereço ──
const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
/** Família de um IP literal ("192.168.1.10", "[2001:db8::1]", "2001:db8::1"); null pra nome de host. */
export function literalFamily(host: string): Fam | null {
  const h = String(host || '').trim().replace(/^\[|\]$/g, '');
  const m = V4.exec(h);
  if (m) return m.slice(1).every(n => +n <= 255) ? '4' : null;
  if (h.includes(':') && /^[0-9a-f:.]+(%.+)?$/i.test(h)) return '6';
  return null;
}
export function isLoopback(host: string): boolean {
  const h = String(host || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || /^127\./.test(h) || h === '::1';
}

/** Host do proxy manual ("proxy:8080", "socks5://1.2.3.4:1080", "http=a:80;https=a:80", "[::1]:8080"). */
export function proxyHost(server: string | undefined): string | null {
  let s = String(server || '').trim();
  if (!s) return null;
  if (s.includes('=')) s = (s.split(';').map(r => r.split('=')[1]).find(Boolean) || '').trim();
  s = s.replace(/^[a-z0-9]+:\/\//i, '');
  const v6 = /^\[([^\]]+)\]/.exec(s);
  if (v6) return v6[1];
  const host = s.split(/[:/]/)[0];
  return host || null;
}

/** Host do servidor DoH de um modelo https://... (aceita {?dns}). */
export function urlHost(url: string): string | null {
  try { return new URL(String(url).replace(/\{\?dns\}$/, '')).hostname.replace(/^\[|\]$/g, '') || null; } catch { return null; }
}

export interface IfaceInfo { family: string | number; address: string; internal: boolean }
/** Que famílias têm endereço "de verdade" (não loopback, não link-local; IPv6 só global 2000::/3). */
export function machineFamilies(ifaces: Record<string, IfaceInfo[] | undefined>): { v4: boolean; v6: boolean } {
  let v4 = false, v6 = false;
  for (const list of Object.values(ifaces)) for (const a of list || []) {
    if (a.internal) continue;
    const fam = String(a.family);
    if ((fam === 'IPv4' || fam === '4') && !/^169\.254\./.test(a.address) && !/^127\./.test(a.address)) v4 = true;
    if ((fam === 'IPv6' || fam === '6') && /^[23][0-9a-f]{3}:/i.test(a.address)) v6 = true;
  }
  return { v4, v6 };
}

// ── avisos de vazamento ──
export type LeakWarningId = 'family-proxy' | 'family-dns' | 'webrtc-bypass' | 'dns-behind-proxy';
export interface LeakWarning {
  id: LeakWarningId;
  level: 'warn' | 'info';
  family?: Fam;    // família do proxy/DNS configurado
  other?: Fam;     // a outra família que o computador também tem
  fix?: 'os-settings' | 'protect-webrtc';
}
export interface LeakInput {
  proxyActive: boolean;          // proxy manual ou PAC configurado no Bah
  proxyFamilies: Fam[] | null;   // famílias pelas quais o servidor proxy é alcançável (null = não sei)
  dnsActive: boolean;            // DNS seguro diferente de "sistema"
  dnsFamilies: Fam[] | null;
  webrtc: WebRtcChoice;
  ipFamily: IpFamilyChoice;
  machine: { v4: boolean; v6: boolean };
}

const single = (f: Fam[] | null): Fam | null => (f && new Set(f).size === 1) ? f[0] : null;

export function leakWarnings(i: LeakInput): LeakWarning[] {
  const out: LeakWarning[] = [];
  const familyLeak = (id: 'family-proxy' | 'family-dns', fams: Fam[] | null) => {
    const f = single(fams);
    if (!f || i.ipFamily !== 'auto') return;
    const other: Fam = f === '4' ? '6' : '4';
    if (other === '4' ? i.machine.v4 : i.machine.v6) out.push({ id, level: 'warn', family: f, other, fix: 'os-settings' });
  };
  if (i.proxyActive) familyLeak('family-proxy', i.proxyFamilies);
  if (i.dnsActive) familyLeak('family-dns', i.dnsFamilies);
  if (i.proxyActive && i.webrtc === 'default') out.push({ id: 'webrtc-bypass', level: 'warn', fix: 'protect-webrtc' });
  if (i.proxyActive && i.dnsActive) out.push({ id: 'dns-behind-proxy', level: 'info' });
  return out;
}
