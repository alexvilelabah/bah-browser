// De qual SITE é um cookie — pra importar só os cookies do site em que a pessoa logou.
//
// Antes o "site" era as duas últimas partes do endereço: em loja.mercadolivre.com.br isso
// dava "com.br", e o login de UM site .com.br trazia os cookies de TODOS os .com.br que o
// navegador de login conhecia. Agora usa a lista pública de sufixos (a mesma do Chrome,
// via tldts — já vem com o bloqueador de anúncios): o site é "mercadolivre.com.br".
import { getDomain } from 'tldts-experimental';

const clean = (host: string) => String(host || '').trim().replace(/^\./, '').replace(/\.$/, '').toLowerCase();

/** O site "registrável" de um endereço: www.loja.exemplo.com.br → exemplo.com.br. */
export function siteOf(host: string): string {
  // NÃO tira o "www." antes: em www.gov.br o site É "www.gov.br" (gov.br é sufixo público).
  const h = clean(host);
  return getDomain(h, { allowPrivateDomains: true }) || h;
}

/** Testa se o domínio de um cookie pertence ao mesmo site do endereço. */
export function makeDomainMatcher(host: string): (cookieDomain: string) => boolean {
  const full = clean(host);
  const base = siteOf(full);
  return (cookieDomain: string) => {
    const d = clean(cookieDomain);
    return !!d && (d === full || d === base || d.endsWith('.' + base));
  };
}
