// ─────────────────────────────────────────────────────────────────────────────
// Botão "Baixar" em QUALQUER site com vídeo (estilo IDM) — o SCRIPT injetável.
// Fora do YouTube não há um player conhecido: a pílula flutua (position:fixed) no canto
// do <video> que está debaixo do mouse e some 2,5 s depois que o mouse sai. Fica num
// shadow DOM fechado — o CSS do site não deforma o botão e o nosso não vaza pro site.
//
// "Qual vídeo é esse?": nas redes (Instagram, TikTok, X, Facebook, Threads) o feed tem
// vários vídeos na mesma URL, então sobe pelo HTML até achar o link do POST daquele
// vídeo; nos outros sites vale a URL da página. O main confere que o link é do mesmo
// site, pergunta ao yt-dlp e, se ele não souber, usa o vídeo que a aba carregou.
//
// A lista (render/pick/onFormats/onJob) é a mesma do script do YouTube.
// ─────────────────────────────────────────────────────────────────────────────
import { MENU_CSS, type VideoButtonLabels } from './video-button-script.ts';

const HOST_CSS = `
.bah-dl{position:relative;font-family:Roboto,Arial,sans-serif;}
`;

export function buildGenericVideoButtonScript(labels: VideoButtonLabels): string {
  return `
(function(){
  try {
    if (window.__bahDl) { window.__bahDl.refresh(); return; }
    var L = ${JSON.stringify(labels)};
    var CSS = ${JSON.stringify(HOST_CSS + MENU_CSS)};
    var con = window.console, rawLog = con && con.log;
    var send = function(o){ try { rawLog.call(con, 'BAHDL:' + JSON.stringify(o)); } catch(e){} };
    var formats = {};   // chave (link do post/página) -> {state, list, drm}
    var jobs = {};
    var cur = null, open = false, note = null, noteKind = '', closeTimer = 0;
    var target = null, shown = false, hideTimer = 0;

    // Host + shadow DOM fechado. Folha "construída" (adoptedStyleSheets) passa até em site
    // com CSP rígida, onde um <style> inline seria bloqueado.
    var host = document.createElement('bah-dl-host');
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483647;display:none;';
    var root = host.attachShadow({ mode: 'closed' });
    try { var sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); root.adoptedStyleSheets = [sheet]; }
    catch (e) { var st = document.createElement('style'); st.textContent = CSS; root.appendChild(st); }

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
    root.appendChild(box);
    document.documentElement.appendChild(host);

    // Clique no botão/lista não chega no player do site (pausaria/abriria o post).
    ['click','mousedown','mouseup','pointerdown','pointerup','dblclick','touchstart','touchend','contextmenu','wheel','keydown'].forEach(function(t){
      host.addEventListener(t, function(e){ e.stopPropagation(); }, false);
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
    var labelOf = function(c){ return c.kind === 'audio' ? 'MP3' : (c.label || L.video); };

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
        menu.appendChild(msg(f.drm ? L.drm : (f.live ? L.live : L.listFailed), 'err'));
        if (!f.drm && !f.live) menu.appendChild(item(L.retry, '', '', function(){ formats[cur] = null; ask(); render(); }));
        return;
      }
      f.list.forEach(function(c){
        menu.appendChild(item(c.kind === 'audio' ? L.audio : (c.label || L.video), c.kind === 'audio' ? '' : (c.hint || ''), c.size, function(){ pick(c); }));
      });
      if (j && j.state === 'done') menu.appendChild(item('📂 ' + L.reveal, '', '', function(){ send({ op: 'reveal', v: cur, url: cur }); close(); }));
    };

    var fitMenu = function(){
      var spaceBelow = innerHeight - (host.getBoundingClientRect().top + 44);
      menu.style.maxHeight = Math.max(150, spaceBelow) + 'px';
    };
    var ask = function(){
      if (!cur || formats[cur]) return;
      // EME ligado (Netflix, Globoplay pago…) = vídeo cifrado: nem pergunta, avisa.
      if (target && target.mediaKeys) { formats[cur] = { state: 'err', drm: true }; return; }
      formats[cur] = { state: 'loading' };
      // O arquivo que ESTE <video> toca (quando não é blob:) — o main só usa se a aba de
      // fato carregou esse endereço; num feed, separa este vídeo dos que vêm depois.
      var src = target && /^https?:/i.test(target.currentSrc || '') ? target.currentSrc : '';
      send({ op: 'formats', v: cur, url: cur, src: src });
    };
    var close = function(){
      open = false; box.classList.remove('bah-open'); note = null; clearTimeout(closeTimer);
      clearTimeout(hideTimer); hideTimer = setTimeout(hide, 2500);
    };
    var toggle = function(){
      if (open) { close(); return; }
      open = true; clearTimeout(hideTimer); box.classList.add('bah-open'); ask(); fitMenu(); render();
    };
    var pick = function(c){
      if (!cur) return;
      send({ op: 'download', v: cur, url: cur, key: c.key });
      jobs[cur] = { key: c.key, label: labelOf(c), state: 'started', pct: 0 };
      note = L.started.replace('{q}', labelOf(c)); noteKind = 'ok';
      paint(); render();
      clearTimeout(closeTimer); closeTimer = setTimeout(close, 3500);
    };
    btn.addEventListener('mouseenter', ask);
    btn.addEventListener('click', function(e){ e.preventDefault(); toggle(); });
    var onDocClick = function(e){ if (open && e.target !== host) close(); };
    var onDocKey = function(e){ if (open && e.key === 'Escape') close(); };
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onDocKey, true);

    // ── Qual vídeo: o link do post nas redes; a página nos outros sites ──
    var POST = [
      [/(^|\\.)instagram\\.com$/, /^\\/(p|reel|reels|tv)\\/[A-Za-z0-9_-]+/],
      [/(^|\\.)tiktok\\.com$/, /^\\/@[^\\/]+\\/video\\/\\d+/],
      [/(^|\\.)(twitter|x)\\.com$/, /^\\/[^\\/]+\\/status\\/\\d+/],
      [/(^|\\.)facebook\\.com$/, /^\\/(reel\\/\\d+|[^\\/]+\\/videos\\/\\d+|watch\\/?$|share\\/[vr]\\/)/],
      [/(^|\\.)threads\\.(net|com)$/, /^\\/@[^\\/]+\\/post\\/[A-Za-z0-9_-]+/]
    ];
    var postPattern = function(){
      for (var i = 0; i < POST.length; i++) if (POST[i][0].test(location.hostname)) return POST[i][1];
      return null;
    };
    // Sites onde o próprio player diz o id do vídeo — mais certeiro que qualquer link.
    var idFromPlayer = function(v){
      var h = location.hostname;
      // TikTok: o feed não tem link do post perto do vídeo, mas o player mora num
      // <div id="xgwrapper-0-NÚMERO"> — o número É o id do vídeo (o yt-dlp aceita @/video/ID).
      if (/(^|\\.)tiktok\\.com$/.test(h)) {
        for (var w = v, k = 0; w && k < 8; w = w.parentElement, k++) {
          var id = /^xgwrapper-\\d+-(\\d{15,25})$/.exec(w.id || '');
          if (id) return 'https://www.tiktok.com/@/video/' + id[1];
        }
      }
      // Globo (g1, ge, gshow…): a capa do player é glbimg.com/…/ID.jpg; senão o #video-ID
      // da playlist. Com o id, o yt-dlp lê só ESTE vídeo (a página traz dezenas).
      if (/(^|\\.)globo\\.com$/.test(h)) {
        var gp = /glbimg\\.com\\/[^\\/]+\\/(\\d{6,10})\\.jpg/.exec(v.getAttribute('poster') || '');
        var gh = /video-(\\d{6,10})/.exec(location.hash || '');
        var gid = gp ? gp[1] : (gh ? gh[1] : null);
        if (gid) return 'https://globoplay.globo.com/v/' + gid + '/';
      }
      return null;
    };
    var linkFor = function(v){
      var own = idFromPlayer(v);
      if (own) return own;
      var pat = postPattern();
      if (!pat || pat.test(location.pathname)) return location.href;
      for (var el = v.parentElement, depth = 0; el && depth < 25; el = el.parentElement, depth++) {
        var as = el.getElementsByTagName('a');
        for (var i = 0; i < as.length; i++) {
          try { var u = new URL(as[i].href, location.href); if (pat.test(u.pathname)) return u.href; } catch (e) {}
        }
      }
      return location.href;
    };

    // ── Onde está o mouse: o <video> grande debaixo dele (overlay do site por cima não atrapalha) ──
    var MIN_W = 200, MIN_H = 112;
    var rectOk = function(r){ return r.width >= MIN_W && r.height >= MIN_H && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
    var videoAt = function(x, y){
      var vs = document.getElementsByTagName('video');
      for (var i = vs.length - 1; i >= 0; i--) {
        var r = vs[i].getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && rectOk(r)) return vs[i];
      }
      return null;
    };
    var place = function(){
      if (!target) return;
      var r = target.getBoundingClientRect();
      if (!target.isConnected || !rectOk(r)) { hide(true); return; }
      var w = box.offsetWidth || 96;
      host.style.top = Math.max(4, r.top + 10) + 'px';
      host.style.left = Math.max(4, Math.min(innerWidth - w - 4, r.right - w - 10)) + 'px';
    };
    var show = function(){ if (!shown) { shown = true; host.style.display = 'block'; } place(); };
    var hide = function(force){
      if (open && !force) return;
      if (open) { open = false; box.classList.remove('bah-open'); note = null; }
      shown = false; host.style.display = 'none';
    };
    var setTarget = function(v){
      if (v === target) return;
      target = v;
      var k = (linkFor(v) || location.href).split('#')[0];
      if (k !== cur) { if (open) { open = false; box.classList.remove('bah-open'); note = null; } cur = k; paint(); }
    };
    var inRect = function(x, y, r){ return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
    var overUs = function(x, y){
      if (!shown) return false;
      return inRect(x, y, host.getBoundingClientRect()) || (open && inRect(x, y, menu.getBoundingClientRect()));
    };
    // Mouse se mexendo: no máximo uma checagem a cada 40 ms. Timer (não requestAnimationFrame,
    // que para quando a janela está coberta e deixaria o botão sem aparecer).
    var px = 0, py = 0, moveTimer = 0;
    var tick = function(){
      moveTimer = 0;
      if (overUs(px, py)) { clearTimeout(hideTimer); return; }
      var v = videoAt(px, py);
      if (v) { setTarget(v); show(); clearTimeout(hideTimer); if (!open) hideTimer = setTimeout(hide, 2500); }
    };
    var onMove = function(e){ px = e.clientX; py = e.clientY; if (!moveTimer) moveTimer = setTimeout(tick, 40); };
    var onScroll = function(){ if (shown) place(); };
    document.addEventListener('mousemove', onMove, { capture: true, passive: true });
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // Tela cheia de um container (não do <video> nu): o botão vai junto pra dentro dele.
    var onFs = function(){
      var fe = document.fullscreenElement;
      var parent = fe && fe.tagName !== 'VIDEO' ? fe : document.documentElement;
      if (host.parentNode !== parent) parent.appendChild(host);
      if (shown) place();
    };
    document.addEventListener('fullscreenchange', onFs);
    var refresh = function(){
      if (!host.isConnected) document.documentElement.appendChild(host);   // site que limpa nós estranhos
      if (target && !target.isConnected) { target = null; hide(true); }
      else if (shown) place();
    };
    var iv = setInterval(refresh, 1500);

    window.__bahDl = {
      refresh: refresh,
      onFormats: function(p){
        if (!p || !p.v) return;
        formats[p.v] = p.ok ? { state: 'ok', list: p.choices || [] } : { state: 'err', live: !!p.live, drm: !!p.drm };
        if (p.v === cur && open) render();
      },
      onJob: function(p){
        if (!p || !p.v) return;
        var j = jobs[p.v] || (jobs[p.v] = { key: p.key, state: 'started', pct: 0 });
        j.state = p.state;
        if (typeof p.pct === 'number') j.pct = p.pct;
        // 'handoff' = arquivo direto entregue à lista de Downloads (ela mostra o progresso).
        if (p.state === 'cancelled' || p.state === 'handoff') delete jobs[p.v];
        if (p.v === cur) { paint(); if (open) render(); }
      },
      remove: function(){
        clearInterval(iv);
        document.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onScroll);
        document.removeEventListener('fullscreenchange', onFs);
        document.removeEventListener('click', onDocClick, true);
        document.removeEventListener('keydown', onDocKey, true);
        if (host.parentNode) host.parentNode.removeChild(host);
        delete window.__bahDl;
      },
    };
    paint();
  } catch (e) {}
})();
`;
}
