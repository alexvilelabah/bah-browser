// Skills de navegação: as INCLUÍDAS (skills/ do app — regras gerais) + as do USUÁRIO
// (<userData>/skills — receitas próprias, salvas pelo "Salvar como skill"). Mesmo formato
// SKILL.md; a do usuário ganha prioridade no empate. O renderer escolhe quais vão no prompt.
import { app, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { parseSkill, validateSkill, type Skill } from '../shared/skills';

export const bundledSkillsDir = () => path.join(app.getAppPath(), 'skills');
export const userSkillsDir = () => path.join(app.getPath('userData'), 'skills');

function loadDir(dir: string, origin: 'bundled' | 'user'): Skill[] {
  const out: Skill[] = [];
  let entries: string[] = [];
  try { entries = fs.readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    try {
      const s = parseSkill(fs.readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8'));
      if (s) out.push({ ...s, origin, priority: s.priority + (origin === 'user' ? 50 : 0) });
      else console.warn(`[Skills] ${origin} ${name}/SKILL.md did not parse — skipped`);
    } catch { /* pasta sem SKILL.md */ }
  }
  return out;
}

export function loadSkills(): Skill[] {
  const user = loadDir(userSkillsDir(), 'user');
  // Skill do usuário com o MESMO nome substitui a incluída.
  const names = new Set(user.map(s => s.name));
  return [...user, ...loadDir(bundledSkillsDir(), 'bundled').filter(s => !names.has(s.name))];
}

export function setupSkills(): void {
  // Relê a cada tarefa: salvar/editar um SKILL.md vale na próxima (são poucos arquivos pequenos).
  ipcMain.handle('skills:list', () => loadSkills());
  // Salvar SÓ depois da revisão da pessoa (o renderer chama no botão "Salvar"). Mesmas regras
  // das skills incluídas — é texto que vira instrução pro modelo.
  ipcMain.handle('skills:save', (_e, markdown: string) => {
    const v = validateSkill(String(markdown || ''));
    if (!v.ok) return { ok: false, error: v.error };
    const dir = path.join(userSkillsDir(), v.skill.name);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), String(markdown).trim() + '\n', 'utf8');
      return { ok: true, name: v.skill.name, path: path.join(dir, 'SKILL.md') };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
  ipcMain.handle('skills:open-folder', async () => {
    try { fs.mkdirSync(userSkillsDir(), { recursive: true }); await shell.openPath(userSkillsDir()); return { ok: true, path: userSkillsDir() }; }
    catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  });
}
