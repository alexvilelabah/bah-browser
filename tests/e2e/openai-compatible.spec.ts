import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';

async function launch() {
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/electron/dist/electron.exe'),
    args: [path.resolve(__dirname, '../..')],
    // E2E_MOCK_AI so intercepta o AGENTE (ai:action); o caminho de CHAT usa o engine real,
    // que e exatamente o que queremos exercitar contra o servidor OpenAI-compativel falso.
    env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

// PROVA 1 (UI): o <select> e controlado; sem o ramo 'openai' no ternario do value ele
// voltaria pra "deepseek" a cada render (o mesmo bug do Claude). Confirma que a escolha
// PERSISTE apos o React re-renderizar, e que os campos do servidor local aparecem.
test('selecting OpenAI-compatible sticks and reveals the base-URL field', async () => {
  const { app, page } = await launch();
  try {
    await page.locator('.sidebar-actions button').first().click();   // engrenagem
    await expect(page.locator('.settings-panel')).toBeVisible();
    await page.locator('.mode-opt', { hasText: 'Cloud' }).click().catch(() => {});

    const select = page.locator('.settings-panel select').nth(1);   // [0]=idioma, [1]=provedor
    await select.selectOption('openai');
    // Provoca um re-render (digitar) e confirma que o <select> NAO voltou pra deepseek.
    await page.locator('.settings-panel input[type="password"]').fill('');
    await expect(select).toHaveValue('openai');
    // O campo de URL do servidor local aparece com o placeholder de exemplo.
    await expect(page.locator('.settings-panel input[placeholder="http://localhost:8080"]')).toBeVisible();
  } finally {
    await app.close();
  }
});

// PROVA 2 (ponta a ponta): sobe um servidor OpenAI-compativel FALSO, aponta o app pra ele
// SEM chave, manda um chat e confirma que a resposta veio do NOSSO servidor. Isso exercita
// os dois fixes de backend juntos: (a) main.ts constroi o engine 'openai' sem chave quando
// ha baseUrl; (b) callOpenAI manda o modelo do usuario, nao o 'gpt-4o' fixo.
test('routes chat to a keyless OpenAI-compatible server with the chosen model', async () => {
  const SENTINEL = 'PONG_FROM_FAKE_LLAMACPP_42';
  let seenModel = '';
  let seenAuth: string | undefined;
  let seenPath = '';

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      seenPath = req.url || '';
      seenAuth = req.headers['authorization'] as string | undefined;
      try { seenModel = JSON.parse(body).model; } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: SENTINEL } }] }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const { app, page } = await launch();
  try {
    // Aponta o engine pro servidor falso: provider 'openai', SEM chave, com baseUrl e modelo.
    // (E o mesmo caminho que o Salvar das Configuracoes dispara: ai:set-provider.)
    await page.evaluate((url) => (window as any).electronAPI.setAIProvider('openai', '', url, 'my-test-model'), baseUrl);

    const result: any = await page.evaluate(() => (window as any).electronAPI.aiChat('ping'));

    expect(result?.response).toContain(SENTINEL);   // a resposta veio do NOSSO servidor
    expect(seenPath).toContain('/v1/chat/completions');
    expect(seenModel).toBe('my-test-model');         // o modelo do usuario chegou (fix do gpt-4o fixo)
    // Sem chave: o header nao carrega segredo nenhum (Node corta o espaco final do "Bearer ").
    // Chegar aqui ja prova que 'ai:set-provider' respeita o provider/baseUrl escolhidos sem
    // nenhum fallback automatico por baixo — o servidor falso e o unico jeito da resposta chegar.
    expect((seenAuth || '').replace(/^Bearer\s*/, '')).toBe('');
  } finally {
    await app.close();
    await new Promise<void>(r => server.close(() => r()));
  }
});
