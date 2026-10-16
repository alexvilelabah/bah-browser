// Senhas salvas — o que passa entre o main e a tela do Bah (preload.ts → window.electronAPI.passwords).
// A tela NUNCA recebe senha guardada nem cifrada: só o site, o usuário e o tamanho da senha. A senha
// só aparece na tela quando a pessoa clica no olho (e, no gerenciador, depois da confirmação do main).

export interface PwRect { x: number; y: number; w: number; h: number }

/** "Salvar senha?" / "Atualizar senha?" — a senha fica no main; aqui só o tamanho (pras bolinhas). */
export interface PwOffer { id: string; wcId: number; host: string; username: string; length: number; update: boolean }

/** Lista de contas pra preencher, desenhada pelo Bah em cima do campo (rect = posição do campo na aba). */
export interface PwSuggest {
  id: string; wcId: number; host: string; insecure: boolean; role: 'username' | 'password';
  rect: PwRect; accounts: Array<{ id: string; username: string }>;
}

export interface PwEntryView { id: string; origin: string; host: string; username: string; created: number; lastUsed: number }

export interface PwState {
  vault: 'ok' | 'unavailable';   // sem cofre do sistema a função fica desligada (nunca grava texto puro)
  readOnly?: boolean;            // o arquivo existe mas não abriu: nada é gravado até reiniciar (não perde nada)
  offerToSave: boolean;
  entries: PwEntryView[];
  never: Array<{ origin: string; host: string }>;
}

export type PwError = 'canceled' | 'not-found' | 'decrypt' | 'vault' | 'duplicate' | 'empty' | 'invalid' | 'write-failed' | 'too-big' | 'read-failed';
export type PwResult<T = object> = ({ ok: true } & T) | { ok: false; error: PwError };

export interface PwImportStats { added: number; duplicates: number; conflicts: number; invalid: number; trashed: boolean }

export interface PasswordsBridge {
  state: () => Promise<PwState>;
  onChanged: (cb: () => void) => () => void;
  onOffer: (cb: (o: PwOffer) => void) => () => void;
  onOfferCancel: (cb: (id: string) => void) => () => void;
  answerOffer: (id: string, answer: 'save' | 'never' | 'dismiss', username?: string) => Promise<PwResult>;
  revealOffer: (id: string) => Promise<PwResult<{ password: string }>>;
  onSuggest: (cb: (s: PwSuggest) => void) => () => void;
  onSuggestHide: (cb: (p: { wcId: number }) => void) => () => void;
  fill: (suggestId: string, entryId: string) => Promise<PwResult>;
  setOfferToSave: (on: boolean) => Promise<PwResult>;
  reveal: (id: string) => Promise<PwResult<{ password: string }>>;
  copy: (id: string, what: 'username' | 'password') => Promise<PwResult<{ clearsInSec?: number }>>;
  update: (id: string, patch: { username: string; password?: string }) => Promise<PwResult>;
  remove: (id: string) => Promise<PwResult>;
  removeNever: (origin: string) => Promise<PwResult>;
  importCsv: () => Promise<PwResult<PwImportStats>>;
  exportCsv: () => Promise<PwResult<{ count: number; file: string }>>;
  lock: () => void;
}
