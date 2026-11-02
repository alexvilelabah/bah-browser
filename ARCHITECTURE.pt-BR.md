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

---

## `src/main/` — processo privilegiado

| Arquivo | Responsabilidade |
|---|---|
| `main.ts` | Bootstrap do app, janela, sessão do `<webview>`, **todos os handlers IPC**, input real (`sendInputEvent`), adblock, downloads, safe-browsing, toggle de aceleração |
| `ai-engine.ts` | Toda chamada de IA nuvem/local (DeepSeek / Mistral / NVIDIA NIM / Ollama) + o system prompt e a lista de ferramentas |
| `site-locale.ts` | **Fonte única** do idioma que os sites recebem (Accept-Language / navigator.languages / --lang seguem a escolha da UI) |
| `page-agent.ts` | Helpers de raciocínio do agente (lado nuvem) |
| `download-manager.ts` | Gerenciador de download nativo: pausar/continuar/cancelar/fila/ETA, `open-file` guardado |
| `agent-download-worker.ts`, `download-progress.ts` | A ação `download` do agente: uma worker de `worker_threads` por download; política de cadência do progresso + travamento. Ver [Downloads e torrents](#downloads-e-torrents) |
| `torrent-manager.ts`, `torrent/engine.mjs` | Cliente de torrent embutido **opcional** (desligado por padrão): ponte IPC + o motor, isolado num `utilityProcess` que só sobe quando usado. Ver [Downloads e torrents](#downloads-e-torrents) |
| `media-downloader.ts`, `media-parts.ts` | Wrapper de `yt-dlp` / `ffmpeg` (baixar vídeo/áudio); pedaços/merge/downloads interrompidos. Ver [Downloads e torrents](#downloads-e-torrents) |
| `proxy.ts`, `proxy-config.ts` | Proxy pra **todas** as sessões (sistema / manual http·https·socks5 / PAC / direto), caixa de login 407 com credencial salva cifrada no chaveiro, IPC `proxy:*`. O `fetch` do processo principal passa pelo `session.fetch` da sessão `persist:browser`, e downloads do agente que precisam de proxy usam `session.downloadURL` — uma configuração vale pra tudo |
| `site-permissions.ts` (+ `src/shared/site-permissions.ts`) | Handlers de permissão das sessões dos sites: o sensível fica negado até a pessoa responder na barra do Bah (desta vez / sempre / nunca, por origem), abas em segundo plano/ocultas negadas direto, permissões desconhecidas negadas |
| `frames.ts` | Conteúdo de iframes pro agente (formulário de vaga/pagamento/reserva embutido): árvores de acessibilidade dos frames do mesmo processo (por `frameId`) e dos cross-origin (sessões CDP achatadas via `Target.setAutoAttach`), coordenadas na viewport da página; elementos aparecem com `frame="host"`. Preencher grava no nó dentro do frame (sem depender de foco); clique em frame cross-origin usa CDP `Input` na sessão do frame (`sendInputEvent` para no `<iframe>`) |
| `js-dialogs.ts` (+ `src/renderer/js-dialogs.ts`, `components/JsDialogHost.tsx`) | `alert`/`confirm` das páginas: troca a caixa nativa do Electron (que trava a página; evento interno `-run-dialog`) pela caixa do Bah pra pessoa, e pela política do agente nas abas dele (`dialog` armado > alert fecha > confirm comum aceito > confirm de pagamento/exclusão pergunta à pessoa); `beforeunload` nas abas do agente sai quando ele navega. `prompt()` não existe no Electron (lança erro) |
| `upload.ts` | `upload` do agente (diálogo do SO → token; campo por nó/label/posição, ou o seletor do SO interceptado com `Page.setInterceptFileChooserDialog` durante a ação; `DOM.setFileInputFiles`) e pastas liberadas na sessão pra `list_files` / `read_file` / `upload { file }` (conferidas por realpath) |
| `region.ts` (+ `src/shared/region.ts`, `src/renderer/region-state.ts`) | 🌍 Região e hora: país de saída da rede (trace da Cloudflare, só no Automático, cache de 10 min), região de compras, fuso dos sites via CDP `Emulation.setTimezoneOverride` (volta ao reiniciar, salvo se mantido); linha de região do agente, `gl=`/`cc=` na busca, cartão `suggest_time_zone` |
| `proxy-base.ts` | Ponte entre o proxy do Bah e o `chrome.proxy` das extensões (VPN de extensão): extensão no controle vence (como no Chrome); quando solta, as abas voltam pro proxy configurado no Bah, não um "sistema" fixo; a política de WebRTC do Bah é a base das extensões |
| `system-ca.ts` | Lê o repositório de certificados-raiz do SO e soma às CAs padrão do Node (`tls.setDefaultCACertificates`) — processo principal e worker de download — pra proxies corporativos com inspeção TLS |
| `video-cuts.ts`, `transcript.ts` | Recursos de vídeo locais (localizar onde uma frase é dita, transcrições) — ffmpeg nativo |
| `image-harvester.ts` | Colheita de imagens em massa + geração de imagem por IA (Pollinations), com limites |
| `ocr-engine.ts`, `page-capture.ts` | OCR no aparelho (Tesseract) + screenshots |
| `data-view.ts` | Renderiza tabelas/gráficos numa página local (sem CDN) |
| `validate.ts` | Helpers de segurança de caminho (`isInsideAllowedRoot` etc.) |
| `popup-shield.ts`, `overlay-script.ts` | Tratamento e dispensa de popups/overlays |
| `job-queue.ts` | Serializa tarefas longas |

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
   pedaço a pedaço com back-pressure (`drain`). Memória estável seja qual for o tamanho — uma ISO de 6,5 GB
   foi verificada com pico de ~1 GB de RSS do app.
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
pro usuário (painel de Downloads) em vez de esperar.

**Ferramentas de download pro agente** (`App.tsx`, loop do agente; parse/validação em `page-agent.ts`):
`list_downloads` devolve a fila do painel de Downloads (ativos primeiro: `[id]`, estado, %, tamanho,
velocidade, ETA, caminho, quem começou — agente/usuário). `cancel_download` / `pause_download` /
`resume_download` / `retry_download` recebem esse id **ou o nome do arquivo** e reusam os handlers do
próprio painel. Pausar/continuar só em download comum (não do agente nem vídeo); tentar de novo só em
falho/cancelado; cancelar um download que o **usuário** começou passa pela confirmação do freio de
segurança. Testado ponta a ponta com um modelo mock roteirizado (`E2E_MOCK_SCRIPT`, ver `ai:action` no `main.ts`).

Verificado com um servidor de teste local: a ação voltou em ~80 ms; um arquivo de 200 MB terminou idêntico
byte a byte com atualizações de 1 s; a latência de IPC do main ficou em 2–4 ms durante o download; o
travamento foi marcado em ~16 s e falhou em 60 s com o parcial apagado; o cancelamento apagou o parcial.

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
| `risk.ts` | O classificador do freio de segurança (`riskForAction`). Tipos: pagamento, exclusão, dados de cartão, candidatura, envio (sem ninguém olhando) e **message** — chamado de suporte ou post em fórum: "Submit ticket/request", "Create case", "Post your question", "Request/Schedule a call" sempre; Submit/Send/Post/Start chat puro numa tarefa `support`; Enter num formulário de chamado/post |
| `support-tickets.ts` | Chamados de suporte e posts em fórum de suporte: `commandIsSupport`/`commandIsForum` (en/pt/es), o endereço **oficial** de suporte/comunidade do fabricante (`SUPPORT_SITES`, vale o primeiro citado), o bloco do prompt só com os campos de contato do 📝 perfil, e `SUPPORT_DRAFT_SCRIPT` + `formatSupportDraft`: o cartão de envio mostra os campos preenchidos e a descrição inteira, nunca senha (caixa de descrição vazia é avisada). `offSupportSite`: com fabricante conhecido e sem endereço escrito pela pessoa, navigate/new_tab fora dos domínios dele e web_search são recusados. Tarefa de suporte conta como tarefa de conta: o formulário de login pausa pra pessoa (página inicial de suporte com "Sign in" ou "Change a subscription" não é parede) |
| `form-filler.ts`, `dropdown-page.ts` | Formulário de candidatura preenchido **por código** (regras em `shared/form-fill.ts`): ler → planejar → aplicar. Listas suspensas com busca (react-select `input[role=combobox]`, combobox ARIA, "prompt" do Workday `button[aria-haspopup=listbox]`, inclusive com caixa de busca) vão uma a uma por `shared/dropdown-fill.ts`: digita o valor, espera (com teto) a lista de `role=option` — que pode carregar com atraso e vir num portal —, escolhe a melhor opção (semântica do `pickOption` + apelidos de país + palavra única) com a sequência completa de eventos de ponteiro/mouse e confere que o campo mostra o valor. Nada casou → as opções da lista vão como escolhas pro cartão único de perguntas. Fecha a lista com blur/clique fora, nunca Escape dentro de diálogo (fecharia o modal do Easy Apply). Documento principal + diálogo aberto, como o resto do preenchimento |
| `agent-recovery.ts`, `agent-login-policy.ts` | Recuperação de estado travado + detecção de login/captcha |
| `agent-run-logger.ts` | Log de corridas opt-in (coletor de dados de treino, local) |
| `store.ts` | Estado da UI/configurações (localStorage) |
| `i18n.ts` | i18n na mão en / pt / es; **inglês é o padrão** |
| `macros.ts` | Gravar/repetir macros determinísticas |
| `form-filler.ts` (+ `src/shared/form-fill.ts`, `src/shared/ats-tables.ts`) | Candidatura preenchida por código a partir do 📝 perfil de candidato. O scan da página (`FORM_SCAN_SCRIPT`) devolve `FieldInfo[]`, com um `automationId` estável (Workday `data-automation-id`, Ashby `data-field-path`, Rippling `data-input`). `planFill` reconhece o ATS (`detectAts`: pela URL ou, no formulário embutido, pelos nomes dos campos) e classifica cada campo **primeiro pela tabela desse ATS** (Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, Rippling), depois pelas regras genéricas de rótulo/nome/autocomplete. A tabela também pode dizer `skip` (honeypot como o `beecatcher` do Workday, senha, peças internas do react-select): o campo não é preenchido nem perguntado. Tabelas montadas a partir de formulários públicos; o inventário mínimo de cada um fica em `tests/fixtures/ats/*.json`, e `tests/unit/ats-tables.test.ts` confere e mostra a cobertura por ATS |

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
site, vagas vistas) mais os 📌 **fixados**, que nunca viram resumo. O prompt do agente ("PREVIOUS
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
- **Esperando a pessoa**: um cartão de confirmação (freio, permissão, perguntas) ou uma pausa de login
  para a vez; o agendador marca "esperando você" no painel/menu e manda uma notificação do sistema
  (`sched:notify`; clique → a aba da tarefa). O relógio da tarefa (`task-deadline.ts`) dorme enquanto o
  cartão espera. Nada arriscado acontece até a pessoa responder.
- **Vezes perdidas**: na abertura, toda tarefa ligada cuja hora já passou é oferecida (`MissedRunsCard`:
  Rodar agora / Pular), nunca roda escondida. Com o Bah aberto, uma hora perdida por mais de 10 minutos
  (o computador dormiu) é oferecida do mesmo jeito. Pular grava "pulado" e vai pra próxima vez.
- **Testes**: `tests/e2e/scheduled-tasks.spec.ts` usa um relógio injetável (`E2E_SCHED_NOW` e
  `window.__bahSched.setNow`, só com `NODE_ENV=test`).

## Roteamento dos pedidos e continuações

A caixa do assistente decide por mensagem: tarefa do agente, resposta sobre a página, resposta da web ou
chat (`routeCommand` no `AgentCommandBar.tsx`; com IA na nuvem um classificador de uma palavra em
`classifyIntent` no `App.tsx` vai antes, com IA local as regras de palavras decidem). Antes de tudo:
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

**Site nomeado vai direto pro endereço oficial.** `src/renderer/known-sites.ts` é uma lista curta,
conferida à mão, de sites conhecidos (LinkedIn, Indeed, GitHub, a Amazon do seu país, Walmart, Whole
Foods, YouTube, Gmail, Google…) → endereço oficial. Quando o pedido cita um deles ("browse to linkedin,
find a job…"), o primeiro prompt do agente ganha a linha `NAMED SITE:` com o endereço e a regra "navegue,
não faça web_search do nome"; todo prompt traz a lista em `OFFICIAL SITES`; com IA local o atalho abre
direto (`getInitialShortcutAction`). Nome que também é palavra comum ("indeed", "target") só conta depois
de "go to / on / at / abra…". Nome fora da lista nunca vira domínio chutado (golpe de domínio parecido):
continua indo pro `web_search`. Testes: `tests/unit/known-sites.test.ts`,
`tests/unit/named-site-shortcut.test.ts`, `tests/e2e/named-site.spec.ts`.

**"Resuma minhas abas abertas".** `wantsTabsSummary` (`src/renderer/tabs-summary.ts`) transforma o
pedido na ação `summarize_tabs`, mesmo com a IA no comando (senão o modelo visitaria aba por aba com
`switch_tab`). O executor no `App.tsx` escolhe as abas (`selectTabsForSummary`: sem abas anônimas, sem
páginas internas como `about:`, `file:` ou o player do Bah; aba dormindo aparece como dormindo e só é
acordada se a pessoa pedir, ex.: "inclusive as dormindo"), confere a permissão **suas abas** uma vez pro
conjunto (`tabsAccessDecision`: perguntar / sempre / nunca do menu; a aba da própria tarefa não precisa),
lê o texto de cada aba com `<webview>.executeJavaScript` (que recua pro mundo isolado em página que proíbe
script) e faz uma chamada sem histórico ao modelo pra uma linha por aba e um resumo geral. O painel mostra
um cartão com um link por aba que troca pra ela. Testes: `tests/unit/tabs-summary.test.ts`,
`tests/e2e/tabs-summary.spec.ts`.

**Arquivos de texto puro no tema escuro.** O visualizador de texto do Chromium clareia o texto no tema
escuro, mas site que manda `Content-Security-Policy: default-src 'none'; sandbox` (Hugging Face, GitHub
raw) não ganha o fundo escuro → branco no branco. O `main.ts` insere uma folha de usuário
(`PLAIN_TEXT_VIEWER_CSS`, que só casa com o `<meta>` + `<pre>` do visualizador) e fundo e texto seguem o
mesmo esquema (`tests/e2e/plain-text-dark.spec.ts`).

**Páginas que proíbem scripts.** Essa mesma CSP desliga o JavaScript da página, e junto todo
`<webview>.executeJavaScript` que o Bah usa pra ler páginas (amostra de texto, `extract_text`, estado da
tela, vagas, formulários). `src/renderer/page-eval.ts` embrulha o `executeJavaScript` de cada aba uma vez
(`WebViewContainer`): tenta no mundo da página; se falhar, um teste trivial separa erro de verdade do
script (repassado, nunca roda de novo) de página que bloqueia scripts (→ o mesmo código roda no **mundo
isolado** 1047 do Bah via `page:eval-isolated` no `main.ts`, o mecanismo dos content scripts de extensão,
lembrado até a aba mudar de endereço). Testes: `tests/unit/page-eval.test.ts`,
`tests/e2e/no-js-page.spec.ts`.

## Skills de navegação (`skills/*/SKILL.md`)

Receitas curtas e testadas que o agente recebe **só quando se aplicam**, em vez de um system prompt que
só cresce (modelo local pequeno segue muito melhor um prompt curto e relevante). Formato compatível com
o `SKILL.md` do Browse.sh / agent-browser: front matter + corpo em markdown (≤ 220 palavras).
Campos: `name` (= nome da pasta), `description`, `states`, `tasks`, `sites` (hosts; subdomínio casa),
`priority`. A skill entra quando **todas** as listas que ela declara casam; no máximo 3 por passo, mais
específicas primeiro (site > estado da página > tarefa), numa seção `SKILLS FOR THIS PAGE` no topo do prompt.

Estados detectados a cada passo (`App.tsx`): `dialog` (modal visível), `suggestions` (lista de
autocomplete), `datepicker` (calendário / `input[type=date]` / `role=grid`), `eula` (controles falam de
EULA/licença/termos), `os-selector` (página oferece Windows **e** macOS/Linux). Tipos de tarefa: `download`
e `search`. Código: `src/shared/skills.ts` (parse + escolha, testado em `tests/unit/skills.test.ts`),
`src/main/skills-loader.ts` (leitura + IPC `skills:list`; empacotado via `files` do `electron-builder.yml`).
Skills incluídas — **regras gerais, não receitas de sites específicos** (receita de site fica pras
skills do usuário/contribuídas): `popup-dismiss`, `autocomplete-pick`, `date-picker`, `site-search`, `page-tabs`,
`download-chain`, `eula-accept`, `os-selector`, `product-specs`, `compatible-part`, `shopping-compare`,
`used-listings`, `travel-search`. Estados extras: `searchbox` (campo de busca/destino), `tabs` (abas), `cards` (lista de cartões), `signin` (campo de senha, página de login ou aviso "entre para ver…"). Estado da **conta por site** (entrou / não entrou — lido da página a cada passo e lembrado por site na sessão, `agent-login-policy.ts`) vai no prompt numa linha `ACCOUNT:`. Skills novas: `card-list`, `job-apply`, `sign-in`, `support-ticket` (tarefa `support`: chamado de suporte ou post em fórum de suporte — ver `support-tickets.ts`).
Tipos de tarefa: `download`, `search`, `travel`, `shopping`, `parts`.

---

## Build e release

> **E2E no macOS:** abra o Electron com `--use-mock-keychain`. Sem isso o cofre de senhas (`safeStorage`) abre um pedido do Chaveiro pro build de dev sem assinatura num perfil novo de teste, e a chamada síncrona trava o processo principal (o Playwright só estoura o tempo, sem erro).

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
