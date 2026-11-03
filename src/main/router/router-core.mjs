// Núcleo do roteador local (node-llama-cpp), sem Electron: usado pelo motor (engine.mjs, num
// utilityProcess) e pelo scripts/router-eval.mjs em node puro — o eval mede o MESMO código.
//
// Velocidade: o prompt fixo (rotas + exemplos) fica avaliado no contexto; a cada consulta o
// histórico volta pro só-system e o node-llama-cpp reaproveita esses tokens (prefixo comum) →
// só a mensagem nova é processada. A saída é presa por gramática (JSON schema) a UMA rota.
import { buildSystemPrompt, buildUserMessage, parseRoute, refineRoute, ROUTE_JSON_SCHEMA } from '../../shared/router-routes.ts';
import { buildExpandSystemPrompt, buildExpandUserMessage, parseExpansion, EXPAND_JSON_SCHEMA, EXPAND_MAX_TOKENS } from '../../shared/request-expansion.ts';

/**
 * Carrega o modelo e devolve {classify(text, ctx) → {route, ms}, expand(text) → {raw, ms}, backend, loadMs, dispose}.
 * A expansão (request-expansion.ts) usa um contexto PRÓPRIO, pequeno: o prefixo do classificador
 * continua no cache dele, e uma consulta não espera a outra.
 */
export async function loadRouter(modelPath, opts = {}) {
  const t0 = Date.now();
  // Import tardio: o engine.mjs ajusta o child_process.fork antes do node-llama-cpp carregar.
  const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
  // build:'never' → só binários pré-compilados (o app não tem cmake/compilador). gpu 'auto':
  // Metal no Mac Apple Silicon, Vulkan/CUDA no Windows/Linux quando há, senão CPU.
  const llama = await getLlama({ build: 'never', gpu: opts.gpu ?? 'auto', logLevel: 'error', progressLogs: false });
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext({ contextSize: 2048, sequences: 1 });
  const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: buildSystemPrompt() });
  const grammar = await llama.createGrammarForJsonSchema(ROUTE_JSON_SCHEMA);
  const baseHistory = session.getChatHistory();
  // Uma sequência de contexto → uma consulta por vez (fila).
  let chain = Promise.resolve();
  const run = async (text, ctx) => {
    const t1 = Date.now();
    session.setChatHistory(baseHistory);
    const out = await session.prompt(buildUserMessage(String(text || ''), ctx || {}), { grammar, maxTokens: 24, temperature: 0 });
    const raw = parseRoute(out);
    return { route: refineRoute(raw, text), raw, ms: Date.now() - t1 };
  };
  const classify = (text, ctx) => { const p = chain.then(() => run(text, ctx)); chain = p.catch(() => {}); return p; };
  // Aquece: avalia o prefixo fixo agora, não na primeira mensagem da pessoa.
  await classify('hi', {});

  // ── Expansão do pedido: só ACRESCENTA desambiguação; quem confere a saída é o main (validateExpansion).
  // Falhou ao montar (memória?) → sem expansão; o classificador segue igual.
  let xContext = null;
  let expand = null;
  try {
    xContext = await model.createContext({ contextSize: 1024, sequences: 1 });
    const xSession = new LlamaChatSession({ contextSequence: xContext.getSequence(), systemPrompt: buildExpandSystemPrompt() });
    const xGrammar = await llama.createGrammarForJsonSchema(EXPAND_JSON_SCHEMA);
    const xBase = xSession.getChatHistory();
    let xChain = Promise.resolve();
    const runExpand = async (text) => {
      const t1 = Date.now();
      xSession.setChatHistory(xBase);
      const out = await xSession.prompt(buildExpandUserMessage(String(text || '')), { grammar: xGrammar, maxTokens: EXPAND_MAX_TOKENS, temperature: 0 });
      return { raw: parseExpansion(out), ms: Date.now() - t1 };
    };
    expand = (text) => { const p = xChain.then(() => runExpand(text)); xChain = p.catch(() => {}); return p; };
    await expand('download the vlc installer');   // aquece o prefixo fixo
  } catch {
    try { await xContext?.dispose(); } catch {}
    xContext = null;
    expand = null;
  }
  return {
    classify,
    expand,
    backend: llama.gpu || 'cpu',
    loadMs: Date.now() - t0,
    dispose: async () => { try { await xContext?.dispose(); await context.dispose(); await model.dispose(); await llama.dispose(); } catch {} },
  };
}
