// Medidor do computador na barra de cima (ao lado do botão IA): CPU, RAM e placa de vídeo.
// Receita do Strata (serve/telemetry.py, licença MIT, Niko1221): a placa NVIDIA pela biblioteca
// do próprio driver e CPU/RAM do sistema. Aqui a placa vem do nvidia-smi (que usa essa mesma
// biblioteca) em modo CONTÍNUO: um único programa ligado mandando uma linha a cada 2 s — abrir
// um programa novo a cada leitura custava 0,17 s cada vez. Sem temperatura da CPU: o Windows não
// entrega sem administrador (o Strata também não mostra).
// Só mede enquanto alguém pode ver: desligado na barra, ou janela minimizada/escondida = parado.
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import os from 'os';
import { cpuPercent, cpuTimes, parseNvidiaSmi, type CpuTimes, type GpuStats } from './hw-stats';

const EVERY_MS = 2000;

export function setupHwMonitor(deps: { getMainWindow: () => BrowserWindow | null }): void {
  let watching = false;
  let hidden = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let prevCpu: CpuTimes | null = null;
  let smi: ChildProcess | null = null;
  let smiMissing = false;     // sem nvidia-smi (placa não-NVIDIA): mostra só CPU e RAM
  let smiRetries = 0;
  let gpu: GpuStats | null = null;
  let hooked: BrowserWindow | null = null;

  const send = () => {
    const now = cpuTimes(os.cpus());
    const cpu = prevCpu ? cpuPercent(prevCpu, now) : null;
    prevCpu = now;
    const total = os.totalmem();
    const stats = { cpu, ramUsedGb: (total - os.freemem()) / 1073741824, ramTotalGb: total / 1073741824, gpu };
    try { deps.getMainWindow()?.webContents.send('hw:stats', stats); } catch {}
  };

  const startSmi = () => {
    if (smi || smiMissing) return;
    try {
      smi = spawn('nvidia-smi', [
        '--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,name',
        '--format=csv,noheader,nounits', '-i', '0', '-lms', String(EVERY_MS),
      ], { windowsHide: true });
    } catch { smiMissing = true; return; }
    let buf = '';
    smi.stdout?.on('data', (d: Buffer) => {
      buf += d.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const g = parseNvidiaSmi(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (g) { gpu = g; smiRetries = 0; }
      }
    });
    smi.on('error', () => { smiMissing = true; smi = null; gpu = null; });
    smi.on('exit', () => {
      smi = null;
      // Caiu sozinho (driver reiniciou, por exemplo): tenta de novo umas vezes, sem insistir pra sempre.
      if (timer && !smiMissing && smiRetries++ < 3) setTimeout(() => { if (timer) startSmi(); }, 10_000);
    });
  };
  const stopSmi = () => {
    const s = smi;
    smi = null;
    gpu = null;
    if (s?.pid) { try { s.kill(); } catch {} }
  };

  const update = () => {
    const on = watching && !hidden;
    if (on && !timer) {
      prevCpu = cpuTimes(os.cpus());
      timer = setInterval(send, EVERY_MS);
      startSmi();
      setTimeout(send, 400);   // primeira leitura logo, não daqui a 2 s
    } else if (!on && timer) {
      clearInterval(timer);
      timer = null;
      stopSmi();
    }
  };

  // Janela minimizada ou mandada pra bandeja: ninguém vê os números, então nada é medido.
  const hookWindow = () => {
    const w = deps.getMainWindow();
    if (!w || w === hooked) return;
    hooked = w;
    const set = (h: boolean) => () => { hidden = h; update(); };
    w.on('minimize', set(true));
    w.on('hide', set(true));
    w.on('restore', set(false));
    w.on('show', set(false));
  };

  const fromUi = (e: IpcMainInvokeEvent) => e.sender === deps.getMainWindow()?.webContents;
  ipcMain.handle('hw:watch', (e, on: unknown) => {
    if (!fromUi(e)) return false;
    hookWindow();
    watching = on === true;
    update();
    return watching;
  });
}
