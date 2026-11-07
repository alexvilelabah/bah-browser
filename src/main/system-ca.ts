// Certificados-raiz do SO pro Node. O Node do Electron NÃO lê o repositório do sistema (só as raízes
// embutidas da Mozilla) → em rede corporativa que inspeciona TLS (Blue Coat etc., com a raiz da empresa
// instalada no SO) toda requisição do Node falhava com "unable to get local issuer certificate".
// O motor do navegador (Chromium) já usa o repositório do SO; isto alinha o Node a ele.
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as tls from 'tls';

const PEM_RE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

export function parsePems(text: string): string[] {
  return (String(text || '').match(PEM_RE) || []).map(p => p.replace(/\r\n/g, '\n').trim());
}

const run = (cmd: string, args: string[]) => new Promise<string>((resolve) => {
  execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout: 20_000, windowsHide: true }, (_err, stdout) => resolve(String(stdout || '')));
});

/** PEMs do repositório de confiança do SO (máquina + usuário). */
export async function loadSystemCAs(): Promise<string[]> {
  let text = '';
  if (process.platform === 'darwin') {
    const keychains = ['/Library/Keychains/System.keychain', '/System/Library/Keychains/SystemRootCertificates.keychain',
      path.join(os.homedir(), 'Library/Keychains/login.keychain-db')].filter(k => fs.existsSync(k));
    text = (await Promise.all(keychains.map(k => run('/usr/bin/security', ['find-certificate', '-a', '-p', k])))).join('\n');
  } else if (process.platform === 'win32') {
    text = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-ChildItem -Path Cert:\\LocalMachine\\Root, Cert:\\CurrentUser\\Root, Cert:\\LocalMachine\\CA | ForEach-Object { '-----BEGIN CERTIFICATE-----'; [Convert]::ToBase64String($_.RawData, 'InsertLineBreaks'); '-----END CERTIFICATE-----' }"]);
  } else {
    const bundle = ['/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/ca-bundle.pem', '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem'].find(f => fs.existsSync(f));
    if (bundle) text = fs.readFileSync(bundle, 'utf8');
  }
  return parsePems(text);
}

/** Raízes padrão do Node + as do SO (sem duplicar). Devolve quantas do SO entraram. */
export function installCAs(pems: string[]): number {
  const t = tls as any;
  if (!pems.length || typeof t.setDefaultCACertificates !== 'function') return 0;
  const base: string[] = typeof t.getCACertificates === 'function' ? t.getCACertificates('default') : [...tls.rootCertificates];
  const seen = new Set(base.map((p: string) => p.replace(/\s+/g, '')));
  const extra = pems.filter(p => { const k = p.replace(/\s+/g, ''); if (seen.has(k)) return false; seen.add(k); return true; });
  try { t.setDefaultCACertificates([...base, ...extra]); return extra.length; } catch (e: any) { console.warn('[SystemCA] setDefaultCACertificates failed:', e?.message || e); return 0; }
}
