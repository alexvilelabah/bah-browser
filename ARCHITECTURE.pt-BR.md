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
| `agent-download-worker.ts`, `download-progress.ts` | A ação `download` do agente: uma worker de `worker_threads` por download; política de cadência do progresso + travamento. Ver [Downloads e torrents](#downloads-e-torrents) |
| `torrent-manager.ts`, `torrent/engine.mjs` | Cliente de torrent embutido **opcional** (desligado por padrão): ponte IPC + o motor, isolado num `utilityProcess` que só sobe quando usado. Ver [Downloads e torrents](#downloads-e-torrents) |
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

### Downloads e torrents

Todo download é gravado no disco conforme chega (nunca bufferizado na RAM), **sem teto de
tamanho e sem lista de tipos bloqueados**, e cai na pasta Downloads (ou na escolhida em
Downloads → ⚙).

| Caminho | Entrada | Grava no disco via |
|---|---|---|
| Download de link / página (clique, barra) | `will-download` do Electron → [`download-manager.ts`](src/main/download-manager.ts) | Motor multi-conexão ou o downloader do próprio Chromium (ambos em stream) |
| Ação `download` do agente | IPC `download:url` no `main.ts` (renderer: `electronAPI.downloadUrl`) → uma **worker thread** ([`agent-download-worker.ts`](src/main/agent-download-worker.ts)) | `fs.createWriteStream` no arquivo final |
| Vídeo / áudio | `yt-dlp` + `ffmpeg` ([`media-downloader.ts`](src/main/media-downloader.ts)) | as próprias ferramentas |
| Arquivos de dentro de um torrent (embutido LIGADO) | `torrent:save-file` → [`torrent/engine.mjs`](src/main/torrent/engine.mjs) | `fs.createWriteStream` |

#### Downloads de link / página (`download-manager.ts`)

1. Dispara o `will-download`; um `.torrent` vai pro card se o cliente embutido estiver LIGADO (ver abaixo).
2. O caminho é escolhido na hora (`uniqueDownloadPath` — nunca sobrescreve, põe ` (1)`, ` (2)`...),
   então não aparece o "Salvar como" nativo.
3. A URL é sondada (URL final após redirecionamentos, com UA/Referer/cookies da aba; redirecionamento pra
   outro host é recusado pra não vazar cookie). Se o servidor aceita ranges, o arquivo tem **≥ 2 MB** e não é
   HTML, o motor multi-conexão ([`multi-download.ts`](src/main/multi-download.ts)) assume: até 8 conexões por
   padrão (1–32, Downloads → ⚙), gravando os segmentos num `<arquivo>.bahpart` com escrita posicional,
   renomeado pro nome final ao terminar. Senão o Chromium baixa normalmente.
4. Se o motor nem consegue começar, o download volta pro Chromium na mesma linha da lista.
5. Pausar / continuar / cancelar / fila (máx. 5 simultâneos) e velocidade/ETA ao vivo vão pro painel de
   Downloads (Ctrl+J). `.bahpart` que sobrou de crash ou fechamento é apagado no boot e ao trocar a pasta.

#### Ação `download` do agente — em background, numa worker thread

O download roda **fora do event loop do processo main**, numa worker de `worker_threads` criada por
download a partir de [`agent-download-worker.ts`](src/main/agent-download-worker.ts) (desempacotada do
asar, ver `asarUnpack`). O `main.ts` só sobe a worker e repassa as mensagens dela.

1. Só URLs `http(s)`. Vai com cabeçalhos de navegador (UA do Chrome, `Accept-Language`, `Referer` = origem
   da URL). Retentativa com TLS leniente em cadeia de certificado quebrada; uma retentativa após 2,5 s em HTTP 429/403.
2. Nome do arquivo: o argumento `filename`, senão o último segmento da URL, senão `download`; a extensão
   é deduzida do `Content-Type` se faltar (`.bin` em último caso). Nunca sobrescreve (` (1)`, ` (2)`...).
3. **Volta assim que o download começa** (cabeçalhos recebidos, arquivo criado) com
   `{ id, path, totalBytes, background: true }` — o agente já sabe o caminho final e segue trabalhando.
   Erro HTTP antes do início volta como ação com falha normal.
4. O corpo é **sempre lido em stream** (`ReadableStream` da web passa por `Readable.fromWeb`) e gravado
   pedaço a pedaço com back-pressure (`drain`). Memória estável seja qual for o tamanho.
5. **Sem teto de tamanho e sem limite de tempo total** — ver travamentos abaixo. Em erro, cancelamento ou
   corpo vazio o arquivo parcial é apagado.
6. Tudo depois do início chega como `agent:download-event` (`kind: 'agent'`) — o mesmo canal dos outros
   downloads, então o painel de Downloads mostra uma linha ao vivo (✕ cancela via `download:cancel` →
   `cancelExternal`; sem pausa).

**Cadência do progresso** ([`download-progress.ts`](src/main/download-progress.ts), `ProgressTracker`): a
worker dá um tick a cada **1 s** (é o que o painel mostra). A velocidade é suavizada em ~5 s e o
ETA = restante ÷ velocidade é recalculado a cada tick, então a cadência se adapta quando a velocidade muda.
Só os ticks com `notify: true` entram na história do agente:

| ETA | O agente recebe uma linha `DOWNLOAD PROGRESS` a cada |
|---|---|
| ≤ 2 min | 1 s |
| 2–10 min | 5 s |
| > 10 min | 15 s |
| desconhecido (sem `Content-Length`, ou ainda sem velocidade) | 5 s |

Início, fim, falha, cancelamento e mudanças de travamento vão sempre na hora.

**Travamentos** são detectados no código, não pela IA (uma chamada de modelo por checagem seria lenta e
cara, e "nenhum byte há N segundos" é uma medida exata). A IA só decide o próximo passo.

| Sem dado por | O que acontece | O agente vê |
|---|---|---|
| 15 s | linha marcada **Travado** (uma vez; sem repetir enquanto travado); some se o dado voltar | `DOWNLOAD STALLED: … at X of Y` |
| 60 s | download abortado, arquivo parcial apagado | `DOWNLOAD FAILED (stalled): … Retry once, or try another mirror/source.` |

**Avisar a IA que terminou:** a linha de fim traz o **caminho local completo** —
`DOWNLOAD COMPLETED: <nome> (<tamanho>) saved at <caminho> — the file is ready to use at that path`. As
linhas de download entram na história do agente depois de cada passo. Se um download em background termina
**depois que a tarefa acabou**, o evento de fim/falha é guardado e entregue no começo da **próxima** tarefa
do agente (os outros eventos velhos são descartados nessa hora). O system prompt (`ai-engine.ts`) manda o
agente nunca dizer que baixou antes do `COMPLETED`.

**Ferramentas de download pro agente** (`App.tsx`, loop do agente; parse/validação em `page-agent.ts`):
`list_downloads` devolve a fila do painel de Downloads (ativos primeiro: `[id]`, estado, %, tamanho,
velocidade, ETA, caminho, quem começou — agente/usuário). `cancel_download` / `pause_download` /
`resume_download` / `retry_download` recebem esse id **ou o nome do arquivo** e reusam os handlers do
próprio painel. Pausar/continuar só em download comum (não do agente nem vídeo); tentar de novo só em
falho/cancelado; cancelar um download que o **usuário** começou passa pela confirmação do freio de
segurança.

**Quando acaba uma tarefa de download** (`App.tsx`, regras em [`download-steps.ts`](src/renderer/download-steps.ts)):
- Um arquivo e nada depois ("baixe X"): a tarefa acaba assim que esse download começa, com
  "⬇️ Downloading <arquivo> (tamanho) to <pasta> — follow its progress on the download button". Depois de um
  clique numa tarefa de download, o Bah espera até 2,5 s o download começar antes do próximo passo.
- Vários arquivos ("os dois", "todos", "3 vídeos") ou um passo depois ("…e instale", "…depois resuma"): o
  próprio Bah espera (sem chamar o modelo; o prazo da tarefa fica pausado) até todos os downloads da tarefa
  terminarem ou falharem, mostra "⏳ Waiting for downloads: a.dmg 45% (ETA …)" e passa pro modelo as linhas
  `DOWNLOAD COMPLETED` com os caminhos antes do próximo passo.
- Página de baixar app ("Get the app", "Download for Mac") não conta como beco sem saída numa tarefa de
  download (`commandWantsDownload` no `agent-recovery.ts`).
- O botão de downloads da barra mostra um anel como o do Chrome, com o progresso somado dos downloads
  ativos; gira quando o tamanho é desconhecido, fica cinza com todos pausados e pisca quando tudo termina
  ([`download-ring.ts`](src/renderer/download-ring.ts), `components/DownloadButtonIcon.tsx`).

**Torrents** são controlados pela chave do menu **🧲 Cliente de torrent embutido** (`localStorage`
`torrentBuiltin`, mandada pro main com `torrent:set-builtin` no boot e ao alternar).
**Padrão: DESLIGADO.**

| Entrada | Embutido **DESLIGADO** (padrão) | Embutido **LIGADO** |
|---|---|---|
| Link `.torrent` (clique, popup, barra de endereço, agente) | Salvo em Downloads como arquivo comum | Abre o card "Salvar ou Tocar" |
| Link `magnet:` / magnet colado | Vai pro app de torrent padrão do sistema (`shell.openExternal`) | Abre o card |
| Processo do motor de torrent | Nunca sobe | Sobe no primeiro torrent aberto |

Onde se decide (tudo no processo main, então toda entrada se comporta igual):

- `torrentManager.handleUri()` ([`torrent-manager.ts`](src/main/torrent-manager.ts)) — card se LIGADO; magnet → app do sistema se DESLIGADO.
- `will-navigate` / `setWindowOpenHandler` no `main.ts` — sempre roteiam `magnet:`; `.torrent` só quando LIGADO.
- `interceptDownload` (dep do download-manager, ligada no `main.ts`) — LIGADO: um `.torrent` que chega no
  `will-download` por qualquer caminho (ex.: digitado na barra) é cancelado e vai pro card.
- Magnet colado na barra passa por `torrent:open` → `handleUri()` (o renderer nunca decide).

A chave separada **🌱 Compartilhar torrents (seed)** (padrão DESLIGADA) só importa com o embutido LIGADO.

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
  WEB → resposta da web; `other` / demora (5 s) → o caminho de antes. A caixa ainda não manda a última
  tarefa (`Last task: none`), então LAST_RUN vira chat e FIX vira agente. Com o roteador pronto, a regra
  de palavras "pergunta que aponta pra tela" fica de lado (o PAGE do roteador cobre). Continuam antes do
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
