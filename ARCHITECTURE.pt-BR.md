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
| `media-downloader.ts` | Wrapper de `yt-dlp` / `ffmpeg` (baixar vídeo/áudio) |
| `video-cuts.ts`, `transcript.ts` | Recursos de vídeo locais (localizar onde uma frase é dita, transcrições) — ffmpeg nativo |
| `image-harvester.ts` | Colheita de imagens em massa + geração de imagem por IA (Pollinations), com limites |
| `ocr-engine.ts`, `page-capture.ts` | OCR no aparelho (Tesseract) + screenshots |
| `data-view.ts` | Renderiza tabelas/gráficos numa página local (sem CDN) |
| `validate.ts` | Helpers de segurança de caminho (`isInsideAllowedRoot` etc.) |
| `popup-shield.ts`, `overlay-script.ts` | Tratamento e dispensa de popups/overlays |
| `job-queue.ts` | Serializa tarefas longas |

---

## Instalação pela Chrome Web Store e extensões de gerenciador de senha

**Instalar pela loja ("Adicionar ao Bah").** A Chrome Web Store agora decide no *servidor* se o navegador
é o Google Chrome. O script da página pergunta `chrome.webstorePrivate.getFullChromeVersion()` e, a partir
da 142.0.7430, para de ler o user agent: passa a confiar só num sinal que o servidor manda junto com a
página (`IJ_values`). Esse sinal vem falso pra todo navegador que não é o Chrome. O preload da loja do Bah,
o `webstorePrivate` e os brands do `userAgentData` (com "Google Chrome") estavam todos no lugar, e mudar o
`sec-ch-ua` também não muda o sinal. Por isso a página mostra "Switch to Chrome" e esconde o botão. O Bah
**não** se passa pelo Chrome pra contornar isso (nada de cabeçalho forjado nem versão falsa). Em vez disso,
numa página de extensão da loja (`shared/extension-store.ts`, origem exata), a barra mostra o botão
**Adicionar ao Bah**, do próprio Bah. `extensions:install-from-store` tira o ID do endereço da aba (nunca
de argumento) e baixa o `.crx` público do mesmo endereço de atualização que a loja usa, pela sessão das
abas e pelo proxy dela. `parseCrx3` confere que o hash da chave do pacote é o ID declarado nele e o ID da
página. Depois o Bah faz a mesma pergunta "Adicionar X?" da loja e carrega pelo carregador com trava
(aprovação de acesso, lista de removidas).

**LastPass, Bitwarden e 1Password rodando.** Testados com os pacotes públicos (sem entrar em conta
nenhuma), o background do Bitwarden morria em `chrome.webNavigation.onCommitted` e o do LastPass em
`chrome.windows.onFocusChanged`: um TypeError no começo para a extensão inteira, inclusive o menu nos
campos e o popup. O calço (`extension-shim-preload.ts`) agora põe o que faltava, atendido em
`chrome-extensions.ts`:

- `webNavigation`: eventos dos frames das abas, só pra quem escuta e só de páginas que a extensão pode
  ver. `frameId` 0 é o frame principal e os outros usam o `frameTreeNodeId`. Também `getFrame`/`getAllFrames`.
- `windows`: o Bah é uma janela só, id 1. `windows.create` abre uma aba.
- `idle`: "locked" segue o bloqueio de tela do sistema, então cofre que tranca junto com o computador
  continua trancando.
- `offscreen`: uma janela escondida por extensão, só com a página da própria extensão (usada pra área de
  transferência e DOMParser). O Bah também atende `runtime.getContexts` pra esse documento.
- `commands`: a lista de atalhos do manifesto, sem tecla ligada.
- `permissions`: `contains` / `getAll` respondem pelo manifesto. Permissão opcional é recusada.
- `tabs.getCurrent`: devolve `undefined` no popup e a aba quando a página da extensão está aberta numa aba. O popup do Bitwarden escolhe a largura por essa chamada.

Os popups do LastPass e do Bitwarden fixam o tamanho no CSS do body, e o `preferred-size-changed` nunca chegava pra eles, então ficavam em 25×25. Agora o popup é medido algumas vezes depois de carregar e cresce até caber o conteúdo (máximo 800×600, como no Chrome).

**Quem está instalado** (`shared/password-extensions.ts`): a detecção usa os IDs da Web Store, que vêm da
chave pública da extensão, então outra extensão não consegue usar os mesmos. Só o nome não conta.

**O gerenciador do Bah sai da frente.** Vem ligado, com um interruptor no painel de Senhas. Com uma dessas
extensões ligada, nas abas normais o gerenciador do Bah não oferece a lista de logins nem "Salvar senha?":
dois gerenciadores brigando pelo mesmo campo é a surpresa a evitar. Nas abas anônimas continua o do Bah,
porque extensão não roda lá (igual ao Chrome).

**Agente num formulário de login** (`extensionLoginGuidance` no `App.tsx`). Quando o agente pausa num
formulário de login e uma dessas extensões está ligada (só nas abas normais), o cartão da pausa diz o nome
da opção na extensão: no LastPass, "Auto-login" (item do site → Editar → Configurações avançadas); no
Bitwarden, "Autofill on page load" (Configurações → Preenchimento automático, e também por login); no
1Password, escolher o login e deixar ele enviar. O agente nunca digita credencial.

**Interface de extensão não é da página** (`shared/extension-ui.ts`). O agente nunca vê nem clica nos
iframes `chrome-extension://`, nem nas raízes de injeção marcadas onde o LastPass e o 1Password desenham
os ícones e menus deles:

- eles saem da árvore de acessibilidade da página (`cdp:axtree`);
- o porteiro de avisos de cookie (`overlays:dismiss`) pula esses frames.

Clicar no menu de um gerenciador de senha entregaria uma credencial por iniciativa da IA.

**Ler ou mudar o auto-login por site: não há caminho suportado.** Nenhum dos três documenta um jeito
suportado de outro programa ler ou mudar o auto-login ou o preenchimento por site:

- Não há API de mensagens de extensão: nenhum tem `externally_connectable`.
- As CLIs deles (`lpass`, `bw`, `op`) exigem o cofre aberto da pessoa.
- As políticas corporativas ficam no console de administração do fornecedor, que o navegador não lê. O
  Electron também não tem `storage.managed`.

Ler o armazenamento privado deles ou alterar a extensão está fora de questão: entra no cofre e quebraria
a cada atualização. Então o Bah só *orienta*, e diz o nome da opção.

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
