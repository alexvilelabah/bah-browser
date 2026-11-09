import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { agentDecision, isAgentTab, noteDialog, type JsDialog } from '../js-dialogs';

const host = (o: string) => { try { return new URL(o).host || o; } catch { return o; } };

/** Caixa do Bah para alert/confirm/prompt das páginas (a nativa travava a página e não fazia prompt). */
export function JsDialogHost() {
  const api = window.electronAPI as any;
  const [queue, setQueue] = useState<Array<JsDialog & { forAgent?: boolean }>>([]);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => api?.onJsDialog?.((ev: { type: string; data: any }) => {
    if (ev.type === 'open') {
      const d = ev.data as JsDialog;
      if (isAgentTab(d.wcId)) {
        const r = agentDecision(d);
        if (r) { noteDialog(r.note); void api?.jsDialogRespond?.(d.id, r.accept, r.text); return; }
        setQueue(q => [...q, { ...d, forAgent: true }]);   // pagamento/exclusão: a pessoa decide
        return;
      }
      setQueue(q => [...q, d]);
    } else if (ev.type === 'closed') setQueue(q => q.filter(x => x.id !== ev.data));
    else if (ev.type === 'left') noteDialog(`the page asked "Leave site? Changes may not be saved" — Bah left it because you navigated (${String(ev.data?.url || '').slice(0, 80)})`);
  }), []);

  const d = queue[0];
  useEffect(() => { if (d) { setText(d.defaultText || ''); setTimeout(() => inputRef.current?.focus(), 30); } }, [d?.id]);
  if (!d) return null;
  const answer = (accept: boolean) => {
    void api?.jsDialogRespond?.(d.id, accept, d.type === 'prompt' ? text : '');
    if (d.forAgent) noteDialog(`${d.type} "${d.message.slice(0, 160)}" → the user ${accept ? 'accepted' : 'refused'} it`);
    setQueue(q => q.slice(1));
  };

  return (
    <div className="tour-backdrop jsdialog" role="dialog" aria-label={t('jsdialog.title', { host: host(d.origin) })}>
      <form className="tour-card proxy-card" onSubmit={e => { e.preventDefault(); answer(true); }}>
        <div className="tour-head"><span className="tour-title">{d.forAgent ? '🤖 ' : ''}{t('jsdialog.title', { host: host(d.origin) })}</span></div>
        {d.forAgent && <div className="proxy-hint">{t('jsdialog.forAgent')}</div>}
        <div className="jsdialog-msg">{d.message}</div>
        {d.type === 'prompt' && <input ref={inputRef} className="jsdialog-input" value={text} onChange={e => setText(e.target.value)} />}
        <div className="tour-foot proxy-foot">
          {d.type !== 'alert' && <button type="button" className="tour-btn jsdialog-cancel" onClick={() => answer(false)}>{t('proxy.cancel')}</button>}
          <button type="submit" className="tour-btn tour-btn-primary jsdialog-ok" autoFocus={d.type !== 'prompt'}>OK</button>
        </div>
      </form>
    </div>
  );
}
