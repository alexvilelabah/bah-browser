// Que codecs o arquivo baixado tem e se o QuickTime abre. Vídeo 4K do YouTube vem em AV1/VP9 (H.264 só
// vai até 1080p): o arquivo está certo (vídeo + áudio juntos), mas o QuickTime não decodifica AV1/VP9 e
// mostra só o som — parecia download quebrado. O Bah diz o codec e recomenda o VLC.

const NAMES: Record<string, string> = {
  h264: 'H.264', avc1: 'H.264', hevc: 'HEVC (H.265)', h265: 'HEVC (H.265)', av1: 'AV1', vp9: 'VP9', vp8: 'VP8',
  prores: 'ProRes', mpeg4: 'MPEG-4', aac: 'AAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC', alac: 'ALAC', ac3: 'AC-3', eac3: 'E-AC-3',
};
const QT_VIDEO = new Set(['h264', 'avc1', 'hevc', 'h265', 'prores', 'mpeg4']);
const QT_AUDIO = new Set(['aac', 'mp3', 'alac', 'ac3', 'eac3']);

export const codecName = (c?: string | null): string => (c ? NAMES[c.toLowerCase()] || c.toUpperCase() : '');

export interface CodecReport { label: string; quicktime: boolean; blocker: string }

/** "AV1 video + Opus audio"; quicktime = abre no QuickTime; blocker = o codec que impede (pro aviso). */
export function codecReport(video?: string | null, audio?: string | null): CodecReport | null {
  if (!video && !audio) return null;
  const parts = [video ? `${codecName(video)} video` : '', audio ? `${codecName(audio)} audio` : ''].filter(Boolean);
  const badVideo = video && !QT_VIDEO.has(video.toLowerCase()) ? codecName(video) : '';
  const badAudio = audio && !QT_AUDIO.has(audio.toLowerCase()) ? codecName(audio) : '';
  return { label: parts.join(' + '), quicktime: !badVideo && !badAudio, blocker: badVideo || badAudio };
}
