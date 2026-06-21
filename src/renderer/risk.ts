// ─── FREIO DE SEGURANÇA ───────────────────────────────────────────────────────
// Classifica se uma ação do agente é "de risco" (pagamento/exclusão/cartão) pra pedir
// confirmação ANTES de executar. Conservador de propósito: só termos FORTES (não pede
// confirmação à toa em "remover filtro", "apagar busca" etc.). Olha o RÓTULO do botão
// /campo que o agente vai tocar. Função pura → testável.
export interface RiskInfo { kind: string; label: string }

export function classifyRisk(
  actionType: string,
  label?: string,
  placeholder?: string,
  aria?: string,
): RiskInfo | null {
  const norm = (s?: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hay = `${norm(label)} ${norm(placeholder)} ${norm(aria)}`.trim();
  if (!hay) return null;
  const shown = (label || '').trim().slice(0, 60);

  // preencher campo de cartão → confirma os DADOS (não confirma todo preenchimento)
  const CARD = /\b(numero do cartao|card number|cartao de credito|cartao de debito|cvv|cvc|codigo de seguranca|security code|validade do cartao)\b/;
  if (actionType === 'fill_ref' || actionType === 'fill') {
    return CARD.test(hay) ? { kind: 'dados de cartão', label: shown || 'campo de cartão' } : null;
  }

  // cliques (click_ref / click_text)
  const PAY = /\b(pagar|pague|pagar agora|pagamento|finalizar (compra|pedido|a compra)|confirmar (pedido|compra|pagamento)|comprar agora|fazer pedido|place order|buy now|complete (purchase|order|payment)|checkout|finalizar e pagar|assinar agora|assinar plano|transferir|enviar pix)\b/;
  const DEL = /\b(excluir|apagar|deletar|delete|remover|remove|descartar|discard|esvaziar (a )?lixeira|empty trash|excluir conta|delete account|remover conta|remove account|apagar tudo|delete all|excluir permanentemente|delete permanently|excluir email|excluir mensagem|excluir tudo)\b/;
  // "apagar busca", "remover filtro", "esvaziar carrinho" = inofensivo → não confirma.
  const BENIGN_CLEAR = /\b(busca|pesquisa|search|filtro|filtros|filter|filters|campo|field|texto|text|rascunho|draft|carrinho|cart|formulario|form)\b/;
  if (PAY.test(hay)) return { kind: 'pagamento', label: shown || 'pagamento' };
  if (DEL.test(hay) && !BENIGN_CLEAR.test(hay)) return { kind: 'exclusão', label: shown || 'exclusão' };
  return null;
}
