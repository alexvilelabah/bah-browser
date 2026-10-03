import React, { useState, useEffect } from 'react';
import { t } from '../i18n';

interface Monitor {
  id: string;
  url: string;
  condition: string;
  intervalMin: number;
  enabled: boolean;
  createdAt: number;
  lastRun?: number;
  lastResult?: 'met' | 'unmet' | 'error' | null;
  lastValue?: string;
  lastNote?: string;
  triggeredAt?: number;
  notify?: NotifyKind[];
}

type NotifyKind = 'trigger' | 'change' | 'error';

const NOTIFY_KINDS: NotifyKind[] = ['trigger', 'change', 'error'];

const INTERVALS = [5, 15, 30, 60, 120, 360, 720, 1440];

function fmtInterval(min: number): string {
  if (min < 60) return `${min} min`;
  if (min % 60 === 0) return `${min / 60} h`;
  return `${(min / 60).toFixed(1)} h`;
}
function fmtTime(ts?: number): string {
  if (!ts) return '';
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

export default function MonitorsPanel({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Monitor[]>([]);
  const [url, setUrl] = useState('');
  const [condition, setCondition] = useState('');
  const [intervalMin, setIntervalMin] = useState(120);
  const [trayOn, setTrayOn] = useState(false);
  const api = () => (window as any).electronAPI;

  const refresh = async () => { try { setList((await api()?.monitorsList?.()) || []); } catch {} };
  useEffect(() => {
    refresh();
    const off = api()?.onMonitorsChanged?.((l: Monitor[]) => setList(l || []));
    (async () => { try { const r = await api()?.trayGet?.(); setTrayOn(!!r?.enabled); } catch {} })();
    return () => { try { off?.(); } catch {} };
  }, []);

  // Which events may post a system notification. Default: trigger only = old behaviour.
  const [notify, setNotify] = useState<NotifyKind[]>(['trigger']);
  const toggleKind = (k: NotifyKind) =>
    setNotify((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const add = async () => {
    if (!url.trim() || !condition.trim()) return;
    try { await api()?.monitorAdd?.({ url: url.trim(), condition: condition.trim(), intervalMin, notify }); } catch {}
    setUrl(''); setCondition(''); setNotify(['trigger']);
    refresh();
  };
  const toggle = async (m: Monitor) => { try { await api()?.monitorUpdate?.(m.id, { enabled: !m.enabled }); } catch {} refresh(); };
  const remove = async (m: Monitor) => { try { await api()?.monitorRemove?.(m.id); } catch {} refresh(); };
  const runNow = async (m: Monitor) => { try { await api()?.monitorRunNow?.(m.id); } catch {} };
  const setTray = async (v: boolean) => { setTrayOn(v); try { await api()?.traySet?.(v); } catch {} };

  const statusChip = (m: Monitor) => {
    if (!m.enabled) return <span className="mon-chip off">{t('mon.paused')}</span>;
    if (m.lastResult === 'met') return <span className="mon-chip met">✓ {t('mon.met')}</span>;
    if (m.lastResult === 'error') return <span className="mon-chip err">{t('mon.error')}</span>;
    if (m.lastResult === 'unmet') return <span className="mon-chip watching">{t('mon.watching')}</span>;
    return <span className="mon-chip watching">{t('mon.checking')}</span>;
  };

  return (
    <div className="menu-panel monitors-panel">
      <div className="mon-head">
        <span>🛰️ {t('mon.title')}</span>
        <button className="history-close" onClick={onClose}>✕</button>
      </div>

      <div className="mon-form">
        <input className="mon-input" placeholder={t('mon.phUrl')} value={url} onChange={e => setUrl(e.target.value)} spellCheck={false} />
        <textarea className="mon-input mon-cond" placeholder={t('mon.phCond')} value={condition} onChange={e => setCondition(e.target.value)} rows={2} />
        <div className="mon-form-row">
          <select className="mon-input mon-interval" value={intervalMin} onChange={e => setIntervalMin(Number(e.target.value))}>
            {INTERVALS.map(v => <option key={v} value={v}>{t('mon.every')} {fmtInterval(v)}</option>)}
          </select>
        <div className="mon-notify" role="group" aria-label={t('mon.notify.title')}>
          <span className="mon-notify-label">{t('mon.notify.title')}</span>
          {NOTIFY_KINDS.map((k) => (
            <label key={k} className={notify.includes(k) ? 'mon-check on' : 'mon-check'}>
              <input type="checkbox" checked={notify.includes(k)} onChange={() => toggleKind(k)} />
              <span>{t(`mon.notify.${k}`)}</span>
            </label>
          ))}
        </div>
          <button className="mon-add-btn" onClick={add} disabled={!url.trim() || !condition.trim()}>{t('mon.add')}</button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="history-empty">{t('mon.empty')}</div>
      ) : (
        <div className="mon-list">
          {list.map(m => (
            <div key={m.id} className="mon-item">
              <div className="mon-item-top">
                {statusChip(m)}
                <span className="mon-item-cond" title={m.condition}>{m.condition}</span>
              </div>
              <div className="mon-item-url" title={m.url}>{m.url}</div>
              {m.lastValue && <div className="mon-item-val" title={m.lastNote || ''}>{m.lastValue}</div>}
              <div className="mon-item-actions">
                <span className="mon-item-meta">{t('mon.every')} {fmtInterval(m.intervalMin)}{m.lastRun ? ` · ${t('mon.last')} ${fmtTime(m.lastRun)}` : ''}</span>
                <div className="mon-item-btns">
                  <button onClick={() => runNow(m)} title={t('mon.checkNow')}>↻</button>
                  <button onClick={() => toggle(m)} title={m.enabled ? t('mon.pause') : t('mon.resume')}>{m.enabled ? '⏸' : '▶'}</button>
                  <button onClick={() => remove(m)} title={t('mon.remove')} className="mon-del">🗑</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <label className="mon-tray">
        <input type="checkbox" checked={trayOn} onChange={e => setTray(e.target.checked)} />
        <span>{t('mon.trayLabel')}</span>
      </label>
    </div>
  );
}
