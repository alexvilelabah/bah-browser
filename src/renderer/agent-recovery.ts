/**
 * AgentRecoveryManager — detecção de bloqueios e decisões de fallback.
 *
 * Recebe o estado atual da página + resultado da última ação e retorna uma
 * decisão estruturada que o loop do agente consome sem precisar de lógica
 * espalhada por todo o App.tsx.
 *
 * Princípios:
 *  - Nunca repetir a mesma ação >2× sem progresso
 *  - Nunca tentar burlar captcha ou adivinhar senha
 *  - Preferir buscar outra fonte quando o site bloqueia
 *  - Sempre explicar ao usuário por que abandonou um caminho
 *  - Nunca finalizar ação sensível sem confirmação
 */

// ────────────────────────────────────────────────────────────────────────
// Tipos
// ────────────────────────────────────────────────────────────────────────

export type RecoveryDecision =
  | 'continue'           // nada detectado, prosseguir normalmente
  | 'retry'              // tentar a mesma ação de novo (max 1×)
  | 'close_popup'        // fechar overlay/modal/cookie/banner antes de continuar
  | 'go_back'            // voltar uma página no navegador
  | 'search_alternative' // abandonar site e buscar outra fonte
  | 'ask_user'           // pausar e pedir intervenção do usuário
  | 'abort';             // encerrar a tarefa com explicação

export interface RecoveryVerdict {
  decision: RecoveryDecision;
  /** Motivo legível (injetado no history para a IA ver) */
  reason: string;
  /** Ação sugerida para a IA no próximo passo (ex.: "click 'Rejeitar cookies'") */
  suggestedAction?: string;
  /** Quantas vezes pode re-tentar antes de escalar */
  maxRetries: number;
  /** Bloqueador detectado (para log) */
  blocker?: BlockerType;
}

export type BlockerType =
  | 'login_required'
  | 'captcha'
  | 'paywall'
  | 'popup_overlay'
  | 'page_timeout'
  | 'stale_ref'
  | 'no_effect'
  | 'loop_detected'
  | 'access_denied'
  | 'not_found'
  | 'dead_end'
  | 'sensitive_action'
  | 'redirect_suspicious'
  | 'download_blocked';

// ────────────────────────────────────────────────────────────────────────
// Estado que o loop passa para diagnose()
// ────────────────────────────────────────────────────────────────────────

export interface RecoveryInput {
  /** O que o usuário pediu */
  goal: string;
  /** URL atual */
  url: string;
  /** Título da página */
  title: string;
  /** Texto visível da página (amostra de ~1500 chars) */
  textSample: string;
  /** Elementos interativos detectados */
  elements: Array<{ id: number; tag: string; text?: string; role?: string; aria?: string }>;
  /** Resultado da última ação executada */
  lastResult: { success: boolean; error?: string; reason?: string; covering?: string } | null;
  /** Tipo da última ação executada */
  lastActionType: string | null;
  /** Texto do elemento que a última ação clicou (o BOTÃO), pra detectar ação sensível com precisão */
  lastActionTargetText?: string;
  /** Contagem de ações sem efeito consecutivas */
  noEffectCount: number;
  /** Passos gastos na mesma URL */
  stepsOnSameUrl: number;
  /** Passo atual (0-based) */
  step: number;
  /** Domínios já bloqueados nesta sessão */
  blockedDomains: Set<string>;
  /** Contagem de popups já fechados nesta tarefa */
  popupCloseAttempts: number;
  /** Se o comando exige especificamente este site */
  commandRequiresThisSite: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Padrões de detecção
// ────────────────────────────────────────────────────────────────────────

const LOGIN_PATTERNS = /\b(sign\s*in|log\s*in|entrar|fazer\s*login|fa[cç]a\s*login|criar?\s*conta|create\s*account|continue?\s*com?\s*google|continue?\s*with\s*(google|facebook|apple)|registr[ae]r|sign\s*up|cadastr[ae]r|iniciar?\s*sess[aã]o)\b/i;

const LOGIN_BLOCK_PATTERNS = /\b(fa[cç]a\s*login\s*para\s*continuar|log\s*in\s*to\s*continue|sign\s*in\s*required|login\s*required|please\s*sign\s*in|entre\s*para\s*ver|you\s*must\s*be\s*logged\s*in|crie?\s*uma?\s*conta\s*para)\b/i;

const CAPTCHA_PATTERNS = /\b(captcha|recaptcha|hcaptcha|n[aã]o\s*sou\s*um?\s*rob[oô]|i\s*am\s*not\s*a\s*robot|verifi(que|car|ca[cç][aã]o)\s*(que\s*voc[eê]\s*[eé]\s*humano|humana|human)|cloudflare|challenge|verify\s*you\s*are\s*human|checking\s*your\s*browser|just\s*a\s*moment|one\s*more\s*step|security\s*check|bot\s*detection|automated\s*access)\b/i;

const PAYWALL_PATTERNS = /\b(assine?\s*para\s*(continuar|ler|acessar)|subscriber\s*only|subscribers?\s*only|exclusive\s*content|conte[uú]do\s*exclusivo|paywall|unlock\s*this\s*(article|content)|read\s*more\s*with\s*(a\s*)?subscription|acesse?\s*o\s*conte[uú]do\s*completo|conte[uú]do\s*bloqueado|locked\s*content)\b/i;

const ACCESS_DENIED_PATTERNS = /\b(access\s*denied|acesso\s*negado|forbidden|unusual\s*traffic|automated\s*requests|tr[aá]fego\s*incomum|too\s*many\s*requests|rate\s*limit|blocked|bloqueado)\b/i;

const NOT_FOUND_PATTERNS = /\b(404|not\s*found|p[aá]gina\s*n[aã]o\s*encontrada|page\s*removed|removid[ao]|indispon[ií]vel|unavailable|sold\s*out|esgotado|n[aã]o\s*encontramos\s*resultados|no\s*results\s*found)\b/i;

const DEAD_END_PATTERNS = /\b(instale?\s*(o\s*)?app|install\s*(the\s*)?app|download\s*(our|the)\s*app|abrir?\s*no\s*aplicativo|open\s*in\s*app|get\s*the\s*app|baixe?\s*o\s*app|verifica[cç][aã]o\s*por\s*sms|phone\s*verification|two.factor|2fa|instale?\s*(a\s*)?(extens[aã]o|extension))\b/i;

const SENSITIVE_ACTION_PATTERNS = /\b(comprar|buy|purchase|pagar|pay|checkout|finalizar\s*compra|place\s*order|confirmar?\s*pedido|transferir|transfer|cancelar\s*assinatura|cancel\s*subscription|apagar|delete|excluir|remove|publicar|publish|post|enviar\s*e-?mail|send\s*email|aceitar\s*contrato|accept\s*terms|assinar\s*contrato)\b/i;

const COOKIE_CLOSE_PATTERNS = /\b(rejeitar|reject(\s*all)?|recusar|aceitar|accept(\s*all)?|concordo|agree|i\s*understand|entendi|fechar|close|dismiss|got\s*it|ok|continuar\s*sem|continue\s*without|manage\s*(cookies|preferences)|gerenciar)\b/i;

const REDIRECT_SUSPICIOUS_DOMAINS = /\b(bit\.ly|tinyurl|t\.co|goo\.gl|cutt\.ly|rebrand\.ly|shorturl|clicktracker|redirect|ad\.|ads\.|doubleclick|adclick)\b/i;

// ────────────────────────────────────────────────────────────────────────
// Funções auxiliares
// ────────────────────────────────────────────────────────────────────────

function getDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

function pageText(input: RecoveryInput): string {
  return `${input.title} ${input.textSample}`.toLowerCase();
}

function elementTexts(input: RecoveryInput): string {
  return input.elements.map(e => `${e.text || ''} ${e.aria || ''} ${e.role || ''}`).join(' ').toLowerCase();
}

function findCookieCloseButton(input: RecoveryInput): { ref: number; text: string } | null {
  // Prioridade: "Rejeitar" > "Rejeitar todos" > "Fechar" > "Aceitar"
  const priorities = [
    /^(rejeitar|reject|recusar|decline)/i,
    /^(rejeitar\s*tudo|reject\s*all|recusar\s*tudo|decline\s*all)/i,
    /^(fechar|close|dismiss|x)$/i,
    /^(continuar\s*sem|continue\s*without|manage)/i,
    /^(aceitar|accept|concordo|agree|ok|got\s*it|entendi)/i,
  ];
  for (const pattern of priorities) {
    const match = input.elements.find(e => {
      const label = (e.text || e.aria || '').trim();
      return pattern.test(label) && (e.tag === 'button' || e.role === 'button' || e.tag === 'a');
    });
    if (match) return { ref: match.id, text: (match.text || match.aria || '').trim() };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Diagnose principal
// ────────────────────────────────────────────────────────────────────────

export function diagnose(input: RecoveryInput): RecoveryVerdict {
  const text = pageText(input);
  const elText = elementTexts(input);
  const domain = getDomain(input.url);
  const lr = input.lastResult;

  // ── 0. Domínio já bloqueado nesta sessão ─────────────────────────
  if (domain && input.blockedDomains.has(domain)) {
    return {
      decision: 'search_alternative',
      reason: `Domínio ${domain} foi marcado como bloqueado nesta sessão. Buscando outra fonte.`,
      blocker: 'access_denied',
      maxRetries: 0,
    };
  }

  // ── 1. Captcha / verificação humana (prioridade máxima) ──────────
  if (CAPTCHA_PATTERNS.test(text) || CAPTCHA_PATTERNS.test(elText)) {
    if (input.commandRequiresThisSite) {
      return {
        decision: 'ask_user',
        reason: `Verificação humana/captcha detectada em ${domain}. Este site é necessário para a tarefa — resolva o captcha manualmente.`,
        blocker: 'captcha',
        maxRetries: 0,
      };
    }
    return {
      decision: 'search_alternative',
      reason: `Encontrei uma verificação humana em ${domain}. Vou procurar outra fonte.`,
      blocker: 'captcha',
      maxRetries: 0,
    };
  }

  // ── 2. Acesso negado / bloqueio anti-bot ─────────────────────────
  if (ACCESS_DENIED_PATTERNS.test(text) || (lr && !lr.success && /403|429/.test(lr.error || ''))) {
    return {
      decision: 'search_alternative',
      reason: `Acesso negado ou tráfego bloqueado em ${domain}. Vou procurar outra fonte.`,
      blocker: 'access_denied',
      maxRetries: 0,
    };
  }

  // Motores de busca e enciclopédias são conteúdo aberto: nunca tratá-los como
  // login-gate/paywall (texto de resultados com "premium"/"entrar" gera falso positivo).
  const isOpenKnowledgeHost = /(^|\.)google\.[a-z.]+$|(^|\.)bing\.com$|(^|\.)duckduckgo\.com$|(^|\.)wikipedia\.org$|(^|\.)wikimedia\.org$|(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(domain);

  // ── 3. Login obrigatório ─────────────────────────────────────────
  if (!isOpenKnowledgeHost && (LOGIN_BLOCK_PATTERNS.test(text) || LOGIN_BLOCK_PATTERNS.test(elText))) {
    if (input.commandRequiresThisSite) {
      return {
        decision: 'ask_user',
        reason: `Este site (${domain}) exige login para continuar. Faça login manualmente para prosseguir.`,
        blocker: 'login_required',
        maxRetries: 0,
      };
    }
    return {
      decision: 'search_alternative',
      reason: `Site ${domain} exige login para continuar. Vou procurar outra fonte pública.`,
      blocker: 'login_required',
      maxRetries: 0,
    };
  }

  // ── 4. Paywall ───────────────────────────────────────────────────
  const isPlayableYouTubePage = /(^|\.)youtube\.com$/i.test(domain) && /\/watch\?/.test(input.url);
  if (!isPlayableYouTubePage && !isOpenKnowledgeHost && PAYWALL_PATTERNS.test(text)) {
    if (input.commandRequiresThisSite) {
      return {
        decision: 'ask_user',
        reason: `Conteúdo bloqueado por paywall em ${domain}. Precisa de assinatura para acessar.`,
        blocker: 'paywall',
        maxRetries: 0,
      };
    }
    return {
      decision: 'search_alternative',
      reason: `Paywall detectado em ${domain}. Vou procurar outra fonte aberta.`,
      blocker: 'paywall',
      maxRetries: 0,
    };
  }

  // ── 5. Popup / overlay cobrindo conteúdo ─────────────────────────
  if (lr && lr.reason === 'element_covered') {
    if (input.popupCloseAttempts >= 3) {
      return {
        decision: 'search_alternative',
        reason: `Overlay/popup persistente em ${domain} após ${input.popupCloseAttempts} tentativas de fechar. Abandonando.`,
        blocker: 'popup_overlay',
        maxRetries: 0,
      };
    }
    const btn = findCookieCloseButton(input);
    if (btn) {
      return {
        decision: 'close_popup',
        reason: `Elemento coberto por overlay. Tentando fechar: "${btn.text}".`,
        suggestedAction: `click_ref(@${btn.ref}) to close the popup/cookie banner ("${btn.text}")`,
        blocker: 'popup_overlay',
        maxRetries: 2,
      };
    }
    return {
      decision: 'close_popup',
      reason: `Elemento coberto por overlay (${lr.covering || 'desconhecido'}). Procure e clique em "Fechar", "Rejeitar", "X", "Aceitar" ou "OK".`,
      suggestedAction: `Look for close/dismiss/reject/accept buttons on the overlay: click_text("Fechar") or click_text("Rejeitar") or click_text("Accept") or press("Escape")`,
      blocker: 'popup_overlay',
      maxRetries: 2,
    };
  }

  // ── 6. Stale ref (elemento sumiu) ────────────────────────────────
  if (lr && lr.reason === 'stale_ref') {
    return {
      decision: 'retry',
      reason: 'Elemento desapareceu da página (stale_ref). Re-observando e tentando de novo.',
      suggestedAction: 'Re-observe the page and pick a new ref for the same target.',
      blocker: 'stale_ref',
      maxRetries: 1,
    };
  }

  // ── 7. Página não encontrada / conteúdo removido ─────────────────
  if (NOT_FOUND_PATTERNS.test(text) && input.elements.length < 15) {
    return {
      decision: 'search_alternative',
      reason: `Página não encontrada ou conteúdo indisponível em ${domain}. Buscando alternativa.`,
      blocker: 'not_found',
      maxRetries: 0,
    };
  }

  // ── 8. Página travada / vazia ────────────────────────────────────
  if (input.elements.length < 3 && input.textSample.trim().length < 50 && input.step > 0) {
    return {
      decision: 'retry',
      reason: 'Página parece vazia ou travada (poucos elementos, pouco texto). Recarregando.',
      suggestedAction: 'navigate(current_url) to reload, or go_back if this is a dead end.',
      blocker: 'page_timeout',
      maxRetries: 1,
    };
  }

  // ── 9. Caminho sem saída (app, extensão, SMS) ────────────────────
  if (DEAD_END_PATTERNS.test(text) || DEAD_END_PATTERNS.test(elText)) {
    return {
      decision: 'go_back',
      reason: `Caminho sem saída: a página pede app/extensão/SMS/2FA. Voltando.`,
      blocker: 'dead_end',
      maxRetries: 0,
    };
  }

  // ── 10. Redirecionamento suspeito ────────────────────────────────
  if (REDIRECT_SUSPICIOUS_DOMAINS.test(input.url)) {
    return {
      decision: 'go_back',
      reason: `URL suspeita detectada (${domain}). Voltando para fonte anterior.`,
      blocker: 'redirect_suspicious',
      maxRetries: 0,
    };
  }

  // ── 11. Ação sensível detectada (compra, envio, exclusão) ────────
  // Decisão pelo TEXTO DO BOTÃO clicado, não pela página. Antes testávamos o texto
  // da página inteira → numa página de produto (que sempre tem "Comprar"/"carrinho")
  // qualquer clique inócuo ("Mais informações", "Especificações") disparava o alerta.
  // Agora só dispara se o elemento clicado for de fato um botão de compra/pagar/excluir.
  if (input.lastActionType && /click/i.test(input.lastActionType)) {
    const targetText = (input.lastActionTargetText || '').trim();
    if (targetText && SENSITIVE_ACTION_PATTERNS.test(targetText)) {
      return {
        decision: 'ask_user',
        reason: 'Ação sensível detectada (compra/pagamento/exclusão). Pedindo confirmação ao usuário antes de prosseguir.',
        blocker: 'sensitive_action',
        maxRetries: 0,
      };
    }
  }

  // ── 12. Clique sem efeito (consecutivo) ──────────────────────────
  if (input.noEffectCount >= 3) {
    if (input.stepsOnSameUrl >= 5) {
      return {
        decision: 'search_alternative',
        reason: `${input.noEffectCount} ações sem efeito e ${input.stepsOnSameUrl} passos na mesma URL. Abandonando este site.`,
        blocker: 'no_effect',
        maxRetries: 0,
      };
    }
    return {
      decision: 'retry',
      reason: `${input.noEffectCount} ações consecutivas sem efeito. Mudando estratégia: tente scroll, Enter, outro botão ou volte.`,
      suggestedAction: 'Try a completely different approach: scroll, press Enter, click a different element, or navigate back.',
      blocker: 'no_effect',
      maxRetries: 1,
    };
  }

  // ── 13. Login gate (mais suave — sem "obrigatório") ──────────────
  // Detectar páginas de login que aparecem no meio da navegação,
  // mas onde o texto "obrigatório" não aparece. Se estamos >3 passos
  // nessa URL e há formulário de login visível → sinal de login gate.
  if (input.stepsOnSameUrl >= 3 && LOGIN_PATTERNS.test(elText)) {
    // Há um formulário de login proeminente e estamos parados aqui
    const hasPasswordField = input.elements.some(e =>
      e.tag === 'input' && /password|senha/i.test(e.aria || e.text || '')
    );
    if (hasPasswordField) {
      if (input.commandRequiresThisSite) {
        return {
          decision: 'ask_user',
          reason: `Formulário de login detectado em ${domain}. Faça login manualmente.`,
          blocker: 'login_required',
          maxRetries: 0,
        };
      }
      return {
        decision: 'search_alternative',
        reason: `Preso em tela de login de ${domain}. Vou procurar outra fonte.`,
        blocker: 'login_required',
        maxRetries: 0,
      };
    }
  }

  // ── Nada detectado — continuar normalmente ───────────────────────
  return {
    decision: 'continue',
    reason: '',
    maxRetries: 0,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Gerar instrução para a IA a partir de um veredicto de recovery
// ────────────────────────────────────────────────────────────────────────

export function recoveryInstruction(v: RecoveryVerdict): string {
  if (v.decision === 'continue') return '';
  const parts: string[] = [`\nRECOVERY [${v.decision.toUpperCase()}]: ${v.reason}`];
  if (v.suggestedAction) parts.push(`SUGGESTED: ${v.suggestedAction}`);
  switch (v.decision) {
    case 'close_popup':
      parts.push('INSTRUCTION: Close the popup/modal/cookie banner FIRST, then retry your original action.');
      break;
    case 'go_back':
      parts.push('INSTRUCTION: Go back to the previous page. Do NOT stay on this page.');
      break;
    case 'search_alternative':
      parts.push('INSTRUCTION: ABANDON this site immediately. Navigate to a different source (use Google, Wikipedia, or another trusted site). Do NOT try again on this domain.');
      break;
    case 'ask_user':
      parts.push('INSTRUCTION: Report this issue to the user. Use done(success=false, reason="...") to explain what happened and ask for manual intervention.');
      break;
    case 'abort':
      parts.push('INSTRUCTION: End the task now. Use done(success=false, reason="...") to explain why.');
      break;
    case 'retry':
      parts.push('INSTRUCTION: Re-observe the page and try a different approach for the same goal.');
      break;
  }
  return parts.join('\n');
}

// ────────────────────────────────────────────────────────────────────────
// Classe gerenciadora — mantém estado da sessão (domínios bloqueados etc.)
// ────────────────────────────────────────────────────────────────────────

export class AgentRecoveryManager {
  blockedDomains = new Set<string>();
  popupCloseAttempts = 0;
  private lastBlockerUrl = '';

  /** Registrar que um domínio está bloqueado nesta sessão */
  blockDomain(url: string) {
    const d = getDomain(url);
    if (d) {
      this.blockedDomains.add(d);
      console.log(`[Recovery] Blocked domain: ${d}`);
    }
  }

  /** Incrementar contador de tentativas de fechar popup */
  recordPopupClose() {
    this.popupCloseAttempts++;
  }

  /** Resetar contador de popup quando muda de site */
  onUrlChange(url: string) {
    const d = getDomain(url);
    if (d !== getDomain(this.lastBlockerUrl)) {
      this.popupCloseAttempts = 0;
    }
    this.lastBlockerUrl = url;
  }

  /** Diagnóstico principal — delega para diagnose() pura, mas gerencia estado */
  evaluate(input: Omit<RecoveryInput, 'blockedDomains' | 'popupCloseAttempts'>): RecoveryVerdict {
    const fullInput: RecoveryInput = {
      ...input,
      blockedDomains: this.blockedDomains,
      popupCloseAttempts: this.popupCloseAttempts,
    };

    const verdict = diagnose(fullInput);

    // Side effects
    if (verdict.decision === 'search_alternative' || verdict.decision === 'abort') {
      this.blockDomain(input.url);
    }
    if (verdict.decision === 'close_popup') {
      this.recordPopupClose();
    }
    this.onUrlChange(input.url);

    // Log
    if (verdict.decision !== 'continue') {
      console.log(`[Recovery] ${verdict.decision}: ${verdict.reason} (blocker=${verdict.blocker}, url=${input.url})`);
    }

    return verdict;
  }
}
