// Medidor do computador — as contas PURAS (sem Electron), testadas em tests/unit/hw-stats.test.ts.
// A leitura em si (nvidia-smi, IPC, janela minimizada) fica em hw-monitor.ts.

export interface GpuStats { util: number; memUsedGb: number; memTotalGb: number; temp: number | null; watts: number | null; name: string }
export interface HwStats { cpu: number | null; ramUsedGb: number; ramTotalGb: number; gpu: GpuStats | null }
export interface CpuTimes { idle: number; total: number }

/** Soma os tempos de todos os núcleos (os.cpus()). */
export function cpuTimes(cpus: Array<{ times: { user: number; nice: number; sys: number; idle: number; irq: number } }>): CpuTimes {
  let idle = 0, total = 0;
  for (const c of cpus) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/** Uso da CPU (0-100) entre duas leituras; null se não passou tempo. */
export function cpuPercent(prev: CpuTimes, next: CpuTimes): number | null {
  const total = next.total - prev.total;
  if (total <= 0) return null;
  const busy = total - (next.idle - prev.idle);
  return Math.max(0, Math.min(100, Math.round((busy / total) * 100)));
}

const num = (s: string | undefined): number | null => {
  const v = Number(String(s ?? '').trim());
  return Number.isFinite(v) ? v : null;   // "[N/A]", "[Not Supported]" → null
};

/** Uma linha do nvidia-smi (--format=csv,noheader,nounits) na ordem
 *  utilization.gpu, memory.used, memory.total, temperature.gpu, power.draw, name. */
export function parseNvidiaSmi(line: string): GpuStats | null {
  const parts = line.split(',').map((p) => p.trim());
  if (parts.length < 3) return null;
  const util = num(parts[0]), used = num(parts[1]), total = num(parts[2]);
  if (util === null || used === null || total === null || total <= 0) return null;
  return {
    util: Math.round(util),
    memUsedGb: used / 1024,
    memTotalGb: total / 1024,
    temp: num(parts[3]),
    watts: num(parts[4]),
    name: parts.slice(5).join(',').trim(),
  };
}
