import type { ObservedState } from './page-executor';

export type ManualHelpKind = 'login' | 'captcha' | 'paywall' | 'blocked' | 'stuck';

export interface ManualHelpRequest {
  kind: ManualHelpKind;
  reason: string;
  instruction: string;
}

const LOGIN_BLOCK_PATTERNS = /\b(fa[cç]a\s*login\s*para\s*continuar|log\s*in\s*to\s*continue|sign\s*in\s*required|login\s*required|please\s*sign\s*in|entre\s*para\s*ver|you\s*must\s*be\s*logged\s*in|crie?\s*uma?\s*conta\s*para|entrar\s*para\s*continuar|acesse\s*sua\s*conta)\b/i;
const LOGIN_UI_PATTERNS = /\b(entrar|fazer\s*login|login|sign\s*in|continue\s*with|continuar\s*com|criar\s*conta|sign\s*up)\b/i;
const LOGIN_FORM_PATTERNS = /\b(senha|password|e-?mail|email|telefone|phone|cpf|usuario|usu[aá]rio).{0,40}\b(entrar|continuar|login|sign\s*in)\b|\b(entrar|continuar|login|sign\s*in).{0,40}\b(senha|password|e-?mail|email|telefone|phone|cpf|usuario|usu[aá]rio)\b/i;
const LOGGED_IN_HINT_PATTERNS = /\b(minha\s*conta|sua\s*conta|meu\s*perfil|minhas\s*compras|meus\s*pedidos|ol[aá][, ]|bem[- ]?vindo|bem[- ]?vinda|sair|logout|log\s*out)\b/i;
const CAPTCHA_PATTERNS = /\b(captcha|recaptcha|hcaptcha|n[aã]o\s*sou\s*um?\s*rob[oô]|i'?m?\s*not\s*a\s*robot|verify\s*you\s*are\s*human|prove\s*you'?re\s*human|verifi(ca[cç][aã]o|que).*human|cloudflare|checking\s*your\s*browser|security\s*check|seleciona(r)?\s*(todos\s*)?os\s*quadrados|selecione\s*(todas\s*)?as\s*imagens|quadrados\s*que\s*cont[eê]m|bots?\s*tamb[eé]m\s*usam|complet[ae]\s*o\s*(seguinte\s*)?desafio|confirm(e|ar)\s*que\s*este\s*pedido)\b/i;
const PAYWALL_PATTERNS = /\b(paywall|subscribe|assinante|assine|subscription|premium|conte[uú]do\s*exclusivo)\b/i;

// Nota: possessivos soltos ("meu/minha") NAO entram — "meus downloads" virava falso
// positivo de tarefa privada. Os substantivos de conta cobrem os casos reais.
// "salvo/salvos" saiu — pegava "arquivo salvo" (download) como tarefa de conta.
const PRIVATE_TASK_PATTERNS = /\b(minha\s+conta|sua\s+conta|perfil|pedido|pedidos|carrinho|favorito|favoritos|historico|hist[oó]rico|mensagem|mensagens|notifica[cç][oõ]es|endere[cç]o|endere[cç]os|pagamento|cart[aã]o|assinatura|inbox|gmail)\b/i;
const PUBLIC_TASK_PATTERNS = /\b(pesquis|buscar|busque|procure|pre[cç]o|comparar|compare|abrir|ver|ler|resum|produto|noticia|not[ií]cia|wikipedia|github|youtube|mercado\s*livre|amazon)\b/i;

export function commandLikelyNeedsAccount(command: string): boolean {
  return PRIVATE_TASK_PATTERNS.test(normalize(command));
}

export function commandLooksPublic(command: string): boolean {
  const text = normalize(command);
  return PUBLIC_TASK_PATTERNS.test(text) && !PRIVATE_TASK_PATTERNS.test(text);
}

export function detectManualHelpNeed(
  command: string,
  observation: ObservedState,
  stepsOnSameUrl: number,
  noEffectCount: number,
): ManualHelpRequest | null {
  const page = normalize([
    observation.title,
    observation.text_sample,
    observation.interactive_elements.map(e => `${e.text || ''} ${e.aria || ''} ${e.placeholder || ''}`).join(' '),
  ].join(' '));
  const host = getHost(observation.url);
  const privateTask = commandLikelyNeedsAccount(command);
  const publicTask = commandLooksPublic(command);

  if (CAPTCHA_PATTERNS.test(page)) {
    return {
      kind: 'captcha',
      reason: `O site ${host || 'atual'} mostrou uma verificacao humana.`,
      instruction: 'Resolva o captcha/verificacao manualmente nesta aba. Quando terminar, clique em Continuar para eu retomar a tarefa.',
    };
  }

  // Motores de busca, enciclopedias e YouTube sao conteudo aberto — nunca paywall/login-gate.
  // (Resultados de imagem/video com "premium"/"assine" no texto geravam falso positivo.)
  if (/(^|\.)google\.[a-z.]+$|(^|\.)bing\.com$|(^|\.)duckduckgo\.com$|(^|\.)wikipedia\.org$|(^|\.)wikimedia\.org$|(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(host)) {
    return null;
  }

  if (PAYWALL_PATTERNS.test(page) && privateTask) {
    return {
      kind: 'paywall',
      reason: `O conteudo em ${host || 'este site'} parece exigir assinatura ou acesso da conta.`,
      instruction: 'Se voce tiver acesso, entre manualmente. Depois clique em Continuar. Se nao tiver, pare a tarefa ou peca para eu buscar outra fonte.',
    };
  }

  const hardLoginGate = LOGIN_BLOCK_PATTERNS.test(page);
  const loginVisible = LOGIN_UI_PATTERNS.test(page);
  const loginFormVisible = LOGIN_FORM_PATTERNS.test(page) || observation.interactive_elements.some(e => {
    const label = normalize(`${e.text || ''} ${e.aria || ''} ${e.placeholder || ''}`);
    return /senha|password|e-?mail|email|telefone|phone|cpf/.test(label);
  });
  const looksLoggedIn = LOGGED_IN_HINT_PATTERNS.test(page);
  const urlLooksLikeLogin = /\/(login|signin|sign-in|entrar|account\/login|accounts)/i.test(observation.url);
  const likelyStuckOnLogin = privateTask
    && !looksLoggedIn
    && (loginFormVisible || urlLooksLikeLogin || (loginVisible && noEffectCount >= 2))
    && (stepsOnSameUrl >= 2 || noEffectCount >= 2);

  if ((hardLoginGate || likelyStuckOnLogin) && !publicTask) {
    return {
      kind: 'login',
      reason: `Para essa tarefa, ${host || 'o site atual'} parece precisar de login.`,
      instruction: 'Faca login ou crie a conta manualmente no proprio site. Eu nao preciso ver sua senha. Quando a pagina estiver logada, clique em Continuar para eu seguir daqui.',
    };
  }

  return null;
}

export function manualHelpHistoryNote(request: ManualHelpRequest, beforeUrl: string, afterUrl: string): string {
  return [
    `HUMAN HELP [${request.kind}]: ${request.reason}`,
    `USER TOOK OVER MANUALLY. before=${beforeUrl || '(unknown)'} after=${afterUrl || '(unknown)'}`,
    'Continue from the current page. Do not ask for credentials in chat. If login/captcha is still present, ask for manual help again instead of trying to bypass it.',
  ].join('\n');
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
