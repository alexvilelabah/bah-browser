import React, { useState } from 'react';
import { t } from '../i18n';
import { entryText, type Thread } from '../../shared/thread-store';
import { fmtTokens } from '../../shared/context-meter';
import { pin, type ThreadNotice } from '../threads';

// A conversa (thread) de uma sessão, só leitura: o "Continuando da última vez" do feed e a conversa
// aberta pelo 🕘 Histórico de conversas. Mostra o que o modelo lê: 📌 fixados, fatos, o resumo e os
// itens recentes.
export function ThreadView({ thread, compact }: { thread: Thread; compact?: boolean }) {
  const pinnedFacts = thread.facts.filter(f => f.pinned);
  const facts = thread.facts.filter(f => !f.pinned);
  const pinned = thread.entries.filter(e => e.pinned);
  const recent = thread.entries.filter(e => !e.pinned);
  const line = (txt: string) => txt.replace(/^- /, '');
  return (
    <div className={`thread-view${compact ? ' compact' : ''}`} data-testid="thread-view">
      {(pinnedFacts.length > 0 || pinned.length > 0) && (
        <div className="thread-sec"><div className="thread-h">{t('thread.pinnedHead')}</div>
          {pinnedFacts.map(f => <div key={f.key} className="thread-line">{f.text}</div>)}
          {pinned.map(e => <div key={e.id} className="thread-line">{line(entryText(e))}</div>)}
        </div>
      )}
      {facts.length > 0 && (
        <div className="thread-sec"><div className="thread-h">{t('thread.facts')}</div>
          {facts.map(f => <div key={f.key} className="thread-line">{f.text}</div>)}
        </div>
      )}
      {thread.summary && (
        <div className="thread-sec"><div className="thread-h">🗜 {t('thread.summary')}</div>
          <pre className="thread-summary">{thread.summary}</pre>
        </div>
      )}
      {recent.length > 0 && (
        <div className="thread-sec">
          {recent.map(e => (
            <div key={e.id} className={`thread-line thread-${e.kind}`}>
              {e.kind === 'user' ? e.text : e.kind === 'assistant' ? e.text : `⚡ ${line(entryText(e))}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Avisos da thread no feed: 80% do orçamento (com 📌), "🗜 resumi N" (abre o texto exato que ficou no
// lugar), 🗑 limpar, ✂️ página cortada, 📌 fixado.
export function ThreadNoticeRow({ notice }: { notice: ThreadNotice }) {
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  switch (notice.kind) {
    case 'warn':
      return (
        <div className="thread-notice warn" data-testid="thread-warn">
          <div>⚠️ {t('thread.warn', { pct: Math.round((notice.tokens / notice.budget) * 100), used: fmtTokens(notice.tokens), budget: fmtTokens(notice.budget) })}</div>
          <div className="thread-pin-list">
            {notice.candidates.slice(-6).map(c => (
              <div key={c.id} className="thread-pin-row">
                <span className="thread-pin-text">{c.text}</span>
                <button className="thread-pin-btn" disabled={pinnedIds.has(c.id)}
                  onClick={() => { pin(notice.key, c.id); setPinnedIds(s => new Set(s).add(c.id)); }}>
                  {pinnedIds.has(c.id) ? '📌' : t('thread.pin')}
                </button>
              </div>
            ))}
          </div>
        </div>
      );
    case 'compacted':
      if (!notice.folded) return <div className="thread-notice">{t('thread.nothingToCompact')}</div>;
      return (
        <details className="thread-notice" data-testid="thread-compacted">
          <summary>{t('thread.compacted', { n: notice.folded })}</summary>
          <pre className="thread-summary">{notice.text}</pre>
          {notice.dropped > 0 && <div className="thread-note-small">{t('thread.compactedDropped', { n: notice.dropped })}</div>}
        </details>
      );
    case 'cleared':
      return (
        <details className="thread-notice" data-testid="thread-cleared">
          <summary>{t('thread.cleared', { n: notice.removed })}</summary>
          <pre className="thread-summary">{notice.text}</pre>
        </details>
      );
    case 'trimmed':
      return <div className="thread-notice" data-testid="page-trimmed">{t('thread.trimmed')}</div>;
    case 'pinned':
      return <div className="thread-notice">{t('thread.pinned', { text: notice.text })}</div>;
  }
}
