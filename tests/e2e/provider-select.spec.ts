import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// O <select> de provedor de nuvem eh CONTROLADO (value={...}); um ternario incompleto
// fazia o React forcar o DOM de volta pra "deepseek" a cada render sempre que o provider
// nao fosse mistral/nvidia -- inclusive 'anthropic' (Claude), mesmo com o estado interno
// ja correto. So um teste ao vivo prova que o DOM realmente PERSISTE a escolha apos o
// proprio React re-renderizar (uma leitura do JSX nao pega esse bug).
test('selecting Claude in the provider dropdown sticks (does not snap back to DeepSeek)', async () => {
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({
    executablePath: path.resolve(__dirname, '../../node_modules/electron/dist/electron.exe'),
    args: [path.resolve(__dirname, '../..')],
    env: { ...env, E2E_MOCK_AI: '1', NODE_ENV: 'test' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  try {
    // O painel do assistente ja abre por padrao (store.sidebarOpen inicia true) --
    // clicar em .ai-toggle aqui FECHARIA em vez de abrir.
    await page.locator('.sidebar-actions button').first().click();   // engrenagem (Configuracoes)
    await expect(page.locator('.settings-panel')).toBeVisible();
    await page.locator('.mode-opt', { hasText: 'Cloud' }).click().catch(() => {});   // garante view=cloud

    const select = page.locator('.settings-panel select').nth(1);   // [0]=idioma, [1]=provedor
    await select.selectOption('anthropic');

    // O bug so aparece DEPOIS de um re-render provocado por outra interacao -- provoca
    // um (digitar na chave) e confere que o <select> nao voltou pra deepseek sozinho.
    await page.locator('.settings-panel input[type="password"]').fill('sk-ant-test-fake');
    await expect(select).toHaveValue('anthropic');
    await expect(page.locator('.settings-panel')).toContainText('Claude');   // label da chave
  } finally {
    await app.close();
  }
});
