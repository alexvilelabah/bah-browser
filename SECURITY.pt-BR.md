# Segurança e como auditar o Bah

**Português** · [English](SECURITY.md)

O Bah é **source-available** (licença PolyForm Small Business — não é "open source" OSI, mas
todo o código está neste repositório pra você ler e verificar). Este documento é um mapa pra
quem quiser auditar: o modelo de ameaça, o que sai da sua máquina, cada ponto sensível com um
ponteiro pro arquivo exato, e uma lista honesta do que o Bah **não** faz e dos tradeoffs que
assumimos de propósito.

Se for ler um arquivo só, leia [`src/preload/preload.ts`](src/preload/preload.ts) — é a
fronteira inteira entre o lado web/UI e o lado privilegiado (veja abaixo).

---

## Modelo de ameaça — o que o Bah realmente é

- Um **navegador desktop local** (Electron) que roda **na sua máquina**, como **seu** usuário do SO.
- O agente age **na sua sessão real, logada** — ele clica e digita nas páginas como você. Esse
  poder é o ponto (ele consegue terminar tarefas de verdade), e é por isso que ações sensíveis
  pedem confirmação antes (veja "Freio de segurança").
- **Não** é um sandbox blindado multi-inquilino defendendo um servidor contra páginas hostis.
  Os adversários realistas são: *um site comum se comportando mal* e *a IA propondo uma ação
  errada ou arriscada*. A gente otimiza por três coisas: não fazer nada caro/destrutivo em
  silêncio, não vazar seus dados pra fora da máquina, não rodar código não confiável.
- **Um usuário, seu hardware.** Sem contas, sem servidor do Bah, sem telemetria.

---

## O que sai da sua máquina

- **Modo nuvem (padrão do agente):** o texto da página e um screenshot da página atual são
  enviados pro **provedor de IA que você escolheu** (DeepSeek / Mistral / NVIDIA NIM)
  por HTTPS, pra o modelo "ver" a página e decidir a próxima ação. Sua chave de
  API (se houver) vai só pra esse provedor. Nada vai pra mais lugar nenhum. Ver
  [`src/main/ai-engine.ts`](src/main/ai-engine.ts).
- **Modo local (Ollama):** nada sai da sua máquina. Se o modelo local falha, o Bah **dá erro —
  não cai pra nuvem em silêncio** (garantido em [`src/main/main.ts`](src/main/main.ts), no ramo
  local do roteador híbrido).
- **OCR e screenshots usados pra OCR** rodam **no aparelho** (Tesseract) — a imagem nunca é
  enviada. Ver [`takeOcr`](src/preload/preload.ts) + [`ocr-engine.ts`](src/main/ocr-engine.ts).
- **Permissões de site (localização, câmera, microfone, área de transferência, notificações, MIDI, arquivos):**
  negadas até você responder na barra do Bah — *Permitir desta vez* (até a página recarregar), *Sempre permitir* /
  *Nunca permitir* (salvo por site em `site-permissions.json`; revise ou redefina no menu ⋮ → 🔒 Permissões dos
  sites). A barra é UI do próprio Bah, fora da página, então o agente não consegue responder; pedidos de abas em
  segundo plano ou ocultas são negados sem perguntar. Captura de tela, USB/HID/serial e permissões desconhecidas
  são sempre negadas. Antes disto, o padrão do Electron liberava tudo isso pra qualquer site, calado. Ver
  [`src/main/site-permissions.ts`](src/main/site-permissions.ts).
- **Consulta do país da rede:** só na região de compras *Automática*, uma requisição a
  `https://www.cloudflare.com/cdn-cgi/trace` (pelo motor do navegador, mesma rota das abas) quando uma tarefa começa
  ou o painel 🌍 abre, com cache de 10 minutos. Só o código do país é usado. Escolha *Região do meu computador* ou um
  país fixo para desligar. Ver [`src/main/region.ts`](src/main/region.ts).
- **Fuso horário:** como em todo navegador, os scripts da página leem seu fuso. O Bah também põe sua região e fuso no
  prompt do agente, que vai pro seu provedor de IA (fica local com modelo local). Escolha **UTC** em 🌍 Região e hora
  pra esconder dos sites.
- **Arquivos do seu computador (uploads):** o agente nunca escolhe caminho. No `upload`, o Bah mostra um cartão e
  *você* escolhe o arquivo no diálogo do SO (o agente só vê o nome). Ou você pode **liberar uma pasta nesta sessão**:
  o agente então lista, lê PDF/Word/texto dela (ex.: escolher o currículo que combina com a vaga) e anexa arquivos
  dela — tudo resolvido e conferido no processo principal (sem fuga por `../` ou symlink), até fechar o Bah ou
  revogar (menu ⋮ → 📂 Pastas liberadas ao agente). Nada é enviado até o formulário do site ser enviado. Ver
  [`src/main/upload.ts`](src/main/upload.ts).
- **Proxy:** com um proxy configurado (no SO, no painel 🌐 Rede e proxy ou via `HTTPS_PROXY`), todo o
  tráfego do Bah passa por ele — é esse o objetivo. Senhas de proxy são digitadas na caixa do próprio Bah,
  salvas só se você marcar *Lembrar*, cifradas com o chaveiro do SO (`safeStorage`, arquivo
  `proxy-auth.json`) e nunca mostradas ao agente nem ao modelo. Ver [`src/main/proxy.ts`](src/main/proxy.ts).
- **Certificados-raiz da empresa:** o Bah soma ao Node os certificados-raiz em que o SO confia, para
  confiar no mesmo que o motor do navegador já confia. Não adiciona nem confia em nada que o SO não confie.
  Ver [`src/main/system-ca.ts`](src/main/system-ca.ts).
- **Sem analytics, sem telemetria, sem phone-home.** Não há SDK nem endpoint de analytics no
  código — pode dar grep.

---

## A fronteira de confiança: `src/preload/preload.ts`

Esse arquivo é a superfície **inteira** que o conteúdo web e a UI usam pra chegar no lado
privilegiado (Node). Ele expõe um conjunto fixo de canais IPC nomeados via `contextBridge` e
**nada além disso**: sem `require`, sem `fs`, sem objetos Node crus. Junto de
`contextIsolation: true` + `nodeIntegration: false` ([`main.ts`](src/main/main.ts)
`webPreferences`), uma página não toca no SO a não ser por esses canais explícitos e revisáveis.

**Leia o `preload.ts` primeiro.** Se uma capacidade não está lá, o lado web não a tem. Cada
canal é um `ipcRenderer.invoke('namespace:acao', …)` cujo handler fica em `src/main/main.ts`
(ou num módulo que ele chama), então dá pra rastrear qualquer capacidade de ponta a ponta em
uns dois pulos.

---

## Checklist de auditoria — verifique você mesmo

| Proteção | Onde olhar | O que conferir |
|---|---|---|
| Isolamento de processo | `main.ts` → `webPreferences` | `contextIsolation: true`, `nodeIntegration: false` |
| Binário blindado (Electron Fuses) | [`build/afterPack.js`](build/afterPack.js) | RunAsNode off, `NODE_OPTIONS` ignorado, `--inspect` ignorado |
| Bridge IPC = único portão | [`preload.ts`](src/preload/preload.ts) | todo canal é `ipcRenderer.invoke(...)`; nenhum primitivo Node exposto |
| Freio (pagar / comprar / excluir / cartão / enviar candidatura) | [`src/renderer/risk.ts`](src/renderer/risk.ts) + o loop do agente em `App.tsx` | `riskForAction` classifica; clique, **fill** (cartão) e **press** (Enter no checkout) pedem confirmação antes de rodar. Numa tarefa de candidatura, um botão "Submit"/"Enviar" puro e o Enter na página de revisão também pedem (`📨 Send it` / `Don't send`) |
| Perfil de candidatura + respostas salvas | [`src/main/applicant-profile.ts`](src/main/applicant-profile.ts), [`src/shared/form-fill.ts`](src/shared/form-fill.ts) | Fica só neste computador, cifrado com `safeStorage` (sem cofre → não grava). Preenchido nos formulários **por código** nas tarefas de vaga; respostas digitadas no cartão de perguntas só ficam salvas com "Salvar estas respostas" marcado. Autoidentificação voluntária: padrão "prefiro não responder". Editável/apagável em ⋮ → 📝 |
| Tarefas agendadas (rodando sem ninguém olhando) | [`src/main/scheduled-tasks.ts`](src/main/scheduled-tasks.ts), [`src/renderer/scheduler.ts`](src/renderer/scheduler.ts), [`src/shared/schedule.ts`](src/shared/schedule.ts) | Pedidos e histórico ficam só neste computador em `scheduled-tasks.enc`, cifrados com `safeStorage` (sem cofre → só na memória), com teto (50 tarefas, 20 entradas de histórico). Rodam **só com o Bah aberto**; um horário perdido com ele fechado é oferecido na abertura (Rodar agora / Pular), nunca roda escondido. A vez agendada é `unattended`: toda confirmação do freio, pedido de permissão, cartão de perguntas ou pausa de login **espera a pessoa** (notificação do sistema + "esperando você" no painel), um "Send/Post/Book/Order" puro também pergunta, e os assistentes de envio automático do Gmail/YouTube ficam desligados. Não são criadas a partir de abas anônimas. O relógio de teste (`E2E_SCHED_NOW`) só é lido com `NODE_ENV=test` |
| Conversas do assistente (thread viva + 🕘 Histórico de conversas) | [`src/main/chat-store.ts`](src/main/chat-store.ts), [`src/shared/chat-history.ts`](src/shared/chat-history.ts), [`src/shared/thread-store.ts`](src/shared/thread-store.ts) | Fica só neste computador, cifrado com `safeStorage` (`threads-live.enc`, `chat-history.enc`; sem cofre → não grava). Com teto (100 conversas / ~2 MB de histórico, 60 threads vivas / ~1,5 MB). Aba anônima nunca chega a nenhum dos dois (filtrada na tela e de novo no main). A thread viva só volta com ⋮ → Ao abrir o Bah = "Continuar de onde parou"; senão é apagada ao abrir. O histórico de conversas sai no "Limpar dados de navegação". Os canais `threads:*` / `chat-history:*` só aceitam a janela principal como remetente (`threads:save-live` / `threads:load-live-sync` usam `send` / `sendSync` pra última gravação chegar antes de a janela fechar) |
| Login: o agente nunca digita senha | [`src/renderer/agent-login-policy.ts`](src/renderer/agent-login-policy.ts) + [`skills/sign-in/SKILL.md`](skills/sign-in/SKILL.md) + a trava de login no `App.tsx` | o agente só clica em Entrar quando a tarefa precisa da conta da pessoa (`commandLikelyNeedsAccount`); campo de senha / página de login nessa tarefa pausa o Bah (`detectManualHelpNeed`) pra pessoa entrar; senhas salvas ficam no gerenciador (nenhuma ferramenta chega nele). O estado entrou/não entrou por site (`accountStateOf`) vai no prompt numa linha `ACCOUNT:`. Sites em modo cuidadoso (`careful-sites.ts`) param a tarefa na segunda ação recusada |
| Extensões de gerenciador de senha (LastPass, Bitwarden, 1Password) | [`src/shared/password-extensions.ts`](src/shared/password-extensions.ts), [`src/shared/extension-ui.ts`](src/shared/extension-ui.ts), `cdp:axtree` no `main.ts`, [`frames.ts`](src/main/frames.ts) | o Bah nunca preenche a partir de uma extensão e nunca lê o cofre nem as opções dela (não existe API suportada; ver ARCHITECTURE). Numa tarefa da conta com uma delas ligada, o Bah espera até 8 s o login automático **dela**. No preenchimento do Bitwarden, que só preenche, o Bah aperta Entrar do formulário uma vez, e só depois que a extensão preencheu a senha. O Bah só pergunta à página se o campo de senha está vazio (sim/não), nunca o valor. Se nada acontece, o Bah pausa com um cartão que diz o nome da opção na extensão. Iframes `chrome-extension://` e raízes de injeção marcadas (ícones e menus da extensão) saem do que o agente vê, então a IA não consegue escolher uma credencial no menu de uma extensão. A detecção usa os IDs da Web Store, que vêm da chave da extensão; só o nome não conta. O gancho de teste `BAH_TEST_PASSWORD_EXTENSIONS` só funciona com `NODE_ENV=test` |
| "Adicionar ao Bah" nas páginas da Chrome Web Store | `extensions:install-from-store` em [`chrome-extensions.ts`](src/main/chrome-extensions.ts), `parseCrx3` em [`chrome-extension-rules.ts`](src/main/chrome-extension-rules.ts) | o ID da extensão vem do endereço da aba (origem exata da loja), nunca de argumento. O `.crx` público vem do endereço de atualização do Google por HTTPS; o hash da chave dele tem que ser o ID declarado nele e o ID da página. Só Manifest V3. O Bah faz a mesma pergunta "Adicionar X?" e carrega pelo carregador com trava. O Bah **não** finge ser o Chrome pra fazer aparecer o botão da própria loja |
| Ler páginas que proíbem scripts | [`src/renderer/page-eval.ts`](src/renderer/page-eval.ts) + `page:eval-isolated` no `main.ts` | só quando o mundo da página recusa um teste trivial, os scripts de leitura do próprio Bah rodam num mundo isolado separado (1047) daquela aba; o IPC só aceita a janela principal como remetente e só abas `<webview>` dela; o JavaScript da página não vê nem chama esse mundo |
| IA local fica offline | `main.ts` (roteador híbrido, ramo local) | na falha do Ollama devolve erro — **sem** fallback silencioso pra nuvem |
| Download só cai na pasta de downloads; nada roda sozinho | `main.ts` (`download:url`) + [`download-manager.ts`](src/main/download-manager.ts) | arquivos vão só pro `getDownloadDir()` e nunca são abertos/executados automaticamente. **Sem lista de tipos bloqueados** — ver tradeoffs abaixo |
| Motor de torrent é opcional | [`torrent-manager.ts`](src/main/torrent-manager.ts) (`builtinOn`, `handleUri`) | cliente embutido DESLIGADO por padrão: `.torrent` salvo como arquivo, `magnet:` vai pro app do sistema, o `utilityProcess` do motor nunca sobe |
| `openFile` / reveal não abrem caminho arbitrário | [`download-manager.ts`](src/main/download-manager.ts) + `main.ts` (`shell:reveal`) | ambos chamam `isInsideAllowedRoot` ([`validate.ts`](src/main/validate.ts)) → só Downloads / userData / temp |
| Limites de colheita de imagem | [`image-harvester.ts`](src/main/image-harvester.ts) | SVG bloqueado, teto de bytes, content-type checado, redirects limitados |
| OCR / screenshots ficam locais | [`takeOcr`](src/preload/preload.ts) + [`ocr-engine.ts`](src/main/ocr-engine.ts) | Tesseract no aparelho; imagem nunca vai pra nuvem |
| Adblock | `main.ts` (`@ghostery/adblocker-electron`, `ADBLOCK_BYPASS_HOSTS`) | EasyList/EasyPrivacy; a pequena lista de bypass (ex.: login do Google) é explícita |
| Coletor de dados de treino (opt-in) | `main.ts` (`dataset:append-run`) + [`agent-run-logger.ts`](src/renderer/agent-run-logger.ts) | grava **só** em disco local, **só** quando ligado; nunca sobe |
| Pra onde seus dados podem ir (IA) | [`ai-engine.ts`](src/main/ai-engine.ts) | DeepSeek / Mistral / NVIDIA NIM (nuvem) ou Ollama (local) — e nada mais |

---

## O que o Bah NÃO faz

- **Sem telemetria / analytics / phone-home.**
- **Sem exfiltração de chave.** Sua chave de API vai só pro provedor que você escolheu, por HTTPS.
- **Não quebra CAPTCHA, não burla rate-limit, não automatiza o que o site proíbe nos termos.**
  Se apresentar como Chrome padrão é por *compatibilidade* (evitar bloqueio falso), não evasão —
  veja "Safety & limits" no README.
- **Sem execução de código remoto.** O app nunca dá `eval` em conteúdo da web. A IA retorna um
  **conjunto fixo de tipos de ação** (ver [`page-executor.ts`](src/renderer/page-executor.ts) e
  [`page-agent.ts`](src/main/page-agent.ts)) — nunca código pra rodar.

---

## Tradeoffs conhecidos e aceitos (honesto)

São reais e intencionais pra fase atual (app local de um usuário, na sua máquina). Listados
aqui pra o auditor não ter que "descobrir":

1. **Chaves de API ficam em `localStorage`** ([`store.ts`](src/renderer/store.ts)), não no
   keychain do SO (`safeStorage`). Aceitável pra app local de um usuário; migrar pro
   `safeStorage` está no roadmap.
2. **Fallback de download com TLS leniente** (`main.ts`): num erro de cadeia de certificado, o
   download é refeito com a verificação relaxada. O arquivo continua caindo só na pasta de
   downloads e nunca é aberto sozinho. Feito pra sites (ex.: alguns portais .gov.br) com cadeia
   de certificado quebrada.
3. **Cadeia de suprimentos de binários:** `yt-dlp` e `ffmpeg` são baixados das URLs "latest"
   upstream sem checksum fixo ([`media-downloader.ts`](src/main/media-downloader.ts)).
   Aceitável nessa escala; fixar versão+hash está planejado antes de distribuir em massa.
4. **Qualquer tipo de arquivo pode ser baixado** — inclusive instaladores e scripts (`.exe`,
   `.dmg`, `.pkg`, `.sh`, ...), por você ou pelo agente. Não há lista de extensões bloqueadas
   nem checagem de conteúdo; a proteção é que downloads vão só pra pasta de downloads e o Bah
   nunca os executa. Confira o que o agente baixou antes de abrir.
5. **Clique opcional na caixinha de captcha** (menu ☑️, DESLIGADO por padrão; `tryCaptchaCheckbox` no
   `App.tsx`): ligado, numa porteira de verificação humana de verdade o agente clica **uma vez** na
   caixinha do reCAPTCHA / hCaptcha / Turnstile com input real e confere se passou (token / widget
   sumiu); senão pede ajuda como antes. Nunca tenta desafio de imagem. Alguns sites proíbem acesso
   automatizado nos termos — a escolha é do usuário.
6. **Verificação humana é com a pessoa (Watch/Takeover).** Quando a página é uma checagem de robô / CAPTCHA de
   qualquer estilo ou uma parede de login ([`src/shared/human-check.ts`](src/shared/human-check.ts), sinais genéricos,
   nunca por site), o Bah passa a aba pra você e retoma sozinho quando a página volta ao normal
   ([`src/shared/takeover.ts`](src/shared/takeover.ts)). O agente nunca clica, segura, digita ou rola numa
   verificação humana — uma trava no código recusa toda ação na aba classificada assim — e nunca tenta parecer
   gente. Tarefa agendada (ninguém olhando) não espera: o site fica "couldn't read — human check". A chave opcional do item 5 (DESLIGADA por padrão) ainda clica uma vez numa caixinha simples antes de passar a aba pra você.
7. **O agente pode ler o HTML da página (`get_html`)** ([`src/shared/html-clean.ts`](src/shared/html-clean.ts)). O que
   ele recebe vem limpo: corpo de `<script>`/`<style>`/`<svg>`/`<noscript>`/`<template>`, comentários, estilo inline
   e handlers `on*` saem; URLs `data:` são encurtadas; só uma lista curta de atributos sobrevive. **Valores secretos
   nunca saem da página**: campos de senha e ocultos, qualquer campo cujo name/id/autocomplete pareça token, CSRF,
   código de uso único, número de cartão, CVV ou SSN, e tokens CSRF em `<meta>` viram `[redacted]`; iframes de
   outra origem viram só `[cross-origin iframe]`. No pedido, o HTML vem marcado como *dado da página, não
   instrução*, e as partes invisíveis levam `[hidden]` — texto escondido tipo "ignore as instruções anteriores"
   fica claramente marcado como algo que a pessoa não vê. É leitura passiva (permitida numa checagem humana, como
   o `extract_text`); o que o agente fizer depois continua passando pelo freio de segurança. Uma leitura tem
   o tamanho do contexto livre do modelo — de 4.000 a 60.000 caracteres ([`src/shared/read-paging.ts`](src/shared/read-paging.ts)),
   6.000 por padrão nos modelos locais pequenos — e página maior é lida em partes (`offset`). Cada parte do
   `get_html` / `extract_text` aparece só no próximo pedido (bloco próprio, marcado como dado da página), não
   fica no histórico do agente.

---

## Reportar

Achou algo estranho? Fale pela seção **Contact** do [README](README.md) (ou abra uma issue no
repositório). Relatos honestos são bem-vindos — este documento existe justamente pra os
problemas serem achados na leitura.
