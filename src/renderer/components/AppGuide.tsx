import { useEffect } from 'react';
import { t, tourSteps } from '../i18n';

/** Plain-words intro for someone who has never used an agent browser. Same shape as the
 * re-login bar; dismissing it is permanent. */
export function AppGuideBar(props: { onStartTour: () => void; onDismiss: () => void }) {
  const { onStartTour, onDismiss } = props;
  return (
    <div className="guide-bar">
      <span className="guide-title">🪄 {t('guide.title')}</span>
      <span className="guide-text">{t('guide.text')}</span>
      <button className="guide-btn" onClick={onStartTour}>{t('guide.tour')}</button>
      <button className="guide-x" onClick={onDismiss} title={t('guide.dismiss')}>✕</button>
    </div>
  );
}

/** Five steps, one screen. Shown once, reopenable from the guide bar. */
export function BeginnerTour(props: { onClose: () => void }) {
  const { onClose } = props;
  const steps = tourSteps();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="tour-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t('tour.title')}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="tour-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="tour-head">
          <span className="tour-title">🪄 {t('tour.title')}</span>
          <button className="tour-x" onClick={onClose} title={t('tour.skip')}>✕</button>
        </div>
        <ol className="tour-list">
          {steps.map((s, i) => (
            <li key={i} className="tour-step">
              <span className="tour-step-icon">{s.icon}</span>
              <div className="tour-step-body">
                <div className="tour-step-title">{s.title}</div>
                <div className="tour-step-text">{s.text}</div>
              </div>
            </li>
          ))}
        </ol>
        <div className="tour-foot">
          <button className="tour-btn tour-btn-primary" onClick={onClose}>{t('tour.got')}</button>
        </div>
      </div>
    </div>
  );
}
