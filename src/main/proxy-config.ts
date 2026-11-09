// Config de proxy — parte PURA (sem Electron), testável: modos, conversão pro Session.setProxy,
// leitura das variáveis de ambiente. O resto (aplicar nas sessões, login 407) fica em proxy.ts.
export type ProxyMode = 'system' | 'manual' | 'pac' | 'direct';
export interface ProxyConfig {
  mode: ProxyMode;
  server?: string;    // manual: "proxy.corp:8080", "http://proxy:8080", "socks5://127.0.0.1:1080" ou regras "http=a:80;https=a:80"
  pacUrl?: string;    // pac: "http://wpad/wpad.dat"
  bypass?: string;    // manual/pac: "localhost,*.corp.local,10.0.0.0/8" (Chromium proxyBypassRules)
}

export function configFromEnv(env = process.env): ProxyConfig | null {
  const server = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy;
  if (!server) return null;
  return { mode: 'manual', server, bypass: env.NO_PROXY || env.no_proxy || '' };
}

/** Converte pra Electron Session.setProxy. "host:port" sem esquema vale pra http e https. */
export function toElectronProxy(c: ProxyConfig): { mode: string; proxyRules?: string; pacScript?: string; proxyBypassRules?: string } {
  const bypass = (c.bypass || '').split(/[,\s;]+/).filter(Boolean).join(',');
  if (c.mode === 'direct') return { mode: 'direct' };
  if (c.mode === 'pac' && c.pacUrl) return { mode: 'pac_script', pacScript: c.pacUrl, proxyBypassRules: bypass || undefined };
  if (c.mode === 'manual' && c.server) {
    const s = c.server.trim();
    const rules = /=/.test(s) ? s : /^[a-z0-9]+:\/\//i.test(s) ? s : `http=${s};https=${s}`;
    return { mode: 'fixed_servers', proxyRules: rules, proxyBypassRules: bypass || undefined };
  }
  return { mode: 'system' };
}

