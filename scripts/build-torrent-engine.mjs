// Empacota o motor de torrent (engine.mjs) num único arquivo ESM com o webtorrent JS
// INLINE, deixando só os 5 módulos NATIVOS como externos (não dá pra bundlar .node).
// Assim, no app empacotado, basta desempacotar do asar esses nativos (asarUnpack) — não
// a árvore inteira do webtorrent. Shims de require/__dirname porque deps CJS embutidas usam.
import * as esbuild from 'esbuild';

const NATIVE = ['node-datachannel', 'utp-native', 'bufferutil', 'utf-8-validate', 'fs-native-extensions'];

await esbuild.build({
  entryPoints: ['src/main/torrent/engine.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/main/torrent/engine.mjs',
  external: NATIVE,
  logLevel: 'warning',
  banner: {
    js: [
      "import { createRequire as __bahCreateRequire } from 'module';",
      "import { fileURLToPath as __bahFileURLToPath } from 'url';",
      "import { dirname as __bahDirname } from 'path';",
      'const require = __bahCreateRequire(import.meta.url);',
      'const __filename = __bahFileURLToPath(import.meta.url);',
      'const __dirname = __bahDirname(__filename);',
    ].join('\n'),
  },
});

console.log('[build-torrent-engine] bundle ESM gerado (nativos externos: ' + NATIVE.join(', ') + ')');
