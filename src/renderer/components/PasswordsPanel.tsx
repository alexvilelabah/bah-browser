// ⋮ → Senhas: o Gerenciador de senhas (no molde do Limpar dados de navegação). Pesquisa, lista de
// site + usuário, copiar usuário/senha, mostrar, editar, excluir, "Nunca salvas", o interruptor
// "Oferecer para salvar senhas" e importar/exportar CSV.
// A lista chega SEM senha nenhuma. Mostrar/copiar/editar pedem ao main, que confirma antes (no
// Windows uma caixa de confirmação; no Mac o Touch ID). Senha mostrada some sozinha em 30 s, e
// fechar o painel tranca de novo.
// Ícones só do cache (peek): abrir o painel não sai buscando o ícone de cada site salvo.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import SiteIcon from './SiteIcon';
import type { PwError, PwState } from '../../shared/password-types';

const SHOW_MS = 30_000;
const MAX_ROWS = 500;

export default function PasswordsPanel({ onClose, initialQuery }: { onClose: () => void; initialQuery?: string }) {
  // Uma referência só pra vida do painel: o efeito abaixo tranca de novo ao desmontar, e não pode
  // rodar outra vez a cada render (trancaria logo depois da confirmação).
  const api = useMemo(() => window.electronAPI?.passwords, []);
  const [st, setSt] = useState<PwState | null>(null);
  const [q, setQ] = useState(initialQuery || '');
  const [shown, setShown] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; username: string; password: string; original: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => { try { setSt((await api?.state()) || null); } catch {} }, [api]);
  useEffect(() => {
    void refresh();
    const off = api?.onChanged(() => { void refresh(); });
    return () => { try { off?.(); } catch {} api?.lock(); };
  }, [api, refresh]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  // Senha à mostra não fica na tela: some sozinha.
  useEffect(() => {
    if (!Object.keys(shown).length) return;
    const tm = setTimeout(() => setShown({}), SHOW_MS);
    return () => clearTimeout(tm);
  }, [shown]);

  const errText = (e: PwError) =>
    e === 'decrypt' ? t('pw.mgr.decryptFailed') : e === 'duplicate' ? t('pw.mgr.dupUser') : e === 'empty' ? t('pw.mgr.emptyPass')
      : e === 'vault' ? t('pw.mgr.vaultOff') : t('pw.mgr.failed');
  const report = (r: { ok: boolean; error?: PwError } | undefined, okText?: string) => {
    if (!r) { setMsg({ text: t('pw.mgr.failed'), bad: true }); return false; }
    if (r.ok) { if (okText) setMsg({ text: okText }); return true; }
    if (r.error !== 'canceled') setMsg({ text: errText(r.error as PwError), bad: true });
    return false;
  };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = st?.entries || [];
    return needle ? all.filter(e => e.host.toLowerCase().includes(needle) || e.username.toLowerCase().includes(needle) || e.origin.toLowerCase().includes(needle)) : all;
  }, [st, q]);

  const copy = async (id: string, what: 'username' | 'password') => {
    const r = await api?.copy(id, what);
    if (r && r.ok) setMsg({ text: what === 'username' ? t('pw.mgr.userCopied') : t('pw.mgr.passCopied', { s: r.clearsInSec ?? 30 }) });
    else report(r);
  };
  const toggleShow = async (id: string) => {
    if (shown[id] !== undefined) { setShown(s => { const n = { ...s }; delete n[id]; return n; }); return; }
    const r = await api?.reveal(id);
    if (r && r.ok) setShown(s => ({ ...s, [id]: r.password }));
    else report(r);
  };
  const startEdit = async (id: string, username: string) => {
    const r = await api?.reveal(id);
    if (!r || !r.ok) { report(r); return; }
    setConfirmDel(null);
    setEditing({ id, username, password: r.password, original: r.password });
  };
  const saveEdit = async () => {
    if (!editing) return;
    if (!editing.password) { setMsg({ text: t('pw.mgr.emptyPass'), bad: true }); return; }
    const patch = editing.password !== editing.original ? { username: editing.username, password: editing.password } : { username: editing.username };
    if (report(await api?.update(editing.id, patch))) { setEditing(null); setShown({}); setMsg(null); }
  };
  const remove = async (id: string) => {
    if (report(await api?.remove(id))) setConfirmDel(null);
  };
  const doImport = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api?.importCsv();
      if (r && r.ok) {
        const n = String(r.added);
        setMsg({ text: r.trashed ? t('pw.mgr.importedTrashed', { n }) : t('pw.mgr.importedKeep', { n }) });
      } else if (r && r.error !== 'canceled' && r.error !== 'empty' && r.error !== 'too-big') report(r);
    } finally { setBusy(false); }
  };
  const doExport = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api?.exportCsv();
      if (r && r.ok) setMsg({ text: t('pw.mgr.exported', { n: r.count, file: r.file }) });
      else report(r);
    } finally { setBusy(false); }
  };

  const vaultOff = st?.vault === 'unavailable';
  return (
    <div className="history-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div className="history-panel pw-panel" role="dialog" aria-label={t('pw.mgr.title')} onClick={e => e.stopPropagation()}>
        <div className="history-head">
          <span>🔑 {t('pw.mgr.title')}</span>
          <button className="history-close" onClick={onClose} disabled={busy} title={t('pw.offer.close')}>✕</button>
        </div>
        <div className="pw-body">
          {st?.readOnly && <div className="pw-msg bad">{t('pw.mgr.readOnly')}</div>}
          {vaultOff ? (
            <div className="pw-msg bad">{t('pw.mgr.vaultOff')}</div>
          ) : (
            <label className="dl-set-switch">
              <input type="checkbox" checked={!!st?.offerToSave} onChange={async e => { report(await api?.setOfferToSave(e.target.checked)); }} />
              <span className="dl-set-txt">{t('pw.mgr.offer')}<small>{t('pw.mgr.offerHint')}</small></span>
            </label>
          )}
          <input className="pw-search" type="search" placeholder={t('pw.mgr.search')} value={q} onChange={e => setQ(e.target.value)} spellCheck={false} autoFocus />
          <div className="pw-list">
            {st && list.length === 0 && <div className="history-empty">{st.entries.length ? t('pw.mgr.noMatch') : t('pw.mgr.empty')}</div>}
            {list.slice(0, MAX_ROWS).map(e => (
              <div key={e.id} className="pw-row">
                {editing?.id === e.id ? (
                  <div className="pw-edit">
                    <div className="pw-row-site"><SiteIcon url={e.origin} peek /><span className="pw-host" title={e.origin}>{e.host}</span></div>
                    <label className="pw-field"><span>{t('pw.offer.username')}</span>
                      <input className="pw-input" value={editing.username} spellCheck={false} autoComplete="off" maxLength={512}
                        onChange={ev => setEditing({ ...editing, username: ev.target.value })} />
                    </label>
                    <label className="pw-field"><span>{t('pw.offer.password')}</span>
                      <input className="pw-input" value={editing.password} spellCheck={false} autoComplete="off" maxLength={1024}
                        onChange={ev => setEditing({ ...editing, password: ev.target.value })} />
                    </label>
                    <div className="cbd-actions">
                      <button className="cbd-cancel" onClick={() => setEditing(null)}>{t('pw.mgr.cancel')}</button>
                      <button className="cbd-go" onClick={saveEdit}>{t('pw.mgr.save')}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="pw-row-main">
                      <SiteIcon url={e.origin} peek />
                      <div className="pw-row-text">
                        <span className="pw-host" title={e.origin}>{e.host}</span>
                        <span className="pw-user">{e.username || t('pw.offer.noUsername')}</span>
                      </div>
                      <span className={`pw-secret-text${shown[e.id] === undefined ? ' masked' : ''}`}>{shown[e.id] ?? '••••••••'}</span>
                    </div>
                    {confirmDel === e.id ? (
                      <div className="pw-actions confirm">
                        <span>{t('pw.mgr.deleteAsk')}</span>
                        <button className="cbd-cancel" onClick={() => setConfirmDel(null)}>{t('pw.mgr.cancel')}</button>
                        <button className="cbd-go danger" onClick={() => remove(e.id)}>{t('pw.mgr.delete')}</button>
                      </div>
                    ) : (
                      <div className="pw-actions">
                        <button className="pw-act" onClick={() => copy(e.id, 'username')} title={t('pw.mgr.copyUser')} aria-label={t('pw.mgr.copyUser')} disabled={!e.username}>👤</button>
                        <button className="pw-act" onClick={() => copy(e.id, 'password')} title={t('pw.mgr.copyPass')} aria-label={t('pw.mgr.copyPass')}>📋</button>
                        <button className="pw-act" onClick={() => toggleShow(e.id)} title={shown[e.id] === undefined ? t('pw.show') : t('pw.hide')} aria-label={shown[e.id] === undefined ? t('pw.show') : t('pw.hide')}>{shown[e.id] === undefined ? '👁' : '🙈'}</button>
                        <button className="pw-act" onClick={() => startEdit(e.id, e.username)} title={t('pw.mgr.edit')} aria-label={t('pw.mgr.edit')}>✏️</button>
                        <button className="pw-act" onClick={() => { setEditing(null); setConfirmDel(e.id); }} title={t('pw.mgr.delete')} aria-label={t('pw.mgr.delete')}>🗑️</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          {!!st?.never.length && (
            <div className="pw-never">
              <div className="pw-never-title">{t('pw.mgr.never')}</div>
              {st.never.map(n => (
                <div key={n.origin} className="pw-never-row">
                  <SiteIcon url={n.origin} peek />
                  <span className="pw-host" title={n.origin}>{n.host}</span>
                  <button className="fav-del" onClick={async () => { report(await api?.removeNever(n.origin)); }} title={t('pw.mgr.neverRemove')} aria-label={t('pw.mgr.neverRemove')}>✕</button>
                </div>
              ))}
            </div>
          )}
          {msg && <div className={`pw-msg${msg.bad ? ' bad' : ''}`} role="status">{msg.text}</div>}
          <div className="pw-foot">
            <button className="history-clear" onClick={doImport} disabled={busy || vaultOff}>📥 {t('pw.mgr.import')}</button>
            <button className="history-clear" onClick={doExport} disabled={busy || !st?.entries.length}>📤 {t('pw.mgr.export')}</button>
          </div>
          <small className="cbd-note">{t('pw.mgr.local')}</small>
        </div>
      </div>
    </div>
  );
}
