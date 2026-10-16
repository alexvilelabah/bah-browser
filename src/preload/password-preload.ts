// Senhas salvas — o lado da PÁGINA: perceber o login enviado e preencher a conta escolhida.
//
// Preload de FRAME registrado pelo main (password-manager.ts) na sessão das abas e na das anônimas
// (lá só preenche; a pergunta de salvar não existe na anônima). Roda no MUNDO ISOLADO
// (contextIsolation): o JavaScript do site não enxerga nada daqui — nem as variáveis, nem o
// ipcRenderer, nem a senha que passa por aqui. Só a página de cima (iframe nunca), só http/https.
//
// - Captura: senha DIGITADA pela pessoa (evento confiável; script do site não conta) + envio
//   (submit, Enter, clique em "Entrar"/botão de enviar) → manda pro main, que só pergunta se o login
//   deu certo (a página trocou, ou o campo de senha sumiu e não voltou).
// - Preencher: clique (ou Tab) num campo de login → manda só a POSIÇÃO do campo; a lista de contas é
//   desenhada pelo Bah fora da página. Escolhida a conta, o main manda usuário + senha pra cá.
//
// Sandbox: só require('electron'). A heurística pura (shared/login-form.ts) chega como BAH_LOGIN — o
// main junta o .js dela com este antes de registrar. Sem import/export de propósito (script simples).
declare const BAH_LOGIN: typeof import('../shared/login-form');

(() => {
  type FieldInfo = import('../shared/login-form').FieldInfo;
  const { ipcRenderer, webFrame } = require('electron') as typeof import('electron');
  const L = BAH_LOGIN;
  try {
    if (window.top !== window) return;
    if (location.protocol !== 'https:' && location.protocol !== 'http:') return;
  } catch { return; }

  const MAX_SCOPE = 400;
  const WATCH_MS = 15_000;         // depois do envio, quanto tempo esperar o campo de senha sumir (igual ao main)
  const SUBMIT_GESTURE_MS = 1500; // 'submit' só conta com clique/tecla de verdade logo antes (requestSubmit de script não)
  const GONE_TICKS = 3;            // sumido em 3 checagens seguidas (≈1,2 s): o "carregando…" não engana
  const SKIP_TYPES = ['hidden', 'submit', 'button', 'image', 'reset', 'checkbox', 'radio', 'file', 'range', 'color', 'search'];

  let capture = false;             // o main diz se esta página pode perguntar "Salvar senha?"
  const everPw = new WeakSet<HTMLInputElement>();   // já foi type=password (o olhinho do site troca pra text)
  const typed = new WeakSet<HTMLInputElement>();    // a pessoa digitou/colou (evento confiável)
  // O ÚLTIMO valor que a pessoa digitou em cada campo: se o site (ou outro script) trocar o valor
  // depois, o que for enviado não é mais o que ela digitou — e não vira pergunta.
  const typedValue = new WeakMap<HTMLInputElement, string>();
  let lastGestureAt = 0;           // último clique/tecla de verdade (o 'submit' sozinho precisa de um recente)
  let lastTypedPw: HTMLInputElement | null = null;
  let docUser = '';                // usuário digitado antes (1ª etapa no mesmo documento)
  let lastSent = { key: '', at: 0 };
  let watchEl: HTMLInputElement | null = null;
  let watchUntil = 0;
  let goneTicks = 0;
  let watchTimer: ReturnType<typeof setInterval> | null = null;
  let lastTabAt = 0;
  let suggestOpen = false;
  let target: { token: string; user: HTMLInputElement | null; pw: HTMLInputElement | null; anchor: HTMLInputElement } | null = null;

  const send = (channel: string, payload?: unknown) => { try { ipcRenderer.send(channel, payload); } catch {} };

  const realTarget = (e: Event): Element | null => {
    try {
      const t = (e.composedPath ? e.composedPath()[0] : e.target) as Element | null;
      return t && t.nodeType === 1 ? t : null;
    } catch { return null; }
  };
  const isInput = (el: unknown): el is HTMLInputElement => el instanceof HTMLInputElement;
  const isPw = (el: HTMLInputElement) => el.type === 'password' || everPw.has(el);
  const notePw = (el: HTMLInputElement) => { if (el.type === 'password') everPw.add(el); };

  const visible = (el: Element): boolean => {
    try {
      if (!el.isConnected) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity || '1') > 0.05;
    } catch { return false; }
  };
  const labelOf = (el: HTMLInputElement): string => {
    let s = el.getAttribute('aria-label') || '';
    if (!s) { try { const l = el.labels && el.labels[0]; if (l) s = l.textContent || ''; } catch {} }
    if (!s) s = el.getAttribute('title') || '';
    return s.replace(/\s+/g, ' ').trim().slice(0, 80);
  };
  const infoOf = (el: HTMLInputElement, withValue: boolean): FieldInfo => ({
    type: String(el.type || 'text').toLowerCase(),
    name: el.name || '',
    id: el.id || '',
    autocomplete: el.getAttribute('autocomplete') || '',
    placeholder: el.getAttribute('placeholder') || '',
    label: labelOf(el),
    visible: visible(el),
    everPassword: everPw.has(el),
    ...(withValue ? { value: String(el.value || '') } : {}),
  });
  const formOf = (el: Element | null): HTMLFormElement | null => {
    if (!el) return null;
    return ((el as HTMLInputElement).form as HTMLFormElement | null | undefined) || el.closest('form');
  };
  /** Os campos que contam junto com `el`: os do formulário dele; sem <form>, os soltos da página. */
  const scopeOf = (el: HTMLInputElement): HTMLInputElement[] => {
    const form = el.form;
    const pool: Element[] = form
      ? Array.from(form.elements)
      : Array.from(document.querySelectorAll('input')).filter(x => !(x as HTMLInputElement).form);
    const list = pool.filter(isInput).filter(x => !SKIP_TYPES.includes(String(x.type).toLowerCase()) || x === el);
    if (!list.includes(el)) list.push(el);   // campo dentro de shadow DOM: entra mesmo assim
    if (list.length <= MAX_SCOPE) return list;
    const i = list.indexOf(el);
    return list.slice(Math.max(0, i - MAX_SCOPE + 20), Math.max(0, i - MAX_SCOPE + 20) + MAX_SCOPE);
  };
  const hasVisiblePassword = (): boolean => {
    try {
      if (watchEl && visible(watchEl)) return true;
      for (const x of Array.from(document.querySelectorAll('input[type="password"]'))) if (visible(x)) return true;
    } catch {}
    return false;
  };

  // ── Captura ────────────────────────────────────────────────────────────────────────────

  /** A senha digitada que vale pro envio feito a partir de `el` (o botão, o campo, o formulário). */
  const typedPasswordNear = (el: Element | null): HTMLInputElement | null => {
    const form = el instanceof HTMLFormElement ? el : formOf(el);
    if (form) {
      for (const x of Array.from(form.elements)) if (isInput(x) && isPw(x) && typed.has(x) && x.value) return x;
      // Botão de OUTRO formulário (a busca do site, por exemplo) não envia a senha deste.
      if (lastTypedPw && lastTypedPw.form) return null;
    }
    return lastTypedPw && lastTypedPw.isConnected && lastTypedPw.value ? lastTypedPw : null;
  };

  /** 1ª etapa de "primeiro o e-mail, depois a senha" (Google, Microsoft…): o main guarda o usuário um tempo. */
  const userHint = (el: Element | null) => {
    let cand: HTMLInputElement | null = isInput(el) ? el : null;
    if (!cand) {
      const form = el instanceof HTMLFormElement ? el : formOf(el);
      const pool = form ? Array.from(form.elements) : Array.from(document.querySelectorAll('input')).slice(0, MAX_SCOPE);
      const users = pool.filter(isInput).filter(x => typed.has(x) && x.value && visible(x) && L.isUsernameLike(infoOf(x, false)));
      if (users.length === 1) cand = users[0];
    }
    if (!cand || !typed.has(cand) || !L.isUsernameLike(infoOf(cand, false))) return;
    const v = String(cand.value || '').trim().slice(0, 512);
    if (!v) return;
    docUser = v;
    send('pw:user-hint', { origin: location.origin, username: v });
  };

  const stopWatch = () => {
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = null; watchEl = null; goneTicks = 0;
  };
  /** Login enviado sem trocar de página (site moderno): deu certo quando a senha some e não volta. */
  const watch = (el: HTMLInputElement) => {
    watchEl = el; watchUntil = Date.now() + WATCH_MS; goneTicks = 0;
    if (watchTimer) return;
    watchTimer = setInterval(() => {
      try {
        if (!watchEl || Date.now() > watchUntil) { stopWatch(); return; }
        if (hasVisiblePassword()) { goneTicks = 0; return; }
        if (++goneTicks >= GONE_TICKS) { send('pw:gone', { origin: location.origin }); stopWatch(); }
      } catch { stopWatch(); }
    }, 400);
  };

  const trigger = (el: Element | null) => {
    try {
      if (!capture) return;
      const pw = typedPasswordNear(el);
      if (!pw) { userHint(el); return; }
      const scope = scopeOf(pw);
      const fields = scope.map(x => infoOf(x, true));
      const c = L.pickCredentials(fields);
      if (!c) return;
      const pwEl = scope[c.passwordIdx];
      // Senha que a pessoa não digitou (preenchida por script do site, por extensão ou pelo próprio
      // Bah), ou que o site trocou depois da última tecla dela, não vira pergunta.
      if (!pwEl || !typed.has(pwEl) || typedValue.get(pwEl) !== String(pwEl.value || '')) return;
      const password = String(pwEl.value || '');
      const username = c.usernameIdx >= 0 ? String(scope[c.usernameIdx].value || '').trim() : docUser;
      const key = `${username}\n${password}`;
      if (key === lastSent.key && Date.now() - lastSent.at < 3000) return;   // Enter + submit = 1 envio
      lastSent = { key, at: Date.now() };
      send('pw:candidate', { origin: location.origin, username, password, kind: c.kind, at: Date.now() });
      watch(pwEl);
    } catch {}
  };

  ipcRenderer.invoke('pw:hello').then((r: any) => {
    capture = !!(r && r.capture);
    // Login enviado na página anterior: o main quer saber se ESTA tem campo de senha (login errado
    // costuma voltar pro formulário — aí não pergunta nada).
    if (r && r.report) {
      const go = () => setTimeout(() => send('pw:page', { origin: location.origin, pw: hasVisiblePassword() }), 600);
      if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
    }
  }).catch(() => {});
  ipcRenderer.on('pw:config', (_e: unknown, c: any) => { capture = !!(c && c.capture); });

  // O "olhinho" do site troca a senha pra type=text: o campo ganha data-bah-pw enquanto estiver à
  // mostra, pra leitura da IA (page-executor.ts, no mundo da página — não enxerga o everPw daqui)
  // pular o valor dele. Some quando volta a ser password.
  try {
    new MutationObserver((list) => {
      for (const m of list) {
        const el = m.target;
        if (!isInput(el)) continue;
        if (String(m.oldValue || '').toLowerCase() === 'password') everPw.add(el);
        if (!everPw.has(el)) continue;
        if (el.type === 'password') el.removeAttribute('data-bah-pw'); else el.setAttribute('data-bah-pw', '');
      }
    }).observe(document, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['type'] });
  } catch {}

  window.addEventListener('input', (e) => {
    try {
      if (!e.isTrusted) return;
      const el = realTarget(e);
      if (!isInput(el)) return;
      notePw(el);
      typed.add(el);
      typedValue.set(el, String(el.value || ''));
      if (isPw(el)) lastTypedPw = el;
      hide();
    } catch {}
  }, true);

  window.addEventListener('submit', (e) => {
    try { if (Date.now() - lastGestureAt <= SUBMIT_GESTURE_MS) trigger(e.target as Element); } catch {}
  }, true);

  window.addEventListener('click', (e) => {
    try {
      if (!e.isTrusted) return;
      lastGestureAt = Date.now();
      if (!capture) return;
      const t = realTarget(e);
      if (!t) return;
      const ctl = (t.closest('button,input,[role="button"],a') || t) as HTMLElement;
      const text = (ctl.innerText || (ctl as HTMLInputElement).value || ctl.getAttribute('aria-label') || ctl.getAttribute('title') || '').slice(0, 120);
      if (L.isSubmitLike({ tag: ctl.tagName, type: ctl.getAttribute('type') || '', text, inForm: !!formOf(ctl) })) trigger(ctl);
    } catch {}
  }, true);

  // ── Preencher ──────────────────────────────────────────────────────────────────────────

  function hide() {
    if (!suggestOpen) return;
    suggestOpen = false;
    send('pw:blur');
  }

  const offerFill = (el: HTMLInputElement) => {
    try {
      notePw(el);
      if (!isPw(el) && !L.isTextLike(el.type)) return;
      const scope = scopeOf(el);
      const tg = L.findFillTargets(scope.map(x => infoOf(x, false)), scope.indexOf(el));
      if (!tg) return;
      const tk = Math.random().toString(36).slice(2) + Date.now().toString(36);
      target = { token: tk, user: tg.usernameIdx >= 0 ? scope[tg.usernameIdx] : null, pw: tg.passwordIdx >= 0 ? scope[tg.passwordIdx] : null, anchor: el };
      const r = el.getBoundingClientRect();
      const z = webFrame.getZoomFactor() || 1;   // posição em pixels da aba (com o zoom dela)
      suggestOpen = true;
      send('pw:focus', { token: tk, role: tg.role, rect: { x: r.left * z, y: r.top * z, w: r.width * z, h: r.height * z } });
    } catch {}
  };

  window.addEventListener('pointerdown', (e) => {
    try {
      if (!e.isTrusted) return;
      lastGestureAt = Date.now();
      const el = realTarget(e);
      // Mede o campo AGORA (captura, antes dos handlers da página): onde a pessoa clicou de fato.
      // Medir depois deixaria o site mover o campo e pôr a lista embaixo do mouse.
      if (isInput(el)) offerFill(el);
    } catch {}
  }, true);
  window.addEventListener('focusin', (e) => {
    try {
      const el = realTarget(e);
      if (!isInput(el)) return;
      notePw(el);
      if (Date.now() - lastTabAt < 500) offerFill(el);   // chegou no campo pelo Tab (foco por script não abre a lista)
    } catch {}
  }, true);
  window.addEventListener('focusout', (e) => { try { if (target && realTarget(e) === target.anchor) hide(); } catch {} }, true);
  window.addEventListener('keydown', (e) => {
    try {
      if (!e.isTrusted) return;
      lastGestureAt = Date.now();
      const el = realTarget(e);
      if (e.key === 'Tab') lastTabAt = Date.now();
      else if (e.key === 'Escape') hide();
      else if (e.key === 'ArrowDown' && !suggestOpen && isInput(el)) offerFill(el);
      else if (e.key === 'Enter' && isInput(el)) { hide(); trigger(el); }
    } catch {}
  }, true);
  // Rolou a página (ou o site mexeu nela): a lista fecha — nunca é movida pra outro lugar.
  window.addEventListener('scroll', () => hide(), { capture: true, passive: true });
  window.addEventListener('resize', () => hide(), { passive: true });
  window.addEventListener('pagehide', () => { hide(); stopWatch(); });

  /** Campo onde dá pra pôr a senha: na tela, com tamanho, sem estar escondido nem transparente. */
  const fillable = (el: HTMLInputElement | null): el is HTMLInputElement => {
    try {
      if (!el || !el.isConnected || el.disabled) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
      const s = getComputedStyle(el);
      if (s.visibility !== 'visible' || s.display === 'none') return false;
      for (let n: Element | null = el, i = 0; n && i < 40; n = n.parentElement, i++) {
        if (Number(getComputedStyle(n).opacity || '1') < 0.1) return false;
      }
      return true;
    } catch { return false; }
  };
  const setValue = (el: HTMLInputElement, v: string) => {
    try { el.focus(); } catch {}
    // O setter nativo (não o do site): React/Vue enxergam a troca no evento 'input' logo abaixo.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  ipcRenderer.on('pw:fill', (_e: unknown, m: any) => {
    try {
      if (!m || !target || m.token !== target.token) return;
      const t = target;
      target = null;
      suggestOpen = false;
      // Campo escondido, transparente ou fora da tela não recebe nada (a página poderia mostrar um
      // campo e colher a senha noutro, invisível). O clicado tem que estar à vista.
      if (!fillable(t.anchor)) return;
      if (fillable(t.user) && typeof m.username === 'string' && m.username) setValue(t.user, m.username);
      if (fillable(t.pw) && typeof m.password === 'string' && m.password) setValue(t.pw, m.password);
      try { t.anchor.focus(); } catch {}
    } catch {}
  });
})();
