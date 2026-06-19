import React, { useState, useEffect, KeyboardEvent } from 'react';

interface Props {
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}

export default function AddressBar({
  url, isLoading, canGoBack, canGoForward,
  onNavigate, onBack, onForward, onReload,
  onToggleSidebar, sidebarOpen,
}: Props) {
  const [input, setInput] = useState(url);

  useEffect(() => { setInput(url); }, [url]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      onNavigate(input);
    }
  };

  return (
    <div className="address-bar">
      <div className="nav-buttons">
        <button onClick={onBack} disabled={!canGoBack} title="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <button onClick={onForward} disabled={!canGoForward} title="Forward">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
        <button onClick={onReload} title="Reload">
          {isLoading ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>
          )}
        </button>
      </div>

      <div className="url-input-wrapper">
        <input
          type="text"
          className="url-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={e => e.target.select()}
          placeholder="Search or enter URL..."
          spellCheck={false}
        />
      </div>

      <button
        className={`ai-toggle ${sidebarOpen ? 'active' : ''}`}
        onClick={onToggleSidebar}
        title="Toggle AI Sidebar"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2H10a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z"/>
          <path d="M10 21h4M12 17v4"/>
        </svg>
        <span>AI</span>
      </button>
    </div>
  );
}
