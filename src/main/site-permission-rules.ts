// Regras PURAS das permissões dos sites (sem Electron) — testadas em
// tests/unit/site-permissions.test.ts. Quem liga isso no Electron e na tela é
// site-permissions.ts.

export type PermKind =
  | 'camera' | 'microphone' | 'geolocation' | 'notifications' | 'clipboardRead' | 'midi'
  | 'openExternal' | 'fileSystem' | 'idleDetection' | 'windowManagement' | 'displayCapture';
// O que pode ficar GUARDADO por site ("abrir aplicativo" nunca fica: pergunta toda vez).
export const PERM_KINDS: PermKind[] = [
  'camera', 'microphone', 'geolocation', 'notifications', 'clipboardRead', 'midi',
  'fileSystem', 'idleDetection', 'windowManagement', 'displayCapture',
];
export type Decision = 'allow' | 'block';
export type PermStore = Record<string, Partial<Record<PermKind, Decision>>>;

// Liberadas sem perguntar (o Chrome também não pergunta): tela cheia, travar o mouse/teclado
// em jogo, DRM do Netflix/Prime (mediaKeySystem — negar quebra os streamings), escrever na
// área de transferência, cookies de login embutido (storage-access), escolher alto-falante.
const ALWAYS_ALLOW = new Set([
  'fullscreen', 'pointerLock', 'keyboardLock', 'mediaKeySystem', 'clipboard-sanitized-write',
  'speaker-selection', 'storage-access', 'top-level-storage-access',
]);
// Perguntam pra pessoa. O resto (nome desconhecido) é negado.
const ASK_KIND: Record<string, PermKind> = {
  geolocation: 'geolocation', notifications: 'notifications', 'clipboard-read': 'clipboardRead',
  midi: 'midi', midiSysex: 'midi', openExternal: 'openExternal', fileSystem: 'fileSystem',
  'idle-detection': 'idleDetection', 'window-management': 'windowManagement', 'display-capture': 'displayCapture',
};
// "Abrir aplicativo" com esses tipos de link: sempre negado (abrem o sistema, arquivos, scripts
// ou programas do Office/diagnóstico do Windows — usados em ataques). Base: a lista do Chrome.
const DANGEROUS_SCHEMES = new Set([
  'javascript', 'vbscript', 'file', 'data', 'shell', 'hcp', 'ms-help', 'res', 'view-source', 'afp', 'disk', 'disks',
  'ie.http', 'nntp', 'snews', 'vnd.ms.radio', 'mk', 'its', 'ms-its', 'cdl', 'telnet',
  'ms-msdt', 'search', 'search-ms', 'ms-officecmd', 'ms-word', 'ms-excel', 'ms-powerpoint', 'ms-visio',
  'ms-access', 'ms-project', 'ms-publisher', 'ms-spd', 'ms-infopath', 'ms-cxh', 'ms-cxh-full',
  'ms-appinstaller', 'ms-settings', 'ms-windows-store', 'microsoft-edge',
]);

/** O que fazer com um PEDIDO de permissão. */
export function policyFor(permission: string): 'allow' | 'ask' | 'deny' {
  if (ALWAYS_ALLOW.has(permission)) return 'allow';
  if (permission === 'media' || permission in ASK_KIND) return 'ask';
  return 'deny';
}

/**
 * Quais "coisas" um pedido envolve — câmera e microfone separados, como no Chrome.
 * Pedido 'media' SEM 'audio'/'video' é captura da TELA (truque antigo chromeMediaSource:
 * 'desktop') — vira lista vazia = negado. Antes contava como "câmera e microfone" e um site
 * com câmera liberada gravava a tela inteira e o som do computador sem perguntar.
 */
export function kindsFor(permission: string, mediaTypes?: string[]): PermKind[] {
  if (permission === 'media') {
    const kinds: PermKind[] = [];
    if (mediaTypes?.includes('audio')) kinds.push('microphone');
    if (mediaTypes?.includes('video')) kinds.push('camera');
    return kinds;
  }
  const k = ASK_KIND[permission];
  return k ? [k] : [];
}

/** Resposta guardada que vale pro pedido inteiro: um "bloquear" em qualquer parte bloqueia. */
export function storedDecision(store: PermStore, origin: string, kinds: PermKind[]): Decision | undefined {
  const site = store[origin];
  if (!site || kinds.length === 0) return undefined;
  if (kinds.some(k => site[k] === 'block')) return 'block';
  if (kinds.every(k => site[k] === 'allow')) return 'allow';
  return undefined;
}

/** Tipo do link de "abrir aplicativo" ("zoommtg", "mailto"…), minúsculo; vazio se inválido. */
export function schemeOf(url: string | undefined): string {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(String(url || '').trim());
  return m ? m[1].toLowerCase() : '';
}

export interface RequestInfo { mediaTypes?: string[]; requestingUrl?: string; isMainFrame?: boolean; externalURL?: string }
export type Resolution =
  | { action: 'allow' | 'deny' }
  | { action: 'ask'; origin: string; kinds: PermKind[]; external?: string };

/**
 * Decide um PEDIDO. Igual ao Chrome, quem responde é o SITE DA ABA (o de cima): iframe só pede
 * se o site de cima delegou (allow="camera" etc.), e a pergunta mostra o site de cima — assim
 * uma página em branco dentro de um iframe não aparece com o nome de outro site.
 */
export function resolveRequest(store: PermStore, permission: string, d: RequestInfo, topUrl: string): Resolution {
  const policy = policyFor(permission);
  if (policy !== 'ask') return { action: policy };
  const origin = originOf(topUrl);
  if (!origin) return { action: 'deny' };
  // Notificação só do próprio site (o Chrome nega pra iframe de outro site).
  if (permission === 'notifications' && d.isMainFrame === false && originOf(d.requestingUrl) !== origin) return { action: 'deny' };
  if (permission === 'openExternal') {
    const scheme = schemeOf(d.externalURL);
    if (!scheme || DANGEROUS_SCHEMES.has(scheme)) return { action: 'deny' };
    return { action: 'ask', origin, kinds: ['openExternal'], external: scheme };   // pergunta toda vez
  }
  const kinds = kindsFor(permission, d.mediaTypes);
  if (kinds.length === 0) return { action: 'deny' };
  const site = store[origin] || {};
  if (kinds.some(k => site[k] === 'block')) return { action: 'deny' };
  // Só pergunta o que ainda não foi respondido (microfone já liberado + câmera nova = pergunta só a câmera).
  const undecided = kinds.filter(k => site[k] !== 'allow');
  if (undecided.length === 0) return { action: 'allow' };
  return { action: 'ask', origin, kinds: undecided };
}

/**
 * CHECAGEM (navigator.permissions.query, Notification.permission) — só sim/não, sem o "vai
 * perguntar" do Chrome. Sem resposta guardada:
 *  - câmera/microfone dizem SIM: senão Meet & cia. acham que foi bloqueado e nem pedem (o
 *    pedido de verdade passa pela pergunta);
 *  - o resto diz NÃO: a página do Google, vendo "localização liberada", pedia a localização
 *    toda vez que abria; e notificação "liberada" seria mostrada sem nunca pedir. (O script
 *    das páginas troca esse "negado" por "vai perguntar" — ver STEALTH_SCRIPT no main.ts.)
 * Nomes que o pedido trata sozinho (liberados/negados) dizem SIM, como antes.
 */
export function checkAnswer(store: PermStore, origin: string, permission: string, mediaType?: string): boolean {
  const policy = policyFor(permission);
  if (policy !== 'ask') return true;
  const kinds = kindsFor(permission, mediaType ? [mediaType] : undefined);
  const saved = storedDecision(store, origin, kinds);
  if (saved) return saved === 'allow';
  return permission === 'media';
}

/**
 * O que uma aba ANÔNIMA enxerga das respostas guardadas: só os "Bloquear" do perfil normal (igual
 * ao Chrome, que leva os bloqueios pra janela anônima mas não as liberações). Um "Permitir" dado
 * numa aba normal não vale lá — a aba anônima pergunta de novo, e o que ela responde não é guardado.
 */
export function incognitoStore(store: PermStore): PermStore {
  const out: PermStore = {};
  for (const [origin, perms] of Object.entries(store)) {
    const site: Partial<Record<PermKind, Decision>> = {};
    for (const [k, v] of Object.entries(perms || {})) if (v === 'block') site[k as PermKind] = 'block';
    if (Object.keys(site).length) out[origin] = site;
  }
  return out;
}

/** Origem "https://site.com" de um link; vazio se não for site normal (http/https). */
export function originOf(url: string | undefined): string {
  try {
    const u = new URL(String(url || ''));
    return /^https?:$/.test(u.protocol) ? u.origin : '';
  } catch { return ''; }
}

/** Arquivo de permissões lido do disco → só o que tem o formato certo (arquivo estragado não derruba nada). */
export function sanitizeStore(raw: unknown): PermStore {
  const out: PermStore = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [origin, perms] of Object.entries(raw as Record<string, unknown>)) {
    if (originOf(origin) !== origin || !perms || typeof perms !== 'object' || Array.isArray(perms)) continue;
    const site: Partial<Record<PermKind, Decision>> = {};
    for (const [k, v] of Object.entries(perms as Record<string, unknown>)) {
      if (PERM_KINDS.includes(k as PermKind) && (v === 'allow' || v === 'block')) site[k as PermKind] = v;
    }
    if (Object.keys(site).length) out[origin] = site;
  }
  return out;
}
