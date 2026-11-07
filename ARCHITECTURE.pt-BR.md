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
| `region.ts` (+ `src/shared/region.ts`, `src/renderer/region-state.ts`) | 🌍 Região e hora: país de saída da rede (trace da Cloudflare, só no Automático, cache de 10 min), região de compras, fuso dos sites via CDP `Emulation.setTimezoneOverride` (volta ao reiniciar, salvo se mantido; com fuso escolhido, toda aba recebe o debugger pra isso) |
| `proxy.ts`, `proxy-config.ts` | Proxy pra **todas** as sessões (sistema / manual http·https·socks5 / PAC / direto), caixa de login 407 com credencial salva cifrada no chaveiro, IPC `proxy:*`. O `fetch` do processo principal passa pelo `session.fetch` da sessão `persist:browser` — uma configuração vale também pras requisições do próprio Bah |
| `proxy-base.ts` | Ponte entre o proxy do Bah e o `chrome.proxy` das extensões (VPN de extensão): extensão no controle vence (como no Chrome); quando solta, as abas voltam pro proxy configurado no Bah, não um "sistema" fixo; a política de WebRTC do Bah é a base das extensões |
| `secure-dns.ts` (+ `src/shared/secure-dns.ts`) | DNS seguro (DNS sobre HTTPS) escolhido pela pessoa: `app.configureHostResolver` pro app inteiro, IPC `dns:*`. Veja [DNS seguro](#dns-seguro-dns-sobre-https) |
| `network-privacy.ts` (+ `src/shared/network-privacy.ts`) | ⋮ → Rede: escolha da política de WebRTC (vazamento de IP), WebRTC só IPv4 (switch de boot), avisos de vazamento, IPC `net:*`. Veja [DNS seguro, versão do IP, WebRTC](#dns-seguro-dns-sobre-https) |
| `system-ca.ts` | Lê o repositório de certificados-raiz do SO e soma às CAs padrão do Node (`tls.setDefaultCACertificates`) pra proxies corporativos com inspeção TLS |
| `video-cuts.ts`, `transcript.ts` | Recursos de vídeo locais (localizar onde uma frase é dita, transcrições) — ffmpeg nativo |
| `image-harvester.ts` | Colheita de imagens em massa + geração de imagem por IA (Pollinations), com limites |
| `ocr-engine.ts`, `page-capture.ts` | OCR no aparelho (Tesseract) + screenshots |
| `data-view.ts` | Renderiza tabelas/gráficos numa página local (sem CDN) |
| `validate.ts` | Helpers de segurança de caminho (`isInsideAllowedRoot` etc.) |
| `popup-shield.ts`, `overlay-script.ts` | Tratamento e dispensa de popups/overlays |
| `job-queue.ts` | Serializa tarefas longas |

### DNS seguro (DNS sobre HTTPS)

⋮ → Rede e proxy → **DNS seguro**. Salvo em `userData/secure-dns.json`; `src/shared/secure-dns.ts`
converte a configuração em `app.configureHostResolver({ secureDnsMode, secureDnsServers })` (validado,
com teste unitário; entrada ruim volta pro Sistema). O resolvedor é do serviço de rede único do Chromium,
então uma configuração vale pra **todas** as sessões: abas, anônima, janelas de login do Google e as
requisições do próprio Bah. Aplicado depois do `ready` e reaplicado na hora quando a pessoa salva
(as conexões abertas são fechadas).

| Modo | Resolvedor |
|---|---|
| **Sistema** (padrão) | O Bah nem chama o `configureHostResolver`: padrão do Chromium (`automatic`, sem servidores: DNS comum da rede, cifrado só se o provedor do sistema tiver DoH). Nada muda até a pessoa escolher; voltar pro Sistema reaplica exatamente esse padrão |
| Provedor (sem conta) | AdGuard DNS `https://dns.adguard-dns.com/dns-query` (anúncios + malware), Mullvad adblock `https://adblock.dns.mullvad.net/dns-query` (anúncios), Quad9 `https://dns.quad9.net/dns-query` (malware), Cloudflare `https://cloudflare-dns.com/dns-query` (sem filtro). As listas são do provedor |
| NextDNS | `https://dns.nextdns.io/<id>` — a configuração da própria pessoa (conta grátis; ela gerencia as listas). Nunca é o padrão porque exige conta |
| Personalizado | Qualquer modelo DoH `https://` (`{?dns}` aceito), ex.: Pi-hole / AdGuard Home na rede local; `http://` recusado |

**Estrito** (desligado por padrão) vira `secure` (a consulta falha se o servidor DoH não responder) em vez
de `automatic` (cai pro DNS comum da rede). Com proxy configurado, o proxy pode resolver os nomes do
tráfego que passa por ele (HTTP CONNECT, SOCKS5) — o painel avisa; o comportamento do proxy não muda.

É configuração do núcleo, não extensão: extensões do Chrome não têm API pra definir o resolvedor, e
Chrome / Edge / Brave / Firefox mantêm o DNS seguro nas próprias configurações.

#### Versão do IP, WebRTC e avisos de vazamento

O mesmo painel (⋮ → Rede e proxy: avisos, Proxy, DNS seguro, Versão do IP, WebRTC) reúne o resto da
privacidade de rede (`network-privacy.ts`, lógica pura em `src/shared/network-privacy.ts`, salvo em
`userData/network.json`).

**Versão do IP — medido no Electron 44, só o "automático" é possível.** O switch `--disable-ipv6` não
existe mais neste Chromium (a string nem está no binário; com ele, uma página em `localhost` continua
conectando por `::1`), e nem o `configureHostResolver` nem as sessões têm opção de família
(`session.resolveHost` aceita `queryType`, mas só pras consultas do próprio Bah). O painel mostra
"Só IPv4" / "Só IPv6" desligados com esse motivo e aponta pros ajustes de rede do sistema.

**WebRTC.** Medido: a política padrão do Electron (`default`) entrega pra qualquer página os IPs reais
das interfaces — candidatos de host IPv4 e IPv6 global, sem nome mDNS. Agora o Bah sempre define uma
política em todo web contents (todas as sessões, inclusive a anônima; quem aplica é o `proxy.ts`, e a
configuração `chrome.privacy` de uma extensão continua vencendo na sessão dela):

| Escolha | Sem proxy | Com proxy |
|---|---|---|
| Proteger meus IPs (padrão) | `default_public_interface_only` (sem candidato de host) | `disable_non_proxied_udp` (nada de UDP fora do proxy) |
| Melhor qualidade de chamada | `default` | `default` (com aviso: o WebRTC pode passar por fora do proxy) |

"WebRTC: só IPv4" acrescenta `--force-fieldtrials=WebRTC-IPv6Default/Disabled/` antes do `ready`
(medido: os candidatos IPv6 somem), então **vale depois de reiniciar** — o painel avisa.

**Avisos de vazamento** (no topo do painel; o renderer recebe só famílias/flags, nunca os endereços da
máquina; `os.networkInterfaces()` conta IPv4 que não é loopback/169.254 e IPv6 só em 2000::/3):

| Aviso | Quando | Botão |
|---|---|---|
| Proxy só por uma família | proxy manual cujo host é IP literal (ou resolve) de uma família só, e a máquina tem a outra; proxy em loopback é ignorado | Abrir os ajustes de rede do sistema (macOS / Windows) |
| DNS seguro só por uma família | idem, pro host do servidor DoH | Abrir os ajustes de rede do sistema |
| WebRTC pode passar por fora do proxy | proxy + "Melhor qualidade de chamada" | Proteger o WebRTC |
| DNS seguro atrás do proxy (info) | proxy + DNS seguro: o proxy pode resolver os nomes do tráfego que passa por ele | — |

Nada configurado → nenhum aviso. Testes: `tests/unit/network-privacy.test.ts`, `tests/e2e/network-privacy.spec.ts`
(candidatos ICE de uma página local; interfaces simuladas com `E2E_NET_IFACES` sob `NODE_ENV=test` + `E2E_MOCK_AI=1`).

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
