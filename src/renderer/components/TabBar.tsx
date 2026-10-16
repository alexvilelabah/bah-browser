// Barra de abas, igual à do Chrome:
//  • apertar numa aba já a ativa; arrastar pro lado reordena (a aba segue o mouse, as vizinhas
//    deslizam pra abrir espaço; soltar grava a ordem). Até 5 px é clique. As fixadas ficam entre
//    si, à esquerda — o arrasto não cruza essa fronteira. Esc cancela. Com abas sobrando pros
//    lados, perto da borda a faixa rola sozinha.
//  • botão do meio fecha; botão direito abre o menu da aba (Nova aba à direita, Recarregar,
//    Duplicar, Fixar/Liberar, Desativar som do site, Fechar, Fechar outras, Fechar à direita,
//    Reabrir aba fechada) — mesmo visual do menu dos favoritos.
//  • aba fixada: só o ícone, sem ×.
//  • aba anônima: tom roxo e o chapéu com óculos no lugar do favicon (o ícone do site não é
//    buscado pela interface — ficaria no cache dela em disco).
// A conta da ordem/arrasto é pura (shared/tab-strip.ts). Reordenar só muda a lista: os <webview>
// não se mexem no DOM (WebViewContainer), então a página da aba não recarrega.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tab } from '../store';
import { t } from '../i18n';
import { closeOthersIds, closeRightIds, dragShift, dragTarget, siteKey, stripTabs } from '../../shared/tab-strip';
import { isIncognitoBlank } from '../../shared/incognito';
import IncognitoIcon from './IncognitoIcon';

// Itens do menu do botão direito (quem executa é o App: webview, som do site, store).
export type TabCommand =
  | 'new-right' | 'reload' | 'duplicate' | 'pin' | 'unpin' | 'mute' | 'unmute'
  | 'close' | 'close-others' | 'close-right' | 'reopen';

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onMove: (id: string, toIndex: number) => void;      // arrastou e soltou: posição nova entre as visíveis
  onCommand: (cmd: TabCommand, id: string) => void;   // item do menu do botão direito
  isMuted: (url: string, incognito?: boolean) => boolean;   // site com "Desativar som do site"
  canReopen: () => boolean;                           // tem aba fechada pro Ctrl+Shift+T?
}

const MAC = /Mac/i.test(typeof navigator !== 'undefined' ? navigator.platform || '' : '');
const KEY_RELOAD = MAC ? '⌘R' : 'Ctrl+R';
const KEY_CLOSE = MAC ? '⌘W' : 'Ctrl+W';
const KEY_REOPEN = MAC ? '⇧⌘T' : 'Ctrl+Shift+T';
const DRAG_START_PX = 5;   // até isso é clique (a mão treme); passou, vira arrasto
const EDGE_PX = 32;        // faixa com abas sobrando: perto da borda, rola sozinha
const FLIP_MS = 160;       // a aba solta desliza até a casa dela

// Aperto/arrasto em andamento — fora do React (muda a cada movimento do mouse).
interface Press {
  id: string; pointerId: number; el: HTMLElement;
  startX: number; startY: number; lastX: number;
  started: boolean;
  // Medido quando o arrasto começa, em coordenadas do conteúdo da faixa (rolagem incluída).
  ids: string[]; lefts: number[]; widths: number[];
  from: number; lo: number; hi: number; startScroll: number;
  to: number; dx: number; raf: number;
}

// O que o React desenha durante o arrasto.
interface DragView { id: string; from: number; to: number; dx: number; width: number; key: string }

export default function TabBar({ tabs, activeTabId, onSelect, onClose, onNew, onMove, onCommand, isMuted, canReopen }: Props) {
  const visible = stripTabs(tabs);
  const stripKey = visible.map(x => x.id).join(',');
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabEls = useRef(new Map<string, HTMLDivElement>());
  const press = useRef<Press | null>(null);
  const [drag, setDrag] = useState<DragView | null>(null);
  const [settle, setSettle] = useState(false);          // 1 quadro sem transição ao soltar
  const flipRef = useRef<{ id: string; left: number } | null>(null);
  const flipping = useRef<HTMLElement | null>(null);
  const finishRef = useRef<(commit: boolean) => void>(() => {});
  const latest = useRef({ visible, onMove });
  latest.current = { visible, onMove };

  // ── Arrastar pra reordenar ──
  // Ouvintes na janela (registrados 1x): o mouse sai da aba, da faixa e até da janela durante o
  // arrasto. A aba arrastada também captura o ponteiro (setPointerCapture), então o "soltar"
  // chega mesmo fora da janela. Se mesmo assim ele se perder (o sistema engoliu o botão), a
  // captura cai ou o próximo movimento chega sem botão apertado: o arrasto é desfeito, como no
  // Chrome — nunca fica preso.
  useEffect(() => {
    const update = () => {
      const p = press.current, sc = scrollRef.current;
      if (!p || !p.started || !sc) return;
      const r = dragTarget(p.lefts, p.widths, p.from, p.lo, p.hi, (p.lastX - p.startX) + (sc.scrollLeft - p.startScroll));
      if (r.dx === p.dx && r.to === p.to) return;
      p.dx = r.dx; p.to = r.to;
      setDrag(d => (d && d.id === p.id ? { ...d, dx: r.dx, to: r.to } : d));
    };

    // Rolagem automática perto da borda (só quando há abas escondidas pros lados).
    const tick = () => {
      const p = press.current, sc = scrollRef.current;
      if (!p) return;
      p.raf = 0;
      if (!p.started || !sc || sc.scrollWidth <= sc.clientWidth) return;
      const box = sc.getBoundingClientRect();
      const speed = p.lastX < box.left + EDGE_PX ? -Math.ceil((box.left + EDGE_PX - p.lastX) / 3)
        : p.lastX > box.right - EDGE_PX ? Math.ceil((p.lastX - box.right + EDGE_PX) / 3) : 0;
      if (!speed) return;
      const before = sc.scrollLeft;
      sc.scrollLeft = before + speed;
      if (sc.scrollLeft === before) return;   // chegou no fim da faixa
      update();
      p.raf = requestAnimationFrame(tick);
    };

    const begin = (p: Press): boolean => {
      const sc = scrollRef.current;
      if (!sc) return false;
      // Soltura anterior ainda deslizando: termina já (senão a medida pegaria a aba no meio do caminho).
      const f = flipping.current;
      if (f) { f.style.transition = ''; f.style.transform = ''; flipping.current = null; }
      const vis = latest.current.visible;
      const ids = vis.map(x => x.id);
      const from = ids.indexOf(p.id);
      if (from < 0) return false;
      const lefts: number[] = [];
      const widths: number[] = [];
      for (const id of ids) {
        const node = tabEls.current.get(id);
        if (!node) return false;
        const r = node.getBoundingClientRect();
        lefts.push(r.left + sc.scrollLeft);
        widths.push(r.width);
      }
      const pinnedN = vis.filter(x => x.pinned).length;
      const pinned = !!vis[from].pinned;
      Object.assign(p, {
        started: true, ids, lefts, widths, from, to: from, dx: 0, startScroll: sc.scrollLeft,
        lo: pinned ? 0 : pinnedN, hi: pinned ? pinnedN - 1 : ids.length - 1,
      });
      try { p.el.setPointerCapture(p.pointerId); } catch {}
      setDrag({ id: p.id, from, to: from, dx: 0, width: widths[from], key: ids.join(',') });
      return true;
    };

    // commit = gravar a ordem nova; senão a aba volta pro lugar (Esc, janela perdeu o foco…).
    const finish = (commit: boolean) => {
      const p = press.current;
      if (!p) return;
      press.current = null;
      if (p.raf) cancelAnimationFrame(p.raf);
      try { if (p.el.hasPointerCapture(p.pointerId)) p.el.releasePointerCapture(p.pointerId); } catch {}
      if (!p.started) return;
      // De onde a aba sai (com o deslocamento): na ordem nova ela desliza daqui até a casa dela.
      flipRef.current = { id: p.id, left: p.el.getBoundingClientRect().left };
      setSettle(true);
      setDrag(null);
      if (commit && p.to !== p.from) latest.current.onMove(p.id, p.to);
    };
    finishRef.current = finish;

    const onPointerMove = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if ((e.buttons & 1) === 0) { finish(false); return; }  // o "soltar" se perdeu: desfaz
      p.lastX = e.clientX;
      if (!p.started) {
        if (Math.abs(e.clientX - p.startX) < DRAG_START_PX && Math.abs(e.clientY - p.startY) < DRAG_START_PX) return;
        if (!begin(p)) { press.current = null; return; }
      }
      update();
      if (!p.raf) p.raf = requestAnimationFrame(tick);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (press.current && e.pointerId === press.current.pointerId) finish(true);
    };
    const onPointerCancel = (e: PointerEvent) => {
      if (press.current && e.pointerId === press.current.pointerId) finish(false);
    };
    const onBlur = () => finish(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && press.current?.started) { e.preventDefault(); e.stopPropagation(); finish(false); }
    };
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey, true);
      const p = press.current;
      if (p?.raf) cancelAnimationFrame(p.raf);
      press.current = null;
    };
  }, []);

  // Abriu/fechou aba no meio do arrasto (agente, atalho): as medidas não valem mais → cancela.
  useEffect(() => {
    if (drag && drag.key !== stripKey) finishRef.current(false);
  }, [drag, stripKey]);

  // Soltou: a ordem nova entra no lugar SEM transição (classe tab-settle) e só a aba solta
  // desliza da posição onde foi largada até a casa dela.
  useLayoutEffect(() => {
    if (!settle) return;
    void scrollRef.current?.offsetWidth;   // aplica o layout novo enquanto as transições estão desligadas
    const f = flipRef.current;
    flipRef.current = null;
    setSettle(false);
    if (!f) return;
    const el = tabEls.current.get(f.id);
    if (!el) return;
    const delta = f.left - el.getBoundingClientRect().left;
    if (Math.abs(delta) < 1) return;
    el.style.transition = 'none';
    el.style.transform = `translateX(${delta}px)`;
    void el.offsetWidth;                   // ponto de partida fixado antes de animar
    el.style.transition = `transform ${FLIP_MS}ms ease-out`;
    el.style.transform = '';
    flipping.current = el;
    const done = (ev?: TransitionEvent) => {
      if (ev && (ev.target !== el || ev.propertyName !== 'transform')) return;
      el.removeEventListener('transitionend', done);
      if (flipping.current !== el) return;
      flipping.current = null;
      el.style.transition = '';
    };
    el.addEventListener('transitionend', done);
    window.setTimeout(done, FLIP_MS + 120);   // transitionend pode não vir (aba fechou, janela escondida)
  }, [settle]);

  // A aba ativa sempre à vista quando a faixa tem abas sobrando (Ctrl+Shift+PageUp/PageDown,
  // Ctrl+Tab, aba nova no fim).
  useLayoutEffect(() => {
    if (drag) return;
    const el = tabEls.current.get(activeTabId), sc = scrollRef.current;
    if (!el || !sc || sc.scrollWidth <= sc.clientWidth) return;
    const r = el.getBoundingClientRect(), box = sc.getBoundingClientRect();
    if (r.left < box.left) sc.scrollLeft -= box.left - r.left;
    else if (r.right > box.right) sc.scrollLeft += r.right - box.right;
  }, [activeTabId, stripKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const onTabPointerDown = (e: React.PointerEvent<HTMLDivElement>, tab: Tab) => {
    if (e.button !== 0) return;                       // meio e direito: auxclick / contextmenu
    if (tab.id !== activeTabId) onSelect(tab.id);     // como o Chrome: ativa no aperto
    if (press.current) return;                        // já tem um aperto (outro dedo/caneta)
    press.current = {
      id: tab.id, pointerId: e.pointerId, el: e.currentTarget,
      startX: e.clientX, startY: e.clientY, lastX: e.clientX, started: false,
      ids: [], lefts: [], widths: [], from: 0, lo: 0, hi: 0, startScroll: 0, to: 0, dx: 0, raf: 0,
    };
  };

  // ── Menu do botão direito ──
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuTab = menu ? visible.find(x => x.id === menu.id) : undefined;

  // Esc, janela mudando de tamanho ou perdendo o foco fecham (igual aos menus do Chrome).
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); closeMenu(); } };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('blur', closeMenu);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('blur', closeMenu);
    };
  }, [menu, closeMenu]);
  // A aba do menu fechou por outro caminho (Ctrl+W, agente, extensão) → o menu some junto.
  useEffect(() => { if (menu && !menuTab) setMenu(null); }, [menu, menuTab]);
  // Abre no ponteiro, empurrado pra dentro da janela se for passar da borda.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8))}px`;
  }, [menu]);

  const run = (cmd: TabCommand) => {
    if (!menu) return;
    const id = menu.id;
    setMenu(null);
    onCommand(cmd, id);
  };

  const renderMenu = (tab: Tab) => {
    const muted = isMuted(tab.url, tab.incognito);
    const hasSite = !!siteKey(tab.url);
    const item = (label: string, cmd: TabCommand, opts?: { kbd?: string; disabled?: boolean }) => (
      <button className="bm-pop-item" role="menuitem" disabled={opts?.disabled} onClick={() => run(cmd)}>
        <span className="bm-pop-label">{label}</span>
        {opts?.kbd && <span className="menu-kbd">{opts.kbd}</span>}
      </button>
    );
    return (
      <>
        {/* no-drag: em cima da faixa de abas (que arrasta a janela) o clique tem que fechar o menu */}
        <div className="menu-overlay tab-menu-overlay" onMouseDown={closeMenu} onContextMenu={e => { e.preventDefault(); closeMenu(); }} />
        <div className="bm-pop bm-ctx tab-ctx" role="menu" ref={menuRef} style={{ left: menu!.x, top: menu!.y }}>
          {/* Na aba anônima, a aba nova à direita também é anônima. */}
          {item(t(tab.incognito ? 'tab.ctx.newIncognitoRight' : 'tab.ctx.newRight'), 'new-right')}
          <div className="menu-sep" />
          {item(t('tab.ctx.reload'), 'reload', { kbd: tab.id === activeTabId ? KEY_RELOAD : undefined })}
          {item(t('tab.ctx.duplicate'), 'duplicate')}
          {item(t(tab.pinned ? 'tab.ctx.unpin' : 'tab.ctx.pin'), tab.pinned ? 'unpin' : 'pin')}
          {item(t(muted ? 'tab.ctx.unmuteSite' : 'tab.ctx.muteSite'), muted ? 'unmute' : 'mute', { disabled: !hasSite })}
          <div className="menu-sep" />
          {item(t('tab.ctx.close'), 'close', { kbd: tab.id === activeTabId ? KEY_CLOSE : undefined })}
          {item(t('tab.ctx.closeOthers'), 'close-others', { disabled: !closeOthersIds(tabs, tab.id).length })}
          {item(t('tab.ctx.closeRight'), 'close-right', { disabled: !closeRightIds(tabs, tab.id).length })}
          <div className="menu-sep" />
          {item(t('tab.ctx.reopen'), 'reopen', { kbd: KEY_REOPEN, disabled: !canReopen() })}
        </div>
      </>
    );
  };

  return (
    <div className="tab-bar">
      <div ref={scrollRef} className={`tabs-scroll${settle ? ' tab-settle' : ''}`}>
        {visible.map((tab, i) => {
          let style: React.CSSProperties | undefined;
          if (drag) {
            const s = tab.id === drag.id ? drag.dx : dragShift(i, drag.from, drag.to, drag.width);
            if (s) style = { transform: `translateX(${s}px)` };
          }
          // Anônima ainda sem site: "Nova aba anônima" (o título da página em branco não diz nada).
          const name = tab.incognito && isIncognitoBlank(tab.url) ? t('incog.tabTitle') : (tab.title || t('tab.new'));
          // Dormindo (Memory Saver): 💤 e apagada. A que voltou da última sessão e ainda não
          // carregou também está sem webview, mas fica igual às outras (ícone e nome salvos).
          const asleep = tab.discarded && !tab.restored;
          // Fixada não mostra o nome: vai no balão do mouse.
          const tip0 = tab.pinned ? (asleep ? `${name}\n${t('tab.sleeping')}` : name) : (asleep ? t('tab.sleeping') : undefined);
          // Anônima: o balão diz isso (a em branco já se chama "Nova aba anônima").
          const tip = tab.incognito && !isIncognitoBlank(tab.url) ? `${tip0 || name}\n${t('incog.tabTip')}` : tab.incognito ? (tip0 || name) : tip0;
          return (
            <div
              key={tab.id}
              ref={el => { if (el) tabEls.current.set(tab.id, el); else tabEls.current.delete(tab.id); }}
              className={`tab ${tab.id === activeTabId ? 'active' : ''}${asleep ? ' discarded' : ''}${tab.pinned ? ' pinned' : ''}${tab.incognito ? ' incognito' : ''}${drag?.id === tab.id ? ' dragging' : ''}`}
              style={style}
              title={tip}
              onPointerDown={e => onTabPointerDown(e, tab)}
              onLostPointerCapture={() => { if (press.current?.id === tab.id && press.current.started) finishRef.current(false); }}
              // Botão do meio = fechar (e sem a rolagem automática do Windows).
              onMouseDown={e => { if (e.button === 1) e.preventDefault(); }}
              onAuxClick={e => { if (e.button === 1) { e.preventDefault(); onClose(tab.id); } }}
              onContextMenu={e => { e.preventDefault(); setMenu({ id: tab.id, x: e.clientX, y: e.clientY }); }}
            >
              {/* Fixada dormindo fica com o ícone (apagado): sem nome, o 💤 sozinho não diria qual site é. */}
              {asleep && !tab.pinned ? <span className="tab-sleep">💤</span>
                : tab.isLoading && !tab.discarded ? <span className="tab-spinner" />
                : tab.incognito ? <IncognitoIcon className="tab-incog" />
                : <TabFavicon url={tab.url} pinned={tab.pinned} />}
              {!tab.pinned && <span className="tab-title">{name}</span>}
              {tab.audible && (isMuted(tab.url, tab.incognito) ? <TabMutedIcon /> : <TabAudioIcon />)}
              {!tab.pinned && (
                <button
                  className="tab-close"
                  // Apertar o × não ativa nem arrasta a aba (igual ao Chrome).
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); onClose(tab.id); }}
                  title={t('tab.close')}
                >
                  &times;
                </button>
              )}
            </div>
          );
        })}
        {/* "+" logo depois da última aba (não no canto direito) */}
        <button className="tab-new" onClick={() => onNew()} title={t('tab.new')}>+</button>
      </div>
      {/* Durante o arrasto: cobre a janela pra página (webview) não engolir o movimento do mouse. */}
      {drag && createPortal(<div className="tab-drag-overlay" />, document.body)}
      {menu && menuTab && createPortal(renderMenu(menuTab), document.body)}
    </div>
  );
}

// Alto-falante da aba que está emitindo som (igual ao Chrome). Só indica — não muta.
function TabAudioIcon() {
  return (
    <svg className="tab-audio" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path fill="currentColor" d="M8.6 2.35 4.3 5.6H2.3a.7.7 0 0 0-.7.7v3.4c0 .39.31.7.7.7h2l4.3 3.25a.45.45 0 0 0 .72-.36V2.71a.45.45 0 0 0-.72-.36z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" d="M11.4 6.1a2.9 2.9 0 0 1 0 3.8M13.4 4.2a5.7 5.7 0 0 1 0 7.6" />
    </svg>
  );
}

// Site com "Desativar som do site" tentando tocar: alto-falante riscado (igual ao Chrome).
function TabMutedIcon() {
  return (
    <svg className="tab-audio muted" viewBox="0 0 16 16" width="13" height="13" role="img" aria-label={t('tab.muted')}>
      <title>{t('tab.muted')}</title>
      <path fill="currentColor" d="M8.6 2.35 4.3 5.6H2.3a.7.7 0 0 0-.7.7v3.4c0 .39.31.7.7.7h2l4.3 3.25a.45.45 0 0 0 .72-.36V2.71a.45.45 0 0 0-.72-.36z" />
      <path fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" d="M11.2 6.2l3.4 3.4M14.6 6.2l-3.4 3.4" />
    </svg>
  );
}

// Fixada sem ícone (site sem favicon ou arquivo quebrado) mostra o quadradinho — senão a aba
// ficaria vazia. Aba comum sem ícone só some com ele (o nome está ali).
function TabFavicon({ url, pinned }: { url: string; pinned?: boolean }) {
  const [broken, setBroken] = useState('');
  let icon = '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      icon = `${parsed.origin}/favicon.ico`;
    }
  } catch {}

  if (!icon) return <span className="tab-favicon fallback" />;
  if (broken === icon) return pinned ? <span className="tab-favicon fallback" /> : null;

  return (
    <img
      className="tab-favicon"
      src={icon}
      alt=""
      draggable={false}
      onError={() => setBroken(icon)}
    />
  );
}
