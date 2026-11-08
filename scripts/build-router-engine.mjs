// Empacota o motor do roteador local (src/main/router/engine.mjs + núcleo + rotas compartilhadas)
// num único ESM. O node-llama-cpp fica EXTERNO: ele acha os próprios binários e o arquivo de teste
// do binário pelo caminho dos seus arquivos — empacotado junto, isso quebra.
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/main/router/engine.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/main/router/engine.mjs',
  external: ['node-llama-cpp'],
  logLevel: 'warning',
});

console.log('[build-router-engine] bundle ESM gerado (externo: node-llama-cpp)');
