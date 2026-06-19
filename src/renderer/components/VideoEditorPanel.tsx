import React, { useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// EDITOR DE VÍDEO — você ENVIA um vídeo (arrasta ou escolhe) e o navegador EDITA
// com o ffmpeg NATIVO (rápido). Faz o que o fastcut.cc faz, sem sair do navegador
// e sem gastar IA: cortar trecho, remover silêncio, extrair áudio. Clique → pronto.
// Tudo determinístico (0 token). O resultado vai pro Downloads; clique abre a pasta.
// ─────────────────────────────────────────────────────────────────────────────

const api = () => (window as any).electronAPI;

// "1:30" / "1:02:03" / "90" / "90.5" → segundos. null se inválido.
function parseTime(raw: string): number | null {
  const s = (raw || '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(':').map(p => p.trim());
  if (parts.length > 3 || parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + parseFloat(p), 0);
}

// Sininho suave (2 notas, Web Audio, sem arquivo) ao terminar.
function chime() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const beep = (freq: number, at: number) => {
      const o = ac.createOscillator(); const g = ac.createGain();
      o.connect(g); g.connect(ac.destination); o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ac.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.13, ac.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + at + 0.35);
      o.start(ac.currentTime + at); o.stop(ac.currentTime + at + 0.37);
    };
    beep(880, 0); beep(1245, 0.13);
    setTimeout(() => { try { ac.close(); } catch {} }, 800);
  } catch {}
}

type Result = { ok: boolean; message: string; path?: string; dir?: string };

export default function VideoEditorPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [videoPath, setVideoPath] = useState<string>('');
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ message: string; percent?: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [showTrim, setShowTrim] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const unsubRef = useRef<null | (() => void)>(null);

  const fileName = videoPath ? videoPath.split(/[\\/]/).pop() : '';
  const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
  const reveal = (target?: string) => { try { if (target) api()?.revealInFolder?.(target); } catch {} };

  const loadFromDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    let p = '';
    try { p = api()?.getPathForFile?.(f) || (f as any).path || ''; } catch { p = (f as any).path || ''; }
    if (p) { setVideoPath(p); setResult(null); setShowTrim(false); }
  };

  const pick = async () => {
    try {
      const r = await api()?.pickVideo?.();
      if (r && !r.canceled && r.path) { setVideoPath(r.path); setResult(null); setShowTrim(false); }
    } catch {}
  };

  // Roda uma operação, ouvindo o progresso e tocando o sininho no fim.
  const runOp = async (fn: () => Promise<any>, runningMsg: string) => {
    if (busy || !videoPath) return;
    setBusy(true); setResult(null); setProgress({ message: runningMsg });
    try { unsubRef.current = api()?.onVideoEditProgress?.((p: any) => setProgress({ message: p.message || runningMsg, percent: p.percent })); } catch {}
    let res: any;
    try { res = await fn(); } catch (e: any) { res = { success: false, error: String(e?.message ?? e) }; }
    try { unsubRef.current?.(); } catch {} finally { unsubRef.current = null; }
    setProgress(null); setBusy(false);
    if (res?.success && res.path) {
      setResult({ ok: true, message: 'Pronto! Salvo em Downloads.', path: res.path, dir: dirOf(res.path) });
      chime();
    } else if (res?.success && res?.info?.message) {
      setResult({ ok: true, message: res.info.message });   // ex.: "nenhum silêncio encontrado"
    } else {
      setResult({ ok: false, message: res?.error || 'Não deu certo. Tente outro vídeo.' });
    }
  };

  const doTrim = () => {
    const a = parseTime(from), b = parseTime(to);
    if (a == null || b == null) { setResult({ ok: false, message: 'Use o formato min:seg, ex.: 1:00 e 2:30.' }); return; }
    if (!(b > a)) { setResult({ ok: false, message: 'O fim precisa ser depois do início.' }); return; }
    runOp(() => api()?.editTrim?.(videoPath, a, b), 'Cortando o trecho…');
  };

  return (
    <div className="vedit">
      <button className="vedit-head" onClick={onToggle} title="Editar um vídeo do seu computador">
        <span>🎬 Editor de vídeo</span>
        <span className="vedit-head-sub">{open ? '▲' : 'arraste um vídeo aqui ▼'}</span>
      </button>

      {open && (
        <div className="vedit-body">
          {/* Zona de envio (arraste ou clique) */}
          <div
            className={`vedit-drop ${drag ? 'over' : ''} ${videoPath ? 'has' : ''}`}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={loadFromDrop}
            onClick={() => { if (!videoPath) pick(); }}
          >
            {videoPath ? (
              <div className="vedit-file">
                <span className="vedit-file-ic">🎞️</span>
                <span className="vedit-file-name" title={videoPath}>{fileName}</span>
                <button className="vedit-file-x" title="Trocar vídeo" onClick={e => { e.stopPropagation(); setVideoPath(''); setResult(null); setShowTrim(false); }}>✕</button>
              </div>
            ) : (
              <>
                <div className="vedit-drop-ic">⬇️</div>
                <div className="vedit-drop-t">Arraste um vídeo aqui</div>
                <div className="vedit-drop-s">ou clique pra escolher do computador</div>
              </>
            )}
          </div>

          {/* Operações (só com vídeo carregado) */}
          {videoPath && (
            <div className="vedit-ops">
              <button className="vedit-op" disabled={busy} onClick={() => { setShowTrim(s => !s); setResult(null); }}>✂️ Cortar trecho</button>
              <button className="vedit-op" disabled={busy} onClick={() => runOp(() => api()?.editRemoveSilence?.(videoPath, {}), 'Removendo o silêncio…')}>🔇 Remover silêncio</button>
              <button className="vedit-op" disabled={busy} onClick={() => runOp(() => api()?.editExtractAudio?.(videoPath), 'Extraindo o áudio…')}>🎵 Extrair áudio</button>
            </div>
          )}

          {/* Entradas do corte (de / até) */}
          {videoPath && showTrim && (
            <div className="vedit-trim">
              <span>de</span>
              <input className="vedit-time" value={from} onChange={e => setFrom(e.target.value)} placeholder="1:00" disabled={busy} />
              <span>até</span>
              <input className="vedit-time" value={to} onChange={e => setTo(e.target.value)} placeholder="2:30" disabled={busy} />
              <button className="vedit-trim-go" disabled={busy} onClick={doTrim}>Cortar</button>
            </div>
          )}

          {/* Progresso */}
          {busy && progress && (
            <div className="vedit-prog">
              <div className="vedit-prog-row">
                <span className="vedit-spinner" />
                <span className="vedit-prog-msg">{progress.message}</span>
                {progress.percent != null && <span className="vedit-prog-pct">{progress.percent}%</span>}
              </div>
              {progress.percent != null && (
                <div className="vedit-bar"><div className="vedit-bar-fill" style={{ width: `${progress.percent}%` }} /></div>
              )}
            </div>
          )}

          {/* Resultado */}
          {result && !busy && (
            result.ok && result.path ? (
              <div className="vedit-res ok" onClick={() => reveal(result.path)} title="Clique para abrir a pasta">
                ✅ {result.message} <span className="vedit-res-open">— abrir pasta ↗</span>
              </div>
            ) : result.ok ? (
              <div className="vedit-res info">ℹ️ {result.message}</div>
            ) : (
              <div className="vedit-res err">⚠️ {result.message}</div>
            )
          )}
        </div>
      )}
    </div>
  );
}
