// Preenchimento de formulário de candidatura SEM IA: o que a pessoa guardou uma vez (perfil +
// respostas salvas) vai pros campos por código. O modelo pequeno errava o básico (dizia que o
// currículo não tinha e-mail). Ordem: (1) ler o formulário, (2) casar cada campo com o perfil /
// respostas salvas / fatos do currículo, (3) o que sobrar a pessoa responde uma vez (e fica salvo).
// Ideia de "tabela de campos" inspirada em extensões de autopreenchimento; regras escritas aqui.
// Antes das regras por rótulo vem a tabela do ATS reconhecido (ats-tables.ts): identificador estável ganha.
import { classifyAtsField, detectAts, type AtsId } from './ats-tables.ts';

export interface ApplicantProfile {
  firstName?: string; lastName?: string; preferredName?: string;
  email?: string; phone?: string;
  address?: string; city?: string; state?: string; postalCode?: string; country?: string;
  linkedin?: string; github?: string; website?: string;
  currentCompany?: string; currentTitle?: string; yearsExperience?: string;
  /** 'yes' | 'no' — autorizado a trabalhar no país da vaga. */
  workAuthorized?: string;
  /** 'yes' | 'no' — vai precisar de visto patrocinado. */
  needsSponsorship?: string;
  willingToRelocate?: string;
  startDate?: string; salaryExpectation?: string; pronouns?: string;
  howHeard?: string;
  /** Autoidentificação voluntária (gênero, raça, veterano, deficiência): 'decline' (padrão) ou 'ask'. */
  voluntary?: 'decline' | 'ask';
}

export type ProfileKey = Exclude<keyof ApplicantProfile, 'voluntary'> | 'fullName' | 'location';

export interface FieldInfo {
  /** Índice estável na página (data-bah-ff). */
  idx: number;
  label: string;
  /** text, email, tel, url, textarea, select, radio, checkbox, file, number, date… */
  type: string;
  name?: string;
  autocomplete?: string;
  required?: boolean;
  /** select/rádio/caixa: textos das opções (na ordem). */
  options?: string[];
  /** já tem valor */
  filled?: boolean;
  /** Identificador estável do sistema: data-automation-id (Workday), data-field-path (Ashby), data-input (Rippling). */
  automationId?: string;
}

export interface FillDecision { idx: number; label: string; value?: string; option?: number; source: 'profile' | 'saved' | 'resume' | 'voluntary' }

const norm = (s?: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[*:?!.,()[\]_/\\'’-]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Chave da pergunta pra respostas salvas: sem pontuação/caixa/espaço extra, e sem "(required)". */
export function questionKey(label: string): string {
  return norm(label).replace(/\b(required|optional|obrigatorio)\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

const AUTOCOMPLETE: Record<string, ProfileKey> = {
  'given-name': 'firstName', 'family-name': 'lastName', name: 'fullName', email: 'email', tel: 'phone', 'tel-national': 'phone',
  'street-address': 'address', 'address-line1': 'address', 'address-level2': 'city', 'address-level1': 'state',
  'postal-code': 'postalCode', country: 'country', 'country-name': 'country', organization: 'currentCompany',
  'organization-title': 'currentTitle', url: 'website',
};

// Ordem importa: o mais específico primeiro ("preferred first name" antes de "first name"; "last name" antes de "name").
const RULES: Array<[RegExp, ProfileKey]> = [
  [/\b(preferred|nick) ?(first )?name\b/, 'preferredName'],
  [/\b(first|given) name\b|^first$|\bnome\b(?! completo)|\bprimeiro nome\b/, 'firstName'],
  [/\b(last|family|sur) ?name\b|^last$|\bsobrenome\b/, 'lastName'],
  [/\blinkedin\b/, 'linkedin'],
  [/\bgithub\b/, 'github'],
  [/\b(website|portfolio|personal (site|url)|blog)\b/, 'website'],
  [/\be ?mail\b/, 'email'],
  [/\b(phone|mobile|cell|telephone|telefone|celular)\b/, 'phone'],
  [/\b(street|address line|mailing address|^address$)\b/, 'address'],
  [/\b(zip|postal) ?code\b|\bcep\b/, 'postalCode'],
  [/^city\b|\bcity of residence\b|\bcidade\b/, 'city'],
  [/^(state|province|region)\b|\bstate of residence\b/, 'state'],
  [/^country\b|\bcountry of residence\b|\bpais\b/, 'country'],
  [/\b(current|present|most recent) (company|employer)\b|^company$|^employer$/, 'currentCompany'],
  [/\b(current|present|most recent) (job )?(title|role|position)\b/, 'currentTitle'],
  [/\b(where are you|current) ?(located|location)\b|^location\b/, 'location'],
  [/\b(full|legal) name\b|^name$|^your name$|\bnome completo\b/, 'fullName'],
  [/\b(require|need)s?\b.*\bsponsor|\bsponsorship\b|\bvisa\b.*\b(require|need)/, 'needsSponsorship'],
  [/\b(legally )?(authori[sz]ed|eligible|permitted) to work\b|\bright to work\b|\bwork authori[sz]ation\b/, 'workAuthorized'],
  [/\b(willing|open) to relocate\b|\brelocation\b/, 'willingToRelocate'],
  [/\b(earliest )?start date\b|\bwhen can you start\b|\bnotice period\b|\bavailab(le|ility) to start\b/, 'startDate'],
  [/\b(salary|compensation|pay) (expectation|requirement|range|desired)s?\b|\bdesired (salary|compensation)\b|\bexpected salary\b/, 'salaryExpectation'],
  [/\bpronouns?\b/, 'pronouns'],
  [/\bhow did you hear\b|\bwhere did you (hear|find|learn)\b|\breferral source\b|\bsource\b.*\bapplication\b/, 'howHeard'],
  [/\byears of (professional )?experience\b|\bhow many years\b.*\bexperience\b/, 'yearsExperience'],
];

/** Autoidentificação voluntária (EEO): gênero, raça/etnia, veterano, deficiência, orientação. */
export const VOLUNTARY_RE = /\b(gender|sex|race|ethnic\w*|hispanic|latino|veteran|disabilit\w*|self ?identif\w*|sexual orientation|transgender|lgbt)\b/;

/**
 * Item do perfil pra um campo. Com o ATS (detectAts), a tabela dele vem primeiro; 'skip' = não
 * preencher nem perguntar (honeypot, senha, peça interna do widget).
 */
export function classifyField(f: Pick<FieldInfo, 'label' | 'name' | 'autocomplete' | 'type' | 'options' | 'automationId'>, ats?: AtsId | null): ProfileKey | 'voluntary' | 'skip' | null {
  const byAts = classifyAtsField(f, ats);
  if (byAts) return byAts;
  const ac = String(f.autocomplete || '').toLowerCase().trim().split(/\s+/).pop() || '';   // "section-x shipping given-name" → given-name
  if (AUTOCOMPLETE[ac]) return AUTOCOMPLETE[ac];
  if (f.type === 'email') return 'email';
  if (f.type === 'tel') return 'phone';
  const label = norm(f.label), name = norm(f.name);
  if (VOLUNTARY_RE.test(label) || (f.options && VOLUNTARY_RE.test(norm(f.options.join(' '))) && /\b(decline|prefer not|do not wish)\b/.test(norm(f.options.join(' '))))) return 'voluntary';
  for (const [re, key] of RULES) if (re.test(label)) return key;
  for (const [re, key] of RULES) if (name && re.test(name.replace(/[_-]+/g, ' '))) return key;
  return null;
}

function profileValue(p: ApplicantProfile, key: ProfileKey): string {
  if (key === 'fullName') return [p.firstName, p.lastName].filter(Boolean).join(' ');
  if (key === 'location') return [p.city, p.state, p.country].filter(Boolean).join(', ');
  return String((p as any)[key] || '').trim();
}

/** Opção que corresponde a um valor ("yes" → "Yes, I am authorized…"; "decline" → "I don't wish to answer"). */
export function pickOption(options: string[], value: string): number {
  const v = norm(value);
  const opts = options.map(norm);
  if (!v) return -1;
  if (v === 'decline') return opts.findIndex(o => /\b(decline|prefer not|do not wish|don t wish|not to (say|answer|disclose)|choose not|i do not want)\b/.test(o));
  if (v === 'yes' || v === 'no') return opts.findIndex(o => new RegExp(`^${v}\\b`).test(o));
  const exact = opts.indexOf(v);
  if (exact >= 0) return exact;
  return opts.findIndex(o => o && (o.startsWith(v) || v.startsWith(o)));
}

/**
 * O que preencher em cada campo (só os vazios). saved = respostas salvas por questionKey.
 * facts = do currículo lido (nome/e-mail/telefone) quando o perfil não tem.
 */
export function planFill(fields: FieldInfo[], profile: ApplicantProfile, saved: Record<string, string> = {}, facts: { name?: string; email?: string; phone?: string } = {}, opts: { url?: string; ats?: AtsId | null } = {}): { fill: FillDecision[]; missing: FieldInfo[] } {
  const fill: FillDecision[] = [], missing: FieldInfo[] = [];
  // ATS pela URL ou, no formulário embutido no site da empresa, pelos próprios campos.
  const ats = opts.ats !== undefined ? opts.ats : detectAts(opts.url || '', { names: fields.map(f => f.name || ''), automationIds: fields.map(f => f.automationId || '') });
  const [factFirst, ...factRest] = String(facts.name || '').split(' ');
  for (const f of fields) {
    if (f.filled || f.type === 'file' || f.type === 'hidden' || f.type === 'password') continue;
    const choice = !!(f.options && f.options.length);
    const set = (value: string, source: FillDecision['source']): boolean => {
      if (!value) return false;
      if (choice) { const o = pickOption(f.options!, value); if (o < 0) return false; fill.push({ idx: f.idx, label: f.label, option: o, source }); return true; }
      fill.push({ idx: f.idx, label: f.label, value, source }); return true;
    };
    const key = classifyField(f, ats);
    if (key === 'skip') continue;
    const savedAns = saved[questionKey(f.label)];
    if (savedAns != null && set(savedAns, 'saved')) continue;
    if (key === 'voluntary') {
      if ((profile.voluntary || 'decline') === 'decline' && set('decline', 'voluntary')) continue;
      missing.push(f); continue;
    }
    if (key) {
      if (set(profileValue(profile, key), 'profile')) continue;
      const fromResume = key === 'email' ? facts.email : key === 'phone' ? facts.phone : key === 'fullName' ? facts.name
        : key === 'firstName' ? factFirst : key === 'lastName' ? factRest.join(' ') : '';
      if (fromResume && set(fromResume, 'resume')) continue;
    }
    if (f.required || choice || key) missing.push(f);
  }
  return { fill, missing };
}
