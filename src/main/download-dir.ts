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

/** Pastas onde "abrir arquivo"/"mostrar na pasta" podem mexer (nunca um caminho arbitrário). */
export function downloadRoots(): string[] {
  const roots = [app.getPath('downloads')];
  const d = getDownloadDir();
  if (!roots.includes(d)) roots.push(d);
  return roots;
}
