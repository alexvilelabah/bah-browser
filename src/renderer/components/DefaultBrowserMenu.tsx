import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n';

// ⋮ → "Navegador padrão ▸": diz se o Bah é o navegador padrão do computador e, se não for, mostra
// "Tornar o Bah padrão". O Windows não deixa app nenhum se fazer padrão sozinho: o Bah se registra
// e abre as Configurações pra pessoa escolher (main/default-browser.ts); no Mac o sistema pergunta.
// Quando a janela volta a ter foco (voltou das Configurações), reconsulta. Nada aparece no boot.
type Status = { platform: 'win32' | 'darwin' | 'other'; packaged: boolean; isDefault: boolean };

export default function DefaultBrowserMenu() {
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; err?: boolean } | null>(null);

  const refresh = useCallback(() => {
    window.electronAPI?.defaultBrowserStatus?.()
      .then((s) => { setSt(s); if (s.isDefault) setNote(null); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  if (st?.platform === 'other') return null;   // Linux: sem registro de navegador padrão aqui
  const isDefault = !!st?.isDefault;
  const dev = !!st && !st.packaged;

  const make = async () => {
    if (busy || !st || dev) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await window.electronAPI?.defaultBrowserMake?.();
      if (!r) return;
      if (!r.ok) {
        if (r.error !== 'busy') setNote({ text: t(r.error === 'dev' ? 'defbrowser.devOnly' : 'defbrowser.error'), err: true });
      } else if (!r.alreadyDefault && st.platform === 'win32') {
        setNote({ text: t(r.openedSettings ? 'defbrowser.opened' : 'defbrowser.settingsFailed') });
      }
    } catch {
      setNote({ text: t('defbrowser.error'), err: true });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const hint = note?.text ?? (!st ? '' : dev ? t('defbrowser.devOnly') : t(st.platform === 'darwin' ? 'defbrowser.howMac' : 'defbrowser.howWin'));

  return (
    <>
      <button className="menu-item" onClick={() => setOpen(o => !o)} title={t('defbrowser.hint')} aria-expanded={open}>
        <span className="menu-ic">🌐</span>
        <span className="menu-label">{t('defbrowser.menu')}</span>
        {isDefault && <span className="menu-check" aria-hidden="true">✓</span>}
        <span className="menu-chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="menu-sub">
          <div className="menu-empty">{t('defbrowser.hint')}</div>
          {isDefault ? (
            <div className="menu-item menu-status" role="status">
              <span className="menu-ic">✓</span>
              <span className="menu-label connected">{t('defbrowser.isDefault')}</span>
            </div>
          ) : (
            <>
              <button className="menu-item" disabled={busy || !st || dev} onClick={() => { void make(); }}
                title={st?.platform === 'win32' ? t('defbrowser.whyNot') : undefined}>
                <span className="menu-ic">➜</span>
                <span className="menu-label">{busy ? t('defbrowser.working') : t('defbrowser.make')}</span>
              </button>
              {hint && <div className={`menu-empty${note?.err ? ' menu-err' : ''}`} role={note ? 'status' : undefined}>{hint}</div>}
            </>
          )}
        </div>
      )}
    </>
  );
}
