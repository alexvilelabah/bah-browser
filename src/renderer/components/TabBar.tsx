import React from 'react';
import { Tab } from '../store';
import { t } from '../i18n';

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

export default function TabBar({ tabs, activeTabId, onSelect, onClose, onNew }: Props) {
  return (
    <div className="tab-bar">
      <div className="tabs-scroll">
        {tabs.filter(tab => !tab.hidden).map(tab => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? 'active' : ''}${tab.discarded ? ' discarded' : ''}`}
            onClick={() => onSelect(tab.id)}
            title={tab.discarded ? t('tab.sleeping') : undefined}
          >
            {tab.discarded ? <span className="tab-sleep">💤</span> : tab.isLoading ? <span className="tab-spinner" /> : <TabFavicon url={tab.url} />}
            <span className="tab-title">{tab.title || t('tab.new')}</span>
            {tab.audible && <TabAudioIcon />}
            <button
              className="tab-close"
              onClick={e => { e.stopPropagation(); onClose(tab.id); }}
              title={t('tab.close')}
            >
              &times;
            </button>
          </div>
        ))}
        {/* "+" logo depois da última aba (não no canto direito) */}
        <button className="tab-new" onClick={() => onNew()} title={t('tab.new')}>+</button>
      </div>
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

function TabFavicon({ url }: { url: string }) {
  let icon = '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      icon = `${parsed.origin}/favicon.ico`;
    }
  } catch {}

  if (!icon) return <span className="tab-favicon fallback" />;

  return (
    <img
      className="tab-favicon"
      src={icon}
      alt=""
      draggable={false}
      onError={event => {
        event.currentTarget.style.display = 'none';
      }}
    />
  );
}
