// Botões das extensões do Chrome na barra, na ordem do Chrome: um ícone por extensão (com
// o badge e a dica que ela escolheu) e depois a peça de quebra-cabeça com a lista das
// instaladas (ligar/desligar, opções, remover) e o atalho pra Chrome Web Store.
import React, { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';

/** O que o main manda de cada botão (cores já em CSS). */
export interface ExtensionActionView {
  title: string; badgeText: string; badgeBg: string; badgeFg: string;
  icon: string; enabled: boolean; hasPopup: boolean;
}
export interface ExtensionInfo {
  id: string; name: string; version: string; hasOptions: boolean;
  /** Ligada no interruptor (desligada = descarregada; não é o action.disable da extensão). */
  enabled: boolean;
  /** Controla o proxy das abas agora (VPN ligada). */
  controlsProxy?: boolean;
  global: ExtensionActionView;
  /** Valores só daquela aba (chave = id do webContents da aba). */
  tabs: Record<string, ExtensionActionView>;
}

interface Props {
  /** webContents da aba que a pessoa está vendo (null enquanto a webview não anexou). */
  getActiveWcId: () => number | null;
}

function ExtIcon({ view, name }: { view: ExtensionActionView; name: string }) {
  if (view.icon) return <img src={view.icon} alt="" draggable={false} />;
  // Sem ícone: a primeira letra num quadradinho, como o Chrome faz.
  return <span className="ext-letter" aria-hidden="true">{(name.trim()[0] || '?').toUpperCase()}</span>;
}

export default function ExtensionsToolbar({ getActiveWcId }: Props) {
  const [list, setList] = useState<ExtensionInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    window.electronAPI?.getExtensionsState?.().then(l => { if (alive && Array.isArray(l)) setList(l); }).catch(() => {});
    const off = window.electronAPI?.onExtensionsState?.(l => { if (Array.isArray(l)) setList(l); });
    return () => { alive = false; try { off?.(); } catch {} };
  }, []);

  // Fecha com Esc ou clique fora (o clique dentro da página cai no scrim).
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!panelRef.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const isOn = (x: ExtensionInfo) => x.enabled !== false;
  const wcId = getActiveWcId();
  const viewFor = (x: ExtensionInfo) => (wcId !== null && x.tabs?.[String(wcId)]) || x.global;

  const click = (x: ExtensionInfo, e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    window.electronAPI?.extensionActionClick?.(x.id, getActiveWcId(), { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  };
  // O estado novo chega pelo 'extensions:state' do main; aqui só trava o interruptor até lá.
  const toggle = async (x: ExtensionInfo) => {
    if (busy[x.id]) return;
    const on = !isOn(x);
    setBusy(b => ({ ...b, [x.id]: true }));
    try {
      const r = await window.electronAPI?.setExtensionEnabled?.(x.id, on);
      if (r && !r.ok && on && !r.quiet) window.alert(t('ext.toggleFailed', { name: x.name }));
    } catch {}
    finally { setBusy(b => { const n = { ...b }; delete n[x.id]; return n; }); }
  };
  const remove = async (x: ExtensionInfo) => {
    if (!window.confirm(t('ext.removeConfirm', { name: x.name }))) return;
    const r = await window.electronAPI?.removeExtension?.(x.id);
    if (r?.ok) setList(l => l.filter(e => e.id !== x.id));
  };

  return (
    <div className="ext-toolbar">
      {/* Os botões encolhem (e somem pela direita) antes de apertar o endereço ou empurrar o
          menu pra fora da janela; quem não coube continua no quebra-cabeça. */}
      <div className="ext-actions">
        {list.filter(isOn).map(x => {
          const v = viewFor(x);
          return (
            <button key={x.id} type="button" className={`ext-action${v.enabled ? '' : ' off'}`}
              title={v.title || x.name} aria-label={v.title || x.name} aria-disabled={!v.enabled}
              onClick={e => { if (v.enabled) click(x, e); }}>
              <ExtIcon view={v} name={x.name} />
              {v.badgeText && (
                <span className="ext-badge" style={{ background: v.badgeBg, color: v.badgeFg }}>{v.badgeText}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="ext-puzzle-wrap" ref={panelRef}>
        <button type="button" className={`ext-action ext-puzzle${open ? ' on' : ''}`} title={t('ext.puzzle')}
          aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {/* Material "extension" */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>
        </button>
        {open && <div className="ext-panel-scrim" onMouseDown={() => setOpen(false)} />}
        {open && (
          <div className="ext-panel" role="dialog" aria-label={t('ext.title')}>
            <div className="ext-panel-title">{t('ext.title')}</div>
            {list.length === 0 ? (
              <div className="ext-panel-empty">{t('ext.empty')}</div>
            ) : (
              <ul className="ext-panel-list">
                {list.map(x => {
                  const v = viewFor(x);
                  const on = isOn(x);
                  const runnable = on && v.enabled;
                  return (
                  <li key={x.id} className={on ? undefined : 'off'}>
                    {/* Ícone + nome = o mesmo clique do botão da barra (popup ancorado aqui). */}
                    <button type="button" className="ext-panel-run" disabled={!runnable}
                      title={v.title || x.name} onClick={e => { if (runnable) { click(x, e); setOpen(false); } }}>
                      <span className="ext-panel-icon"><ExtIcon view={v} name={x.name} /></span>
                      <span className="ext-panel-name">
                        <span className="ext-panel-label">{x.name}</span>
                        {/* Desligada diz isso em texto (não só pela cor/opacidade). */}
                        {(x.version || !on) && (
                          <span className="ext-panel-version">
                            {[x.version ? t('ext.version', { v: x.version }) : '', on ? '' : t('ext.off')].filter(Boolean).join(' · ')}
                          </span>
                        )}
                        {/* Todo o tráfego das abas passa por ela: tem que ficar à vista. */}
                        {on && x.controlsProxy && <span className="ext-panel-proxy">{t('ext.proxyOn')}</span>}
                      </span>
                    </button>
                    {on && x.hasOptions && (
                      <button type="button" className="ext-panel-btn"
                        onClick={() => { setOpen(false); window.electronAPI?.openExtensionOptions?.(x.id); }}>{t('ext.options')}</button>
                    )}
                    <button type="button" className="ext-panel-btn danger" onClick={() => remove(x)}>{t('ext.remove')}</button>
                    {/* Interruptor como o do Chrome: Espaço/Enter alternam (é um <button>). */}
                    <button type="button" role="switch" aria-checked={on} className={`ext-switch${on ? ' on' : ''}`}
                      aria-label={t('ext.switch', { name: x.name })} title={on ? t('ext.on') : t('ext.off')}
                      disabled={!!busy[x.id]} aria-busy={!!busy[x.id]} onClick={() => toggle(x)}>
                      <span className="ext-switch-knob" aria-hidden="true" />
                    </button>
                  </li>
                  );
                })}
              </ul>
            )}
            <button type="button" className="ext-panel-store"
              onClick={() => { setOpen(false); window.electronAPI?.openExtensionStore?.(); }}>
              {t('ext.openStore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
