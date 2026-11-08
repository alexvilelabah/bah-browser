// O que o agente pode usar além das abas da própria tarefa: as ABAS da pessoa e o HISTÓRICO.
// Cada uma: 'ask' (padrão — pergunta na hora), 'allow' (sempre), 'deny' (nunca). A pessoa
// responde "sempre"/"nunca" na pergunta, ou troca no menu, quando quiser.
export type PermKind = 'userTabs' | 'history';
export type PermMode = 'ask' | 'allow' | 'deny';
const KEY = 'agentPerms';
const MODES: PermMode[] = ['ask', 'allow', 'deny'];

type Store = Pick<Storage, 'getItem' | 'setItem'> | null;
const safe = (): Store => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

export function getPerm(kind: PermKind, store: Store = safe()): PermMode {
  try {
    const v = JSON.parse(store?.getItem(KEY) || '{}')[kind];
    return MODES.includes(v) ? v : 'ask';
  } catch { return 'ask'; }
}

export function setPerm(kind: PermKind, mode: PermMode, store: Store = safe()): void {
  let all: Record<string, string> = {};
  try { all = JSON.parse(store?.getItem(KEY) || '{}') || {}; } catch {}
  all[kind] = mode;
  try { store?.setItem(KEY, JSON.stringify(all)); } catch {}
}

export function nextMode(m: PermMode): PermMode { return MODES[(MODES.indexOf(m) + 1) % MODES.length]; }

/** Resposta da pergunta → libera AGORA? e grava preferência quando for "sempre"/"nunca". */
export type PermAnswer = 'once' | 'always' | 'deny' | 'never';
export function applyAnswer(kind: PermKind, answer: PermAnswer, store: Store = safe()): boolean {
  if (answer === 'always') setPerm(kind, 'allow', store);
  if (answer === 'never') setPerm(kind, 'deny', store);
  return answer === 'once' || answer === 'always';
}
