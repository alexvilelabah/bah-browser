import React, { useState } from 'react';
import { t } from '../i18n';

// Card "Salvar ou Tocar" (estilo Brave/WebTorrent). Presentacional: recebe o estado do
// torrent do App e chama window.electronAPI pra tocar/salvar. Streaming = <video> apontando
// pro servidor local do motor (isolado). Salvar reusa o painel de downloads (Ctrl+J).

export interface TorrentFile { index: number; name: string; length: number }
export interface TorrentSheetData {
  uri: string;
  id?: string;
  name?: string;
  files?: TorrentFile[];
  phase: 'fetching' | 'choosing' | 'error';
  error?: string;
  stats?: { peers: number; progress: number; downloaded: number; downSpeed: number };
  saving: Record<number, boolean>;
  saved: Record<number, string>;
}

interface Props {
  torrent: TorrentSheetData;
  onSetSaving: (index: number) => void;
  onClose: () => void;
}

const VIDEO_RE = /\.(mp4|m4v|webm|mkv|mov|avi|ogv|ogg|ts|m2ts|flv|wmv|mpg|mpeg|3gp)$/i;
// Mesma família de executáveis que o download-manager bloqueia (não oferecer Salvar).
const EXE_RE = /\.(exe|msi|bat|cmd|scr|com|pif|apk|dmg|pkg|deb|rpm|js|jse|vbs|vbe|wsf|ps1|jar|lnk|hta)$/i;

function fmtBytes(n?: number): string {
  if (!n || n <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export default function TorrentSheet({ torrent, onSetSaving, onClose }: Props) {
  const [playing, setPlaying] = useState<{ index: number; url: string } | null>(null);
  const [busyPlay, setBusyPlay] = useState<number | null>(null);

  const play = async (index: number) => {
    if (!torrent.id) return;
    setBusyPlay(index);
    try {
      const r: any = await window.electronAPI?.torrentPlay?.(torrent.id, index);
      if (r?.ok && r.url) setPlaying({ index, url: r.url });
    } finally { setBusyPlay(null); }
  };
  const save = (index: number) => {
    if (!torrent.id) return;
    onSetSaving(index);
    window.electronAPI?.torrentSaveFile?.(torrent.id, index);
  };
  const reveal = (p: string) => { try { window.electronAPI?.revealInFolder?.(p); } catch {} };

  const files = torrent.files || [];
  const totalSize = files.reduce((s, f) => s + f.length, 0);

  return (
    <div className="torrent-scrim" onClick={onClose}>
      <div className="torrent-sheet" onClick={e => e.stopPropagation()}>
        <div className="tsheet-head">
          <div className="tsheet-title">{torrent.phase === 'fetching' ? t('torrent.fetching') : (torrent.name || t('torrent.fetching'))}</div>
          <button className="tsheet-x" onClick={onClose} title={t('torrent.close')}>✕</button>
        </div>

        {torrent.phase === 'choosing' && (
          <div className="tsheet-meta">
            {files.length} {files.length === 1 ? t('torrent.file') : t('torrent.filesN')} · {fmtBytes(totalSize)}
            {torrent.stats && <span className="tsheet-peers"> · {torrent.stats.peers} {t('torrent.peers')}</span>}
          </div>
        )}

        {torrent.phase === 'fetching' && (
          <div className="tsheet-rows">
            <div className="tsheet-skel" /><div className="tsheet-skel" /><div className="tsheet-skel short" />
          </div>
        )}

        {torrent.phase === 'error' && (
          <div className="tsheet-empty">
            {torrent.error === 'timeout' ? t('torrent.noPeers') : (torrent.error || t('torrent.failed'))}
          </div>
        )}

        {torrent.phase === 'choosing' && (
          <div className="tsheet-rows">
            {files.map(f => {
              const isVideo = VIDEO_RE.test(f.name);
              const isExe = EXE_RE.test(f.name);
              const saved = torrent.saved[f.index];
              const saving = torrent.saving[f.index];
              const isPlaying = playing?.index === f.index;
              return (
                <div className={`tsheet-row${isPlaying ? ' playing' : ''}`} key={f.index}>
                  <div className="tsheet-row-main">
                    <span className="tsheet-fname" title={f.name}>{isVideo ? '🎬' : isExe ? '⚠️' : '📄'} {f.name}</span>
                    <span className="tsheet-fsize">{fmtBytes(f.length)}</span>
                    <div className="tsheet-actions">
                      {isExe ? (
                        <span className="tsheet-blocked">{t('torrent.blockedType')}</span>
                      ) : saved ? (
                        <button className="tsheet-ghost" onClick={() => reveal(saved)}>{t('torrent.reveal')}</button>
                      ) : (
                        <>
                          {isVideo && !isPlaying && (
                            <button className="tsheet-play" disabled={busyPlay === f.index} onClick={() => play(f.index)}>
                              {busyPlay === f.index ? t('torrent.buffering') : `▶ ${t('torrent.play')}`}
                            </button>
                          )}
                          <button className="tsheet-ghost" disabled={saving} onClick={() => save(f.index)}>
                            {saving ? t('torrent.saving') : t('torrent.save')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {isPlaying && (
                    <video className="tsheet-video" src={playing!.url} controls autoPlay />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="tsheet-note">🔒 {t('torrent.legalNote')}</div>
      </div>
    </div>
  );
}
