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
| `media-downloader.ts`, `media-parts.ts` | Wrapper de `yt-dlp` / `ffmpeg` (baixar vídeo/áudio); pedaços/merge/downloads interrompidos. Ver [Downloads e torrents](#downloads-e-torrents) |
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
agente nunca dizer que baixou antes do `COMPLETED`, usar `wait` em downloads curtos e devolver os longos
pro usuário (painel de Downloads) em vez de esperar. Um `wait` simples (`{ "ms": N }`) dorme no renderer
(até 60 s) e termina antes se um download desta tarefa terminar ou falhar.

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

#### "Baixe o <programa> pra este computador" (instaladores e drivers)

Steam, driver de impressora, Office, SolidWorks… o agente tem que pegar a versão **do site oficial** que roda
**nesta máquina**. A lógica pura fica em [`src/shared/software-download.ts`](src/shared/software-download.ts)
(testes em `tests/unit/software-download.test.ts`); [`src/main/machine-info.ts`](src/main/machine-info.ts) lê o
sistema uma vez (`process.platform`/`arch`, `getSystemVersion()`, Rosetta via `app.runningUnderARM64Translation`,
`/etc/os-release` no Linux) e entrega ao renderer pelo `machine:info`.

- **Perfil da máquina → agente.** `machineProfile()` dá SO + versão (codinome do macOS, Windows 10 × 11 pelo build,
  distro Linux e `.deb`/`.rpm`), CPU (Intel x64 / Apple Silicon / ARM64 / 32-bit) e `pickHint()`: uma frase do que
  escolher (Mac Intel → "Intel / x64 / Universal .dmg ou .pkg, não só-arm64"; Windows x64 → ".exe/.msi x64";
  Linux → tipo de pacote). Vai no prompt do sistema (`USER'S COMPUTER`) e, em tarefa de download, numa linha
  `THIS COMPUTER: … PICK: …` ao lado de `DOWNLOADS` a cada passo.
- **Conferindo o arquivo que começou.** `checkBuild(nome)` classifica pela extensão e por pedaços do nome
  (`arm64`/`aarch64`/`apple-silicon`, `x64`/`x86_64`/`amd64`/`intel`, `universal`, `win`/`mac`/`darwin`/`linux`).
  `error` = não roda aqui (SO errado, build arm64 num Mac Intel, `.rpm` no Ubuntu) → `WRONG OS` / `WRONG CPU` /
  `WRONG PACKAGE` na linha `DOWNLOAD STARTED` (e em `DOWNLOADS`), e esse download nunca conta como sucesso.
  `warn` = roda, mas não é nativo (Intel no Apple Silicon via Rosetta, x86 no Windows x64) → nota leve.
- **Sites de "free download"** (Softonic, FileHippo, Uptodown, CNET…): `thirdPartyDownloadSite()` marca a página e
  os downloads vindos deles com `THIRD-PARTY DOWNLOAD SITE` (instalador velho ou com bundleware) e manda o agente
  pro fabricante. Qual domínio *é* o oficial fica com o agente (busca) e com o `site-knowledge.ts`.
- **O botão de baixar, com qualquer texto.** `isDownloadControl(rótulo, href)`: "Download…" sempre conta; o
  jeito do fabricante ("Install Steam", "Get the app", "Install now", "Try free") só se leva a um arquivo de
  instalador ou é um botão sem link. Link de loja de apps ou de extensões nunca conta. A lista de elementos do
  agente vem da árvore de acessibilidade, sem `href`, então o destino de cada candidato é lido do DOM e casado
  com o `[id]` por texto e posição (`matchControl`, [`src/shared/page-controls.ts`](src/shared/page-controls.ts)).
  `LIKELY DOWNLOAD BUTTON` mostra o arquivo, deixa de fora os de SO/CPU errado, e um `click_text` com o mesmo
  rótulo vira `click_ref` nesse botão. Sem isso o "Install Steam" do menu da Steam (que só recarrega a página)
  era clicado em loop.
- **Modal sem ARIA.** A passada do `uiState` também coleta painéis fixos de z-index alto; `pickOverlay` pontua por
  cobrir o meio da tela, fundo escuro, z-index e botões de ação. Um fundo vazio não ganha mais a regra antiga
  ("≥ 20% da tela"). A linha `OPEN DIALOG/POPUP` lista os botões do próprio diálogo com o `[id]` (no modal de
  download da HP: o "Download" do modal × o da página). `tests/unit/page-scripts-syntax.test.ts` faz o parse de
  todo script de página do `App.tsx`; uma regex com barra simples num deles tinha desligado o `uiState` inteiro.
- **Parede de login.** Em tarefa de download (depois do 1º passo), `signInWall()` — campo de senha, host de login
  (`login.*`, `auth.*`, `login.microsoftonline.com`…), caminho `/signin`/`/register` ou o texto "sign in to download" —
  pausa o agente com o cartão de ajuda manual (`dl.signinWall.*`): a pessoa entra ela mesma ou para. O agente nunca
  digita senha nem cria conta. Um link "Sign in" no cabeçalho do site não conta.
- **Nunca executa nada.** Nada abre um download sozinho: `download:open-file` só roda no clique da pessoa (painel de
  Downloads, bloco do resultado), e o agente não tem ação de "abrir arquivo". A skill `software-download`
  (`skills/software-download/SKILL.md`) também diz ao modelo pra nunca abrir nem rodar o instalador.

Testado com `tests/e2e/software-download.spec.ts` (páginas de fabricante sintéticas: botão que detecta o SO, lista
por SO/CPU, seletor de modelo de impressora com modal sem ARIA, página tipo Steam cujo único botão diz "Install Steam", parede de login).
#### Vídeo / áudio (`media-downloader.ts`, `media-parts.ts`)

O yt-dlp baixa um vídeo em alta resolução em dois **pedaços** — `Título [id].f313.webm` (só imagem) e
`Título [id].f140.m4a` (só som) — e depois o ffmpeg junta em `Título [id].mp4`. Com `--no-part` os
pedaços já têm esses nomes enquanto são gravados, então pedaço nunca pode passar por resultado:

1. O yt-dlp roda com `--no-quiet` (o `--print after_move:filepath` sozinho liga o modo quieto e some com as
   linhas `Destination:` / `Merging formats into`). Essas linhas são a lista exata do que **este** download
   gravou; nada fora dela é apagado.
2. Depois de cada disparo, `classifyRun` ([`media-parts.ts`](src/main/media-parts.ts)) decide: sucesso só
   com um arquivo final que existe e não é pedaço `.f<id>.`. Sobrou pedaço (saída ≠ 0, ou 0 sem merge) =
   **"o áudio e o vídeo não foram juntados"** — falha, e os pedaços saem do disco. Se as duas partes estão
   completas (100% no progresso, ou o yt-dlp saiu 0), o Bah junta sozinho com `ffmpeg -c copy` (mp4 quando
   os codecs cabem, senão mkv) em vez de falhar.
3. Pedido normal de vídeo (não mp3) é conferido com o `ffprobe` da mesma pasta do ffmpeg. Sem faixa de
   áudio → uma nova tentativa com `-f "bv*+ba/b[acodec!=none]" --force-overwrites`; se a origem não tem
   formato nenhum com áudio, o arquivo fica e o agente é avisado de que não tem som; senão é falha.
4. Sair / crash: o yt-dlp roda em grupo de processos próprio (`detached`) e não morre com o Bah. No
   `before-quit`, `stopAllMediaDownloads()` mata todos os grupos do yt-dlp. Cada download fica anotado em
   `userData/media-downloads.json` (pasta, início, arquivos gravados, pid, o que o "tentar de novo"
   precisa); arquivo final sai da anotação assim que é impresso. No boot seguinte
   `recoverInterruptedDownloads()` para um yt-dlp que sobrou, apaga só os arquivos anotados que estão na
   pasta daquele download e não são mais velhos que ele, e a lista de Downloads mostra o download como
   **Interrompido** com ↻.

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
| `takeover-driver.ts` (+ `shared/takeover.ts`, `shared/human-check.ts`) | Watch/Takeover: classificador genérico de checagem humana / parede de login, máquina de estados da passagem pra pessoa, trava que recusa ação do agente numa checagem |
| `agent-permissions.ts` | O que o agente pode usar além das abas da própria tarefa — suas outras abas e seu histórico: Perguntar (padrão) / Sempre / Nunca |
| `shared/html-clean.ts` | `get_html`: o passeio no DOM dentro da página (`collectHtmlScript`, via `executeJavaScript`, então recua pro mundo isolado em página sem script) e o limpador/serializador puro (`serializeHtml`): lista de atributos permitidos, valores secretos removidos, corpo de script/style/svg fora, URLs `data:` encurtadas, refs `[#N]` da lista de elementos (carimbadas por `cdp:mark-refs` em `main/frames.ts` num atributo com nonce, apagado depois da leitura), marca `[hidden]`; paginado por `offset` em fronteira de tag (`serializeHtml` → `shared/read-paging.ts`). O HTML vai só no próximo pedido, marcado como dado da página, não instrução |
| `shared/read-paging.ts` | Quanto uma leitura de `get_html` / `extract_text` devolve e a paginação do resto. `readBudget`: clamp(tokens livres do contexto × 0,4 × 3,5 caracteres/token, 4.000, 60.000), livres = janela − último pedido (medidor de contexto) − 4.096 de reserva pra resposta; padrão 6.000 em janela abaixo de 64k, 12.000 acima; `max` vai até o orçamento, e um pedido acima é servido no orçamento, dizendo isso. `pageHtml` / `pageText`: partes em fronteira de tag / linha que se encaixam sem buraco nem sobreposição, cada uma com "chars A–B of N" e terminando com a próxima chamada exata. Os blocos de um passo PAGE HTML / PAGE TEXT (extracted) (com marcador de fim; a fatia fixa da observação na nuvem cresce do tamanho deles) e os normalizadores das ações |
| `agent-run-logger.ts` | Log de corridas opt-in (coletor de dados de treino, local) |
| `store.ts` | Estado da UI/configurações (localStorage) |
| `i18n.ts` | i18n na mão en / pt / es; **inglês é o padrão** |
| `macros.ts` | Gravar/repetir macros determinísticas |
| `pacing.ts` | Ritmo por site entre ações do agente (aleatório 1–5 s; 15–30 s por 30 min depois de uma checagem anti-robô) |
| `search-engines.ts` | Ordem dos buscadores da pesquisa rápida e do `web_search` do agente, e quais estão bloqueados agora |
| `known-sites.ts` | Lista curada nome do site → endereço oficial (sem domínio chutado) |
| `stores.ts` | "O pedido citou um lugar pra comprar?" (`namesStore`), pelo formato do pedido, sem lista de lojas |
| `price-compare.ts` | Comparação de preços em várias lojas: detecção (en/pt), a busca só com o produto, a lista de lojas (citadas + varejistas da região até 4), a URL de busca de cada loja, `blockedReason` (erro / checagem de robô / login / fora do domínio), `checkRead` — uma linha só vale se lida no domínio da própria loja e com o preço no texto da página; artigo e comparador nunca contam |
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
- **Coleções de mídia** (`src/renderer/download-steps.ts`, skill `media-collection`): o agente guarda
  `work` ("Top Gun (1986)") e `tracks` como "Título — Artista"; aí o Bah baixa cada uma com
  `ytsearch:` + `collectionQuery` = título + artista + obra + ano (`subjectYear`: o `work` guardado,
  senão o pedido, senão a expansão, ignorando o que vem depois de "not …"). O main alarga o poço da
  busca (`ytsearchN`) e pega o primeiro resultado que passa no filtro de duração; ranquear os primeiros
  resultados por título/artista/ano não é feito.
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

## Tarefas agendadas (com o Bah aberto)

O assistente roda um pedido nos horários marcados — "every weekday at 8am check my Indeed recommendations",
"toda segunda às 9h resuma as notícias", "a cada 2 horas …" — ou pelo ⋮ → ⏰ **Tarefas agendadas** (criar,
editar, pausar, apagar, rodar agora, histórico). Regras puras em `src/shared/schedule.ts` (testadas em
`tests/unit/schedule.test.ts`): parser en/pt/es (todo dia, dias úteis, fim de semana, dias da semana,
a cada N minutos/horas com mínimo de 15 minutos, às HH:MM / 8am / 8h / meio-dia), próxima vez em **hora
local** (8h continua 8h na troca do horário de verão; a hora pulada na primavera roda logo depois; a hora
repetida no outono roda uma vez), vezes perdidas e validação/tetos do que vai pro disco. Pedido ambíguo
(sem hora, "at 9" manhã ou noite, intervalo abaixo do mínimo) ganha um cartão com as próximas 3 vezes antes
de salvar; o claro é salvo e a resposta diz a próxima vez. A checagem cedo fica em
`AgentCommandBar.runUnified` (antes do roteador).
- **Onde fica**: `src/main/scheduled-tasks.ts` — `userData/scheduled-tasks.enc`, cifrado com `safeStorage`
  (sem cofre → só na memória), ≤50 tarefas, pedido ≤1000 caracteres, ≤20 entradas de histórico cada.
- **Execução**: `src/renderer/scheduler.ts` (`useScheduler`). Um tique (15 s) acha as que venceram e põe
  na fila; uma por vez e só com o painel do assistente livre (tarefa ou chat da pessoa nunca é
  atropelado: eventos `bah:sched-busy` / `bah:sched-run` no `AgentCommandBar`). Cada tarefa roda na sua
  aba e sessão (chip "⏰ <nome>"), reaproveitada nas próximas vezes enquanto estiver aberta. O loop do
  agente recebe `unattended: true`: o freio também para num "Send/Post/Book/Order" puro (`risk.ts`) e os
  assistentes de envio automático do Gmail/YouTube ficam desligados. Resultado + resumo curto vão pro
  histórico da tarefa.
- **Esperando a pessoa**: um cartão de confirmação (freio, permissão) ou uma pausa de login
  para a vez; o agendador marca "esperando você" no painel/menu e manda uma notificação do sistema
  (`sched:notify`; clique → a aba da tarefa). O relógio da tarefa (`task-deadline.ts`) dorme enquanto o
  cartão espera. Nada arriscado acontece até a pessoa responder.
- **Vezes perdidas**: na abertura, toda tarefa ligada cuja hora já passou é oferecida (`MissedRunsCard`:
  Rodar agora / Pular), nunca roda escondida. Com o Bah aberto, uma hora perdida por mais de 10 minutos
  (o computador dormiu) é oferecida do mesmo jeito. Pular grava "pulado" e vai pra próxima vez.
- **Testes**: `tests/e2e/scheduled-tasks.spec.ts` usa um relógio injetável (`E2E_SCHED_NOW` e
  `window.__bahSched.setNow`, só com `NODE_ENV=test`).

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
aviso "entre para ver…"). Tipos de tarefa: `download`, `collection` (todas as faixas de uma trilha sonora, álbum ou lista top-N: `isMediaCollectionRequest`), `search`, `travel`, `shopping`, `parts`, `people`.
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

## Economia de memória (abas dormindo)

O "Memory Saver" do Chrome, mais uma regra do Bah. Uma varredura no `App.tsx` (a cada 60 s) desmonta o
`<webview>` da aba parada há tempo suficiente (`discarded: true`); clicar na aba remonta na URL dela. Regras
puras em `src/shared/memory-saver.ts` (testadas em `tests/unit/memory-saver.test.ts`); tela em
`components/MemorySaverMenu.tsx` (⋮ → 💤 Economia de memória ▸: liga/desliga, nível, lista de sites ativos).
- **Níveis** (o Chrome não publica os tempos; estes são do Bah): Moderada 2 h, Equilibrada 30 min (padrão, o
  comportamento antigo), Máxima 10 min parada. Guardados no `localStorage` `memSaver` / `memSaverLevel` /
  `memSaverKeep`.
- **Nunca dorme**: a aba ativa, aba anônima/escondida (`incognito.ts` `canDiscard`), aba fixada, site da
  lista "sempre ativos", aba cuja **sessão** (`store.threadKeyOf`) tem tarefa do agente rodando ou esperando
  a pessoa (cartão de confirmação/perguntas, pausa de login — o `onExecute` inteiro) e — colhido só pras abas que passam nessas regras baratas — aba tocando áudio ou vídeo (mesmo
  `<video>` mudo), com câmera/microfone/tela liberados na página atual, com notificações permitidas pro
  site, com download em andamento que saiu dela, com formulário preenchido pela metade, ou com dispositivo
  USB/HID/serial/Bluetooth aberto. A parte da página é um script só (`PAGE_SIGNALS_SCRIPT`; formulário compara `value`/`checked`/`selected` com os padrões do HTML,
  ignorando campos hidden e de busca); a parte do main é o `memsaver:signals`
  (`src/main/memory-saver-signals.ts`, alimentado por `site-permissions.ts` e `download-manager.ts`).
  Câmera/tela contam da liberação até a página navegar (o Electron não avisa quando a captura para).
- **Lista "sempre ativos"**, regras do Chrome: `google.com` vale pros subdomínios, `.google.com` só esse
  domínio, os prefixos `[*.]`/`*.` são o mesmo que nada, um caminho opcional casa em fronteira de segmento
  (`site.com/app`), e esquema ou porta escritos precisam bater.
- O balão da aba diz por que uma candidata ficou acordada ("Mantida ativa: formulário preenchido pela metade").
- **Testes**: `tests/e2e/memory-saver.spec.ts` usa `memSaverIdleMs` / `memSaverSweepMs` (overrides no
  localStorage só pra testes) pra encurtar o tempo parada e a varredura.

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
