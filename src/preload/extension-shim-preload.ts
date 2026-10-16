// "Calço" das APIs do Chrome que o Electron não tem, pras extensões instaladas pela Chrome
// Web Store. Registrado na sessão das abas (persist:browser) duas vezes: como preload de
// SERVICE WORKER (o background das extensões MV3) e de FRAME (popup e página de opções).
//
// Por que existe: o Electron implementa só parte do chrome.* (runtime, storage, tabs em
// parte, scripting…). O chrome.action dele é casca (não faz nada) e chrome.omnibox nem
// existe — uma extensão que chama chrome.omnibox.* logo no começo do script (o Dólar Hoje
// faz isso) MORRE inteira com TypeError. Aqui a gente instala o que falta e TROCA só as
// cascas nativas que existem mas não funcionam: chrome.action, storage.sync, proxy.settings,
// webRequest.onAuthRequired, management.uninstallSelf e os eventos tabs.onUpdated/onCreated/onRemoved. O chrome.storage.onChanged dele só
// ganha também os avisos do storage.sync (que é do Bah). Pra VPN/proxy: proxy, privacy,
// cookies, notifications, management e tabs.remove (o trabalho de verdade é no main).
//
// Roda em qualquer página/worker da sessão, então a primeira coisa é sair de fininho fora
// de chrome-extension:// (sites e o login do Google não ganham nada daqui).
//
// Cuidado: este arquivo roda no preload SANDBOX — só dá pra usar require('electron'). E a
// função installChromeShims é SERIALIZADA pro mundo principal (executeInMainWorld): não pode
// usar nada de fora dela.
//
// De propósito SEM import/export: assim o tsc gera um script simples (sem a linha
// `exports.__esModule`), que roda igual em qualquer embrulho de preload — o do service worker
// inclusive. Tudo fica dentro de uma função pra não vazar nome global.
(() => {
  const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

  const CALL = 'bah-ext:call';
  const EVENT = 'bah-ext:event';

  /** Roda NO MUNDO DA EXTENSÃO. Tudo o que ela precisa vem por `bridge`. */
  function installChromeShims(bridge: {
    call: (method: string, details: unknown) => Promise<unknown>;
    listen: (fn: (name: string, args: unknown[]) => void) => void;
  }) {
    const g: any = globalThis as any;
    try { if (g.location.protocol !== 'chrome-extension:') return; } catch { return; }
    if (g.__bahChromeShim) return;
    try { Object.defineProperty(g, '__bahChromeShim', { value: true }); } catch {}
    const chrome: any = g.chrome || (g.chrome = {});

    // O worker pode chamar antes do Bah ligar o atendimento dele (o preload roda no
    // "starting"): nesse caso espera um pouco e tenta de novo, em vez de perder a chamada.
    // Enquanto isso, as chamadas fazem FILA (na ordem): "cor, depois texto" não pode chegar
    // como "texto, depois cor". Com o atendimento no ar e a fila vazia, vai direto.
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const clean = (e: any) => new Error(String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, ''));
    let reachable = false;
    let queued = 0;
    let line: Promise<unknown> = Promise.resolve();
    const invokeRetrying = async (method: string, details: unknown): Promise<unknown> => {
      for (let i = 0; ; i++) {
        try {
          const r = await bridge.call(method, details);
          reachable = true;
          return r;
        } catch (e: any) {
          const msg = String(e && e.message ? e.message : e);
          if (/No handler registered/i.test(msg) && i < 40) { await sleep(Math.min(50 * 2 ** i, 500)); continue; }
          reachable = true;
          throw clean(e);
        }
      }
    };
    const call = (method: string, details: unknown): Promise<unknown> => {
      if (reachable && queued === 0) return bridge.call(method, details).catch(e => { throw clean(e); });
      queued++;
      const p = line.then(() => invokeRetrying(method, details));
      line = p.then(() => { queued--; }, () => { queued--; });
      return p;
    };

    // Põe a propriedade só se ela ainda não existe (nunca troca API de verdade do Electron).
    const define = (obj: any, key: string, value: unknown): boolean => {
      if (!obj) return false;
      try { if (obj[key] !== undefined) return false; } catch { return false; }
      try {
        Object.defineProperty(obj, key, { value, configurable: true, enumerable: true, writable: true });
        return true;
      } catch {
        try { obj[key] = value; return obj[key] === value; } catch { return false; }
      }
    };

    // Põe (ou TROCA) a propriedade no próprio objeto e confere. Pra casca nativa que existe mas
    // não funciona (storage.sync, proxy.settings, webRequest.onAuthRequired…).
    const patch = (obj: any, key: string, value: unknown): boolean => {
      if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return false;
      try { Object.defineProperty(obj, key, { value, configurable: true, enumerable: true, writable: true }); } catch {}
      try { return obj[key] === value; } catch { return false; }
    };

    // TRAVA uma API nativa que a gente trocou ou completou. Motivo (visto ao vivo, 2 de 9
    // aberturas): logo depois do preload, o Chromium às vezes refaz as APIs do contexto
    // (UpdateBindingsForContext, extensions/renderer/native_extension_bindings_system.cc) e
    // põe o chrome.action casca de volta — o selo sumia. Esse refazer nunca APAGA nada; e
    // quando uma propriedade não deixa ser trocada ele só registra um erro e PARA (as APIs
    // seguintes ficam como já estavam, que é o mesmo que ele poria). Vale pro `browser.*`
    // também, que o Chromium monta junto.
    // Só NÃO-CONFIGURÁVEL já basta pro Chromium não conseguir trocar; continua GRAVÁVEL porque
    // no Chrome dá pra atribuir: `chrome.action = chrome.action || chrome.browserAction` em
    // modo estrito não pode dar TypeError (mataria o worker inteiro).
    const lock = (key: string, value: unknown): boolean => {
      let ok = false;
      for (const ns of [chrome, g.browser]) {
        if (!ns || typeof ns !== 'object') continue;
        if (ns !== chrome && !(key in ns)) continue;
        try {
          Object.defineProperty(ns, key, { value, configurable: false, enumerable: true, writable: true });
          if (ns === chrome) ok = true;
        } catch {}
      }
      return ok;
    };

    // API nova (que o Electron não tem) vai no `chrome` E no `browser`, quando ele é um objeto
    // à parte: extensão feita com WXT ou com `globalThis.browser ?? chrome` usa o `browser`.
    const defineNs = (key: string, value: unknown): boolean => {
      const ok = define(chrome, key, value);
      const b = g.browser;
      if (ok && b && typeof b === 'object' && b !== chrome) define(b, key, chrome[key]);
      return ok;
    };

    // Erro no formato callback, igual ao Chrome: chrome.runtime.lastError existe SÓ enquanto o
    // callback roda, e "Unchecked runtime.lastError" só aparece se o callback não olhou.
    const withLastError = (err: any, cb: (r?: unknown) => void) => {
      const message = String(err && err.message ? err.message : err);
      const rt = chrome.runtime;
      let seen = false;
      let set = false;
      if (rt && typeof rt === 'object') {
        try {
          Object.defineProperty(rt, 'lastError', { configurable: true, enumerable: true, get() { seen = true; return { message }; } });
          set = true;
        } catch {}
      }
      try { cb(); } catch (e) { console.error(e); }
      finally { if (set) { try { delete rt.lastError; } catch {} } }
      if (!seen) console.error(`Unchecked runtime.lastError: ${message}`);
    };

    // Evento no formato do Chrome (addListener/removeListener/hasListener). O disparo fica
    // guardado à parte — a extensão não consegue disparar evento falso.
    const dispatchers: Record<string, (...a: unknown[]) => void> = {};
    const makeEvent = (name?: string) => {
      const ls = new Set<(...a: unknown[]) => unknown>();
      const ev = {
        addListener(fn: any) { if (typeof fn === 'function') ls.add(fn); },
        removeListener(fn: any) { ls.delete(fn); },
        hasListener(fn: any) { return ls.has(fn); },
        hasListeners() { return ls.size > 0; },
      };
      if (name) {
        dispatchers[name] = (...a: unknown[]) => {
          for (const fn of Array.from(ls)) { try { fn(...a); } catch (e) { console.error(e); } }
        };
      }
      return ev;
    };

    // Função no estilo do Chrome: aceita callback no fim OU devolve Promise.
    const api = (method: string, prep?: (...a: any[]) => unknown) => function (this: unknown, ...args: any[]) {
      let cb: ((r?: unknown) => void) | undefined;
      if (args.length && typeof args[args.length - 1] === 'function') cb = args.pop();
      const p = Promise.resolve()
        .then(() => (prep ? prep(...args) : args[0]))
        .then(details => call(method, details === undefined ? {} : details));
      if (!cb) return p;
      p.then(
        r => { try { cb!(r); } catch (e) { console.error(e); } },
        err => withLastError(err, cb!),
      );
      return undefined;
    };
    // Mesma ideia, mas resolvido aqui mesmo (sem ir no Bah).
    const local = (fn: (...a: any[]) => unknown) => function (this: unknown, ...args: any[]) {
      let cb: ((r?: unknown) => void) | undefined;
      if (args.length && typeof args[args.length - 1] === 'function') cb = args.pop();
      const p = Promise.resolve().then(() => fn(...args));
      if (!cb) return p;
      p.then(r => { try { cb!(r); } catch (e) { console.error(e); } }, e => withLastError(e, cb!));
      return undefined;
    };

    // setIcon({ imageData }): vira PNG (data URL) aqui, porque ImageData não atravessa pro Bah.
    const imageDataToPng = async (img: any): Promise<string> => {
      if (!img || typeof img.width !== 'number' || typeof img.height !== 'number' || !img.data) throw new Error('Invalid imageData.');
      if (typeof OffscreenCanvas !== 'function') throw new Error('imageData is not supported here.');
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx: any = canvas.getContext('2d');
      const data = img instanceof ImageData ? img : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
      ctx.putImageData(data, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
      return 'data:image/png;base64,' + btoa(bin);
    };
    const pickImageData = (spec: any) => {
      if (!spec || typeof spec !== 'object') return spec;
      if (typeof spec.width === 'number' && spec.data) return spec;   // ImageData solto
      const keys = Object.keys(spec).map(Number).filter(n => n > 0).sort((a, b) => a - b);
      const k = keys.find(n => n >= 32) ?? keys[keys.length - 1];
      return k === undefined ? undefined : spec[String(k)];
    };

    // ── chrome.action ──────────────────────────────────────────────────────────
    // O Electron 44 JÁ põe um chrome.action, mas é casca: toda função só escreve "not
    // supported in Electron" no log e não faz nada (o selo nunca aparecia). Então aqui é a
    // única API que a gente TROCA — quando ela existe ou quando o manifesto pede "action".
    let wantsAction = !!chrome.action;
    try { wantsAction = wantsAction || !!chrome.runtime.getManifest().action; } catch {}
    if (wantsAction) {
      const action = {
        setBadgeText: api('action.setBadgeText'),
        getBadgeText: api('action.getBadgeText'),
        setBadgeBackgroundColor: api('action.setBadgeBackgroundColor'),
        getBadgeBackgroundColor: api('action.getBadgeBackgroundColor'),
        setBadgeTextColor: api('action.setBadgeTextColor'),
        getBadgeTextColor: api('action.getBadgeTextColor'),
        setTitle: api('action.setTitle'),
        getTitle: api('action.getTitle'),
        setIcon: api('action.setIcon', async (d: any) => {
          if (!d || typeof d !== 'object') return d;
          const out: any = { tabId: d.tabId };
          if (d.imageData !== undefined) out.imageData = await imageDataToPng(pickImageData(d.imageData));
          else {
            // Igual ao Chrome: caminho relativo vale a partir de QUEM chamou (worker em
            // "background/sw.js" usa "../icons/on.png"). Vai pro Bah como endereço completo.
            const abs = (p: unknown) => {
              if (typeof p !== 'string' || !p) return p;
              try { return new URL(p, g.location.href).href; } catch { return p; }
            };
            out.path = d.path && typeof d.path === 'object'
              ? Object.fromEntries(Object.entries(d.path).map(([k, v]) => [k, abs(v)]))
              : abs(d.path);
          }
          return out;
        }),
        setPopup: api('action.setPopup'),
        getPopup: api('action.getPopup'),
        enable: api('action.enable', (tabId?: number) => ({ tabId })),
        disable: api('action.disable', (tabId?: number) => ({ tabId })),
        isEnabled: api('action.isEnabled', (tabId?: number) => ({ tabId })),
        getUserSettings: local(() => ({ isOnToolbar: true })),
        openPopup: local(() => { throw new Error('action.openPopup is not supported in Bah yet.'); }),
        onClicked: makeEvent('action.onClicked'),
        onUserSettingsChanged: makeEvent(),
      };
      if (!lock('action', action) && !define(chrome, 'action', action)) console.warn('[Bah] chrome.action shim could not be installed.');
    }

    // ── chrome.tabs.create (o Electron tem tabs, mas sem create) ────────────────
    if (!chrome.tabs) defineNs('tabs', {});
    if (chrome.tabs && !chrome.tabs.create) {
      if (define(chrome.tabs, 'create', api('tabs.create'))) lock('tabs', chrome.tabs);
      else console.warn('[Bah] chrome.tabs.create shim could not be installed.');
    }
    // ── chrome.tabs.onUpdated/onCreated/onRemoved: os nativos são casca (nunca disparam) ─
    // A VPN abre uma aba e espera o onUpdated 'complete' dela pra conectar: sem isso, toda
    // conexão falhava depois de 5 s. Troca no PRÓPRIO objeto nativo e trava (o browser.tabs é
    // o mesmo objeto). O Bah só manda os eventos depois do primeiro addListener (são muitos).
    if (chrome.tabs) {
      let subscribed = false;
      const tabEvent = (name: string) => {
        const ev: any = makeEvent(name);
        const add = ev.addListener;
        ev.addListener = (fn: any) => {
          add(fn);
          if (!subscribed && typeof fn === 'function') {
            subscribed = true;
            call('tabs.subscribe', {}).catch(() => { subscribed = false; });
          }
        };
        return ev;
      };
      const ok = patch(chrome.tabs, 'onUpdated', tabEvent('tabs.onUpdated')) &&
        patch(chrome.tabs, 'onCreated', tabEvent('tabs.onCreated')) &&
        patch(chrome.tabs, 'onRemoved', tabEvent('tabs.onRemoved'));
      if (!ok) console.warn('[Bah] chrome.tabs events shim could not be installed.');
      lock('tabs', chrome.tabs);
    }

    // ── chrome.runtime: só o que faltar ─────────────────────────────────────────
    if (!chrome.runtime) defineNs('runtime', {});
    if (chrome.runtime) {
      if (!chrome.runtime.getPlatformInfo) define(chrome.runtime, 'getPlatformInfo', api('runtime.getPlatformInfo', () => ({})));
      if (!chrome.runtime.onStartup) define(chrome.runtime, 'onStartup', makeEvent());
      if (!chrome.runtime.onInstalled) define(chrome.runtime, 'onInstalled', makeEvent());
    }

    // ── chrome.storage.sync: área PRÓPRIA, guardada pelo Bah ──────────────────────
    // O Electron 44 PÕE um storage.sync, mas é casca: toda chamada dá erro ("sync" is not
    // available in this instance of Chrome — medido). Então ele é TROCADO sempre (antes só
    // entrava quando faltava, e com a casca presente o do Bah nunca entrava).
    // Não é o local com outro nome: sync.clear() não pode apagar o local, e o onChanged tem
    // que dizer 'sync'. (Não sincroniza entre computadores — só fica separado, como no Chrome
    // sem conta.)
    const syncAreaListeners = new Set<(...a: unknown[]) => unknown>();
    try {
      const st = chrome.storage;
      if (st && st.local) {
        const keysArg = (keys?: unknown) => ({ keys: keys === undefined ? null : keys });
        const sync = {
          get: api('storage.sync.get', keysArg),
          getKeys: api('storage.sync.getKeys', () => ({})),
          getBytesInUse: api('storage.sync.getBytesInUse', keysArg),
          set: api('storage.sync.set', (items?: unknown) => ({ items })),
          remove: api('storage.sync.remove', (keys?: unknown) => ({ keys })),
          clear: api('storage.sync.clear', () => ({})),
          setAccessLevel: local(() => undefined),
          onChanged: makeEvent('storage.sync.onChanged'),
          QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192, MAX_ITEMS: 512,
          MAX_WRITE_OPERATIONS_PER_HOUR: 1800, MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
        };
        // O chrome.storage.onChanged do Electron passa a receber também (mudanças, 'sync').
        const native = st.onChanged;
        const own = {
          addListener(fn: any) { if (typeof fn === 'function') syncAreaListeners.add(fn); },
          removeListener(fn: any) { syncAreaListeners.delete(fn); },
          hasListener(fn: any) { return syncAreaListeners.has(fn); },
          hasListeners() { return syncAreaListeners.size > 0; },
        };
        if (native && typeof native.addListener === 'function') {
          // As funções nativas ficam guardadas aqui ANTES de trocar (senão chamaríamos a nossa).
          const orig: Record<string, any> = {};
          for (const k of ['addListener', 'removeListener', 'hasListener', 'hasListeners']) {
            if (typeof native[k] === 'function') orig[k] = native[k].bind(native);
          }
          const nat = (k: string, ...a: unknown[]) => (orig[k] ? orig[k](...a) : false);
          const methods: Record<string, unknown> = {
            addListener(fn: any) { own.addListener(fn); nat('addListener', fn); },
            removeListener(fn: any) { own.removeListener(fn); nat('removeListener', fn); },
            hasListener(fn: any) { return own.hasListener(fn) || !!nat('hasListener', fn); },
            hasListeners() { return own.hasListeners() || !!nat('hasListeners'); },
          };
          try {
            for (const [k, v] of Object.entries(methods)) Object.defineProperty(native, k, { value: v, configurable: true, enumerable: true, writable: true });
          } catch {
            try { Object.defineProperty(st, 'onChanged', { value: methods, configurable: true, enumerable: true, writable: true }); } catch {}
          }
        } else if (!native) define(st, 'onChanged', own);
        if (patch(st, 'sync', sync)) lock('storage', st);
        else console.warn('[Bah] chrome.storage.sync shim could not be installed.');
      }
    } catch {}
    dispatchers['storage.sync.changed'] = (changes: unknown) => {
      const area = dispatchers['storage.sync.onChanged'];
      if (area) area(changes);
      for (const fn of Array.from(syncAreaListeners)) { try { fn(changes, 'sync'); } catch (e) { console.error(e); } }
    };

    // ── Cascas que não fazem nada: a extensão roda, só a função não aparece ─────
    if (!chrome.omnibox) {
      defineNs('omnibox', {
        setDefaultSuggestion: local(() => undefined),
        onInputStarted: makeEvent(),
        onInputChanged: makeEvent(),
        onInputEntered: makeEvent(),
        onInputCancelled: makeEvent(),
        onDeleteSuggestion: makeEvent(),
        // Enums que o Chrome expõe (extensão em TypeScript lê isso logo no começo do script).
        OnInputEnteredDisposition: { CURRENT_TAB: 'currentTab', NEW_FOREGROUND_TAB: 'newForegroundTab', NEW_BACKGROUND_TAB: 'newBackgroundTab' },
        DescriptionStyleType: { URL: 'url', MATCH: 'match', DIM: 'dim' },
      });
    }
    if (!chrome.contextMenus) {
      let seq = 0;
      defineNs('contextMenus', {
        create: (props: any, cb?: () => void) => {
          const id = props && props.id !== undefined ? props.id : ++seq;
          if (typeof cb === 'function') Promise.resolve().then(cb);
          return id;
        },
        update: local(() => undefined),
        remove: local(() => undefined),
        removeAll: local(() => undefined),
        onClicked: makeEvent(),
        ACTION_MENU_TOP_LEVEL_LIMIT: 6,
        ContextType: {
          ALL: 'all', PAGE: 'page', FRAME: 'frame', SELECTION: 'selection', LINK: 'link', EDITABLE: 'editable',
          IMAGE: 'image', VIDEO: 'video', AUDIO: 'audio', LAUNCHER: 'launcher', BROWSER_ACTION: 'browser_action',
          PAGE_ACTION: 'page_action', ACTION: 'action',
        },
        ItemType: { NORMAL: 'normal', CHECKBOX: 'checkbox', RADIO: 'radio', SEPARATOR: 'separator' },
      });
    }

    // ── chrome.alarms: a tabela e os timers ficam no Bah (worker E páginas da extensão) ─
    // O popup que cria um alarme fecha logo depois — o timer não pode morrer junto. O disparo
    // vai pro worker (o Bah acorda ele se precisar) e pras páginas abertas da extensão.
    if (!chrome.alarms) {
      const alarmName = (name?: unknown) => ({ name: typeof name === 'string' ? name : '' });
      defineNs('alarms', {
        create: api('alarms.create', (a?: unknown, b?: unknown) =>
          (typeof a === 'string' ? { name: a, info: b } : a === undefined || a === null ? { name: '', info: b } : { name: '', info: a })),
        get: api('alarms.get', alarmName),
        getAll: api('alarms.getAll', () => ({})),
        clear: api('alarms.clear', alarmName),
        clearAll: api('alarms.clearAll', () => ({})),
        onAlarm: makeEvent('alarms.onAlarm'),
      });
    }

    // ══ APIs de rede/privacidade (VPN/proxy e cia.) ════════════════════════════════
    // Medido no Electron 44: chrome.privacy, cookies e notifications NÃO existem; proxy.settings
    // existe mas toda chamada dá "Access to extension API denied."; webRequest.onAuthRequired
    // nunca dispara (o Bah tem ouvintes de webRequest na sessão das abas); management só tem
    // getSelf/uninstallSelf. O Chromium 152 também tem um `browser` à parte, e o
    // webextension-polyfill usa ELE direto — então tudo vai no chrome E no browser, travado.
    let manifest: any = {};
    try { manifest = chrome.runtime.getManifest() || {}; } catch {}
    const perms = new Set<string>(Array.isArray(manifest.permissions) ? manifest.permissions.filter((p: unknown) => typeof p === 'string') : []);

    // Põe o namespace no chrome e no browser (os dois NÃO-configuráveis, como o lock()), mesmo
    // que o browser ainda não tenha a chave: o polyfill lê browser.privacy, browser.cookies…
    const pin = (key: string, value: unknown): boolean => {
      let ok = false;
      for (const ns of [chrome, g.browser]) {
        if (!ns || typeof ns !== 'object') continue;
        try {
          Object.defineProperty(ns, key, { value, configurable: false, enumerable: true, writable: true });
          if (ns === chrome) ok = true;
        } catch {
          try { if (ns[key] !== value) ns[key] = value; if (ns === chrome) ok = ns[key] === value; } catch {}
        }
      }
      if (!ok) console.warn(`[Bah] chrome.${key} shim could not be installed.`);
      return ok;
    };
    // Completa (ou troca) peças de um namespace NATIVO no próprio objeto — assim quem guardou a
    // referência (browser.proxy é o MESMO objeto que chrome.proxy) vê também. Se o objeto não
    // deixar, monta uma cópia com o nativo + o nosso. Depois trava nos dois.
    const augment = (key: string, add: Record<string, unknown>, replace: string[] = []) => {
      const native = chrome[key];
      if (!native || typeof native !== 'object') return pin(key, add);
      let target: any = native;
      let failed = false;
      for (const [k, v] of Object.entries(add)) {
        let has = false;
        try { has = native[k] !== undefined; } catch {}
        if (has && !replace.includes(k)) continue;
        if (!patch(native, k, v)) failed = true;
      }
      if (failed) {
        target = {};
        for (const k of Object.getOwnPropertyNames(native)) {
          try { Object.defineProperty(target, k, { get: () => native[k], configurable: true, enumerable: true }); } catch {}
        }
        for (const [k, v] of Object.entries(add)) {
          let has = false;
          try { has = native[k] !== undefined; } catch {}
          if (has && !replace.includes(k)) continue;
          Object.defineProperty(target, k, { value: v, configurable: true, enumerable: true, writable: true });
        }
      }
      return pin(key, target);
    };

    // ChromeSetting (get/set/clear + onChange) — quem guarda o valor e decide quem controla é o Bah.
    const makeSetting = (key: string) => {
      const onChange = makeEvent('settings.onChange:' + key);
      const det = (d: any) => (d && typeof d === 'object' ? d : {});
      return {
        get: api('settings.get', (d?: any) => ({ key, incognito: !!det(d).incognito })),
        set: api('settings.set', (d?: any) => {
          if (!d || typeof d !== 'object' || !('value' in d)) throw new Error('Missing value.');
          return { key, value: d.value, scope: d.scope };
        }),
        clear: api('settings.clear', (d?: any) => ({ key, scope: det(d).scope })),
        onChange,
      };
    };
    // O Bah manda ('settings.onChange', [chave, { value, levelOfControl }]).
    dispatchers['settings.onChange'] = (key: unknown, details: unknown) => {
      const fn = typeof key === 'string' ? dispatchers['settings.onChange:' + key] : undefined;
      if (fn) fn(details);
    };

    // ── chrome.proxy: settings (de verdade, nas abas do Bah) + onProxyError ─────
    if (chrome.proxy || perms.has('proxy')) {
      augment('proxy', {
        settings: makeSetting('proxy'),
        onProxyError: makeEvent('proxy.onProxyError'),
        Mode: { DIRECT: 'direct', AUTO_DETECT: 'auto_detect', PAC_SCRIPT: 'pac_script', FIXED_SERVERS: 'fixed_servers', SYSTEM: 'system' },
        Scheme: { HTTP: 'http', HTTPS: 'https', QUIC: 'quic', SOCKS4: 'socks4', SOCKS5: 'socks5' },
      }, ['settings', 'onProxyError']);
    }

    // ── chrome.privacy (só com a permissão; o Electron não tem) ─────────────────
    // webRTCIPHandlingPolicy é DE VERDADE (vale pras abas); o resto o Bah não aplica e diz isso
    // (get() devolve o valor de verdade com "not_controllable", como o Chrome).
    // Mesma lista do PRIVACY_SETTING_KEYS de chrome-extension-rules.ts (o teste confere).
    if (!chrome.privacy && perms.has('privacy')) {
      const groups: Record<string, Record<string, unknown>> = { network: {}, services: {}, websites: {} };
      for (const k of [
        'network.webRTCIPHandlingPolicy', 'network.networkPredictionEnabled',
        'services.alternateErrorPagesEnabled', 'services.autofillEnabled', 'services.autofillAddressEnabled',
        'services.autofillCreditCardEnabled', 'services.passwordSavingEnabled', 'services.safeBrowsingEnabled',
        'services.safeBrowsingExtendedReportingEnabled', 'services.searchSuggestEnabled', 'services.spellingServiceEnabled',
        'services.translationServiceEnabled',
        'websites.adMeasurementEnabled', 'websites.doNotTrackEnabled', 'websites.fledgeEnabled', 'websites.hyperlinkAuditingEnabled',
        'websites.protectedContentEnabled', 'websites.referrersEnabled', 'websites.relatedWebsiteSetsEnabled',
        'websites.thirdPartyCookiesAllowed', 'websites.topicsEnabled',
      ]) {
        const [grp, name] = k.split('.');
        groups[grp][name] = makeSetting('privacy.' + k);
      }
      pin('privacy', {
        ...groups,
        IPHandlingPolicy: {
          DEFAULT: 'default', DEFAULT_PUBLIC_AND_PRIVATE_INTERFACES: 'default_public_and_private_interfaces',
          DEFAULT_PUBLIC_INTERFACE_ONLY: 'default_public_interface_only', DISABLE_NON_PROXIED_UDP: 'disable_non_proxied_udp',
        },
      });
    }

    // ── webRequest.onAuthRequired: o Bah pergunta, a extensão responde ───────────
    // Só o login de PROXY, e só pra extensão que controla o proxy (o Bah decide no main).
    // Formatos do Chrome: "blocking" = o ouvinte devolve a resposta (ou uma Promise);
    // "asyncBlocking" = o ouvinte chama o callback (2º argumento). O filtro (urls) vale.
    if (chrome.webRequest && perms.has('webRequest') && (perms.has('webRequestAuthProvider') || perms.has('webRequestBlocking'))) {
      type AuthL = { fn: (...a: any[]) => any; urls: string[]; types: string[] | null; tabId: number | null; blocking: boolean; async: boolean; headers: boolean };
      const authLs: AuthL[] = [];
      // Padrão de endereço simplificado (o filtro só ESCOLHE ouvinte; a permissão o Bah já conferiu).
      const urlMatch = (pattern: string, url: string): boolean => {
        if (pattern === '<all_urls>') return /^(https?|wss?|ftp):/i.test(url);
        const m = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)?$/i.exec(pattern);
        if (!m) return false;
        let u: URL;
        try { u = new URL(url); } catch { return false; }
        const proto = u.protocol.slice(0, -1).toLowerCase();
        const sch = m[1].toLowerCase();
        if (sch === '*' ? proto !== 'http' && proto !== 'https' : sch !== proto) return false;
        const hostPort = m[2].toLowerCase();
        const host = hostPort.replace(/:(\*|\d+)$/, '');
        const h = u.hostname.toLowerCase();
        if (host !== '*' && !(host.startsWith('*.') ? (h === host.slice(2) || h.endsWith(host.slice(1))) : h === host)) return false;
        const glob = (m[3] || '/').split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
        return new RegExp('^' + glob + '$').test(u.pathname + u.search);
      };
      const onAuthRequired = {
        addListener(fn: any, filter?: any, spec?: any) {
          if (typeof fn !== 'function') throw new Error('Listener must be a function.');
          if (!filter || typeof filter !== 'object' || !Array.isArray(filter.urls)) throw new Error("Invalid filter: 'urls' is required.");
          const sp: string[] = Array.isArray(spec) ? spec : [];
          if (authLs.some(l => l.fn === fn)) return;
          authLs.push({
            fn, urls: filter.urls.filter((x: unknown) => typeof x === 'string'),
            types: Array.isArray(filter.types) ? filter.types : null,
            tabId: typeof filter.tabId === 'number' ? filter.tabId : null,
            blocking: sp.includes('blocking'), async: sp.includes('asyncBlocking'),
            headers: sp.includes('responseHeaders'),
          });
        },
        removeListener(fn: any) { const i = authLs.findIndex(l => l.fn === fn); if (i >= 0) authLs.splice(i, 1); },
        hasListener(fn: any) { return authLs.some(l => l.fn === fn); },
        hasListeners() { return authLs.length > 0; },
      };
      const answer = async (details: any): Promise<unknown> => {
        // O worker pode ter acabado de acordar: dá um tempinho pro script registrar o ouvinte.
        for (let i = 0; i < 30 && !authLs.length; i++) await sleep(100);
        const waits: Promise<unknown>[] = [];
        for (const l of authLs.slice()) {
          if (!l.urls.some(p => urlMatch(p, String(details.url || '')))) continue;
          if (l.types && !l.types.includes(details.type)) continue;
          if (l.tabId !== null && l.tabId !== details.tabId) continue;
          const d = { ...details, challenger: { ...details.challenger } };
          // Igual ao Chrome: os cabeçalhos da resposta só vão pra quem pediu 'responseHeaders'.
          if (l.headers && Array.isArray(details.responseHeaders)) d.responseHeaders = details.responseHeaders.map((h: any) => ({ ...h }));
          else delete d.responseHeaders;
          if (l.async) {
            waits.push(new Promise(res => {
              let done = false;
              const cb = (r?: unknown) => { if (!done) { done = true; res(r); } };
              try {
                const ret = l.fn(d, cb);
                if (ret && typeof ret.then === 'function') ret.then((r: unknown) => { if (r !== undefined) cb(r); }, () => cb(undefined));
              } catch (e) { console.error(e); cb(undefined); }
            }));
          } else if (l.blocking) {
            try { waits.push(Promise.resolve(l.fn(d)).catch(() => undefined)); } catch (e) { console.error(e); }
          } else {
            try { l.fn(d); } catch (e) { console.error(e); }
          }
        }
        const rs: any[] = await Promise.all(waits);
        // Igual ao Chrome: um "cancel" ganha; senão vale a primeira senha dada.
        if (rs.some(r => r && r.cancel === true)) return { cancel: true };
        const c = rs.find(r => r && r.authCredentials && typeof r.authCredentials === 'object');
        return c ? { authCredentials: { username: String(c.authCredentials.username ?? ''), password: String(c.authCredentials.password ?? '') } } : {};
      };
      dispatchers['webRequest.onAuthRequired'] = (details: unknown, token: unknown) => {
        if (!details || typeof details !== 'object' || typeof token !== 'string') return;
        answer(details).then(
          response => call('webRequest.authReply', { token, response }),
          () => call('webRequest.authReply', { token, response: {} }),
        ).catch(() => {});
      };
      augment('webRequest', { onAuthRequired }, ['onAuthRequired']);
    }

    // ── chrome.cookies (com a permissão; sempre da sessão das abas) ──────────────
    if (!chrome.cookies && perms.has('cookies')) {
      const cookieLs = new Set<(...a: unknown[]) => unknown>();
      const onChanged = {
        addListener(fn: any) {
          if (typeof fn !== 'function') return;
          cookieLs.add(fn);
          // O Bah só manda as mudanças de cookie pra quem escuta (são muitas).
          if (cookieLs.size === 1) call('cookies.subscribe', {}).catch(() => {});
        },
        removeListener(fn: any) { cookieLs.delete(fn); },
        hasListener(fn: any) { return cookieLs.has(fn); },
        hasListeners() { return cookieLs.size > 0; },
      };
      dispatchers['cookies.onChanged'] = (info: unknown) => {
        for (const fn of Array.from(cookieLs)) { try { fn(info); } catch (e) { console.error(e); } }
      };
      // O Bah manda as mudanças em lote (uma página pode escrever cookie milhares de vezes por segundo).
      dispatchers['cookies.onChangedBatch'] = (list: unknown) => {
        if (!Array.isArray(list)) return;
        for (const info of list) dispatchers['cookies.onChanged'](info);
      };
      pin('cookies', {
        get: api('cookies.get'),
        getAll: api('cookies.getAll', (d?: unknown) => (d === undefined ? {} : d)),
        set: api('cookies.set'),
        remove: api('cookies.remove'),
        getAllCookieStores: api('cookies.getAllCookieStores', () => ({})),
        onChanged,
        OnChangedCause: { EVICTED: 'evicted', EXPIRED: 'expired', EXPLICIT: 'explicit', EXPIRED_OVERWRITE: 'expired_overwrite', OVERWRITE: 'overwrite' },
        SameSiteStatus: { NO_RESTRICTION: 'no_restriction', LAX: 'lax', STRICT: 'strict', UNSPECIFIED: 'unspecified' },
      });
    }

    // ── chrome.notifications (com a permissão) → notificação do sistema pelo Bah ─
    if (!chrome.notifications && perms.has('notifications')) {
      // Ícone relativo vale a partir de quem chamou (igual ao Chrome); vai pro Bah como endereço completo.
      const withIcon = (o: any) => {
        if (!o || typeof o !== 'object') return o;
        const out = { ...o };
        if (typeof out.iconUrl === 'string' && out.iconUrl && !/^(data|blob|https?):/i.test(out.iconUrl)) {
          try { out.iconUrl = new URL(out.iconUrl, g.location.href).href; } catch {}
        }
        if (Array.isArray(out.buttons)) out.buttons = out.buttons.map((b: any) => ({ title: b && b.title }));
        delete out.imageUrl; delete out.appIconMaskUrl;
        return out;
      };
      pin('notifications', {
        create: api('notifications.create', (a?: unknown, b?: unknown) =>
          (typeof a === 'string' || a === undefined || a === null) && b !== undefined
            ? { notificationId: a, options: withIcon(b) }
            : { notificationId: '', options: withIcon(a) }),
        update: api('notifications.update', (id?: unknown, o?: unknown) => ({ notificationId: id, options: withIcon(o) })),
        clear: api('notifications.clear', (id?: unknown) => ({ notificationId: id })),
        getAll: api('notifications.getAll', () => ({})),
        getPermissionLevel: local(() => 'granted'),
        onClicked: makeEvent('notifications.onClicked'),
        onClosed: makeEvent('notifications.onClosed'),
        onButtonClicked: makeEvent('notifications.onButtonClicked'),
        onPermissionLevelChanged: makeEvent(),
        onShowSettingsClicked: makeEvent(),
        TemplateType: { BASIC: 'basic', IMAGE: 'image', LIST: 'list', PROGRESS: 'progress' },
        PermissionLevel: { GRANTED: 'granted', DENIED: 'denied' },
      });
    }

    // ── chrome.management: o que falta + uninstallSelf pelo caminho de remoção do Bah ─
    // O uninstallSelf nativo removeria sem passar pela limpeza do Bah (dados, lápide, proxy).
    // setEnabled só vale pra PRÓPRIA extensão: o Bah não deixa uma desligar as outras.
    {
      const add: Record<string, unknown> = {
        getSelf: api('management.getSelf', () => ({})),
        uninstallSelf: api('management.uninstallSelf', (o?: any) => ({ showConfirmDialog: !!(o && o.showConfirmDialog) })),
        ExtensionType: { EXTENSION: 'extension', THEME: 'theme' },
        ExtensionInstallType: { ADMIN: 'admin', DEVELOPMENT: 'development', NORMAL: 'normal', SIDELOAD: 'sideload', OTHER: 'other' },
        ExtensionDisabledReason: { UNKNOWN: 'unknown', PERMISSIONS_INCREASE: 'permissions_increase' },
      };
      if (perms.has('management')) {
        add.getAll = api('management.getAll', () => ({}));
        add.get = api('management.get', (id?: unknown) => ({ id }));
        add.setEnabled = api('management.setEnabled', (id?: unknown, enabled?: unknown) => ({ id, enabled }));
        add.uninstall = api('management.uninstall', (id?: unknown, o?: any) => ({ id, showConfirmDialog: !!(o && o.showConfirmDialog) }));
        add.onInstalled = makeEvent();
        add.onUninstalled = makeEvent();
        add.onEnabled = makeEvent();
        add.onDisabled = makeEvent();
      }
      if (chrome.management || perms.has('management')) augment('management', add, ['uninstallSelf']);
    }

    // ── chrome.tabs.remove (o Electron não tem): fecha aba do Bah ───────────────
    if (chrome.tabs && !chrome.tabs.remove) {
      if (define(chrome.tabs, 'remove', api('tabs.remove', (ids?: unknown) => ({ tabIds: Array.isArray(ids) ? ids : [ids] })))) lock('tabs', chrome.tabs);
      else console.warn('[Bah] chrome.tabs.remove shim could not be installed.');
    }

    // Eventos que o Bah manda (clique no ícone…).
    bridge.listen((name: string, args: unknown[]) => {
      const d = dispatchers[name];
      if (d) d(...(Array.isArray(args) ? args : []));
    });
  }

  (() => {
    // No preload de FRAME existe `location`: página comum sai já, sem tocar em nada.
    // No de SERVICE WORKER o preload roda num "reino" à parte, SEM self/location/setTimeout
    // (medido no Electron 44) — lá a checagem do endereço é feita no mundo da extensão.
    const loc: any = (globalThis as any).location;
    if (loc && loc.protocol !== 'chrome-extension:') return;

    let sink: ((name: string, args: unknown[]) => void) | null = null;
    ipcRenderer.on(EVENT, (_e: unknown, name: unknown, args: unknown) => {
      if (typeof name !== 'string' || !sink) return;
      try { sink(name, Array.isArray(args) ? args : []); } catch (e) { console.error(e); }
    });

    // Só repassa. A espera/fila de quando o Bah ainda não ligou o atendimento fica no mundo
    // da extensão, porque aqui no reino do worker não existe setTimeout.
    const call = (method: string, details: unknown): Promise<unknown> => ipcRenderer.invoke(CALL, method, details);

    try {
      contextBridge.executeInMainWorld({
        func: installChromeShims,
        args: [{ call, listen: (fn: (name: string, args: unknown[]) => void) => { sink = fn; } }],
      });
    } catch (e) {
      console.error('[Bah] extension shim failed:', e);
    }
  })();
})();
