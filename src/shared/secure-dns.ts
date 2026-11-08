// DNS seguro (DNS-over-HTTPS) — parte PURA (sem Electron), testável e usada pelo painel também.
// A configuração salva vira os parâmetros do app.configureHostResolver (vale pro app inteiro:
// todas as sessões — abas, anônima, janela de login do Google — usam o mesmo resolvedor).
//  • system (PADRÃO): nada muda — o que o Chromium já faz sem o Bah mexer: 'automatic' sem
//    servidores (usa DoH só se o DNS do sistema for de um provedor com DoH conhecido, senão DNS comum).
//  • preset: provedores públicos, sem cadastro (AdGuard, Mullvad, Quad9, Cloudflare).
//  • nextdns: a pessoa cola o ID da configuração dela (conta grátis em nextdns.io; ela gerencia as listas).
//  • custom: qualquer modelo DoH https (ex.: Pi-hole / AdGuard Home na rede de casa).
// strict: 'secure' (se o servidor DoH não responder, a busca falha) em vez de 'automatic' (cai pro DNS comum).

export type SecureDnsMode = 'system' | 'preset' | 'nextdns' | 'custom';
export type SecureDnsPresetId = 'adguard' | 'mullvad-adblock' | 'quad9' | 'cloudflare';

export interface SecureDnsSetting {
  mode: SecureDnsMode;
  preset?: SecureDnsPresetId;
  nextdnsId?: string;   // "abc123" ou "https://dns.nextdns.io/abc123"
  customUrl?: string;   // "https://pihole.lan/dns-query" ou "https://host/dns-query{?dns}"
  strict?: boolean;
}

/** Subconjunto do Electron.ConfigureHostResolverOptions que o Bah define. */
export interface HostResolverConfig {
  secureDnsMode: 'off' | 'automatic' | 'secure';
  secureDnsServers: string[];
}

export interface SecureDnsPreset {
  id: SecureDnsPresetId;
  name: string;
  url: string;
  adBlocking: boolean;
  malwareBlocking: boolean;
  signup: false;          // nenhum precisa de conta
  userManagedLists: false; // as listas são do provedor (pra gerenciar as suas: NextDNS ou custom)
}

// Endpoints DoH documentados pelos próprios provedores.
export const SECURE_DNS_PRESETS: readonly SecureDnsPreset[] = [
  { id: 'adguard', name: 'AdGuard DNS', url: 'https://dns.adguard-dns.com/dns-query', adBlocking: true, malwareBlocking: true, signup: false, userManagedLists: false },
  { id: 'mullvad-adblock', name: 'Mullvad DNS (adblock)', url: 'https://adblock.dns.mullvad.net/dns-query', adBlocking: true, malwareBlocking: false, signup: false, userManagedLists: false },
  { id: 'quad9', name: 'Quad9', url: 'https://dns.quad9.net/dns-query', adBlocking: false, malwareBlocking: true, signup: false, userManagedLists: false },
  { id: 'cloudflare', name: 'Cloudflare (1.1.1.1)', url: 'https://cloudflare-dns.com/dns-query', adBlocking: false, malwareBlocking: false, signup: false, userManagedLists: false },
];

export const DEFAULT_SECURE_DNS: SecureDnsSetting = { mode: 'system' };
/** O que o Chromium faz quando ninguém configura nada (= o Bah até hoje). */
export const SYSTEM_RESOLVER: HostResolverConfig = { secureDnsMode: 'automatic', secureDnsServers: [] };

const NEXTDNS_ID = /^[0-9a-f]{6}$/i;

/** ID do NextDNS a partir do que a pessoa colou ("abc123" ou "https://dns.nextdns.io/abc123"). */
export function parseNextDnsId(input: string): string | null {
  const s = String(input || '').trim();
  if (NEXTDNS_ID.test(s)) return s.toLowerCase();
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'dns.nextdns.io' || u.port || u.search || u.hash || u.username || u.password) return null;
  const m = /^\/([0-9a-f]{6})\/?$/i.exec(u.pathname);
  return m ? m[1].toLowerCase() : null;
}

/** Modelo DoH válido: https, com host, sem usuário/senha; o único "{...}" aceito é o {?dns} do RFC 8484. */
export function validateDohTemplate(input: string): { ok: true; url: string } | { ok: false; error: string } {
  const s = String(input || '').trim();
  if (!s) return { ok: false, error: 'empty URL' };
  if (/\s/.test(s)) return { ok: false, error: 'URL contains spaces' };
  const bare = s.replace(/\{\?dns\}$/, '');
  if (/[{}]/.test(bare)) return { ok: false, error: 'only the {?dns} template variable is supported' };
  let u: URL;
  try { u = new URL(bare); } catch { return { ok: false, error: 'not a valid URL' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'DNS-over-HTTPS needs an https:// URL' };
  if (!u.hostname) return { ok: false, error: 'missing host' };
  if (u.username || u.password) return { ok: false, error: 'credentials in the URL are not supported' };
  if (u.hash) return { ok: false, error: 'URL must not contain #' };
  return { ok: true, url: s };
}

export interface SecureDnsResult {
  setting: SecureDnsSetting;   // normalizada (o que se salva)
  config: HostResolverConfig;  // o que vai pro configureHostResolver
  error?: string;              // entrada ruim → volta pro sistema e diz por quê
}

/** Configuração salva → parâmetros do resolvedor. Qualquer entrada inválida cai no "system". */
export function resolveSecureDns(input: unknown): SecureDnsResult {
  const fail = (error: string): SecureDnsResult => ({ setting: { ...DEFAULT_SECURE_DNS }, config: { ...SYSTEM_RESOLVER, secureDnsServers: [] }, error });
  const s = (input && typeof input === 'object') ? input as Partial<SecureDnsSetting> : null;
  if (!s || !s.mode) return fail('missing setting');
  const strict = s.strict === true;
  const doh = (url: string): HostResolverConfig => ({ secureDnsMode: strict ? 'secure' : 'automatic', secureDnsServers: [url] });
  switch (s.mode) {
    case 'system':
      return { setting: { mode: 'system' }, config: { ...SYSTEM_RESOLVER, secureDnsServers: [] } };
    case 'preset': {
      const p = SECURE_DNS_PRESETS.find(x => x.id === s.preset);
      if (!p) return fail(`unknown preset: ${String(s.preset)}`);
      return { setting: { mode: 'preset', preset: p.id, strict }, config: doh(p.url) };
    }
    case 'nextdns': {
      const id = parseNextDnsId(String(s.nextdnsId || ''));
      if (!id) return fail('NextDNS configuration ID must be 6 characters (0-9, a-f), e.g. abc123, or https://dns.nextdns.io/abc123');
      return { setting: { mode: 'nextdns', nextdnsId: id, strict }, config: doh(`https://dns.nextdns.io/${id}`) };
    }
    case 'custom': {
      const v = validateDohTemplate(String(s.customUrl || ''));
      if (!v.ok) return fail(v.error);
      return { setting: { mode: 'custom', customUrl: v.url, strict }, config: doh(v.url) };
    }
    default:
      return fail(`unknown mode: ${String(s.mode)}`);
  }
}
