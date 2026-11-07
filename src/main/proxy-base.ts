// Ponte entre o proxy do Bah (proxy.ts: ⋮ → Rede e proxy) e o chrome.proxy das extensões
// (chrome-extension-apis.ts: VPN de extensão). Igual ao Chrome: extensão que controla o proxy vence;
// quando ela solta, volta o que a PESSOA configurou no Bah (não o "do sistema" fixo).
import type { Session } from 'electron';

export type RtcPolicy = 'default' | 'disable_non_proxied_udp';
let baseProxy: Electron.ProxyConfig = { mode: 'system' };
let baseRtc: RtcPolicy = 'default';
const listeners = new Set<() => void>();
let extensionProxySession: (s: Session) => boolean = () => false;
let extensionRtcSession: (s: Session) => boolean = () => false;

/** Proxy que vale quando nenhuma extensão controla (config do Bah). */
export const getBaseProxy = (): Electron.ProxyConfig => baseProxy;
/** Política de WebRTC do Bah (com proxy em uso: só UDP pelo proxy). */
export const getBaseWebRtc = (): RtcPolicy => baseRtc;
export function setBaseNetwork(p: Electron.ProxyConfig, rtc: RtcPolicy): void {
  baseProxy = p; baseRtc = rtc;
  listeners.forEach(f => { try { f(); } catch {} });
}
export function onBaseNetworkChange(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }

/** As extensões informam: esta sessão está com o proxy / o WebRTC nas mãos de uma extensão agora? */
export function setExtensionControl(proxy: (s: Session) => boolean, rtc: (s: Session) => boolean): void {
  extensionProxySession = proxy; extensionRtcSession = rtc;
}
export const extensionControlsProxy = (s: Session): boolean => { try { return extensionProxySession(s); } catch { return false; } };
export const extensionControlsRtc = (s: Session): boolean => { try { return extensionRtcSession(s); } catch { return false; } };
