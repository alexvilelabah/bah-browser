// Pergunta de permissão do site (câmera, microfone, localização…), no canto de cima da aba,
// igual ao balão do Chrome. "Permitir"/"Bloquear" ficam guardados pro site; "Agora não" (✕)
// nega só desta vez. A regra e a memória ficam no main (src/main/site-permissions.ts).
import React from 'react';
import { t } from '../i18n';

export interface SitePermAsk { id: string; wcId: number; origin: string; kinds: string[]; external?: string }

const KIND_KEY: Record<string, string> = {
  camera: 'perm.camera', microphone: 'perm.microphone', geolocation: 'perm.geolocation',
  notifications: 'perm.notifications', clipboardRead: 'perm.clipboardRead', midi: 'perm.midi',
  fileSystem: 'perm.fileSystem', idleDetection: 'perm.idleDetection',
  windowManagement: 'perm.windowManagement', displayCapture: 'perm.displayCapture',
};

/** "Usar seu microfone", "Abrir um aplicativo do computador (zoommtg)"… */
export function permKindLabel(kind: string, external?: string): string {
  if (kind === 'openExternal') return external ? t('perm.openExternal', { app: external }) : t('perm.openExternalAny');
  return KIND_KEY[kind] ? t(KIND_KEY[kind]) : kind;
}

export const hostOf = (origin: string): string => { try { return new URL(origin).host; } catch { return origin; } };

// Os botões só valem depois de um instante: sem isso, uma página podia fazer a pessoa clicar
// em "Permitir" sem ver (ex.: um botão do site bem embaixo de onde o balão surge).
const ARM_DELAY_MS = 600;

export default function PermissionPrompt({ ask, onAnswer }: {
  ask?: SitePermAsk;
  onAnswer: (id: string, answer: 'allow' | 'block' | 'dismiss') => void;
}) {
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    setArmed(false);
    if (!ask) return;
    const t0 = setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => clearTimeout(t0);
  }, [ask?.id]);
  if (!ask) return null;
  const answer = (a: 'allow' | 'block' | 'dismiss') => { if (armed || a === 'dismiss') onAnswer(ask.id, a); };
  return (
    <div className="perm-prompt" role="dialog" aria-label={t('perm.title')}>
      <button className="perm-x" title={t('perm.dismiss')} aria-label={t('perm.dismiss')} onClick={() => answer('dismiss')}>✕</button>
      <div className="perm-site">{t('perm.wants', { site: hostOf(ask.origin) })}</div>
      <ul className="perm-list">
        {ask.kinds.map(k => <li key={k}>{permKindLabel(k, ask.external)}</li>)}
      </ul>
      <div className="perm-actions">
        <button className="perm-block" disabled={!armed} onClick={() => answer('block')}>{t('perm.block')}</button>
        <button className="perm-allow" disabled={!armed} onClick={() => answer('allow')}>{t('perm.allow')}</button>
      </div>
    </div>
  );
}
