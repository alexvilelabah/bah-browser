// Medidor do computador na barra de cima: CPU, RAM e placa de vídeo, a cada 2 s. O botão de
// encolher DESLIGA de verdade (o main para de medir) e fica um "desligado" pra ligar de novo.
import React, { useEffect, useState } from 'react';
import { t } from '../i18n';

interface Stats {
  cpu: number | null;
  ramUsedGb: number;
  ramTotalGb: number;
  gpu: { util: number; memUsedGb: number; memTotalGb: number; temp: number | null; watts: number | null; name: string } | null;
}

const GAUGE = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 18a8 8 0 1 1 16 0" /><path d="M12 18l4-6" />
  </svg>
);

export default function HwMonitor() {
  const [on, setOn] = useState<boolean>(() => { try { return localStorage.getItem('hwMon') !== '0'; } catch { return true; } });
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    try { localStorage.setItem('hwMon', on ? '1' : '0'); } catch {}
    const api = (window as any).electronAPI;
    void api?.hwWatch?.(on);
    if (!on) { setS(null); return; }
    const off = api?.onHwStats?.((x: Stats) => setS(x));
    return () => { try { off?.(); } catch {} };
  }, [on]);

  if (!on) {
    return (
      <button type="button" className="hw-mon hw-off" data-testid="hw-off" onClick={() => setOn(true)} title={t('hw.turnOn')}>
        {GAUGE}<span>{t('hw.off')}</span>
      </button>
    );
  }
  const ramPct = s ? s.ramUsedGb / s.ramTotalGb : 0;
  const g = s?.gpu;
  return (
    <div className="hw-mon" data-testid="hw-mon" title={t('hw.title') + (g?.name ? `\n${g.name}${g.watts !== null ? ` · ${Math.round(g.watts)} W` : ''}` : '')}>
      <span className="hw-item"><b>CPU</b>{s?.cpu != null ? `${s.cpu}%` : '…'}</span>
      <span className={`hw-item hw-ram${ramPct >= 0.9 ? ' warn' : ''}`}><b>RAM</b>{s ? `${Math.round(s.ramUsedGb)}/${Math.round(s.ramTotalGb)} GB` : '…'}</span>
      {g && (
        <span className="hw-item">
          <b>GPU</b>{g.util}%
          <span className="hw-gpu-extra"> · {g.memUsedGb.toFixed(0)}/{g.memTotalGb.toFixed(0)} GB</span>
          {g.temp !== null && <span className={g.temp >= 85 ? 'hot' : g.temp >= 75 ? 'warn' : ''}> · {g.temp}°C</span>}
        </span>
      )}
      <button type="button" className="hw-off-btn" data-testid="hw-turn-off" onClick={() => setOn(false)} title={t('hw.turnOff')} aria-label={t('hw.turnOff')}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7.5 2.5L4 6l3.5 3.5" /></svg>
      </button>
    </div>
  );
}
