// ─────────────────────────────────────────────────────────────────────────────
// PORTEIRO de overlays (cookie/consent/GDPR) — o SCRIPT injetável.
// Roda em CADA frame (o main injeta em todos via framesInSubtree), então alcança
// também CMPs dentro de iframe de outra origem (Sourcepoint etc.) — coisa que JS
// no documento de cima não consegue. Conservador: frameworks por seletor (alta
// confiança) + heurística por texto SÓ dentro de container de consent. 1x por frame.
// ─────────────────────────────────────────────────────────────────────────────
export const OVERLAY_DISMISS_SCRIPT = `
(function(){
  try {
    if (window.__navOverlaysDismissed) return '';
    const vis = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity || '1') > 0.05;
    };
    const fire = (el, why) => {
      try { el.scrollIntoView({ block: 'center' }); } catch(e){}
      try { ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}))); } catch(e){}
      try { if (typeof el.click === 'function') el.click(); } catch(e){}
      window.__navOverlaysDismissed = true;
      return why;
    };
    // 1) frameworks de consent conhecidos (alta confiança) — incl. CMPs de IFRAME
    const KNOWN = [
      '#onetrust-accept-btn-handler',
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      '#CybotCookiebotDialogBodyButtonAccept',
      '#didomi-notice-agree-button',
      '.qc-cmp2-summary-buttons button[mode="primary"]',
      '.fc-button.fc-cta-consent',
      'button.osano-cm-accept-all',
      '#truste-consent-button',
      'button[data-testid="uc-accept-all-button"]',
      '.sp_choice_type_11',
      'button.sp_choice_type_ACCEPT_ALL',
      'button[title="Accept all" i]','button[title="Aceitar tudo" i]','button[title="Aceitar todos" i]',
      'button[aria-label="Accept all" i]','button[aria-label="Aceitar tudo" i]','button[aria-label="Aceitar todos" i]',
      'button[aria-label="Aceitar" i]','button[aria-label="Concordo" i]',
    ];
    for (const sel of KNOWN) {
      let el = null; try { el = document.querySelector(sel); } catch(e){}
      if (el && vis(el)) return fire(el, 'consent:' + sel);
    }
    // 2) heurística por texto, SÓ dentro de um container de cookie/consent
    const ACCEPT = /\\b(aceitar(?:\\s+(?:todos|tudo))?|aceito|concordo|accept(?:\\s+all)?|i\\s+agree|allow\\s+all|got\\s+it|entendi|continuar(?:\\s+e\\s+fechar)?|prosseguir|ok)\\b/i;
    // BAD inclui termos de LOGIN/social — o porteiro NUNCA deve clicar "Continuar com Google",
    // "Entrar com", "Sign in", "Criar conta" etc. (isso inicia login, não dispensa cookie).
    const BAD = /\\b(excluir|apagar|delete|remover|remove|sair|logout|cancelar|unsubscribe|descadastrar|reject|recusar|rejeitar|configurar|gerenciar|settings|manage|prefer|personaliz|com\\s+google|com\\s+facebook|com\\s+apple|com\\s+microsoft|continuar\\s+com|entrar\\s+com|fazer\\s+login|sign\\s*in|log\\s*in|continue\\s+with|criar\\s+conta|sign\\s*up|inscrever)\\b/i;
    const CTX = '[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="gdpr" i],[class*="gdpr" i],[id*="lgpd" i],[class*="lgpd" i],[id*="privacy" i],[class*="privacy" i],[id*="cmp" i],[class*="cmp" i],[aria-modal="true"],[role="dialog"]';
    const btns = Array.from(document.querySelectorAll('button, a[role="button"], [role="button"], input[type="button"], input[type="submit"], a[href="#"]'));
    for (const b of btns) {
      if (!vis(b)) continue;
      const label = (b.innerText || b.textContent || b.value || b.getAttribute('aria-label') || '').replace(/\\s+/g,' ').trim();
      if (!label || label.length > 45) continue;
      if (!ACCEPT.test(label) || BAD.test(label)) continue;
      let inCtx = false; try { inCtx = !!b.closest(CTX); } catch(e){}
      if (!inCtx) continue;
      return fire(b, 'texto:' + label.slice(0,45));
    }
    return '';
  } catch(e){ return ''; }
})()
`;
