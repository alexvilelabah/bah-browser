// Senhas salvas — a heurística do formulário (shared/login-form.ts): quem é o usuário, qual senha
// guardar, o que preencher ao clicar, e que clique conta como "enviar o login".
import { test } from 'node:test';
import assert from 'node:assert';
import {
  pickCredentials, pickUsername, findFillTargets, isSubmitLike, isUsernameLike, isPasswordField, type FieldInfo,
} from '../../src/shared/login-form.ts';

const f = (type: string, extra: Partial<FieldInfo> = {}): FieldInfo => ({ type, visible: true, ...extra });

test('login simples: e-mail + senha', () => {
  const fields = [f('email', { value: 'ana@x.com' }), f('password', { value: 's3nh4' })];
  assert.deepStrictEqual(pickCredentials(fields), { usernameIdx: 0, passwordIdx: 1, kind: 'login' });
});

test('usuário: autocomplete=username vence o campo de texto mais perto', () => {
  const fields = [
    f('text', { autocomplete: 'username', value: 'ana' }),
    f('text', { name: 'apelido', value: 'aninha' }),
    f('password', { value: 'x' }),
  ];
  assert.strictEqual(pickCredentials(fields)?.usernameIdx, 0);
});

test('usuário: o "login" logo acima da senha vence o e-mail da newsletter lá no topo', () => {
  const fields = [
    f('email', { name: 'newsletter', value: 'promo@x.com' }),
    f('text', { name: 'q2', value: 'busca' }),
    f('text', { name: 'nome', value: 'Ana' }),
    f('text', { name: 'login', value: 'ana.silva' }),
    f('password', { value: 'x' }),
  ];
  assert.strictEqual(pickCredentials(fields)?.usernameIdx, 3);
});

test('usuário: campo escondido sem dica é armadilha de robô; escondido com autocomplete=username vale', () => {
  assert.strictEqual(pickCredentials([f('text', { visible: false, name: 'website', value: 'spam' }), f('password', { value: 'x' })])?.usernameIdx, -1);
  assert.strictEqual(pickCredentials([f('email', { visible: false, autocomplete: 'username', value: 'ana@x.com' }), f('password', { value: 'x' })])?.usernameIdx, 0);
});

test('usuário: captcha, código e busca nunca são usuário; campo vazio também não', () => {
  assert.strictEqual(pickCredentials([f('text', { name: 'captcha', value: 'AB12' }), f('password', { value: 'x' })])?.usernameIdx, -1);
  assert.strictEqual(pickCredentials([f('text', { name: 'otp_code', value: '123456' }), f('password', { value: 'x' })])?.usernameIdx, -1);
  assert.strictEqual(pickCredentials([f('text', { name: 'cpf', value: '' }), f('password', { value: 'x' })])?.usernameIdx, -1);
  assert.strictEqual(pickUsername([f('text', { name: 'cpf' }), f('password')], 1, false), 0);   // pra preencher, vazio serve
});

test('cadastro (senha + confirmação iguais) e troca de senha', () => {
  assert.deepStrictEqual(pickCredentials([f('email', { value: 'a@b.c' }), f('password', { value: 'N0va' }), f('password', { value: 'N0va' })]),
    { usernameIdx: 0, passwordIdx: 1, kind: 'signup' });
  // atual + nova (diferentes): guarda a nova
  assert.deepStrictEqual(pickCredentials([f('password', { value: 'velha' }), f('password', { value: 'nova' })]),
    { usernameIdx: -1, passwordIdx: 1, kind: 'change' });
  // atual + nova + confirmação
  assert.strictEqual(pickCredentials([f('password', { value: 'velha' }), f('password', { value: 'nova' }), f('password', { value: 'nova' })])?.passwordIdx, 1);
  // confirmação não bate → não dá pra saber
  assert.strictEqual(pickCredentials([f('password', { value: 'velha' }), f('password', { value: 'nova' }), f('password', { value: 'n0va' })]), null);
});

test('autocomplete=new-password manda; confirmação diferente não guarda nada', () => {
  const cur = f('password', { autocomplete: 'current-password', value: 'velha' });
  assert.deepStrictEqual(pickCredentials([cur, f('password', { autocomplete: 'new-password', value: 'nova' }), f('password', { autocomplete: 'new-password', value: 'nova' })]),
    { usernameIdx: -1, passwordIdx: 1, kind: 'change' });
  assert.strictEqual(pickCredentials([f('password', { autocomplete: 'new-password', value: 'a' }), f('password', { autocomplete: 'new-password', value: 'b' })]), null);
  assert.strictEqual(pickCredentials([f('email', { value: 'a@b.c' }), f('password', { autocomplete: 'new-password', value: 'a' })])?.kind, 'signup');
});

test('senha vazia não conta; campo que já foi senha (o olhinho trocou pra text) conta', () => {
  assert.strictEqual(pickCredentials([f('email', { value: 'a@b.c' }), f('password', { value: '' })]), null);
  const shown = f('text', { everPassword: true, value: 'abc' });
  assert.ok(isPasswordField(shown));
  assert.deepStrictEqual(pickCredentials([f('email', { value: 'a@b.c' }), shown]), { usernameIdx: 0, passwordIdx: 1, kind: 'login' });
  assert.strictEqual(pickCredentials([]), null);
});

test('preencher: clique na senha → ela + usuário; clique no usuário → ele + a senha dele', () => {
  const fields = [f('text', { name: 'q' }), f('email', { name: 'email' }), f('password')];
  assert.deepStrictEqual(findFillTargets(fields, 2), { role: 'password', passwordIdx: 2, usernameIdx: 1 });
  assert.deepStrictEqual(findFillTargets(fields, 1), { role: 'username', usernameIdx: 1, passwordIdx: 2 });
  // "nome" antes do e-mail num cadastro: não é o usuário daquela senha → sem lista
  assert.strictEqual(findFillTargets([f('text', { name: 'nome' }), f('email', { name: 'email' }), f('password')], 0), null);
});

test('preencher: 1ª etapa só com o e-mail (Google/Microsoft); senha nova e campo escondido não ganham lista', () => {
  assert.deepStrictEqual(findFillTargets([f('email', { name: 'identifier', autocomplete: 'username' })], 0), { role: 'username', usernameIdx: 0, passwordIdx: -1 });
  assert.strictEqual(findFillTargets([f('text', { name: 'cidade' })], 0), null);   // texto qualquer sozinho
  assert.strictEqual(findFillTargets([f('email'), f('password', { autocomplete: 'new-password' })], 1), null);
  assert.strictEqual(findFillTargets([f('email'), f('password', { visible: false })], 1), null);
  assert.strictEqual(findFillTargets([f('email', { name: 'email' }), f('text'), f('text'), f('text')], 0), null);   // formulário grande sem senha
});

test('isSubmitLike: botão de enviar, "Entrar"/"Próximo"; nunca "Mostrar senha" ou "Esqueci a senha"', () => {
  assert.strictEqual(isSubmitLike({ tag: 'INPUT', type: 'submit' }), true);
  assert.strictEqual(isSubmitLike({ tag: 'input', type: 'image' }), true);
  assert.strictEqual(isSubmitLike({ tag: 'button', type: '', inForm: true, text: '→' }), true);   // botão sem type no form = enviar
  assert.strictEqual(isSubmitLike({ tag: 'button', type: '', inForm: false, text: '→' }), false);
  assert.strictEqual(isSubmitLike({ tag: 'div', text: 'Entrar' }), true);
  assert.strictEqual(isSubmitLike({ tag: 'button', type: 'button', text: 'Próximo' }), true);
  assert.strictEqual(isSubmitLike({ tag: 'button', type: 'button', text: 'Próxima' }), true);    // o "Próxima" do Google
  assert.strictEqual(isSubmitLike({ tag: 'button', type: 'button', text: 'Iniciar sesión' }), true);
  assert.strictEqual(isSubmitLike({ tag: 'div', text: 'Avançar' }), true);                         // Microsoft
  assert.strictEqual(isSubmitLike({ tag: 'a', text: 'Sign in' }), true);
  assert.strictEqual(isSubmitLike({ tag: 'button', type: 'button', text: 'Mostrar senha' }), false);
  assert.strictEqual(isSubmitLike({ tag: 'button', type: 'submit', text: 'Esqueci minha senha' }), false);
  assert.strictEqual(isSubmitLike({ tag: 'a', text: 'Esqueceu a senha?' }), false);
  assert.strictEqual(isSubmitLike({ tag: 'div', text: 'Bem-vindo ao nosso site, entre e aproveite todas as ofertas da semana' }), false);
  assert.strictEqual(isSubmitLike({ tag: 'span', text: 'Ofertas' }), false);
});

test('isUsernameLike: e-mail/usuário sim; busca, senha e texto qualquer não', () => {
  assert.strictEqual(isUsernameLike(f('email')), true);
  assert.strictEqual(isUsernameLike(f('text', { name: 'username' })), true);
  assert.strictEqual(isUsernameLike(f('tel', { autocomplete: 'username' })), true);
  assert.strictEqual(isUsernameLike(f('text', { name: 'cidade' })), false);
  assert.strictEqual(isUsernameLike(f('search', { name: 'user' })), false);
  assert.strictEqual(isUsernameLike(f('password', { name: 'user' })), false);
  assert.strictEqual(isUsernameLike(f('text', { name: 'search_user' })), false);
});
