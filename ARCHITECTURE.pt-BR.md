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
  (`skills/software-download/SKILL.md`, lida quando o carregador de skills entrar) também diz ao modelo pra nunca
  abrir nem rodar o instalador.

Testado com `tests/e2e/software-download.spec.ts` (páginas de fabricante sintéticas: botão que detecta o SO, lista
por SO/CPU, seletor de modelo de impressora com modal sem ARIA, página tipo Steam cujo único botão diz "Install Steam", parede de login).

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
