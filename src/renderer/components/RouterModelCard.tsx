import React, { useState } from 'react';
import { t } from '../i18n';
import type { RouterStatus } from '../../shared/router-routes';

// Card do roteador local nas configurações do assistente. O download (1,1 GB, Hugging Face) só
// começa no clique — é o consentimento. Depois mostra carregando / ligado (backend) / erro.
export default function RouterModelCard({ status }: { status?: RouterStatus }) {
  const [asked, setAsked] = useState(false);
  const st = status || { state: 'not-downloaded' as const };
  const start = () => { setAsked(true); window.electronAPI?.routerDownload?.().finally(() => setAsked(false)); };
  return (
    <div className="router-card set-active-ai" data-testid="router-card" data-state={st.state}>
      <b>{t('router.title')}</b>
      {st.state === 'not-downloaded' && (
        <>
          <div>{t('router.ask')}</div>
          <small>{t('router.why')}</small>
          <button type="button" className="router-dl" disabled={asked} onClick={start}>{t('router.download')}</button>
        </>
      )}
      {st.state === 'downloading' && (
        <>
          <div>{t('router.downloading', { pct: Math.floor((st.progress || 0) * 100) })}</div>
          <progress max={1} value={st.progress || 0} />
        </>
      )}
      {st.state === 'loading' && <div>{t('router.loading')}</div>}
      {st.state === 'ready' && <div>{t('router.ready', { backend: st.backend })}</div>}
      {st.state === 'error' && (
        <>
          <div>{t('router.error', { error: st.error })}</div>
          <button type="button" className="router-dl" disabled={asked} onClick={start}>{t('router.retry')}</button>
        </>
      )}
    </div>
  );
}
