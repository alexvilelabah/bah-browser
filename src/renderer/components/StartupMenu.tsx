import { useEffect, useState } from 'react';
import { t } from '../i18n';
import type { StartupMode } from '../../shared/session-restore';
import { getStartupMode, setStartupMode, onStartupModeChange } from '../session';

// ⋮ → "Ao abrir o Bah ▸": abre a lista logo abaixo (como "Mecanismo de pesquisa"). "Abrir uma
// aba nova" é o de sempre e o padrão (igual ao Chrome); "Continuar de onde parou" reabre as abas
// da última vez, e cada uma só carrega quando você clica nela. Vale na próxima vez que o Bah abrir.
const OPTIONS: ReadonlyArray<{ id: StartupMode; icon: string; label: string; title: string; short: string }> = [
  { id: 'newtab', icon: '➕', label: 'startup.newTab', title: 'startup.newTabTitle', short: 'startup.short.newTab' },
  { id: 'restore', icon: '📑', label: 'startup.restore', title: 'startup.restoreTitle', short: 'startup.short.restore' },
];

export default function StartupMenu() {
  const [, redraw] = useState(0);
  useEffect(() => onStartupModeChange(() => redraw(n => n + 1)), []);
  const [open, setOpen] = useState(false);
  const cur = getStartupMode();
  const chosen = OPTIONS.find(o => o.id === cur) || OPTIONS[0];

  return (
    <>
      <button className="menu-item" onClick={() => setOpen(o => !o)} title={t('startup.hint')} aria-expanded={open}>
        <span className="menu-ic">🔁</span>
        <span className="menu-label">{t('startup.menu')}</span>
        <span className="menu-kbd menu-engine">{t(chosen.short)}</span>
        <span className="menu-chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="menu-sub" role="radiogroup" aria-label={t('startup.menu')}>
          <div className="menu-empty">{t('startup.hint')}</div>
          {OPTIONS.map(o => {
            const on = cur === o.id;
            return (
              <button key={o.id} className="menu-item" role="radio" aria-checked={on} title={t(o.title)}
                onClick={() => setStartupMode(o.id)}>
                <span className="menu-ic">{o.icon}</span>
                <span className="menu-label">{t(o.label)}</span>
                {on && <span className="menu-check" aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
