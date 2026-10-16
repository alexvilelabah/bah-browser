// Pasta dos downloads — UMA fonte pra tudo que o Bah salva (arquivos, vídeos do botão
// "Baixar", fotos do agente). Padrão: a pasta Downloads do Windows; a pessoa pode
// escolher outra em Downloads → ⚙ (a escolha vem do renderer no boot e ao mudar).
import { app } from 'electron';
import fs from 'fs';

let custom: string | null = null;

const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

export function getDownloadDir(): string {
  return custom && isDir(custom) ? custom : app.getPath('downloads');
}

/** Pasta escolhida (vazio/inválida = volta pro padrão). Devolve a que vale agora. */
export function setDownloadDir(dir: string | null | undefined): string {
  custom = dir && isDir(dir) ? dir : null;
  return getDownloadDir();
}

// Arquivos que a PESSOA escolheu onde salvar (diálogo do "Salvar como PDF…"): podem estar fora
// da pasta dos downloads, mas "abrir arquivo"/"mostrar na pasta" no Ctrl+J têm que funcionar
// pra eles. Só o arquivo exato entra (nunca a pasta dele), e só nesta sessão do Bah.
const savedFiles: string[] = [];
const MAX_SAVED_FILES = 200;

export function rememberSavedFile(p: string): void {
  if (!p || savedFiles.includes(p)) return;
  savedFiles.push(p);
  if (savedFiles.length > MAX_SAVED_FILES) savedFiles.shift();
}

/** Pastas (e arquivos salvos pela pessoa) onde "abrir arquivo"/"mostrar na pasta" podem mexer (nunca um caminho arbitrário). */
export function downloadRoots(): string[] {
  const roots = [app.getPath('downloads')];
  const d = getDownloadDir();
  if (!roots.includes(d)) roots.push(d);
  return [...roots, ...savedFiles];
}
