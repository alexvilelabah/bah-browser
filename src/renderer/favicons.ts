// Ícones dos sites na interface (barra de favoritos, "»", ⋮ → Favoritos, autocomplete).
// Um lugar só: cada site é pedido ao main UMA vez por sessão, em lote (vários <SiteIcon> que
// aparecem juntos viram um pedido só). O main responde o que já tem e manda o resto depois.
// "Espiar" (peek, usado no autocomplete): só o que já está no cache — site do histórico não é
// buscado nem guardado por aparecer numa sugestão.
import { useSyncExternalStore } from 'react';
import { faviconOrigin } from '../shared/favicons';

// origem → data URL | null (site sem ícone) | ausente (ainda não sabe)
const icons = new Map<string, string | null>();
const requested = new Set<string>();
const peeked = new Set<string>();
let pending: string[] = [];
let pendingPeek: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
let subscribed = false;

function notify(): void { for (const l of listeners) l(); }

// Ícones que o <img> não conseguiu desenhar: se o main mandar o MESMO de novo, fica a letra
// (senão a barra ficava piscando ícone ↔ letra a cada aviso do main).
const broken = new Set<string>();

function merge(batch: Record<string, string | null> | null | undefined): void {
  if (!batch || typeof batch !== 'object') return;
  let changed = false;
  for (const [o, icon] of Object.entries(batch)) {
    let v = typeof icon === 'string' && icon.startsWith('data:image/') ? icon : null;
    if (v && broken.has(v)) v = null;
    // Nunca troca um ícone que já está aparecendo por "sem ícone": a resposta do pedido pode
    // chegar DEPOIS do aviso com o ícone novo (ou a busca de agora falhou) — e piscava.
    if (v === null && typeof icons.get(o) === 'string') continue;
    if (icons.get(o) !== v) { icons.set(o, v); changed = true; }
  }
  if (changed) notify();
}

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  window.electronAPI?.onFaviconsUpdated?.(merge);
}

function flush(): void {
  flushTimer = null;
  const batch = pending.splice(0, 400);
  const peekBatch = pendingPeek.splice(0, 400);
  if (pending.length || pendingPeek.length) flushTimer = setTimeout(flush, 0);
  const api = window.electronAPI;
  if (!api?.faviconsGet) { merge(Object.fromEntries([...batch, ...peekBatch].map(o => [o, null]))); return; }
  if (batch.length) api.faviconsGet(batch).then(merge).catch(() => {});
  if (peekBatch.length) {
    api.faviconsGet(peekBatch, true).then(r => {
      // O que o cache não tem vira a letra (sem esperar busca nenhuma) — se ninguém pediu de verdade.
      const out: Record<string, string | null> = {};
      for (const o of peekBatch) if (r?.[o]) out[o] = r[o]; else if (!icons.has(o)) out[o] = null;
      merge(out);
    }).catch(() => {});
  }
}

function request(origin: string, peek: boolean): void {
  if (requested.has(origin) || (peek && peeked.has(origin))) return;
  if (peek) { peeked.add(origin); pendingPeek.push(origin); }
  else { requested.add(origin); pending.push(origin); }
  ensureSubscribed();
  if (!flushTimer) flushTimer = setTimeout(flush, 30);
}

/** Pede (em segundo plano) os ícones de vários sites de uma vez — os favoritos que estão atrás do
 *  "»" e no ⋮ → Favoritos: assim, quando a lista abre, os ícones já chegaram (antes só eram
 *  pedidos ao abrir, e iam aparecendo um por um). */
export function prefetchSiteIcons(urls: string[], max = 300): void {
  for (const u of urls.slice(0, max)) {
    const o = faviconOrigin(u);
    if (o) request(o, false);
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Ícone do site da URL: data URL, null (não tem → usar a letra) ou undefined (ainda buscando). */
export function useSiteIcon(url: string, peek = false): string | null | undefined {
  const origin = faviconOrigin(url);
  if (origin) request(origin, peek);
  return useSyncExternalStore(subscribe, () => (origin ? icons.get(origin) : null));
}

/** O <img> não conseguiu desenhar o ícone (arquivo estranho): passa a usar a letra. */
export function markIconBroken(url: string): void {
  const origin = faviconOrigin(url);
  const cur = origin ? icons.get(origin) : null;
  if (origin && cur) { broken.add(cur); icons.set(origin, null); notify(); }
}
