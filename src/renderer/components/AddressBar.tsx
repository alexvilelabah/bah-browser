import React, { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { t } from '../i18n';
import { permKindLabel, hostOf } from './PermissionPrompt';
import SiteIcon from './SiteIcon';
import { getSearchEngine, searchEngineName } from '../search-engine';
import IncognitoIcon from './IncognitoIcon';

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
  incognito?: boolean;   // a aba ativa é anônima: selo "Anônima", cadeado sem respostas guardadas
}

export default function AddressBar({
  url, isLoading, canGoBack, canGoForward,
  onNavigate, onBack, onForward, onReload,
  isBookmarked, onToggleBookmark, getSuggestions, incognito,
}: Props) {
  const [input, setInput] = useState(url);
  const [sugg, setSugg] = useState<Array<{ url: string; title: string; display: string; prefix: boolean; search?: boolean }>>([]);
  const [showSugg, setShowSugg] = useState(false);
  const [hi, setHi] = useState(-1);   // item destacado (-1 = usa o texto digitado)
  const inputRef = useRef<HTMLInputElement>(null);
  const lastKeyRef = useRef('');      // pra NÃO autocompletar quando o usuário está apagando
  const selRef = useRef<{ s: number; e: number } | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);   // debounce das sugestões do mecanismo
  const queryRef = useRef('');                                          // query atual (descarta resposta velha)
  const localRef = useRef<Array<{ url: string; title: string; display: string; prefix: boolean; search?: boolean }>>([]);
  const focusSelectRef = useRef(false);   // 1º clique na barra seleciona TUDO (estilo Chrome)
  const preconnectRef = useRef<Map<string, number>>(new Map());   // host → ts (dedupe 60s)

  // Preconnect preditivo: quando o inline-complete crava um site conhecido, já abre o
  // socket (DNS+TLS) ANTES do Enter — a navegação encontra a conexão pronta (estilo Chrome).
  const maybePreconnect = (rawUrl: string) => {
    try {
      const u = /^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl;
      const host = new URL(u).host;
      if (!host) return;
      const last = preconnectRef.current.get(host) || 0;
      if (Date.now() - last < 60000) return;
      preconnectRef.current.set(host, Date.now());
      (window as any).electronAPI?.preconnect?.(u, !!incognito);   // anônima: socket na sessão anônima
    } catch {}
  };

  useEffect(() => {
    // NÃO sobrescreve o que a pessoa está digitando: só sincroniza a URL quando a barra
    // não está em foco (evita a URL "voltar" se a página atualizar enquanto você edita).
    if (document.activeElement === inputRef.current) return;
    setInput(url); setShowSugg(false);
  }, [url]);

  // Depois que o input re-renderiza com o texto completado, seleciona o sufixo (estilo Chrome).
  useEffect(() => {
    if (selRef.current && inputRef.current) {
      const { s, e } = selRef.current; selRef.current = null;
      try { inputRef.current.setSelectionRange(s, e); } catch {}
    }
  }, [input]);

  // Sugestões do mecanismo de pesquisa escolhido (estilo Chrome): fetch no main (sem CORS),
  // com debounce, e mescla com as locais. Pula quando o texto parece um domínio sendo
  // digitado (deixa pro inline local). Personalizado não tem sugestões da web.
  const fetchWebSuggest = (val: string) => {
    if (debRef.current) clearTimeout(debRef.current);
    const domainLike = !val.includes(' ') && /\.[a-z]{2,}/i.test(val);
    if (!val.trim() || domainLike || /^https?:\/\//i.test(val)) return;
    debRef.current = setTimeout(async () => {
      try {
        const web: string[] = (await (window as any).electronAPI?.suggest?.(val, getSearchEngine())) || [];
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
      maybePreconnect(top.url);   // Enter provável → socket já aberto
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

  // Clique no cadeado: as permissões que ESTE site tem guardadas (câmera, microfone…) e
  // "Redefinir" — pra desfazer um "Bloquear"/"Permitir" dado sem querer.
  const [siteInfo, setSiteInfo] = useState<null | { origin: string; perms: Record<string, 'allow' | 'block'> }>(null);
  const siteInfoRef = useRef<HTMLDivElement>(null);
  const urlOrigin = (() => { try { return new URL(url).origin; } catch { return ''; } })();
  useEffect(() => { setSiteInfo(null); }, [urlOrigin]);   // outro site → fecha (mudar só o #/caminho não)
  useEffect(() => {
    if (!siteInfo) return;
    const close = (e: MouseEvent) => { if (!siteInfoRef.current?.contains(e.target as Node)) setSiteInfo(null); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setSiteInfo(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [siteInfo]);
  const toggleSiteInfo = async () => {
    if (siteInfo) { setSiteInfo(null); return; }
    // Aba anônima: nada deste site é guardado (nem lido do perfil pra mudar aqui) — o painel só
    // explica. Mudar uma escolha aqui gravaria o site no arquivo de permissões.
    if (incognito) { setSiteInfo({ origin: urlOrigin, perms: {} }); return; }
    const r = await window.electronAPI?.listSitePermissions?.(url);
    setSiteInfo(r && r.origin ? r : { origin: '', perms: {} });
  };
  const resetSitePerms = async () => {
    await window.electronAPI?.resetSitePermissions?.(url);
    setSiteInfo(s => (s ? { ...s, perms: {} } : s));
  };
  const setSitePerm = async (kind: string, value: 'allow' | 'block' | null) => {
    const r = await window.electronAPI?.setSitePermission?.(url, kind, value);
    if (r?.ok) setSiteInfo(s => (s ? { ...s, perms: r.perms || {} } : s));
  };
  // As 4 de sempre aparecem mesmo sem resposta guardada (pra dar pra liberar a localização
  // do Maps, por exemplo); as outras só quando o site já pediu.
  const siteKinds = siteInfo
    ? Array.from(new Set(['camera', 'microphone', 'geolocation', 'notifications', ...Object.keys(siteInfo.perms)]))
    : [];

  return (
    <div className="address-bar">
      {/* Ícones cheios de 20px, como os do Chrome (Material Icons) — os de linha fina de 16px
          quase sumiam. O "avançar" só aparece quando dá pra avançar, igual ao Chrome. */}
      <div className="nav-buttons">
        <button onClick={onBack} disabled={!canGoBack} title={t('addr.back')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
        </button>
        {canGoForward && (
          <button onClick={onForward} title={t('addr.forward')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
          </button>
        )}
        <button onClick={onReload} title={t('addr.reload')}>
          {isLoading ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
          )}
        </button>
      </div>

      <div className={`url-input-wrapper${sec ? ' has-sec' : ''}${incognito ? ' incognito' : ''}`}>
        {sec && (
          <button type="button" className={`url-sec ${sec}`} title={sec === 'secure' ? t('addr.secure') : t('addr.insecure')}
            aria-haspopup="dialog" aria-expanded={!!siteInfo}
            onMouseDown={e => e.stopPropagation()} onClick={toggleSiteInfo}>
            {sec === 'secure'
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12.01" y2="8"/><line x1="12" y1="12" x2="12" y2="16"/></svg>}
          </button>
        )}
        {/* Clique na página (a aba não avisa o documento do Bah) também fecha o painel. */}
        {siteInfo && <div className="site-info-scrim" onMouseDown={() => setSiteInfo(null)} />}
        {siteInfo && (
          <div className="site-info" ref={siteInfoRef} role="dialog" aria-label={t('perm.siteTitle')}>
            <div className="site-info-host">{siteInfo.origin ? hostOf(siteInfo.origin) : url}</div>
            <div className="site-info-sec">{sec === 'secure' ? t('addr.secure') : t('addr.insecure')}</div>
            <div className="site-info-title">{t('perm.siteTitle')}</div>
            {incognito && <div className="site-info-incog">{t('perm.incognitoSite')}</div>}
            {siteInfo.origin && !incognito && (
              <>
                <ul className="site-info-list">
                  {siteKinds.map(k => {
                    const v = siteInfo.perms[k];
                    return (
                      <li key={k}>
                        <span>{permKindLabel(k)}</span>
                        <select className={`site-info-state ${v || 'ask'}`} value={v || 'ask'}
                          onChange={e => setSitePerm(k, e.target.value === 'ask' ? null : e.target.value as 'allow' | 'block')}>
                          <option value="ask">{t('perm.askOpt')}</option>
                          <option value="allow">{t('perm.allow')}</option>
                          <option value="block">{t('perm.block')}</option>
                        </select>
                      </li>
                    );
                  })}
                </ul>
                {Object.keys(siteInfo.perms).length > 0 && (
                  <button type="button" className="site-info-reset" onClick={resetSitePerms}>{t('perm.reset')}</button>
                )}
              </>
            )}
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          className="url-input"
          value={input}
          onChange={e => onType(e.target.value)}
          onKeyDown={handleKeyDown}
          onMouseDown={() => { focusSelectRef.current = document.activeElement !== inputRef.current; }}
          onFocus={e => e.target.select()}
          onMouseUp={e => { if (focusSelectRef.current) { e.preventDefault(); focusSelectRef.current = false; } }}
          onBlur={() => setTimeout(() => setShowSugg(false), 150)}
          placeholder={t('addr.placeholder', { engine: searchEngineName() })}
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
        {/* Selo da aba anônima, à direita dentro da barra (como o "Anônima" do Chrome). */}
        {incognito && (
          <span className="incog-pill" title={t('incog.pillTitle')}>
            <IncognitoIcon size={15} />
            <span>{t('incog.pill')}</span>
          </span>
        )}
        {showSugg && (
          <ul className="omni-suggest">
            {sugg.map((s, i) => (
              <li
                key={(s.search ? 's:' : 'u:') + s.url}
                className={`omni-item${i === hi ? ' on' : ''}${s.search ? ' search' : ''}`}
                onMouseDown={e => { e.preventDefault(); go(s.url); }}
                onMouseEnter={() => setHi(i)}
              >
                {s.search ? <span className="omni-ico" aria-hidden="true">🔍</span> : <SiteIcon url={s.url} title={s.title} peek />}
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
