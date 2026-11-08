// Região e fuso: de onde a conexão SAI (VPN/proxy muda isso) × a região do computador.
// Os sites mostram preço/moeda/estoque pelo IP de saída; o agente precisa saber qual é.
// Fuso dos sites: só muda quando a PESSOA escolhe (viagem, voo) — nunca sozinho pra "parecer local".
// Puro (sem Electron/DOM) pra testar direto.

export type ShoppingMode = 'auto' | 'os' | 'fixed';
export type TzMode = 'os' | 'zone' | 'utc';
export type RegionSettings = {
  shopping: ShoppingMode;
  fixedCountry?: string;      // ISO 3166-1 alpha-2, ex.: "US"
  tz: TzMode;
  zone?: string;              // IANA, ex.: "Asia/Tokyo"
  keepTz?: boolean;           // senão o fuso escolhido volta pro do computador ao reiniciar
};
export const DEFAULT_REGION: RegionSettings = { shopping: 'auto', tz: 'os' };

/** País do /cdn-cgi/trace da Cloudflare ("loc=PT"). XX/T1 (desconhecido/Tor) → ''. */
export function parseTrace(text: string): string {
  const m = /^loc=([A-Z]{2})\s*$/m.exec(String(text || ''));
  return m && m[1] !== 'XX' && m[1] !== 'T1' ? m[1] : '';
}

export function isCountry(c: unknown): c is string { return typeof c === 'string' && /^[A-Z]{2}$/.test(c); }

/** Fuso IANA válido (Intl recusa nomes inventados). */
export function isTimeZone(z: unknown): z is string {
  if (typeof z !== 'string' || !z || z.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch { return false; }
}

/** Limpa o que veio do disco/IPC: valores inválidos voltam ao padrão. */
export function sanitizeRegion(r: any): RegionSettings {
  const shopping: ShoppingMode = ['auto', 'os', 'fixed'].includes(r?.shopping) ? r.shopping : 'auto';
  const fixedCountry = isCountry(String(r?.fixedCountry || '').toUpperCase()) ? String(r.fixedCountry).toUpperCase() : undefined;
  let tz: TzMode = ['os', 'zone', 'utc'].includes(r?.tz) ? r.tz : 'os';
  const zone = isTimeZone(r?.zone) ? r.zone : undefined;
  if (tz === 'zone' && !zone) tz = 'os';
  return { shopping: shopping === 'fixed' && !fixedCountry ? 'auto' : shopping, fixedCountry, tz, zone, keepTz: !!r?.keepTz };
}

/** Fuso que os sites devem ver: '' = o do computador (sem override). */
export function timezoneOverride(s: RegionSettings): string {
  return s.tz === 'utc' ? 'UTC' : s.tz === 'zone' && s.zone ? s.zone : '';
}

/** País das compras/buscas: auto = rede (se detectada) senão computador; os = computador; fixed = escolhido. */
export function shoppingCountry(s: RegionSettings, network: string, os: string): string {
  if (s.shopping === 'fixed' && s.fixedCountry) return s.fixedCountry;
  if (s.shopping === 'auto' && network) return network;
  return os || network || '';
}

const countryName = (c: string) => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(c) || c; } catch { return c; }
};

/** Linha do prompt do agente: onde a conexão sai, onde fica o computador, que fuso os sites veem. */
export function regionLine(s: RegionSettings, network: string, os: string, osTz: string): string {
  const parts: string[] = [];
  const shop = shoppingCountry(s, network, os);
  if (network && os && network !== os) {
    parts.push(`NETWORK LOCATION: ${countryName(network)} (${network}) — the connection exits there (VPN or proxy). The computer's region is ${countryName(os)} (${os}). Sites show ${countryName(network)}'s prices, currency, stock and shipping; say so when you report prices and do not call them local to ${countryName(os)}.`);
  } else if (network) {
    parts.push(`NETWORK LOCATION: ${countryName(network)} (${network}), same as the computer's region.`);
  }
  if (shop && shop !== network) parts.push(`SHOPPING REGION (user setting): ${countryName(shop)} (${shop}) — prefer that country's store sites and currency.`);
  const ov = timezoneOverride(s);
  if (ov) parts.push(`TIME ZONE: sites see ${ov} (the user chose this; the computer is on ${osTz}). Times on pages are in ${ov}.`);
  else parts.push(`TIME ZONE: sites see the computer's time zone (${osTz}). If the task plans a trip or flight in another time zone, you may suggest showing sites in that zone with { "action": "suggest_time_zone", "zone": "Area/City", "reason": "..." } — the user decides.`);
  return parts.join('\n');
}

/** País para o parâmetro de busca (gl= Google, cc= Bing). '' = não força. */
export function searchCountryParam(engine: 'google' | 'bing', country: string): string {
  if (!isCountry(country)) return '';
  return engine === 'google' ? `gl=${country}` : `cc=${country}`;
}
