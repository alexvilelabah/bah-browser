// Senhas salvas — a heurística do formulário de login, PURA (sem DOM): recebe a lista simplificada
// dos campos de um formulário (na ordem da página) e decide qual é o usuário e qual é a senha.
//
// Roda DENTRO da página, no mundo isolado do preload das senhas (preload/password-preload.ts). O
// preload de aba é SANDBOX (só aceita require('electron')), então o main junta o .js compilado deste
// arquivo com o do preload (main/password-manager.ts → buildPagePreload). Por isso: NADA de import
// aqui, e nada que dependa de Node ou do DOM.

export interface FieldInfo {
  type: string;            // input.type em minúsculas ('text', 'email', 'password'…)
  name?: string;
  id?: string;
  autocomplete?: string;
  placeholder?: string;
  label?: string;          // aria-label / <label> / title
  visible: boolean;
  value?: string;          // só no momento de capturar (no preencher não vai valor nenhum)
  everPassword?: boolean;  // já foi type=password (o "olhinho" do site troca pra text na hora de entrar)
}

export type LoginKind = 'login' | 'signup' | 'change';
export interface Credentials { usernameIdx: number; passwordIdx: number; kind: LoginKind }
export interface FillTargets { role: 'username' | 'password'; usernameIdx: number; passwordIdx: number }
export interface ClickInfo { tag: string; type?: string; text?: string; inForm?: boolean }

const TEXT_TYPES = ['', 'text', 'email', 'tel', 'number'];
// Nome/id/placeholder/rótulo que indicam "campo de usuário" (pt/en/es).
const USER_HINT = /user|login|e-?mail|mail|cpf|cnpj|conta|account|usu[aá]rio|identifi|logon|nome de usu|phone|telefone|celular|matr[ií]cula|cuenta|correo/i;
// Nunca é usuário: busca, captcha, código de verificação, cupom, CEP…
const NOT_USER = /search|busca|pesquis|captcha|otp|token|c[oó]digo|code|cupom|coupon|promo|\bzip\b|\bcep\b/i;
// Texto de botão que envia login/cadastro (sem acento, minúsculo: ver plain()).
const SUBMIT_WORDS = /\b(entrar|login|log in|logon|logar|sign in|signin|sign on|acessar|acceder|conectar|continuar|continue|next|proximo|proxima|seguinte|avancar|submit|enviar|confirmar|iniciar sessao|iniciar sesion|ingresar|siguiente|cadastrar|criar conta|sign up|signup|create account|registrar|register|salvar|save|alterar|change|update|ok|go)\b/;
// …mas não "Esqueci a senha", "Mostrar senha", "Ajuda" (o olhinho do site é um botão também).
const NOT_SUBMIT = /esquec|forgot|olvid|recuperar|reset|ajuda|help|ayuda|mostrar|show|exibir|ocultar|hide|ver senha|ver contrasena/;

const plain = (s: string | undefined): string =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const acTokens = (f: FieldInfo): string[] => String(f.autocomplete || '').toLowerCase().split(/\s+/).filter(Boolean);

export function isPasswordField(f: FieldInfo): boolean {
  return f.type === 'password' || !!f.everPassword;
}

export function isTextLike(type: string): boolean {
  return TEXT_TYPES.includes(String(type || '').toLowerCase());
}

const hintText = (f: FieldInfo): string => [f.name, f.id, f.placeholder, f.label].filter(Boolean).join(' ');

/** Parece campo de usuário (pro fluxo "primeiro o e-mail, depois a senha" do Google/Microsoft). */
export function isUsernameLike(f: FieldInfo): boolean {
  if (isPasswordField(f) || !isTextLike(f.type)) return false;
  const ac = acTokens(f);
  if (ac.includes('username') || ac.includes('email')) return true;
  const hint = hintText(f);
  if (NOT_USER.test(hint)) return false;
  return f.type === 'email' || USER_HINT.test(hint);
}

/** Nota do campo como "usuário": autocomplete=username > e-mail > nome que diz usuário > campo de texto qualquer. */
function userScore(f: FieldInfo): number {
  if (isPasswordField(f) || !isTextLike(f.type)) return -1;
  const ac = acTokens(f);
  const hint = hintText(f);
  const strong = ac.includes('username') || ac.includes('email');
  if (!strong && NOT_USER.test(hint)) return -1;
  if (ac.includes('one-time-code')) return -1;
  // Campo escondido só vale se o site disse que é o usuário (o Google põe um assim, pros
  // gerenciadores de senha). Escondido sem dizer nada costuma ser armadilha de robô.
  if (!f.visible && !strong && !USER_HINT.test(hint)) return -1;
  let s = 1;
  if (ac.includes('username')) s += 100;
  else if (ac.includes('email')) s += 80;
  if (f.type === 'email') s += 60;
  if (USER_HINT.test(hint)) s += 40;
  if (f.visible) s += 10;
  return s;
}

/**
 * O melhor campo de usuário ANTES de `beforeIdx` (a senha). Perto da senha ganha um pouco
 * (o e-mail da newsletter lá no topo não vence o "login" logo acima da senha). -1 = nenhum.
 */
export function pickUsername(fields: FieldInfo[], beforeIdx: number, needValue: boolean): number {
  let best = -1;
  let bestScore = 0;
  let rank = 0;
  for (let i = Math.min(beforeIdx, fields.length) - 1; i >= 0; i--) {
    const f = fields[i];
    let s = userScore(f);
    if (s <= 0) continue;
    if (needValue && !String(f.value || '').trim()) continue;
    s += Math.max(0, 30 - 10 * rank);
    rank++;
    if (s > bestScore) { best = i; bestScore = s; }
  }
  return best;
}

/**
 * Na hora de enviar: qual é a senha a guardar e quem é o usuário.
 * - 1 senha → login. 2 iguais → cadastro (senha + confirmação). 2 diferentes → troca (atual, nova).
 * - 3 → troca (atual, nova, confirmação): a nova precisa bater com a confirmação.
 * - autocomplete="new-password" manda: a nova é a primeira delas (e a confirmação tem que bater).
 * Senha vazia não conta. null = não dá pra saber (ou nada a guardar).
 */
export function pickCredentials(fields: FieldInfo[]): Credentials | null {
  const pws: number[] = [];
  fields.forEach((f, i) => { if (isPasswordField(f) && String(f.value || '') !== '') pws.push(i); });
  if (!pws.length || pws.length > 4) return null;
  const val = (i: number) => String(fields[i].value || '');
  let passwordIdx = -1;
  let kind: LoginKind = 'login';
  const news = pws.filter(i => acTokens(fields[i]).includes('new-password'));
  if (news.length) {
    if (news.length > 1 && news.some(i => val(i) !== val(news[0]))) return null;   // confirmação não bate
    passwordIdx = news[0];
    kind = pws.some(i => !news.includes(i)) ? 'change' : 'signup';
  } else if (pws.length === 1) {
    passwordIdx = pws[0];
  } else if (pws.length === 2) {
    if (val(pws[0]) === val(pws[1])) { passwordIdx = pws[0]; kind = 'signup'; }
    else { passwordIdx = pws[1]; kind = 'change'; }
  } else {
    const n = pws.length;
    if (val(pws[n - 2]) === val(pws[n - 1])) { passwordIdx = pws[n - 2]; kind = 'change'; }
    else return null;
  }
  return { usernameIdx: pickUsername(fields, pws[0], true), passwordIdx, kind };
}

/**
 * Campo clicado → o que preencher. Na senha: ela + o usuário logo antes. No usuário: ele + a senha
 * que vem depois (se o usuário dela for ele). Só o usuário (1ª etapa do Google/Microsoft): quando não
 * há senha visível e o campo é claramente de login. Senha nova (cadastro) não ganha sugestão.
 */
export function findFillTargets(fields: FieldInfo[], focusIdx: number): FillTargets | null {
  const f = fields[focusIdx];
  if (!f || !f.visible) return null;
  const isNew = (x: FieldInfo) => acTokens(x).includes('new-password');
  if (isPasswordField(f)) {
    if (isNew(f)) return null;
    return { role: 'password', passwordIdx: focusIdx, usernameIdx: pickUsername(fields, focusIdx, false) };
  }
  if (userScore(f) <= 0) return null;
  const nextPw = fields.findIndex((x, i) => i > focusIdx && isPasswordField(x) && x.visible && !isNew(x));
  if (nextPw >= 0) {
    return pickUsername(fields, nextPw, false) === focusIdx
      ? { role: 'username', usernameIdx: focusIdx, passwordIdx: nextPw }
      : null;
  }
  const anyPw = fields.some(x => isPasswordField(x) && x.visible);
  const visibleText = fields.filter(x => x.visible && !isPasswordField(x) && isTextLike(x.type)).length;
  if (!anyPw && visibleText <= 2 && isUsernameLike(f)) return { role: 'username', usernameIdx: focusIdx, passwordIdx: -1 };
  return null;
}

/** Clique que (provavelmente) envia o login: botão de enviar, ou texto tipo "Entrar"/"Próximo". */
export function isSubmitLike(c: ClickInfo): boolean {
  const tag = String(c.tag || '').toLowerCase();
  const type = String(c.type || '').toLowerCase();
  const text = plain(c.text).slice(0, 80);
  if (text && NOT_SUBMIT.test(text)) return false;
  if (tag === 'input' && (type === 'submit' || type === 'image')) return true;
  if (tag === 'button' && (type === 'submit' || (!type && !!c.inForm))) return true;
  return !!text && text.length <= 40 && SUBMIT_WORDS.test(text);
}
