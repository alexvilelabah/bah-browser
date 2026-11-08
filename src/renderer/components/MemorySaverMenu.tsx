import { useState } from 'react';
import { t } from '../i18n';
import {
  MEM_SAVER_LEVELS, keepEntryForUrl, normalizeKeepEntry, MAX_KEEP_SITES, type MemSaverLevel,
} from '../../shared/memory-saver';

// ⋮ → "💤 Economia de memória ▸": liga/desliga, o nível (Moderada / Equilibrada / Máxima) e a lista
// "Manter estes sites sempre ativos" — as mesmas três coisas da página de Desempenho do Chrome.
// As regras (tempos, o que nunca dorme, como a lista casa) ficam em shared/memory-saver.ts.
const LEVEL_ICON: Record<MemSaverLevel, string> = { moderate: '🌙', balanced: '⚖️', maximum: '🚀' };

interface Props {
  on: boolean;
  onToggle: () => void;
  level: MemSaverLevel;
  onLevel: (l: MemSaverLevel) => void;
  keep: string[];
  onKeep: (list: string[]) => void;
  currentUrl: string;   // aba ativa: "Adicionar este site"
}

export default function MemorySaverMenu({ on, onToggle, level, onLevel, keep, onKeep, currentUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState(false);
  const here = keepEntryForUrl(currentUrl);
  const add = (entry: string | null) => {
    if (!entry) { setErr(true); return; }
    setErr(false);
    if (!keep.includes(entry) && keep.length < MAX_KEEP_SITES) onKeep([...keep, entry]);
  };

  return (
    <>
      <button className="menu-item" onClick={() => setOpen(o => !o)} title={t('menu.memSaverTitle')} aria-expanded={open} data-testid="menu-memsaver">
        <span className="menu-ic">💤</span>
        <span className="menu-label">{t('menu.memSaver')}</span>
        <span className={`menu-switch ${on ? 'on' : ''}`}>{on ? 'ON' : 'OFF'}</span>
        <span className="menu-chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="menu-sub" data-testid="memsaver-panel">
          <button className="menu-item" role="switch" aria-checked={on} onClick={onToggle} data-testid="memsaver-toggle">
            <span className="menu-ic">⏻</span>
            <span className="menu-label">{t('memsaver.enabled')}</span>
            <span className={`menu-switch ${on ? 'on' : ''}`}>{on ? 'ON' : 'OFF'}</span>
          </button>
          <div className="menu-empty">{t('memsaver.level')}</div>
          <div role="radiogroup" aria-label={t('memsaver.level')} className="menu-sub-group">
            {MEM_SAVER_LEVELS.map(l => (
              <button key={l} className="menu-item" role="radio" aria-checked={level === l} disabled={!on}
                title={t(`memsaver.${l}Title`)} onClick={() => onLevel(l)} data-testid={`memsaver-level-${l}`}>
                <span className="menu-ic">{LEVEL_ICON[l]}</span>
                <span className="menu-label">{t(`memsaver.${l}`)}</span>
                {level === l && <span className="menu-check" aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
          <div className="menu-empty">{t('memsaver.never')}</div>
          <div className="menu-empty memsaver-keep-title">{t('memsaver.keepTitle')}</div>
          {here && !keep.includes(here) && (
            <button className="menu-item" onClick={() => add(here)} data-testid="memsaver-keep-current">
              <span className="menu-ic">➕</span>
              <span className="menu-label">{t('memsaver.keepAddCurrent', { site: here })}</span>
            </button>
          )}
          <ul className="memsaver-keep-list" data-testid="memsaver-keep-list">
            {keep.length === 0 && <li className="menu-empty">{t('memsaver.keepEmpty')}</li>}
            {keep.map(e => (
              <li key={e} className="memsaver-keep-row">
                <span className="memsaver-keep-site" title={e}>{e}</span>
                <button className="memsaver-keep-del" aria-label={t('memsaver.keepRemove', { site: e })} title={t('memsaver.keepRemove', { site: e })}
                  onClick={() => onKeep(keep.filter(x => x !== e))}>✕</button>
              </li>
            ))}
          </ul>
          <form className="menu-custom" onSubmit={ev => { ev.preventDefault(); const n = normalizeKeepEntry(draft); add(n); if (n) setDraft(''); }}>
            <input className="mon-input" type="text" value={draft} spellCheck={false} autoComplete="off" data-testid="memsaver-keep-input"
              placeholder={t('memsaver.keepPlaceholder')} aria-label={t('memsaver.keepTitle')} aria-invalid={err}
              onChange={e => { setDraft(e.target.value); if (err) setErr(false); }} />
            <div className={`menu-empty${err ? ' menu-err' : ''}`} role={err ? 'alert' : undefined}>
              {err ? t('memsaver.keepInvalid') : t('memsaver.keepHint')}
            </div>
            <button type="submit" className="mon-add-btn" data-testid="memsaver-keep-add">{t('memsaver.keepAdd')}</button>
          </form>
        </div>
      )}
    </>
  );
}
