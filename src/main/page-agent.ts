import { AIEngine } from './ai-engine';

export type AgentAction =
  | { type: 'plan'; steps: string[] }
  | { type: 'store'; key: string; value: any; source?: string }
  | { type: 'extract_text'; max_chars?: number }
  | { type: 'extract_images'; min_width?: number }
  | { type: 'search_images'; query: string; min_width?: number; count?: number }
  | { type: 'harvest_images'; query: string; count?: number; min_width?: number }
  | { type: 'generate_image'; prompt: string; count?: number }
  | { type: 'download'; url: string; filename?: string }
  | { type: 'download_video'; url?: string; query?: string; audio_only?: boolean; count?: number; quality?: 'best' | 'low' }
  | { type: 'open_video_cuts'; phrase: string; count?: number }
  | { type: 'open_video'; query: string }
  | { type: 'create_playlist'; songs: string[]; name?: string; private?: boolean }
  | { type: 'make_supercut'; phrase: string; count?: number }
  | { type: 'render_view'; title: string; columns: string[]; rows: Array<Array<string | number>>; chart?: { type: 'bar'; label: string; labels: string[]; values: number[] }; subtitle?: string; source_note?: string }
  | { type: 'stock_movers'; direction: 'gainers' | 'losers'; count?: number }
  | { type: 'compare_prices'; query: string }
  | { type: 'google_news'; query: string }
  | { type: 'ask_ai'; question: string }
  | { type: 'find_file'; query: string; filetype?: string }
  | { type: 'read_aloud'; text?: string }
  | { type: 'report'; summary: string }
  | { type: 'switch_tab'; tab: number }
  | { type: 'new_tab'; url: string }
  | { type: 'close_tab'; tab: number }
  | { type: 'click_ref'; ref: number }
  | { type: 'fill_ref'; ref: number; value: string }
  | { type: 'click_text'; text: string; nth?: number }
  | { type: 'click_at'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'fill'; selector?: string; label?: string; value: string }
  | { type: 'press'; key: string }
  | { type: 'navigate'; url: string }
  | { type: 'scroll'; direction: 'up' | 'down' | 'top' | 'bottom'; amount?: number }
  | { type: 'wait'; ms?: number; selector?: string; timeout?: number }
  | { type: 'done'; reason: string; success: boolean };

export interface AgentResult {
  thought: string;
  action: AgentAction;
  /** Full list when the model batches multiple actions in one step (FAST MODE). action === actions[0]. */
  actions?: AgentAction[];
  /** Model's self-judgement of whether its PREVIOUS action succeeded (forced reflection). */
  evaluation?: string;
  error?: string;
}

/** Action types that are safe to batch in one step (same-page interactions; downloads don't change the page). */
const BATCHABLE_ACTIONS = new Set(['fill_ref', 'fill', 'type', 'press', 'click_ref', 'click_text', 'scroll', 'download', 'download_video']);

const VALID_ACTIONS = new Set([
  'plan',
  'store',
  'extract_text',
  'extract_images',
  'search_images',
  'harvest_images',
  'generate_image',
  'download',
  'download_video',
  'open_video_cuts',
  'open_video',
  'create_playlist',
  'make_supercut',
  'render_view',
  'stock_movers',
  'compare_prices',
  'google_news',
  'ask_ai',
  'find_file',
  'read_aloud',
  'report',
  'switch_tab',
  'new_tab',
  'close_tab',
  'click_ref',
  'fill_ref',
  'click_text',
  'click_at',
  'type',
  'fill',
  'press',
  'navigate',
  'scroll',
  'wait',
  'done',
]);

export class PageAgent {
  private aiEngine: AIEngine;

  constructor(aiEngine: AIEngine) {
    this.aiEngine = aiEngine;
  }

  async executeCommand(command: string, observedState?: string, screenshot?: string, tier: 'flash' | 'pro' = 'pro'): Promise<AgentResult & { metrics?: any }> {
    try {
      const r = await this.aiEngine.generateAction(command, observedState, screenshot, tier);
      const parsed = this.parseResponse(r.text);
      return { ...parsed, metrics: { usage: r.usage, latencyMs: r.latencyMs, model: r.model } };
    } catch (err: any) {
      return {
        thought: 'Failed to generate action',
        action: { type: 'done', reason: err.message ?? String(err), success: false },
        error: err.message ?? String(err),
      };
    }
  }

  private parseResponse(raw: string): AgentResult {
    let jsonStr = raw;

    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    try {
      let parsed: any = null;
      try { parsed = JSON.parse(jsonStr); } catch {}
      // Fallback p/ modelos de raciocínio (gpt-oss) que vazam texto ANTES do JSON →
      // recupera o último objeto de ação válido. A nuvem (JSON limpo) parseia de primeira
      // e nunca cai aqui, então o caminho da API fica intocado.
      if (!parsed || typeof parsed !== 'object') parsed = recoverActionObject(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('no valid JSON object');
      let actionRaw = parsed.action ?? parsed.tool;
      if (!actionRaw && Array.isArray(parsed.actions) && parsed.actions.length > 0) actionRaw = parsed.actions[0];
      if (!actionRaw && parsed.type) actionRaw = parsed;
      
      // If action is a nested string, try parsing it
      if (typeof actionRaw === 'string' && actionRaw.startsWith('{')) {
        try { actionRaw = JSON.parse(actionRaw); } catch {}
      }
      
      // If action is just a string name (flat format), map the root params into it
      if (typeof actionRaw === 'string' && !actionRaw.startsWith('{')) {
        actionRaw = { type: actionRaw, ...parsed };
      }
      
      const action = this.normalizeAction(actionRaw);
      if (action.type === 'done' && /Invalid|missing action/.test(action.reason)) {
        try {
          require('fs').appendFileSync(
            require('path').join(require('electron').app.getPath('userData'), 'agent.log'),
            `${new Date().toISOString()} [Parser] Bad action shape. Raw: ${raw.slice(0, 1000)}\n`
          );
        } catch {}
      }

      // FAST MODE: parse a batch of actions when the model returns an "actions" array.
      let actions: AgentAction[] | undefined;
      if (Array.isArray(parsed.actions) && parsed.actions.length > 1) {
        const normalized: AgentAction[] = [];
        for (const rawItem of parsed.actions) {
          let item = rawItem;
          if (typeof item === 'string' && item.startsWith('{')) { try { item = JSON.parse(item); } catch {} }
          if (typeof item === 'string') item = { type: item };
          const a = this.normalizeAction(item);
          // Stop the batch at the first action that isn't safe to chain (e.g. navigate/done).
          if (!BATCHABLE_ACTIONS.has(a.type)) {
            if (normalized.length === 0) normalized.push(a); // keep at least the first
            break;
          }
          normalized.push(a);
          if (normalized.length >= 4) break; // cap batch size
        }
        if (normalized.length > 1) actions = normalized;
      }

      return {
        thought: String(parsed.thought ?? parsed.reasoning ?? ''),
        evaluation: parsed.evaluation ? String(parsed.evaluation) : undefined,
        action: actions ? actions[0] : action,
        actions,
      };
    } catch {
      try {
        require('fs').appendFileSync(
          require('path').join(require('electron').app.getPath('userData'), 'agent.log'),
          `${new Date().toISOString()} [Parser] JSON parse failed. Raw: ${raw.slice(0, 1000)}\n`
        );
      } catch {}
      return {
        thought: raw,
        action: { type: 'done', reason: 'Model did not return valid structured JSON.', success: false },
        error: 'Model did not return valid structured JSON.',
      };
    }
  }

  private normalizeAction(action: any): AgentAction {
    // Accept the batch-item / alternate shape { "action": "fill_ref", ... } in addition
    // to { "type": "fill_ref", ... }. The model emits "action" as the tool-name key
    // (especially inside an "actions" array), so coerce it into "type" here.
    if (action && typeof action === 'object' && action.type == null) {
      const aliased = action.action ?? action.tool;
      if (typeof aliased === 'string') action = { ...action, type: aliased };
    }
    if (!action || typeof action !== 'object' || !VALID_ACTIONS.has(action.type)) {
      if (action?.done === true || action?.success !== undefined || action?.reason) {
        return { type: 'done', reason: String(action.reason ?? 'Task complete.'), success: action.success !== false };
      }
      return { type: 'done', reason: 'Invalid or missing action type from model.', success: false };
    }

    switch (action.type) {
      case 'plan':
        return { type: 'plan', steps: Array.isArray(action.steps) ? action.steps.map(String) : [] };
      case 'store':
        return { type: 'store', key: String(action.key ?? ''), value: action.value, source: action.source ? String(action.source) : undefined };
      case 'extract_text':
        return { type: 'extract_text', max_chars: toOptionalNumber(action.max_chars) };
      case 'extract_images':
        return { type: 'extract_images', min_width: toOptionalNumber(action.min_width) };
      case 'search_images':
        return { type: 'search_images', query: String(action.query ?? action.text ?? ''), min_width: toOptionalNumber(action.min_width), count: toOptionalNumber(action.count) };
      case 'harvest_images':
        return { type: 'harvest_images', query: String(action.query ?? action.text ?? ''), count: toOptionalNumber(action.count), min_width: toOptionalNumber(action.min_width) };
      case 'generate_image':
        return { type: 'generate_image', prompt: String(action.prompt ?? action.query ?? action.text ?? ''), count: toOptionalNumber(action.count) };
      case 'download':
        return { type: 'download', url: String(action.url ?? ''), filename: action.filename ? String(action.filename) : undefined };
      case 'download_video':
        return { type: 'download_video', url: action.url ? String(action.url) : undefined, query: action.query ? String(action.query) : undefined, audio_only: action.audio_only === true, count: action.count != null ? Number(action.count) : undefined, quality: /low|baixa|pior|ruim|480|360/i.test(String(action.quality ?? '')) ? 'low' : (/best|max|alta|hd|4k/i.test(String(action.quality ?? '')) ? 'best' : undefined) };
      case 'open_video_cuts':
        return { type: 'open_video_cuts', phrase: String(action.phrase ?? action.query ?? ''), count: action.count != null ? Number(action.count) : undefined };
      case 'open_video':
        return { type: 'open_video', query: String(action.query ?? action.text ?? action.phrase ?? '') };
      case 'create_playlist': {
        let songs = Array.isArray(action.songs) ? action.songs
          : Array.isArray(action.videos) ? action.videos
          : Array.isArray(action.tracks) ? action.tracks
          : Array.isArray(action.queries) ? action.queries : [];
        return {
          type: 'create_playlist',
          songs: songs.map((s: any) => String(s)).filter(Boolean).slice(0, 25),
          name: action.name ? String(action.name) : (action.title ? String(action.title) : undefined),
          private: action.private === true || /priv|particular/i.test(String(action.privacy ?? action.visibility ?? '')),
        };
      }
      case 'make_supercut':
        return { type: 'make_supercut', phrase: String(action.phrase ?? action.query ?? ''), count: action.count != null ? Number(action.count) : undefined };
      case 'render_view': {
        const columns = Array.isArray(action.columns) ? action.columns.map(String) : [];
        const rows = Array.isArray(action.rows) ? action.rows.filter((r: any) => Array.isArray(r)).slice(0, 60) : [];
        return {
          type: 'render_view',
          title: String(action.title ?? 'Result'),
          columns, rows,
          subtitle: action.subtitle ? String(action.subtitle) : undefined,
          source_note: action.source_note ? String(action.source_note) : undefined,
          chart: action.chart && Array.isArray(action.chart.labels) && Array.isArray(action.chart.values)
            ? { type: 'bar', label: String(action.chart.label ?? ''), labels: action.chart.labels.map(String), values: action.chart.values.map(Number) }
            : undefined,
        };
      }
      case 'stock_movers':
        return { type: 'stock_movers', direction: /loser|queda|cair|baixa/i.test(String(action.direction ?? '')) ? 'losers' : 'gainers', count: action.count != null ? Number(action.count) : undefined };
      case 'compare_prices':
        return { type: 'compare_prices', query: String(action.query ?? action.q ?? '') };
      case 'google_news':
        return { type: 'google_news', query: String(action.query ?? action.q ?? '') };
      case 'ask_ai':
        return { type: 'ask_ai', question: String(action.question ?? action.text ?? '') };
      case 'find_file':
        return { type: 'find_file', query: String(action.query ?? action.text ?? ''), filetype: action.filetype ? String(action.filetype) : undefined };
      case 'read_aloud':
        return { type: 'read_aloud', text: action.text ? String(action.text) : undefined };
      case 'report':
        return { type: 'report', summary: String(action.summary ?? action.text ?? '') };
      case 'switch_tab':
        return { type: 'switch_tab', tab: Number(action.tab) };
      case 'new_tab':
        return { type: 'new_tab', url: String(action.url ?? '') };
      case 'close_tab':
        return { type: 'close_tab', tab: Number(action.tab) };
      case 'click_ref':
        return { type: 'click_ref', ref: Number(action.ref) };
      case 'fill_ref':
        return { type: 'fill_ref', ref: Number(action.ref), value: String(action.value ?? '') };
      case 'click_text':
        return { type: 'click_text', text: String(action.text ?? ''), nth: toOptionalNumber(action.nth) };
      case 'click_at':
        return { type: 'click_at', x: Number(action.x), y: Number(action.y) };
      case 'type':
        return { type: 'type', text: String(action.text ?? '') };
      case 'fill':
        return {
          type: 'fill',
          selector: action.selector ? String(action.selector) : undefined,
          label: action.label ? String(action.label) : undefined,
          value: String(action.value ?? ''),
        };
      case 'press':
        return { type: 'press', key: String(action.key ?? '') };
      case 'navigate':
        return { type: 'navigate', url: String(action.url ?? '') };
      case 'scroll':
        return {
          type: 'scroll',
          direction: ['up', 'down', 'top', 'bottom'].includes(action.direction) ? action.direction : 'down',
          amount: toOptionalNumber(action.amount),
        };
      case 'wait':
        return {
          type: 'wait',
          ms: toOptionalNumber(action.ms),
          selector: action.selector ? String(action.selector) : undefined,
          timeout: toOptionalNumber(action.timeout),
        };
      case 'done':
        return { type: 'done', reason: String(action.reason ?? ''), success: action.success === true };
    }

    return { type: 'done', reason: 'Unhandled action type from model.', success: false };
  }
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// Recupera o objeto de AÇÃO de uma saída malformada. Modelos de raciocínio (ex.: gpt-oss)
// às vezes vazam o raciocínio ANTES do JSON, gerando algo como
//   {"evaluation":"...texto...{"thought":"...","action":"extract_text"}}
// (dois objetos grudados → JSON.parse quebra). Aqui achamos começos prováveis de objeto
// (`{"thought"` / `{"action"` / etc.) e parseamos o ÚLTIMO que for válido.
// Só é chamado QUANDO o parse normal falha → a nuvem (JSON limpo) nunca cai aqui.
function recoverActionObject(raw: string): any | null {
  const re = /\{\s*"(?:thought|action|evaluation|type|steps|summary|tool|reason)"/g;
  const starts: number[] = [];
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(raw))) starts.push(mm.index);
  for (let k = starts.length - 1; k >= 0; k--) {
    const obj = balancedFrom(raw, starts[k]);
    if (!obj) continue;
    try { const p = JSON.parse(obj); if (p && typeof p === 'object' && (p.action || p.tool || p.type || p.steps || p.summary)) return p; } catch {}
  }
  return null;
}

// Extrai a substring {...} balanceada a partir de um índice (respeita strings/escapes).
function balancedFrom(s: string, start: number): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}
