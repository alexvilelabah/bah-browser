import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// A conversa (thread) da sessão do assistente: volta depois de reiniciar SÓ com "Continuar de onde
// parou"; o 🕘 Histórico de conversas lista a sessão fechada e o Retomar a traz de volta; o medidor de
// contexto mostra números e, com um orçamento minúsculo (gancho de teste), o resumo aparece no feed.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let server: http.Server;
let T = '';
test.beforeAll(async () => {
  server = http.createServer((q, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<title>Job board</title><h1>Jobs</h1><p>Golf caddie — Acme Golf</p><a href="/second">Second job</a>');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
test.afterAll(() => { server?.close(); });

async function launch(userData: string, script: unknown[], extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, `--user-data-dir=${userData}`, '--use-mock-keychain'],
    env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test', ...extraEnv },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await sleep(1500);
  return { app, page };
}

async function firstRun(page: Page, startupMode: 'restore' | 'newtab') {
  await page.evaluate((m) => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); localStorage.setItem('startupMode', m); }, startupMode);
  await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
}

async function openPanel(page: Page) {
  if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
}

async function runTask(page: Page, cmd: string, doneText: string) {
  await openPanel(page);
  await page.getByTestId('agent-command-input').fill(cmd);
  await page.getByTestId('agent-command-input').press('Enter');
  for (let i = 0; i < 120; i++) {
    if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
    if (await page.locator('.result-report', { hasText: doneText }).first().isVisible().catch(() => false)) break;
    await sleep(500);
  }
  await expect(page.locator('.result-report', { hasText: doneText }).first()).toBeVisible();
}

const prompts = async (app: ElectronApplication): Promise<string[]> => app.evaluate(() => ((global as any).__e2ePrompts || []) as string[]);

test('a session thread survives a restart with "Continue where you left off", and not without it', async () => {
  test.setTimeout(240_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-thread-restore-'));
  const script = [{ type: 'navigate', url: T }, { type: 'done', reason: 'Found the golf caddie job.', success: true }];
  try {
    // 1) Restore ON: a task creates the session and its thread.
    let { app, page } = await launch(tmp, script);
    await firstRun(page, 'restore');
    await runTask(page, 'browse to the golf board', 'Found the golf caddie job.');
    await expect(page.locator('.session-chip')).toHaveText('Golf Board');
    await sleep(2500);   // the live thread is saved at most 1.5 s after a change
    await app.close();

    // 2) Restart: same tab, same session chip, the conversation is back (feed + agent prompt).
    ({ app, page } = await launch(tmp, [{ type: 'done', reason: 'Opened it again.', success: true }]));
    await openPanel(page);
    await expect(page.locator('.session-chip')).toHaveText('Golf Board');
    await expect(page.getByTestId('thread-recap')).toContainText('browse to the golf board');
    await runTask(page, 'browse to the golf board again', 'Opened it again.');
    const p1 = await prompts(app);
    expect(p1[0]).toContain('PREVIOUS REQUESTS THIS SESSION');
    expect(p1[0]).toContain('browse to the golf board');
    expect(p1[0]).toContain('Found the golf caddie job.');

    // 3) Restore OFF: next start is a fresh new tab — no session, no thread in the prompt.
    await page.evaluate(() => localStorage.setItem('startupMode', 'newtab'));
    await sleep(2500);
    await app.close();
    ({ app, page } = await launch(tmp, [{ type: 'done', reason: 'Fresh start.', success: true }]));
    await openPanel(page);
    await expect(page.locator('.session-chip')).toHaveCount(0);
    await expect(page.getByTestId('thread-recap')).toHaveCount(0);
    await runTask(page, 'browse to the golf board', 'Fresh start.');
    const p2 = await prompts(app);
    expect(p2[0]).not.toContain('PREVIOUS REQUESTS THIS SESSION');
    expect(p2[0]).not.toContain('Found the golf caddie job.');
    await app.close();
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('chat history lists a closed session and Resume brings it back', async () => {
  test.setTimeout(180_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-chat-history-'));
  const script = [{ type: 'navigate', url: T }, { type: 'done', reason: 'Found the golf caddie job.', success: true }];
  const { app, page } = await launch(tmp, script);
  try {
    await firstRun(page, 'newtab');
    await runTask(page, 'browse to the golf board', 'Found the golf caddie job.');
    await expect(page.locator('.session-chip')).toHaveText('Golf Board');
    // A second tab, then close the session's only tab: the session ends (and goes to history).
    await page.locator('.tab-new').click(); await sleep(600);
    await page.locator('.tab.in-session .tab-close').click(); await sleep(800);
    await expect(page.locator('.session-chip')).toHaveCount(0);

    await page.locator('.menu-btn[title="Menu"]').click();
    await page.getByTestId('menu-chat-history').click();
    const row = page.getByTestId('chat-history-row').first();
    await expect(row).toContainText('Golf Board');
    await expect(row).toContainText('browse to the golf board');
    await expect(row).toContainText('127.0.0.1');
    // Open read-only, then Resume (reopening its tab).
    await row.click();
    await expect(page.getByTestId('chat-history-open')).toContainText('Found the golf caddie job.');
    await page.getByTestId('chat-history-resume-tabs').click();
    await expect(page.locator('.session-chip')).toHaveText('Golf Board');
    await openPanel(page);
    await expect(page.getByTestId('panel-session-chip')).toContainText('Golf Board');
    await expect(page.getByTestId('thread-recap')).toContainText('browse to the golf board');
  } finally { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('context meter shows numbers; a tiny thread budget makes the summary notice appear', async () => {
  test.setTimeout(180_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-ctx-meter-'));
  const script = [
    { type: 'navigate', url: T },
    { type: 'done', reason: 'First golf job found.', success: true },
    { type: 'done', reason: 'Second golf job found.', success: true },
    { type: 'done', reason: 'Third golf job found.', success: true },
  ];
  const { app, page } = await launch(tmp, script, { E2E_CONTEXT_WINDOW: '16384' });
  try {
    await firstRun(page, 'newtab');
    await runTask(page, 'browse to the golf board', 'First golf job found.');
    const meter = page.getByTestId('context-meter');
    await expect(meter).toBeVisible();
    await expect(meter).toHaveText(/context ~?[\d.]+k? \/ 16k · thread [\d.]+k?/);
    await meter.click();
    await expect(page.getByTestId('context-breakdown')).toContainText('Instructions');
    await expect(page.getByTestId('context-breakdown')).toContainText('Page');
    await expect(page.getByTestId('context-breakdown')).toContainText('estimate');   // the mock reports 0 tokens
    await page.getByTestId('context-breakdown').click();

    // Test hook: a 40-token thread budget → the third task folds the oldest one into the summary.
    await page.evaluate(() => { (window as any).__bahThreadBudget = 40; });
    await runTask(page, 'browse to the golf board once more', 'Second golf job found.');
    await runTask(page, 'browse to the golf board a third time', 'Third golf job found.');
    const notice = page.getByTestId('thread-compacted').first();
    await expect(notice).toContainText(/Summarized \d+ older turn/);
    await notice.locator('summary').click();
    await expect(notice.locator('.thread-summary')).toContainText('task "browse to the golf board"');
    // "/compact" does the same on demand (nothing left beyond the last two → says so).
    await page.getByTestId('agent-command-input').fill('/compact');
    await page.getByTestId('agent-command-input').press('Enter');
    await expect(page.getByText('Nothing to summarize yet.')).toBeVisible();
  } finally { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
