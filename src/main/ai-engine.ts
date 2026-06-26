export type AIProvider = 'anthropic' | 'openai' | 'deepseek' | 'mistral' | 'nvidia' | 'pollinations' | 'ollama';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  image?: string;
}

/**
 * Limpa texto raspado antes de virar JSON pro provedor de IA. Páginas (YouTube,
 * redes) têm emojis = pares surrogate UTF-16; quando o texto é cortado (.slice)
 * no meio de um par, sobra um surrogate ÓRFÃO. JSON.stringify o vira um escape
 * "\udXXX" desemparelhado, e o parser estrito do DeepSeek rejeita
 * ("unexpected end of hex escape" → HTTP 400). Removemos surrogates órfãos e
 * caracteres de controle crus. Pares válidos (emojis inteiros) passam normalmente.
 */
function sanitizeForJson(s: string): string {
  if (!s) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) continue; // controle cru (mantem tab/nl/cr)
    if (c >= 0xD800 && c <= 0xDBFF) {                          // high surrogate
      const n = s.charCodeAt(i + 1);
      if (n >= 0xDC00 && n <= 0xDFFF) { out += s[i] + s[i + 1]; i++; continue; } // par valido
      continue;                                                // high orfao -> remove
    }
    if (c >= 0xDC00 && c <= 0xDFFF) continue;                  // low orfao -> remove
    out += s[i];
  }
  return out;
}

const BROWSER_AGENT_SYSTEM_PROMPT = `You are an AI browser agent embedded in a web browser. You operate the page by choosing exactly one structured browser tool per step.

You MUST return ONLY a JSON object with this EXACT shape — no other keys, no nested wrappers, no arrays:
{
  "evaluation": "Success | Failed | Unknown — short judgement of whether YOUR PREVIOUS action achieved its goal",
  "thought": "Brief explanation of the next step",
  "action": "click_text",
  "text": "Gmail"
}

The "evaluation" key is REQUIRED. Before choosing the next action, look at RECENT HISTORY and the current page and honestly judge your PREVIOUS action: did it work? Start it with one of: "Success", "Failed", or "Unknown", followed by a short reason (e.g. "Failed — the page did not change, the button was probably an ad"). On the very first step write "Unknown — first step". This self-check is mandatory and helps you avoid repeating mistakes.

The "action" key is REQUIRED and must be a string matching one of the tool names below. Any additional parameters required by the tool must be flat properties at the root of the JSON object alongside "evaluation", "thought" and "action". NEVER nest parameters inside the action key. If you have nothing to do, use action: "done" and provide a "reason" and "success" boolean.

OPTIONAL FAST MODE — batching multiple actions in one step:
When you are CONFIDENT about a short sequence of actions on the SAME page that won't need re-thinking, you MAY return an "actions" array instead of a single action, to run them in sequence without another round-trip. Each item is a full action object with its own "action" key and flat params:
{
  "evaluation": "...",
  "thought": "Fill the search box and submit",
  "actions": [
    { "action": "fill_ref", "ref": 3, "value": "snoop dogg" },
    { "action": "press", "key": "Enter" }
  ]
}
Rules for "actions":
- Only batch 2-4 SAFE, predictable steps on the SAME page (e.g. fill then Enter, or fill several form fields in a row).
- Only these types may be batched: fill_ref, fill, type, press, click_ref, click_text, scroll.
- Do NOT batch navigations, new_tab, switch_tab, done, report, or anything whose RESULT you must see before deciding the next step. For those, return a single action.
- The system stops the batch automatically if the page changes or an element disappears, then re-thinks. If unsure, just return ONE action.

Never generate JavaScript, CSS selectors unless using the fill tool selector field, or invented function names. The browser will execute only these action types:
- switch_tab: { "action": "switch_tab", "tab": number } — focus another open tab by its number from the TABS list.
- new_tab: { "action": "new_tab", "url": string } — open a new tab on the given URL.
- close_tab: { "action": "close_tab", "tab": number } — close a tab by its number.
- plan: { "action": "plan", "steps": string[] } — EMIT FIRST on complex/multi-step tasks. List the steps you'll take.
- store: { "action": "store", "key": string, "value": any, "source"?: string } — save extracted data into agent MEMORY.
- extract_text: { "action": "extract_text", "max_chars"?: number } — extracts the MAIN CONTENT of the page (Readability-style: picks the densest text block, strips ads/nav/sidebar/footer) and returns it as clean Markdown (# headings, - lists). Token-efficient — use it for reading/summarizing articles and pages.
- search_images: { "action": "search_images", "query": string, "min_width"?: number, "count"?: number } — PREFERRED way to find images. Searches free high-resolution, rights-clean image APIs (Creative Commons / Wikimedia) and returns DIRECT downloadable URLs with real dimensions into your history ("IMAGES FOUND"). No page navigation needed. Then use download with the [imgN] URLs.
- extract_images: { "action": "extract_images", "min_width"?: number } — lists the <img> elements of the CURRENT page. Only use when the user wants an image from a SPECIFIC website they named; otherwise use search_images.
- harvest_images: { "action": "harvest_images", "query": string, "count"?: number, "min_width"?: number } — image harvest: scrapes a search engine (DuckDuckGo/Bing) and downloads N images (1 to 100) into Downloads/<theme>/ in parallel. Use for "baixe N imagens de X", "quero 20 fotos de Y". Set min_width 1000 for "alta qualidade/HD". One action does everything (harvest + parallel download), shows thumbnails and auto-finishes. Prefer this whenever the user wants to DOWNLOAD images.
- generate_image: { "action": "generate_image", "prompt": string, "count"?: 1-4 } — GENERATES new images from a text description (Pollinations, free, no key). For "gere/crie/desenhe uma imagem de X", "generate an image of Y". Saves to Downloads and shows thumbnails; one action, auto-finishes. This CREATES images — different from harvest_images, which downloads EXISTING ones from search.
- download: { "action": "download", "url": string, "filename"?: string } — downloads a file (image, pdf, etc.) from a direct URL into the user's Downloads folder. Executable files are blocked. Use the URLs returned by extract_images. May be batched in "actions" to download several files in one step.
- download_video: { "action": "download_video", "query"?: string, "url"?: string, "audio_only"?: boolean, "count"?: number } — downloads a video/song. BEST: pass "query" (e.g. the song/video name) and it finds AND downloads the top YouTube result directly — no need to open YouTube or click results. Or pass "url", or omit both to grab the currently open tab. Set audio_only:true to save as mp3 (for "baixar música/áudio"). Set count:N to grab the top N results (for "baixe 3 músicas do X"). Video downloads at the BEST available quality of that video BY DEFAULT — only set "quality":"low" if the user explicitly asks for low resolution ("baixa resolução"). Live progress bar; the task auto-finishes on success.
- open_video: { "action": "open_video", "query": string } — opens and PLAYS the single best REAL YouTube video for the query, skipping Shorts/very-short clips (resolves it server-side, then navigates the tab to the watch page). Use for "mostre/abra/toque um vídeo de X", "toque uma música do Y", "mostre alguém fazendo Z". One action, auto-finishes. NEVER just dump the user on a YouTube search results page for these — the top results are Shorts; use open_video instead.
- create_playlist: { "action": "create_playlist", "songs": string[], "name"?: string, "private"?: boolean } — builds a YouTube playlist that PLAYS IMMEDIATELY from a list of songs YOU name. For "crie/monte uma playlist com as N músicas [mais antigas/melhores/mais tocadas] de ARTISTA": use YOUR music knowledge to fill "songs" with the actual N real song titles in the requested order (e.g. oldest-first), each prefixed with the artist for accurate matching, e.g. ["2Pac Brenda's Got a Baby","2Pac Trapped","2Pac If My Homie Calls", ...]. If the user gave a NAME for the playlist (e.g. "com o nome i.a", "chamada X") put it in "name". If the user wants it PRIVATE/particular/privada, set "private": true. The system resolves each title to a real video (skipping Shorts), builds the playlist playing, and — when a name is given or the user asked to save — SAVES it to the logged-in account (renaming + setting privacy via the YouTube UI). Emit this as a SINGLE action. After it, the page is on the playlist: if RECENT HISTORY says the save still needs a step, follow that instruction; otherwise you're done.
- open_video_cuts: { "action": "open_video_cuts", "phrase": "...", "count"?: N (default 4) } — finds YouTube videos where the PHRASE IS SPOKEN (subtitle index search) and opens each one in a BACKGROUND tab, PAUSED and muted at the EXACT second it is said; when the user clicks the tab, the video plays from that moment. Use for supercut/edição requests like "abrir vídeos onde falam X", "achar quem disse Y". One action does everything; the task auto-finishes.
- make_supercut: { "action": "make_supercut", "phrase": "...", "count"?: N (default 6, max 12) } — finds N YouTube videos where the PHRASE IS SPOKEN and downloads each clip as a SEPARATE file (best quality) into Downloads/clips-<phrase>/. For "faça um supercut de X", "baixe trechos de gente falando Y". Does NOT glue them (clean, full-quality clips the user assembles). One action does everything and auto-finishes.
- render_view:{ "action": "render_view", "title": "...", "columns": ["A","B"], "rows": [["x",1],["y",2]], "chart"?: { "type":"bar", "label":"...", "labels":[...], "values":[...] }, "subtitle"?, "source_note"? } — renders the data as a BEAUTIFUL local page (sortable table + search + bar chart, dark theme) opened in a new tab. WHENEVER the user asks for a table/ranking/comparison/statistics, gather the data first (extract_text, Google) and finish with render_view — NEVER dump a table as chat text. Keep rows ≤ 40 when you type them yourself.
- stock_movers: { "action": "stock_movers", "direction": "gainers"|"losers", "count"?: N } — fetches today's top stock gainers/losers DIRECTLY from free finance APIs (B3 first, US fallback) and opens the rendered table+chart page. For any "ações que mais subiram/caíram" request use THIS as the single first action — never browse finance sites for it.
- compare_prices: { "action": "compare_prices", "query": "..." } — for ANY price/shopping request ("preço de X", "X mais barato", "quanto custa Y", "onde comprar Z"): scrapes Google Shopping (which aggregates Mercado Livre, Amazon, Magalu, KaBuM…) and opens a price-sorted comparison table. Use this as the first action for generic price requests — but if the user named a specific store/site or gave a URL, navigate there and use its own search instead of this.
- google_news: { "action": "google_news", "query": "..." } — for news requests ("notícias de X", "últimas sobre Y", "o que está acontecendo com Z"): scrapes Google News and opens a clickable headline panel (headline, source, when). Use this for news by TOPIC with NO specific site. If the user gives a specific news site or URL, do NOT use this — navigate there and use that site's own search/sections instead.
- ask_ai:{ "action": "ask_ai", "question": string } — asks ANOTHER AI (DuckDuckGo's free no-login AI chat, currently GPT-class) the given question and reads its answer back into your history ("EXTERNAL AI ANSWER"). Use it for general knowledge, reasoning, drafting, or a second opinion when you don't need a specific live website. It replaces the current tab with the AI chat. NOT for real-time facts that need a specific source (use Google for those).
- find_file: { "action": "find_file", "query": string, "filetype"?: string } — finds DIRECT download links to a specific file type using Google's filetype: operator. For "ache um PDF sobre X", "um manual em PDF de Y", "uma planilha de Z": call find_file { "query": "X", "filetype": "pdf" } (or xlsx, docx, pptx, mp3...). Results land in history as "FILES FOUND" with [fileN] URLs — then use download to save the chosen one. Default filetype is pdf.
- read_aloud: { "action": "read_aloud", "text"?: string } — reads text ALOUD with the computer's voice (text-to-speech, pt-BR). With no "text" it reads the current page's main content. Use for "leia isso pra mim", "leia a notícia em voz alta".
- report: { "action": "report", "summary": string } — FINAL action. Delivers your synthesized answer/summary to the user and ends the task.
- click_ref: { "action": "click_ref", "ref": number } — PREFERRED. Clicks the element with that id from interactive_elements. Most reliable.
- fill_ref: { "action": "fill_ref", "ref": number, "value": string } — PREFERRED for inputs. Fills the input element with that id.
- click_text: { "action": "click_text", "text": string, "nth"?: number } fallback when the right element isn't in the ref list.
- click_at: { "action": "click_at", "x": number, "y": number } clicks viewport coordinates, useful when text selection fails.
- type: { "action": "type", "text": string } types into the currently focused element.
- fill: { "action": "fill", "selector"?: string, "label"?: string, "value": string } fills an input, textarea, or rich text editor by selector, visible label, placeholder, name, or currently focused editable area.
- press: { "action": "press", "key": string } presses Enter, Tab, Escape, ArrowDown, etc.
- navigate: { "action": "navigate", "url": string } navigates directly to a URL.
- scroll: { "action": "scroll", "direction": "up"|"down"|"top"|"bottom", "amount"?: number }
- wait: { "action": "wait", "ms": number } or { "action": "wait", "selector": string, "timeout": number }
- done: { "action": "done", "reason": string, "success": boolean } ends the task.

You receive the current observed state on every step in this compact format:

TABS:
[0] (active) "Gmail - Inbox" — mail.google.com
[1] "Craiyon" — craiyon.com
[2] "YouTube" — youtube.com

URL: <current url>
TITLE: <page title>
INTERACTIVE ELEMENTS (use the [N] id with click_ref/fill_ref):
[0] <button>Sign in</button>
[1] <input placeholder="Search">
[2] <a href="/gmail">Gmail</a>
...

PAGE TEXT: <visible text snippet>
RECENT HISTORY: <previous steps>

To act on an element, use its [N] id with click_ref or fill_ref.
The TABS list shows ALL open tabs; you can use switch_tab to change which one is active. Maintain context across tabs — they are part of the same project workspace.

EXECUTION MINDSET:
- Follow the user's request LITERALLY. If they say "go to YouTube, click a video, like it" — do exactly those 3 things, in that order, on the same site. Don't overthink, don't switch sites, don't add extra steps.
- When the user gives an explicit URL or names a specific website, NAVIGATE to it (navigate action) and use ITS OWN search box, buttons and sections. NEVER replace an explicit site with a Google/Shopping/News shortcut (google_news, compare_prices) — those are only for generic requests with no site given. Build the query from the user's REAL search terms only, never from their navigation instructions.
- After each action, the next observation will reflect the new state. Trust that and continue with the NEXT step of the user's plan.
- Don't repeat or second-guess a successful action.

COMPLEX RESEARCH TASKS (multi-page, gather + synthesize):
When the user asks something like "search X, open 3 results, compare prices/specs, summarize":
1. STEP 1 — emit a 'plan' action listing concrete steps. Example:
   { "type": "plan", "steps": ["search X on google", "open result 1", "extract price", "store as price1", "back", "open result 2", "extract price", "store as price2", "open result 3", "extract price", "store as price3", "synthesize comparison", "report"] }
2. Then execute step by step using the tools.
3. After each extract_text on an article page, IMMEDIATELY call store with the key data point (e.g. { "type": "store", "key": "price", "value": 6499, "source": "techradar.com" }). Do NOT rely on history alone — MEMORY is more reliable.
4. Navigate sequentially in one tab to save context, unless you must compare two pages side-by-side.
5. After all data is in MEMORY, call report({"summary": "..."}) with your synthesized answer that USES the memory values. Without report the task is incomplete.

The PLAN and MEMORY blocks are visible to you in every observation. Use them as your scratchpad.

VERIFY BEFORE REPORTING (very important for "find a site/tool that does X" tasks):
- When the task asks you to FIND something with a required property — e.g. "a site that generates video FREE and with NO login", "a tool that works without signup", "the cheapest seller" — you MUST actually OPEN the candidate page and CONFIRM the property before reporting it.
- NEVER report a site/answer based only on a Google result title or snippet. Search snippets are often wrong or outdated. Open the real page first.
- Concretely: from the search results, click/open a promising candidate, look at its actual page. If it demands login/signup/payment when the task required "no login/free", that candidate FAILS — go back and try the next result. Only report a candidate you actually verified.
- If after trying 3-4 candidates none satisfy the requirement, report honestly what you found and that none clearly met the criteria — do not invent a passing answer.

TOGGLE BUTTONS (like/follow/subscribe/star/save):
- Elements have a "pressed" or "checked" attribute showing their toggle state.
- pressed="false" means OFF (not yet liked / not subscribed). pressed="true" means ON (already liked / subscribed).
- After you click a toggle, in the next observation the state flips. THIS IS SUCCESS — do NOT click again.
- For "like the video" type goals: clicking ONCE on a like button is enough. The next observation will show pressed="true". At that point the goal is complete — set done success:true.
- Never click a toggle button twice expecting the same effect.

TAB MANAGEMENT (IMPORTANT):
- DO NOT open a new tab unless the user EXPLICITLY asks for one ("open in a new tab", "abre em nova aba"), or the task strictly requires it (e.g., comparing two pages side-by-side).
- For a fresh task, REUSE the currently active tab — just navigate to the new URL with the navigate action.
- The active tab is the one marked "(active)" in the TABS list.

PATIENCE & PRECISION (read carefully):
- The browser already waits ~4 seconds between your actions to let animations, popups, and async content render. Trust this — never repeat an action just because the page looks similar; the change may just be slow.
- PRECISION OVER SPEED. Read the entire interactive_elements list before deciding. Confirm the right element by its text AND aria attribute when present. Don't pick the first match — pick the BEST match.
- If you are unsure which of two elements is correct, prefer the one with shorter text and matching aria-label. Avoid elements whose text starts with "Não", "No", "Don't", "Cancelar", "Remover" unless the user explicitly asked to undo something.
- For ambiguous icon-only buttons (no text, only aria), use the aria attribute as the primary identifier.
- If the screenshot still shows skeleton/loading placeholders, choose: { "type": "wait", "ms": 3000 } and re-observe before acting.

STRATEGY (in order of preference):
1. ALWAYS scan interactive_elements first. Each has an "id" — if the target is in that list, use click_ref/fill_ref with that id. This is the MOST RELIABLE path.
2. If the target is not in the list, fall back to click_text (for buttons/links) or fill (for inputs with a label).
3. Only as last resort: click_at with x,y from the screenshot.
4. For known destinations (e.g. "open Gmail"), navigate is fastest.

LEAN ON THE GIANTS (be street-smart, not heroic):
- To SEARCH, always navigate to the URL in ONE action: https://www.google.com/search?q={query}. NEVER fill the Google homepage box and click the button — that wastes steps and hits overlays.
- Google answers most questions directly in the results page (featured snippets, conversion boxes, weather).
- RESEARCH / RECOMMENDATION questions ("qual a melhor X", "procure um Y barato", "compare Z", "quanto custa W"): after the Google search, your NEXT action is extract_text to READ THE SNIPPETS, then answer. The snippets already contain product names, prices, specs and recommendations. Do NOT click the result links — they are slow, frequently fail (Google truncates/overlays them), and waste many steps. Only open a specific site if the snippets are truly insufficient.
- When the answer is a list/comparison (several products with prices/specs, a ranking), finish with render_view (a clean table) instead of a long text report — gather the data from snippets, then render it.
- Google Images: https://www.google.com/search?q={query}&udm=2 — then extract_images to get URLs.
- If Google blocks or fails, fall back to Bing: https://www.bing.com/search?q={query} (images: https://www.bing.com/images/search?q={query}).
- Wikipedia/Wikimedia for facts and HIGH-RESOLUTION images of famous artworks, people and places (Wikimedia Commons hosts original-quality files).
- archive.org (Internet Archive) is a goldmine for old games/software/music/books. To download from an item page, navigate to https://archive.org/download/ITEM_ID — it lists EVERY file as a direct link (click the format you want). IGNORE the "download 1 file"/TORRENT buttons on the item page (they give you a .torrent, not the file).
- Prefer reading a search snippet over fighting a hostile website.

VIDEO / MUSIC DOWNLOAD TASKS ("baixar o vídeo do X", "baixar a música Y", "download this video"):
- DEFAULT and ONLY good way: call { "action": "download_video", "query": "..." } as your VERY FIRST action. Do NOT navigate to YouTube, do NOT fill a search box, do NOT click results — download_video searches and downloads by itself (and skips Shorts).
- The "query" must be a CLEAN search term: just the artist + song/video title. STRIP filler words from the user's sentence like "baixe", "baixar", "a música", "o vídeo", "do", "pra mim", "por favor". Examples:
  · user "baixe uma música do 2pac" → query: "2Pac" (audio_only: true)
  · user "baixa o clipe de Evidências do Chitãozinho" → query: "Chitãozinho Xororó Evidências"
  · user "quero o vídeo tutorial de react hooks" → query: "react hooks tutorial"
- For a song/audio request, ALWAYS add "audio_only": true (saves mp3).
- MULTIPLE songs/videos — two cases:
  · N from ONE artist/topic, NOT individually named ("baixe 3 músicas do Leandro e Leonardo", "baixe duas músicas sertanejas"): ONE action with "count" → { "action": "download_video", "query": "Leandro e Leonardo", "audio_only": true, "count": 3 }. It grabs the top N distinct results.
  · Specific NAMED songs ("baixe Evidências, Sufoco e Coração"): return a SINGLE response with an "actions" array, one download_video per name → { "actions": [ {"action":"download_video","query":"Chitãozinho Xororó Evidências","audio_only":true}, {"action":"download_video","query":"... Sufoco","audio_only":true}, {"action":"download_video","query":"... Coração","audio_only":true} ] }. They all run, then it finishes.
- Only if the user is ALREADY on a specific video page and wants THAT exact one: call download_video with no query (grabs current tab).
- The download auto-completes the task on success (you'll see "DOWNLOADED" / the run ends). Never look for a download button, never retry a file that already downloaded.

GITHUB RELEASE DOWNLOADS ("baixe o ComfyUI portable mais atualizado", "latest release de X"):
- NEVER click through the github.com Releases page UI — the "Assets" toggle is unreliable and wastes many steps. Use GitHub's FREE public JSON API instead:
  1. navigate to https://api.github.com/repos/OWNER/REPO/releases/latest (no login needed). If unsure of OWNER/REPO, google "REPO github" first and read the result URL — do NOT guess the owner.
  2. extract_text — the JSON lists every asset with its "browser_download_url".
  3. { "action": "download", "url": "<browser_download_url>" } for the asset matching the user (Windows user → prefer windows/portable; NVIDIA GPU → nvidia variant).
- Shortcut when the asset name is stable: https://github.com/OWNER/REPO/releases/latest/download/ASSET_NAME always redirects to the newest version of that file.

FILE DOWNLOAD TASKS ("ache/baixe um PDF/manual/planilha/documento de X"):
- Use find_file { "query": "X", "filetype": "pdf" } as your FIRST action (filetype can be pdf, docx, xlsx, pptx, mp3, etc.). It returns "FILES FOUND" with direct [fileN] URLs.
- Then download the first good one: { "action": "download", "url": "<a [fileN] url>" }.
- Do NOT manually search Google and click results for files — find_file is faster and gives direct URLs.

IMAGE TASKS (find/download images) — DEFAULT FAST ROUTE:
- To find/download images of something ("baixe uma imagem de X", "baixe 5 fotos de Y"): use search_images { "query": "X", "count": N } FIRST. It returns DIRECT high-resolution, rights-clean URLs ("IMAGES FOUND") instantly — no navigation, no Google Images, no third-party sites.
- Then download the ones you want: batch several { "action": "download", "url": "<an [imgN] url>" } in one "actions" array. For "download N images", download the first N from the list.
- Do NOT open Google Images / Bing Images / random websites for this — that is slow and gets low-res thumbnails or watermarked copies. search_images is faster and cleaner.
- ONLY use extract_images (current-page <img> scrape) if the user explicitly wants the image FROM a specific website they named.
- Clicking a download button/link on a website ALSO works: the browser saves the file automatically to Downloads (NO save dialog appears) and a "DOWNLOAD STARTED/COMPLETED" note appears in RECENT HISTORY. Treat that as SUCCESS — never click the same download button again, and never wait for a save dialog.
- When done, report the saved filenames to the user.
5. For ANY search box, form, or editor: (a) click inside or use fill_ref, (b) type the text, (c) **YOU MUST SUBMIT**. Filling the field is NOT enough. You must either find and click the visible "Search"/"Submit"/"Generate" button, OR use the \`press\` action with key \`Enter\` as the next step.
6. If the previous action had no visible effect, do NOT repeat the same action. Try a different ref, or navigate, or scroll.
7. If a CLICK succeeds but the page does not change, the ref likely hit a wrapper element — retry ONCE with click_text using the EXACT visible label (e.g. GitHub's "Assets 7" toggle). If that also fails, find a URL-based route instead of clicking.

CRITICAL — WHEN TO RETURN done:
- ONLY after you VERIFIED the goal completed by looking at the new page state.
- For "generate image": done as soon as ANY rendered image (even small/thumbnail) appears as a result of your prompt. Do NOT switch to a different site once an image is generated. Even a tiny preview counts as success — set done with success: true.
- For "generate video/text": same rule, partial results count.
- For "search Y": done only after results are visible.
- For "open Z": done only after the page actually loaded with Z's content.
- Filling a form field is NEVER "done" — you must submit and verify the outcome.
- If you typed/filled something and the next observation shows the same form (no result yet), the goal is NOT done. Submit it.
- DO NOT abandon a working site to try another one. If your action succeeded on site A, finish on site A.`;

// Prompt do modo "resposta" (caixa unificada). O ponto-chave: deixar EXPLÍCITO que,
// neste modo, o assistente NÃO age na web — então ele nunca deve fingir progresso
// ("🔍 Pesquisando...", "a página carregou", "vou rolar"). Quando o pedido exigir
// ação, ele responde curto e propõe a tarefa numa linha [[ACTION: ...]] que a UI
// transforma num botão "⚡ Fazer isso" (ou o usuário responde "sim") → roda o agente.
const CHAT_ASSISTANT_SYSTEM_PROMPT = `You are the assistant of an AI web browser, currently in ANSWER mode. Reply in the user's language (default Brazilian Portuguese), directly and concisely. If page content is provided, use it to answer questions about the current page (summaries, "what does this article say", key points, etc.).

CRITICAL: in this mode you CANNOT act on the web yourself — you cannot click, navigate, search, scroll, fill forms, buy or download. Therefore you must NEVER fake progress or pretend you did something. Do NOT output phrases like "🔍 Searching...", "the page loaded", "let me scroll down", "I'll open the results". Nothing actually happens when you say that, and it confuses the user.

When the user's request would require ACTING on the web (search or open a site, compare prices, find news, buy, download a file/video/music, fill or submit a form, click something, log in), do this:
1) Give a brief, genuinely useful answer from your own knowledge first (likely product/option names, what to look for, etc.).
2) Then, as the VERY LAST line and nothing after it, output ONE machine-readable proposal in EXACTLY this format:
[[ACTION: <a clear imperative command, in the user's language, describing the task to run>]]

Example — user: "qual a alexa mais barata?" → you reply:
As mais baratas costumam ser o Echo Dot (5ª geração) e o Echo Pop.
[[ACTION: comparar preços de Echo Dot e Echo Pop]]

Emit at most ONE [[ACTION:]] line, only when acting would genuinely help, and never describe the action as already done. For pure questions (definitions, summaries of the current page, general chat) do NOT emit an action line.`;

// Prompts constantes — sanitizados UMA vez no carregamento do módulo para não varrer
// ~8KB caractere a caractere a cada chamada de IA (era feito em todo callDeepSeek).
const SANITIZED_AGENT_PROMPT = sanitizeForJson(BROWSER_AGENT_SYSTEM_PROMPT);
const SANITIZED_CHAT_PROMPT = sanitizeForJson(CHAT_ASSISTANT_SYSTEM_PROMPT);

// ── Idioma da "voz" do agente (i18n Fase 2) ────────────────────────────────
// O agente fala com o usuário (thought/evaluation/report/resposta) no idioma da
// UI, não no idioma da página. Setado pelo renderer via IPC (ai:set-lang). Default
// pt (comportamento anterior). JSON keys, nomes de ação e URLs ficam em inglês.
const LANG_NAMES: Record<string, string> = { en: 'English', pt: 'Brazilian Portuguese', es: 'Spanish' };
let engineLang: 'en' | 'pt' | 'es' = 'pt';
export function setEngineLang(l: string): void {
  if (l === 'en' || l === 'pt' || l === 'es') engineLang = l;
}
function langSuffix(): string {
  return `\n\nLANGUAGE: Write your "thought", "evaluation", "reason"/report text and ANY message shown to the user in ${LANG_NAMES[engineLang]}, regardless of the page's language. Keep JSON keys, action/tool names and URLs in English.`;
}

export class AIEngine {
  private provider: AIProvider;
  private apiKey: string;
  private baseUrl: string;
  private ollamaModel: string;
  private resolvedOllamaModel: string | null = null;  // modelo realmente usado (auto-detect)
  // Histórico de chat POR ABA (tabId → mensagens): cada aba do navegador tem sua própria
  // conversa (casa com o chat-por-aba da UI). Antes era um só, global, compartilhado.
  private conversationHistories = new Map<string, Message[]>();

  constructor(provider: AIProvider, apiKey: string, baseUrl?: string, ollamaModel?: string) {
    this.provider = provider;
    // Defensive trim: pasted API keys often carry a trailing space/newline,
    // which makes DeepSeek/OpenAI reject the "Bearer <key>" header with 401.
    this.apiKey = (apiKey || '').trim();
    this.baseUrl = (baseUrl && baseUrl.trim()) ? baseUrl.trim() : this.defaultBaseUrl(provider);
    this.ollamaModel = ollamaModel || 'qwen3-vl:8b';
  }

  private defaultBaseUrl(provider: AIProvider): string {
    switch (provider) {
      case 'anthropic': return 'https://api.anthropic.com';
      case 'openai': return 'https://api.openai.com';
      case 'deepseek': return 'https://api.deepseek.com';
      case 'mistral': return 'https://api.mistral.ai';
      case 'nvidia': return 'https://integrate.api.nvidia.com';
      case 'pollinations': return 'https://text.pollinations.ai';
      case 'ollama': return 'http://localhost:11434';
    }
  }

  clearHistory(tabId?: string): void {
    if (tabId) this.conversationHistories.delete(tabId);
    else this.conversationHistories.clear();
  }

  async chat(userMessage: string, pageContext?: string, stateless = false, tabId = 'default'): Promise<string> {
    const contextNote = pageContext
      ? `\n\n[Current page context]\n${pageContext.slice(0, 8000)}`
      : '';

    // Stateless: usado pela Pesquisa Rápida (síntese de snippets). NÃO entra no
    // histórico de conversa — senão cada busca enfia ~2KB de snippets no contexto
    // compartilhado, que cresceria sem limite e poluiria o chat seguinte.
    if (stateless) {
      const reply = await this.callLLM([{ role: 'user', content: userMessage + contextNote }], false);
      return typeof reply === 'string' ? reply : (reply?.text ?? '');
    }

    // Conversa DAQUELA aba (chaveada por tabId).
    const history = this.conversationHistories.get(tabId) ?? [];
    history.push({ role: 'user', content: userMessage + contextNote });

    const reply = await this.callLLM(history, false);
    const text = typeof reply === 'string' ? reply : (reply?.text ?? '');
    history.push({ role: 'assistant', content: text });
    const CAP = 40;   // teto de itens por aba (evita crescer sem limite com muitas abas)
    if (history.length > CAP) history.splice(0, history.length - CAP);
    this.conversationHistories.set(tabId, history);
    return text;
  }

  async generateAction(command: string, observedState?: string, screenshot?: string, tier: 'flash' | 'pro' = 'pro'): Promise<{ text: string; usage?: any; latencyMs: number; model: string }> {
    const contextNote = observedState
      ? `\n\n[Observed browser state and history]\n${observedState.slice(0, 12000)}`
      : '';
    const visionNote = screenshot
      ? '\n\n[A screenshot of the current page is attached. Use it with the observed interactive elements.]'
      : '';

    const t0 = Date.now();
    const reply = await this.callLLM([
      { role: 'user', content: command + contextNote + visionNote, image: screenshot },
    ], true, tier);
    if (typeof reply === 'string') {
      return { text: reply, latencyMs: Date.now() - t0, model: this.provider };
    }
    return reply;
  }

  private async callLLM(messages: Message[], isAgentMode: boolean, tier: 'flash' | 'pro' = 'pro'): Promise<any> {
    // Rastro do provedor: deixa claro QUAL engine respondeu cada request e se usou chave
    // (ex.: "[AI] provider=pollinations chat (no-key)"). Vai pro agent.log e pro console.
    const trace = `[AI] provider=${this.provider} ${isAgentMode ? 'agent' : 'chat'} (${this.apiKey ? 'key' : 'no-key'})`;
    try {
      const logPath = require('path').join(require('electron').app.getPath('userData'), 'agent.log');
      require('fs').appendFileSync(logPath, `${new Date().toISOString()} ${trace}\n`);
    } catch {}
    console.log(trace);
    switch (this.provider) {
      case 'anthropic': return this.callAnthropic(messages, isAgentMode);
      case 'openai': return this.callOpenAI(messages, isAgentMode);
      // DeepSeek does NOT support image_url — strip screenshots to avoid 400 + retry waste
      case 'deepseek': return this.callDeepSeek(messages.map(m => ({ ...m, image: undefined })), isAgentMode, tier);
      // Mistral is OpenAI-compatible; strip screenshots (text-first, avoids 400s)
      case 'mistral': return this.callMistral(messages.map(m => ({ ...m, image: undefined })), isAgentMode);
      // NVIDIA NIM is OpenAI-compatible too; same text-first treatment
      case 'nvidia': return this.callNim(messages.map(m => ({ ...m, image: undefined })), isAgentMode);
      case 'pollinations': return this.callPollinations(messages, isAgentMode);
      // Strip screenshots from local model calls — saves VRAM and avoids hangs
      case 'ollama': return this.callOllama(messages.map(m => ({ ...m, image: undefined })), isAgentMode);
    }
  }

  private async callAnthropic(messages: Message[], isAgentMode: boolean): Promise<string> {
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: (isAgentMode ? BROWSER_AGENT_SYSTEM_PROMPT : CHAT_ASSISTANT_SYSTEM_PROMPT) + langSuffix(),
      messages: messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    };

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text ?? '';
  }

  private async callOpenAI(messages: Message[], isAgentMode: boolean): Promise<string> {
    const body: any = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: (isAgentMode ? BROWSER_AGENT_SYSTEM_PROMPT : CHAT_ASSISTANT_SYSTEM_PROMPT) + langSuffix() },
        ...messages,
      ],
      max_tokens: 4096,
    };
    if (isAgentMode) body.response_format = { type: 'json_object' };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  // Mistral: OpenAI-compatible chat completions. Default model is the cheap one;
  // override via a custom baseUrl/model later if needed. Separate from DeepSeek's
  // model chain so neither path affects the other.
  private async callMistral(messages: Message[], isAgentMode: boolean): Promise<string> {
    const body: any = {
      model: 'mistral-small-latest',
      messages: [
        { role: 'system', content: (isAgentMode ? BROWSER_AGENT_SYSTEM_PROMPT : CHAT_ASSISTANT_SYSTEM_PROMPT) + langSuffix() },
        ...messages,
      ],
      max_tokens: 4096,
    };
    if (isAgentMode) body.response_format = { type: 'json_object' };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Mistral API error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  // NVIDIA NIM: OpenAI-compatible hosted endpoint (free tier). Default model is a
  // capable free one; override via custom baseUrl later if needed. Separate from the
  // other providers so nada se afeta.
  private async callNim(messages: Message[], isAgentMode: boolean): Promise<string> {
    const body: any = {
      model: 'meta/llama-3.3-70b-instruct',
      messages: [
        { role: 'system', content: (isAgentMode ? BROWSER_AGENT_SYSTEM_PROMPT : CHAT_ASSISTANT_SYSTEM_PROMPT) + langSuffix() },
        ...messages,
      ],
      max_tokens: 4096,
    };
    if (isAgentMode) body.response_format = { type: 'json_object' };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`NVIDIA NIM API error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  private async callPollinations(messages: Message[], isAgentMode: boolean): Promise<string> {
    const systemMsg = (isAgentMode ? BROWSER_AGENT_SYSTEM_PROMPT : CHAT_ASSISTANT_SYSTEM_PROMPT) + langSuffix();
    const formatted = messages.map(m => {
      if (m.image) {
        return {
          role: m.role,
          content: [
            { type: 'text', text: m.content },
            { type: 'image_url', image_url: { url: m.image } },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

    const body: any = {
      model: 'openai-fast', // free tier on Pollinations (keyless) with vision
      messages: [{ role: 'system', content: systemMsg }, ...formatted],
      max_tokens: 4096,
    };
    if (isAgentMode) body.response_format = { type: 'json_object' };

    // Endpoint OpenAI-compatible SEM chave. (O gen.pollinations.ai virou 401; este é o vivo.)
    // O free é flaky (502/503/Cloudflare) → re-tenta em 5xx/429 e devolve erro LIMPO,
    // sem despejar o HTML do Cloudflare na tela do usuário.
    const url = `${this.baseUrl}/openai`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
    };
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 700 * attempt));
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content ?? '';
      }
      lastStatus = res.status;
      try { await res.text(); } catch {}   // drena o corpo (não mostramos o HTML do erro)
      if (res.status >= 500 || res.status === 429) continue;   // transitório → re-tenta
      break;   // 4xx definitivo → para
    }
    throw new Error(`Pollinations (free) is busy right now (${lastStatus || 'no response'}). Try again in a moment — or add a DeepSeek key in settings for reliability.`);
  }

  private deepseekModelsCache: Set<string> | null = null;
  private deepseekModelsCacheAt = 0;
  private static readonly MODELS_CACHE_TTL_MS = 5 * 60 * 1000;

  private async fetchDeepSeekModels(): Promise<Set<string>> {
    const fresh = Date.now() - this.deepseekModelsCacheAt < AIEngine.MODELS_CACHE_TTL_MS;
    if (this.deepseekModelsCache && fresh) return this.deepseekModelsCache;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      const ids = new Set<string>((data.data || []).map((m: any) => m.id));
      this.deepseekModelsCache = ids;
      this.deepseekModelsCacheAt = Date.now();
      console.log('[DeepSeek] Available models:', [...ids].join(', '));
      return ids;
    } catch (e) {
      console.warn('[DeepSeek] /models probe failed (timeout/error), assuming defaults');
      // Fallback nunca deve oferecer o v4-pro (lento/inutilizável) como caminho rápido —
      // assume flash + chat, que são os modelos rápidos conhecidos.
      this.deepseekModelsCache = new Set(['deepseek-v4-flash', 'deepseek-chat']);
      this.deepseekModelsCacheAt = Date.now();
      return this.deepseekModelsCache;
    }
  }

  private async pickDeepSeekModel(): Promise<string> {
    const available = await this.fetchDeepSeekModels();
    // deepseek-v4-pro roda em "thinking mode" e é lentíssimo (~545s medido) — estoura o
    // deadline de 5 min do agente, nunca completa no loop interativo. Por isso a ORDEM é:
    // flash (rápido) → deepseek-chat (rápido, conhecido) → v4-pro só em último caso absoluto.
    // (Antes o chat vinha DEPOIS do v4-pro, então com flash ausente o agente caía no modelo
    // lento e travava — corrigido.)
    const chain = ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-v4-pro'];
    for (const id of chain) if (available.has(id)) return id;
    return 'deepseek-chat';
  }

  private async callDeepSeek(messages: Message[], isAgentMode: boolean, tier: 'flash' | 'pro' = 'pro'): Promise<any> {
    // Always tell the model TODAY's real date — its training data lives in the past
    // and it will otherwise state wrong years for "hoje"/"atual" questions.
    const now = new Date();
    const dateLine = `CURRENT DATE/TIME: ${now.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} (${now.toISOString()}). TRUST THIS DATE — your training data may believe an earlier year. Use it whenever the user asks about "hoje", "atual", current events or dates.`;
    // Prompt constante já vem pré-sanitizado (SANITIZED_*); só a dateLine (volátil,
    // poucas dezenas de chars) é sanitizada por chamada.
    const systemMsg = (isAgentMode ? SANITIZED_AGENT_PROMPT : SANITIZED_CHAT_PROMPT) + '\n\n' + sanitizeForJson(dateLine) + sanitizeForJson(langSuffix());
    // Images are already stripped upstream — DeepSeek has no vision API
    let model = await this.pickDeepSeekModel();
    const useFlash = model.includes('flash');
    // 🧠 MAESTRO: o tier 'pro' chega só nos momentos de "travou" (loop / ações sem
    // efeito). Aí ligamos o MODO PENSANTE (chain-of-thought) no MESMO deepseek-v4-flash,
    // em vez de trocar pro v4-pro (lento e ~3× mais caro). Todo o resto roda na voz
    // rápida (não-pensante, ~0,6s). É o segundo instrumento da orquestra, usado raro.
    const useThinking = isAgentMode && tier === 'pro';
    console.log(`[DeepSeek] tier=${tier} model=${model}${useThinking ? ' (thinking)' : ''}`);
    const formattedMessages = messages.map(m => ({ role: m.role, content: sanitizeForJson(m.content) }));

    const body: any = {
      model,
      messages: [{ role: 'system', content: systemMsg }, ...formattedMessages],
      max_tokens: useThinking ? 16384 : 4096,   // espaço para o raciocínio + a ação final
      temperature: 0,                            // ignorado no modo pensante (sem efeito, ok)
    };
    if (isAgentMode) {
      if (useThinking) {
        // Liga o raciocínio. NÃO forçamos json_object junto (compat não garantida com
        // thinking) — o parser tolerante (page-agent) extrai o objeto JSON do content.
        body.thinking = { type: 'enabled' };
        body.reasoning_effort = 'high';
      } else {
        body.response_format = { type: 'json_object' };
      }
    }

    const t0 = Date.now();
    const bodyJson = JSON.stringify(body);
    const sizeKB = (bodyJson.length / 1024).toFixed(0);
    const logMsg1 = `[DeepSeek] → POST /v1/chat/completions (${sizeKB}KB, model=${model})`;
    console.log(logMsg1);
    try {
      const logPath = require('path').join(require('electron').app.getPath('userData'), 'agent.log');
      require('fs').appendFileSync(logPath, `${new Date().toISOString()} ${logMsg1}\n`);
    } catch {}
    // Retry com backoff exponencial para erros transitórios (timeout / rede / 429 / 5xx).
    const MAX_ATTEMPTS = 3;
    const appendLog = (line: string) => {
      try {
        const logPath = require('path').join(require('electron').app.getPath('userData'), 'agent.log');
        require('fs').appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
      } catch {}
    };
    let res: Response | null = null;
    let lastErr: any = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const fetchPromise = fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
        body: bodyJson,
      });
      // Pensar (chain-of-thought) leva bem mais tempo que a voz rápida — damos folga.
      const reqTimeoutMs = useThinking ? 90000 : 45000;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<Response>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`DeepSeek request timeout (${reqTimeoutMs / 1000}s)`)), reqTimeoutMs);
      });
      try {
        const candidate = await Promise.race([fetchPromise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
        // Retry server-side transient failures (429 rate-limit, 5xx) — but not 4xx like 401/404.
        if ((candidate.status === 429 || candidate.status >= 500) && attempt < MAX_ATTEMPTS) {
          const wait = 800 * Math.pow(2, attempt - 1);
          appendLog(`[DeepSeek] ${candidate.status} transient → retry ${attempt + 1}/${MAX_ATTEMPTS} in ${wait}ms`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        res = candidate;
        break;
      } catch (e: any) {
        lastErr = e;
        const errMsg = `[DeepSeek] ← ERROR (attempt ${attempt}/${MAX_ATTEMPTS}) after ${Date.now() - t0}ms: ${e?.message ?? e}`;
        console.error(errMsg);
        appendLog(errMsg);
        // The v4-pro "thinking" model is often too slow for interactive use. On a
        // timeout, don't keep retrying the slow model — immediately fall back to the
        // fast flash model (reliable in practice).
        if (/timeout/i.test(String(e?.message)) && useThinking) {
          appendLog('[DeepSeek] thinking timed out → retry sem pensar (flash rápido)');
          console.warn('[DeepSeek] thinking timed out → retry without thinking (fast flash)');
          return this.callDeepSeek(messages, isAgentMode, 'flash');
        }
        if (attempt < MAX_ATTEMPTS) {
          const wait = 800 * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw e;
      }
    }
    if (!res) throw (lastErr ?? new Error('DeepSeek request failed after retries'));
    const logMsg2 = `[DeepSeek] ← ${res.status} in ${Date.now() - t0}ms`;
    console.log(logMsg2);
    try {
      const logPath = require('path').join(require('electron').app.getPath('userData'), 'agent.log');
      require('fs').appendFileSync(logPath, `${new Date().toISOString()} ${logMsg2}\n`);
    } catch {}

    if (!res.ok) {
      const errText = await res.text();
      const errMsg = `[DeepSeek] error ${res.status}: ${errText.slice(0, 400)}`;
      console.error(errMsg);
      try {
        const logPath = require('path').join(require('electron').app.getPath('userData'), 'agent.log');
        require('fs').appendFileSync(logPath, `${new Date().toISOString()} ${errMsg}\n`);
      } catch {}
      // Flash failed (404/model_not_found) → mark unavailable and retry on pro
      if (useFlash && (res.status === 404 || errText.includes('model') || errText.includes('not found'))) {
        console.warn(`[DeepSeek] ${model} failed → falling back to pro`);
        if (this.deepseekModelsCache) this.deepseekModelsCache.delete('deepseek-v4-flash');
        return this.callDeepSeek(messages, isAgentMode, 'pro');
      }
      if (res.status === 401) {
        throw new Error('Invalid or missing DeepSeek API key. Open the agent settings (sidebar) and paste your key starting with "sk-".');
      }
      throw new Error(`DeepSeek API error ${res.status} (${model}): ${errText}`);
    }

    let data: any = null;
    try {
      data = await res.json();
    } catch (e) {
      const errMsg = `[DeepSeek] response body parse failed: ${String(e)}`;
      console.error(errMsg);
      try {
        const logPath = require('path').join(require('electron').app.getPath('userData'), 'agent.log');
        require('fs').appendFileSync(logPath, `${new Date().toISOString()} ${errMsg}\n`);
      } catch {}
    }
    const text = data?.choices?.[0]?.message?.content ?? '';
    if (!text) {
      const dbg = `[DeepSeek] empty content. data=${JSON.stringify(data).slice(0, 500)}`;
      console.warn(dbg);
      try {
        const logPath = require('path').join(require('electron').app.getPath('userData'), 'agent.log');
        require('fs').appendFileSync(logPath, `${new Date().toISOString()} ${dbg}\n`);
      } catch {}
    }
    return {
      text,
      usage: data?.usage,
      latencyMs: Date.now() - t0,
      model,
    };
  }

  /**
   * Resolve o modelo Ollama REALMENTE disponível. Se o configurado (ex.: qwen2.5:14b)
   * não estiver instalado, usa o que houver (prefere um modelo de texto qwen/llama).
   * Evita 404 "model not found" quando o usuário troca/remove modelos.
   */
  private async resolveOllama(): Promise<string> {
    if (this.resolvedOllamaModel) return this.resolvedOllamaModel;
    try {
      const r = await fetch(`${this.baseUrl}/api/tags`);
      const data: any = await r.json();
      const avail: string[] = (data?.models || []).map((x: any) => String(x.name));
      if (avail.length === 0) { this.resolvedOllamaModel = this.ollamaModel; return this.ollamaModel; }
      const want = (this.ollamaModel || '').toLowerCase();
      let pick = avail.find(n => n.toLowerCase() === want)
        || avail.find(n => n.toLowerCase().split(':')[0] === want.split(':')[0]);
      if (!pick) {
        pick = avail.find(n => /qwen2\.5|qwen3|llama3|mistral/i.test(n) && !/vl|vision|embed/i.test(n))
          || avail.find(n => !/embed/i.test(n))
          || avail[0];
        console.warn(`[Ollama] modelo "${this.ollamaModel}" não instalado → usando "${pick}"`);
      }
      this.resolvedOllamaModel = pick;
      return pick;
    } catch {
      return this.ollamaModel; // servidor offline: deixa o erro estourar adiante (com fallback de nuvem)
    }
  }

  /** Pré-carrega o modelo local na VRAM (fire-and-forget) pra a 1ª tarefa já vir quente.
   *  Chamado quando o usuário liga o modo local. */
  async warmupOllama(): Promise<void> {
    if (this.provider !== 'ollama') return;
    try {
      const model = await this.resolveOllama();
      console.log(`[Ollama] aquecendo "${model}" na VRAM…`);
      await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'oi' }], stream: false, keep_alive: '30m', options: { num_ctx: 512 } }),
      });
      this.ollamaWarmed = true;
      console.log(`[Ollama] "${model}" pronto na VRAM.`);
    } catch (e: any) {
      console.warn('[Ollama] warmup falhou (servidor ligado?):', e?.message);
    }
  }
  private ollamaWarmed = false;

  private async callOllama(messages: Message[], isAgentMode: boolean): Promise<string> {
    const systemMsg = (isAgentMode ? BROWSER_AGENT_SYSTEM_PROMPT : CHAT_ASSISTANT_SYSTEM_PROMPT) + langSuffix();
    // Never send images to local model — it consumes too much VRAM and causes hangs
    const resolvedModel = await this.resolveOllama();
    const isGptOss = /gpt-?oss|gptoss/.test(resolvedModel.toLowerCase());
    const formatted = messages.map((m, i) => {
      let content = m.content;
      if (isAgentMode && m.role === 'user' && i === messages.length - 1) {
        // gpt-oss é modelo de raciocínio (harmony): se mandar "inclua thought/evaluation",
        // ele despeja o raciocínio nos campos e quebra o JSON (dois objetos grudados).
        // Pedimos só 1 objeto compacto no fim, raciocinando em silêncio (o raciocínio dele
        // vai pro canal 'thinking' do Ollama). Demais modelos seguem a instrução estilo-qwen.
        content += isGptOss
          ? '\n\nReturn ONLY ONE compact JSON object for your next action, as the LAST thing in your reply with nothing after it. Example: {"thought":"short","evaluation":"short","action":"click_ref","ref":3}. Reason SILENTLY — never write analysis/explanation text outside the JSON. Keep "thought" and "evaluation" to ONE short sentence each.'
          : '\n\nIMPORTANT: You must evaluate the observed state and return your next step as a structured JSON object. Wrap your JSON in ```json blocks. Do NOT output freeform analysis. ONLY output the JSON object. Write the "thought" and "evaluation" fields in Portuguese or English ONLY — never Chinese.';
      }
      return { role: m.role, content };
    });

    const model = resolvedModel;   // já resolvido acima (usa o que está REALMENTE instalado)
    const body: any = {
      model,
      messages: [{ role: 'system', content: systemMsg }, ...formatted],
      stream: false,
      keep_alive: '15m',     // keep the model hot in VRAM between agent steps
      options: {
        num_ctx: 8192,       // big enough for the DOM list + page text + history (4k truncated the page → blind agent)
        temperature: 0,      // deterministic JSON
      },
    };
    // Modo agente precisa de JSON confiável: força a gramática JSON do Ollama para os
    // modelos que a suportam bem (qwen incl. qwen3-vl, llama, mistral, gemma). Se o
    // modelo tropeçar, o parser ainda extrai o bloco ```json do texto.
    const m = model.toLowerCase();
    // gpt-oss é modelo de raciocínio (harmony): format:json conflita e ele erra/alucina.
    // Deixamos ele responder natural (raciocínio vai pro campo 'thinking') e o parser pega o JSON.
    if (isAgentMode && /qwen|llama|mistral|gemma/.test(m) && !/gpt-?oss|gptoss/.test(m)) {
      body.format = 'json';
    }

    const t0 = Date.now();
    console.log(`[Ollama] → POST /api/chat (model=${model}, isAgent=${isAgentMode})`);

    const fetchPromise = fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    // 1ª chamada carrega o modelo na VRAM (pode levar minutos num modelo grande/frio);
    // depois fica quente. Damos folga na fria e apertamos depois.
    const timeoutMs = this.ollamaWarmed ? 120_000 : 300_000;
    const timeoutPromise = new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error(`Ollama request timeout (${timeoutMs / 1000}s)`)), timeoutMs)
    );

    let res: Response;
    try {
      res = await Promise.race([fetchPromise, timeoutPromise]);
    } catch (e: any) {
      throw new Error(`Ollama connection failed: ${e.message}`);
    }
    this.ollamaWarmed = true;  // a partir daqui o modelo está na VRAM → timeout curto

    console.log(`[Ollama] ← ${res.status} in ${Date.now() - t0}ms`);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama API error ${res.status}: ${errText.slice(0, 400)}`);
    }

    const data = await res.json();
    const content = data.message?.content ?? '';
    if (!content) {
      console.warn(`[Ollama] empty content. data=${JSON.stringify(data).slice(0, 300)}`);
    }
    return content;
  }
}
