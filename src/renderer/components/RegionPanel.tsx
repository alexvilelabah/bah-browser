import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import { refreshRegion, type RegionState } from '../region-state';
import type { RegionSettings } from '../../shared/region';

const regionNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
const countryName = (c: string) => (c && regionNames?.of(c)) || c;
/** Todos os códigos ISO de país que o Intl conhece, ordenados pelo nome. */
const COUNTRIES = (() => {
  const out: Array<{ code: string; name: string }> = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    const name = regionNames?.of(code);
    if (name && name !== code && !/unknown/i.test(name)) out.push({ code, name });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
})();
const ZONES: string[] = (() => { try { return (Intl as any).supportedValuesOf('timeZone'); } catch { return []; } })();
const timeIn = (zone: string) => { try { return new Date().toLocaleTimeString([], { timeZone: zone || undefined, hour: '2-digit', minute: '2-digit', weekday: 'short' }); } catch { return ''; } };

/** 🌍 Região e hora: país das compras/buscas e fuso que os sites veem. */
export function RegionPanel(props: { onClose: () => void }) {
  const api = window.electronAPI as any;
  const [st, setSt] = useState<RegionState | null>(null);
  const [s, setS] = useState<RegionSettings>({ shopping: 'auto', tz: 'os' });
  const [zoneText, setZoneText] = useState('');
  const [status, setStatus] = useState('');

  const load = async (force: boolean | 'peek') => { const r = await refreshRegion(force); if (r) { setSt(r); setS(r.settings); setZoneText(r.settings.zone || ''); } };
  useEffect(() => { void load(false); }, []);

  const zoneOk = useMemo(() => ZONES.includes(zoneText) || zoneText === 'UTC', [zoneText]);
  const save = async () => {
    if (s.tz === 'zone' && !zoneOk) { setStatus(t('region.badZone')); return; }
    const r = await api?.regionSet?.({ ...s, zone: s.tz === 'zone' ? zoneText : s.zone });
    if (r) { setSt(r); setS(r.settings); }
    await refreshRegion('peek');
    setStatus(t('region.saved'));
  };
  const set = (patch: Partial<RegionSettings>) => setS(x => ({ ...x, ...patch }));
  const net = st?.network || '';

  return (
    <div className="tour-backdrop" onClick={props.onClose}>
      <div className="tour-card proxy-card region-panel" onClick={e => e.stopPropagation()}>
        <div className="tour-head">
          <span className="tour-title">🌍 {t('region.title')}</span>
          <button className="tour-x" onClick={props.onClose} aria-label={t('proxy.close')}>✕</button>
        </div>

        <div className="proxy-row">
          <span>{t('region.network')}</span>
          <div className="region-net">
            <b className="region-net-country">{s.shopping !== 'auto' ? t('region.notChecked') : net ? `${countryName(net)} (${net})` : t('region.unknown')}</b>
            {s.shopping === 'auto' && <button className="tour-btn region-recheck" onClick={() => load(true)}>{t('region.recheck')}</button>}
          </div>
          {net && st?.os && net !== st.os && s.shopping === 'auto' && <div className="proxy-hint">{t('region.vpnHint', { net: countryName(net), os: countryName(st.os) })}</div>}
        </div>

        <label className="proxy-row">
          <span>{t('region.shopping')}</span>
          <select className="region-shopping" value={s.shopping} onChange={e => set({ shopping: e.target.value as any })}>
            <option value="auto">{t('region.shop.auto')}</option>
            <option value="os">{t('region.shop.os', { country: countryName(st?.os || '') || '?' })}</option>
            <option value="fixed">{t('region.shop.fixed')}</option>
          </select>
        </label>
        {s.shopping === 'fixed' && (
          <select className="region-country" value={s.fixedCountry || ''} onChange={e => set({ fixedCountry: e.target.value })}>
            <option value="">—</option>
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
          </select>
        )}
        <div className="proxy-hint">{t('region.shopHint')}</div>

        <label className="proxy-row">
          <span>{t('region.tz')}</span>
          <select className="region-tz" value={s.tz} onChange={e => set({ tz: e.target.value as any })}>
            <option value="os">{t('region.tz.os', { zone: st?.osTz || '' })}</option>
            <option value="zone">{t('region.tz.zone')}</option>
            <option value="utc">{t('region.tz.utc')}</option>
          </select>
        </label>
        {s.tz === 'zone' && (
          <>
            <input className="region-zone" list="region-zones" value={zoneText} placeholder="Asia/Tokyo" onChange={e => setZoneText(e.target.value.trim())} />
            <datalist id="region-zones">{ZONES.map(z => <option key={z} value={z} />)}</datalist>
            {zoneOk && <div className="proxy-hint">{t('region.nowThere', { time: timeIn(zoneText) })}</div>}
          </>
        )}
        {s.tz !== 'os' && (
          <label className="proxy-check">
            <input type="checkbox" checked={!!s.keepTz} onChange={e => set({ keepTz: e.target.checked })} />
            <span>{t('region.keep')}</span>
          </label>
        )}
        <div className="proxy-hint">{t(s.tz === 'utc' ? 'region.tzHint.utc' : 'region.tzHint')}</div>

        {status && <div className="proxy-status">{status}</div>}
        <div className="tour-foot proxy-foot">
          <button className="tour-btn tour-btn-primary region-save" onClick={save}>{t('proxy.save')}</button>
        </div>
      </div>
    </div>
  );
}
