// ─────────────────────────────────────────────────────────────────────────────
// i18n leve (sem dependência). A UI segue o idioma do SISTEMA OPERACIONAL
// (navigator.language), com INGLÊS de base — igual ao Chrome. O usuário pode
// trocar nas Configurações (setLang salva e recarrega a UI). Fase 1: en/pt/es.
// ─────────────────────────────────────────────────────────────────────────────
export type Lang = 'en' | 'pt' | 'es';

export const LANGS: Array<{ code: Lang; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'pt', label: 'Português' },
  { code: 'es', label: 'Español' },
];

const dict: Record<Lang, Record<string, string>> = {
  en: {
    // Barra de endereço + janela
    'addr.placeholder': 'Search Google or type a URL',
    'addr.back': 'Back',
    'addr.forward': 'Forward',
    'addr.reload': 'Reload',
    'addr.bookmark.add': 'Add to favorites',
    'addr.bookmark.remove': 'Remove from favorites',
    'win.minimize': 'Minimize',
    'win.maximize': 'Maximize',
    'win.close': 'Close',
    'tab.new': 'New tab',
    // Buscar na página
    'find.placeholder': 'Find on page…',
    'find.prev': 'Previous (Shift+Enter)',
    'find.next': 'Next (Enter)',
    'find.close': 'Close (Esc)',
    // Atalhos da nova aba (speed-dial)
    'sd.add': 'Add',
    'sd.addShortcut': 'Add shortcut',
    'sd.remove': 'Remove',
    'sd.new': 'New shortcut',
    'sd.name': 'Name (optional)',
    'sd.url': 'URL — e.g.: youtube.com',
    'sd.cancel': 'Cancel',
    'sd.ok': 'Add',
    // Menu (⋮)
    'menu.title': 'Menu',
    'menu.adblock': 'Ad blocker',
    'menu.googleLogin': 'Sign in to Google',
    'menu.favorites': 'Favorites',
    'menu.save': '+ Save',
    'menu.noFavorites': 'No favorites yet.',
    'menu.language': 'Language',
    // Assistente / configurações
    'assist.title': 'Assistant',
    'assist.settings': 'Settings',
    'assist.clear': 'Clear',
    'assist.close': 'Close',
    'settings.save': 'Save',
    'settings.language': 'Interface language',
    'login.google': 'Sign in to Google',
    'login.subline': 'or type a command — the agent does the rest.',
  },
  pt: {
    'addr.placeholder': 'Pergunte ao Google ou digite um URL',
    'addr.back': 'Voltar',
    'addr.forward': 'Avançar',
    'addr.reload': 'Recarregar',
    'addr.bookmark.add': 'Adicionar aos favoritos',
    'addr.bookmark.remove': 'Remover dos favoritos',
    'win.minimize': 'Minimizar',
    'win.maximize': 'Maximizar',
    'win.close': 'Fechar',
    'tab.new': 'Nova aba',
    'find.placeholder': 'Buscar na página…',
    'find.prev': 'Anterior (Shift+Enter)',
    'find.next': 'Próximo (Enter)',
    'find.close': 'Fechar (Esc)',
    'sd.add': 'Adicionar',
    'sd.addShortcut': 'Adicionar atalho',
    'sd.remove': 'Remover',
    'sd.new': 'Novo atalho',
    'sd.name': 'Nome (opcional)',
    'sd.url': 'URL — ex.: youtube.com',
    'sd.cancel': 'Cancelar',
    'sd.ok': 'Adicionar',
    'menu.title': 'Menu',
    'menu.adblock': 'Bloqueador de anúncios',
    'menu.googleLogin': 'Entrar no Google',
    'menu.favorites': 'Favoritos',
    'menu.save': '+ Salvar',
    'menu.noFavorites': 'Nenhum favorito ainda.',
    'menu.language': 'Idioma',
    'assist.title': 'Assistente',
    'assist.settings': 'Configurações',
    'assist.clear': 'Limpar',
    'assist.close': 'Fechar',
    'settings.save': 'Salvar',
    'settings.language': 'Idioma da interface',
    'login.google': 'Entrar no Google',
    'login.subline': 'ou escreva um comando — o agente faz o resto.',
  },
  es: {
    'addr.placeholder': 'Busca en Google o escribe una URL',
    'addr.back': 'Atrás',
    'addr.forward': 'Adelante',
    'addr.reload': 'Recargar',
    'addr.bookmark.add': 'Añadir a favoritos',
    'addr.bookmark.remove': 'Quitar de favoritos',
    'win.minimize': 'Minimizar',
    'win.maximize': 'Maximizar',
    'win.close': 'Cerrar',
    'tab.new': 'Nueva pestaña',
    'find.placeholder': 'Buscar en la página…',
    'find.prev': 'Anterior (Shift+Enter)',
    'find.next': 'Siguiente (Enter)',
    'find.close': 'Cerrar (Esc)',
    'sd.add': 'Añadir',
    'sd.addShortcut': 'Añadir acceso directo',
    'sd.remove': 'Quitar',
    'sd.new': 'Nuevo acceso directo',
    'sd.name': 'Nombre (opcional)',
    'sd.url': 'URL — ej.: youtube.com',
    'sd.cancel': 'Cancelar',
    'sd.ok': 'Añadir',
    'menu.title': 'Menú',
    'menu.adblock': 'Bloqueador de anuncios',
    'menu.googleLogin': 'Iniciar sesión en Google',
    'menu.favorites': 'Favoritos',
    'menu.save': '+ Guardar',
    'menu.noFavorites': 'Aún no hay favoritos.',
    'menu.language': 'Idioma',
    'assist.title': 'Asistente',
    'assist.settings': 'Configuración',
    'assist.clear': 'Limpiar',
    'assist.close': 'Cerrar',
    'settings.save': 'Guardar',
    'settings.language': 'Idioma de la interfaz',
    'login.google': 'Iniciar sesión en Google',
    'login.subline': 'o escribe un comando — el agente hace el resto.',
  },
};

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem('uiLang');
    if (saved === 'en' || saved === 'pt' || saved === 'es') return saved;
  } catch {}
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase();
  if (nav.startsWith('pt')) return 'pt';
  if (nav.startsWith('es')) return 'es';
  return 'en';
}

let currentLang: Lang = detectLang();

// Quem quiser re-renderizar quando o idioma mudar se inscreve aqui (a UI não recarrega
// — assim o menu/Configurações NÃO fecham ao trocar o idioma).
const langListeners = new Set<() => void>();
export function onLangChange(fn: () => void): () => void {
  langListeners.add(fn);
  return () => { langListeners.delete(fn); };
}

export function getLang(): Lang { return currentLang; }

export function setLang(l: Lang): void {
  currentLang = l;
  try { localStorage.setItem('uiLang', l); } catch {}
  langListeners.forEach(fn => { try { fn(); } catch {} });
}

// Tradução. Cai pro inglês se faltar a chave no idioma; senão devolve a própria chave.
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = (dict[currentLang] && dict[currentLang][key]) || dict.en[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]));
  return s;
}
