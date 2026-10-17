// Renderer integration with a scripted preload bridge. The unit/socket tests exercise
// the registered main-process IPC and real MCP transport separately.
import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

let server: http.Server;
let origin: string;
test.beforeAll(async () => {
  const root = path.resolve(__dirname, '../../dist/renderer');
  server = http.createServer(async (req, res) => {
    try {
      const file = path.resolve(root, '.' + new URL(req.url!, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
      if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      const data = await fs.readFile(file);
      const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
});
test.afterAll(() => { server?.closeAllConnections(); server?.close(); });

test('Quick Research choice persists and routes question to cited response; Off makes no search request', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uiLang', 'en');
    localStorage.setItem('tourSeen', '1');
    localStorage.setItem('guideSeen', '1');
    (window as any).researchCalls = [];
    (window as any).electronAPI = new Proxy({}, {
      get: (_target, name: string) => {
        if (name === 'systemLocale') return 'en-US';
        if (name === 'passwords') return undefined;
        if (name.startsWith('on')) return () => () => {};
        if (name === 'decryptSecretSync') return (value: string) => value;
        if (name === 'researchSearch') return async (query: string, requestId: string, sessionId: string) => {
          (window as any).researchCalls.push({ query, requestId, sessionId });
          return { results: [{ title: 'Electron documentation', url: 'https://www.electronjs.org/docs/latest/', snippet: 'Electron combines Chromium and Node.js.' }] };
        };
        if (name === 'aiChat') return async (prompt: string) => ({ response: prompt.startsWith('Classify') ? 'WEB' : 'Electron combines Chromium and Node.js (electronjs.org).' });
        if (name === 'bookmarksSources' || name === 'extensionsList') return async () => [];
        if (name === 'gpuInfo') return async () => ({ hasGpu: false });
        return async () => ({});
      },
    });
  });
  // No external networking is needed for this scripted renderer test.
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  await page.locator('.sidebar-actions button').first().click();
  const select = page.getByLabel('Quick Research provider (applies immediately)');
  await expect(select).toHaveValue('browser');
  await select.selectOption('parallel');
  await page.reload();
  await page.locator('.sidebar-actions button').first().click();
  await expect(select).toHaveValue('parallel');
  await page.locator('.sidebar-actions button').first().click();
  await page.getByTestId('agent-command-input').fill('What is Electron?');
  await page.getByTestId('quick-research').click();
  await expect(page.locator('.agent-feed')).toContainText('Electron combines Chromium and Node.js');
  await expect(page.locator('.agent-feed .chat-source').first()).toBeVisible();
  await expect(page.locator('.agent-feed .chat-source').first()).toHaveAttribute('title', 'Electron documentation\nhttps://www.electronjs.org/docs/latest/');
  expect(await page.evaluate(() => localStorage.getItem('agentDrive'))).toBeNull();
  const firstCalls = await page.evaluate(() => (window as any).researchCalls);
  expect(firstCalls).toHaveLength(1);
  expect(firstCalls[0].query).toBe('What is Electron?');
  expect(firstCalls[0].sessionId).toMatch(/^[a-f0-9-]{36}$/);
  await page.getByTestId('agent-command-input').fill('What is Chromium?');
  await page.getByTestId('quick-research').click();
  await expect.poll(() => page.evaluate(() => (window as any).researchCalls.length)).toBe(2);
  const secondCalls = await page.evaluate(() => (window as any).researchCalls);
  expect(secondCalls[1].sessionId).toBe(firstCalls[0].sessionId);
  await page.locator('.sidebar-actions button').first().click();
  await select.selectOption('off');
  await page.locator('.sidebar-actions button').first().click();
  await page.getByTestId('agent-command-input').fill('What is Node.js?');
  await expect(page.getByTestId('quick-research')).toBeDisabled();
  expect(await page.evaluate(() => (window as any).researchCalls.length)).toBe(2);
});
