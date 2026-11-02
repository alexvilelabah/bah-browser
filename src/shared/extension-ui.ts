// O que as extensões PÕEM na página (menu de senha do LastPass/Bitwarden/1Password, ícone dentro do
// campo, barra "salvar senha?") não é da página: o agente não vê nem clica nisso. Clicar no menu do
// gerenciador de senha preencheria credencial por conta da IA — e o usuário decidiu que quem usa o
// gerenciador é ele. Também visto ao vivo: os iframes chrome-extension:// do LastPass atrapalhavam a
// automação. Puro (o main usa na árvore de acessibilidade e nos iframes; testado com node --test).

/** Frame de extensão (iframe que ela injeta na página): o agente ignora ele e tudo dentro. */
export function isExtensionFrameUrl(url: unknown): boolean {
  return typeof url === 'string' && /^chrome-extension:\/\//i.test(url.trim());
}

/**
 * Raízes conhecidas de interface injetada (light DOM; o conteúdo fica num shadow root embaixo).
 * LastPass marca com data-lastpass-*, 1Password usa elementos com-1password-*. O Bitwarden sorteia o
 * nome do elemento, mas o menu dele é um iframe chrome-extension:// — esse cai no isExtensionFrameUrl.
 */
export const EXTENSION_UI_SELECTOR = [
  '[data-lastpass-root]', '[data-lastpass-icon-root]', '[data-lastpass-infield]',
  'com-1password-button', 'com-1password-menu', 'com-1password-notification', 'com-1password-op-button',
  '#bit-notification-bar', '#bit-notification-bar-iframe',
].join(',');

interface AxNode { nodeId: string; parentId?: string; backendDOMNodeId?: number; [k: string]: unknown }

/**
 * Tira da árvore de acessibilidade os nós que estão DENTRO de uma raiz de interface de extensão
 * (a própria raiz inclusive). `roots` = backendNodeIds das raízes (iframe de extensão, host marcado).
 */
export function dropExtensionUi<T extends AxNode>(nodes: T[], roots: ReadonlySet<number>): T[] {
  if (!roots.size || !Array.isArray(nodes)) return nodes;
  const byId = new Map<string, T>();
  for (const n of nodes) byId.set(n.nodeId, n);
  const verdict = new Map<string, boolean>();
  const inside = (n: T): boolean => {
    const chain: string[] = [];
    let cur: T | undefined = n;
    let hit = false;
    // Sobe pelos pais até achar uma raiz ou um nó já decidido (memo: árvore grande fica O(n)).
    for (let guard = 0; cur && guard < 512; guard++) {
      const known = verdict.get(cur.nodeId);
      if (known !== undefined) { hit = known; break; }
      chain.push(cur.nodeId);
      if (cur.backendDOMNodeId != null && roots.has(cur.backendDOMNodeId)) { hit = true; break; }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    for (const id of chain) verdict.set(id, hit);
    return hit;
  };
  return nodes.filter(n => !inside(n));
}
