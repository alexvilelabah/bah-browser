import React, { useEffect, useState } from 'react';
import { t } from '../i18n';
import SiteIcon from './SiteIcon';
import { SEARCH_ENGINES, engineIconUrl, validateCustomTemplate, type CustomTemplateError } from '../../shared/search-engines';
import { getSearchEngine, setSearchEngine, searchEngineName, onSearchEngineChange } from '../search-engine';

// ⋮ → "Mecanismo de pesquisa ▸": abre a lista logo abaixo (como "Importar e exportar
// favoritos"). Um clique troca na hora — barra de endereço, sugestões, clique direito e as
// próximas abas novas; as abas já abertas ficam como estão. "Personalizado…" pede um endereço
// com %s (validado em shared/search-engines.ts).
export default function SearchEngineMenu() {
  const [, redraw] = useState(0);
  useEffect(() => onSearchEngineChange(() => redraw(n => n + 1)), []);
  const cur = getSearchEngine();
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState(cur.custom || '');
  const [err, setErr] = useState<CustomTemplateError | null>(null);

  const saveCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const v = validateCustomTemplate(draft);
    if (!v.ok) { setErr(v.error); return; }
    setErr(null);
    setDraft(v.template);
    setSearchEngine({ id: 'custom', custom: v.template });
  };

  return (
    <>
      <button className="menu-item" onClick={() => setOpen(o => !o)} title={t('search.hint')} aria-expanded={open}>
        <span className="menu-ic">🔍</span>
        <span className="menu-label">{t('search.menu')}</span>
        <span className="menu-kbd menu-engine">{searchEngineName()}</span>
        <span className="menu-chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="menu-sub" role="radiogroup" aria-label={t('search.hint')}>
          <div className="menu-empty">{t('search.hint')}</div>
          {SEARCH_ENGINES.map(e => {
            const on = cur.id === e.id;
            return (
              <button key={e.id} className="menu-item" role="radio" aria-checked={on}
                onClick={() => { setCustomOpen(false); setSearchEngine({ id: e.id, custom: cur.custom }); }}>
                <span className="menu-ic"><SiteIcon url={engineIconUrl({ id: e.id })} title={e.name} /></span>
                <span className="menu-label">{e.name}</span>
                {on && <span className="menu-check" aria-hidden="true">✓</span>}
              </button>
            );
          })}
          <button className="menu-item" role="radio" aria-checked={cur.id === 'custom'} aria-expanded={customOpen}
            onClick={() => { setErr(null); setCustomOpen(o => !o); }}>
            <span className="menu-ic">✏️</span>
            <span className="menu-label">{t('search.custom')}</span>
            {cur.id === 'custom' && <span className="menu-kbd menu-engine">{searchEngineName()}</span>}
            {cur.id === 'custom' && <span className="menu-check" aria-hidden="true">✓</span>}
          </button>
          {customOpen && (
            <form className="menu-custom" onSubmit={saveCustom}>
              <input className="mon-input" type="text" value={draft} autoFocus spellCheck={false} autoComplete="off"
                placeholder={t('search.customPlaceholder')} aria-label={t('search.custom')} aria-invalid={!!err}
                onChange={e => { setDraft(e.target.value); if (err) setErr(null); }} />
              <div className={`menu-empty${err ? ' menu-err' : ''}`} role={err ? 'alert' : undefined}>
                {err ? t(`search.err.${err}`) : t('search.customHint')}
              </div>
              <button type="submit" className="mon-add-btn">{t('search.customSave')}</button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
