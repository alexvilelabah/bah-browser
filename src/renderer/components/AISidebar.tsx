import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, AISettings, LocalSettings } from '../store';

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => Promise<void>;
  onClear: () => void;
  onClose: () => void;
  aiSettings: AISettings;
  onSettingsChange: (settings: AISettings) => Promise<void>;
  localSettings: LocalSettings;
  onLocalSettingsChange: (settings: LocalSettings) => Promise<void>;
}

export default function AISidebar({ messages, onSend, onClear, onClose, aiSettings, onSettingsChange, localSettings, onLocalSettingsChange }: Props) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(aiSettings);
  const [localCfg, setLocalCfg] = useState(localSettings);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    setLoading(true);
    try {
      await onSend(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-sidebar">
      <div className="sidebar-header">
        <h3>AI Assistant</h3>
        <div className="sidebar-actions">
          <button onClick={() => setShowSettings(!showSettings)} title="Settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </button>
          <button onClick={onClear} title="Clear chat">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
          <button onClick={onClose} title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="settings-panel">
          <label>
            Provider
            <select value={settings.provider} onChange={e => setSettings({ ...settings, provider: e.target.value as AISettings['provider'] })}>
              <option value="deepseek">DeepSeek</option>
              <option value="ollama">Ollama (Local)</option>
            </select>
          </label>
          <label>
            API Key
            <input
              type="password"
              value={settings.apiKey}
              onChange={e => setSettings({ ...settings, apiKey: e.target.value })}
              placeholder={settings.provider === 'ollama' ? 'Not needed' : 'Enter API key...'}
            />
          </label>
          <label>
            Base URL (optional)
            <input
              type="text"
              value={settings.baseUrl}
              onChange={e => setSettings({ ...settings, baseUrl: e.target.value })}
              placeholder="Leave empty for default"
            />
          </label>
          <button className="save-settings" onClick={async () => {
            await onSettingsChange(settings);
            await onLocalSettingsChange(localCfg);
            setShowSettings(false);
          }}>
            Save Settings
          </button>

          {/* ── Local GPU model ── */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexDirection: 'row', textTransform: 'none', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              <span>🏠 Modelo Local (GPU)</span>
              <button
                onClick={() => setLocalCfg(p => ({ ...p, enabled: !p.enabled }))}
                style={{
                  padding: '3px 10px', border: '1px solid var(--border-bright)', borderRadius: '999px',
                  background: localCfg.enabled ? 'var(--gradient)' : 'var(--bg-tertiary)',
                  color: localCfg.enabled ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '11px', fontWeight: 700,
                }}
              >{localCfg.enabled ? 'ON' : 'OFF'}</button>
            </label>
            {localCfg.enabled && (
              <>
                <label>
                  URL do Ollama
                  <input type="text" value={localCfg.baseUrl}
                    onChange={e => setLocalCfg(p => ({ ...p, baseUrl: e.target.value }))}
                    placeholder="http://localhost:11434" />
                </label>
                <label>
                  Modelo
                  <input type="text" value={localCfg.model}
                    onChange={e => setLocalCfg(p => ({ ...p, model: e.target.value }))}
                    placeholder="qwen3-vl:8b" />
                </label>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
                  Passos simples usarão o modelo local. DeepSeek só será chamado para planejamento, ambiguidade ou quando o agente travar.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.3">
                <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2H10a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z"/>
              </svg>
            </div>
            <p>Ask me anything about this page, or give me instructions to interact with it.</p>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`chat-msg ${msg.role}`}>
            <div className="msg-content">{msg.content}</div>
          </div>
        ))}
        {loading && (
          <div className="chat-msg assistant">
            <div className="msg-content typing">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Ask about this page..."
          disabled={loading}
        />
        <button onClick={handleSend} disabled={loading || !input.trim()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>
        </button>
      </div>
    </div>
  );
}
