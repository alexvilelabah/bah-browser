import { test, expect } from '@playwright/test';
import { decidePopup, decideAuthPopup } from '../../src/main/popup-shield';

// Política de popup — testa a decisão PURA (popup-shield.ts não importa Electron, roda
// direto no runner). Existe porque inverter essa política é mexer em segurança: antes
// deste arquivo, liberar janela pra qualquer site passava verde na suíte inteira.
//
// O caso que originou tudo (issue #8, medido ao vivo no Khan Academy): o "Entrar com
// Google" chama window.open(url, nome, 'width=..,height=..'), que tem EXATAMENTE o
// formato que o escudo classificava como anúncio. Resultado: deny → window.open()
// devolvia null → "[GSI_LOGGER]: Failed to open popup window" → o site desativava o botão.

const GSI = 'https://accounts.google.com/o/oauth2/v2/auth'
  + '?gsiwebsdk=gis_attributes&client_id=124072386181-eogtmmv0qose5ovudl946d83miv1ia89.apps.googleusercontent.com'
  + '&scope=openid%20email%20profile&redirect_uri=gis_transform&response_type=code';

const base = {
  url: GSI,
  features: 'width=500,height=600,toolbar=no',
  disposition: 'new-window',
  openerUrl: 'https://www.khanacademy.org/login',
  msSinceGesture: 200,
  liveAuthPopups: 0,
  msSinceLastAuthPopup: -1e9,
};

test.describe('janela de login: o que PODE abrir', () => {
  test('o GSI real do Khan Academy — o caso que a issue #8 reportou', () => {
    expect(decideAuthPopup({ ...base }).allow).toBe(true);
  });

  test('outros provedores conhecidos', () => {
    const microsoft = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&response_type=code&redirect_uri=y';
    expect(decideAuthPopup({ ...base, url: microsoft }).allow).toBe(true);
  });

  test('provedor próprio (Keycloak/ADFS) pelos parâmetros OAuth — não dá pra listar todo mundo', () => {
    const keycloak = 'https://sso.escola.br/realms/x/protocol/openid-connect/auth?client_id=a&response_type=code&redirect_uri=b';
    expect(decideAuthPopup({ ...base, url: keycloak }).allow).toBe(true);
  });
});

test.describe('janela de login: o que NÃO pode abrir', () => {
  // O ataque que a primeira versão desta regra deixava passar: o host não casa com
  // nenhum provedor por sufixo, mas basta pôr client_id/redirect_uri na URL pra parecer
  // OAuth. Numa janela sem barra de endereço, isso é phishing pronto.
  test('domínio imitando provedor: accounts.google.com.evil.tld', () => {
    const falso = 'https://accounts.google.com.evil.tld/o/oauth2/v2/auth?client_id=a&scope=b&redirect_uri=c';
    const d = decideAuthPopup({ ...base, url: falso });
    expect(d.allow).toBe(false);
    expect(d.reason).toContain('imitando');
  });

  // Esta é a trava que protege as abas OCULTAS (Pesquisa Rápida, manchetes, imagens):
  // elas montam <webview> com allowpopups e rodam invisíveis. Sem gesto, nada abre.
  test('sem gesto do usuário — script agindo sozinho', () => {
    expect(decideAuthPopup({ ...base, msSinceGesture: 60_000 }).allow).toBe(false);
    expect(decideAuthPopup({ ...base, msSinceGesture: 1e9 }).allow).toBe(false);
  });

  test('http de qualquer um dos lados', () => {
    expect(decideAuthPopup({ ...base, url: GSI.replace('https:', 'http:') }).allow).toBe(false);
    expect(decideAuthPopup({ ...base, openerUrl: 'http://site.com' }).allow).toBe(false);
  });

  test('about:blank — aprovar a casca é aprovar um destino que ainda não existe', () => {
    expect(decideAuthPopup({ ...base, url: 'about:blank' }).allow).toBe(false);
  });

  test('popup de anúncio comum', () => {
    expect(decideAuthPopup({ ...base, url: 'https://anuncio.com/promo?utm=1' }).allow).toBe(false);
  });

  test('link target=_blank continua virando aba, não janela', () => {
    expect(decideAuthPopup({ ...base, disposition: 'foreground-tab' }).allow).toBe(false);
    expect(decideAuthPopup({ ...base, disposition: 'background-tab' }).allow).toBe(false);
  });

  test('sem features não é formato de popup de login', () => {
    expect(decideAuthPopup({ ...base, features: '' }).allow).toBe(false);
  });

  test('uma janela de login por vez — a exceção não vira porta dos fundos', () => {
    expect(decideAuthPopup({ ...base, liveAuthPopups: 1 }).allow).toBe(false);
    expect(decideAuthPopup({ ...base, msSinceLastAuthPopup: 500 }).allow).toBe(false);
  });
});

test.describe('o escudo antigo não mudou', () => {
  test('clique do usuário ainda vira aba', () => {
    expect(decidePopup('foreground-tab', '', 0).open).toBe(true);
  });

  test('popup de anúncio ainda é descartado', () => {
    expect(decidePopup('new-window', 'width=1,height=1', 0).open).toBe(false);
  });

  test('rajada ainda é cortada', () => {
    expect(decidePopup('foreground-tab', '', 3).open).toBe(false);
  });
});
