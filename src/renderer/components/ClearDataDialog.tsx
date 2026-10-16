import React, { useEffect, useState } from 'react';
import { t } from '../i18n';
import { TIME_RANGES, isTimeRange, type TimeRange } from '../../shared/clear-data';

// "Limpar dados de navegação" (menu ⋮ / Ctrl+Shift+Delete), no molde do diálogo do Chrome:
// período + caixas. Quem apaga é o App (histórico/downloads são dele) e o main (cookies/cache).
// O período e as caixas ficam lembrados pra próxima vez, como no Chrome.

export type ClearChoice = { range: TimeRange; history: boolean; cookies: boolean; cache: boolean; downloads: boolean };

const PREF_KEY = 'clearData.v1';
// Padrão do Chrome: histórico + cookies + cache marcados; downloads não.
const DEFAULTS: ClearChoice = { range: 'hour', history: true, cookies: true, cache: true, downloads: false };

function loadChoice(): ClearChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return DEFAULTS;
    const b = (k: keyof ClearChoice) => (typeof raw[k] === 'boolean' ? raw[k] : DEFAULTS[k]) as boolean;
    return { range: isTimeRange(raw.range) ? raw.range : DEFAULTS.range, history: b('history'), cookies: b('cookies'), cache: b('cache'), downloads: b('downloads') };
  } catch { return DEFAULTS; }
}

export default function ClearDataDialog(props: {
  onClose: () => void;
  /** Quantos sites foram abertos no período (pelo histórico) — é deles que sai cookie/cache fora do "Todo o período". */
  sitesInRange: (range: TimeRange) => number;
  onClear: (choice: ClearChoice) => Promise<boolean>;
}) {
  const [choice, setChoice] = useState<ClearChoice>(loadChoice);
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const set = (patch: Partial<ClearChoice>) => { setChoice(c => ({ ...c, ...patch })); if (phase === 'error') setPhase('idle'); };
  const { onClose } = props;

  // Esc fecha (menos no meio da limpeza: a pessoa precisa ver que terminou).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && phase !== 'busy') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);
  // "Dados apagados" fica um instante e o diálogo some sozinho (não recarrega nada).
  useEffect(() => {
    if (phase !== 'done') return;
    const tm = setTimeout(onClose, 1800);
    return () => clearTimeout(tm);
  }, [phase, onClose]);

  const all = choice.range === 'all';
  const sites = all ? 0 : props.sitesInRange(choice.range);
  const scoped = sites === 0 ? t('cbd.noSites') : sites === 1 ? t('cbd.sitesOne') : t('cbd.sites', { n: sites.toLocaleString() });
  const nothing = !choice.history && !choice.cookies && !choice.cache && !choice.downloads;

  const submit = async () => {
    if (nothing || phase === 'busy') return;
    try { localStorage.setItem(PREF_KEY, JSON.stringify(choice)); } catch {}
    setPhase('busy');
    let ok = false;
    try { ok = await props.onClear(choice); } catch { ok = false; }
    setPhase(ok ? 'done' : 'error');
  };

  const box = (key: 'history' | 'cookies' | 'cache' | 'downloads', label: string, hint: string) => (
    <label className="dl-set-switch">
      <input type="checkbox" checked={choice[key]} disabled={phase === 'busy'} onChange={e => set({ [key]: e.target.checked })} />
      <span className="dl-set-txt">{label}<small>{hint}</small></span>
    </label>
  );

  return (
    <div className="history-overlay" onClick={() => { if (phase !== 'busy') onClose(); }}>
      <div className="history-panel cbd-panel" role="dialog" aria-label={t('cbd.title')} onClick={e => e.stopPropagation()}>
        <div className="history-head">
          <span>🧹 {t('cbd.title')}</span>
          <button className="history-close" onClick={onClose} disabled={phase === 'busy'} title={t('assist.close')}>✕</button>
        </div>
        {phase === 'done' ? (
          <div className="cbd-done">✓ {t('cbd.done')}</div>
        ) : (
          <div className="cbd-body">
            <label className="dl-set-row">
              <span>{t('cbd.range')}</span>
              <select className="cbd-range" value={choice.range} disabled={phase === 'busy'} onChange={e => set({ range: e.target.value as TimeRange })}>
                {TIME_RANGES.map(r => <option key={r} value={r}>{t(`cbd.range.${r}`)}</option>)}
              </select>
            </label>
            {box('history', t('cbd.history'), t('cbd.historyHint'))}
            {box('cookies', t('cbd.cookies'), all ? t('cbd.cookiesHintAll') : sites === 0 ? scoped : `${scoped} ${t('cbd.cookiesHintSites')}`)}
            {box('cache', t('cbd.cache'), all ? t('cbd.cacheHintAll') : scoped)}
            {box('downloads', t('cbd.downloads'), t('cbd.downloadsHint'))}
            {!all && (choice.cookies || choice.cache) && <small className="cbd-note">{t('cbd.rangeNote')}</small>}
            <small className="cbd-note">{t('cbd.keeps')}</small>
            {phase === 'error' && <div className="cbd-error">{t('cbd.error')}</div>}
            <div className="cbd-actions">
              <button className="cbd-cancel" onClick={onClose} disabled={phase === 'busy'}>{t('cbd.cancel')}</button>
              <button className="cbd-go" onClick={submit} disabled={nothing || phase === 'busy'}>{phase === 'busy' ? t('cbd.busy') : t('cbd.clear')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
