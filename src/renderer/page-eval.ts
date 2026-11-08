// Rodar script na página mesmo quando ela PROÍBE scripts. Arquivo servido com CSP
// "default-src 'none'; sandbox" (Hugging Face, GitHub raw, muitos .txt/.md/.json) desliga o JavaScript
// da página — e com ele o executeJavaScript do <webview>, que roda no mundo da página. Todo leitor do
// Bah (texto da página, extract_text, estado da tela, vagas, formulários) falhava e o agente ficava
// cego. O DOM continua lá: um MUNDO ISOLADO (o mesmo mecanismo dos content scripts de extensão) lê e
// mexe nele normalmente. Então: tenta no mundo da página; se falhar, um script trivial ('0') diz se
// foi o script (erro de verdade → repassa, nunca roda duas vezes) ou a página que bloqueia (→ roda no
// mundo isolado e lembra disso até a aba mudar de endereço).

/** Mundo isolado do Bah nas abas (999 é o do preload do Electron; este é só nosso). */
export const BAH_ISOLATED_WORLD = 1047;

type Eval = (code: string, userGesture?: boolean) => Promise<any>;

/**
 * O executeJavaScript com recuo pro mundo isolado. `main` = o original (mundo da página);
 * `isolated` = roda no mundo isolado; `url` = endereço atual da aba (a decisão vale por endereço).
 */
export function withIsolatedFallback(main: Eval, isolated: Eval, url: () => string): Eval {
  let blockedAt: string | null = null;
  return async (code: string, userGesture?: boolean) => {
    const here = url();
    if (blockedAt !== null && blockedAt === here) return isolated(code, userGesture);
    try {
      return await main(code, userGesture);
    } catch (err) {
      let pageBlocksScripts = false;
      try { await main('0'); } catch { pageBlocksScripts = true; }
      if (!pageBlocksScripts) throw err;
      blockedAt = here;
      return isolated(code, userGesture);
    }
  };
}

/** Instala o recuo no <webview> (uma vez): todo chamador de wv.executeJavaScript ganha junto. */
export function installIsolatedFallback(wv: any): void {
  if (!wv || wv.__bahIsolatedFallback) return;
  wv.__bahIsolatedFallback = true;
  const main: Eval = wv.executeJavaScript.bind(wv);
  const isolated: Eval = (code, userGesture) => {
    const id = wv.getWebContentsId?.();
    const api = (window as any).electronAPI;
    if (typeof id !== 'number' || !api?.evalIsolated) return Promise.reject(new Error('isolated world unavailable'));
    return api.evalIsolated(id, code, !!userGesture);
  };
  const url = () => { try { return String(wv.getURL() || ''); } catch { return ''; } };
  wv.executeJavaScript = withIsolatedFallback(main, isolated, url);
}
