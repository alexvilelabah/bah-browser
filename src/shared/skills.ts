// Skills de navegação: receitas curtas em skills/<nome>/SKILL.md (formato compatível com o
// SKILL.md do Browse.sh / agent-browser: front matter + markdown). A cada passo o agente recebe
// SÓ as que casam com a página — por site, por estado da UI detectado (popup, autocomplete,
// calendário, EULA, seletor de SO…) e pelo tipo de tarefa. Prompt curto = modelo pequeno acerta.
//
// Front matter (subconjunto de YAML: `chave: valor` e `chave: [a, b]`):
//   name, description, sites (hosts; casa subdomínio), states, tasks, priority (maior primeiro)
// Uma skill casa quando TODAS as listas que ela declara casam (lista vazia = não restringe).
// Ordem: site > tarefa > estado — a receita do que a pessoa PEDIU vem antes da genérica da tela.

export interface Skill {
  name: string;
  description: string;
  sites: string[];
  states: string[];
  tasks: string[];
  priority: number;
  body: string;
  /** 'bundled' (skills/ do app) ou 'user' (<userData>/skills). */
  origin?: 'bundled' | 'user';
}

export interface SkillContext {
  url: string;
  /** Estados da UI detectados nesta página: dialog, suggestions, datepicker, eula, os-selector… */
  states: string[];
  /** Tipo da tarefa: download, search… */
  tasks: string[];
}

const list = (v: string): string[] =>
  v.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

export function parseSkill(text: string): Skill | null {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text || '');
  if (!m) return null;
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z_]+)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
  }
  const name = (meta.name || '').replace(/^['"]|['"]$/g, '');
  const body = m[2].trim();
  if (!name || !body) return null;
  return {
    name,
    description: (meta.description || '').replace(/^['"]|['"]$/g, ''),
    sites: list(meta.sites || '').map(s => s.toLowerCase()),
    states: list(meta.states || '').map(s => s.toLowerCase()),
    tasks: list(meta.tasks || '').map(s => s.toLowerCase()),
    priority: Number(meta.priority) || 0,
    body,
  };
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

/** As skills desta página, mais específicas primeiro (site > estado > tarefa), no máximo `max`. */
export function selectSkills(skills: Skill[], ctx: SkillContext, max = 3): Skill[] {
  const host = hostOf(ctx.url);
  const states = new Set(ctx.states.map(s => s.toLowerCase()));
  const tasks = new Set(ctx.tasks.map(s => s.toLowerCase()));
  const scored: Array<{ s: Skill; score: number }> = [];
  for (const s of skills) {
    if (!s.sites.length && !s.states.length && !s.tasks.length) continue;
    const siteHit = s.sites.some(d => host === d || host.endsWith('.' + d));
    const stateHits = s.states.filter(x => states.has(x)).length;
    const taskHit = s.tasks.some(x => tasks.has(x));
    if (s.sites.length && !siteHit) continue;
    if (s.states.length && !stateHits) continue;
    if (s.tasks.length && !taskHit) continue;
    scored.push({ s, score: (siteHit ? 6 : 0) + stateHits * 2 + (taskHit ? 3 : 0) + s.priority / 100 });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map(x => x.s);
}

/** TODAY em ISO + regra do ano: sem isso o modelo pequeno usa o ano do treino ("2023-12-12") e
 *  o site de hotel/voo não mostra nada (data no passado). */
export function todayLine(now = new Date()): string {
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const wd = now.toLocaleDateString('en-US', { weekday: 'long' });
  // Próximo fim de semana que AINDA não começou: a 1ª sexta depois de hoje (em sex/sáb/dom = o seguinte).
  const fri = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (((5 - now.getDay() + 7) % 7) || 7));
  const sun = new Date(fri.getFullYear(), fri.getMonth(), fri.getDate() + 2);
  const d = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return `TODAY: ${iso} (${wd}). A date without a year means its NEXT occurrence from today (never a past year from your training). Coming weekend ("next weekend"): Fri ${d(fri)} → Sun ${d(sun)} (hotel: check-in ${d(fri)}, check-out ${d(sun)}, 2 nights).`;
}

export function formatSkillsBlock(skills: Skill[], now = new Date()): string {
  if (!skills.length) return '';
  return `SKILLS FOR THIS PAGE (tested guidance for exactly this situation — follow it):\n${todayLine(now)}\n${skills.map(s => `### ${s.name}\n${s.body}`).join('\n\n')}`;
}

export const SKILL_MAX_WORDS = 220;
export const SKILL_STATES = ['dialog', 'suggestions', 'datepicker', 'eula', 'os-selector', 'searchbox', 'tabs', 'cards', 'signin'];
export const SKILL_TASKS = ['download', 'collection', 'search', 'travel', 'shopping', 'parts', 'people', 'grocery'];

/** As regras que toda skill (incluída, do usuário ou contribuída) tem que cumprir. */
export function validateSkill(markdown: string): { ok: true; skill: Skill } | { ok: false; error: string } {
  const s = parseSkill(markdown);
  if (!s) return { ok: false, error: 'Not a SKILL.md: needs front matter (--- name/description/triggers ---) and a body.' };
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.name) || s.name.length > 48) return { ok: false, error: `name "${s.name}" must be kebab-case (a-z, 0-9, -), max 48 chars.` };
  if (!s.description) return { ok: false, error: 'description is required.' };
  if (!s.sites.length && !s.states.length && !s.tasks.length) return { ok: false, error: 'needs at least one trigger: sites, states or tasks.' };
  const badState = s.states.find(x => !SKILL_STATES.includes(x));
  if (badState) return { ok: false, error: `unknown state "${badState}" (allowed: ${SKILL_STATES.join(', ')}).` };
  const badTask = s.tasks.find(x => !SKILL_TASKS.includes(x));
  if (badTask) return { ok: false, error: `unknown task "${badTask}" (allowed: ${SKILL_TASKS.join(', ')}).` };
  const words = s.body.split(/\s+/).filter(Boolean).length;
  if (words > SKILL_MAX_WORDS) return { ok: false, error: `body has ${words} words — keep it under ${SKILL_MAX_WORDS} (small models need short guidance).` };
  return { ok: true, skill: s };
}
