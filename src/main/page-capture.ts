/**
 * page-capture.ts
 * Captura screenshot da viewport (ou de um elemento específico) usando o CDP
 * já configurado no main.ts — sem depender do Playwright.
 *
 * Exports:
 *   captureViewport(wcId, debuggerEnsureFn) → { imagePath, base64 }
 *   captureElement(wcId, selector, debuggerEnsureFn) → { imagePath, base64 }
 */

import fs from 'fs';
import path from 'path';
import { app, webContents } from 'electron';

export interface CaptureResult {
  imagePath: string;
  base64: string;
  width: number;
  height: number;
  source: 'viewport' | 'element';
}

let screenshotsDir: string | null = null;

// Track wcIds that already have DOM+Page domains enabled (separate from Accessibility)
const domPageEnabled = new Set<number>();

async function ensureDomPage(wc: Electron.WebContents, wcId: number): Promise<void> {
  if (!domPageEnabled.has(wcId)) {
    try { await wc.debugger.sendCommand('DOM.enable'); } catch {}
    try { await wc.debugger.sendCommand('Page.enable'); } catch {}
    domPageEnabled.add(wcId);
    wc.once('destroyed', () => domPageEnabled.delete(wcId));
  }
}

function getScreenshotsDir(): string {
  if (!screenshotsDir) {
    screenshotsDir = path.join(app.getPath('userData'), 'screenshots');
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
  }
  return screenshotsDir;
}

function screenshotFilename(taskId: string, type: string): string {
  const ts = Date.now();
  return path.join(getScreenshotsDir(), `${taskId}_${type}_${ts}.png`);
}

/**
 * Captura a viewport inteira usando Page.captureScreenshot do CDP.
 * @param wcId  WebContents ID (obtido via wv.getWebContentsId())
 * @param ensureDebugger  função que garante o debugger anexado (reuse da do main.ts)
 * @param taskId  identificador da tarefa atual
 */
export async function captureViewport(
  wcId: number,
  ensureDebugger: (wc: Electron.WebContents, wcId: number) => Promise<void>,
  taskId = 'task'
): Promise<CaptureResult> {
  const wc = webContents.fromId(wcId);
  if (!wc) throw new Error(`WebContents ${wcId} not found`);

  await ensureDebugger(wc, wcId);
  await ensureDomPage(wc, wcId);

  const layoutMetrics = await wc.debugger.sendCommand('Page.getLayoutMetrics') as any;
  const vp = layoutMetrics.visualViewport ?? layoutMetrics.layoutViewport;
  const width = Math.round(vp.clientWidth ?? vp.pageX ?? 1280);
  const height = Math.round(vp.clientHeight ?? vp.pageY ?? 800);

  const result = await wc.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    clip: {
      x: 0,
      y: 0,
      width,
      height,
      scale: 1,
    },
  }) as any;

  const base64: string = result.data;
  const imagePath = screenshotFilename(taskId, 'viewport');
  fs.writeFileSync(imagePath, Buffer.from(base64, 'base64'));

  return { imagePath, base64, width, height, source: 'viewport' };
}

/**
 * Captura apenas a área de um elemento CSS específico.
 * Usa DOM.getBoxModel + Page.captureScreenshot com clip.
 */
export async function captureElement(
  wcId: number,
  selector: string,
  ensureDebugger: (wc: Electron.WebContents, wcId: number) => Promise<void>,
  taskId = 'task'
): Promise<CaptureResult> {
  const wc = webContents.fromId(wcId);
  if (!wc) throw new Error(`WebContents ${wcId} not found`);

  await ensureDebugger(wc, wcId);
  await ensureDomPage(wc, wcId);

  // Resolve element node via DOM
  const docResult = await wc.debugger.sendCommand('DOM.getDocument', { depth: 0 }) as any;
  const nodeResult = await wc.debugger.sendCommand('DOM.querySelector', {
    nodeId: docResult.root.nodeId,
    selector,
  }) as any;

  if (!nodeResult.nodeId) throw new Error(`Element not found: ${selector}`);

  const boxResult = await wc.debugger.sendCommand('DOM.getBoxModel', {
    nodeId: nodeResult.nodeId,
  }) as any;

  const quad = boxResult.model?.border;
  if (!quad || quad.length < 8) throw new Error(`Cannot get box for: ${selector}`);

  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.round(Math.max(...xs) - x);
  const height = Math.round(Math.max(...ys) - y);

  const result = await wc.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    clip: { x: Math.round(x), y: Math.round(y), width, height, scale: 1 },
  }) as any;

  const base64: string = result.data;
  const imagePath = screenshotFilename(taskId, `element_${selector.replace(/[^a-z0-9]/gi, '_').slice(0, 30)}`);
  fs.writeFileSync(imagePath, Buffer.from(base64, 'base64'));

  return { imagePath, base64, width, height, source: 'element' };
}
