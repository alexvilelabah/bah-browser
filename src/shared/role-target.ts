// click_role: "o 2º botão chamado Enviar" sem ref numérico (como `find role button --name` do agent-browser).
// Resolve contra a lista de elementos observada e vira um click_ref comum (mesmos freios/verificações).
export type RoleEl = { id: number; tag?: string; role?: string; text?: string; aria?: string; placeholder?: string };

const ROLE_ALIASES: Record<string, string[]> = {
  button: ['button'], link: ['link', 'a'], textbox: ['textbox', 'searchbox', 'input', 'textarea'],
  checkbox: ['checkbox'], radio: ['radio'], combobox: ['combobox', 'select', 'listbox'], tab: ['tab'],
  menuitem: ['menuitem', 'menuitemcheckbox', 'menuitemradio'], option: ['option'], switch: ['switch'],
};

function roleOf(e: RoleEl): string {
  const r = (e.role || '').toLowerCase();
  if (r) return r;
  return e.tag === 'a' ? 'link' : e.tag === 'button' ? 'button' : e.tag === 'select' ? 'combobox' : e.tag === 'input' || e.tag === 'textarea' ? 'textbox' : '';
}

/** Elementos que casam papel + nome (exatos primeiro), na ordem da página. */
export function matchRole(els: RoleEl[], role: string, name?: string): RoleEl[] {
  const want = ROLE_ALIASES[role.toLowerCase()] || [role.toLowerCase()];
  const n = (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const label = (e: RoleEl) => `${e.text || ''} ${e.aria || ''} ${e.placeholder || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
  const byRole = els.filter(e => want.includes(roleOf(e)));
  if (!n) return byRole;
  const exact = byRole.filter(e => [e.text, e.aria, e.placeholder].some(x => (x || '').trim().toLowerCase().replace(/\s+/g, ' ') === n));
  const partial = byRole.filter(e => !exact.includes(e) && label(e).includes(n));
  return [...exact, ...partial];
}
