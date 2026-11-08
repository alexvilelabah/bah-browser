// Lista suspensa com busca (react-select do Greenhouse, combobox ARIA, "prompt" do Workday):
// não dá pra gravar o valor no <input> — o componente só aceita uma OPÇÃO escolhida da lista.
// Aqui fica a parte pura: o que digitar pra filtrar, qual opção casa com o valor do perfil, e o
// passo a passo (abrir → ler opções → escolher → conferir) com o executor da página injetado.
// Os scripts de página ficam em renderer/dropdown-page.ts.
import { pickOption } from './form-fill.ts';

const norm = (s?: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[*:?!.,()[\]_/\\'’-]+/g, ' ').replace(/\s+/g, ' ').trim();

// Linhas da lista que não são opção (avisos do componente, marcador vazio).
const NOTICE = /^(no (options|results|matches|items)( found)?|loading|searching|type to search|start typing|select|choose|nenhum|carregando|sin (opciones|resultados)|cargando)\b/;

// Nomes que o perfil costuma ter e a lista escreve de outro jeito (país é o caso comum).
const ALIASES: string[][] = [
  ['united states', 'united states of america', 'usa', 'us', 'u s', 'u s a', 'estados unidos', 'eua', 'eeuu'],
  ['united kingdom', 'uk', 'u k', 'great britain', 'england', 'reino unido'],
  ['brazil', 'brasil'],
  ['germany', 'deutschland', 'alemanha', 'alemania'],
  ['netherlands', 'the netherlands', 'holland', 'holanda', 'paises baixos', 'paises bajos'],
  ['spain', 'espana', 'espanha'],
  ['mexico'],
  ['linkedin', 'linked in'],
];

const aliasesOf = (v: string): string[] => (ALIASES.find(g => g.includes(v)) || []).filter(a => a !== v);

/**
 * Qual opção da lista corresponde ao valor (-1 = nenhuma). Mesma semântica do pickOption
 * (sim/não, variantes de "recusar", exato, prefixo), ignorando avisos ("No options", "Loading…"),
 * mais apelidos de país e, por último, a ÚNICA opção que contém o valor como palavra
 * ("LinkedIn" → "Job board: LinkedIn").
 */
export function matchDropdownOption(options: string[], value: string): number {
  const real = (options || []).map(o => (NOTICE.test(norm(o)) ? '' : String(o || '')));
  const v = norm(value);
  if (!v) return -1;
  const direct = pickOption(real, value);
  if (direct >= 0) return direct;
  for (const a of aliasesOf(v)) { const i = pickOption(real, a); if (i >= 0) return i; }
  if (v === 'yes' || v === 'no' || v === 'decline' || v.length < 3) return -1;
  const word = new RegExp(`(^| )${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
  const hits = real.map((o, i) => (o && word.test(norm(o)) ? i : -1)).filter(i => i >= 0);
  return hits.length === 1 ? hits[0] : -1;
}

/**
 * O que digitar pra filtrar a lista, em ordem de tentativa. '' = abrir sem filtro e ler tudo
 * (sempre a última: o filtro do site pode não achar "USA" mas a lista inteira tem "United States").
 * "decline" não se digita — o texto da opção varia ("I don't wish to answer", "Prefer not to say").
 */
export function dropdownQueries(value: string): string[] {
  const raw = String(value || '').trim();
  const v = norm(raw);
  if (!v || v === 'decline') return [''];
  const out = [raw.slice(0, 60)];
  // Apelido → nome canônico ("USA" → "united states"); o canônico não precisa de outra tentativa.
  const group = ALIASES.find(g => g.includes(v));
  if (group && group[0] !== v) out.push(group[0]);
  out.push('');
  return out.filter((q, i) => out.indexOf(q) === i);
}

/** Scripts de página (string pra executeJavaScript) — ver renderer/dropdown-page.ts. */
export interface DropdownScripts {
  /** Abre a lista do campo idx (digitando query, se houver) e espera as opções: { ok, options } ou { ok:false, gone? }. */
  open(idx: number, query: string): string;
  /** Escolhe a opção com esse texto (eventos de ponteiro de verdade) e confere o campo: { ok, shown }. */
  pick(idx: number, text: string): string;
  /** Fecha a lista sem mudar o valor (limpa o que foi digitado). */
  close(idx: number): string;
}

export type PageExec = (js: string) => Promise<any>;

export interface DropdownResult { ok: boolean; text?: string; options?: string[] }

/**
 * Preenche UMA lista suspensa: pra cada consulta, abre, casa o valor com as opções que apareceram,
 * escolhe e confere. Nada casou → fecha sem mexer e devolve as opções vistas (vão pro cartão de
 * perguntas como escolhas).
 */
export async function fillDropdown(exec: PageExec, s: DropdownScripts, idx: number, value: string): Promise<DropdownResult> {
  let seen: string[] | undefined;
  for (const q of dropdownQueries(value)) {
    const r = await exec(s.open(idx, q)).catch(() => null);
    if (!r || r.gone) { await exec(s.close(idx)).catch(() => null); break; }
    const opts: string[] = Array.isArray(r.options) ? r.options.map(String) : [];
    const real = opts.filter(o => o && !NOTICE.test(norm(o)));
    if (real.length && (!q || !seen)) seen = real;
    const o = r.ok ? matchDropdownOption(opts, value) : -1;
    if (o >= 0) {
      const p = await exec(s.pick(idx, opts[o])).catch(() => null);
      if (p && p.ok) return { ok: true, text: opts[o] };
    }
    await exec(s.close(idx)).catch(() => null);
  }
  return { ok: false, options: seen };
}
