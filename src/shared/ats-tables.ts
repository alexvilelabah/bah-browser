// Tabelas de campos por ATS (sistema de candidatura): reconhecer QUAL sistema montou o formulário
// e casar o identificador estável do campo (name/id/data-automation-id…) com o item do perfil.
// O rótulo muda de empresa pra empresa ("Legal Name", "Full name ✱"); o identificador do sistema não.
// Montadas por nós a partir de formulários públicos (ver tests/fixtures/ats/*.json); não são cópia
// de tabela de nenhum outro produto. As regras genéricas de form-fill.ts continuam valendo depois.
import type { ProfileKey } from './form-fill.ts';

export type AtsId = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'icims' | 'smartrecruiters' | 'rippling';

/** 'skip' = o sistema diz que esse campo não é pra preencher nem perguntar (honeypot, peça interna, senha). */
export type AtsClass = ProfileKey | 'voluntary' | 'skip';

export interface AtsDomHints {
  /** name/id dos campos lidos na página (FieldInfo.name). */
  names?: string[];
  /** data-automation-id / data-field-path / data-input (FieldInfo.automationId). */
  automationIds?: string[];
}

export interface AtsFieldLike { label?: string; name?: string; type?: string; automationId?: string; options?: string[] }

export const ATS_IDS: AtsId[] = ['greenhouse', 'lever', 'ashby', 'workday', 'icims', 'smartrecruiters', 'rippling'];

const HOSTS: Array<[RegExp, AtsId]> = [
  [/(^|\.)greenhouse\.io$/, 'greenhouse'],
  [/(^|\.)lever\.co$/, 'lever'],
  [/(^|\.)ashbyhq\.com$/, 'ashby'],
  [/(^|\.)(myworkdayjobs|myworkdaysite|myworkday)\.com$/, 'workday'],
  [/(^|\.)icims\.com$/, 'icims'],
  [/(^|\.)smartrecruiters\.com$/, 'smartrecruiters'],
  [/^ats\.rippling\.com$/, 'rippling'],
];

// Assinaturas no próprio formulário: vagas embutidas no site da empresa (iframe/embed) têm outro host.
const NAME_SIGNS: Array<[RegExp, AtsId]> = [
  [/^job_application\[|^question_\d{6,}$/, 'greenhouse'],
  [/^urls\[[^\]]+\]$|^cards\[[0-9a-f-]{36}\]|^surveysResponses\[|^eeo\[/, 'lever'],
  [/^_systemfield_/, 'ashby'],
  [/^PersonProfileFields\./, 'icims'],
  [/^(legalName|address|phoneNumber|source|personalInfo[A-Z]*)--/, 'workday'],
];
const AID_SIGNS: Array<[RegExp, AtsId]> = [
  [/^formField-|^legalNameSection_|^addressSection_|^beecatcher$/, 'workday'],
  [/^_systemfield_/, 'ashby'],
];

/** Qual ATS montou a página: pelo endereço e, se não der (formulário embutido), pelos campos. */
export function detectAts(url: string, hints: AtsDomHints = {}): AtsId | null {
  let host = '', query = '';
  try { const u = new URL(url); host = u.hostname.toLowerCase(); query = u.search; } catch {}
  for (const [re, id] of HOSTS) if (host && re.test(host)) return id;
  if (/[?&]gh_jid=/.test(query)) return 'greenhouse';   // página da empresa com o formulário Greenhouse embutido
  for (const [re, id] of NAME_SIGNS) if ((hints.names || []).some(n => re.test(n || ''))) return id;
  for (const [re, id] of AID_SIGNS) if ((hints.automationIds || []).some(n => re.test(n || ''))) return id;
  return null;
}

type Row = [RegExp, AtsClass];

// Greenhouse (job-boards.greenhouse.io, React): id = first_name, last_name…; perguntas da empresa
// são question_<n> (vão pelo rótulo); EEO padrão com id fixo; demografia nova tem id só numérico
// (vai pelo rótulo). Formato antigo (boards.greenhouse.io): name="job_application[first_name]".
const GREENHOUSE: Row[] = [
  [/^(job_application\[)?first_name\]?$/, 'firstName'],
  [/^(job_application\[)?last_name\]?$/, 'lastName'],
  [/^(job_application\[)?preferred_name\]?$/, 'preferredName'],
  [/^(job_application\[)?email\]?$/, 'email'],
  [/^(job_application\[)?phone\]?$/, 'phone'],
  [/^country$/, 'country'],
  [/^candidate-location$|^job_application\[location\]$|^auto_complete_input$/, 'location'],
  [/^(job_application\[)?(gender|race|hispanic_ethnicity|veteran_status|disability_status)\]?$/, 'voluntary'],
];

// Lever (jobs.lever.co, HTML do servidor): nomes fixos; urls[<Rede>]; cards[uuid][fieldN] = perguntas
// da empresa (rótulo); surveysResponses[…] e eeo[…] = pesquisas de diversidade (voluntárias).
const LEVER: Row[] = [
  [/^name$/, 'fullName'],
  [/^email$/, 'email'],
  [/^phone$/, 'phone'],
  [/^location$/, 'location'],
  [/^org$/, 'currentCompany'],
  [/^urls\[linkedin\]$/i, 'linkedin'],
  [/^urls\[github\]$/i, 'github'],
  [/^urls\[(portfolio|website|personal website)\]$/i, 'website'],
  [/^urls\[(other|twitter|x)\]$/i, 'skip'],   // "Other website": não repetir o site no campo extra
  [/^pronouns$/, 'pronouns'],
  [/^customPronounsOption$/, 'skip'],
  [/^(surveysResponses|eeo)\[/, 'voluntary'],
  [/^consent\[/, 'skip'],                     // opt-in de marketing: é escolha da pessoa, não do perfil
];

// Ashby (jobs.ashbyhq.com): campos do sistema têm id/name "_systemfield_*" (ou data-field-path no
// contêiner, ex.: a localização com busca); perguntas da empresa são UUID (rótulo).
const ASHBY: Row[] = [
  [/^_systemfield_name$/, 'fullName'],
  [/^_systemfield_email$/, 'email'],
  [/^_systemfield_phone$/, 'phone'],
  [/^_systemfield_location$/, 'location'],
  [/^_systemfield_eeoc_/, 'voluntary'],       // não visto nos formulários lidos (eram fora dos EUA); padrão do nome do sistema
];

// Workday: formulário só depois de criar conta/entrar — o que é público é a etapa de conta.
// Identificadores vêm do contêiner data-automation-id="formField-<seção>--<campo>" (versão atual) ou
// do próprio input ("legalNameSection_firstName", versão antiga). Tokens conferidos no JS público do
// candidato (legalName, firstName, lastName, preferredName, phoneNumber, countryPhoneCode, source,
// hispanicOrLatino, ethnicity, gender, disabilityStatus, candidateIsPreviousWorker); seção de endereço
// e veteranStatus não puderam ser vistos sem conta.
const WORKDAY: Row[] = [
  [/^beecatcher$/, 'skip'],                   // honeypot "for robots only": preencher = marcar como robô
  [/^(password|verifyPassword)$/, 'skip'],
  [/(^|--|_)preferredName(--|_)firstName$/i, 'preferredName'],
  [/(^|--|_)(legalName|name)(Section)?(--|_)firstName$|^firstName$/i, 'firstName'],
  [/(^|--|_)(legalName|name)(Section)?(--|_)lastName$|^lastName$/i, 'lastName'],
  [/(^|--|_)(middleName|preferredCheck)$/i, 'skip'],   // "I have a preferred name" é caixa, não o nome
  [/(^|--|_)email(Address)?$/i, 'email'],
  [/(^|--|_)(countryPhoneCode|phoneType|extension)$|^phone-device-type$/i, 'skip'],
  [/(^|--|_)phoneNumber$|^phone-number$/i, 'phone'],
  [/(^|--|_)addressLine1$/i, 'address'],
  [/(^|--|_)city$/i, 'city'],
  [/(^|--|_)postalCode$/i, 'postalCode'],
  [/(^|--|_)countryRegion$/i, 'state'],
  [/^countryDropdown$|^country--country$|(^|--)country$/i, 'country'],
  [/^sourceDropdown$|(^|--)source$/i, 'howHeard'],
  [/(gender|ethnicity\w*|hispanicOrLatino|veteranStatus|disabilityStatus|selfIdentifiedDisabilityData\w*)$/i, 'voluntary'],
];

// iCIMS: candidatura começa por e-mail/conta (com hCaptcha invisível); o perfil vem depois de entrar.
// Nomes "PersonProfileFields.*" do formulário de perfil não puderam ser conferidos (atrás do login).
const ICIMS: Row[] = [
  [/^css_loginName$|PersonProfileFields\.Email$/i, 'email'],
  [/PersonProfileFields\.FirstName$/i, 'firstName'],
  [/PersonProfileFields\.LastName$/i, 'lastName'],
  [/PersonProfileFields\.(PhoneNumbers?\.\d+\.)?PhoneNumber$/i, 'phone'],
  [/AddressStreet1$/i, 'address'],
  [/AddressCity$/i, 'city'],
  [/AddressZip$/i, 'postalCode'],
  [/AddressState$/i, 'state'],
  [/AddressCountry$/i, 'country'],
  [/PersonProfileFields\.EEO/i, 'voluntary'],
];

// SmartRecruiters: o formulário (oneclick-ui) fica atrás de desafio anti-robô (DataDome) pra leitura
// automática; só os nomes óbvios, não conferidos. O resto vai pelas regras genéricas.
const SMARTRECRUITERS: Row[] = [
  [/^first-?name(-input)?$/i, 'firstName'],
  [/^last-?name(-input)?$/i, 'lastName'],
  [/^(confirm-?)?email(-input)?$/i, 'email'],
  [/^(phone-?number|phone)(-input)?$/i, 'phone'],
  [/^linkedin(-input)?$/i, 'linkedin'],
];

// Rippling (ats.rippling.com): name/id são aleatórios a cada carga; o estável é data-input no input.
const RIPPLING: Row[] = [
  [/^first_name$/, 'firstName'],
  [/^last_name$/, 'lastName'],
  [/^(preferred_name|preferred_first_name)$/, 'preferredName'],
  [/^email$/, 'email'],
  [/^phone_number$/, 'phone'],
  [/^current_company$/, 'currentCompany'],
  [/^current_title$/, 'currentTitle'],
  [/^linkedin_link$/, 'linkedin'],
  [/^github_link$/, 'github'],
  [/^(portfolio|website|personal_website)_link$/, 'website'],
];

export const ATS_TABLES: Record<AtsId, Row[]> = {
  greenhouse: GREENHOUSE, lever: LEVER, ashby: ASHBY, workday: WORKDAY, icims: ICIMS, smartrecruiters: SMARTRECRUITERS, rippling: RIPPLING,
};

// Grupos de autoidentificação voluntária (EEO) reconhecidos pelas OPÇÕES — o rótulo às vezes não vem
// (rádios do Ashby sem legend). Precisa de 2+ termos do grupo e uma opção de recusa.
const EEO_GROUPS: Array<[string, RegExp]> = [
  ['gender', /^(man|woman|male|female|non ?binary|another gender identity|i use another term)$/],
  ['race', /^(white|asian\b.*|black or african american|hispanic or latin[oaex]+|american indian or alaska native|native hawaiian or other pacific islander|two or more races)$/],
  ['veteran', /\b(protected )?veteran\b/],
  ['disability', /\bdisabilit(y|ies)\b/],
  ['age', /^(under \d+|\d+ (to )?\d+|\d+ or (older|over))$/],
];
const DECLINE_RE = /\b(decline|prefer not|do not wish|don t wish|not to (say|answer|disclose)|choose not)\b/;
// Ashby: a pesquisa de diversidade faz um checkbox por opção de raça/gênero/etc. Caixa solta com
// o nome de uma dessas opções: não marcar nem perguntar (a recusa é a caixa "I prefer not to answer").
const EEO_LONE_OPTION = /^(white|asian( or asian american)?|black or african american|hispanic or latin[oaex]+|indigenous or native american|native hawaiian or other pacific islander|man|woman|non ?binary|person with disability|neurodivergent|veteran|parent|refugee or immigrant|none of the above|other)$/;
// Honeypot comum em qualquer ATS: campo escondido do humano, "só pra robôs".
const HONEYPOT_RE = /\b(for robots only|if you( a| )?re human|leave (this )?(field )?(blank|empty))\b/;
// "Legal Name (if different than above)": campo extra pra quem tem outro nome — vazio é a resposta certa.
const IF_DIFFERENT_RE = /\bif different (than|from) (the )?above\b/;

const low = (s?: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[*:?!.,()[\]_/\\'’-]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Grupo EEO pelas opções (ex.: ['Man','Woman','I prefer not to answer'] → 'gender'), ou null. */
export function eeoGroupOf(options?: string[]): string | null {
  if (!options || options.length < 2) return null;
  const opts = options.map(low);
  if (!opts.some(o => DECLINE_RE.test(o))) return null;
  for (const [g, re] of EEO_GROUPS) if (opts.filter(o => re.test(o)).length >= 2) return g;
  return null;
}

/**
 * Classificação pela tabela do ATS (e pelas regras de ATS que valem pra todos: honeypot, senha,
 * grupo EEO pelas opções). null = a tabela não sabe; aí entram as regras genéricas por rótulo.
 */
export function classifyAtsField(f: AtsFieldLike, ats: AtsId | null | undefined): AtsClass | null {
  const label = low(f.label);
  if (f.type === 'password' || HONEYPOT_RE.test(label) || IF_DIFFERENT_RE.test(label)) return 'skip';
  if (ats) {
    const keys = [f.automationId, f.name].map(s => String(s || '').trim()).filter(Boolean);
    // Greenhouse: peça interna do react-select / telefone internacional (sem name nem id) — herda o
    // rótulo do vizinho ("Phone") e receberia o número no campo de busca de país.
    if (ats === 'greenhouse' && !keys.length && f.type !== 'file' && f.type !== 'radio' && f.type !== 'checkbox') return 'skip';
    for (const k of keys) {
      const bare = k.replace(/^formField-/, '');
      for (const [re, cls] of ATS_TABLES[ats]) if (re.test(bare)) return cls;
    }
  }
  if (ats === 'ashby' && f.type === 'checkbox' && f.options && f.options.length === 1 && EEO_LONE_OPTION.test(label)) return 'skip';
  if (eeoGroupOf(f.options)) return 'voluntary';
  // Só opções de recusa ("I prefer not to answer"): é a caixa de recusa de uma pesquisa voluntária.
  if (f.options && f.options.length && f.options.every(o => DECLINE_RE.test(low(o)))) return 'voluntary';
  return null;
}
