// Lista de sites perigosos (formato hosts: "0.0.0.0 dominio"). A lista vem de fora, então só vale
// linha nesse formato: uma página de erro ou um arquivo cortado não pode virar "lista nova".

// Menos que isso não é a lista de verdade (a atual tem 140 mil): não troca a cópia que já funciona.
export const SAFE_BROWSING_MIN_HOSTS = 1000;

const HOST_LINE = /^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/i;

export function parseHostsList(raw: string): Set<string> {
  const hosts = new Set<string>();
  for (const line of raw.split('\n')) {
    const m = HOST_LINE.exec(line.trim());
    // Sem ponto não é site (ex.: "0.0.0.0 localhost"). URL.hostname vem em minúsculas.
    if (m && m[1].includes('.')) hosts.add(m[1].toLowerCase());
  }
  return hosts;
}
