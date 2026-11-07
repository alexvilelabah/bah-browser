// Identidade de navegador que os sites veem — UMA fonte pro User-Agent, os headers sec-ch-ua e o
// navigator.userAgentData (que o main aplica DE DENTRO do motor via CDP Emulation.setUserAgentOverride).
// Puro (sem electron): o main passa process.versions.chrome / process.platform / process.arch, e os
// testes de unidade passam o que quiserem.
//
// Por que assim: antes o header era reescrito à mão (Chrome da versão do motor, sempre "Windows") e o
// navigator era remendado por script no dom-ready, com outra ordem de brands e "Windows" fixo. A página
// lia o valor real antes do remendo, e header × JS × SO de verdade se contradiziam — contradição é o
// sinal clássico que os detectores de robô procuram.

// Versão que o Bah declara. Formato reduzido "NNN.0.0.0", como o Chrome manda desde 2023 (o número
// completo do build, ex. 148.0.7778.271, nenhum Chrome atual manda). Major = o maior entre o motor e o
// Chrome estável atual (o Chromium do Electron fica algumas versões atrás).
// SUBIR CURRENT_CHROME_MAJOR quando o Chrome estável avançar (~a cada 4 semanas).
export const CURRENT_CHROME_MAJOR = 156;

export interface Brand { brand: string; version: string }

export interface ChromeIdentity {
  major: string;
  version: string;               // "156.0.0.0"
  userAgent: string;
  secChUa: string;               // header sec-ch-ua (mesmos brands e ordem do navigator.userAgentData)
  chPlatform: string;            // sec-ch-ua-platform / userAgentData.platform: Windows | macOS | Linux
  navigatorPlatform: string;     // navigator.platform: Win32 | MacIntel | Linux x86_64
  architecture: string;          // userAgentData arch (getHighEntropyValues): x86 | arm
  bitness: string;
  brands: Brand[];
  fullVersionList: Brand[];
}

export interface IdentityInput {
  engineChrome?: string;          // process.versions.chrome
  platform: string;               // process.platform
  arch: string;                   // process.arch
  arm64Translation?: boolean;     // app.runningUnderARM64Translation (build x64 no Rosetta)
  currentMajor?: number;
}

export function chromeIdentity(input: IdentityInput): ChromeIdentity {
  const engineMajor = Number(String(input.engineChrome || '').split('.')[0]) || 0;
  const major = String(Math.max(engineMajor, input.currentMajor ?? CURRENT_CHROME_MAJOR));
  const version = `${major}.0.0.0`;
  // Plataforma REAL (era sempre "Windows"): site que detecta o SO — página de driver/instalador —
  // oferecia o arquivo de Windows num Mac. Os tokens são os fixos do Chrome de verdade em cada SO
  // (no Mac o Chrome manda "Intel Mac OS X 10_15_7" até em Apple Silicon).
  const mac = input.platform === 'darwin', linux = input.platform === 'linux';
  const uaPlatform = mac ? 'Macintosh; Intel Mac OS X 10_15_7' : linux ? 'X11; Linux x86_64' : 'Windows NT 10.0; Win64; x64';
  const chPlatform = mac ? 'macOS' : linux ? 'Linux' : 'Windows';
  const navigatorPlatform = mac ? 'MacIntel' : linux ? 'Linux x86_64' : 'Win32';
  // Arquitetura REAL pros Client Hints (site de instalador escolhe arm64 × x64 por aqui; o UA do Mac é
  // "Intel" fixo até em Apple Silicon). Build x64 no Rosetta → o hardware é ARM.
  const architecture = input.arch === 'arm64' || input.arm64Translation ? 'arm' : 'x86';
  const bitness = input.arch === 'ia32' ? '32' : '64';
  // Ordem e GREASE como o Chrome manda no header.
  const brands: Brand[] = [
    { brand: 'Not:A-Brand', version: '8' },
    { brand: 'Chromium', version: major },
    { brand: 'Google Chrome', version: major },
  ];
  return {
    major,
    version,
    userAgent: `Mozilla/5.0 (${uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
    secChUa: brands.map(b => `"${b.brand}";v="${b.version}"`).join(', '),
    chPlatform,
    navigatorPlatform,
    architecture,
    bitness,
    brands,
    fullVersionList: brands.map(b => ({ brand: b.brand, version: b.brand === 'Not:A-Brand' ? '8.0.0.0' : version })),
  };
}

/** Parâmetros do CDP Emulation.setUserAgentOverride: UA, idiomas (Accept-Language + navigator.languages)
 *  e userAgentData saem todos daqui, aplicados pelo motor ANTES de qualquer script da página. */
export function userAgentOverrideParams(id: ChromeIdentity, languages: string[], platformVersion = '') {
  return {
    userAgent: id.userAgent,
    acceptLanguage: languages.join(','),   // lista simples → navigator.languages = ["en-US","en"]
    platform: id.navigatorPlatform,
    userAgentMetadata: {
      brands: id.brands,
      fullVersionList: id.fullVersionList,
      fullVersion: id.version,
      platform: id.chPlatform,
      platformVersion,
      architecture: id.architecture,
      model: '',
      mobile: false,
      bitness: id.bitness,
      wow64: false,
    },
  };
}

/** O Chrome só manda client hints em contexto seguro: https e localhost (não em http comum). */
export function sendsClientHints(url: string): boolean {
  return /^https:|^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url || '');
}

// Ordem dos headers igual à do Chrome (o Electron não manda sec-ch-ua sozinho, e os que a gente
// acrescentava iam pro FIM — a ordem é parte da "assinatura" de um navegador).
export const CHROME_HEADER_ORDER = ['host', 'connection', 'content-length', 'pragma', 'cache-control', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'upgrade-insecure-requests', 'origin', 'content-type', 'user-agent', 'accept', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-user',
  'sec-fetch-dest', 'referer', 'accept-encoding', 'accept-language', 'cookie', 'priority'];

/** Reordena os headers na ordem do Chrome; os que não estão na lista vão no fim, na ordem original. */
export function orderChromeHeaders(h: Record<string, string>): Record<string, string> {
  const byLower = new Map(Object.keys(h).map(k => [k.toLowerCase(), k] as [string, string]));
  const out: Record<string, string> = {};
  for (const name of CHROME_HEADER_ORDER) { const k = byLower.get(name); if (k) { out[k] = h[k]; byLower.delete(name); } }
  for (const k of byLower.values()) out[k] = h[k];
  return out;
}
