import React, { useState } from 'react';

export interface SpeedDialItem { url: string; title: string }

interface Props {
  items: SpeedDialItem[];
  onNavigate: (urlOrQuery: string) => void;   // reusa o navigate() do App
  onAdd: (url: string, title: string) => void;
  onRemove: (url: string) => void;
}

// Grade de atalhos próprios (com "+") que flutua POR CIMA do Google de verdade, na área
// vazia abaixo da busca. O container não captura cliques (pointer-events:none no CSS); só
// os tiles capturam — então o Google embaixo continua 100% clicável.
export default function SpeedDialOverlay({ items, onNavigate, onAdd, onRemove }: Props) {
  const [adding, setAdding] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');

  const submitAdd = () => {
    let u = newUrl.trim(); if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    let title = newName.trim();
    if (!title) { try { title = new URL(u).hostname.replace(/^www\./, ''); } catch { title = u; } }
    onAdd(u, title); setNewUrl(''); setNewName(''); setAdding(false);
  };
  const favicon = (u: string) => { try { return `${new URL(u).origin}/favicon.ico`; } catch { return ''; } };
  const initial = (t: string) => (t || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="sd-overlay">
      <div className="sd-grid">
        {items.map(it => (
          <div key={it.url} className="sd-tile" onClick={() => onNavigate(it.url)} title={it.url}>
            <button className="sd-del" onClick={e => { e.stopPropagation(); onRemove(it.url); }} title="Remover">✕</button>
            <div className="sd-icon">
              <span className="sd-letter">{initial(it.title)}</span>
              <img src={favicon(it.url)} alt="" draggable={false} onError={e => { (e.currentTarget.style.display = 'none'); }} />
            </div>
            <span className="sd-label">{it.title}</span>
          </div>
        ))}
        <div className="sd-tile sd-add" onClick={() => setAdding(true)} title="Adicionar atalho">
          <div className="sd-icon"><span className="sd-plus">+</span></div>
          <span className="sd-label">Adicionar</span>
        </div>
      </div>

      {adding && (
        <div className="sd-modal" onClick={() => setAdding(false)}>
          <div className="sd-modal-box" onClick={e => e.stopPropagation()}>
            <div className="sd-modal-title">Novo atalho</div>
            <input className="sd-modal-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome (opcional)" />
            <input
              className="sd-modal-input" value={newUrl} autoFocus
              onChange={e => setNewUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitAdd(); if (e.key === 'Escape') setAdding(false); }}
              placeholder="URL — ex.: youtube.com"
            />
            <div className="sd-modal-actions">
              <button className="sd-cancel" onClick={() => setAdding(false)}>Cancelar</button>
              <button className="sd-ok" onClick={submitAdd}>Adicionar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
