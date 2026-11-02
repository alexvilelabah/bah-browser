import React, { useEffect, useState } from 'react';
import { t, getLang } from '../i18n';
import { SESSION_COLOR_HEX, isSessionColor } from '../../shared/agent-sessions';
import type { ChatHistoryEntry, ChatHistoryRow } from '../../shared/chat-history';
import { ThreadView } from './ThreadView';

// 🕘 Histórico de conversas (menu ⋮), como o Histórico do navegador: as sessões passadas do assistente
// com nome, cor, data, sites e o primeiro pedido. Abrir mostra a conversa só pra ler; Retomar traz a
// sessão viva de novo (numa aba nova, ou reabrindo as abas dela). Quem guarda é o main, cifrado
// (main/chat-store.ts); sai no "Limpar dados de navegação".
export default function ChatHistoryPanel({ onClose, onResume }: { onClose: () => void; onResume: (e: ChatHistoryEntry, reopenTabs: boolean) => void }) {
  const [rows, setRows] = useState<ChatHistoryRow[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [open, setOpen] = useState<ChatHistoryEntry | null>(null);
  const load = async () => {
    try { const r = await window.electronAPI?.chatHistoryList?.(); setRows(r?.rows ?? []); setAvailable(r?.available !== false); } catch { setRows([]); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (open) setOpen(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  const when = (ms: number) => { try { return new Date(ms).toLocaleString(getLang(), { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; } };
  const dot = (c: string) => <span className="chat-hist-dot" style={{ background: isSessionColor(c) ? SESSION_COLOR_HEX[c] : '#dadce0' }} />;
  const openOne = async (id: string) => { try { const e = await window.electronAPI?.chatHistoryGet?.(id); if (e) setOpen(e); } catch {} };
  const resume = (e: ChatHistoryEntry, reopen: boolean) => { onResume(e, reopen); onClose(); };
  const resumeById = async (id: string, reopen: boolean) => { const e = open?.id === id ? open : await window.electronAPI?.chatHistoryGet?.(id); if (e) resume(e, reopen); };

  return (
    <div className="history-overlay" onClick={onClose}>
      <div className="history-panel chat-hist-panel" role="dialog" aria-label={t('chats.title')} data-testid="chat-history" onClick={e => e.stopPropagation()}>
        <div className="history-head">
          {open
            ? <button className="history-clear" onClick={() => setOpen(null)}>← {t('chats.back')}</button>
            : <span>🕘 {t('chats.title')}</span>}
          <button className="history-close" onClick={onClose} title={t('assist.close')}>✕</button>
        </div>
        {!available && <div className="history-empty">{t('chats.noVault')}</div>}
        {open ? (
          <div className="chat-hist-open" data-testid="chat-history-open">
            <div className="chat-hist-title">{dot(open.color)}<b>{open.name}</b><span className="chat-hist-when">{when(open.endedAt)}</span></div>
            <div className="chat-hist-ro">{t('chats.readOnly')}</div>
            <div className="chat-hist-actions">
              <button className="confirm-yes" data-testid="chat-history-resume" onClick={() => resume(open, false)}>{t('chats.resume')}</button>
              {open.tabs.length > 0 && <button className="confirm-no" data-testid="chat-history-resume-tabs" onClick={() => resume(open, true)}>{t('chats.resumeTabs', { n: open.tabs.length })}</button>}
            </div>
            <ThreadView thread={open.thread} />
          </div>
        ) : rows === null ? null : rows.length === 0 ? (
          <div className="history-empty">{t('chats.empty')}</div>
        ) : (
          <ul className="history-list">
            {rows.map(r => (
              <li key={r.id} className="history-item chat-hist-item" data-testid="chat-history-row" onClick={() => openOne(r.id)}>
                <span className="history-title">{dot(r.color)}{r.name} <span className="chat-hist-when">· {when(r.endedAt)} · {t('chats.turns', { n: r.turns })}</span></span>
                {r.firstRequest && <span className="chat-hist-first">“{r.firstRequest}”</span>}
                {r.sites.length > 0 && <span className="history-url">{r.sites.join(' · ')}</span>}
                <span className="chat-hist-row-actions" onClick={e => e.stopPropagation()}>
                  <button className="history-clear" onClick={() => resumeById(r.id, false)}>{t('chats.resume')}</button>
                  <button className="history-clear" onClick={async () => { await window.electronAPI?.chatHistoryDelete?.(r.id); void load(); }}>{t('chats.delete')}</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
