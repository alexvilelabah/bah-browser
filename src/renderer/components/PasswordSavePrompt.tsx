// "Salvar senha?" / "Atualizar senha?" depois do login, no canto da aba (do lado do endereço, como o
// balão da chave do Chrome). Mesmo molde do balão de permissão (PermissionPrompt.tsx): botões só
// valem depois de um instante, pra página não fazer a pessoa clicar sem ver.
// A senha fica no main: aqui chega só o tamanho (as bolinhas). O olho pede a senha ao main — é a que
// a própria pessoa acabou de digitar — e ela some daqui quando o balão fecha.
import React from 'react';
import { t } from '../i18n';
import type { PwOffer } from '../../shared/password-types';

const ARM_DELAY_MS = 600;

export default function PasswordSavePrompt({ offer, onAnswer, onReveal }: {
  offer?: PwOffer;
  onAnswer: (id: string, answer: 'save' | 'never' | 'dismiss', username?: string) => Promise<boolean>;
  onReveal: (id: string) => Promise<string | null>;
}) {
  const [armed, setArmed] = React.useState(false);
  const [username, setUsername] = React.useState('');
  const [shown, setShown] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    setArmed(false); setShown(null); setFailed(false);
    setUsername(offer?.username || '');
    if (!offer) return;
    const tm = setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => clearTimeout(tm);
  }, [offer?.id]);
  if (!offer) return null;
  const answer = async (a: 'save' | 'never' | 'dismiss') => {
    if (!armed && a !== 'dismiss') return;
    const ok = await onAnswer(offer.id, a, a === 'save' ? username : undefined);
    if (!ok) setFailed(true);
  };
  const eye = async () => {
    if (shown !== null) { setShown(null); return; }
    setShown(await onReveal(offer.id));
  };
  const dots = '•'.repeat(Math.max(4, Math.min(offer.length, 18)));
  return (
    <div className="perm-prompt pw-prompt" role="dialog" aria-label={offer.update ? t('pw.offer.update', { site: offer.host }) : t('pw.offer.save', { site: offer.host })}>
      <button className="perm-x" title={t('pw.offer.close')} aria-label={t('pw.offer.close')} onClick={() => answer('dismiss')}>✕</button>
      <div className="perm-site">🔑 {offer.update ? t('pw.offer.update', { site: offer.host }) : t('pw.offer.save', { site: offer.host })}</div>
      <div className="pw-fields">
        <label className="pw-field">
          <span>{t('pw.offer.username')}</span>
          <input
            className="pw-input" value={username} spellCheck={false} autoComplete="off" maxLength={512}
            placeholder={t('pw.offer.noUsername')}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') answer('save'); if (e.key === 'Escape') answer('dismiss'); }}
          />
        </label>
        <div className="pw-field">
          <span>{t('pw.offer.password')}</span>
          <div className="pw-secret">
            <span className={`pw-secret-text${shown === null ? ' masked' : ''}`}>{shown ?? dots}</span>
            <button className="pw-eye" onClick={eye} title={shown === null ? t('pw.show') : t('pw.hide')} aria-label={shown === null ? t('pw.show') : t('pw.hide')}>
              {shown === null ? '👁' : '🙈'}
            </button>
          </div>
        </div>
      </div>
      <div className="pw-note">{failed ? t('pw.offer.failed') : t('pw.offer.local')}</div>
      <div className="perm-actions">
        {offer.update
          ? <button className="perm-block" onClick={() => answer('dismiss')}>{t('pw.offer.notNow')}</button>
          : <button className="perm-block" disabled={!armed} onClick={() => answer('never')}>{t('pw.offer.never')}</button>}
        <button className="perm-allow" disabled={!armed} onClick={() => answer('save')}>{offer.update ? t('pw.offer.updateBtn') : t('pw.offer.saveBtn')}</button>
      </div>
    </div>
  );
}
