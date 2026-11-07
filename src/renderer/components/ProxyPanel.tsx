import { useEffect, useState } from 'react';
import { t } from '../i18n';

type Mode = 'system' | 'manual' | 'pac' | 'direct';
type ProxyConfig = { mode: Mode; server?: string; pacUrl?: string; bypass?: string };
type AuthReq = { id: number; host: string; port: number; realm?: string; scheme?: string };

/** Rede e proxy (paridade com o Chrome): modo, servidor, exceções, PAC, teste e senhas salvas. */
export function ProxySettings(props: { onClose: () => void }) {
  const api = window.electronAPI as any;
  const [cfg, setCfg] = useState<ProxyConfig>({ mode: 'system' });
  const [fromEnv, setFromEnv] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api?.proxyGet?.().then((r: any) => { if (r?.config) setCfg(r.config); setFromEnv(!!r?.fromEnv); setHasSaved(!!r?.hasSavedPassword); });
  }, []);

  const save = async () => {
    const r = await api?.proxySet?.(cfg);
    setStatus(r?.ok ? t('proxy.saved') : `${t('proxy.error')}: ${r?.error || ''}`);
  };
  const test = async () => {
    setStatus(t('proxy.testing'));
    const r = await api?.proxyTest?.();
    setStatus(r?.ok ? t('proxy.testOk', { via: r.via || 'DIRECT' }) : t('proxy.testFail', { via: r?.via || '?', error: r?.error || `HTTP ${r?.status}` }));
  };
  const forget = async () => { await api?.proxyForgetPasswords?.(); setHasSaved(false); setStatus(t('proxy.forgotten')); };
  const set = (k: keyof ProxyConfig, v: string) => setCfg(c => ({ ...c, [k]: v }));

  return (
    <div className="tour-backdrop" onClick={props.onClose}>
      <div className="tour-card proxy-card" onClick={e => e.stopPropagation()}>
        <div className="tour-head">
          <span className="tour-title">🌐 {t('proxy.title')}</span>
          <button className="tour-x" onClick={props.onClose} aria-label={t('proxy.close')}>✕</button>
        </div>
        {fromEnv && <div className="proxy-note">{t('proxy.fromEnv')}</div>}
        <label className="proxy-row">
          <span>{t('proxy.mode')}</span>
          <select className="proxy-mode" value={cfg.mode} onChange={e => set('mode', e.target.value)}>
            <option value="system">{t('proxy.mode.system')}</option>
            <option value="manual">{t('proxy.mode.manual')}</option>
            <option value="pac">{t('proxy.mode.pac')}</option>
            <option value="direct">{t('proxy.mode.direct')}</option>
          </select>
        </label>
        {cfg.mode === 'manual' && (
          <label className="proxy-row">
            <span>{t('proxy.server')}</span>
            <input className="proxy-server" value={cfg.server || ''} placeholder="proxy.example.com:8080" onChange={e => set('server', e.target.value)} />
          </label>
        )}
        {cfg.mode === 'pac' && (
          <label className="proxy-row">
            <span>{t('proxy.pacUrl')}</span>
            <input className="proxy-pac" value={cfg.pacUrl || ''} placeholder="http://wpad/wpad.dat" onChange={e => set('pacUrl', e.target.value)} />
          </label>
        )}
        {(cfg.mode === 'manual' || cfg.mode === 'pac') && (
          <label className="proxy-row">
            <span>{t('proxy.bypass')}</span>
            <input className="proxy-bypass" value={cfg.bypass || ''} placeholder="localhost, *.corp.example.com" onChange={e => set('bypass', e.target.value)} />
          </label>
        )}
        <div className="proxy-hint">{t(`proxy.hint.${cfg.mode}`)}</div>
        {status && <div className="proxy-status">{status}</div>}
        <div className="tour-foot proxy-foot">
          {hasSaved && <button className="tour-btn proxy-forget" onClick={forget}>{t('proxy.forget')}</button>}
          <button className="tour-btn proxy-test" onClick={test}>{t('proxy.test')}</button>
          <button className="tour-btn tour-btn-primary proxy-save" onClick={save}>{t('proxy.save')}</button>
        </div>
      </div>
    </div>
  );
}

/** Login no proxy (HTTP 407). A senha vai direto pro motor; nunca pro agente/modelo. */
export function ProxyAuthPrompt() {
  const api = window.electronAPI as any;
  const [queue, setQueue] = useState<AuthReq[]>([]);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [remember, setRemember] = useState(true);

  useEffect(() => api?.onProxyAuthRequest?.((r: AuthReq) => setQueue(q => [...q, r])), []);
  const req = queue[0];
  if (!req) return null;

  const answer = (r: { user: string; pass: string; remember: boolean } | null) => {
    void api?.proxyAuthResponse?.(req.id, r);
    setQueue(q => q.slice(1));
    setPass('');
  };

  return (
    <div className="tour-backdrop proxy-auth">
      <form className="tour-card proxy-card" onSubmit={e => { e.preventDefault(); answer({ user, pass, remember }); }}>
        <div className="tour-head">
          <span className="tour-title">🔐 {t('proxy.authTitle')}</span>
        </div>
        <div className="proxy-note">{t('proxy.authText', { host: `${req.host}:${req.port}`, realm: req.realm || '' })}</div>
        <label className="proxy-row">
          <span>{t('proxy.user')}</span>
          <input className="proxy-user" autoFocus value={user} autoComplete="username" onChange={e => setUser(e.target.value)} />
        </label>
        <label className="proxy-row">
          <span>{t('proxy.pass')}</span>
          <input className="proxy-pass" type="password" value={pass} autoComplete="current-password" onChange={e => setPass(e.target.value)} />
        </label>
        <label className="proxy-check">
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
          <span>{t('proxy.remember')}</span>
        </label>
        <div className="tour-foot proxy-foot">
          <button type="button" className="tour-btn proxy-cancel" onClick={() => answer(null)}>{t('proxy.cancel')}</button>
          <button type="submit" className="tour-btn tour-btn-primary proxy-signin">{t('proxy.signIn')}</button>
        </div>
      </form>
    </div>
  );
}
