// "Desativar som do site" (menu do botão direito na aba), igual ao Chrome: o site fica mudo em
// TODAS as abas dele e continua mudo depois de reabrir o Bah, até "Ativar som do site". A aba
// mostra o alto-falante riscado quando o site mudo tenta tocar.
// Site = o host sem "www." (shared/tab-strip.ts → siteKey). O som é cortado no webContents da aba
// (setAudioMuted da <webview>, o mesmo que segura as abas do supercut).
// Aba anônima: segue a lista salva, mas o que se muda NELA fica só na memória e só vale pras abas
// anônimas (nada do site visitado vai pro disco); some quando a última aba anônima fecha.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Tab } from './store';
import { sanitizeSites, siteKey } from '../shared/tab-strip';
import { incognitoCount } from '../shared/incognito';

const KEY = 'mutedSites.v1';

function loadMuted(): Set<string> {
  try { return new Set(sanitizeSites(JSON.parse(localStorage.getItem(KEY) || '[]'))); } catch { return new Set(); }
}

export function useSiteMute(tabs: Tab[], webviewRefs: MutableRefObject<Map<string, Electron.WebviewTag>>) {
  const [muted, setMutedSites] = useState<Set<string>>(loadMuted);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // Só das abas anônimas: site → mudo (true) / com som (false). Só na memória.
  const [incogMuted, setIncogMuted] = useState<Map<string, boolean>>(() => new Map());
  const incogRef = useRef(incogMuted);
  incogRef.current = incogMuted;

  // Estável (lê do ref): quem guardou a função num render antigo continua vendo a lista atual.
  const isMuted = useCallback((url: string, incognito?: boolean): boolean => {
    const k = siteKey(url);
    if (!k) return false;
    const own = incognito ? incogRef.current.get(k) : undefined;
    return own !== undefined ? own : mutedRef.current.has(k);
  }, []);

  const setMuted = useCallback((url: string, on: boolean, incognito?: boolean) => {
    const k = siteKey(url);
    if (!k) return;
    if (incognito) {
      setIncogMuted(prev => {
        if (prev.get(k) === on) return prev;
        const next = new Map(prev);
        next.set(k, on);
        return next;
      });
      return;
    }
    setMutedSites(prev => {
      if (prev.has(k) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(k); else next.delete(k);
      return next;
    });
  }, []);

  // A última aba anônima fechou: o que foi mudado nelas some junto (a próxima começa do zero).
  const hasIncognito = incognitoCount(tabs) > 0;
  useEffect(() => { if (!hasIncognito) setIncogMuted(prev => (prev.size ? new Map() : prev)); }, [hasIncognito]);

  const savedRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (savedRef.current === muted) return;
    savedRef.current = muted;
    try { localStorage.setItem(KEY, JSON.stringify([...muted])); } catch {}
  }, [muted]);

  // Aplica nas abas abertas (e de novo a cada navegação: a aba que entra num site mudo emudece,
  // a que sai dele volta a tocar). Guarda O QUE ESTE recurso fez em cada <webview> — aba que
  // acorda do Memory Saver é outro elemento e nasce com som — e só desfaz o próprio corte: o
  // supercut muta as abas dele por conta própria e solta quando a pessoa clica.
  const appliedRef = useRef(new WeakMap<object, boolean>());
  useEffect(() => {
    for (const tab of tabs) {
      if (tab.discarded) continue;
      const wv = webviewRefs.current.get(tab.id) as any;
      if (!wv) continue;
      const k = siteKey(tab.url);
      const own = k && tab.incognito ? incogMuted.get(k) : undefined;
      const want = own !== undefined ? own : !!k && muted.has(k);
      if ((appliedRef.current.get(wv) === true) === want) continue;
      // Webview ainda não anexou (acabou de montar) → lança; o próximo render tenta de novo
      // (a aba sempre muda logo em seguida: começou a carregar, título, endereço…).
      try { wv.setAudioMuted(want); appliedRef.current.set(wv, want); } catch {}
    }
  }, [tabs, muted, incogMuted, webviewRefs]);

  return { isMuted, setMuted };
}
