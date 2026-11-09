import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Tarefas agendadas: criar pelo assistente ("every weekday at 8am …"), o relógio injetado
// (E2E_SCHED_NOW + window.__bahSched.setNow) faz a hora chegar, a tarefa roda num aba com sessão
// "⏰ …" e fica no histórico; uma vez que bate no freio (botão "Send" numa tarefa sem ninguém olhando)
// espera — com aviso — e não clica; reabrir depois da hora oferece "Rodar agora / Pular / Adiar /
// Apagar": adiar 3 dias pula as vezes até lá (e sobrevive a reiniciar), apagar pede confirmação.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Segunda-feira 2026-11-02 07:59 (hora local da máquina): a tarefa "dias úteis às 8h" vence em 1 minuto.
const MONDAY_0759 = new Date(2026, 10, 2, 7, 59, 0).getTime();
const TUESDAY_1000 = new Date(2026, 10, 3, 10, 0, 0).getTime();
const THURSDAY_1000 = new Date(2026, 10, 5, 10, 0, 0).getTime();
const SATURDAY_1200 = new Date(2026, 10, 7, 12, 0, 0).getTime();

test('scheduled tasks: create from the assistant, fire on the clock, wait at the brake, offer the missed run (run, snooze, delete)', async () => {
  test.setTimeout(300_000);
  let sent = 0;
  const server = http.createServer((q, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (q.url === '/sent') { sent++; res.end('ok'); return; }
    if (q.url === '/send') { res.end('<title>Message</title><h1>Reply</h1><textarea>Hi</textarea><button onclick="fetch(\'/sent\')">Send</button>'); return; }
    res.end('<title>Job board</title><h1>Jobs for you</h1><ul><li>Engineer</li><li>Designer</li></ul>');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-sched-'));
  const { ELECTRON_RUN_AS_NODE: _n, ...baseEnv } = process.env;
  const launch = (now: number, script: unknown[]) => electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'],
    env: { ...baseEnv, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test', E2E_SCHED_NOW: String(now) },
  });
  const ready = async (app: ElectronApplication): Promise<Page> => {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    await page.waitForFunction(() => !!(window as any).__bahSched);
    return page;
  };
  const state = (page: Page) => page.evaluate(() => (window as any).__bahSched.state());
  const prompts = (app: ElectronApplication) => app.evaluate(() => ((global as any).__e2ePrompts || []).length as number);
  const setScript = (app: ElectronApplication, script: unknown[]) => app.evaluate((_e, s) => { process.env.E2E_MOCK_SCRIPT = s; (global as any).__e2ePrompts = []; }, JSON.stringify(script));
  const openPanel = async (page: Page) => { await page.locator('.menu-btn[title="Menu"]').click(); await page.getByTestId('menu-scheduled').click(); await expect(page.getByTestId('sched-panel')).toBeVisible(); };

  let app = await launch(MONDAY_0759, [
    { type: 'navigate', url: T },
    { type: 'done', reason: 'Checked the board: 2 new jobs.', success: true },
  ]);
  try {
    const page = await ready(app);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();

    // ── 1. Criar pelo assistente: claro (dia + hora com am) → salva direto, sem rodar nada agora.
    await page.getByTestId('agent-command-input').fill('every weekday at 8am check the job board');
    await page.getByTestId('agent-command-input').press('Enter');
    await expect(page.getByText(/Scheduled: “check the job board”/).first()).toBeVisible();
    let s = await state(page);
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0].command).toBe('check the job board');
    expect(s.tasks[0].nextAt).toBe(new Date(2026, 10, 2, 8, 0, 0).getTime());
    await sleep(1500);
    expect(await prompts(app)).toBe(0);   // agendar não roda o agente

    // Ambíguo ("at 9": manhã ou noite?) → cartão com as próximas 3 vezes; Cancelar não salva.
    await page.getByTestId('agent-command-input').fill('every monday at 9 summarize the news');
    await page.getByTestId('agent-command-input').press('Enter');
    await expect(page.getByText('⏰ Schedule this task?').first()).toBeVisible();
    await expect(page.getByText(/Next runs:/).first()).toBeVisible();
    await page.locator('.confirm-no').last().click();
    await expect(page.getByText('OK — not scheduled.').first()).toBeVisible();
    expect((await state(page)).tasks).toHaveLength(1);

    // ── 2. A hora chega (relógio injetado): roda numa aba com a sessão "⏰ Job hunt", histórico gravado.
    await page.evaluate((t) => (window as any).__bahSched.setNow(t), new Date(2026, 10, 2, 8, 0, 5).getTime());
    await expect(page.getByText('Checked the board: 2 new jobs.').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.session-chip', { hasText: '⏰ Job hunt' })).toHaveCount(1);
    await expect.poll(async () => (await state(page)).tasks[0].history.length, { timeout: 15_000 }).toBe(1);
    s = await state(page);
    expect(s.tasks[0].history[0].outcome).toBe('success');
    expect(s.tasks[0].nextAt).toBe(new Date(2026, 10, 3, 8, 0, 0).getTime());   // terça 8h
    expect(s.run).toBeNull();
    await openPanel(page);
    await page.locator('.sched-hist-toggle').first().click();
    await expect(page.getByTestId('sched-history')).toContainText('done');

    // ── 3. Rodar agora uma vez que esbarra no "Send": sem ninguém olhando, espera e NÃO clica.
    await setScript(app, [
      { type: 'navigate', url: T + 'send' },
      { type: 'click_text', text: 'Send' },
      { type: 'done', reason: 'Stopped before sending.', success: false },
    ]);
    await page.getByTestId('sched-run-now').first().click();
    await expect.poll(async () => (await state(page)).run?.status, { timeout: 60_000 }).toBe('waiting');
    await expect(page.getByTestId('sched-now')).toContainText('waiting for you');
    await expect(page.locator('.sched-waiting')).toBeVisible();
    const notes = await app.evaluate(() => (global as any).__e2eSchedNotes || []);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.at(-1).body).toContain('Job hunt');
    await sleep(4000);
    expect(sent).toBe(0);   // esperando: nada saiu
    expect((await state(page)).run?.status).toBe('waiting');
    // A pessoa volta e diz não: segue sem enviar, e a vez entra no histórico.
    await page.getByTestId('sched-now').getByRole('button').click();
    await page.locator('.feed-confirm-card .confirm-no').last().click();
    await expect.poll(async () => (await state(page)).tasks[0].history.length, { timeout: 60_000 }).toBe(2);
    expect(sent).toBe(0);
  } finally { await app.close(); }

  // ── 4. Reabrir na terça 10h: a das 8h passou com o Bah fechado → oferecida, não roda sozinha.
  app = await launch(TUESDAY_1000, [
    { type: 'navigate', url: T },
    { type: 'done', reason: 'Missed run done.', success: true },
  ]);
  try {
    const page = await ready(app);
    await expect(page.getByTestId('sched-missed')).toBeVisible();
    await expect(page.getByTestId('sched-missed-row')).toHaveCount(1);
    await expect(page.getByTestId('sched-missed-row')).toContainText('check the job board');
    await sleep(3000);
    expect(await prompts(app)).toBe(0);
    await expect(page.locator('.session-chip', { hasText: '⏰' })).toHaveCount(0);
    let s = await state(page);
    expect(s.tasks[0].history).toHaveLength(2);   // o histórico sobreviveu (cifrado no disco)

    await page.getByTestId('sched-missed-run').click();
    await expect(page.getByTestId('sched-missed')).toHaveCount(0);
    await expect(page.getByText('Missed run done.').first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await state(page)).tasks[0].history.length, { timeout: 15_000 }).toBe(3);
    s = await state(page);
    expect(s.tasks[0].history[2].outcome).toBe('success');
    expect(s.tasks[0].nextAt).toBe(new Date(2026, 10, 4, 8, 0, 0).getTime());   // quarta 8h
    // O arquivo no disco é cifrado: o pedido não aparece em texto puro.
    const raw = fs.readFileSync(path.join(tmp, 'scheduled-tasks.enc'));
    expect(raw.includes(Buffer.from('check the job board'))).toBe(false);

    // Uma segunda tarefa pelo painel (pro "Apagar" depois): todo dia às 9h → quarta 9h.
    await openPanel(page);
    await page.getByTestId('sched-command').fill('read the weather report');
    await page.getByTestId('sched-when').fill('every day at 9am');
    await page.getByTestId('sched-save').click();
    await expect(page.getByTestId('sched-item')).toHaveCount(2);
    s = await state(page);
    expect(s.tasks[1].nextAt).toBe(new Date(2026, 10, 4, 9, 0, 0).getTime());
  } finally { await app.close(); }

  let snoozedUntil = 0;
  // ── 5. Reabrir na quinta 10h: as duas perderam quarta e quinta → Adiar uma, Apagar a outra.
  app = await launch(THURSDAY_1000, [{ type: 'done', reason: 'Should not run.', success: true }]);
  try {
    const page = await ready(app);
    await expect(page.getByTestId('sched-missed-row')).toHaveCount(2);
    const jobs = page.getByTestId('sched-missed-row').filter({ hasText: 'check the job board' });
    const weather = page.getByTestId('sched-missed-row').filter({ hasText: 'read the weather report' });
    await expect(jobs).toContainText('Missed 2 times');

    // Adiar: primeiro as escolhas (1, 3, 7 dias); Cancelar volta aos botões sem mudar nada.
    await jobs.getByTestId('sched-missed-snooze').click();
    await expect(jobs.getByTestId('sched-missed-snooze-choices')).toBeVisible();
    await expect(jobs.locator('[data-testid^="sched-snooze-"]')).toHaveText(['1 day', '3 days', '7 days']);
    await jobs.getByRole('button', { name: 'Cancel' }).click();
    await expect(jobs.getByTestId('sched-missed-run')).toBeVisible();
    await jobs.getByTestId('sched-missed-snooze').click();
    await jobs.getByTestId('sched-snooze-3').click();
    await expect(page.getByTestId('sched-missed-row')).toHaveCount(1);
    let s = await state(page);
    const job = s.tasks.find((x: any) => x.command === 'check the job board');
    // Quinta 10h + 3 dias = domingo 10h; dias úteis 8h → segunda 9 de novembro, 8h.
    // (o relógio injetado anda: alguns segundos depois das 10h)
    expect(job.snoozedUntil).toBeGreaterThanOrEqual(new Date(2026, 10, 8, 10, 0, 0).getTime());
    expect(job.snoozedUntil).toBeLessThan(new Date(2026, 10, 8, 10, 5, 0).getTime());
    snoozedUntil = job.snoozedUntil;
    expect(job.nextAt).toBe(new Date(2026, 10, 9, 8, 0, 0).getTime());
    expect(job.enabled).toBe(true);
    expect(job.history.at(-1)).toMatchObject({ outcome: 'skipped', missed: true });
    expect(job.history.at(-1).summary).toContain('snoozed');

    // Apagar: pede confirmação; "Keep" não apaga; "Delete task" apaga.
    await weather.getByTestId('sched-missed-delete').click();
    await expect(weather.getByTestId('sched-missed-delete-confirm')).toContainText('can’t be undone');
    await weather.getByTestId('sched-missed-delete-no').click();
    expect((await state(page)).tasks).toHaveLength(2);
    await weather.getByTestId('sched-missed-delete').click();
    await weather.getByTestId('sched-missed-delete-yes').click();
    await expect(page.getByTestId('sched-missed')).toHaveCount(0);
    s = await state(page);
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0].command).toBe('check the job board');
    await sleep(2000);
    expect(await prompts(app)).toBe(0);   // nenhuma das escolhas roda o agente

    await openPanel(page);
    await expect(page.getByTestId('sched-snoozed')).toBeVisible();
  } finally { await app.close(); }

  // ── 6. Reabrir no sábado (ainda adiada): nada oferecido; na segunda 8h a regra normal volta.
  app = await launch(SATURDAY_1200, [
    { type: 'navigate', url: T },
    { type: 'done', reason: 'Back on schedule.', success: true },
  ]);
  try {
    const page = await ready(app);
    await sleep(2000);
    await expect(page.getByTestId('sched-missed')).toHaveCount(0);
    let s = await state(page);
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0].nextAt).toBe(new Date(2026, 10, 9, 8, 0, 0).getTime());
    expect(s.tasks[0].snoozedUntil).toBe(snoozedUntil);   // gravado no disco
    expect(await prompts(app)).toBe(0);
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.evaluate((t) => (window as any).__bahSched.setNow(t), new Date(2026, 10, 9, 8, 0, 5).getTime());
    await expect(page.getByText('Back on schedule.').first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await state(page)).tasks[0].history.at(-1).outcome, { timeout: 15_000 }).toBe('success');
    s = await state(page);
    expect(s.tasks[0].nextAt).toBe(new Date(2026, 10, 10, 8, 0, 0).getTime());   // terça 8h
    expect(s.tasks[0].snoozedUntil).toBeUndefined();
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
