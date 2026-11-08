import { useEffect, useState } from 'react';
import { t } from '../i18n';
import type { ApplicantProfile } from '../../shared/form-fill';

type Key = Exclude<keyof ApplicantProfile, 'voluntary'>;
const TEXT: Key[] = ['firstName', 'lastName', 'preferredName', 'email', 'phone', 'address', 'city', 'state', 'postalCode', 'country',
  'linkedin', 'github', 'website', 'currentCompany', 'currentTitle', 'yearsExperience', 'startDate', 'salaryExpectation', 'pronouns', 'howHeard'];
const YESNO: Key[] = ['workAuthorized', 'needsSponsorship', 'willingToRelocate'];

/** 📝 Perfil de candidatura: o que o Bah preenche nos formulários por código + respostas salvas. */
export function ApplicantPanel(props: { onClose: () => void }) {
  const api = window.electronAPI as any;
  const [p, setP] = useState<ApplicantProfile>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [available, setAvailable] = useState(true);
  const [status, setStatus] = useState('');

  const load = async () => { const r = await api?.applicantGet?.(); if (r) { setP(r.profile || {}); setAnswers(r.answers || {}); setAvailable(!!r.available); } };
  useEffect(() => { void load(); }, []);
  const set = (k: keyof ApplicantProfile, v: string) => setP(x => ({ ...x, [k]: v }));
  const save = async () => { const r = await api?.applicantSetProfile?.(p); setStatus(r?.ok ? t('applicant.saved') : t('applicant.unavailable')); };

  return (
    <div className="tour-backdrop" onClick={props.onClose}>
      <div className="tour-card proxy-card applicant-panel" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="tour-head">
          <span className="tour-title">📝 {t('applicant.title')}</span>
          <button className="tour-x" onClick={props.onClose} aria-label={t('proxy.close')}>✕</button>
        </div>
        <div className="proxy-hint">{available ? t('applicant.hint') : t('applicant.unavailable')}</div>

        {TEXT.map(k => (
          <label key={k} className="proxy-row">
            <span>{t(`applicant.f.${k}`)}</span>
            <input className={`applicant-${k}`} value={(p as any)[k] || ''} onChange={e => set(k, e.target.value)}
              type={k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text'} autoComplete="off" />
          </label>
        ))}
        {YESNO.map(k => (
          <label key={k} className="proxy-row">
            <span>{t(`applicant.f.${k}`)}</span>
            <select className={`applicant-${k}`} value={(p as any)[k] || ''} onChange={e => set(k, e.target.value)}>
              <option value="">—</option>
              <option value="yes">{t('applicant.yes')}</option>
              <option value="no">{t('applicant.no')}</option>
            </select>
          </label>
        ))}
        <label className="proxy-row">
          <span>{t('applicant.voluntary')}</span>
          <select className="applicant-voluntary" value={p.voluntary || 'decline'} onChange={e => set('voluntary', e.target.value)}>
            <option value="decline">{t('applicant.voluntary.decline')}</option>
            <option value="ask">{t('applicant.voluntary.ask')}</option>
          </select>
        </label>

        <div className="proxy-row"><span><b>{t('applicant.answers')}</b></span></div>
        {Object.keys(answers).length === 0
          ? <div className="proxy-hint">{t('applicant.noAnswers')}</div>
          : Object.entries(answers).map(([q, a]) => (
            <div key={q} className="proxy-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, fontSize: 12 }}><div style={{ opacity: 0.7 }}>{q}</div><div>{a}</div></div>
              <button className="tour-btn" onClick={async () => { await api?.applicantDeleteAnswer?.(q); await load(); }}>{t('applicant.delete')}</button>
            </div>
          ))}

        {status && <div className="proxy-status">{status}</div>}
        <div className="tour-foot proxy-foot">
          <button className="tour-btn" onClick={async () => { await api?.applicantClear?.(); await load(); setStatus(''); }}>{t('applicant.clear')}</button>
          <button className="tour-btn tour-btn-primary applicant-save" onClick={save} disabled={!available}>{t('proxy.save')}</button>
        </div>
      </div>
    </div>
  );
}
