// Qual modelo da DeepSeek usar — regra PURA (testada em tests/unit/deepseek-models.test.ts).
//
// A DeepSeek renomeou o modelo rápido: 'deepseek-flash' (V4.1-Flash) é o nome atual; o antigo
// 'deepseek-v4-flash' foi aposentado — ainda é aceito, mas sumiu da lista /models. Procurando só
// o nome antigo, o Bah caía no 'deepseek-v4-pro' (lento e mais caro) para todo mundo (issue do
// kintaro1981 no GitHub). Regra: Flash sempre; o Pro só quando NENHUM Flash serve (a lista não
// tem nenhum, ou todos os Flash já deram "modelo não existe").
export const DEEPSEEK_FLASH_IDS = ['deepseek-flash', 'deepseek-v4-flash'];
export const DEEPSEEK_PRO_ID = 'deepseek-v4-pro';

export function chooseDeepSeekModel(available: ReadonlySet<string> | null, dead: ReadonlySet<string> = new Set()): string {
  const usable = (id: string) => !dead.has(id);
  // 1) os nomes conhecidos do Flash, o atual primeiro
  for (const id of DEEPSEEK_FLASH_IDS) if (available?.has(id) && usable(id)) return id;
  // 2) qualquer outro Flash que a lista trouxer (um nome novo amanhã), menos os experimentais
  const other = [...(available ?? [])].find((id) => /flash/i.test(id) && !/exp|preview/i.test(id) && usable(id));
  if (other) return other;
  // 3) sem lista (ou lista sem Flash): ainda assim o Flash pelo nome atual, se não morreu
  const fallback = DEEPSEEK_FLASH_IDS.find(usable);
  if (fallback) return fallback;
  // 4) todos os Flash deram "não existe": aí sim o Pro
  return DEEPSEEK_PRO_ID;
}

/** Erro que quer dizer "esse modelo não existe/não está liberado" (e não um erro passageiro
 *  que só menciona a palavra "model", como "model is overloaded"). */
export function isModelMissingError(status: number, text: string): boolean {
  if (status === 404) return true;
  return /model[_ ]not[_ ]found|model[^.]{0,40}(does not exist|not exist|not available|not supported|unknown)|invalid model|unknown model/i.test(text);
}
