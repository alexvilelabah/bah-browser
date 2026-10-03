import { shouldNotify, normalizeNotifyKinds, type MonitorNotifyKind } from '../shared/monitor-notify';
// Cron-Agent: monitora páginas em segundo plano (invisível) e avisa quando uma condição
// em linguagem natural fica verdadeira (ex.: "preço abaixo de R$ 1.500", "voltou ao estoque").
//
// Roda 100% no processo principal — numa BrowserWindow OCULTA que carrega a página, extrai o
// texto e a IA decide se a condição bateu. Não toca na navegação visível do usuário, funciona
// com a janela minimizada/na bandeja, e é MUITO mais confiável que dirigir o agente multi-passo
// num fundo invisível. Escopo (MVP): "ler e checar" (não interage/loga/clica).

import { BrowserWindow, Notification } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface Monitor {
  id: string;
  url: string;
  condition: string;        // condição em linguagem natural
  intervalMin: number;      // minutos entre checagens
  enabled: boolean;
  createdAt: number;
  lastRun?: number;
  lastResult?: 'met' | 'unmet' | 'error' | null;
  lastValue?: string;       // o valor-chave que a IA leu (preço, status…)
  lastNote?: string;        // explicação curta / erro
  triggeredAt?: number;     // última vez que disparou a notificação
  // What may notify. Default ['trigger'] = the old edge-only behaviour.
  notify?: MonitorNotifyKind[];
  lastNotifiedValue?: string;   // baseline for 'change'
}


type AskAI = (prompt: string) => Promise<string>;

export class MonitorManager {
  private monitors: Monitor[] = [];
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private running = new Set<string>();   // evita rodar a mesma sobreposta
  private file: string;

  constructor(
    userDataPath: string,
    private partition: string,
    private askAI: AskAI,
    private notifyFn: (m: Monitor) => void,   // disparo (som/banner no renderer) além da notificação nativa
    private onChange: () => void,             // empurra a lista atualizada pro renderer
    private openUrl?: (url: string) => void,  // clique na notificação → abre o Bah na página
  ) {
    this.file = path.join(userDataPath, 'monitors.json');
    this.load();
  }

  list(): Monitor[] { return this.monitors; }

  private load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.monitors = Array.isArray(raw) ? raw : [];
    } catch { this.monitors = []; }
  }
  private save() { try { fs.writeFileSync(this.file, JSON.stringify(this.monitors, null, 2)); } catch {} }

  private normalizeUrl(u: string): string {
    const s = (u || '').trim();
    if (!s) return s;
    return /^https?:\/\//i.test(s) ? s : 'https://' + s;
  }

  add(data: { url: string; condition: string; intervalMin: number; notify?: MonitorNotifyKind[] }): Monitor {
    const notify = normalizeNotifyKinds(data.notify);
    const m: Monitor = {
      id: 'mon_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      url: this.normalizeUrl(data.url),
      condition: (data.condition || '').trim(),
      intervalMin: Math.max(1, Math.round(data.intervalMin || 60)),
      enabled: true,
      createdAt: Date.now(),
      lastResult: null,
      notify: notify.length ? notify : ['trigger'],
    };
    this.monitors.push(m);
    this.save();
    this.arm(m);
    this.onChange();
    setTimeout(() => this.run(m.id).catch(() => {}), 1500);   // 1ª checagem quase imediata
    return m;
  }

  update(id: string, patch: Partial<Monitor>) {
    const m = this.monitors.find(x => x.id === id);
    if (!m) return;
    Object.assign(m, patch);
    this.save();
    this.disarm(id);
    if (m.enabled) this.arm(m);
    this.onChange();
  }

  remove(id: string) {
    this.disarm(id);
    this.monitors = this.monitors.filter(x => x.id !== id);
    this.save();
    this.onChange();
  }

  // Re-agenda todos no boot (os que estão habilitados).
  armAll() { for (const m of this.monitors) if (m.enabled) this.arm(m); }
  disposeAll() { for (const id of Array.from(this.timers.keys())) this.disarm(id); }

  private arm(m: Monitor) {
    this.disarm(m.id);
    const ms = Math.max(1, m.intervalMin) * 60 * 1000;
    this.timers.set(m.id, setInterval(() => this.run(m.id).catch(() => {}), ms));
  }
  private disarm(id: string) {
    const t = this.timers.get(id);
    if (t) { clearInterval(t); this.timers.delete(id); }
  }

  async runNow(id: string): Promise<void> { return this.run(id, true); }

  private async run(id: string, force = false): Promise<void> {
    const m = this.monitors.find(x => x.id === id);
    if (!m) return;
    if (!m.enabled && !force) return;
    if (this.running.has(id)) return;
    this.running.add(id);
    // Read before anything is touched: the catch block needs these too.
    const prev = m.lastResult;
    const prevValue = m.lastValue || '';
    try {
      const text = await this.fetchPageText(m.url);
      const verdict = await this.evaluate(m, text);
      m.lastRun = Date.now();
      m.lastValue = verdict.value || '';
      m.lastNote = verdict.reason || '';
      m.lastResult = verdict.met ? 'met' : 'unmet';
      // Rule lives in shared code so it is testable without Electron.
      const kind = shouldNotify(m.notify || [], {
        met: verdict.met, prevMet: prev === 'met',
        value: m.lastValue || '', prevValue, failed: false,
      });
      if (kind) {
        if (kind === 'trigger') m.triggeredAt = Date.now();
        m.lastNotifiedValue = m.lastValue || '';
        this.fireNotification(m, kind);
      }
    } catch (e: any) {
      m.lastRun = Date.now();
      m.lastResult = 'error';
      m.lastNote = String(e?.message || e).slice(0, 120);
      // Same rule, failed flipped in.
      const kindErr = shouldNotify(m.notify || [], {
        met: false, prevMet: prev === 'met', value: m.lastValue || '', prevValue, failed: true,
      });
      if (kindErr) this.fireNotification(m, kindErr);
    } finally {
      this.running.delete(id);
      this.save();
      this.onChange();
    }
  }

  // Carrega a página numa janela OCULTA, espera assentar e devolve o texto visível.
  private fetchPageText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        // images:false → só precisamos do TEXTO; checagem bem mais leve (banda/CPU).
        webPreferences: { partition: this.partition, backgroundThrottling: false, images: false },
      });
      // Blindagem da janela invisível: página monitorada não pode abrir popup visível
      // nem tocar áudio "fantasma" durante a checagem.
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.setAudioMuted(true);
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        try { if (!win.isDestroyed()) win.destroy(); } catch {}
        fn();
      };
      const killTimer = setTimeout(() => finish(() => reject(new Error('load timeout'))), 35000);
      win.webContents.on('did-finish-load', () => {
        // Assenta pra conteúdo renderizado no cliente (preço via JS) antes de extrair.
        setTimeout(async () => {
          try {
            const t = await win.webContents.executeJavaScript(
              `(function(){try{return ((document.body&&document.body.innerText)||'').replace(/\\s+\\n/g,'\\n').slice(0,9000);}catch(e){return '';}})()`
            );
            clearTimeout(killTimer);
            finish(() => resolve(String(t || '')));
          } catch (err) {
            clearTimeout(killTimer);
            finish(() => reject(err instanceof Error ? err : new Error('extract failed')));
          }
        }, 2800);
      });
      win.webContents.on('did-fail-load', (_e, _code, desc, _url, isMainFrame) => {
        if (!isMainFrame) return;   // ignora falha de sub-recurso
        clearTimeout(killTimer);
        finish(() => reject(new Error(desc || 'load failed')));
      });
      try { win.loadURL(url); } catch (err) { clearTimeout(killTimer); finish(() => reject(err instanceof Error ? err : new Error('bad url'))); }
    });
  }

  private async evaluate(m: Monitor, text: string): Promise<{ met: boolean; value: string; reason: string }> {
    const prompt = [
      'You are a web-page monitor. Decide whether a condition is TRUE on the page RIGHT NOW.',
      `CONDITION: ${m.condition}`,
      '',
      'PAGE TEXT (may be trimmed):',
      '=== BEGIN PAGE ===',
      text.slice(0, 9000),
      '=== END PAGE ===',
      '',
      'Reply with STRICT JSON only, no prose, no markdown:',
      '{"met": true|false, "value": "the key value you read (e.g. the price or stock status)", "reason": "short explanation"}',
      'If the page text lacks the info to decide, use met=false and say so in reason.',
    ].join('\n');
    const raw = await this.askAI(prompt);
    return parseVerdict(raw);
  }

  private fireNotification(m: Monitor, kind: MonitorNotifyKind = 'trigger') {
    // The title carries the event: "Bah - monitor" told nobody anything.
    const title =
      kind === 'error' ? 'Bah — monitor failed'
        : kind === 'change' ? 'Bah — value changed'
          : 'Bah — condition met';
    const body = kind === 'error'
      ? `${m.condition}${m.lastNote ? '\n' + m.lastNote : ''}`
      : `${m.condition}${m.lastValue ? '\n' + m.lastValue : ''}`;
    try {
      const n = new Notification({ title, body });
      // Clique na notificação → abre o Bah direto na página monitorada.
      n.on('click', () => { try { this.openUrl?.(m.url); } catch {} });
      n.show();
    } catch {}
    try { this.notifyFn(m); } catch {}
  }
}

function parseVerdict(raw: string): { met: boolean; value: string; reason: string } {
  let s = String(raw || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    const o = JSON.parse(s);
    return { met: !!o.met, value: String(o.value ?? ''), reason: String(o.reason ?? '') };
  } catch {
    // Fallback tolerante: procura um "met": true solto.
    const met = /"?met"?\s*[:=]\s*true/i.test(raw);
    return { met, value: '', reason: 'unparsed' };
  }
}
