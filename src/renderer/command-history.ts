// Histórico de comandos da caixa da IA, estilo terminal: ↑ volta pros comandos já enviados,
// ↓ avança; passar do mais novo devolve o rascunho que estava sendo digitado. Persistido no
// localStorage (últimos MAX), sem repetir o mesmo comando seguido.

const KEY = 'cmdHistory';
const MAX = 100;

export class CommandHistory {
  private items: string[];
  private idx = -1;          // -1 = não está navegando; 0 = o mais recente
  private draft = '';
  private storage: Pick<Storage, 'getItem' | 'setItem'> | null;

  constructor(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()) {
    this.storage = storage;
    let loaded: unknown = [];
    try { loaded = JSON.parse(this.storage?.getItem(KEY) || '[]'); } catch {}
    this.items = Array.isArray(loaded) ? loaded.filter((x): x is string => typeof x === 'string').slice(-MAX) : [];
  }

  /** Registra um comando enviado e sai do modo navegação. */
  push(cmd: string): void {
    const c = cmd.trim();
    this.reset();
    if (!c || this.items[this.items.length - 1] === c) return;
    this.items.push(c);
    if (this.items.length > MAX) this.items.splice(0, this.items.length - MAX);
    try { this.storage?.setItem(KEY, JSON.stringify(this.items)); } catch {}
  }

  /** ↑: devolve o comando anterior, ou null se não há mais (fica no mais antigo). */
  up(current: string): string | null {
    if (this.items.length === 0) return null;
    if (this.idx === -1) this.draft = current;
    if (this.idx >= this.items.length - 1) return null;
    this.idx++;
    return this.items[this.items.length - 1 - this.idx];
  }

  /** ↓: devolve o próximo mais novo; passando do mais novo, o rascunho. null = não estava navegando. */
  down(): string | null {
    if (this.idx === -1) return null;
    this.idx--;
    return this.idx === -1 ? this.draft : this.items[this.items.length - 1 - this.idx];
  }

  /** A pessoa editou o texto: sai da navegação (o próximo ↑ recomeça do mais recente). */
  reset(): void { this.idx = -1; this.draft = ''; }

  get browsing(): boolean { return this.idx !== -1; }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
