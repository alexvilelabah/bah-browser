// Barra de favoritos (faixa abaixo da barra de endereço), igual à do Chrome:
//  • cada favorito = ícone 16px + nome numa linha só (sem nome = só o ícone);
//  • o que não cabe vai pro botão "»" no fim da barra, que abre a lista do resto;
//  • clique abre na aba atual; Ctrl+clique / botão do meio = aba nova; botão direito = menu.
// Quanto cabe: uma cópia invisível dos favoritos mede a largura de cada um, e a conta
// (splitOverflow) diz quantos entram. Refaz quando a janela muda de tamanho, quando a lista
// muda e quando a fonte termina de carregar (a cópia invisível muda de largura).
// Nada é desenhado fora da janela: a barra corta (overflow hidden) e a lista/menu ficam presos
// dentro da tela.
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { t } from '../i18n';
import SiteIcon from './SiteIcon';
import { splitOverflow } from '../../shared/favicons';
import type { FlatBookmark } from '../../shared/bookmarks';

interface Props {
  items: FlatBookmark[];
  onOpen: (url: string, newTab: boolean) => void;
  onRemove: (url: string) => void;
  lang?: string;   // só pra redesenhar os textos quando o idioma muda (o componente é memo)
}

const tip = (f: FlatBookmark) => (f.title ? `${f.title}\n${f.url}` : f.url);

function ChipBody({ f }: { f: FlatBookmark }) {
  return (
    <>
      <SiteIcon url={f.url} title={f.title} />
      {f.title && <span className="bm-title">{f.title}</span>}
    </>
  );
}

function BookmarksBar({ items, onOpen, onRemove }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(items.length);
  const [more, setMore] = useState<{ top: number; right: number } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; url: string } | null>(null);

  const recompute = useCallback(() => {
    const bar = barRef.current, m = measureRef.current;
    if (!bar || !m) return;
    const cs = getComputedStyle(bar);
    // getBoundingClientRect (fração de pixel), não clientWidth (arredonda — podia sobrar meio pixel pra fora).
    const avail = bar.getBoundingClientRect().width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
      - (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0);
    const gap = parseFloat(cs.columnGap) || 0;
    const kids = Array.from(m.children) as HTMLElement[];
    const moreEl = kids.pop();   // a última cópia é o botão "»"
    const n = splitOverflow(kids.map(k => k.getBoundingClientRect().width), avail, moreEl?.getBoundingClientRect().width ?? 28, gap);
    setFit(prev => (prev === n ? prev : n));
  }, []);

  // Antes de pintar: a barra nunca aparece com favorito vazando pra fora.
  useLayoutEffect(() => { recompute(); }, [items, recompute]);
  useEffect(() => {
    // Só observa a barra (largura da janela) e a cópia invisível (fonte carregou) — nenhuma das
    // duas muda de tamanho por causa do "fit", então não tem como entrar em laço.
    const ro = new ResizeObserver(() => recompute());
    if (barRef.current) ro.observe(barRef.current);
    if (measureRef.current) ro.observe(measureRef.current);
    return () => ro.disconnect();
  }, [recompute]);

  const visible = items.slice(0, fit);
  const hidden = items.slice(fit);
  const anyOpen = !!more || !!ctx;
  const closeAll = useCallback(() => { setMore(null); setCtx(null); }, []);

  // Tudo voltou a caber → a lista do "»" não tem mais o que mostrar.
  useEffect(() => { if (!hidden.length) setMore(null); }, [hidden.length]);

  // Esc, janela mudando de tamanho ou perdendo o foco fecham (igual aos menus do Chrome).
  useEffect(() => {
    if (!anyOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); closeAll(); } };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', closeAll);
    window.addEventListener('blur', closeAll);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', closeAll);
      window.removeEventListener('blur', closeAll);
    };
  }, [anyOpen, closeAll]);

  // Menu do botão direito: abre no ponteiro, mas empurrado pra dentro se for passar da borda.
  useLayoutEffect(() => {
    const el = ctxRef.current;
    if (!ctx || !el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(8, Math.min(ctx.x, window.innerWidth - r.width - 8));
    const y = Math.max(8, Math.min(ctx.y, window.innerHeight - r.height - 8));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [ctx]);

  const toggleMore = () => {
    if (more) { setMore(null); return; }
    const r = moreRef.current?.getBoundingClientRect();
    if (!r) return;
    setCtx(null);
    setMore({ top: Math.round(r.bottom + 4), right: Math.max(8, Math.round(window.innerWidth - r.right)) });
  };

  const open = (url: string, newTab: boolean) => { closeAll(); onOpen(url, newTab); };
  const chipHandlers = (f: FlatBookmark) => ({
    onClick: (e: MouseEvent) => open(f.url, e.ctrlKey || e.metaKey || e.shiftKey),
    // Botão do meio = aba nova (e sem a rolagem automática do Windows).
    onMouseDown: (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); },
    onAuxClick: (e: MouseEvent) => { if (e.button === 1) { e.preventDefault(); open(f.url, true); } },
    onContextMenu: (e: MouseEvent) => { e.preventDefault(); setMore(null); setCtx({ x: e.clientX, y: e.clientY, url: f.url }); },
  });

  return (
    <div className="bookmarks-bar" ref={barRef}>
      {visible.map(f => (
        <button key={f.url} className={`bookmark-chip${f.title ? '' : ' icon-only'}`} title={tip(f)} {...chipHandlers(f)}>
          <ChipBody f={f} />
        </button>
      ))}
      {hidden.length > 0 && (
        <button
          ref={moreRef}
          className={`bm-more${more ? ' on' : ''}`}
          onClick={toggleMore}
          title={t('bmbar.more')}
          aria-haspopup="menu"
          aria-expanded={!!more}
        >»</button>
      )}

      {/* Cópia invisível pra medir (mesmas classes; o ícone tem tamanho fixo, então mede igual). */}
      <div className="bm-measure" ref={measureRef} aria-hidden="true">
        {items.map(f => (
          <button key={f.url} tabIndex={-1} className={`bookmark-chip${f.title ? '' : ' icon-only'}`}>
            <span className="site-ic" />
            {f.title && <span className="bm-title">{f.title}</span>}
          </button>
        ))}
        <button tabIndex={-1} className="bm-more">»</button>
      </div>

      {anyOpen && <div className="menu-overlay" onMouseDown={closeAll} onContextMenu={e => { e.preventDefault(); closeAll(); }} />}

      {more && (
        <div className="bm-pop bm-overflow" role="menu" style={{ top: more.top, right: more.right, maxHeight: `min(70vh, calc(100vh - ${more.top + 12}px))` }}>
          {hidden.map(f => (
            <button key={f.url} className="bm-pop-item" role="menuitem" title={f.url} {...chipHandlers(f)}>
              <SiteIcon url={f.url} title={f.title} />
              <span className="bm-pop-label">{f.title || f.url}</span>
            </button>
          ))}
        </div>
      )}

      {ctx && (
        <div className="bm-pop bm-ctx" role="menu" ref={ctxRef} style={{ left: ctx.x, top: ctx.y }}>
          <button className="bm-pop-item" role="menuitem" onClick={() => open(ctx.url, true)}>
            <span className="bm-pop-label">{t('bmbar.openNewTab')}</span>
          </button>
          <div className="menu-sep" />
          <button className="bm-pop-item" role="menuitem" onClick={() => { const u = ctx.url; closeAll(); onRemove(u); }}>
            <span className="bm-pop-label">{t('fav.remove')}</span>
          </button>
        </div>
      )}
    </div>
  );
}

// memo: o App redesenha o tempo todo (IA, downloads…); a barra só quando a lista muda.
export default memo(BookmarksBar);
