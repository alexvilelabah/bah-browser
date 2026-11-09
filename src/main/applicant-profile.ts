// Perfil do candidato + respostas salvas (preenchimento de candidatura sem IA). Dado pessoal:
// fica SÓ neste computador, cifrado pelo cofre do sistema (safeStorage), como as senhas do proxy.
// Sem cofre disponível → não grava (o preenchimento usa só o currículo lido). Quem lê: a tela do
// Bah (painel do perfil e o preenchedor da tarefa de candidatura). Nada vai pra rede por aqui.
import { app, ipcMain, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import type { ApplicantProfile } from '../shared/form-fill';

interface Store { profile: ApplicantProfile; answers: Record<string, string> }
const EMPTY: Store = { profile: {}, answers: {} };
const file = () => path.join(app.getPath('userData'), 'applicant.enc');

function load(): Store {
  try {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(file())) return { ...EMPTY };
    const s = JSON.parse(safeStorage.decryptString(fs.readFileSync(file())));
    return { profile: s?.profile && typeof s.profile === 'object' ? s.profile : {}, answers: s?.answers && typeof s.answers === 'object' ? s.answers : {} };
  } catch { return { ...EMPTY }; }
}

function save(s: Store): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  try { fs.writeFileSync(file() + '.tmp', safeStorage.encryptString(JSON.stringify(s))); fs.renameSync(file() + '.tmp', file()); return true; } catch { return false; }
}

const clean = (o: any, max = 2000): Record<string, string> => Object.fromEntries(Object.entries(o || {})
  .filter(([k, v]) => typeof k === 'string' && k.length <= 200 && (typeof v === 'string' || typeof v === 'number'))
  .map(([k, v]) => [k, String(v).slice(0, max)]));

export function setupApplicantProfile(): void {
  ipcMain.handle('applicant:get', () => ({ ...load(), available: safeStorage.isEncryptionAvailable() }));
  ipcMain.handle('applicant:set-profile', (_e, p: ApplicantProfile) => {
    const s = load(); s.profile = clean(p, 300) as ApplicantProfile; return { ok: save(s) };
  });
  // Respostas novas (a pessoa respondeu no cartão da tarefa) se juntam às guardadas.
  ipcMain.handle('applicant:save-answers', (_e, a: Record<string, string>) => {
    const s = load(); s.answers = { ...s.answers, ...clean(a) }; return { ok: save(s) };
  });
  ipcMain.handle('applicant:delete-answer', (_e, key: string) => {
    const s = load(); delete s.answers[String(key)]; return { ok: save(s) };
  });
  ipcMain.handle('applicant:clear', () => { try { fs.rmSync(file(), { force: true }); } catch {} return { ok: true }; });
}
