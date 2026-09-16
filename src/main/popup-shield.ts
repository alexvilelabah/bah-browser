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

// ─────────────────────────────────────────────────────────────────────────────
// EXCEÇÃO DE LOGIN — o "popup de anúncio (features)" abaixo também é o formato do
// "Entrar com Google/Apple/Microsoft": window.open(url,'nome','width=..,height=..').
// Medido no Khan Academy: o GSI pede a janela, o escudo devolve deny, window.open()
// retorna null, o Google loga "Failed to open popup window" e o site desativa o botão.
// No Chrome funciona; aqui não funcionava por causa dessa classificação.
//
// A exceção é ESTREITA de propósito: cinco travas, TODAS obrigatórias. Falhando
// qualquer uma, cai no comportamento de sempre (decidePopup → aba ou descarte).
// Nada aqui abre janela sozinho — só responde "pode".
// ─────────────────────────────────────────────────────────────────────────────

/** Provedores de identidade conhecidos. Casados por SUFIXO, nunca por "contém". */
const IDPS = [
  'accounts.google.com', 'login.microsoftonline.com', 'login.live.com', 'appleid.apple.com',
  'facebook.com', 'github.com', 'gitlab.com', 'auth0.com', 'okta.com', 'oktapreview.com',
  'onelogin.com', 'pingidentity.com', 'id.twitch.tv', 'discord.com', 'slack.com',
  'linkedin.com', 'x.com', 'twitter.com', 'accounts.spotify.com', 'login.yahoo.com',
  'clever.com', 'classlink.com', 'login.gov.br', 'dropbox.com', 'paypal.com',
];

/** host === dominio OU subdomínio dele. `includes()` aqui seria um buraco:
 *  'accounts.google.com.site-falso.tld' passaria. Não trocar por substring. */
function hostEhDe(host: string, dominio: string): boolean {
  return host === dominio || host.endsWith('.' + dominio);
}

export interface AuthPopupInput {
  url: string;
  features: string;
  disposition: string;
  openerUrl: string;
  msSinceGesture: number;   // desde o último clique/tecla REAL naquela aba
  liveAuthPopups: number;   // janelas de login já abertas por esta aba
  msSinceLastAuthPopup: number;
}

export interface AuthPopupDecision { allow: boolean; reason: string }

export function decideAuthPopup(i: AuthPopupInput): AuthPopupDecision {
  // 1. FORMA — só o caso que o escudo chama de "anúncio (features)" concorre a janela.
  //    Link com target=_blank continua virando aba, exatamente como hoje.
  const userTab = i.disposition === 'foreground-tab' || i.disposition === 'background-tab';
  if (!(i.features && i.features.trim()) || userTab) return { allow: false, reason: 'não é formato de popup de login' };

  // 2. ESQUEMA — os dois lados em https. about:blank fica de fora: aprovar a casca
  //    vazia é aprovar um destino que ainda não existe.
  let alvo: URL, quemPediu: URL;
  try { alvo = new URL(i.url); quemPediu = new URL(i.openerUrl); } catch { return { allow: false, reason: 'URL inválida' }; }
  if (alvo.protocol !== 'https:' || quemPediu.protocol !== 'https:') return { allow: false, reason: 'não é https dos dois lados' };

  // 3. GESTO — tem que ter havido clique ou tecla de gente há pouco. É o que impede
  //    uma janela de login brotar sozinha nas abas OCULTAS (Pesquisa Rápida, manchetes,
  //    imagens), que também rodam com allowpopups e ninguém está olhando.
  if (!(i.msSinceGesture >= 0 && i.msSinceGesture <= 5000)) return { allow: false, reason: 'sem gesto do usuário' };

  // 4. IDENTIDADE — basta UM: provedor conhecido, ou cara de OAuth (cobre Keycloak,
  //    ADFS e afins que ninguém consegue listar).
  const host = alvo.hostname.toLowerCase();
  const q = alvo.searchParams;
  const ehIdpConhecido = IDPS.some(d => hostEhDe(host, d));

  // ANTI-IMITAÇÃO — 'accounts.google.com.site-falso.tld' não é o Google (o endsWith acima
  // já garante isso), mas passaria pela porta dos parâmetros OAuth, que qualquer um pode
  // pôr na URL. Numa janela sem barra de endereço isso é phishing pronto. Host que CARREGA
  // o nome de um provedor sem ser ele está imitando: não ganha janela por caminho nenhum.
  if (!ehIdpConhecido && IDPS.some(d => host.includes(d))) {
    return { allow: false, reason: 'domínio imitando provedor de login' };
  }

  const temCaraDeOAuth = q.has('client_id')
    && (q.has('response_type') || q.has('scope'))
    && (q.has('redirect_uri') || q.has('redirect_url') || q.has('origin'));
  if (!ehIdpConhecido && !temCaraDeOAuth) return { allow: false, reason: 'não parece login' };

  // 5. UMA DE CADA VEZ — login é um clique, não uma rajada. Sem isto, a exceção
  //    vira a porta dos fundos que o escudo existe pra fechar.
  if (i.liveAuthPopups > 0) return { allow: false, reason: 'já existe janela de login aberta' };
  if (i.msSinceLastAuthPopup >= 0 && i.msSinceLastAuthPopup < 2000) return { allow: false, reason: 'rajada de janelas de login' };

  return { allow: true, reason: ehIdpConhecido ? `login (${host})` : 'login (parâmetros OAuth)' };
}

export function decidePopup(disposition: string, features: string, recentCount: number): PopupDecision {
  const userTab = disposition === 'foreground-tab' || disposition === 'background-tab';
  const hasFeatures = !!(features && features.trim());
  // window.open('url','name','width=..,toolbar=no,..') = popup de anúncio
  if (hasFeatures && !userTab) return { open: false, reason: 'popup de anúncio (features)' };
  // anti-bombardeio: no máx 3 novas abas / janela de tempo
  if (recentCount >= 3) return { open: false, reason: 'rajada de popups' };
  return { open: true, reason: 'nova aba' };
}
