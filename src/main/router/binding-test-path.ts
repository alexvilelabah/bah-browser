// Qual arquivo o main aceita abrir como teste do binário nativo do node-llama-cpp (pedido 'bt-fork'
// do motor). Só um: o testBindingBinary.js do node-llama-cpp que o PRÓPRIO app resolve.
import * as path from 'path';
import * as fs from 'fs';

export const BINDING_TEST_FILE = path.join('node_modules', 'node-llama-cpp', 'dist', 'bindings', 'utils', 'testBindingBinary.js');

// Compara caminhos REAIS dos dois lados: o pedido do motor e <appPath>/node_modules/node-llama-cpp/….
// Com node_modules num link simbólico (worktree do git, monorepo, pnpm) o node entrega o caminho já
// resolvido, fora do appPath — o "começa com appPath" de antes recusava e o motor caía em
// NoBinaryFoundError. Agora tem que ser o MESMO arquivo, não só "algo dentro do app": é mais estrito
// que antes (um node-llama-cpp aninhado em outro pacote, ou appPath-qualquer-coisa, não passa mais).
// Empacotado: o fs do Electron resolve caminhos dentro do app.asar (realpath do .asar + caminho
// interno), e o arquivo de teste fica no asar (não está no asarUnpack) → os dois lados batem do
// mesmo jeito. Se o realpath falhar, vale o caminho só resolvido — ainda exigindo igualdade exata,
// então nunca fica mais frouxo. Devolve o caminho a abrir, ou null = recusa.
export function bindingTestFileToFork(
  requested: string,
  appPath: string,
  realpath: (p: string) => string = fs.realpathSync,
): string | null {
  if (!requested) return null;
  const file = path.resolve(requested);
  if (!file.endsWith(path.sep + BINDING_TEST_FILE)) return null;
  const real = (p: string) => { try { return realpath(p); } catch { return p; } };
  const got = real(file);
  const expected = real(path.resolve(appPath, BINDING_TEST_FILE));
  return got === expected ? got : null;
}
