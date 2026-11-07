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
| Freio (pagar / comprar / excluir / cartão) | [`src/renderer/risk.ts`](src/renderer/risk.ts) + o loop do agente em `App.tsx` | `riskForAction` classifica; clique, **fill** (cartão) e **press** (Enter no checkout) pedem confirmação antes de rodar |
| Conversas do assistente (thread viva + 🕘 Histórico de conversas) | [`src/main/chat-store.ts`](src/main/chat-store.ts), [`src/shared/chat-history.ts`](src/shared/chat-history.ts), [`src/shared/thread-store.ts`](src/shared/thread-store.ts) | Fica só neste computador, cifrado com `safeStorage` (`threads-live.enc`, `chat-history.enc`; sem cofre → não grava). Com teto (100 conversas / ~2 MB de histórico, 60 threads vivas / ~1,5 MB). Aba anônima nunca chega a nenhum dos dois (filtrada na tela e de novo no main). A thread viva só volta com ⋮ → Ao abrir o Bah = "Continuar de onde parou"; senão é apagada ao abrir. O histórico de conversas sai no "Limpar dados de navegação". Os canais `threads:*` / `chat-history:*` só aceitam a janela principal como remetente (`threads:save-live` / `threads:load-live-sync` usam `send` / `sendSync` pra última gravação chegar antes de a janela fechar) |
| Login: o agente nunca digita senha | [`src/renderer/agent-login-policy.ts`](src/renderer/agent-login-policy.ts) + [`skills/sign-in/SKILL.md`](skills/sign-in/SKILL.md) + a trava de login no `App.tsx` | o agente só clica em Entrar quando a tarefa precisa da conta da pessoa (`commandLikelyNeedsAccount`); campo de senha / página de login nessa tarefa pausa o Bah (`detectManualHelpNeed`) pra pessoa entrar; senhas salvas ficam no gerenciador (nenhuma ferramenta chega nele). O estado entrou/não entrou por site (`accountStateOf`) vai no prompt numa linha `ACCOUNT:`. Sites em modo cuidadoso (`careful-sites.ts`) param a tarefa na segunda ação recusada |
| Agente fora de contas que não pediram | o loop do agente em `App.tsx` | clique em Entrar / Cadastrar / "Continuar com o Google" é recusado, a não ser que o pedido fale de conta ou login, ou cite coisas da própria pessoa ("minha lista", "minhas vagas", pedidos: `commandLikelyNeedsAccount`) |
| Sites cuidadosos (termos proíbem automação) | [`careful-sites.ts`](src/renderer/careful-sites.ts) + o loop do agente em `App.tsx` | LinkedIn por padrão (mais `localStorage.carefulSites`): uma navegação por pedido, depois só ações de `CAREFUL_ALLOWED` (ler/relatar); a segunda ação recusada encerra a tarefa |
| Agente fica nas abas dele | [`agent-permissions.ts`](src/renderer/agent-permissions.ts) + o loop do agente em `App.tsx` | a tarefa é dona da aba de partida e das abas que abre (🤖 na barra de abas enquanto roda); `switch_tab` pra outra aba sua e `history_search` perguntam antes (só nesta tarefa / sempre / negar / nunca; também no menu ⋮); `close_tab` só fecha abas que a tarefa abriu |
| IA local fica offline | `main.ts` (roteador híbrido, ramo local) | na falha do Ollama devolve erro — **sem** fallback silencioso pra nuvem |
| Sem download de executável | `main.ts` `BLOCKED_EXTENSIONS` + `attachDownloadManager` | `.exe/.msi/.bat/.cmd/.scr/.js/.vbs/.ps1/.jar/.lnk/.hta/...` bloqueados no download |
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
   download é refeito com a verificação relaxada — **mas** o arquivo ainda é rejeitado se for
   executável (ver `BLOCKED_EXTENSIONS`), o que limita o risco. Feito pra sites (ex.: alguns
   portais .gov.br) com cadeia de certificado quebrada.
3. **Cadeia de suprimentos de binários:** `yt-dlp` e `ffmpeg` são baixados das URLs "latest"
   upstream sem checksum fixo ([`media-downloader.ts`](src/main/media-downloader.ts)).
   Aceitável nessa escala; fixar versão+hash está planejado antes de distribuir em massa.

---

## Reportar

Achou algo estranho? Fale pela seção **Contact** do [README](README.md) (ou abra uma issue no
repositório). Relatos honestos são bem-vindos — este documento existe justamente pra os
problemas serem achados na leitura.
