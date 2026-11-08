import React, { useEffect, useState } from 'react';
import { t } from '../i18n';
import { meterState, meterLabel, fmtTokens, METER_PARTS, type MeterPart } from '../../shared/context-meter';
import { usageOf, threadTokensOf, contextWindow, threadBudget } from '../threads';

// Medidor de contexto no topo do painel, ao lado do nome do modelo: uma barra fina e
// "context 6.1k / 16k · thread 2.3k". Clique → o detalhe da última chamada (instruções, skills,
// conversa, página). Enche → âmbar/vermelho, dizendo quem está ocupando a janela. A conta mora em
// shared/context-meter.ts; os números chegam de renderer/threads.ts.
const PART_KEY: Record<MeterPart, string> = { instructions: 'meter.instructions', skills: 'meter.skills', thread: 'meter.thread', page: 'meter.page' };

export default function ContextMeter({ viewKey }: { viewKey: string }) {
  const [, bump] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => bump(n => n + 1);
    const evs = ['bah:context-usage', 'bah:thread-changed', 'bah:context-window', 'bah:move-thread'];
    evs.forEach(e => window.addEventListener(e, on));
    return () => evs.forEach(e => window.removeEventListener(e, on));
  }, []);
  const u = usageOf(viewKey);
  const thread = threadTokensOf(viewKey);
  // Sem chamada ainda: só a conversa (e a janela, se conhecida).
  const st = meterState(u ? { ...u, window: u.window || contextWindow() } : { window: contextWindow(), parts: { thread } });
  if (!u && !thread) return null;
  const label = meterLabel(st, { context: t('meter.context'), thread: t('meter.thread') });
  const crowded = st.crowding ? t('meter.crowded', { part: t(PART_KEY[st.crowding]) }) : '';
  return (
    <span className="ctx-meter-wrap">
      <button type="button" className={`ctx-meter ${st.level}`} data-testid="context-meter" title={t('meter.tip')} onClick={() => setOpen(o => !o)}>
        {st.window > 0 && <span className="ctx-bar"><span style={{ width: `${Math.round(st.ratio * 100)}%` }} /></span>}
        <span className="ctx-label">{label}</span>
        {crowded && <span className="ctx-crowd"> · {crowded}</span>}
      </button>
      {open && (
        <div className="ctx-pop" data-testid="context-breakdown" onClick={() => setOpen(false)}>
          <div className="ctx-pop-h">{t('meter.title')}</div>
          {u ? METER_PARTS.map(p => (
            <div key={p} className="ctx-row"><span>{t(PART_KEY[p])}</span><b>{fmtTokens(u.parts[p] || 0)}</b></div>
          )) : <div className="ctx-row">{t('meter.noCall')}</div>}
          <div className="ctx-row muted">{st.window ? t('meter.window', { n: st.window.toLocaleString() }) : t('meter.windowUnknown')}</div>
          <div className="ctx-row muted">{st.estimated ? `~ ${t('meter.estimate')}` : t('meter.reported')}</div>
          <div className="ctx-row muted">{t('meter.budget', { n: threadBudget().toLocaleString() })}</div>
          {crowded && <div className="ctx-row warn">{crowded}</div>}
        </div>
      )}
    </span>
  );
}
