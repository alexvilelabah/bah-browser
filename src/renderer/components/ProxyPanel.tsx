import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { SECURE_DNS_PRESETS, type SecureDnsSetting, type SecureDnsMode } from '../../shared/secure-dns';

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
      <div className="tour-card proxy-card proxy-settings" onClick={e => e.stopPropagation()}>
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
        <SecureDnsSettings proxyActive={cfg.mode === 'manual' || cfg.mode === 'pac'} />
      </div>
    </div>
  );
}

/** DNS seguro (DoH): sistema (padrão) / provedor público / NextDNS / servidor próprio; estrito opcional. */
function SecureDnsSettings(props: { proxyActive: boolean }) {
  const api = window.electronAPI as any;
  const [s, setS] = useState<SecureDnsSetting>({ mode: 'system' });
  const [status, setStatus] = useState('');

  useEffect(() => { api?.secureDnsGet?.().then((r: any) => { if (r?.setting) setS(r.setting); }); }, []);
  const set = (patch: Partial<SecureDnsSetting>) => { setS(c => ({ ...c, ...patch })); setStatus(''); };
  const save = async () => {
    const r = await api?.secureDnsSet?.(s);
    if (r?.ok && r.setting) setS(r.setting);
    setStatus(r?.ok ? t('dns.saved') : `${t('dns.error')}: ${r?.error || ''}`);
  };
  const yn = (b: boolean) => t(b ? 'dns.yes' : 'dns.no');

  return (
    <section className="dns-section" aria-label={t('dns.title')}>
      <div className="dns-title">🔒 {t('dns.title')}</div>
      <div className="proxy-hint">{t('dns.intro')}</div>
      <label className="proxy-row">
        <span>{t('dns.mode')}</span>
        <select className="dns-mode" value={s.mode} onChange={e => {
          const mode = e.target.value as SecureDnsMode;
          set(mode === 'preset' && !s.preset ? { mode, preset: SECURE_DNS_PRESETS[0].id } : { mode });
        }}>
          <option value="system">{t('dns.mode.system')}</option>
          <option value="preset">{t('dns.mode.preset')}</option>
          <option value="nextdns">{t('dns.mode.nextdns')}</option>
          <option value="custom">{t('dns.mode.custom')}</option>
        </select>
      </label>
      {s.mode === 'system' && <div className="proxy-hint">{t('dns.hint.system')}</div>}
      {s.mode === 'preset' && (
        <div className="dns-presets" role="radiogroup">
          {SECURE_DNS_PRESETS.map(p => (
            <label key={p.id} className={`dns-preset${s.preset === p.id ? ' on' : ''}`} data-preset={p.id}>
              <input type="radio" name="dns-preset" checked={s.preset === p.id} onChange={() => set({ preset: p.id })} />
              <span className="dns-preset-body">
                <span className="dns-preset-name">{p.name}</span>
                <span className="dns-preset-url">{p.url}</span>
                <span className="dns-preset-tags">
                  {t('dns.adBlocking')}: {yn(p.adBlocking)}{p.malwareBlocking ? ` (${t('dns.malware')})` : ''} · {t('dns.signup')}: {t('dns.none')} · {t('dns.manageLists')}: {yn(p.userManagedLists)}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
      {s.mode === 'nextdns' && (<>
        <label className="proxy-row">
          <span>{t('dns.nextdnsId')}</span>
          <input className="dns-nextdns" value={s.nextdnsId || ''} placeholder="abc123" spellCheck={false} onChange={e => set({ nextdnsId: e.target.value })} />
        </label>
        <div className="proxy-hint">{t('dns.hint.nextdns')}</div>
      </>)}
      {s.mode === 'custom' && (<>
        <label className="proxy-row">
          <span>{t('dns.customUrl')}</span>
          <input className="dns-custom" value={s.customUrl || ''} placeholder="https://pihole.lan/dns-query" spellCheck={false} onChange={e => set({ customUrl: e.target.value })} />
        </label>
        <div className="proxy-hint">{t('dns.hint.custom')}</div>
      </>)}
      {s.mode !== 'system' && (<>
        <label className="proxy-check">
          <input type="checkbox" className="dns-strict" checked={!!s.strict} onChange={e => set({ strict: e.target.checked })} />
          <span>{t('dns.strict')}</span>
        </label>
        <div className="proxy-hint">{t('dns.strictHint')}</div>
      </>)}
      {props.proxyActive && <div className="proxy-note dns-proxy-note">{t('dns.proxyNote')}</div>}
      {status && <div className="proxy-status dns-status">{status}</div>}
      <div className="tour-foot proxy-foot">
        <button className="tour-btn tour-btn-primary dns-save" onClick={save}>{t('dns.save')}</button>
      </div>
    </section>
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
