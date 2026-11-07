<p align="center">
  <img src="build/icon.png" width="116" alt="Bah" />
</p>

<h1 align="center">Bah</h1>

<p align="center">
  <b>Navegador com IA</b> — você fala em português, ele opera a web pra você.<br/>
  Estilo <b>Perplexity Comet</b> · open source · por <b>VilelaLab</b>.
</p>

<p align="center">
  <a href="README.md">English</a> · 🌐 <b>Português</b>
</p>

<p align="center">
  <a href="https://github.com/alexvilelabah/bah-browser/releases"><img src="https://img.shields.io/github/downloads/alexvilelabah/bah-browser/total?label=downloads&color=success" alt="Downloads" /></a>
  <a href="https://github.com/alexvilelabah/bah-browser/releases/latest"><img src="https://img.shields.io/github/v/release/alexvilelabah/bah-browser?label=vers%C3%A3o&color=blue" alt="Versão" /></a>
</p>

> Você dá comandos em linguagem natural ("abre o gmail e apaga os spams") e a IA opera o navegador no seu lugar — vendo a tela, clicando com mouse real, digitando e seguindo até concluir.

> 🖼️ **Gerar imagem funciona de cara — sem chave.** Pra conversar e pro agente autônomo completo, adicione uma chave barata — **DeepSeek** (recomendado), **Mistral** ou **NVIDIA NIM** — ou vá 100% local + offline com **Ollama** (também grátis, sem chave).

<p align="center">
  <a href="https://www.electronjs.org"><img src="https://img.shields.io/badge/Electron-2B2E3A?style=flat-square&logo=electron&logoColor=white" alt="Electron" /></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://vitejs.dev"><img src="https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite" /></a>
</p>

<p align="center">
  <sub><b>Funciona com</b></sub><br/>
  <a href="https://deepseek.com"><img src="https://img.shields.io/badge/DeepSeek-4D6BFE?style=flat-square&logo=deepseek&logoColor=white" alt="DeepSeek" /></a>
  <a href="https://mistral.ai"><img src="https://img.shields.io/badge/Mistral-FA520F?style=flat-square&logo=mistralai&logoColor=white" alt="Mistral" /></a>
  <a href="https://build.nvidia.com"><img src="https://img.shields.io/badge/NVIDIA%20NIM-76B900?style=flat-square&logo=nvidia&logoColor=white" alt="NVIDIA NIM" /></a>
  <a href="https://ollama.com"><img src="https://img.shields.io/badge/Ollama-101010?style=flat-square&logo=ollama&logoColor=white" alt="Ollama" /></a>
</p>

## 🎬 Demonstração

![Bah em ação](assets/demo.gif)

▶️ **[Baixar o vídeo completo](https://github.com/alexvilelabah/bah-browser/raw/main/assets/demo.mp4)** — o agente pesquisando e operando a web sozinho. *(o GIF acima é a prévia; o GitHub não toca vídeo embutido no README.)*

## 📥 Baixar

**🧑 Só quero usar (Windows):** [**baixe o instalador aqui**](https://github.com/alexvilelabah/bah-browser/releases/latest) → arquivo `Bah-Setup-*.exe`, clique 2× e instale.

> 🔄 **Atualiza sozinho:** depois de instalar, o Bah verifica novas versões, baixa em segundo plano e oferece *"Reiniciar agora"* pra aplicar — sem reinstalar nada.

> ⚠️ O Windows mostra uma tela azul *"protegeu seu PC"* (o app ainda não tem assinatura digital paga). Clique em **Mais informações → Executar assim mesmo** — é normal em apps novos de código aberto. (As atualizações seguintes entram sem esse aviso.)

**🍎 macOS (novo, a partir da v1.8.12):** na [mesma página de download](https://github.com/alexvilelabah/bah-browser/releases/latest), baixe o `Bah-*-arm64.dmg` se o seu Mac for Apple Silicon (M1 em diante) ou o `Bah-*-x64.dmg` se for Intel (dá pra ver no menu Apple → Sobre Este Mac). Abra o arquivo e arraste o **Bah** pra pasta Aplicativos. Precisa do macOS 13 (Ventura) ou mais novo.

> ⚠️ A versão de Mac é nova e ainda não tem assinatura nem notarização da Apple, então, na primeira vez que você abrir, o macOS geralmente diz que o Bah *"está danificado e não pode ser aberto"* — ele não está danificado, é só a falta da assinatura. Abra o Terminal, rode `xattr -cr /Applications/Bah.app` e depois abra o Bah normalmente. Ainda não tem atualização automática no Mac: pra atualizar, baixe o `.dmg` novo, substitua o app e rode o comando `xattr` de novo. Netflix, Prime Video e Disney+ ainda não tocam na versão de Mac.

> 🍺 **Baixar vídeo/áudio no macOS usa as ferramentas do [Homebrew](https://brew.sh):** `brew install yt-dlp deno ffmpeg` (ou `brew bundle` num clone deste repositório, com o [`Brewfile`](Brewfile)). O build de Mac não baixa nem roda programas sozinho (app sem assinatura rodando binário recém-baixado é o que o macOS mais desconfia); o Homebrew instala e atualiza. Sem o ffmpeg, só o download de áudio funciona, no formato original (geralmente M4A). O resto funciona sem eles.

**👨‍💻 Quero mexer no código:** clone e rode — veja [Como rodar](#como-rodar) abaixo.

---

## O que ele faz

- **Navegador completo** com abas, navegação, URL, tema dark
- **Painel AGENTE** lateral: digita um comando → a IA decide passo a passo até concluir
- **Lê a página** (DOM, elementos interativos numerados e OCR) e age por ferramentas estruturadas — sem depender de "enxergar" a tela
- **IA**: gerar imagem **funciona grátis de cara** (sem chave). Conversar e o agente autônomo completo precisam de chave — **DeepSeek** (barato, recomendado) — também **Mistral** / **NVIDIA NIM** — ou **Ollama** (local/offline, grátis)
- **Sessões do assistente nas suas abas** — na 1ª vez que você usa o assistente numa aba ela ganha uma sessão: um chip colorido com um nome curto ("Job hunt", "Groceries") na barra de abas, como um grupo de abas do Chrome. As abas de uma sessão dividem a mesma conversa — as que o agente abre, e os links que você abre a partir de uma aba da sessão, entram nela; botão direito na aba adiciona a uma sessão ou tira dela; clique no chip para renomear ou mudar a cor
- **Uma memória por sessão, do tamanho de um modelo local pequeno** — o agente e o chat dividem a conversa da sessão (pedidos, respostas, resumos das tarefas, fatos, itens 📌 fixados) dentro de um orçamento fixo de tokens, então a página nunca perde espaço. Quando enche, os itens mais antigos viram resumo **à vista** no painel (abre pra ler o resumo; `/compact` quando quiser). Um **medidor de contexto** ao lado do nome do modelo mostra `contexto 6.1k / 16k · conversa 2.3k` e, num toque, o que ocupou a janela
- **A conversa volta depois de reiniciar** com ⋮ → Ao abrir o Bah → "Continuar de onde parou", e o **🕘 Histórico de conversas** (⋮) lista as sessões passadas — abra só pra ler ou **Retome**, reabrindo as abas dela. Guardado cifrado neste computador, nunca das abas anônimas, apagado no "Limpar dados de navegação"
- **Entende continuação** — "você clicou?" é respondido com o registro do que o agente acabou de fazer (não com busca na web); "abriu uma janela, mas não a segunda" manda o agente terminar o que faltou; "isso" / "essa" num pedido novo é a última coisa em que o agente agiu
- **"Resuma minhas abas abertas"** — uma linha por aba e um resumo geral, cada uma com link pra ir até ela. Pergunta antes de ler suas abas (ou segue sua escolha sempre/nunca), pula abas anônimas e páginas internas, e deixa as abas dormindo quietas a menos que você peça
- **Economia de memória** — igual à do Chrome: abas que você não usa há um tempo (⋮ → 💤: Moderada 2 h, Equilibrada 30 min, Máxima 10 min) liberam a memória e recarregam ao clicar. Nunca abas tocando áudio/vídeo, usando câmera, microfone ou a tela, baixando, com formulário pela metade, fixadas, com notificações ou dispositivo conectado, na sua lista "manter estes sites sempre ativos", ou com tarefa da IA rodando ou esperando você
- **Roteamento em linguagem natural** — pedidos que começam com uma ação ("procure…", "pesquise…", "abra…", "candidate-se…") vão pro agente; perguntas ganham resposta. Erros de digitação como "open 2 windos … a different video in each" ainda abrem 2 vídeos
- **Roteador local opcional** — baixe uma vez um modelo pequeno (Qwen2.5-1.5B, 1,1 GB, Apache-2.0; ele pergunta antes) e cada mensagem é rotulada no seu próprio computador antes de chegar na IA: tarefa, pergunta sobre a página, pergunta pra web ou conversa. Entende erro de digitação ("search for a set of new golf blubs"); seu texto nunca sai do computador; sem ele as regras de palavras decidem como antes. Em GPU integrada (por exemplo, Intel Iris Xe) ele roda na CPU. Em pedidos de "achar/baixar" sobre uma obra nomeada ele também deixa o pedido preciso antes da IA grande começar ("clipes de top gun com tom cruise" → "…o filme Top Gun de 1986…"), mostrado como **🔎 Entendido como: …**; a IA grande recebe os dois textos e o seu manda
- **Atalhos de uma tacada**: abrir N vídeos de uma vez, pular pro momento exato em que uma frase é dita em vários vídeos, **conversar sobre um vídeo do YouTube usando a transcrição**, comparar preços, buscar notícias — atalhos determinísticos que gastam zero tokens
- **Skills de navegação** — receitas curtas `SKILL.md` (popups, calendários, autocomplete, EULAs, seletor de SO, downloads, compras, viagens, pesquisa de pessoas, listas de cartões, login) escolhidas a cada passo; salve as suas depois de uma tarefa que deu certo — ver [CONTRIBUTING-SKILLS.md](CONTRIBUTING-SKILLS.md)
- **UI em inglês por padrão**, com **Português** e **Español** disponíveis nas Configurações — a IA responde no idioma que você escolher
- **Adblock** completo (EasyList + EasyPrivacy) com bypass automático em sites que quebram (YouTube, Twitch)
- **Safe Browsing** (lista de domínios comprometidos da [NetAPI](https://netapi.com/compromised-urls/), atualiza diariamente)
- **Cliques reais de mouse** via Chromium `sendInputEvent` (não synthetic — passa por React, Vue, Angular sem ser ignorado)
- **Compatibilidade com sites modernos** — se apresenta como um Chrome atual no seu SO real (user agent, client hints e idiomas definidos de forma consistente dentro do motor; GPU/CPU/memória reais; `navigator.webdriver` fica com o motor) pra não ser bloqueado por engano
- **Overlay visual** estilo Comet — borda pulsante, scan line, ripple no clique, label de status

---

## Stack

| Camada | Tecnologia |
|---|---|
| Shell do navegador | **Electron 44** + Chromium |
| UI | **React 19** + **TypeScript** + Vite |
| IA (nuvem) | **DeepSeek** (recomendado) · **Mistral** · **NVIDIA NIM** |
| IA (local) | **Ollama** |
| Adblock | `@ghostery/adblocker-electron` |
| Webview | Tag `<webview>` com partition persistente |

---

## Loop ReAct do agente (núcleo)

```
USUÁRIO → "abre o gmail e apaga os spams"
        │
        ▼
┌───────────────────────────────────────────────┐
│  para cada passo em 1..25:                     │
│    1. observePage(webview)                     │
│       → { url, title, interactive_elements }   │
│    2. captureScreenshot()                      │
│    3. a IA decide UMA ação:                    │
│       { action: { type, ...params } }          │
│    4. executa via INPUT REAL do SO             │
│    5. espera, re-observa, se auto-avalia       │
│    6. se action == 'done' → retorna            │
└───────────────────────────────────────────────┘
```

### Ferramentas que a IA pode chamar

| Ação | O que faz |
|---|---|
| `click_ref(N)` | Clica no elemento de id N da lista observada |
| `fill_ref(N, value)` | Preenche o input N com `value` (e confere se entrou) |
| `click_text(text)` | Acha por texto visível e clica |
| `click_at(x, y)` | Clique em coordenada exata (fallback visual) |
| `type(text)` / `press(key)` | Digita no campo focado / envia uma tecla |
| `navigate(url)` / `scroll(dir)` | Vai pra URL / rola |
| `new_tab` / `switch_tab` / `close_tab` | Gerência de abas |
| `extract_text(offset?, max_chars?)` | O miolo da página em Markdown; página longa em partes via `offset`, no tamanho do contexto livre do modelo |
| `get_html(selector?, offset?, max?)` | HTML limpo de um seletor ou da página — refs `[#N]`, marca `[hidden]`, sem segredos nem scripts; pra botões duplicados, campos sem rótulo, dropdowns customizados; paginado como o `extract_text` |
| `done(reason, success)` | Encerra o loop |

O clique acontece via `webContents.sendInputEvent` no main process — um evento de mouse **real** do Chromium, não synthetic, então sites com React/Vue/anti-bot respondem normal. Antes do clique, o ponteiro vai até o alvo pelo mesmo arco do cursor do agente que o Bah desenha na tela (sem tremor aleatório), então os eventos `mousemove` da página batem com o que você vê. A IA prefere o caminho **DOM-first** (`click_ref`), com fallback pra texto e depois coordenada.

Iframes também contam: campos e botões de formulários embutidos (candidatura de vaga, campos de pagamento, widget de reserva) — da mesma origem ou de outro site — aparecem na lista de elementos marcados com `frame="host"`, e `click_ref` / `fill_ref` funcionam neles do mesmo jeito.

---

## Como rodar

```bash
git clone https://github.com/alexvilelabah/bah-browser.git
cd bah-browser
npm install
npm run build
npm start        # ou: npx electron .
```

Atalho Windows: clique duplo em `Abrir-Bah.bat`.

### Configurar a IA

1. Abra o navegador, clique no botão **AI** na barra de endereço.
2. Engrenagem → escolha o provedor.
3. Escolha **DeepSeek**, **Mistral** ou **NVIDIA NIM** e cole a chave dele (a da DeepSeek é baratíssima) → Salvar. Gerar imagem funciona sem chave de qualquer jeito; conversar e o agente precisam de uma dessas (ou do Ollama local, próximo passo).
4. **Local (opcional, grátis/offline):** instale o [Ollama](https://ollama.com) e **deixe-o rodando** (fica na bandeja e serve os modelos em `127.0.0.1:11434`). Depois baixe um modelo dentro do Bah (☁️/🏠 → 🏠 IA Local → digite o nome → **Baixar**) ou no terminal (ex.: `ollama pull qwen3:14b`). O local roda offline, mas a nuvem (DeepSeek) é mais confiável.

---

## Segurança e limites

O agente opera com privilégios de navegador, então vale deixar claro o que ele faz e não faz:

> ⚖️ **Você está no controle — e é responsável.** O Bah age na sua sessão real, na sua conta. Use dentro dos termos de cada site e da lei. Ações sensíveis (pagar, comprar, excluir, inserir dados de cartão) sempre pedem sua confirmação antes.

> 🔍 **Audite você mesmo.** O modelo de ameaça completo, um checklist de verificação (cada proteção → o arquivo exato), o que sai da sua máquina e a lista honesta de tradeoffs estão em **[SECURITY.pt-BR.md](SECURITY.pt-BR.md)**. O mapa do código — cada arquivo, o loop do agente, o build — está em **[ARCHITECTURE.pt-BR.md](ARCHITECTURE.pt-BR.md)**. O `src/` inteiro são ~30 arquivos.

- **É a sua sessão real.** O navegador usa partition persistente (`persist:browser`), então cookies e logins ficam salvos. Se você está logado no Gmail no Bah, o agente também está. **A IA acessa tudo que você acessaria manualmente.** Não logue em contas que não confiaria a um assistente.

- **Freio de segurança em ações sensíveis.** Antes de **pagar, comprar, excluir ou meter dados de cartão**, o agente **para e pede sua confirmação** — e isso vale em *todos* os caminhos (clique do modelo, clique por coordenada, Enter numa página de pagamento, atalhos aprendidos e automações repetidas). Nunca faz isso em silêncio.

- **Pop-ups das páginas não travam nada.** O `alert`/`confirm` de um site abre na caixa do próprio Bah, não na nativa que travava a página (e o agente). Durante uma tarefa, alerts são fechados e confirms comuns aceitos (o agente pode armar a resposta antes com a ação `dialog`); um confirm que parece **pagamento ou exclusão vai pra você**.

- **Parar é parar.** O botão ■ Parar cancela na hora, mesmo no meio de uma chamada ao modelo ou do loop; uma resposta atrasada não "ressuscita" a tarefa cancelada.

- **Sem falso sucesso.** Depois de um preenchimento, o agente confere se o campo realmente ficou com o valor; se uma ação não surtiu efeito, ele muda de estratégia em vez de relatar sucesso.

- **Pede ajuda quando trava.** Em CAPTCHA, login ou paywall ele **para e pede pra você assumir**, e depois retoma — não fica se debatendo.

- **Entra na conta só com você.** Quando a tarefa precisa da sua conta ("minha lista", "minhas vagas salvas", pedidos, caixa de entrada) o agente pode clicar uma vez no **Entrar** do site; no formulário de login o Bah **pausa** — você entra (clique no campo de usuário para escolher um login salvo no gerenciador de senhas do Bah, ou digite) e aperta Continuar. O agente nunca digita nem vê senha e nunca chuta um usuário. O Bah acompanha se você **entrou ou não em cada site** e avisa o agente a cada passo, pra ele não clicar Entrar de novo nem supor páginas que não vê.

- **Ritmo por site.** Ações que mexem na página esperam um intervalo aleatório de 1–5 s entre si no mesmo site; depois que o site mostra uma checagem anti-robô, 15–30 s pelos próximos 30 minutos. Só deixa o agente mais lento — não contorna a checagem.

- **Limite de 25 passos por comando.** Se a tarefa não concluir em 25 ações, o agente para sozinho.

- **Compatibilidade, não evasão.** A gente se apresenta como um Chrome padrão e atual (user agent, client hints e idiomas definidos de forma consistente dentro do motor — sem remendar scripts da página) só pra não ser bloqueado por engano. **Não** burlamos CAPTCHA, não driblamos rate-limit, não automatizamos o que os sites proíbem nos termos. Sites cujos termos proíbem automação (LinkedIn, por padrão) ficam em **modo cuidadoso**: uma página por pedido mais leitura — sem clique, digitação nem rolagem automáticos; a segunda ação recusada encerra a tarefa e diz o que fazer à mão.

- **🔑 Login do Google — use o botão "Entrar no Google".** O Google bloqueia login *dentro* de navegadores embutidos (Electron/webview). O Bah resolve do jeito certo: clique em **🔑 Entrar no Google** → ele abre o login no seu **Chrome/Edge real** (onde o Google confia), você loga, e o Bah **detecta sozinho**, importa a sessão (cookies via CDP) e fecha a janela de login. Faça **uma vez** e fica logado.

- **📥 Downloads sem limite de tipo ou tamanho.** Qualquer tipo de arquivo pode ser baixado (instaladores inclusive), gravado direto no disco. **Torrents:** por padrão, arquivos `.torrent` baixam como qualquer arquivo e links `magnet:` abrem no app de torrent do sistema; ligue **🧲 Cliente de torrent embutido** no menu pra abrir no card de torrent do próprio Bah. Detalhes em [ARCHITECTURE.pt-BR.md](ARCHITECTURE.pt-BR.md#downloads-e-torrents).

- **Adblock pausa em sites conhecidos.** YouTube e Twitch entram em bypass automático pro player não ser bloqueado pelo anti-adblock deles. No resto, o adblock fica ativo.

**Ainda não implementado** (mas seria bom): um modo "ver o plano e aprovar" antes de executar e sandbox separado por aba.

---

## Comparação com outros agentes

|  | **Bah** | Comet | Browser-Use |
|---|---|---|---|
| Código aberto | ✅ | ❌ | ✅ |
| Opção 100% local (Ollama) | ✅ | ❌ | ✅ |
| Roda em casa | ✅ | ❌ | ❌ (só lib) |
| IA na nuvem **ou** local | ✅ | ❌ (só nuvem) | ✅ |
| Cliques reais (não synthetic) | ✅ | ✅ | ✅ |
| UI completa | ✅ | ✅ | ❌ |
| Adblock + Safe Browsing | ✅ | ✅ | ❌ |
| Confirmação antes de ação sensível | ✅ | ⚠️ | ❌ |

> ℹ️ O caminho de IA **testado e recomendado é o DeepSeek (nuvem)**; o local (Ollama) também funciona, mas é **menos validado**.

---

## Licença

**MIT** — veja o arquivo [LICENSE](LICENSE).

Em resumo:

- Livre e open source.
- Pode usar, modificar, redistribuir e usar comercialmente.
- Mantenha o aviso de copyright e licença.
- Sem garantia. Vem "como está".

---

## Contato

- 📧 **Email**: **alexmachadovilela@gmail.com**
- 🐦 **X / Twitter**: [@alexvilelaba](https://x.com/alexvilelaba)
- 🐛 **Bugs / ideias**: [abra uma issue](https://github.com/alexvilelabah/bah-browser/issues)

Feito com 🧉 por **Alex Vilela** — **VilelaLab**.
