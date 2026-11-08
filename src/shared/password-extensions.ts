// Gerenciadores de senha em extensão (LastPass, Bitwarden, 1Password): qual está ligado, como
// cada um entra sozinho num site, e o que o agente faz num formulário de login quando há um. Puro
// (main e tela usam; testado com node --test).
//
// Decisão do usuário: esses gerenciadores já têm preenchimento e login automáticos — se o Bah fizer
// o dele, os dois brigam. Então o Bah COOPERA: espera o login automático da extensão (se ela faz
// isso) e, se nada acontecer, pausa e diz à pessoa como ligar a opção NA extensão. O agente nunca
// digita credencial nem lê senha; o usuário só se estiver escrito na página.
//
// Ler ou mudar a opção por site de dentro do Bah: não há caminho público e suportado (ver
// ARCHITECTURE.md, "Gerenciadores de senha em extensão"). Por isso o Bah só orienta.

export type PwExtKind = 'lastpass' | 'bitwarden' | '1password';

/** IDs da Chrome Web Store (o ID vem da chave pública: outra extensão não consegue usar o mesmo). */
export const PASSWORD_EXTENSION_IDS: Readonly<Record<string, PwExtKind>> = Object.freeze({
  hdokiejnpimakedhajhdlcegeplioahd: 'lastpass',
  nngceckbapebfimnlniiiahkandclblb: 'bitwarden',
  aeblfdkhhhdcdjpifhhbdiojplfjncoa: '1password',
  khgocmkkpikpnmmkgmdnfckapcdkgfaf: '1password',   // 1Password Beta
});

export const KIND_NAME: Readonly<Record<PwExtKind, string>> = { lastpass: 'LastPass', bitwarden: 'Bitwarden', '1password': '1Password' };

export interface PwExtension { id: string; name: string; kind: PwExtKind }

/**
 * Os gerenciadores de senha LIGADOS entre as extensões instaladas, na ordem da lista. `extra` só
 * em teste (extensão local que imita um gerenciador; o ID dela muda a cada chave gerada).
 */
export function detectPasswordExtensions(
  list: ReadonlyArray<{ id: string; name?: string; enabled?: boolean }>,
  extra: Readonly<Record<string, PwExtKind>> = {},
): PwExtension[] {
  const out: PwExtension[] = [];
  for (const x of list || []) {
    if (!x || typeof x.id !== 'string' || x.enabled === false) continue;
    const kind = Object.prototype.hasOwnProperty.call(PASSWORD_EXTENSION_IDS, x.id) ? PASSWORD_EXTENSION_IDS[x.id]
      : Object.prototype.hasOwnProperty.call(extra, x.id) ? extra[x.id] : undefined;
    if (!kind || out.some(o => o.id === x.id)) continue;
    // Nome da marca (o do manifesto pode vir como "__MSG_extName__" e o cartão fala da marca).
    out.push({ id: x.id, name: KIND_NAME[kind], kind });
  }
  return out;
}

/** Lê o mapa de teste (JSON {"<id>":"lastpass"}); qualquer outra coisa → {}. */
export function parseExtraPasswordIds(raw: unknown): Record<string, PwExtKind> {
  const out: Record<string, PwExtKind> = {};
  if (typeof raw !== 'string' || !raw.trim()) return out;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return out;
    for (const [id, k] of Object.entries(o)) {
      if (/^[a-p]{32}$/.test(id) && (k === 'lastpass' || k === 'bitwarden' || k === '1password')) out[id] = k;
    }
  } catch {}
  return out;
}


/**
 * Como cada um entra sozinho (conferido na documentação oficial, nov/2026):
 *  - LastPass: item do site → Editar → Configurações avançadas → "Auto-login" (preenche E envia).
 *  - Bitwarden: Configurações → Preenchimento automático → "Autofill on page load" (global, e
 *    cada login tem a própria opção). Só PREENCHE — não envia.
 *  - 1Password: nunca preenche sem a pessoa pedir (support.1password.com/browser-autofill-security).
 *    Depois que ela escolhe o login, ele envia sozinho (envio automático, ligado por padrão).
 */
export interface AutoLoginInfo {
  /** Nome da opção como aparece na extensão (em inglês, como a extensão mostra). */
  setting: string;
  /** A extensão pode entrar sozinha (sem clique da pessoa)? Se não, nem vale esperar. */
  acts: boolean;
  /** Ela só preenche (não envia): depois de preencher alguém clica em "Entrar". */
  fillOnly: boolean;
}
export const AUTO_LOGIN: Readonly<Record<PwExtKind, AutoLoginInfo>> = Object.freeze({
  lastpass: { setting: 'Auto-login', acts: true, fillOnly: false },
  bitwarden: { setting: 'Autofill on page load', acts: true, fillOnly: true },
  '1password': { setting: 'Autofill & save → submit automatically', acts: false, fillOnly: false },
});

/** Quanto o agente espera o login automático da extensão antes de pausar (ms). */
export const AUTO_LOGIN_WAIT_MS = 8000;

/** O que a página mostra enquanto o agente espera. */
export interface LoginWaitSnapshot {
  /** Ainda tem formulário de login (campo de senha ou página /login) à vista. */
  loginForm: boolean;
  /** Já entrou (Sair / Minha conta à vista). */
  signedIn: boolean;
  /** O campo de senha tem algo dentro (só o "tem/não tem" — o Bah nunca lê o valor). */
  passwordFilled: boolean;
  /** O agente digitou nesta aba durante a espera (então não foi a extensão). */
  agentTyped?: boolean;
}

export type LoginWaitStep = 'continue' | 'submit' | 'wait' | 'pause';

/**
 * Um passo da espera:
 *  - entrou ou o formulário sumiu → 'continue' (o agente segue, já com a conta);
 *  - Bitwarden preencheu sozinho (fillOnly) e o Bah ainda não enviou → 'submit' (aperta "Entrar";
 *    quem pôs a senha foi a extensão, com a opção de preencher ligada pela pessoa);
 *  - ainda dentro do tempo → 'wait';
 *  - acabou o tempo, ou a extensão nem entra sozinha → 'pause' (cartão com a orientação).
 */
export function loginWaitStep(o: {
  kind: PwExtKind; elapsedMs: number; budgetMs?: number; submitted: boolean; snap: LoginWaitSnapshot;
}): LoginWaitStep {
  const { snap } = o;
  if (snap.signedIn || !snap.loginForm) return 'continue';
  const info = AUTO_LOGIN[o.kind];
  if (!info.acts || snap.agentTyped) return 'pause';
  if (info.fillOnly && snap.passwordFilled && !o.submitted) return 'submit';
  return o.elapsedMs < (o.budgetMs ?? AUTO_LOGIN_WAIT_MS) ? 'wait' : 'pause';
}

/** Chave do texto (i18n) do cartão de pausa pra cada gerenciador. */
export function guidanceKey(kind: PwExtKind): string {
  return kind === 'lastpass' ? 'pwext.guide.lastpass' : kind === 'bitwarden' ? 'pwext.guide.bitwarden' : 'pwext.guide.1password';
}

// ── Scripts de página da espera (rodam na aba; nunca devolvem a senha) ─────────────────────────
/** "O campo de senha visível tem algo dentro?" — só true/false sai da página. */
export const PASSWORD_FIELD_FILLED_JS = `(() => { try {
  return Array.prototype.some.call(document.querySelectorAll('input[type=password]'), function (i) {
    var r = i.getBoundingClientRect(); return r.width > 0 && r.height > 0 && i.value.length > 0; });
} catch (e) { return false; } })()`;

/**
 * Aperta "Entrar" do formulário que a extensão preencheu: requestSubmit do <form> do campo de senha
 * (igual a clicar no botão de enviar dele); sem <form>, o botão de enviar/entrar mais perto. Só roda
 * quando o loginWaitStep manda ('submit'): a senha foi posta pela extensão, nunca pelo agente.
 */
export const SUBMIT_FILLED_LOGIN_JS = `(() => { try {
  var pw = Array.prototype.find.call(document.querySelectorAll('input[type=password]'), function (i) { return i.value.length > 0; });
  if (!pw) return false;
  var f = pw.form;
  if (f) { var b = f.querySelector('button[type=submit],input[type=submit],button:not([type])');
    if (b) { b.click(); return true; }
    if (f.requestSubmit) f.requestSubmit(); else f.submit(); return true; }
  var re = /^(sign\\s*in|log\\s*in|login|entrar|continue|continuar|iniciar\\s*sesi[oó]n)$/i;
  var root = pw.closest('section,main,div[role=dialog],div') || document;
  var btn = Array.prototype.find.call(root.querySelectorAll('button,[role=button],input[type=submit]'), function (x) {
    return re.test((x.innerText || x.value || x.getAttribute('aria-label') || '').trim()); });
  if (btn) { btn.click(); return true; }
  return false;
} catch (e) { return false; } })()`;
