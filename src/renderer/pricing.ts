// Custo estimado de cada chamada ao modelo, em dólar.
//
// Por que existe: com API na nuvem o agente roda com passos infinitos por padrão — dá pra
// deixar uma tarefa a noite toda. Até aqui o navegador não mostrava um centavo disso, então
// a única forma de descobrir o gasto era abrir a fatura do provedor no dia seguinte.
//
// É ESTIMATIVA, nunca a fatura. Quem cobra é o provedor e só ele sabe o número final. O que
// dá pra fazer é acertar a conta: os tokens vêm do próprio `usage` da resposta (não são
// chutados), e os de cache entram com o preço de cache, que é ~10x mais barato — ignorar
// isso erraria feio pra cima.
//
// Preços conferidos nas páginas oficiais em 2026-09-12. Eles mudam; por isso o usuário pode
// sobrescrever qualquer linha (veja `loadOverrides`) sem depender de uma nova versão.

export interface ModelPrice {
  in: number;       // USD por 1M tokens de entrada NÃO cacheados
  cached?: number;  // USD por 1M tokens de entrada vindos do cache
  out: number;      // USD por 1M tokens de saída
  est?: boolean;    // true = preço não-oficial (rastreador de terceiros), marcar como "~"
}

// DeepSeek cobra o dobro em horário de pico: 01:00–04:00 e 06:00–10:00 UTC, seg–sex.
// (api-docs.deepseek.com/quick_start/pricing — "off-peak rates are half of the peak rates")
function deepseekPeak(now: Date): boolean {
  const dow = now.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const h = now.getUTCHours();
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}
const half = (p: ModelPrice): ModelPrice => ({ ...p, in: p.in / 2, cached: (p.cached ?? 0) / 2, out: p.out / 2 });

// A ordem importa: o primeiro padrão que casar vence. Padrões mais específicos primeiro.
const TABLE: Array<{ match: RegExp; price: ModelPrice | ((now: Date) => ModelPrice) }> = [
  // ── Ollama / local: não custa nada. Casa pelo nome de modelo GGUF/HF típico.
  { match: /^hf\.co\/|:latest$|^ollama/i, price: { in: 0, cached: 0, out: 0 } },

  // ── DeepSeek (peak = dobro)
  { match: /deepseek.*(v4-?pro|reasoner)/i, price: (n) => { const p: ModelPrice = { in: 1.32, cached: 0.044, out: 3.96 }; return deepseekPeak(n) ? p : half(p); } },
  { match: /deepseek/i,                     price: (n) => { const p: ModelPrice = { in: 0.30, cached: 0.006, out: 1.20 }; return deepseekPeak(n) ? p : half(p); } },

  // ── Anthropic
  { match: /claude.*opus/i,        price: { in: 5,    cached: 0.50,  out: 25 } },
  { match: /claude.*sonnet-?5/i,   price: { in: 2,    cached: 0.20,  out: 10 } },
  { match: /claude.*sonnet/i,      price: { in: 3,    cached: 0.30,  out: 15 } },
  { match: /claude.*haiku-?4/i,    price: { in: 1,    cached: 0.10,  out: 5 } },

  // ── OpenAI
  { match: /gpt-4o-mini/i,         price: { in: 0.15, cached: 0.075, out: 0.60 } },
  { match: /gpt-4o/i,              price: { in: 2.50, cached: 1.25,  out: 10 } },
  { match: /gpt-5.*mini/i,         price: { in: 0.25, cached: 0.025, out: 2 } },
  { match: /gpt-5.*nano/i,         price: { in: 0.05, cached: 0.005, out: 0.40 } },
  { match: /gpt-5\.6-luna/i,       price: { in: 0.20, cached: 0.02,  out: 1.20 } },
  { match: /gpt-5(\.\d+)?$/i,      price: { in: 1.25, cached: 0.125, out: 10 } },

  // ── Mistral
  { match: /mistral-small|ministral/i, price: { in: 0.15, cached: 0.015, out: 0.60 } },
  { match: /mistral-large/i,           price: { in: 0.50, cached: 0.05,  out: 1.50 } },
  { match: /mistral-medium/i,          price: { in: 1.50, cached: 0.15,  out: 7.50 } },
  { match: /codestral/i,               price: { in: 0.30, cached: 0.03,  out: 0.90 } },

  // ── NVIDIA NIM. build.nvidia.com/pricing dá 404 — estes vieram de rastreadores de
  //    terceiros, então vão marcados como estimados (aparecem com "~" na tela).
  { match: /llama-3\.3-70b/i,      price: { in: 0.60, out: 1.80, est: true } },
  { match: /llama-3\.1-8b/i,       price: { in: 0.05, out: 0.15, est: true } },
];

// Sobrescrita do usuário: { "regex": {in, cached, out} }. Vence a tabela acima, pra quando
// um provedor mudar de preço e a versão instalada ainda não souber.
function loadOverrides(): Array<{ match: RegExp; price: ModelPrice }> {
  try {
    const raw = localStorage.getItem('pricing.overrides');
    if (!raw) return [];
    const obj = JSON.parse(raw) as Record<string, ModelPrice>;
    return Object.entries(obj).map(([pat, price]) => ({ match: new RegExp(pat, 'i'), price }));
  } catch { return []; }
}

export function priceFor(model: string, now: Date = new Date()): ModelPrice | null {
  const m = String(model || '');
  if (!m) return null;
  for (const row of loadOverrides()) if (row.match.test(m)) return row.price;
  for (const row of TABLE) {
    if (row.match.test(m)) return typeof row.price === 'function' ? row.price(now) : row.price;
  }
  return null;   // modelo desconhecido: não mostra nada em vez de inventar um número
}

/**
 * Custo em dólar de UMA chamada. Devolve null quando o modelo não está na tabela.
 *
 * Os provedores contam cache de dois jeitos e confundir isso dobra ou zera a conta:
 *  - DeepSeek/OpenAI: `prompt_tokens` JÁ INCLUI os tokens de cache → subtrai.
 *  - Anthropic: `input_tokens` é só o que NÃO veio do cache; `cache_read_input_tokens` é à parte.
 */
export function costOf(model: string, usage: any, now: Date = new Date()): { usd: number; est: boolean } | null {
  const p = priceFor(model, now);
  if (!p) return null;
  const u = usage || {};
  const cached = Number(
    u.prompt_cache_hit_tokens ?? u.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens ?? 0,
  ) || 0;
  const rawIn = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0;
  const cacheIsSeparate = u.cache_read_input_tokens != null;   // estilo Anthropic
  const freshIn = cacheIsSeparate ? rawIn : Math.max(0, rawIn - cached);
  const out = Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0;
  const usd = (freshIn * p.in + cached * (p.cached ?? p.in) + out * p.out) / 1_000_000;
  return { usd, est: !!p.est };
}

/** Dólar legível em valores minúsculos: $0.0004 não pode virar $0.00. */
export function fmtUsd(v: number, est = false): string {
  const d = v >= 1 ? 2 : v >= 0.01 ? 3 : 4;
  return `${est ? '~' : ''}$${v.toFixed(d)}`;
}
