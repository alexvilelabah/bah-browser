// O computador da pessoa (SO, versão, CPU) pro agente — "baixe o X pra este computador".
// A lógica (nomes, dica do que escolher) fica em shared/software-download.ts; aqui só se lê o sistema.
import fs from 'fs';
import { machineProfile, type MachineInput, type MachineProfile } from '../shared/software-download';

let cached: MachineInput | null = null;

export function currentMachineInput(): MachineInput {
  if (cached) return cached;
  // Build x64 rodando no Rosetta num Mac M-series: o hardware é Apple Silicon.
  let armTranslated = false;
  try { armTranslated = !!require('electron').app?.runningUnderARM64Translation; } catch {}
  let osVersion = '';
  try { osVersion = typeof (process as any).getSystemVersion === 'function' ? (process as any).getSystemVersion() : ''; } catch {}
  let linuxOsRelease = '';
  if (process.platform === 'linux') { try { linuxOsRelease = fs.readFileSync('/etc/os-release', 'utf8').slice(0, 4000); } catch {} }
  cached = { platform: process.platform, arch: process.arch, osVersion, armTranslated, linuxOsRelease };
  return cached;
}

export function currentMachineProfile(): MachineProfile {
  return machineProfile(currentMachineInput());
}
