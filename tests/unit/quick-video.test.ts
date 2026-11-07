// Atalhos de vídeo/música (site-knowledge.ts → detectQuickAction): coleção vai pro agente, "music video" é
// vídeo. site-knowledge importa a UI (i18n, localStorage), então o teste empacota com esbuild e roda com
// um localStorage/window de mentira.
import { test } from 'node:test';
import assert from 'node:assert';
import { buildSync } from 'esbuild';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve(import.meta.dirname, '../..');
async function load() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-qa-'));
  const entry = path.join(dir, 'entry.ts');
  fs.writeFileSync(entry, `(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
(globalThis as any).window = Object.assign(globalThis, { addEventListener() {}, removeEventListener() {} });
export const { detectQuickAction } = await import(${JSON.stringify(path.join(ROOT, 'src/renderer/site-knowledge.ts'))});`);
  const out = path.join(dir, 'out.mjs');
  buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error' });
  return (await import(pathToFileURL(out).href)) as { detectQuickAction: (c: string) => any };
}

test('collections ("all the music videos from the movie…", soundtrack, album) go to the agent, not a one-search shortcut', async () => {
  const { detectQuickAction } = await load();
  assert.equal(detectQuickAction('find all the music videos from the movie top gun with tom cruise and download them'), null);
  assert.equal(detectQuickAction('download the top gun soundtrack'), null);
  assert.equal(detectQuickAction('baixe todas as músicas do álbum thriller'), null);
  // A single music video is still a quick download — as VIDEO, not audio.
  const one = detectQuickAction('download the beat it music video');
  assert.equal(one?.type, 'download_video');
  assert.notEqual(one?.audio_only, true);
  // A single song stays audio.
  assert.equal(detectQuickAction('download the song beat it by michael jackson')?.audio_only, true);
});
