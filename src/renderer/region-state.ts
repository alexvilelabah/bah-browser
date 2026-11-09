// Estado de região/fuso no renderer (vem do main: src/main/region.ts). Lido pelo prompt do agente
// e pelos buscadores (gl=/cc=). Atualizado no início de cada tarefa e quando o painel salva.
import { regionLine, type RegionSettings } from '../shared/region';

export type RegionState = { settings: RegionSettings; network: string; os: string; osTz: string; shopping: string; tzOverride: string; checkedAt: number };
let current: RegionState | null = null;
const listeners = new Set<() => void>();

export async function refreshRegion(force: boolean | 'peek' = false): Promise<RegionState | null> {
  try { current = (await (window as any).electronAPI?.regionGet?.(force)) || current; } catch {}
  listeners.forEach(fn => { try { fn(); } catch {} });
  return current;
}
export const regionState = () => current;
export function onRegionState(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
/** País das buscas/compras ('' = sem forçar). */
export const searchCountry = () => current?.shopping || '';
/** Linha do prompt do agente. */
export const agentRegionLine = () => current ? regionLine(current.settings, current.network, current.os, current.osTz) : '';
/** Países de rede (VPN) sobre os quais a pessoa já respondeu nesta sessão — pergunta 1 vez por país. */
export const askedNetworkCountries = new Set<string>();
