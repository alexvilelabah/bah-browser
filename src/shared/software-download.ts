// "Baixe a última versão do <programa> pra este computador": o que o agente precisa saber da
// máquina (SO, versão, CPU) e as checagens do arquivo que começou a baixar — SO e CPU certos,
// site oficial (não agregador de "free download"), parede de login (para e pergunta).
// Puro (sem Electron/DOM) pra testar direto; o main monta o perfil e o renderer usa as checagens.

export type OsFamily = 'macos' | 'windows' | 'linux' | 'other';
export type CpuArch = 'x64' | 'arm64' | 'x86' | 'other';
export type LinuxPkg = 'deb' | 'rpm' | 'pacman' | '';

export interface MachineInput {
  platform: string;            // process.platform
  arch: string;                // process.arch
  osVersion?: string;          // process.getSystemVersion()
  /** Build x64 rodando no Rosetta / x64 emulado no Windows ARM: o hardware é ARM. */
  armTranslated?: boolean;
  /** Conteúdo do /etc/os-release (só Linux) — diz o tipo de pacote (.deb/.rpm). */
  linuxOsRelease?: string;
}

export interface MachineProfile {
  os: OsFamily;
  osName: string;              // "macOS 26.0 (Tahoe)", "Windows 11", "Linux (Ubuntu 24.04 LTS)"
  osVersion: string;
  arch: CpuArch;
  archLabel: string;           // "Intel (x86-64)", "Apple Silicon (arm64)", "x64 (64-bit)"…
  linuxPkg: LinuxPkg;
}

const MAC_NAMES: Record<string, string> = {
  '26': 'Tahoe', '15': 'Sequoia', '14': 'Sonoma', '13': 'Ventura', '12': 'Monterey', '11': 'Big Sur',
  '10.15': 'Catalina', '10.14': 'Mojave', '10.13': 'High Sierra',
};

/** Nome comercial do macOS ("Sequoia"): os seletores de driver (HP, Canon…) listam assim. */
export function macosCodename(version: string): string {
  const [maj, min] = String(version || '').split('.');
  return MAC_NAMES[maj === '10' ? `10.${min}` : maj] || '';
}

/** "10.0.22631" → "Windows 11": o build ≥ 22000 é o 11 (a versão continua "10.0" no kernel). */
export function windowsName(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || ''));
  if (!m) return 'Windows';
  if (m[1] === '10') return Number(m[3]) >= 22000 ? 'Windows 11' : 'Windows 10';
  return `Windows ${version}`;
}

/** Tipo de pacote da distro pelo /etc/os-release (ID e ID_LIKE). */
export function linuxPackageType(osRelease: string): LinuxPkg {
  const get = (k: string) => (new RegExp(`^${k}=(.*)$`, 'm').exec(osRelease || '')?.[1] || '').replace(/^["']|["']$/g, '').toLowerCase();
  const ids = `${get('ID')} ${get('ID_LIKE')}`;
  if (/\b(debian|ubuntu|linuxmint|pop|elementary|raspbian|kali|zorin)\b/.test(ids)) return 'deb';
  if (/\b(fedora|rhel|centos|rocky|almalinux|suse|opensuse|sles|mageia|amzn)\b/.test(ids)) return 'rpm';
  if (/\b(arch|manjaro|endeavouros)\b/.test(ids)) return 'pacman';
  return '';
}

export function machineProfile(input: MachineInput): MachineProfile {
  const os: OsFamily = input.platform === 'darwin' ? 'macos' : input.platform === 'win32' ? 'windows' : input.platform === 'linux' ? 'linux' : 'other';
  const a = input.arch === 'arm64' || input.armTranslated ? 'arm64' : input.arch === 'x64' ? 'x64' : input.arch === 'ia32' ? 'x86' : 'other';
  const ver = String(input.osVersion || '').trim();
  let osName = input.platform;
  if (os === 'macos') { const c = macosCodename(ver); osName = `macOS${ver ? ' ' + ver : ''}${c ? ` (${c})` : ''}`; }
  else if (os === 'windows') osName = windowsName(ver);
  else if (os === 'linux') {
    const pretty = (/^PRETTY_NAME=(.*)$/m.exec(input.linuxOsRelease || '')?.[1] || '').replace(/^["']|["']$/g, '');
    osName = pretty ? `Linux (${pretty})` : 'Linux';
  }
  const archLabel = a === 'arm64' ? (os === 'macos' ? 'Apple Silicon (arm64)' : 'ARM64')
    : a === 'x64' ? (os === 'macos' ? 'Intel (x86-64)' : 'x64 (64-bit Intel/AMD)')
    : a === 'x86' ? '32-bit x86' : input.arch;
  return { os, osName, osVersion: ver, arch: a, archLabel, linuxPkg: os === 'linux' ? linuxPackageType(input.linuxOsRelease || '') : '' };
}

/** O que escolher numa página de download, em uma frase (vai pro prompt do agente). */
export function pickHint(p: MachineProfile): string {
  if (p.os === 'macos') {
    return p.arch === 'arm64'
      ? 'the macOS build for Apple Silicon ("Apple Silicon", "M1/M2", "arm64") or "Universal" — a .dmg or .pkg. An Intel-only Mac build also runs (Rosetta) if nothing else is offered. Never .exe/.msi.'
      : 'the macOS build for Intel ("Intel", "x64", "x86_64") or "Universal" — a .dmg or .pkg. NOT an "Apple Silicon"/"M1"/"arm64"-only build (it will not run here). Never .exe/.msi.';
  }
  if (p.os === 'windows') {
    if (p.arch === 'arm64') return 'the Windows ARM64 installer (.exe/.msi) if offered, else the x64 one (runs emulated). Never .dmg/.pkg.';
    if (p.arch === 'x86') return 'the Windows 32-bit (x86) installer (.exe/.msi). Never .dmg/.pkg.';
    return 'the Windows 64-bit (x64) installer (.exe or .msi). Not ARM64; 32-bit/x86 only if it is the only Windows build. Never .dmg/.pkg.';
  }
  if (p.os === 'linux') {
    const cpu = p.arch === 'arm64' ? 'arm64/aarch64' : 'x86_64/amd64';
    const pkg = p.linuxPkg === 'deb' ? 'a .deb package' : p.linuxPkg === 'rpm' ? 'an .rpm package' : 'the distro\'s package';
    return `the Linux build for ${cpu}: ${pkg} if offered, else an .AppImage or .tar.gz. Never .exe/.dmg.`;
  }
  return 'the build for this operating system and CPU.';
}

/** Linha "THIS COMPUTER" do prompt de tarefas de download. */
export function machineLine(p: MachineProfile): string {
  return `THIS COMPUTER: ${p.osName} on ${p.archLabel}. PICK: ${pickHint(p)}`;
}

// ── O arquivo que começou a baixar: de que SO/CPU ele é? ──────────────────────────────────

export interface BuildInfo { os: OsFamily | ''; arch: CpuArch | 'universal' | ''; pkg: string }

// Token = pedaço do nome entre separadores ("Steam_arm64.dmg" → steam, arm64, dmg).
// "darwin" contém "win": por isso nada de substring solta.
const tok = (re: string) => new RegExp(`(?:^|[^a-z0-9])(?:${re})(?=$|[^a-z0-9])`);
const UNIVERSAL_RE = tok('universal2?|univ');
const ARM_RE = tok('arm64e?|aarch64|arm|armv8|apple[-_ ]?silicon|applesilicon|m1|m2|m3');
const X64_RE = tok('x64|x86[-_]64|amd64|intel(?:64)?|win64|64[-_ ]?bit');
const X86_RE = tok('x86|i[3-6]86|ia32|32[-_ ]?bit');
const WIN_RE = tok('win|win32|win64|windows|msvc');
const MAC_RE = tok('mac|macos|macosx|osx|darwin');
const LINUX_RE = tok('linux|ubuntu|debian|fedora|rhel|el[6-9]');

export function classifyBuild(filename: string): BuildInfo {
  const f = String(filename || '').toLowerCase().trim();
  const ext = /\.(app\.zip|tar\.gz|tar\.xz|[a-z0-9]+)$/.exec(f)?.[1] || '';
  let os: BuildInfo['os'] = '';
  if (/^(exe|msi|msix|msixbundle|appx|appxbundle)$/.test(ext)) os = 'windows';
  else if (/^(dmg|pkg|mpkg|app\.zip)$/.test(ext)) os = 'macos';
  else if (/^(deb|rpm|appimage|snap|flatpak)$/.test(ext)) os = 'linux';
  else if (WIN_RE.test(f)) os = 'windows';
  else if (MAC_RE.test(f)) os = 'macos';
  else if (LINUX_RE.test(f)) os = 'linux';
  const arch: BuildInfo['arch'] = UNIVERSAL_RE.test(f) ? 'universal'
    : ARM_RE.test(f) ? 'arm64'
    : X64_RE.test(f) ? 'x64'
    : X86_RE.test(f) ? 'x86' : '';
  return { os, arch, pkg: ext };
}

const OS_WORD: Record<OsFamily, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux', other: 'another system' };
const ARCH_WORD: Record<CpuArch | 'universal', string> = { x64: 'Intel/AMD x64', arm64: 'ARM64 (Apple Silicon/ARM)', x86: '32-bit x86', universal: 'Universal', other: 'another CPU' };

export interface BuildCheck { level: 'error' | 'warn' | ''; note: string }

/**
 * O arquivo combina com ESTA máquina? 'error' = não roda aqui (SO, CPU ou pacote errados) — o agente
 * tem que voltar e escolher outro; 'warn' = roda, mas tem coisa melhor (Intel num Mac M-series).
 */
export function checkBuild(filename: string, p: MachineProfile): BuildCheck {
  const b = classifyBuild(filename);
  const mine = OS_WORD[p.os];
  if (p.os === 'other') return { level: '', note: '' };
  if (b.os && b.os !== p.os) {
    const what = b.os === 'windows' ? 'a Windows installer' : b.os === 'macos' ? 'a macOS installer' : 'a Linux package';
    return { level: 'error', note: ` ⚠️ WRONG OS: ${filename} is ${what} but the user's computer is ${mine} — this is NOT what the user needs. Go back and pick the ${mine} download (check the OS selector).` };
  }
  if (p.os === 'linux' && p.linuxPkg && (b.pkg === 'deb' || b.pkg === 'rpm') && b.pkg !== p.linuxPkg) {
    return { level: 'error', note: ` ⚠️ WRONG PACKAGE: ${filename} is a .${b.pkg} package but this Linux uses .${p.linuxPkg} packages. Pick the .${p.linuxPkg} (or .AppImage/.tar.gz) download.` };
  }
  if (!b.arch || b.arch === 'universal' || b.arch === p.arch || p.arch === 'other') return { level: '', note: '' };
  // Roda emulado/compatível: x64 num Mac/Windows ARM, 32-bit num Windows 64-bit.
  const runsAnyway = (p.arch === 'arm64' && b.arch === 'x64' && (p.os === 'macos' || p.os === 'windows'))
    || (p.arch === 'x64' && b.arch === 'x86' && p.os === 'windows')
    || (p.arch === 'arm64' && b.arch === 'x86' && p.os === 'windows');
  if (runsAnyway) {
    return { level: 'warn', note: ` (note: ${filename} is the ${ARCH_WORD[b.arch]} build; this computer is ${p.archLabel} — it runs, but the native ${p.arch === 'arm64' ? 'ARM64/Apple Silicon' : 'x64'} or Universal build is better if the page offers one.)` };
  }
  return { level: 'error', note: ` ⚠️ WRONG CPU: ${filename} is built for ${ARCH_WORD[b.arch]} but this computer is ${p.archLabel} — it will not run here. Cancel it (cancel_download) and pick the ${p.os === 'macos' && p.arch === 'x64' ? 'Intel / x64 or Universal' : p.arch === 'arm64' ? 'ARM64 / Apple Silicon or Universal' : 'x64'} build.` };
}

// ── Botão de baixar da página ────────────────────────────────────────────────────────────────
// Fabricante não escreve "Download": Steam é "Install Steam", outros "Get the app", "Try free",
// "Install now". Mas "Install"/"Get" também abre loja de apps ou instala extensão — por isso os
// rótulos FRACOS só valem num link pra arquivo de instalador ou num botão sem link (que dispara o
// download); link pra loja nunca.

const INSTALLER_EXT_RE = /\.(dmg|pkg|mpkg|exe|msi|msix|msixbundle|appx|deb|rpm|appimage|snap|zip|tar\.gz|tgz|tar\.xz|7z)$/i;
const STORE_HREF_RE = /^(itms-apps|itms|macappstore|ms-windows-store|ms-appinstaller|market|steam|chrome-extension):|\/\/(apps\.apple\.com|itunes\.apple\.com|play\.google\.com|chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons|addons\.mozilla\.org|apps\.microsoft\.com|www\.microsoft\.com\/[a-z-]+\/store\/|snapcraft\.io|flathub\.org)/i;
// Fortes: dizem "baixar" com todas as letras.
const STRONG_DL_RE = /^((agree|accept|i agree|i accept)\b.*\bdownload\b.*|(free )?download( now| free| it)?|start download|download (for|on) (mac|macos|windows|linux|pc)\b.*|download \S+( \S+)? (for|on) (mac|macos|windows|linux|pc)\b.*|download (the )?(latest|installer|app|client)\b.*|baixar( agora| grátis| gratis)?|descargar( ahora| gratis)?)$/i;
// Fracos: "instalar/obter/testar" — só com o alvo certo.
const WEAK_DL_RE = /^(install( now| it now)?|install \S+( \S+)?( now| for (mac|macos|windows|linux|pc))?|get( it)?( now| free)?|get the app|get \S+( \S+)? (for|on) (mac|macos|windows|linux|pc)|try( it)? (for )?free( now)?|free trial|start (your )?free trial|instalar( agora)?)$/i;

/** Nome do arquivo no fim do link, se o link for pra um instalador ('' se não for). */
export function installerFileOf(href: string): string {
  try {
    const u = new URL(href, 'https://relative.invalid/');   // o atributo pode vir relativo ("/files/x.dmg")
    const last = decodeURIComponent(u.pathname.split('/').pop() || '');
    return INSTALLER_EXT_RE.test(last) ? last : '';
  } catch { return ''; }
}

/**
 * Este elemento é o botão/link que baixa o programa? `href` = destino do link (vazio = botão).
 * Forte ("Download for Mac") vale sempre, menos pra loja; fraco ("Install Steam", "Get") só com
 * link pra instalador, ou botão sem link de página.
 */
export function isDownloadControl(label: string, href = ''): boolean {
  const l = String(label || '').replace(/\s+/g, ' ').trim();
  if (!l || l.length > 60) return false;
  const h = String(href || '').trim();
  if (h && STORE_HREF_RE.test(h)) return false;
  if (STRONG_DL_RE.test(l)) return true;
  if (!WEAK_DL_RE.test(l)) return false;
  if (!h || /^(javascript:|#)/i.test(h) || /#$/.test(h)) return true;
  return !!installerFileOf(h);
}

// ── Sites de "free download" (agregadores): não são o fabricante ─────────────────────────────
// Reempacotam o instalador (às vezes com "download manager"/bundleware) e ficam desatualizados.
const AGGREGATOR_HOSTS = [
  'softonic.com', 'softonic.com.br', 'filehippo.com', 'uptodown.com', 'softpedia.com', 'filehorse.com', 'malavida.com',
  'baixaki.com.br', 'superdownloads.com.br', 'majorgeeks.com', 'snapfiles.com', 'soft32.com', 'getintopc.com', 'filecr.com',
  'updatestar.com', 'download.cnet.com', 'download.com', 'macupdate.com', 'filepuma.com', 'downloadastro.com', 'tucows.com',
  'brothersoft.com', 'download3k.com', 'softportal.com', 'portalprogramas.com', 'softmany.com', 'techspot.com/downloads',
  'chip.de/downloads', 'computerbild.de/download', 'driverpack.io', 'drivereasy.com', 'driverguide.com', 'driverscloud.com',
];

/** O host/caminho é de um agregador de downloads (não o site do fabricante)? Devolve o domínio ou ''. */
export function thirdPartyDownloadSite(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return ''; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const hostPath = `${host}${u.pathname.toLowerCase()}`;
  for (const a of AGGREGATOR_HOSTS) {
    if (a.includes('/')) { if (hostPath.startsWith(a) || hostPath.includes('.' + a)) return a.split('/')[0]; continue; }
    if (host === a || host.endsWith('.' + a)) return a;
  }
  return '';
}

export function thirdPartyNote(site: string): string {
  return site ? `⚠️ THIRD-PARTY DOWNLOAD SITE: ${site} is a download aggregator, not the software's maker — its installers can be outdated or bundle a "download manager"/adware. Do NOT download from here: go to the vendor's OFFICIAL site (web_search "<product> official download") and get it there.` : '';
}

// ── Parede de login no caminho do download ───────────────────────────────────────────────────
// SolidWorks, Altium, Adobe, Office: o instalador só sai com conta. O agente nunca digita senha nem
// cria conta — Bah pausa e a pessoa decide (entra ela mesma, ou para).

export interface WallObservation {
  url: string;
  title?: string;
  text?: string;
  elements?: Array<{ tag?: string; role?: string; type?: string; text?: string; aria?: string; placeholder?: string }>;
}

const AUTH_HOST_RE = /^(login|signin|auth|sso|account|accounts|id|identity|myaccount|my)\.|(^|\.)(login\.microsoftonline\.com|login\.live\.com|adobelogin\.com|okta\.com|auth0\.com)$/;
const AUTH_PATH_RE = /\/(login|log-in|signin|sign-in|sign_in|signup|sign-up|sign_up|register|registration|create-account|createaccount|auth|sso|oauth2?|authorize|saml)(\/|$|\.|\?)/i;
const AUTH_TEXT_RE = /\b((sign|log)\s*in|login)\s+(to|before you|in order to)\s+(download|continue)\b|\b(create|register)\s+(an?|your)\s+(free\s+)?account\s+to\s+(download|continue|get)\b|\b(requires?|need)\s+(an?|your)\s+(\w+\s+)?(account|sign[- ]?in|login)\b|\baccount\s+(is\s+)?required\b|\b3dexperience\s+id\b/i;

/** Esta página é uma parede de login/conta? Devolve o motivo (curto, em inglês pro log) ou ''. */
export function signInWall(o: WallObservation): string {
  let host = '', path = '';
  try { const u = new URL(o.url); host = u.hostname.toLowerCase(); path = u.pathname + u.search; } catch {}
  const els = o.elements || [];
  const norm = (s?: string) => String(s || '').toLowerCase();
  if (els.some(e => norm(e.type) === 'password' || (/input|textbox/.test(`${norm(e.tag)} ${norm(e.role)}`) && /\b(password|senha|contrase[nñ]a|passwort)\b/.test(`${norm(e.text)} ${norm(e.aria)} ${norm(e.placeholder)}`)))) {
    return 'a password field (sign-in form)';
  }
  if (host && AUTH_HOST_RE.test(host)) return `a sign-in site (${host})`;
  if (AUTH_PATH_RE.test(path)) return 'a sign-in/registration page';
  const text = `${o.title || ''} ${(o.text || '').slice(0, 3000)}`;
  const m = AUTH_TEXT_RE.exec(text);
  if (m) return `"${m[0].trim().slice(0, 60)}"`;
  return '';
}
