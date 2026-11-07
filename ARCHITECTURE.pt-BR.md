# Arquitetura e mapa do repositório

**Português** · [English](ARCHITECTURE.md)

Um guia pra ler o código. Use junto com [SECURITY.pt-BR.md](SECURITY.pt-BR.md) (modelo de
ameaça + checklist). O `src/` inteiro tem ~30 arquivos — dá pra ler de uma sentada.

O Bah é um app Electron com dois processos ligados por uma bridge de preload. As páginas web
carregam dentro de um `<webview partition="persist:browser">`. O agente **observa** uma
página, **decide** uma ação e a **executa** com **eventos de input reais do SO** (não eventos
de DOM sintéticos), então os sites reagem exatamente como reagiriam pra uma pessoa.

---

## Os dois processos + a bridge

- **Renderer** (`src/renderer/`) — a UI em React **e o loop de decisão do agente**. Roda
  sandboxed (`contextIsolation`, sem `nodeIntegration`); só chega no SO pela bridge de preload.
- **Main** (`src/main/`) — privilegiado (Node): janelas, a sessão do `<webview>`, injeção de
  input real, downloads, chamadas HTTP de IA, ffmpeg/yt-dlp, OCR.
- **Preload** (`src/preload/preload.ts`) — a **única** ponte entre eles. Um arquivo curto, uma
  lista fixa de canais IPC. Ver [SECURITY.pt-BR.md](SECURITY.pt-BR.md).

---

## Caminho quente de um comando

1. Você digita na caixa → [`AgentCommandBar.tsx`](src/renderer/components/AgentCommandBar.tsx)
   (`routeCommand`) decide: **ação determinística**, **classificar por IA** ou **chat**.
2. Uma tarefa do agente chama `onExecute` ([`App.tsx`](src/renderer/App.tsx), ~linha 862) → o
   loop ReAct. **O loop vivo do agente fica no `App.tsx`.**
3. Cada passo resolve UMA ação, vinda de [`detectQuickAction`](src/renderer/site-knowledge.ts)
   (atalhos 0-token, sem IA) **ou** da IA ([`ai-engine.ts`](src/main/ai-engine.ts)).
4. A ação roda: clique/digitação/tecla reais vão renderer → preload → `main.ts`
   (`sendInputEvent`); operações na página vão pelo
   [`page-executor.ts`](src/renderer/page-executor.ts).
5. Antes de executar, o **freio de segurança** ([`risk.ts`](src/renderer/risk.ts)) trava ações
   de pagar / comprar / excluir / cartão e pede confirmação.

> Determinístico-primeiro é a filosofia: pedidos comuns (abrir vídeo, baixar, gerar imagem,
> comparar preço, notícias) são tratados no `detectQuickAction` com **zero tokens de IA**; o
> modelo só é chamado quando precisa raciocinar de verdade.

### Cursor do agente (o que a pessoa vê)

O `components/AgentVisualOverlay.tsx` desenha por cima da página um cursor do agente que desliza num
arco (`src/shared/agent-cursor-path.ts`, ~450 ms, ease-in-out; com "reduzir movimento" pula direto)
da última posição até cada clique, e a ondinha aparece onde ele para. O overlay é
`position:absolute; inset:0` sobre a área da página, então as posições contam do canto do próprio
overlay; somar o deslocamento da página na janela inteira (como antes) desenhava cursor e ondinha
uns 100 px abaixo do clique real. `tests/e2e/agent-cursor.spec.ts` compara o cursor e a ondinha
desenhados com o clique que a página recebeu. Ele conduz o loop real do agente com `E2E_MOCK_SCRIPT`
(lista JSON de ações que o modelo simulado devolve, uma por passo; só pra teste, exige `E2E_MOCK_AI=1`).

### Eventos de mouse reais seguem o arco desenhado (o que a página vê)

O `input:click` no `main.ts` manda eventos `mouseMove` reais (`webContents.sendInputEvent`) ao longo
do `arcPath()` de `src/shared/agent-cursor-path.ts` — o mesmo arco, lado, easing e ~450 ms do cursor
desenhado — de onde o ponteiro parou depois do último clique naquela aba (`lastPointer`) até o alvo;
aí mede o alvo de novo e clica no centro, sem desvio aleatório. Antes a página recebia uma
aproximação curta e reta com tremor aleatório enquanto o overlay desenhava outra coisa. Isso não
tenta se passar por pessoa: um gravador de sessão (HotJar e afins) mostra os mesmos arcos suaves
toda vez, reconhecíveis como o agente do Bah. O e2e do cursor confere que a página recebeu 10+
movimentos que terminam no clique e se afastam da reta.

---

## `src/main/` — processo privilegiado

| Arquivo | Responsabilidade |
|---|---|
| `main.ts` | Bootstrap do app, janela, sessão do `<webview>`, **todos os handlers IPC**, input real (`sendInputEvent`), adblock, downloads, safe-browsing, toggle de aceleração |
| `ai-engine.ts` | Toda chamada de IA nuvem/local (DeepSeek / Mistral / NVIDIA NIM / Ollama) + o system prompt e a lista de ferramentas |
| `site-locale.ts` | **Fonte única** do idioma que os sites recebem (Accept-Language / navigator.languages / --lang seguem a escolha da UI) |
| `chrome-identity.ts` | **Fonte única** da identidade de navegador que os sites veem: User-Agent, client hints `sec-ch-ua`, `navigator.userAgentData`, ordem dos headers (aplicada pelo `main.ts` via CDP) |
| `page-agent.ts` | Helpers de raciocínio do agente (lado nuvem) |
| `download-manager.ts` | Gerenciador de download nativo: pausar/continuar/cancelar/fila/ETA, `open-file` guardado |
| `media-downloader.ts` | Wrapper de `yt-dlp` / `ffmpeg` (baixar vídeo/áudio) |
| `video-cuts.ts`, `transcript.ts` | Recursos de vídeo locais (localizar onde uma frase é dita, transcrições) — ffmpeg nativo |
| `image-harvester.ts` | Colheita de imagens em massa + geração de imagem por IA (Pollinations), com limites |
| `ocr-engine.ts`, `page-capture.ts` | OCR no aparelho (Tesseract) + screenshots |
| `data-view.ts` | Renderiza tabelas/gráficos numa página local (sem CDN) |
| `validate.ts` | Helpers de segurança de caminho (`isInsideAllowedRoot` etc.) |
| `popup-shield.ts`, `overlay-script.ts` | Tratamento e dispensa de popups/overlays |
| `js-dialogs.ts` (+ `src/renderer/js-dialogs.ts`, `components/JsDialogHost.tsx`) | `alert`/`confirm` das páginas: troca a caixa nativa do Electron (que trava a página; evento interno `-run-dialog`) pela caixa do Bah pra pessoa, e pela política do agente nas abas dele (`dialog` armado > alert fecha > confirm comum aceito > confirm de pagamento/exclusão pergunta à pessoa); `beforeunload` nas abas do agente sai quando ele navega. `prompt()` não existe no Electron (lança erro) |
| `job-queue.ts` | Serializa tarefas longas |
| `frames.ts` (+ `src/shared/frames.ts`) | Conteúdo de iframes pro agente (formulário de vaga/pagamento/reserva embutido): árvores de acessibilidade dos frames do mesmo processo (por `frameId`) e dos cross-origin (sessões CDP achatadas via `Target.setAutoAttach`), coordenadas na viewport da página; elementos aparecem com `frame="host"`. Preencher grava no nó dentro do frame (sem depender de foco); clique em frame cross-origin usa CDP `Input` na sessão do frame (`sendInputEvent` para no `<iframe>`). Frames `chrome-extension://` injetados por extensões ficam de fora |
| `upload.ts` | `upload` do agente (diálogo do SO → token; campo por nó/label/posição, ou o seletor do SO interceptado com `Page.setInterceptFileChooserDialog` durante a ação; `DOM.setFileInputFiles`) e pastas liberadas na sessão pra `list_files` / `read_file` / `upload { file }` (conferidas por realpath) |

### Identidade do navegador (o que os sites veem)

Os sites marcavam o Bah como robô com frequência suficiente pra tarefas do agente falharem; parte
do motivo era uma identidade que se contradizia. Agora o Bah se apresenta como o que ele é — um
navegador atual baseado no Chrome, no computador da própria pessoa — com todos os sinais batendo.
Nada aqui resolve CAPTCHA nem contorna bloqueio.

- **Uma fonte.** `chrome-identity.ts` monta o User-Agent, os headers `sec-ch-ua` e os valores de
  `navigator.userAgentData` dos mesmos dados. O `main.ts` aplica tudo **dentro do motor** com o CDP
  `Emulation.setUserAgentOverride` quando a aba nasce (e de novo se o debugger reconectar), junto com
  os idiomas do `site-locale.ts`. A página lê os valores finais desde o primeiro script; nada é
  remendado em JavaScript depois. Antes, o header dizia uma versão e ordem de brands do Chrome e o
  script da página dizia outra, e a página conseguia ler o valor real antes do remendo — o tipo de
  contradição que os detectores procuram.
- **Versão.** `CURRENT_CHROME_MAJOR` (subir quando o Chrome estável avançar, ~a cada 4 semanas) no
  formato reduzido `NNN.0.0.0` que o Chrome de verdade manda; o Chromium do Electron costuma ficar
  algumas versões atrás. Se o motor for mais novo, vale a versão dele.
- **SO e arquitetura reais.** O token de plataforma do UA e o `sec-ch-ua-platform` seguem o SO real
  (antes dizia Windows em todo lugar, e site de driver/instalador oferecia arquivo de Windows no Mac);
  `getHighEntropyValues()` informa a arquitetura real da CPU.
- **Headers na ordem do Chrome;** brand hints só em https e localhost, como o Chrome.
  `sec-ch-ua-arch`/`bitness` não vão em toda requisição (o Chrome só manda quando o site pede).
- **`navigator.webdriver` fica com o motor.** Uma execução normal diz `false`, igual ao Chrome. O
  remendo antigo trocava por `undefined`, valor que nenhum Chrome real tem. Execuções controladas pelo
  Playwright (testes e2e, gravação de demo) dizem `true` — avalie a taxa de checagens anti-robô numa
  execução normal.
- **GPU, núcleos e memória reais.** O script da página dizia "Intel Iris 6100", 8 núcleos e 8 GB em
  toda máquina, enquanto os workers da própria página viam os valores reais. Agora nada é sobrescrito
  (`tests/e2e/hardware-identity.spec.ts`).
- **Diagnóstico:** `BAH_DEBUG_IDENTITY=1` registra no `agent.log` o que cada página vê (webdriver, UA,
  brands, idiomas). `tests/e2e/browser-identity.spec.ts` confere que header e JavaScript batem.
- **Limite conhecido:** a versão completa é `NNN.0.0.0`, não um build real, e o motor pode estar
  algumas versões atrás do Chrome que declara; um detector pode notar recursos novos ausentes.

---

## `src/renderer/` — UI + loop do agente

| Arquivo | Responsabilidade |
|---|---|
| `App.tsx` | App de topo; **o loop ReAct vivo do agente** (`onExecute`) |
| `components/AgentCommandBar.tsx` | A caixa de comando unificada, o feed de atividade e as configurações |
| `components/` | `AddressBar`, `TabBar`, `WebViewContainer`, `AgentVisualOverlay` |
| `site-knowledge.ts` | Atalhos determinísticos 0-token (`detectQuickAction`) |
| `page-executor.ts` | Executa as ações do navegador dentro da página |
| `risk.ts` | O classificador do freio de segurança (`riskForAction`) |
| `agent-recovery.ts`, `agent-login-policy.ts` | Recuperação de estado travado + detecção de login/captcha |
| `agent-permissions.ts` | O que o agente pode usar além das abas da própria tarefa — suas outras abas e seu histórico: Perguntar (padrão) / Sempre / Nunca |
| `shared/html-clean.ts` | `get_html`: o passeio no DOM dentro da página (`collectHtmlScript`, via `executeJavaScript`, então recua pro mundo isolado em página sem script) e o limpador/serializador puro (`serializeHtml`): lista de atributos permitidos, valores secretos removidos, corpo de script/style/svg fora, URLs `data:` encurtadas, refs `[#N]` da lista de elementos (carimbadas por `cdp:mark-refs` em `main/frames.ts` num atributo com nonce, apagado depois da leitura), marca `[hidden]`; paginado por `offset` em fronteira de tag (`serializeHtml` → `shared/read-paging.ts`). O HTML vai só no próximo pedido, marcado como dado da página, não instrução |
| `shared/read-paging.ts` | Quanto uma leitura de `get_html` / `extract_text` devolve e a paginação do resto. `readBudget`: clamp(tokens livres do contexto × 0,4 × 3,5 caracteres/token, 4.000, 60.000), livres = janela − último pedido (`prompt_tokens` da resposta anterior) − 4.096 de reserva pra resposta; padrão 6.000 em janela abaixo de 64k, 12.000 acima; `max` vai até o orçamento, e um pedido acima é servido no orçamento, dizendo isso. `pageHtml` / `pageText`: partes em fronteira de tag / linha que se encaixam sem buraco nem sobreposição, cada uma com "chars A–B of N" e terminando com a próxima chamada exata. Os blocos de um passo PAGE HTML / PAGE TEXT (extracted) (com marcador de fim; a fatia fixa da observação na nuvem cresce do tamanho deles) e os normalizadores das ações |
| `agent-run-logger.ts` | Log de corridas opt-in (coletor de dados de treino, local) |
| `store.ts` | Estado da UI/configurações (localStorage) |
| `i18n.ts` | i18n na mão en / pt / es; **inglês é o padrão** |
| `macros.ts` | Gravar/repetir macros determinísticas |
| `pacing.ts` | Ritmo por site entre ações do agente (aleatório 1–5 s; 15–30 s por 30 min depois de uma checagem anti-robô) |
| `search-engines.ts` | Ordem dos buscadores da pesquisa rápida e do `web_search` do agente, e quais estão bloqueados agora |
| `known-sites.ts` | Lista curada nome do site → endereço oficial (sem domínio chutado) |
| `stores.ts` | "O pedido citou um lugar pra comprar?" (`namesStore`), pelo formato do pedido, sem lista de lojas |
| `command-history.ts` | ↑/↓ na caixa de comando trazem os comandos anteriores |

### Buscadores, roteamento de pedidos e sites nomeados

**Buscadores.** A pesquisa rápida e a ação `web_search` do agente abrem a busca numa aba oculta e leem
os resultados (título, endereço, trecho). `search-engines.ts` dá a ordem: Google → Bing → DuckDuckGo →
Yahoo → Perplexity, ou primeiro o escolhido em ⋮ → 🔎 "Buscador da IA". Buscador que mostra página de
bloqueio ("tráfego incomum", captcha, "verify you are human"…) fica de fora por uma hora; isso é
notado tanto na busca oculta quanto quando o próprio agente cai numa página dessas. O prompt do agente
ganha a linha `SEARCH ENGINE:` com a ordem atual. Links de redirecionamento do DuckDuckGo, do Yahoo e do
Bing viram o endereço real do site. A barra de endereço continua com o mecanismo dela (⋮ → Mecanismo de
pesquisa); a escolha da IA fica numa chave própria (`agentSearchEngine`) e, sem escolha, segue o
mecanismo da barra quando o agente conhece ele. `web_search` é permitido em sites cuidadosos
(`CAREFUL_ALLOWED`).

**Roteamento.** Antes das regras de palavras mandarem a mensagem pra resposta da web, o
`AgentCommandBar.tsx` manda estes pro agente: downloads (com os erros de digitação comuns), reservas com
data (hotel, voo, carro…), lugar de compra citado mais verbo de compra (`namesStore`: "… at/on/from
<nome>" ou um domínio, fora horários e "from the movie …") e busca de peça ("compatible charger for
<modelo>"). O atalho do Google Shopping cede quando uma loja é citada; os atalhos de Amazon e Wikipedia
seguem o locale do sistema em vez do Brasil.

**Site nomeado vai direto pro endereço oficial.** `src/renderer/known-sites.ts` é uma lista curta,
conferida à mão, de sites conhecidos (LinkedIn, Indeed, GitHub, a Amazon do seu país, Walmart, Whole
Foods, YouTube, Gmail, Google…) → endereço oficial. Quando o pedido cita um deles ("browse to linkedin,
find a job…"), o primeiro prompt do agente ganha a linha `NAMED SITE:` com o endereço e a regra "navegue,
não faça web_search do nome"; todo prompt traz a lista em `OFFICIAL SITES`; com IA local o atalho abre
direto (`getInitialShortcutAction`). Nome que também é palavra comum ("indeed", "target") só conta depois
de "go to / on / at / abra…". Nome fora da lista nunca vira domínio chutado (golpe de domínio parecido):
continua indo pro `web_search`. Testes: `tests/unit/known-sites.test.ts`,
`tests/unit/named-site-shortcut.test.ts`, `tests/e2e/named-site.spec.ts`.

**Continuações e a última tarefa.** Antes das regras de palavras (e antes do classificador, quando o
roteador local não está pronto):
- **pergunta sobre a última tarefa** ("você clicou?", "o que aconteceu?") → chat com o registro dela
  (`src/renderer/last-run.ts` `lastRunDigest`), nunca busca na web;
- **relato de que a última tarefa ficou pela metade** ("abriu uma janela, mas não a segunda") → volta pro
  agente (`reportsIncompleteRun`), que recebe os pedidos anteriores e como terminaram;
- mensagem que **começa com verbo de ação** ("procure…", "pesquise…", "abra…") → agente
  (`src/renderer/route-words.ts`); perguntas continuam indo pra resposta da web.
Cada tarefa terminada guarda a última coisa em que agiu, e o prompt diz que "isso / essa" é ela.
"N <qualquer coisa> … cada / diferente" abre N vídeos mesmo com erro de digitação (`site-knowledge.ts`,
testado empacotando em `tests/unit/quick-video.test.ts`). As respostas da web tiram páginas de buscador
das fontes e nunca mostram `[[ACTION: …]]` cru; ação sugerida "none" não vira botão.

**"Resuma minhas abas abertas".** `wantsTabsSummary` (`src/renderer/tabs-summary.ts`) transforma o
pedido na ação `summarize_tabs`, mesmo com a IA no comando (senão o modelo visitaria aba por aba com
`switch_tab`). O executor no `App.tsx` escolhe as abas (`selectTabsForSummary`: sem abas anônimas, sem
páginas internas como `about:`, `file:` ou o player do Bah; aba dormindo aparece como dormindo e só é
acordada se a pessoa pedir, ex.: "inclusive as dormindo"), confere a permissão **suas abas** uma vez pro
conjunto (`tabsAccessDecision`: perguntar / sempre / nunca do menu; a aba da própria tarefa não precisa),
lê o texto de cada aba com `<webview>.executeJavaScript` e faz uma chamada sem histórico ao modelo pra uma
linha por aba e um resumo geral. Aba cuja página bloqueia script aparece como "não deu pra ler". O painel
mostra um cartão com um link por aba que troca pra ela. Testes: `tests/unit/tabs-summary.test.ts`,
`tests/e2e/tabs-summary.spec.ts`.

**Arquivos de texto puro no tema escuro.** O visualizador de texto do Chromium clareia o texto no tema
escuro, mas site que manda `Content-Security-Policy: default-src 'none'; sandbox` (Hugging Face, GitHub
raw) não ganha o fundo escuro → branco no branco. O `main.ts` insere uma folha de usuário
(`PLAIN_TEXT_VIEWER_CSS`, que só casa com o `<meta>` + `<pre>` do visualizador) e fundo e texto seguem o
mesmo esquema (`tests/e2e/plain-text-dark.spec.ts`).

### Roteador local (Qwen2.5-1.5B, opcional)

Com o modelo de roteamento baixado, um LLM pequeno local rotula **toda** mensagem antes de qualquer
coisa chegar no modelo grande — no modo nuvem *e* no local — e as regras de palavras acima viram reserva.
- **Modelo:** `Qwen/Qwen2.5-1.5B-Instruct-GGUF` `q4_k_m` (Apache-2.0, 1.117.320.736 bytes, sha256
  `6a1a2eb6…9407e`) em `<userData>/models/`. Nunca vem no instalador: as configurações do assistente
  mostram um card ("Baixar o modelo de roteamento de 1,1 GB?"); o `router:download` só roda depois
  desse clique, retoma o `.part` com `Range` e confere tamanho + sha256 antes de renomear
  (`src/main/router/model-download.ts`).
- **Motor:** `src/main/router/engine.mjs` (bundle esbuild, `node-llama-cpp` externo) num
  `utilityProcess`, que sobe 3 s depois que a janela aparece, só se o arquivo existir. `gpu: 'auto'`
  (Metal / Vulkan / CPU; GPU integrada no Vulkan fica na CPU: `isIntegratedGpu`, Vulkan com toda a
  memória compartilhada com a RAM); se não carregar, tenta uma vez só CPU, e então `router:status` =
  `error` e as regras de palavras decidem. Se cair, morre só esse processo. No Windows/Linux o
  node-llama-cpp testa o binário nativo num processo filho; de dentro de um utilityProcess esse fork
  abriria outro Bah (fuse `RunAsNode` desligado), então o motor repassa o fork pro `router-manager.ts`,
  que abre o arquivo de teste como outro utilityProcess.
- **Prompt** (`src/shared/router-routes.ts`, ideia do Arch-Router, nada dos pesos nem do texto): rotas
  `{name, description}` com nomes descritivos que o modelo escreve (`browser_task`, `about_this_page`,
  `web_question`, `greeting_or_chat`, `explain_last_task`, `redo_last_task`, `other`), regras e alguns
  exemplos. Esse system é o prefixo fixo, avaliado uma vez; por mensagem só
  `Open page / Last task / Message` é processado. A saída é presa por gramática (JSON schema) a
  `{"route": "<uma key>"}`. LAST_RUN x FIX depois é decidido pela forma da frase (pergunta → LAST_RUN,
  afirmação → FIX). O roteador só rotula texto; nunca age, e o texto nunca sai do computador.
- **Mapeamento** (`classifyIntent` → `routeCommand`): ACTION → agente, PAGE/CHAT → chat (com a página),
  WEB → resposta da web, LAST_RUN → chat com o registro da última tarefa, FIX → agente; `other` /
  demora (5 s) → o caminho de antes. A caixa manda a última tarefa como `Last task` (`lastRunSummary`: o
  pedido e como terminou, uma linha cada). Com o roteador pronto, a caixa deixa de lado as próprias regras
  de "última tarefa" e de "pergunta que aponta pra tela" (LAST_RUN/FIX/PAGE do roteador cobrem); se o
  roteador não responde, o `classifyIntent` aplica as duas regras da última tarefa. Continuam antes do
  roteador: saudação curta, o "IA dirige", repetir/macro, a dica de pedido vago e os atalhos de 0 token.
- **Eval:** `npm run router:eval` roda o mesmo núcleo (`router-core.mjs`) em node puro sobre
  `tests/fixtures/routing-cases.json` (82 casos en/pt/es, alguns com última tarefa) e pontua as regras
  de palavras no mesmo conjunto. Num Intel i7-9750H (CPU): roteador 89,0 % (90,2 % com a saudação antes)
  x regras 84,1 %, p50 ≈ 0,6–0,9 s, p95 ≈ 1,0–1,4 s, carga ≈ 9 s, ≈ 0,9 GB de RSS no Node (≈ 2 GB no
  utilityProcess, com o arquivo mapeado em memória). Smoke: `tests/e2e/router-local.spec.ts` (pula sem
  o modelo; `BAH_ROUTER_MODEL` aponta pro arquivo).
- **Expansão do pedido** (`src/shared/request-expansion.ts`, IPC `router:expand`): antes do agente
  começar, um pedido de "achar/baixar" sobre uma obra nomeada (`shouldExpandRequest`: verbo de
  achar/baixar + mídia + uma obra depois de from/of/do/de…; nunca URL nem ordem comum) é reescrito pelo
  mesmo modelo num segundo contexto pequeno (1024 tokens, gramática própria `{"understood": "…"}`,
  ≤ 96 tokens, temperatura 0). O prompt só deixa acrescentar desambiguação (ano, intérprete, original x
  sequência/remake, nome completo) e proíbe lista de faixas, passo novo, compositor/diretor. O main
  confere a saída (`checkExpansion`): lixo/recusa, > 320 caracteres, sem as palavras-chave do pedido
  (sinônimos movie↔film, plural e erro de uma letra tolerados), ação nova (comprar/mandar/tocar/abrir…),
  número novo que não seja ano, nome próprio que a pessoa não escreveu (fora depois de "not …") ou site
  novo → descarta. Timeout 3,5 s (renderer 4 s); sem modelo, lento ou descartado → o texto original. O
  aceito aparece no feed como "🔎 Entendido como: …" e vai pro agente numa linha
  `UNDERSTOOD AS (… a GUESS … the GOAL wins …)` embaixo do `GOAL:` (fica quando o histórico é cortado,
  sai quando a pessoa edita o pedido). Os fatos do 1,5B erram com frequência (disse "Bad by The
  Beatles"), por isso o "palpite". Eval: `npm run router:expand-eval` imprime a saída crua e o veredito
  por pedido. E2E sem modelo: `E2E_FAKE_ROUTER_EXPAND` (com `E2E_MOCK_AI=1`) finge a resposta do modelo.
- **Empacotamento:** `@node-llama-cpp/*` (e o `bins/` do node-llama-cpp) vão pro `asarUnpack`; o JS do
  node-llama-cpp e o motor ficam no asar, onde as ~120 dependências dele resolvem. Ficam de fora os
  pacotes CUDA, o código-fonte do llama.cpp e os templates do CLI.

### Ritmo por site

`pacing.ts`, usado pelo loop do agente no `App.tsx`. Antes de cada ação que mexe na página (navegar,
cliques, preencher/digitar, tecla, rolar), o agente espera até o próximo horário permitido pra aquele
host; depois da ação o próximo intervalo é sorteado entre **1 e 5 s**, então nenhuma sequência sai
com ritmo regular (um clique certinho a cada 2–4 s foi o que fez sites de compra tratarem o agente
como robô). Quando uma página observada parece checagem anti-robô (`BOT_CHECK_RE`: "robot check",
"unusual traffic", "verify you are human", "just a moment", captcha…), aquele host passa a ter
intervalos de **15–30 s** por **30 minutos**, e o prompt avisa o modelo pra fazer só o necessário ali
e preferir outra fonte. Outros hosts e ações internas (extrair, guardar, relatar…) não esperam; o
Parar continua cancelando durante a espera. O ritmo só deixa o agente mais lento; não resolve nem
pula a checagem.

---

## Sessões do agente (chip na aba + conversa dividida)

Uma **sessão** é a linha de trabalho que o assistente acompanha: uma aba, ou um grupo de abas que dividem
a mesma conversa. A aba ganha sessão na 1ª vez que o assistente é usado nela (`ensureSession`): nome tirado
do pedido ("Job hunt", "Groceries", "Trip"…), cor que não está em uso. Na barra aparece como grupo de abas
do Chrome — chip colorido com o nome antes das abas da sessão e a mesma cor sublinhando cada uma; o painel
mostra o mesmo chip (clique renomeia). Abas que o agente abre na tarefa e links abertos em aba nova a partir
de uma aba da sessão entram nela; o menu do botão direito da aba adiciona a outra sessão, cria uma nova ou
tira dela; arrastar a aba pra entre duas abas de uma sessão entra, pra longe sai.
A conversa é chaveada pela **chave da thread** = id da sessão (ou da aba, sem sessão): o feed do painel
(`feedsByTab`) e a **thread** da sessão. Mudou a chave da aba → a conversa vai junto (`bah:move-thread`).
Regras: `src/shared/agent-sessions.ts` (testes em `tests/unit/agent-sessions.test.ts`); estado: `store.ts`;
UI: `TabBar.tsx`, `AgentCommandBar.tsx`; ponta a ponta: `tests/e2e/agent-sessions.spec.ts`.

**Uma thread por sessão.** `src/renderer/threads.ts` guarda uma thread por chave (regras em
`src/shared/thread-store.ts`): **turnos** (o que você pediu, o que o chat respondeu — os recentes palavra
por palavra, com teto), **resumos das tarefas do agente** (objetivo, últimos passos-chave, desfecho, o
último alvo — não cada passo; gravados pelo `finishRun` do `App.tsx`) e **fatos** (logado ou não em cada
site) mais os 📌 **fixados**, que nunca viram resumo. O prompt do agente ("PREVIOUS
REQUESTS THIS SESSION") e o chat leem o mesmo bloco (`promptBlock`); o chat o manda pro `ai:chat` e o
`ai-engine.ts` deixa de usar o próprio histórico por aba (lá só fica o arquivo anexado, `lastDocs`). A
thread tem um **orçamento fixo de tokens por prompt** — ~15% da janela do modelo, de 512 a 4096; 3000 com
janela desconhecida — e a página atual nunca perde espaço pra ela. Nos 80% o feed avisa e oferece 📌;
passou, os itens mais velhos viram um resumo corrido e o feed diz "🗜 N itens antigos resumidos", que abre
o texto exato que ficou no lugar; `/compact` e o 🗑 fazem o mesmo, à vista. Quando a observação precisa
ser cortada pra caber, corta-se a página (nunca a thread) e o feed mostra "✂️ página cortada".
**Medidor de contexto** (`components/ContextMeter.tsx`, conta em `src/shared/context-meter.ts`): ao lado
do nome do modelo, `contexto 6.1k / 16k · conversa 2.3k`; a barra fica âmbar/vermelha dizendo quem ocupa a
janela; um toque mostra o detalhe da última chamada (instruções, skills, conversa, página). Janela pela
detecção do engine (`ai:context-window` → `resolveContextBudget`: `/props` no llama.cpp ou o tamanho
configurado; desconhecida na nuvem); total pelo `prompt_tokens` do provedor quando vem, senão estimativa
(marcada com `~`). Gancho de teste: `window.__bahThreadBudget`; `E2E_CONTEXT_WINDOW` finge a janela com
`E2E_MOCK_AI`.

**Restaurar + histórico de conversas.** `src/main/chat-store.ts` guarda dois arquivos cifrados com
`safeStorage` (regras em `src/shared/chat-history.ts`): as threads **vivas** + nome/cor das sessões
(`threads-live.enc`, gravado até 1,5 s depois de mudar e ao fechar a janela, antes do "gravei" da sessão
de abas) e o **🕘 histórico de conversas** (`chat-history.enc`: uma entrada por sessão com nome, cor,
datas, sites, 1º pedido, as abas e a thread; atualizado conforme você usa, como o histórico de
navegação). Com ⋮ → Ao abrir o Bah = "Continuar de onde parou" as abas voltam com o mesmo id e
`sessionId` (o `session.v1` guarda `id`/`sid`) e a thread se prende de novo (`store.ts` `bootTabs`,
carregada síncrona por `threads:load-live-sync`); com a outra escolha o arquivo vivo é apagado ao abrir.
⋮ → 🕘 Histórico de conversas (`components/ChatHistoryPanel.tsx`) abre uma sessão passada só pra ler ou a
**Retoma** (`store.resumeSession`, reabrindo as abas dela se quiser). "Limpar dados de navegação" ganhou
a caixa "histórico de conversas" (mesmo período). Aba anônima nunca chega a nenhum dos dois. Testes:
`tests/unit/thread-store.test.ts`, `chat-history.test.ts`, `context-meter.test.ts`,
`session-restore.test.ts`; ponta a ponta `tests/e2e/sessions-thread.spec.ts`.

## Skills de navegação (`skills/*/SKILL.md`)

Receitas curtas e testadas que o agente recebe **só quando se aplicam**, em vez de um system prompt que
só cresce (modelo local pequeno segue muito melhor um prompt curto e relevante). Formato compatível com
o `SKILL.md` do Browse.sh / agent-browser: front matter + corpo em markdown (≤ 220 palavras).
Campos: `name` (= nome da pasta), `description`, `states`, `tasks`, `sites` (hosts; subdomínio casa),
`priority`. A skill entra quando **todas** as listas que ela declara casam; no máximo 3 por passo, mais
específicas primeiro (site > tarefa > estado da página), numa seção `SKILLS FOR THIS PAGE` no estado da
página, com uma linha `TODAY` (data ISO e o próximo fim de semana) pro modelo pequeno acertar as datas.

Estados detectados a cada passo (`App.tsx`): `dialog` (modal visível), `suggestions` (lista de
autocomplete), `datepicker` (calendário / `input[type=date]` / `role=grid`), `eula` (controles falam de
EULA/licença/termos), `os-selector` (página oferece Windows **e** macOS/Linux), `searchbox` (campo de
busca/destino), `tabs` (abas), `cards` (lista de cartões), `signin` (campo de senha, página de login ou
aviso "entre para ver…"). Tipos de tarefa: `download`, `search`, `travel`, `shopping`, `parts`, `people`.
Estado da **conta por site** (entrou / não entrou — lido da página a cada passo e lembrado por site na
sessão, `agent-login-policy.ts`) vai no prompt numa linha `ACCOUNT:`.
Código: `src/shared/skills.ts` (parse + escolha, testado em `tests/unit/skills.test.ts`),
`src/main/skills-loader.ts` (leitura + IPC `skills:list` / `skills:save` / `skills:open-folder`; relê os
arquivos a cada tarefa; empacotado via `files` do `electron-builder.yml`).
Skills incluídas — **regras gerais, não receitas de sites específicos** (receita de site fica pras
skills do usuário/contribuídas): `popup-dismiss`, `autocomplete-pick`, `date-picker`, `site-search`, `page-tabs`,
`download-chain`, `eula-accept`, `os-selector`, `product-specs`, `compatible-part`, `shopping-compare`,
`used-listings`, `travel-search`, `people-search`, `card-list`, `sign-in`.
Skills do usuário ficam em `<userData>/skills/` (menu → 🧩 Minhas skills); depois de uma tarefa que deu
certo (3+ passos, e a mensagem final não diz que falhou) o Bah oferece rascunhar uma ("Salvar como skill" →
revisão → Salvar → proposta opcional no GitHub). Ver [CONTRIBUTING-SKILLS.md](CONTRIBUTING-SKILLS.md).

---

## Build e release

- **Build:** Renderer = Vite + typecheck `tsc`; Main = `tsc`. Um gate de paridade de i18n
  (`scripts/i18n-check.mjs`) **falha o build** se en/pt/es saírem de sincronia.
- **Empacotar:** electron-builder (instalador NSIS). [`build/afterPack.js`](build/afterPack.js)
  flipa um conjunto conservador de Electron Fuses no binário.
- **Auto-update:** o electron-updater puxa as releases do GitHub ao abrir (o app instalado
  puxa; nada é empurrado pra ele).

## Removido / vestigial

- `AISidebar.tsx` e `VideoEditorPanel.tsx` foram removidos (não eram importados). A UI viva do
  assistente é a `AgentCommandBar`.
- O editor de vídeo local (`video-editor.ts`: aparar / remover silêncio / extrair áudio) e o
  `supercut.ts` (baixar trechos) foram removidos — ninguém os acionava. Achar onde uma frase é
  dita continua via `open_video_cuts` (abre cada vídeo pausado no segundo exato).
