// Limpeza de parâmetros de RASTREIO PESSOAL das URLs (estilo Brave/Firefox).
// Fonte da lista: serviço oficial de query-stripping do Firefox (Mozilla) — são os
// identificadores de clique que seguem a PESSOA entre sites (fbclid, gclid, …).
// utm_* fica de fora DE PROPÓSITO: é métrica de campanha (não identifica ninguém)
// e o Firefox também não remove por padrão.
// Módulo PURO (sem electron/node) — importado pelo main E pelo renderer.

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'msclkid', 'wbraid', 'gbraid', 'twclid',
  'yclid', 'ysclid', 'mc_eid', 'vero_id', 'wickedid', 'mkt_tok', '_openstat',
  '_hsenc', '__hssc', '__hstc', '__hsfp', 'hsctatracking',
  'oly_anon_id', 'oly_enc_id', '__s',
]);

export function stripTrackingParams(rawUrl: string): string {
  try {
    if (!/^https?:\/\//i.test(rawUrl)) return rawUrl;
    const u = new URL(rawUrl);
    if (!u.search || u.search.length <= 1) return rawUrl;
    // Exceção (padrão do Brave): mkt_tok é exigido por links de descadastro de e-mail —
    // remover quebraria o "unsubscribe"; nesse caso ele fica.
    const keepMktTok = /unsubscribe/i.test(rawUrl);
    let changed = false;
    for (const key of [...u.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (!TRACKING_PARAMS.has(k)) continue;
      if (k === 'mkt_tok' && keepMktTok) continue;
      u.searchParams.delete(key);
      changed = true;
    }
    return changed ? u.toString() : rawUrl;
  } catch {
    return rawUrl;
  }
}
