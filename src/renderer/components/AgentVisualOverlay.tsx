import React, { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { arcPoint, arcSide, easeInOut, ARC_MS } from '../../shared/agent-cursor-path';

export type AgentVisualState = 'idle' | 'observing' | 'thinking' | 'acting';

export interface ClickRipple {
  id: number;
  x: number;
  y: number;
}

export interface LiveMetrics {
  kind: 'thinking' | 'answer';
  estTokens: number;
  tokPerSec: number;
  elapsedMs: number;
  exact: boolean;
}

interface Props {
  state: AgentVisualState;
  ripples: ClickRipple[];
  metrics?: LiveMetrics | null;
}

const STATE_LABEL: Record<AgentVisualState, string> = {
  idle: '',
  observing: 'reading the page',
  thinking: 'thinking',
  acting: 'acting',
};

// Comet-style overlay: a soft flowing aurora glow around the viewport edges
// that breathes while the agent works. No grids/reticles — just an elegant
// perimeter of colored light, tinted by the current state.
// Cursor do agente desenhado pelo Bah por cima da página: desliza da última posição até o próximo clique
// no MESMO arco que os eventos de mouse reais seguem (shared/agent-cursor-path.ts). Respeita "reduzir movimento".
function AgentCursor({ target }: { target: ClickRipple | undefined }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const posRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!target) return;
    const to = { x: target.x, y: target.y };
    const from = posRef.current;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!from || reduce) { posRef.current = to; setPos(to); return; }
    // Mesmo lado e mesma duração do ponteiro de verdade (main/input:click): o desenho bate com o que o site recebe.
    const side = arcSide(from, to);
    const t0 = performance.now(), dur = ARC_MS;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const p = arcPoint(from, to, easeInOut(k), side);
      posRef.current = p; setPos(p);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target?.id]);
  if (!pos) return null;
  return <div className="agent-cursor" style={{ left: pos.x, top: pos.y }} />;
}

export default function AgentVisualOverlay({ state, ripples, metrics }: Props) {
  const active = state !== 'idle';
  return (
    <div className={`agent-overlay ${active ? 'active' : ''} state-${state}`} aria-hidden>
      {active && (
        <>
          {/* Flowing aurora frame */}
          <div className="agent-aura" />
          {/* Soft inner breathing glow */}
          <div className="agent-aura-inner" />
          {/* Minimal status pill */}
          <div className="agent-status-pill">
            <span className="agent-status-dot" />
            <span className="agent-status-text">
              {metrics
                ? `${metrics.kind === 'answer' ? t('overlay.writing') : t('overlay.thinking')}… ${metrics.estTokens} tok${metrics.tokPerSec > 0 ? ` · ${metrics.tokPerSec} tok/s` : ''}`
                : STATE_LABEL[state]}
            </span>
          </div>
        </>
      )}

      {active && <AgentCursor target={ripples[ripples.length - 1]} />}
      {ripples.map(r => (
        <div key={r.id} className="agent-ripple" style={{ left: r.x, top: r.y }}>
          <div className="ripple-core" />
          <div className="ripple-wave" />
          <div className="ripple-wave delayed" />
        </div>
      ))}
    </div>
  );
}
