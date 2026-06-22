import React, { useState, useEffect, KeyboardEvent } from 'react';
import { t } from '../i18n';

interface Props {
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  getSuggestions?: (q: string) => Array<{ url: string; title: string }>;
}

export default function AddressBar({
  url, isLoading, canGoBack, canGoForward,
  onNavigate, onBack, onForward, onReload,
  isBookmarked, onToggleBookmark, getSuggestions,
}: Props) {
  const [input, setInput] = useState(url);
  const [sugg, setSugg] = useState<Array<{ url: string; title: string }>>([]);
  const [showSugg, setShowSugg] = useState(false);
  const [hi, setHi] = useState(-1);   // item destacado (-1 = usa o texto digitado)

  useEffect(() => { setInput(url); setShowSugg(false); }, [url]);

  const refreshSugg = (v: string) => {
    const list = (v.trim() && getSuggestions) ? getSuggestions(v) : [];
    setSugg(list); setShowSugg(list.length > 0); setHi(-1);
  };
  const go = (target: string) => { setShowSugg(false); onNavigate(target); };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (showSugg && e.key === 'ArrowDown') { e.preventDefault(); setHi(i => Math.min(i + 1, sugg.length - 1)); return; }
    if (showSugg && e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(i - 1, -1)); return; }
    if (e.key === 'Escape') { setShowSugg(false); return; }
    if (e.key === 'Enter') { go(showSugg && hi >= 0 ? sugg[hi].url : input); }
  };

  // Indicador de segurança (cadeado) — só pra páginas reais http/https; vazio na nova aba.
  const sec = /^https:\/\//i.test(url) ? 'secure' : /^http:\/\//i.test(url) ? 'insecure' : '';

  return (
    <div className="address-bar">
      <div className="nav-buttons">
        <button onClick={onBack} disabled={!canGoBack} title={t('addr.back')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <button onClick={onForward} disabled={!canGoForward} title={t('addr.forward')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
        <button onClick={onReload} title={t('addr.reload')}>
          {isLoading ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>
          )}
        </button>
      </div>

      <div className={`url-input-wrapper${sec ? ' has-sec' : ''}`}>
        {sec && (
          <span className={`url-sec ${sec}`} title={sec === 'secure' ? t('addr.secure') : t('addr.insecure')}>
            {sec === 'secure'
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12.01" y2="8"/><line x1="12" y1="12" x2="12" y2="16"/></svg>}
          </span>
        )}
        <input
          type="text"
          className="url-input"
          value={input}
          onChange={e => { setInput(e.target.value); refreshSugg(e.target.value); }}
          onKeyDown={handleKeyDown}
          onFocus={e => e.target.select()}
          onBlur={() => setTimeout(() => setShowSugg(false), 150)}
          placeholder={t('addr.placeholder')}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          className={`bookmark-star ${isBookmarked ? 'on' : ''}`}
          onClick={onToggleBookmark}
          title={isBookmarked ? t('addr.bookmark.remove') : t('addr.bookmark.add')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
        </button>
        {showSugg && (
          <ul className="omni-suggest">
            {sugg.map((s, i) => (
              <li
                key={s.url}
                className={`omni-item${i === hi ? ' on' : ''}`}
                onMouseDown={e => { e.preventDefault(); go(s.url); }}
                onMouseEnter={() => setHi(i)}
              >
                <span className="omni-title">{s.title}</span>
                <span className="omni-url">{s.url.replace(/^https?:\/\//, '')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
