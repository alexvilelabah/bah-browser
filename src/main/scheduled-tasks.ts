// Tarefas agendadas: onde ficam guardadas + o aviso do sistema. O pedido de uma tarefa pode ser
// sensível ("veja meu extrato no banco X"): fica SÓ neste computador, cifrado pelo cofre do
// sistema (safeStorage), como o perfil do candidato. Sem cofre → não grava (a lista vive só
// enquanto o Bah está aberto). O relógio, a fila e a execução ficam no renderer (é lá que o
// agente roda); aqui só guarda, valida (shared/schedule.ts) e mostra a notificação nativa.
import { app, ipcMain, safeStorage, Notification, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { sanitizeTasks, type ScheduledTask } from '../shared/schedule';

const file = () => path.join(app.getPath('userData'), 'scheduled-tasks.enc');
let memory: ScheduledTask[] | null = null;   // sem cofre: só na memória

function load(): ScheduledTask[] {
  if (memory) return memory;
  try {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(file())) return [];
    return sanitizeTasks(JSON.parse(safeStorage.decryptString(fs.readFileSync(file()))));
  } catch { return []; }
}

function save(list: ScheduledTask[]): boolean {
  if (!safeStorage.isEncryptionAvailable()) { memory = list; return false; }
  try {
    fs.writeFileSync(file() + '.tmp', safeStorage.encryptString(JSON.stringify(list)));
    fs.renameSync(file() + '.tmp', file());
    return true;
  } catch { return false; }
}

// Relógio dos testes (E2E): E2E_SCHED_NOW = "agora" na abertura (ms). Só com NODE_ENV=test — no app
// de verdade o relógio é sempre o do sistema.
const testMode = () => process.env.NODE_ENV === 'test';
const clockOffset = () => {
  const v = Number(process.env.E2E_SCHED_NOW);
  return testMode() && Number.isFinite(v) && v > 0 ? v - Date.now() : 0;
};

export function setupScheduledTasks(opts: { getMainWindow: () => BrowserWindow | null; showMainWindow: () => void }): void {
  ipcMain.handle('sched:list', () => ({ tasks: load(), available: safeStorage.isEncryptionAvailable() }));
  ipcMain.handle('sched:save', (_e, list: unknown) => {
    const clean = sanitizeTasks(list);
    return { ok: save(clean), tasks: clean };
  });
  ipcMain.handle('sched:clock', () => ({ offset: clockOffset(), test: testMode() }));
  // "Esperando você": a tarefa parou numa confirmação (freio de risco, perguntas, login).
  ipcMain.handle('sched:notify', (_e, n: { title?: string; body?: string; taskId?: string }) => {
    const title = String(n?.title || 'Bah').slice(0, 80);
    const body = String(n?.body || '').slice(0, 200);
    const taskId = String(n?.taskId || '').slice(0, 64);
    // E2E: o teste confere QUE avisou (a notificação nativa não dá pra ler de fora).
    if (testMode()) { const g = global as any; g.__e2eSchedNotes = [...(g.__e2eSchedNotes || []), { title, body, taskId }]; }
    try {
      if (!Notification.isSupported()) return { ok: false };
      const note = new Notification({ title, body, silent: false });
      note.on('click', () => {
        opts.showMainWindow();
        try { opts.getMainWindow()?.webContents.send('sched:focus', taskId); } catch {}
      });
      note.show();
      return { ok: true };
    } catch { return { ok: false }; }
  });
}
