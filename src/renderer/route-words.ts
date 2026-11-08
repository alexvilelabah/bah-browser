// Palavras do roteador da caixa do assistente (o que vira tarefa do agente vs. resposta).
// Com modelo local não há classificador por IA: estas regras decidem.

// Começa com um verbo de AÇÃO no imperativo — o pedido é FAZER no navegador, não saber:
// "search for a set of new golf clubs", "find me a hotel…", "look up the Acme store hours",
// "procure tênis de corrida". Antes "search/find" contavam como pesquisa (resumo de trechos) e a
// resposta era "os resultados são genéricos". "find out…" é pergunta, não ação.
const LEADING_ACTION_RE = /^(?:(?:please|pls|can you|could you|por favor|pode|poderia)\s+)?(?:search(?:\s+for)?|find(?!\s+out\b)(?:\s+me)?|look\s+(?:for|up)|shop(?:\s+for)?|browse|get\s+me|buy|order|book|open|go\s+to|visit|navigate|show\s+me|pesquis\w+|procur\w+|busqu\w+|busca\b|encontr\w+|ach[ae]\b|compr[ae]\b|abr[ae]\b|acess[ae]\b|v[aá]\s+(?:para|pra|no|na|ao))\b/i;

export function startsWithActionVerb(msg: string): boolean {
  return LEADING_ACTION_RE.test(String(msg || '').trim());
}
