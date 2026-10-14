// Permissões dos sites nas abas (câmera, microfone, localização, notificações…), igual ao
// Chrome: o site PEDE, o Bah pergunta pra pessoa e lembra a resposta daquele site.
//
// Antes não havia regra nenhuma na sessão das abas (persist:browser) — e sem regra o
// Electron libera TUDO sozinho. Num teste, uma página pegou o microfone, a localização e as
// notificações sem pergunta nenhuma.
//
// As regras (o que libera, o que pergunta, o que a resposta guardada vale) ficam em
// site-permission-rules.ts, puras e testadas; aqui só liga elas no Electron e na tela.
import { app, ipcMain, type BrowserWindow, type Session, type WebContents } from 'electron';
import fs from 'fs';
import path from 'path';
import {
  resolveRequest, checkAnswer, storedDecision, originOf, sanitizeStore, policyFor, PERM_KINDS,
  type Decision, type PermKind, type PermStore,
} from './site-permission-rules';

interface Pending {
  id: string; wcId: number; origin: string; kinds: PermKind[]; external?: string;
  callbacks: Array<(ok: boolean) => void>; detach: () => void;
}

export function setupSitePermissions(deps: { getMainWindow: () => BrowserWindow | null; sessions: Session[] }) {
  const file = path.join(app.getPath('userData'), 'site-permissions.json');
  let store: PermStore = {};
  try { store = sanitizeStore(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch {}
  // Grava num arquivo ao lado e troca: se o PC desligar no meio, o arquivo antigo fica inteiro.
  const save = () => {
    try { fs.writeFileSync(file + '.tmp', JSON.stringify(store, null, 1)); fs.renameSync(file + '.tmp', file); } catch {}
  };

  const pending = new Map<string, Pending>();
  let seq = 0;
  const send = (channel: string, payload: unknown) => {
    try { deps.getMainWindow()?.webContents.send(channel, payload); } catch {}
  };
  const finish = (p: Pending, ok: boolean) => {
    p.detach();
    pending.delete(p.id);
    for (const cb of p.callbacks) { try { cb(ok); } catch {} }
  };
  const cancel = (p: Pending, ok = false) => { finish(p, ok); send('site-permission:cancel', p.id); };

  // Uma resposta guardada (pela pergunta ou pelo cadeado) também responde as outras perguntas
  // abertas daquele site — outra aba, ou câmera e microfone pedidos separados.
  const settleOpen = (origin: string) => {
    for (const p of [...pending.values()]) {
      if (p.origin !== origin || p.kinds.includes('openExternal')) continue;
      const saved = storedDecision(store, origin, p.kinds);
      if (saved) cancel(p, saved === 'allow');
    }
  };

  const ask = (wc: WebContents, origin: string, kinds: PermKind[], external: string | undefined, cb: (ok: boolean) => void) => {
    // Mesma aba + mesmo site + mesma coisa (e mesmo aplicativo) já perguntando: espera a mesma resposta.
    for (const p of pending.values()) {
      if (p.wcId === wc.id && p.origin === origin && p.kinds.join() === kinds.join() && p.external === external) {
        p.callbacks.push(cb); return;
      }
    }
    const id = `perm_${++seq}`;
    // Sem prazo (igual ao Chrome: a pergunta espera a pessoa voltar pra aba). Só cai se a aba
    // fechar ou ABRIR outra página — 'did-navigate' é a troca que aconteceu de fato; link
    // bloqueado, download ou "abrir aplicativo" não derrubam a pergunta.
    const drop = () => { const p = pending.get(id); if (p) cancel(p); };
    wc.on('destroyed', drop);
    wc.on('did-navigate', drop);
    const detach = () => {
      try { wc.removeListener('destroyed', drop); wc.removeListener('did-navigate', drop); } catch {}
    };
    pending.set(id, { id, wcId: wc.id, origin, kinds, external, callbacks: [cb], detach });
    send('site-permission:ask', { id, wcId: wc.id, origin, kinds, external });
  };

  for (const ses of deps.sessions) {
    ses.setPermissionRequestHandler((wc, permission, callback, details: any) => {
      const r = resolveRequest(store, permission, details || {}, wc.getURL());
      if (r.action !== 'ask') return callback(r.action === 'allow');
      ask(wc, r.origin, r.kinds, r.external, callback);
    });
    // A checagem usa o mesmo "site da aba" do pedido (embeddingOrigin = a página de cima).
    ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details: any) => {
      const origin = originOf(details?.embeddingOrigin) || originOf(wc?.getURL()) || originOf(requestingOrigin);
      if (!origin) return policyFor(permission) !== 'ask';   // página que não é site (nova aba, arquivo)
      return checkAnswer(store, origin, permission, details?.mediaType);
    });
  }

  // A tela respondeu: 'allow'/'block' ficam guardados pro site; 'dismiss' (Agora não) nega só
  // agora. "Abrir aplicativo" nunca fica guardado — cada link pergunta de novo.
  ipcMain.handle('site-permission:answer', (_e, id: string, answer: 'allow' | 'block' | 'dismiss') => {
    const p = pending.get(String(id));
    if (!p) return { ok: false };
    const remember = (answer === 'allow' || answer === 'block') && !p.kinds.includes('openExternal');
    if (remember) {
      const site = store[p.origin] || (store[p.origin] = {});
      for (const k of p.kinds) site[k] = answer as Decision;
      save();
    }
    finish(p, answer === 'allow');
    if (remember) settleOpen(p.origin);
    return { ok: true };
  });
  // Cadeado da barra de endereço: o que este site tem guardado, mudar uma escolha, "redefinir".
  ipcMain.handle('site-permission:list', (_e, url: string) => {
    const origin = originOf(url);
    return { origin, perms: (origin && store[origin]) || {} };
  });
  // Escolha feita no cadeado: 'allow'/'block' guarda; null volta a "Perguntar".
  ipcMain.handle('site-permission:set', (_e, url: string, kind: string, value: Decision | null) => {
    const origin = originOf(url);
    if (!origin || !PERM_KINDS.includes(kind as PermKind)) return { ok: false };
    const site = store[origin] || (store[origin] = {});
    if (value === 'allow' || value === 'block') site[kind as PermKind] = value;
    else delete site[kind as PermKind];
    if (Object.keys(site).length === 0) delete store[origin];
    save();
    settleOpen(origin);
    return { ok: true, perms: store[origin] || {} };
  });
  ipcMain.handle('site-permission:reset', (_e, url: string) => {
    const origin = originOf(url);
    if (origin && store[origin]) { delete store[origin]; save(); }
    return { ok: true };
  });
}
