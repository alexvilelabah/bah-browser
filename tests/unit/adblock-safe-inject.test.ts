// O Ghostery injeta scriptlets sem await; a rejeição de um scriptlet que lança na página não pode
// virar unhandledRejection no main (o sender embrulhado trata e loga uma linha por página+erro).
import { test } from 'node:test';
import assert from 'node:assert';
import { withSafeScriptletSender, scriptletFailureLogger } from '../../src/main/adblock-safe-inject.ts';

class FakeSender {
  css: string[] = [];
  #url = 'https://www.youtube.com/results?search_query=x';   // campo privado: exige "this" real
  getURL() { return this.#url; }
  insertCSS(s: string) { this.css.push(s); return Promise.resolve('k'); }
  executeJavaScript(code: string) {
    return code === 'boom' ? Promise.reject(new Error('Script failed to execute, this normally means an error was thrown.\nstack…')) : Promise.resolve(42);
  }
}

// Mesmo padrão do @ghostery/adblocker-electron 2.18–2.20: chamada sem await dentro de try/catch.
function ghosteryLikeInject(event: any, scripts: string[]) {
  event.sender.insertCSS('.ad{display:none}');
  for (const s of scripts) { try { event.sender.executeJavaScript(s, true); } catch {} }
  return { frameId: event.frameId, processId: event.processId };
}

test('scriptlet que lança não vira unhandledRejection; os bons continuam rodando', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (r: unknown) => unhandled.push(r);
  process.on('unhandledRejection', onUnhandled);
  try {
    const failures: Array<[string, string]> = [];
    const sender = new FakeSender();
    const event = { sender, frameId: 7, processId: 3 };
    const safe = withSafeScriptletSender(event, (err, url) => failures.push([String((err as Error).message), url]));
    const ids = ghosteryLikeInject(safe, ['ok', 'boom', 'boom']);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    assert.deepStrictEqual(unhandled, []);
    assert.strictEqual(failures.length, 2);
    assert.match(failures[0][0], /Script failed to execute/);
    assert.strictEqual(failures[0][1], 'https://www.youtube.com/results?search_query=x');
    // O resto do evento e do sender passa direto (métodos ligados ao objeto original).
    assert.deepStrictEqual(ids, { frameId: 7, processId: 3 });
    assert.deepStrictEqual(sender.css, ['.ad{display:none}']);
    assert.strictEqual(await safe.sender.executeJavaScript('ok'), 42);
    assert.strictEqual(await safe.sender.executeJavaScript('boom'), undefined);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('executeJavaScript que lança na hora (sender destruído) também é tratado', async () => {
  const failures: unknown[] = [];
  const event = { sender: { getURL: () => { throw new Error('destroyed'); }, executeJavaScript: () => { throw new Error('Object has been destroyed'); } } };
  const safe = withSafeScriptletSender(event, (err, url) => failures.push([String((err as Error).message), url]));
  assert.strictEqual(await safe.sender.executeJavaScript('x'), undefined);
  assert.deepStrictEqual(failures, [['Object has been destroyed', '']]);
});

test('evento sem sender utilizável volta igual', () => {
  const event = { sender: null } as any;
  assert.strictEqual(withSafeScriptletSender(event, () => {}), event);
});

test('logger: uma linha por host+erro, só a primeira linha da mensagem', () => {
  const lines: string[] = [];
  const log = scriptletFailureLogger(m => lines.push(m));
  const err = new Error('Script failed to execute, this normally means an error was thrown.\n    at sandbox_bundle');
  log(err, 'https://www.youtube.com/results?search_query=a');
  log(err, 'https://www.youtube.com/watch?v=b');
  log(err, 'https://example.com/');
  log(new Error('other'), '');
  assert.deepStrictEqual(lines, [
    '[Adblock] scriptlet failed on www.youtube.com: Script failed to execute, this normally means an error was thrown.',
    '[Adblock] scriptlet failed on example.com: Script failed to execute, this normally means an error was thrown.',
    '[Adblock] scriptlet failed: other',
  ]);
});
