import React from 'react';

export type AgentVisualState = 'idle' | 'observing' | 'thinking' | 'acting';

export interface ClickRipple {
  id: number;
  x: number;
  y: number;
}

interface Props {
  state: AgentVisualState;
  ripples: ClickRipple[];
}

const STATE_LABEL: Record<AgentVisualState, string> = {
  idle: '',
  observing: 'lendo a página',
  thinking: 'pensando',
  acting: 'agindo',
};

// Comet-style overlay: a soft flowing aurora glow around the viewport edges
// that breathes while the agent works. No grids/reticles — just an elegant
// perimeter of colored light, tinted by the current state.
export default function AgentVisualOverlay({ state, ripples }: Props) {
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
            <span className="agent-status-text">{STATE_LABEL[state]}</span>
          </div>
        </>
      )}

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
