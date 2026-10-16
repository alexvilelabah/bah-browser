// Lista de contas salvas em cima do campo de login (o "preencher" do Chrome). Desenhada pelo Bah, FORA
// da página: o site não lê nem clica nela. A posição vem do preload da aba (o retângulo do campo, já
// com o zoom da aba) e é convertida pra tela pelo retângulo do <webview>.
// Clique só vale depois de um instante (como o Chrome): a página não consegue pôr a lista embaixo do
// mouse da pessoa e colher um clique. Mousedown com preventDefault: o foco fica no campo da página.
import React from 'react';
import { t } from '../i18n';
import type { PwSuggest } from '../../shared/password-types';

const ARM_DELAY_MS = 500;
const ROW_H = 40;

export default function PasswordSuggest({ suggest, getWebview, onPick, onManage, onClose }: {
  suggest: PwSuggest;
  getWebview: () => HTMLElement | undefined;
  onPick: (entryId: string) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const [armed, setArmed] = React.useState(false);
  const [armSeq, setArmSeq] = React.useState(0);   // muda → recomeça a espera
  const downOn = React.useRef<string | null>(null);  // item onde o botão do mouse desceu (já armado)
  const boxRef = React.useRef<HTMLDivElement>(null);
  const r0 = suggest.rect;
  // Lista nova, lista que mudou de lugar ou clique cedo demais: espera tudo de novo. A página não
  // consegue pôr a lista embaixo do mouse e colher o clique que a pessoa já ia dar.
  React.useEffect(() => {
    setArmed(false);
    downOn.current = null;
    const tm = setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => clearTimeout(tm);
  }, [suggest.id, r0.x, r0.y, r0.w, r0.h, armSeq]);
  // Esc, clique em outro lugar da janela do Bah ou mudar o tamanho dela: fecha.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('resize', onClose);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown, true); window.removeEventListener('resize', onClose); };
  }, [onClose]);

  const wv = getWebview();
  const area = wv?.closest('.webview-area');
  if (!wv || !area) return null;
  const w = wv.getBoundingClientRect();
  const a = area.getBoundingClientRect();
  const r = suggest.rect;
  if (r.y + r.h < 0 || r.y > w.height || r.x > w.width || r.x + r.w < 0) return null;   // campo fora da vista
  const width = Math.round(Math.max(250, Math.min(380, r.w)));
  const rows = Math.min(suggest.accounts.length, 6);
  const height = 34 + rows * ROW_H + (suggest.insecure ? 46 : 0) + 38;
  const fieldTop = w.top - a.top + r.y;
  const below = fieldTop + r.h + 4;
  const top = below + height > a.height && fieldTop - height - 4 > 0 ? fieldTop - height - 4 : below;
  const left = Math.max(4, Math.min(w.left - a.left + r.x, a.width - width - 4));

  // Clique inteiro no MESMO item (desce e sobe nele), com a lista já armada. Mousedown com
  // preventDefault: o foco fica no campo da página.
  const down = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    if (e.button !== 0) return;
    if (!armed) { downOn.current = null; setArmSeq(n => n + 1); return; }
    downOn.current = id;
  };
  const up = (e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return;
    const ok = armed && downOn.current === id;
    downOn.current = null;
    if (ok) onPick(id);
  };
  return (
    <div ref={boxRef} className="pw-suggest" role="listbox" aria-label={t('pw.suggest.title', { site: suggest.host })}
      style={{ left, top, width }} onMouseDown={e => e.preventDefault()} onMouseLeave={() => { downOn.current = null; }}>
      <div className="pw-suggest-head">🔑 {t('pw.suggest.title', { site: suggest.host })}</div>
      {suggest.insecure && <div className="pw-suggest-warn">⚠️ {t('pw.suggest.insecure')}</div>}
      <div className="pw-suggest-list" style={{ maxHeight: rows * ROW_H }}>
        {suggest.accounts.map(acc => (
          <button key={acc.id} className={`pw-suggest-item${armed ? '' : ' waiting'}`} role="option" aria-selected={false}
            onMouseDown={e => down(e, acc.id)} onMouseUp={e => up(e, acc.id)}>
            <span className="pw-suggest-user">{acc.username || t('pw.offer.noUsername')}</span>
            <span className="pw-suggest-dots">••••••••</span>
          </button>
        ))}
      </div>
      <button className="pw-suggest-manage" onMouseDown={e => { e.preventDefault(); if (e.button === 0) onManage(); }}>{t('pw.suggest.manage')}</button>
    </div>
  );
}
