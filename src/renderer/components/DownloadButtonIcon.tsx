// Ícone do botão de downloads com o anel de progresso do Chrome (lógica em download-ring.ts).
import { useEffect, useRef, useState } from 'react';
import { ringDash, ringState, type RingDownload } from '../download-ring';

const R = 10;

export default function DownloadButtonIcon({ downloads }: { downloads: readonly RingDownload[] }) {
  const ring = ringState(downloads);
  // Terminou tudo agora (tinha ativo, não tem mais) → anel cheio piscando ~1,6 s, como o "pronto" do Chrome.
  const [justDone, setJustDone] = useState(false);
  const wasActive = useRef(false);
  useEffect(() => {
    const active = ring.kind !== 'idle';
    if (wasActive.current && !active && downloads.some(d => d.state === 'completed')) {
      setJustDone(true);
      const tm = setTimeout(() => setJustDone(false), 1600);
      wasActive.current = active;
      return () => clearTimeout(tm);
    }
    wasActive.current = active;
  }, [ring.kind, downloads]);

  const showRing = ring.kind !== 'idle' || justDone;
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"
      className={`dl-ring${ring.kind === 'indeterminate' ? ' spin' : ''}${justDone ? ' done' : ''}${ring.kind === 'progress' && ring.paused ? ' paused' : ''}`}
      data-testid="dl-ring" data-ring={justDone ? 'done' : ring.kind} data-fraction={ring.kind === 'progress' ? ring.fraction.toFixed(3) : ''}>
      {showRing ? (
        <>
          <circle cx="12" cy="12" r={R} strokeWidth="2" className="dl-ring-track" />
          <circle cx="12" cy="12" r={R} strokeWidth="2" strokeLinecap="round" className="dl-ring-arc"
            strokeDasharray={justDone ? ringDash(1, R) : ring.kind === 'progress' ? ringDash(ring.fraction, R) : ringDash(0.25, R)}
            transform="rotate(-90 12 12)" />
          <path d="M12 7.5v7M9 11.5l3 3 3-3" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <g strokeWidth="2"><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></g>
      )}
    </svg>
  );
}
