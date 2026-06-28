import React, { useState, useEffect, useRef, KeyboardEvent } from 'react';
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
  getSuggestions?: (q: string) => Array<{ url: string; title: string; display: string; prefix: boolean }>;
}

export default function AddressBar({
  url, isLoading, canGoBack, canGoForward,
  onNavigate, onBack, onForward, onReload,
  isBookmarked, onToggleBookmark, getSuggestions,
}: Props) {
  const [input, setInput] = useState(url);
  const [sugg, setSugg] = useState<Array<{ url: string; title: string; display: string; prefix: boolean; search?: boolean }>>([]);
  const [showSugg, setShowSugg] = useState(false);
  const [hi, setHi] = useState(-1);   // item destacado (-1 = usa o texto digitado)
  const inputRef = useRef<HTMLInputElement>(null);
  const lastKeyRef = useRef('');      // pra NÃO autocompletar quando o usuário está apagando
  const selRef = useRef<{ s: number; e: number } | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);   // debounce do Google Suggest
  const queryRef = useRef('');                                          // query atual (descarta resposta velha)
  const localRef = useRef<Array<{ url: string; title: string; display: string; prefix: boolean; search?: boolean }>>([]);

  useEffect(() => { setInput(url); setShowSugg(false); }, [url]);

  // Depois que o input re-renderiza com o texto completado, seleciona o sufixo (estilo Chrome).
  useEffect(() => {
    if (selRef.current && inputRef.current) {
      const { s, e } = selRef.current; selRef.current = null;
      try { inputRef.current.setSelectionRange(s, e); } catch {}
    }
  }, [input]);

  // Sugestões do Google (estilo Chrome): fetch no main (sem CORS), com debounce, e mescla
  // com as locais. Pula quando o texto parece um domínio sendo digitado (deixa pro inline local).
  const fetchWebSuggest = (val: string) => {
    if (debRef.current) clearTimeout(debRef.current);
    const domainLike = !val.includes(' ') && /\.[a-z]{2,}/i.test(val);
    if (!val.trim() || domainLike || /^https?:\/\//i.test(val)) return;
    debRef.current = setTimeout(async () => {
      try {
        const web: string[] = (await (window as any).electronAPI?.suggest?.(val)) || [];
        if (queryRef.current !== val || !web.length) return;   // resposta velha ou vazia
        const seen = new Set(localRef.current.map(s => (s.display || s.title).toLowerCase()));
        const items = web
          .filter(s => s && s.toLowerCase() !== val.toLowerCase() && !seen.has(s.toLowerCase()))
          .map(s => ({ url: s, title: s, display: '', prefix: false, search: true }));
        if (!items.length) return;
        setSugg([...localRef.current, ...items].slice(0, 8));
        setShowSugg(true);
      } catch {}
    }, 120);
  };

  const onType = (val: string) => {
    const deleting = lastKeyRef.current === 'Backspace' || lastKeyRef.current === 'Delete' || val.length < input.length;
    const list = (val.trim() && getSuggestions) ? getSuggestions(val) : [];
    const top = list[0];
    queryRef.current = val; localRef.current = list;
    // Autocomplete inline: topo é match de prefixo e seu display começa com o que foi digitado
    // → completa o resto (ex.: "youtube.co" → "youtube.com") com o sufixo selecionado. Só ao
    // DIGITAR (nunca apagando), e o Enter passa a ir pro site completo, não pro typo.
    if (!deleting && top && top.prefix && top.display.toLowerCase().startsWith(val.toLowerCase()) && top.display.length > val.length) {
      const completed = val + top.display.slice(val.length);
      setInput(completed);
      selRef.current = { s: val.length, e: completed.length };
      setSugg(list); setShowSugg(list.length > 0); setHi(0);
    } else {
      setInput(val);
      setSugg(list); setShowSugg(list.length > 0); setHi(!deleting && top && top.prefix ? 0 : -1);
    }
    fetchWebSuggest(val);
  };
  const go = (target: string) => { setShowSugg(false); onNavigate(target); };

  const handleKeyDown = (e: KeyboardEvent) => {
    lastKeyRef.current = e.key;
    if (showSugg && e.key === 'ArrowDown') { e.preventDefault(); setHi(i => Math.min(i + 1, sugg.length - 1)); return; }
    if (showSugg && e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(i - 1, -1)); return; }
    if (e.key === 'Escape') { setShowSugg(false); return; }
    if (e.key === 'Enter') { go(hi >= 0 && sugg[hi] ? sugg[hi].url : input); }
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
          ref={inputRef}
          type="text"
          className="url-input"
          value={input}
          onChange={e => onType(e.target.value)}
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
                key={(s.search ? 's:' : 'u:') + s.url}
                className={`omni-item${i === hi ? ' on' : ''}${s.search ? ' search' : ''}`}
                onMouseDown={e => { e.preventDefault(); go(s.url); }}
                onMouseEnter={() => setHi(i)}
              >
                {s.search && <span className="omni-ico" aria-hidden="true">🔍</span>}
                <span className="omni-title">{s.title}</span>
                {s.display && s.display !== s.title && <span className="omni-url">{s.display}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
