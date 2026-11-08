// Sistema operacional DE VERDADE, numa fonte só: o preload repassa process.platform / process.arch.
// Não adivinhar pelo navigator: o userAgent é o disfarce de Chrome que o próprio Bah monta
// (main.ts, CHROME_UA) e navigator.platform está congelado ("MacIntel" até no Apple silicon).
// Fora do Electron (testes no Node) vale o process do próprio Node.
const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
const node = typeof process !== 'undefined' ? process : undefined;

export const PLATFORM: string = api?.platform || node?.platform || 'other';
export const ARCH: string = api?.arch || node?.arch || 'other';
export const IS_MAC = PLATFORM === 'darwin';
export const IS_WINDOWS = PLATFORM === 'win32';
export const IS_LINUX = PLATFORM === 'linux';

/** Atalho escrito como o sistema escreve: shortcut('⌘D', 'Ctrl+D'). */
export function shortcut(mac: string, other: string): string {
  return IS_MAC ? mac : other;
}
