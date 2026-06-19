// ─────────────────────────────────────────────────────────────────────────────
// ESCUDO DE POPUP — decide se um window.open vira ABA (intenção do usuário) ou é
// descartado (spam de anúncio). Genérico e content-neutral (igual Brave/uBlock):
// vale pra TODO site, não roteia/abre nada por conta própria.
// Regras:
//  - clique do usuário (foreground/background-tab, sem "features") → abre aba.
//  - window.open COM "features" (dimensões/sem toolbar) = popup clássico de anúncio → descarta.
//  - rajada (muitos popups em poucos segundos) → descarta o excedente (anti-bombardeio).
// A decisão é pura (sem Electron) pra ser testável.
// ─────────────────────────────────────────────────────────────────────────────
export interface PopupDecision { open: boolean; reason: string }

export function decidePopup(disposition: string, features: string, recentCount: number): PopupDecision {
  const userTab = disposition === 'foreground-tab' || disposition === 'background-tab';
  const hasFeatures = !!(features && features.trim());
  // window.open('url','name','width=..,toolbar=no,..') = popup de anúncio
  if (hasFeatures && !userTab) return { open: false, reason: 'popup de anúncio (features)' };
  // anti-bombardeio: no máx 3 novas abas / janela de tempo
  if (recentCount >= 3) return { open: false, reason: 'rajada de popups' };
  return { open: true, reason: 'nova aba' };
}
