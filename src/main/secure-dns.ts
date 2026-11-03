// DNS seguro (DNS-over-HTTPS), escolha da pessoa em ⋮ → Rede e proxy. O resolvedor do Chromium é
// do app inteiro (serviço de rede único): vale pra todas as sessões — abas, anônima, login do Google,
// requisições do próprio Bah. Padrão "system": no boot o Bah NEM chama o configureHostResolver
// (comportamento idêntico ao de antes); só aplica quando a pessoa escolhe outra coisa.
// A conversão/validação fica em src/shared/secure-dns.ts (testável).
import { app, ipcMain, session } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import { resolveSecureDns, DEFAULT_SECURE_DNS, type SecureDnsSetting, type HostResolverConfig } from '../shared/secure-dns';
export type { SecureDnsSetting } from '../shared/secure-dns';

const cfgPath = () => path.join(app.getPath('userData'), 'secure-dns.json');
const isE2E = () => process.env.NODE_ENV === 'test' && process.env.E2E_MOCK_AI === '1';

export function loadSecureDns(): SecureDnsSetting {
  try {
    const r = resolveSecureDns(JSON.parse(fs.readFileSync(cfgPath(), 'utf8')));
    if (!r.error) return r.setting;
    console.warn('[SecureDNS] saved setting ignored:', r.error);
  } catch { /* sem arquivo */ }
  return { ...DEFAULT_SECURE_DNS };
}

let current: SecureDnsSetting = { ...DEFAULT_SECURE_DNS };
let applied: HostResolverConfig | null = null;   // null = nunca chamado (resolvedor padrão do Chromium)
let lastError = '';
let calls = 0;
/** Configuração em vigor (pros avisos do painel Rede). */
export const getSecureDns = (): SecureDnsSetting => current;

function apply(config: HostResolverConfig): boolean {
  try {
    app.configureHostResolver(config);
    applied = config; calls++; lastError = '';
  } catch (e: any) {
    lastError = String(e?.message || e);
    console.warn('[SecureDNS] configureHostResolver failed:', lastError);
    return false;
  }
  // Conexões abertas guardam o IP antigo: fecha pra que as próximas buscas usem o resolvedor novo.
  void Promise.all([session.defaultSession, session.fromPartition('persist:browser')].map(s => s.closeAllConnections?.().catch(() => {}))).catch(() => {});
  return true;
}

// Teste (NODE_ENV=test + E2E_MOCK_AI=1): o e2e lê o que o main aplicou, sem depender da rede.
function exposeForTest(): void {
  if (isE2E()) (globalThis as any).__e2eSecureDns = { setting: current, applied, calls };
}

/** Chamar depois do 'ready' (exigência do configureHostResolver). */
export function setupSecureDns(): void {
  current = loadSecureDns();
  if (current.mode !== 'system') apply(resolveSecureDns(current).config);
  exposeForTest();

  ipcMain.handle('dns:get', () => ({ setting: current, applied, error: lastError || undefined }));
  ipcMain.handle('dns:set', (_e, s: SecureDnsSetting) => {
    const r = resolveSecureDns(s);
    if (r.error) return { ok: false, error: r.error, setting: current };
    // Voltar pro "system" depois de ter mudado: reaplica os padrões do Chromium (nada a desfazer se nunca mudou).
    if (r.setting.mode !== 'system' || applied) {
      if (!apply(r.config)) return { ok: false, error: lastError, setting: current };
    }
    current = r.setting;
    try { fs.writeFileSync(cfgPath(), JSON.stringify(current, null, 2)); } catch {}
    exposeForTest();
    return { ok: true, setting: current };
  });
}
