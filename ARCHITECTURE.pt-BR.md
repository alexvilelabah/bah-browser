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
| `shared/html-clean.ts` | `get_html`: o passeio no DOM dentro da página (`collectHtmlScript`, via `executeJavaScript`, então recua pro mundo isolado em página sem script) e o limpador/serializador puro (`serializeHtml`): lista de atributos permitidos, valores secretos removidos, corpo de script/style/svg fora, URLs `data:` encurtadas, refs `[#N]` da lista de elementos (carimbadas por `cdp:mark-refs` em `main/frames.ts` num atributo com nonce, apagado depois da leitura), marca `[hidden]`; paginado por `offset` em fronteira de tag (`serializeHtml` → `shared/read-paging.ts`). O HTML vai só no próximo pedido, marcado como dado da página, não instrução |
| `shared/read-paging.ts` | Quanto uma leitura de `get_html` / `extract_text` devolve e a paginação do resto. `readBudget`: clamp(tokens livres do contexto × 0,4 × 3,5 caracteres/token, 4.000, 60.000), livres = janela − último pedido (`prompt_tokens` da resposta anterior) − 4.096 de reserva pra resposta; padrão 6.000 em janela abaixo de 64k, 12.000 acima; `max` vai até o orçamento, e um pedido acima é servido no orçamento, dizendo isso. `pageHtml` / `pageText`: partes em fronteira de tag / linha que se encaixam sem buraco nem sobreposição, cada uma com "chars A–B of N" e terminando com a próxima chamada exata. Os blocos de um passo PAGE HTML / PAGE TEXT (extracted) (com marcador de fim; a fatia fixa da observação na nuvem cresce do tamanho deles) e os normalizadores das ações |
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
