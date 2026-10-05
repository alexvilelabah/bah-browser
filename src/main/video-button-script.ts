// ─────────────────────────────────────────────────────────────────────────────
// Botão "Baixar" em cima do vídeo do YouTube — o SCRIPT injetável (dom-ready).
// Pílula semitransparente no canto do player: some junto com os controles do
// YouTube (classe ytp-autohide) e volta quando o mouse mexe. Clicou → lista as
// resoluções daquele vídeo com o tamanho; escolheu → o Bah baixa e mostra em Downloads.
//
// Conversa com o main só por console.log('BAHDL:{...}') (mesmo truque do YTAD do
// pulador de anúncio); o main responde chamando window.__bahDl.onFormats/onJob.
// O main NÃO confia no que vem daqui: o vídeo é o da URL da aba, a escolha tem que
// estar na lista que ele mesmo montou e baixar exige um clique de verdade recente.
//
// O YouTube exige Trusted Types: nada de innerHTML — só createElement/textContent.
// ─────────────────────────────────────────────────────────────────────────────

export interface VideoButtonLabels {
  btn: string;         // texto do botão
  title: string;       // cabeçalho da lista
  loading: string;     // procurando as resoluções…
  audio: string;       // só áudio (MP3)
  started: string;     // "Baixando {q}…" — {q} = resolução escolhida
  listFailed: string;  // não deu pra ler as resoluções
  live: string;        // transmissão ao vivo não dá
  retry: string;
  preparing: string;   // 1ª vez: baixando o motor
  merging: string;     // juntando vídeo e áudio
  done: string;
  failed: string;
  reveal: string;      // mostrar na pasta
  video: string;       // "Vídeo" (opção sem resolução conhecida / achada no tráfego)
  drm: string;         // vídeo protegido contra cópia
  dec: string;         // separador decimal do idioma ("," ou ".")
}

export const DEFAULT_VIDEO_BUTTON_LABELS: VideoButtonLabels = {
  btn: 'Download',
  title: 'Download this video',
  loading: 'Finding the available resolutions…',
  audio: 'Audio only (MP3)',
  started: 'Downloading {q}. Follow it in Downloads (⬇ at the top).',
  listFailed: 'Couldn\'t read this video\'s resolutions.',
  live: 'Live streams can\'t be downloaded.',
  retry: 'Try again',
  preparing: 'Getting ready (first time only)…',
  merging: 'Joining video and audio…',
  done: 'Downloaded',
  failed: 'Download failed',
  reveal: 'Show in folder',
  video: 'Video',
  drm: 'This video is copy-protected (DRM), so it can\'t be downloaded.',
  dec: '.',
};

/** Textos vindos do renderer: só strings curtas; o que faltar cai no inglês. */
export function sanitizeVideoButtonLabels(raw: unknown): VideoButtonLabels {
  const out: VideoButtonLabels = { ...DEFAULT_VIDEO_BUTTON_LABELS };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(out) as Array<keyof VideoButtonLabels>) {
      const v = (raw as any)[k];
      if (typeof v === 'string' && v.trim() && v.length <= 160) out[k] = v;
    }
  }
  return out;
}

// Visual da pílula e da lista (o script dos outros sites reaproveita, dentro do shadow DOM).
export const MENU_CSS = `
.bah-dl-btn{display:flex;align-items:center;gap:6px;height:32px;padding:0 13px 0 10px;border:1px solid rgba(255,255,255,.28);border-radius:16px;background:rgba(0,0,0,.45);color:#fff;font:500 13px/1 Roboto,Arial,sans-serif;cursor:pointer;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:.88;transition:opacity .15s,background .15s;}
.bah-dl-btn:hover,.bah-open .bah-dl-btn{opacity:1;background:rgba(0,0,0,.72);}
.bah-dl-btn svg{width:16px;height:16px;flex:none;}
.bah-dl-menu{display:none;position:absolute;top:38px;right:0;min-width:240px;overflow-y:auto;padding:6px;border-radius:12px;background:rgba(18,18,18,.9);border:1px solid rgba(255,255,255,.14);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:0 8px 28px rgba(0,0,0,.45);color:#fff;}
.bah-open .bah-dl-menu{display:block;}
.bah-dl-head{font:600 12px/1.2 Roboto,Arial,sans-serif;color:rgba(255,255,255,.7);padding:6px 8px 8px;}
.bah-dl-item{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:#fff;font:500 13.5px/1.2 Roboto,Arial,sans-serif;text-align:left;cursor:pointer;}
.bah-dl-item:hover{background:rgba(255,255,255,.13);}
.bah-dl-hint{color:rgba(255,255,255,.55);font-weight:400;font-size:12px;margin-left:7px;}
.bah-dl-sz{color:rgba(255,255,255,.62);font-size:12.5px;font-weight:400;white-space:nowrap;}
.bah-dl-msg{padding:8px 10px;max-width:260px;font:400 13px/1.4 Roboto,Arial,sans-serif;color:rgba(255,255,255,.88);}
.bah-dl-msg.err{color:#ffb4b4;}
.bah-dl-msg.ok{color:#b9f6c8;}
`;

// No YouTube a pílula mora DENTRO do player e some junto com os controles dele — menos
// antes do play (unstarted-mode): o player embutido em outro site esconde os controles
// até a pessoa dar play, e o botão sumia junto.
const CSS = `
.bah-dl{position:absolute;top:12px;right:12px;z-index:70;font-family:Roboto,Arial,sans-serif;transition:opacity .25s ease;}
.html5-video-player.ytp-autohide:not(.unstarted-mode) .bah-dl:not(.bah-open){opacity:0;pointer-events:none;}
.bah-dl.bah-dl-short{top:24px;right:auto;left:50%;transform:translateX(-50%);}
.bah-dl-short .bah-dl-menu{right:auto;left:50%;transform:translateX(-50%);}
` + MENU_CSS;

/** Gera o script com os textos no idioma da interface (JSON-escapados, sem injeção). */
export function buildVideoButtonScript(labels: VideoButtonLabels): string {
  return `
(function(){
  try {
    if (window.__bahDl) { window.__bahDl.refresh(); return; }
    var L = ${JSON.stringify(labels)};
    var CSS = ${JSON.stringify(CSS)};
    var con = window.console, rawLog = con && con.log;
    var send = function(o){ try { rawLog.call(con, 'BAHDL:' + JSON.stringify(o)); } catch(e){} };
    var vidOf = function(){
      try {
        var u = new URL(location.href);
        if (u.pathname === '/watch') { var v = u.searchParams.get('v'); return v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null; }
        var m = /^\\/(shorts|live|embed)\\/([A-Za-z0-9_-]{11})/.exec(u.pathname);
        return m ? m[2] : null;
      } catch(e){ return null; }
    };
    var formats = {};   // id do vídeo -> {state:'loading'|'ok'|'err', list, error}
    var jobs = {};      // id do vídeo -> {key, label, state, pct}
    var cur = null, open = false, note = null, noteKind = '', closeTimer = 0;

    var style = document.createElement('style');
    style.id = 'bah-dl-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);

    var box = document.createElement('div'); box.className = 'bah-dl';
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'bah-dl-btn';
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2.2');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    var p1 = document.createElementNS(NS, 'path'); p1.setAttribute('d', 'M12 4v11M7 10l5 5 5-5');
    var p2 = document.createElementNS(NS, 'path'); p2.setAttribute('d', 'M5 20h14');
    svg.appendChild(p1); svg.appendChild(p2);
    var txt = document.createElement('span');
    btn.appendChild(svg); btn.appendChild(txt);
    var menu = document.createElement('div'); menu.className = 'bah-dl-menu';
    box.appendChild(btn); box.appendChild(menu);

    // Clique no botão/lista NÃO pode chegar no player (pausaria/tela cheia).
    ['click','mousedown','mouseup','pointerdown','pointerup','dblclick','touchstart','touchend','contextmenu','wheel','keydown'].forEach(function(t){
      box.addEventListener(t, function(e){ e.stopPropagation(); }, false);
    });

    var clear = function(el){ while (el.firstChild) el.removeChild(el.firstChild); };
    var msg = function(text, kind){ var d = document.createElement('div'); d.className = 'bah-dl-msg' + (kind ? ' ' + kind : ''); d.textContent = text; return d; };
    var item = function(label, hint, size, onClick){
      var b = document.createElement('button'); b.type = 'button'; b.className = 'bah-dl-item';
      var left = document.createElement('span'); left.textContent = label;
      if (hint) { var h = document.createElement('span'); h.className = 'bah-dl-hint'; h.textContent = hint; left.appendChild(h); }
      var right = document.createElement('span'); right.className = 'bah-dl-sz'; right.textContent = size || '';
      b.appendChild(left); b.appendChild(right);
      b.addEventListener('click', function(e){ e.preventDefault(); onClick(); });
      return b;
    };

    var paint = function(){
      var j = cur && jobs[cur];
      var t = L.btn;
      if (j) {
        if (j.state === 'downloading') t = Math.floor(j.pct || 0) + '%';
        else if (j.state === 'started' || j.state === 'preparing') t = '…';
        else if (j.state === 'merging') t = '99%';
        else if (j.state === 'done') t = '✓ ' + L.done;
        else if (j.state === 'failed') t = L.failed;
      }
      txt.textContent = t;
    };

    var render = function(){
      clear(menu);
      var head = document.createElement('div'); head.className = 'bah-dl-head'; head.textContent = L.title;
      menu.appendChild(head);
      if (note) menu.appendChild(msg(note, noteKind));
      var j = cur && jobs[cur];
      if (j && j.state === 'preparing') menu.appendChild(msg(L.preparing));
      if (j && j.state === 'merging') menu.appendChild(msg(L.merging));
      var f = cur && formats[cur];
      if (!f || f.state === 'loading') { menu.appendChild(msg(L.loading)); return; }
      if (f.state === 'err') {
        menu.appendChild(msg(f.live ? L.live : L.listFailed, 'err'));
        if (!f.live) menu.appendChild(item(L.retry, '', '', function(){ formats[cur] = null; ask(); render(); }));
        return;
      }
      f.list.forEach(function(c){
        menu.appendChild(item(c.kind === 'audio' ? L.audio : c.label, c.kind === 'audio' ? '' : (c.hint || ''), c.size, function(){ pick(c); }));
      });
      if (j && j.state === 'done') menu.appendChild(item('📂 ' + L.reveal, '', '', function(){ send({ op: 'reveal', v: cur }); close(); }));
    };

    var fitMenu = function(){
      var p = box.parentNode;
      if (p && p.clientHeight) menu.style.maxHeight = Math.max(150, p.clientHeight - 56) + 'px';
    };
    var ask = function(){
      if (!cur) return;
      if (!formats[cur]) { formats[cur] = { state: 'loading' }; send({ op: 'formats', v: cur }); }
    };
    var close = function(){ open = false; box.classList.remove('bah-open'); note = null; clearTimeout(closeTimer); };
    var toggle = function(){
      if (open) { close(); return; }
      open = true; box.classList.add('bah-open'); ask(); fitMenu(); render();
    };
    var pick = function(c){
      if (!cur) return;
      send({ op: 'download', v: cur, key: c.key });
      jobs[cur] = { key: c.key, label: c.kind === 'audio' ? 'MP3' : c.label, state: 'started', pct: 0 };
      note = L.started.replace('{q}', c.kind === 'audio' ? 'MP3' : c.label); noteKind = 'ok';
      paint(); render();
      clearTimeout(closeTimer); closeTimer = setTimeout(close, 3500);
    };

    btn.addEventListener('mouseenter', ask);
    btn.addEventListener('click', function(e){ e.preventDefault(); toggle(); });
    var onDocClick = function(e){ if (open && !box.contains(e.target)) close(); };
    var onDocKey = function(e){ if (open && e.key === 'Escape') close(); };
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onDocKey, true);

    // Player certo: no /watch é o #movie_player; nos Shorts, o player que mais aparece na tela.
    var findPlayer = function(){
      if (location.pathname === '/watch') { var mp = document.getElementById('movie_player'); if (mp) return mp; }
      var best = null, bestA = 0, all = document.querySelectorAll('.html5-video-player');
      for (var i = 0; i < all.length; i++) {
        var r = all[i].getBoundingClientRect();
        var w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
        var h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
        if (w * h > bestA) { bestA = w * h; best = all[i]; }
      }
      return best;
    };
    var refresh = function(){
      var v = vidOf();
      if (v !== cur) { cur = v; close(); paint(); }
      var p = v ? findPlayer() : null;
      if (!p) { if (box.parentNode) box.parentNode.removeChild(box); return; }
      if (box.parentNode !== p) p.appendChild(box);
      // Shorts: o canto de cima à direita é do "⋮" e da tela cheia do YouTube → vai pro meio,
      // na mesma faixa dos controles (pausa/volume à esquerda, ⋮/tela cheia à direita).
      var short = /^\\/shorts\\//.test(location.pathname);
      if (box.classList.contains('bah-dl-short') !== short) box.classList.toggle('bah-dl-short', short);
    };
    var iv = setInterval(refresh, 1000);
    document.addEventListener('yt-navigate-finish', refresh);

    window.__bahDl = {
      refresh: refresh,
      onFormats: function(p){
        if (!p || !p.v) return;
        formats[p.v] = p.ok ? { state: 'ok', list: p.choices || [] } : { state: 'err', live: !!p.live };
        if (p.v === cur && open) render();
      },
      onJob: function(p){
        if (!p || !p.v) return;
        var j = jobs[p.v] || (jobs[p.v] = { key: p.key, state: 'started', pct: 0 });
        j.state = p.state;
        if (typeof p.pct === 'number') j.pct = p.pct;
        if (p.state === 'cancelled') delete jobs[p.v];
        if (p.v === cur) { paint(); if (open) render(); }
      },
      remove: function(){
        clearInterval(iv);
        document.removeEventListener('yt-navigate-finish', refresh);
        document.removeEventListener('click', onDocClick, true);
        document.removeEventListener('keydown', onDocKey, true);
        if (box.parentNode) box.parentNode.removeChild(box);
        if (style.parentNode) style.parentNode.removeChild(style);
        delete window.__bahDl;
      },
    };
    paint();
    refresh();
  } catch (e) {}
})();
`;
}
