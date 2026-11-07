// Medidor do computador na barra de cima: CPU, RAM e placa de vídeo, a cada 2 s. DESLIGADO por
// padrão (poluía a barra): liga em ⋮ → "Mostrar CPU e RAM". Desligado não ocupa espaço nenhum e o main
// para de medir; o botão de encolher desliga a mesma opção.
import React, { useEffect, useState } from 'react';
import { t } from '../i18n';

interface Stats {
  cpu: number | null;
  ramUsedGb: number;
  ramTotalGb: number;
  gpu: { util: number; memUsedGb: number; memTotalGb: number; temp: number | null; watts: number | null; name: string } | null;
}


/** A escolha salva (⋮ → Mostrar CPU e RAM). Padrão: desligado. */
export function hwMonitorEnabled(): boolean {
  try { return localStorage.getItem('hwMonShow') === '1'; } catch { return false; }
}

export default function HwMonitor({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    try { localStorage.setItem('hwMonShow', on ? '1' : '0'); } catch {}
    const api = (window as any).electronAPI;
    void api?.hwWatch?.(on);
    if (!on) { setS(null); return; }
    const off = api?.onHwStats?.((x: Stats) => setS(x));
    return () => { try { off?.(); } catch {} };
  }, [on]);

  if (!on) return null;
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
      <button type="button" className="hw-off-btn" data-testid="hw-turn-off" onClick={() => onChange(false)} title={t('hw.turnOff')} aria-label={t('hw.turnOff')}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7.5 2.5L4 6l3.5 3.5" /></svg>
      </button>
    </div>
  );
}
