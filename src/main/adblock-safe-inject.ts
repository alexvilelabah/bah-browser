// O Ghostery injeta os scriptlets dos filtros cosméticos com
//   try { event.sender.executeJavaScript(script, true); } catch (e) { … }
// sem await: o try/catch nunca vê a rejeição. Quando um scriptlet lança dentro da página (YouTube,
// ao abrir uma busca, rejeita três), a promessa sobe solta até o process.on('unhandledRejection') do
// main e vira "[unhandledRejection] Error: Script failed to execute" no terminal e no agent.log.
// Até a 2.20.3 continua igual. Aqui o evento que vai pro Ghostery ganha um sender cujo
// executeJavaScript já trata a rejeição; todo o resto (insertCSS, frameId, senderFrame…) passa direto.

type ExecJs = (code: string, userGesture?: boolean) => Promise<unknown>;

export type ScriptletFailure = (err: unknown, url: string) => void;

export function withSafeScriptletSender<E extends { sender: any }>(event: E, onFailure: ScriptletFailure): E {
  const sender = event.sender;
  if (!sender || typeof sender.executeJavaScript !== 'function') return event;
  const urlOf = (): string => { try { return String(sender.getURL?.() || ''); } catch { return ''; } };
  const safeExec: ExecJs = (code, userGesture) => {
    let p: Promise<unknown>;
    try { p = Promise.resolve(sender.executeJavaScript(code, userGesture)); }
    catch (err) { onFailure(err, urlOf()); return Promise.resolve(undefined); }
    return p.catch((err) => { onFailure(err, urlOf()); return undefined; });
  };
  // Métodos ligados ao objeto original: os nativos do Electron não aceitam o Proxy como "this".
  const bindTo = (target: any, prop: PropertyKey) => {
    const v = Reflect.get(target, prop);
    return typeof v === 'function' ? v.bind(target) : v;
  };
  const safeSender = new Proxy(sender, {
    get: (target, prop) => (prop === 'executeJavaScript' ? safeExec : bindTo(target, prop)),
  });
  return new Proxy(event, {
    get: (target, prop) => (prop === 'sender' ? safeSender : bindTo(target, prop)),
  });
}

// Uma linha por página e erro, não uma por scriptlet: o YouTube rejeita vários de uma vez.
export function scriptletFailureLogger(log: (msg: string) => void = (m) => console.warn(m)): ScriptletFailure {
  const seen = new Set<string>();
  return (err, url) => {
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    const msg = String((err as any)?.message || err).split('\n')[0].slice(0, 160);
    const key = `${host}|${msg}`;
    if (seen.has(key)) return;
    if (seen.size > 200) seen.clear();
    seen.add(key);
    log(`[Adblock] scriptlet failed${host ? ` on ${host}` : ''}: ${msg}`);
  };
}
