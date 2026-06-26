// ─────────────────────────────────────────────────────────────────────────────
// DATA VIEW (a "mágica" visual) — transforma dados em uma página bonita aberta
// numa aba do navegador: tabela ordenável + busca + gráfico de barras, tema dark
// premium igual ao app. Tudo local (arquivo HTML auto-contido, sem CDN), então
// abre instantâneo e funciona offline.
//
// Fontes de dados de guerrilha (grátis, sem chave):
//   - BRAPI  (brapi.dev)  → ações da B3 (lista ordenada por variação do dia)
//   - Yahoo  (query1.finance.yahoo.com) → screeners day_gainers/day_losers (EUA)
// ─────────────────────────────────────────────────────────────────────────────
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface DataViewChart {
  type: 'bar';
  label: string;        // legenda do gráfico (ex.: "Variação %")
  labels: string[];     // um por barra (ex.: tickers)
  values: number[];     // valor por barra (positivo=verde, negativo=vermelho)
}

export interface DataViewSpec {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  links?: Array<string | undefined>;  // 1 por linha: torna a 1ª célula um link clicável
  chart?: DataViewChart;
  sourceNote?: string;  // ex.: "Fonte: BRAPI (B3) — 12/06/2026 14:32"
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Número "renderizável": aceita "1,23", "+4,5%", "R$ 10,50", 1234.5 … */
const numOf = (v: unknown): number => {
  if (typeof v === 'number') return v;
  const m = String(v ?? '').replace(/[^\d,.+-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const f = parseFloat(m);
  return Number.isFinite(f) ? f : NaN;
};

export function buildDataViewHtml(spec: DataViewSpec): string {
  const cols = spec.columns.map(esc);
  const rowsHtml = spec.rows.map((r, ri) => {
    const href = spec.links?.[ri];
    const cells = r.map((c, i) => {
      const n = numOf(c);
      const isNum = Number.isFinite(n);
      const looksPct = /%|varia|change/i.test(spec.columns[i] || '');
      const cls = isNum && looksPct ? (n > 0 ? 'pos' : n < 0 ? 'neg' : '') : '';
      // 1ª célula vira link clicável (abre em nova aba) quando há href pra linha.
      const inner = i === 0 && href
        ? `<a href="${esc(href)}" target="_blank" rel="noopener" class="cell-link">${esc(c)}</a>`
        : esc(c);
      return `<td class="${cls}${isNum ? ' num' : ''}" data-v="${isNum ? n : esc(String(c)).toLowerCase()}">${inner}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('\n');

  let chartHtml = '';
  if (spec.chart && spec.chart.labels.length > 0) {
    const max = Math.max(...spec.chart.values.map((v) => Math.abs(v)), 0.0001);
    const bars = spec.chart.labels.slice(0, 20).map((lb, i) => {
      const v = spec.chart!.values[i] ?? 0;
      const w = Math.max(2, Math.round((Math.abs(v) / max) * 100));
      return `<div class="bar-row"><span class="bar-label">${esc(lb)}</span><div class="bar-track"><div class="bar ${v >= 0 ? 'bar-pos' : 'bar-neg'}" style="width:${w}%"></div></div><span class="bar-val ${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${v.toFixed(2)}</span></div>`;
    }).join('\n');
    chartHtml = `<section class="card"><h2>${esc(spec.chart.label)} — top ${Math.min(spec.chart.labels.length, 20)}</h2><div class="chart">${bars}</div></section>`;
  }

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>${esc(spec.title)}</title>
<style>
  :root { --bg:#0f0f12; --bg2:#17171c; --card:#1c1c23; --line:#2a2a33; --text:#e8e8ee; --dim:#9a9aa6; --accent:#8a63ff; --pos:#34d399; --neg:#f87171; }
  * { box-sizing:border-box; margin:0; }
  body { background: radial-gradient(1200px 500px at 70% -10%, #2a1f4d33, transparent), var(--bg); color:var(--text); font:14px/1.5 'Segoe UI',system-ui,sans-serif; padding:28px clamp(16px,5vw,64px); }
  header { margin-bottom:22px; }
  h1 { font-size:26px; font-weight:650; letter-spacing:-.3px; background:linear-gradient(90deg,#fff,#c9b8ff); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .sub { color:var(--dim); margin-top:4px; }
  .chips { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
  .chip { background:var(--card); border:1px solid var(--line); border-radius:999px; padding:4px 12px; font-size:12px; color:var(--dim); }
  .chip b { color:var(--accent); }
  .card { background:linear-gradient(180deg,#1d1d25,#17171d); border:1px solid var(--line); border-radius:16px; padding:18px 20px; margin-bottom:18px; box-shadow:0 8px 30px #00000055; }
  .card h2 { font-size:14px; color:var(--dim); font-weight:600; text-transform:uppercase; letter-spacing:.6px; margin-bottom:14px; }
  .chart { display:flex; flex-direction:column; gap:6px; }
  .bar-row { display:grid; grid-template-columns:minmax(70px,150px) 1fr 70px; align-items:center; gap:10px; }
  .bar-label { font-size:12px; color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .bar-track { background:#ffffff0a; border-radius:6px; height:16px; overflow:hidden; }
  .bar { height:100%; border-radius:6px; }
  .bar-pos { background:linear-gradient(90deg,#10b981,#34d399); }
  .bar-neg { background:linear-gradient(90deg,#ef4444,#f87171); }
  .bar-val { font-size:12px; font-variant-numeric:tabular-nums; text-align:right; }
  .toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:12px; flex-wrap:wrap; }
  .actions { display:flex; gap:8px; flex-wrap:wrap; }
  .btn { background:var(--bg2); border:1px solid var(--line); color:var(--text); border-radius:10px; padding:7px 14px; font-size:12.5px; cursor:pointer; transition:all .15s; }
  .btn:hover { border-color:var(--accent); color:#fff; background:#8a63ff1f; transform:translateY(-1px); }
  .btn.ok { border-color:var(--pos); color:var(--pos); }
  input[type=search] { background:var(--bg2); border:1px solid var(--line); color:var(--text); border-radius:10px; padding:8px 14px; width:min(340px,100%); outline:none; font-size:13px; }
  input[type=search]:focus { border-color:var(--accent); box-shadow:0 0 0 3px #8a63ff22; }
  .hint { font-size:12px; color:var(--dim); }
  table { width:100%; border-collapse:collapse; }
  thead th { position:sticky; top:0; background:#17171dF2; backdrop-filter:blur(6px); text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.7px; color:var(--dim); padding:10px 12px; border-bottom:1px solid var(--line); cursor:pointer; user-select:none; white-space:nowrap; }
  thead th:hover { color:var(--accent); }
  thead th .dir { color:var(--accent); margin-left:4px; }
  tbody td { padding:9px 12px; border-bottom:1px solid #ffffff0a; }
  tbody tr:hover { background:#8a63ff0d; }
  td.num { font-variant-numeric:tabular-nums; }
  .pos { color:var(--pos); font-weight:600; }
  .neg { color:var(--neg); font-weight:600; }
  .cell-link { color:#7db1ff; text-decoration:none; }
  .cell-link:hover { color:#a9cbff; text-decoration:underline; }
  footer { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; color:var(--dim); font-size:12px; margin-top:16px; padding-top:14px; border-top:1px solid var(--line); }
  footer b { color:var(--accent); }
  @media print {
    body { background:#fff !important; color:#1a1a22; padding:10mm; }
    h1 { color:#1a1a22 !important; background:none; -webkit-background-clip:initial; background-clip:initial; }
    .card { background:#fff; border-color:#ddd; box-shadow:none; }
    .chip { background:#f4f4f8; border-color:#ddd; color:#555; }
    .sub, .hint, .bar-label, footer { color:#555; }
    thead th { background:#fff; color:#555; position:static; }
    tbody td { border-color:#eee; }
    .bar-track { background:#f0f0f4; }
    .actions, input[type=search] { display:none !important; }
    .chips .chip:last-child { display:none; }
    div[style*="max-height"] { max-height:none !important; overflow:visible !important; }
  }
</style></head>
<body>
<header>
  <h1>${esc(spec.title)}</h1>
  ${spec.subtitle ? `<div class="sub">${esc(spec.subtitle)}</div>` : ''}
  <div class="chips"><span class="chip"><b>${spec.rows.length}</b> rows</span><span class="chip">generated <b>${new Date().toLocaleString('pt-BR')}</b></span><span class="chip">click a header to sort</span></div>
</header>
${chartHtml}
<section class="card">
  <div class="toolbar">
    <input type="search" id="q" placeholder="Filter...">
    <div class="actions">
      <span class="hint" id="count" style="align-self:center;"></span>
      <button class="btn" id="btn-csv">📥 Download CSV</button>
      <button class="btn" id="btn-copy">📋 Copy</button>
      <button class="btn" id="btn-pdf">🖨️ Save PDF</button>
    </div>
  </div>
  <div style="overflow:auto; max-height:70vh; border-radius:10px;">
  <table id="t"><thead><tr>${cols.map((c, i) => `<th data-i="${i}">${c}</th>`).join('')}</tr></thead>
  <tbody>
${rowsHtml}
  </tbody></table></div>
</section>
<footer>
  <span>${spec.sourceNote ? esc(spec.sourceNote) : ''}</span>
  <span>⚡ Generated by <b>Bah</b> · ${new Date().toLocaleDateString('pt-BR')} at ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
</footer>
<script>
(function(){
  var tb = document.querySelector('#t tbody');
  var rows = Array.prototype.slice.call(tb.rows);
  var count = document.getElementById('count');
  var update = function(vis){ count.textContent = vis + ' de ' + rows.length; };
  update(rows.length);
  document.getElementById('q').addEventListener('input', function(){
    var q = this.value.toLowerCase(); var vis = 0;
    rows.forEach(function(r){ var show = !q || r.textContent.toLowerCase().indexOf(q) >= 0; r.style.display = show ? '' : 'none'; if (show) vis++; });
    update(vis);
  });
  var dir = {};
  document.querySelectorAll('thead th').forEach(function(th){
    th.addEventListener('click', function(){
      var i = +th.dataset.i; dir[i] = -(dir[i] || -1);
      document.querySelectorAll('th .dir').forEach(function(d){ d.remove(); });
      var s = document.createElement('span'); s.className = 'dir'; s.textContent = dir[i] > 0 ? '▲' : '▼'; th.appendChild(s);
      rows.sort(function(a, b){
        var x = a.cells[i].dataset.v, y = b.cells[i].dataset.v;
        var nx = parseFloat(x), ny = parseFloat(y);
        var c = (isFinite(nx) && isFinite(ny)) ? nx - ny : String(x).localeCompare(String(y), 'pt-BR');
        return c * dir[i];
      });
      rows.forEach(function(r){ tb.appendChild(r); });
    });
  });

  // ── Exportar: CSV / copiar / PDF ── tudo local, respeita filtro e ordenação ──
  var slug = ${JSON.stringify(spec.title)}.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'tabela';
  var stamp = new Date().toLocaleDateString('sv'); // YYYY-MM-DD no fuso LOCAL
  var headerTexts = function(){
    return Array.prototype.map.call(document.querySelectorAll('thead th'), function(t){ return t.textContent.replace(/[▲▼]/g, '').trim(); });
  };
  var visibleRows = function(){
    return rows.filter(function(r){ return r.style.display !== 'none'; });
  };
  var matrix = function(){
    return [headerTexts()].concat(visibleRows().map(function(r){
      return Array.prototype.map.call(r.cells, function(c){ return c.textContent.trim(); });
    }));
  };
  var flash = function(btn, txt){
    var old = btn.textContent; btn.textContent = txt; btn.classList.add('ok');
    setTimeout(function(){ btn.textContent = old; btn.classList.remove('ok'); }, 1800);
  };
  document.getElementById('btn-csv').addEventListener('click', function(){
    var csv = '\\uFEFF' + matrix().map(function(r){
      return r.map(function(c){ return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\\r\\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = slug + '-' + stamp + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    flash(this, '✓ Baixado!');
  });
  document.getElementById('btn-copy').addEventListener('click', function(){
    var tsv = matrix().map(function(r){ return r.join('\\t'); }).join('\\n');
    var ta = document.createElement('textarea');
    ta.value = tsv; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); flash(this, '✓ Copiado!'); } catch (e) { flash(this, 'erro'); }
    ta.remove();
  });
  document.getElementById('btn-pdf').addEventListener('click', function(){ window.print(); });
})();
</script>
</body></html>`;
}

/** Escreve a página e devolve a URL file:// pronta pra abrir numa aba. */
export function openDataView(spec: DataViewSpec): { success: boolean; url?: string; error?: string } {
  try {
    const dir = path.join(app.getPath('userData'), 'views');
    fs.mkdirSync(dir, { recursive: true });
    // Mantém só as 20 views mais recentes (higiene de disco).
    try {
      fs.readdirSync(dir).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t).slice(20)
        .forEach((x) => { try { fs.unlinkSync(path.join(dir, x.f)); } catch {} });
    } catch {}
    const file = path.join(dir, `view-${Date.now()}.html`);
    fs.writeFileSync(file, buildDataViewHtml(spec), 'utf8');
    return { success: true, url: `file:///${file.replace(/\\/g, '/')}` };
  } catch (e: any) {
    return { success: false, error: String(e?.message ?? e) };
  }
}

// ── Ações da bolsa (B3 primeiro; Yahoo EUA como fallback) ────────────────────
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtVol = (v: number) => v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v);

async function fetchJson(url: string, timeoutMs = 15000): Promise<any> {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': CHROME_UA, Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(tm); }
}

export async function fetchStockMovers(direction: 'gainers' | 'losers', count: number): Promise<DataViewSpec> {
  const n = Math.min(Math.max(count || 50, 5), 100);
  const verb = direction === 'gainers' ? 'gained' : 'lost';

  // 1ª via: BRAPI (B3). Pegar o ranking por variação direto vem cheio de papel
  // ilíquido (fracionários "F", volume ~0, variações absurdas). Estratégia: pool
  // das 400 AÇÕES mais NEGOCIADAS (líquidas, as que importam) e ordenamos por
  // variação aqui — ranking igual ao dos portais de finanças.
  try {
    const j = await fetchJson('https://brapi.dev/api/quote/list?type=stock&sortBy=volume&sortOrder=desc&limit=400');
    const stocks = (j?.stocks || [])
      .filter((s: any) => !/\dF$/.test(s?.stock || '') && (s?.volume ?? 0) >= 100_000 && Number.isFinite(s?.change))
      .sort((a: any, b: any) => direction === 'gainers' ? b.change - a.change : a.change - b.change)
      .slice(0, n);
    if (stocks.length >= 5) {
      return {
        title: `The ${stocks.length} B3 stocks that ${verb} the most today`,
        subtitle: 'Brazilian stock exchange (B3) — sorted by daily change',
        columns: ['#', 'Ticker', 'Company', 'Price (R$)', 'Change %', 'Volume'],
        rows: stocks.map((s: any, i: number) => [
          i + 1, s.stock, s.name || s.stock, fmtBRL(s.close ?? 0),
          `${s.change > 0 ? '+' : ''}${(s.change ?? 0).toFixed(2)}%`, fmtVol(s.volume ?? 0),
        ]),
        chart: {
          type: 'bar', label: 'Change %',
          labels: stocks.slice(0, 20).map((s: any) => s.stock),
          values: stocks.slice(0, 20).map((s: any) => s.change ?? 0),
        },
        sourceNote: `Source: BRAPI (B3 data) — ${new Date().toLocaleString('pt-BR')}. Minimum volume of 50K applied to exclude illiquid tickers.`,
      };
    }
  } catch { /* cai pro Yahoo */ }

  // 2ª via: Yahoo screener (ações dos EUA).
  const j = await fetchJson(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_${direction}&count=${n}`);
  const quotes = j?.finance?.result?.[0]?.quotes || [];
  if (quotes.length === 0) throw new Error('No stock quote source responded (BRAPI and Yahoo).');
  return {
    title: `The ${quotes.length} US stocks that ${verb} the most today`,
    subtitle: 'US market — Yahoo Finance screener',
    columns: ['#', 'Ticker', 'Company', 'Price (US$)', 'Change %', 'Volume'],
    rows: quotes.map((q: any, i: number) => [
      i + 1, q.symbol, q.shortName || q.symbol, fmtBRL(q.regularMarketPrice ?? 0),
      `${(q.regularMarketChangePercent ?? 0) > 0 ? '+' : ''}${(q.regularMarketChangePercent ?? 0).toFixed(2)}%`,
      fmtVol(q.regularMarketVolume ?? 0),
    ]),
    chart: {
      type: 'bar', label: 'Change %',
      labels: quotes.slice(0, 20).map((q: any) => q.symbol),
      values: quotes.slice(0, 20).map((q: any) => q.regularMarketChangePercent ?? 0),
    },
    sourceNote: `Fonte: Yahoo Finance (screener day_${direction}) — ${new Date().toLocaleString('pt-BR')}`,
  };
}
