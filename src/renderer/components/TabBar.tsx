import React from 'react';
import { Tab } from '../store';

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
            className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => onSelect(tab.id)}
          >
            {tab.isLoading ? <span className="tab-spinner" /> : <TabFavicon url={tab.url} />}
            <span className="tab-title">{tab.title || 'New Tab'}</span>
            <button
              className="tab-close"
              onClick={e => { e.stopPropagation(); onClose(tab.id); }}
            >
              &times;
            </button>
          </div>
        ))}
        {/* "+" logo depois da última aba (não no canto direito) */}
        <button className="tab-new" onClick={() => onNew()} title="Nova aba">+</button>
      </div>
    </div>
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
