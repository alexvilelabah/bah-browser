// ─── SAFETY BRAKE ─────────────────────────────────────────────────────────────
// Classifies whether an agent action is "risky" (payment/deletion/card) to ask for
// confirmation BEFORE running it. Deliberately conservative: only STRONG terms (won't
// nag on "remove filter", "clear search" etc.). Looks at the LABEL of the button/field
// the agent is about to touch. Pure function → testable.
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

  // filling a card field → confirm the DATA (not every fill)
  const CARD = /\b(numero do cartao|card number|cartao de credito|cartao de debito|cvv|cvc|codigo de seguranca|security code|validade do cartao)\b/;
  if (actionType === 'fill_ref' || actionType === 'fill') {
    return CARD.test(hay) ? { kind: 'card data', label: shown || 'card field' } : null;
  }

  // cliques (click_ref / click_text)
  const PAY = /\b(pagar|pague|pagar agora|pagamento|finalizar (compra|pedido|a compra)|confirmar (pedido|compra|pagamento)|comprar agora|fazer pedido|place order|buy now|complete (purchase|order|payment)|checkout|finalizar e pagar|assinar agora|assinar plano|transferir|enviar pix)\b/;
  const DEL = /\b(excluir|apagar|deletar|delete|remover|remove|descartar|discard|esvaziar (a )?lixeira|empty trash|excluir conta|delete account|remover conta|remove account|apagar tudo|delete all|excluir permanentemente|delete permanently|excluir email|excluir mensagem|excluir tudo)\b/;
  // "clear search", "remove filter", "empty cart" = harmless → no confirmation.
  const BENIGN_CLEAR = /\b(busca|pesquisa|search|filtro|filtros|filter|filters|campo|field|texto|text|rascunho|draft|carrinho|cart|formulario|form)\b/;
  if (PAY.test(hay)) return { kind: 'payment', label: shown || 'payment' };
  if (DEL.test(hay) && !BENIGN_CLEAR.test(hay)) return { kind: 'deletion', label: shown || 'deletion' };
  return null;
}

// UNIFIED brake: classifies the risk of ANY action, regardless of the path
// (click by ref/text/coordinate, fill, Enter, macro, shortcut). This way
// payment/deletion/card ask for confirmation on every path, not only the
// clicks the model proposes. The rule must be the same for all.
export function riskForAction(
  action: { type: string; ref?: number; text?: string; value?: string; label?: string; selector?: string; key?: string },
  el?: { text?: string; placeholder?: string; aria?: string },
  currentUrl?: string,
): RiskInfo | null {
  switch (action.type) {
    case 'click_ref':
    case 'fill_ref':
      return classifyRisk(action.type, el?.text, el?.placeholder, el?.aria);
    case 'click_text':
    case 'click_at':
      // click_at: the caller resolves the label of the element under the coordinate and passes it in el.text.
      return classifyRisk('click_text', el?.text ?? action.text);
    case 'fill':
      return classifyRisk('fill', el?.text ?? action.label ?? action.selector ?? action.text);
    case 'press': {
      // Enter can submit a payment. With no label, only brake on a checkout page.
      const k = (action.key || '').toLowerCase();
      const checkout = !!currentUrl && /checkout|payment|pagamento|\/cart\b|carrinho|comprar|order\/?confirm|pedido\/?confirm|finalizar/i.test(currentUrl);
      return (k === 'enter' || k === 'return') && checkout ? { kind: 'payment', label: 'Enter on the payment page' } : null;
    }
    default:
      return null;
  }
}
