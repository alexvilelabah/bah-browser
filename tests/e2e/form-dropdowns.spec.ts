import { test, expect, _electron as electron } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

// Listas suspensas com busca preenchidas POR CÓDIGO: combobox estilo react-select (digitar filtra,
// opções carregam com atraso, menu num portal no fim do <body>, clique "seco" ignorado) e o prompt
// do Workday (botão → listbox, uma variante com busca). Tudo dentro de um diálogo que fecha com
// Escape — o preenchimento não pode fechá-lo. A que o perfil não responde vai pro cartão de
// perguntas COM as opções da lista, e a resposta é escolhida na página.
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = process.platform === 'win32' ? path.join(ROOT, 'node_modules/electron/dist/electron.exe')
  : process.platform === 'darwin' ? path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Widgets sintéticos (sem biblioteca): o mínimo do comportamento do react-select v5 e do prompt do Workday.
const WIDGETS = `
var pressed = null;
document.addEventListener('pointerdown', function(e){ pressed = e.target.closest('[role=option]'); }, true);
// Escolha só vale com a sequência de ponteiro (como react-select que ignora .click() puro).
var realPick = function(e, opt){ var ok = pressed === opt && e.detail >= 1; pressed = null; if (!ok) window.__bareClicks = (window.__bareClicks || 0) + 1; return ok; };
document.querySelectorAll('.rs').forEach(function(box){
  var name = box.dataset.name, all = box.dataset.opts.split('|'), lab = box.querySelector('label');
  lab.id = name + '-label'; lab.htmlFor = name;
  var req = /\\*\\s*$/.test(lab.textContent);
  box.insertAdjacentHTML('beforeend', '<div class="rs__control" style="border:1px solid #888;padding:4px;min-height:24px;position:relative"><div class="rs__value-container">'
    + '<div class="rs__placeholder">Select...</div><div class="rs__single-value" style="display:none"></div>'
    + '<input role="combobox" id="' + name + '" aria-labelledby="' + name + '-label" aria-autocomplete="list" aria-expanded="false" aria-haspopup="true"' + (req ? ' aria-required="true"' : '') + ' style="width:100%;border:0" autocomplete="off"></div></div>'
    + '<input required tabindex="-1" aria-hidden="true" style="opacity:0;height:1px;width:100%" value="">'
    + '<input type="hidden" name="' + name + '">');
  var inp = box.querySelector('[role=combobox]'), single = box.querySelector('.rs__single-value'), ph = box.querySelector('.rs__placeholder'), hidden = box.querySelector('input[type=hidden]');
  var menu = null, timer = null, focused = 0;
  var close = function(){ if (menu) menu.remove(); menu = null; clearTimeout(timer); inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-controls'); inp.removeAttribute('aria-activedescendant'); };
  var commit = function(t){ hidden.value = t; single.textContent = t; single.style.display = ''; ph.style.display = 'none'; inp.value = ''; close(); };
  var render = function(){
    var r = box.querySelector('.rs__control').getBoundingClientRect();
    if (!menu) { menu = document.createElement('div'); menu.className = 'rs__menu'; menu.id = name + '-listbox'; menu.setAttribute('role', 'listbox');
      menu.style.cssText = 'position:absolute;background:#fff;border:1px solid #444;z-index:50;min-height:20px';
      menu.addEventListener('mousedown', function(e){ e.preventDefault(); });
      document.body.appendChild(menu); }
    menu.style.left = (r.left + scrollX) + 'px'; menu.style.top = (r.bottom + scrollY) + 'px'; menu.style.width = r.width + 'px';
    inp.setAttribute('aria-expanded', 'true'); inp.setAttribute('aria-controls', menu.id);
    var q = inp.value.toLowerCase();
    var show = function(){
      var list = all.filter(function(o){ return o.toLowerCase().indexOf(q) >= 0; });
      focused = 0;
      menu.innerHTML = list.length ? list.map(function(o, i){ return '<div role="option" id="' + name + '-opt-' + i + '" class="rs__option' + (i === 0 ? ' rs__option--is-focused' : '') + '" style="padding:4px">' + o.replace(/</g, '&lt;') + '</div>'; }).join('')
        : '<div class="rs__menu-notice--no-options">No options</div>';
      if (list.length) inp.setAttribute('aria-activedescendant', name + '-opt-0');
      menu.querySelectorAll('[role=option]').forEach(function(o){ o.addEventListener('click', function(e){ if (realPick(e, o)) commit(o.textContent); }); });
    };
    if (box.dataset.async) { menu.innerHTML = '<div class="rs__menu-notice--loading">Loading...</div>'; clearTimeout(timer); timer = setTimeout(show, 450); } else show();
  };
  inp.addEventListener('input', render);
  inp.addEventListener('blur', function(){ setTimeout(function(){ inp.value = ''; close(); }, 0); });
  box.querySelector('.rs__control').addEventListener('mousedown', function(){ if (!menu) render(); });
  inp.addEventListener('keydown', function(e){
    if (e.key === 'ArrowDown') { if (!menu) return render(); var os = menu.querySelectorAll('[role=option]'); focused = Math.min(focused + 1, os.length - 1); inp.setAttribute('aria-activedescendant', os[focused].id); }
    if (e.key === 'Enter' && menu) { e.preventDefault(); var o = menu.querySelectorAll('[role=option]')[focused]; if (o) commit(o.textContent); }
    if (e.key === 'Escape') close();
  });
});
document.querySelectorAll('button[aria-haspopup=listbox]').forEach(function(btn){
  var all = btn.dataset.opts.split('|'), pop = null;
  var close = function(){ if (pop) pop.remove(); pop = null; btn.setAttribute('aria-expanded', 'false'); };
  var fill = function(q){
    var ul = pop.querySelector('[role=listbox]');
    ul.innerHTML = all.filter(function(o){ return o.toLowerCase().indexOf(q.toLowerCase()) >= 0; }).map(function(o){ return '<li role="option" style="padding:4px"><div>' + o + '</div></li>'; }).join('');
    ul.querySelectorAll('[role=option]').forEach(function(li){ li.addEventListener('click', function(e){ if (!realPick(e, li)) return; btn.textContent = li.textContent; btn.value = li.textContent; close(); }); });
  };
  btn.addEventListener('click', function(){
    if (pop) return close();
    var r = btn.getBoundingClientRect();
    pop = document.createElement('div'); pop.setAttribute('data-wd-popup', '');
    pop.style.cssText = 'position:absolute;background:#fff;border:1px solid #444;z-index:60;left:' + (r.left + scrollX) + 'px;top:' + (r.bottom + scrollY) + 'px';
    pop.innerHTML = (btn.dataset.search ? '<input type="text" placeholder="Search" aria-label="Search">' : '') + '<ul role="listbox" style="margin:0;padding:0;list-style:none;min-width:200px"></ul>';
    document.body.appendChild(pop); btn.setAttribute('aria-expanded', 'true'); fill('');
    var s = pop.querySelector('input');
    if (s) { s.focus(); s.addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); fill(s.value); } }); }
  });
  document.addEventListener('mousedown', function(e){ if (pop && !pop.contains(e.target) && e.target !== btn) close(); });
});
document.getElementById('dlg').addEventListener('keydown', function(e){ if (e.key === 'Escape') { window.__dialogClosed = 1; document.getElementById('dlg').remove(); } });
`;

const PAGE = `<title>Apply: Platform Engineer</title><h1>Platform Engineer at Acme</h1>
<div role="dialog" aria-modal="true" aria-label="Apply to Acme" id="dlg" style="border:2px solid #333;padding:12px;max-width:640px">
<form id="f" style="display:grid;gap:10px">
<label>First Name <input id="fn" required></label>
<label>Last Name <input id="ln" required></label>
<label>Email <input id="em" type="email" required></label>
<label>Resume <input type="file" id="cv"></label>
<div class="rs" data-name="country" data-async="1" data-opts="Canada|United Kingdom|United States|United States Minor Outlying Islands"><label>Country*</label></div>
<div class="rs" data-name="spons" data-opts="Yes|No"><label>Will you now or in the future require sponsorship for employment visa status?*</label></div>
<div class="rs" data-name="heard" data-opts="Company website|Job board: LinkedIn|Referral|Other"><label>How did you hear about this job?*</label></div>
<div class="rs" data-name="gender" data-opts="Man|Woman|Non-binary|I don't wish to answer"><label>Gender</label></div>
<div class="rs" data-name="office" data-opts="Amsterdam|San Francisco|London"><label>Which office would you prefer?*</label></div>
<div><label for="wd-before">Have you worked for Acme before?*</label> <button type="button" id="wd-before" aria-haspopup="listbox" aria-expanded="false" aria-required="true" data-opts="Yes|No">Select One</button></div>
<div><label for="wd-degree">Highest degree earned</label> <button type="button" id="wd-degree" aria-haspopup="listbox" aria-expanded="false" data-search="1" data-opts="High School|Associate's Degree|Bachelor's Degree|Master's Degree|Doctorate">Select One</button></div>
<button type="submit">Submit application</button>
</form></div>
<script>${WIDGETS}</script>`;

test('application form: react-select-like and Workday-like dropdowns filled by code; unknown one asked with its options', async () => {
  test.setTimeout(180_000);
  const server = http.createServer((_q, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(PAGE); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const T = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bah-dropdowns-'));
  const script = [
    { type: 'navigate', url: T },
    { type: 'wait', ms: 500 },
    { type: 'done', reason: 'Form filled; waiting for the user to submit.', success: true },
  ];
  const { ELECTRON_RUN_AS_NODE: _n, ...env } = process.env;
  const app = await electron.launch({ executablePath: ELECTRON, args: [ROOT, `--user-data-dir=${tmp}`, '--use-mock-keychain'], env: { ...env, E2E_MOCK_AI: '1', E2E_MOCK_SCRIPT: JSON.stringify(script), NODE_ENV: 'test' } });
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
    await page.evaluate(() => { localStorage.setItem('tourSeen', '1'); localStorage.setItem('guideSeen', '1'); });
    await page.reload(); await page.waitForLoadState('domcontentloaded'); await sleep(2000);
    expect((await page.evaluate(() => (window as any).electronAPI.applicantSetProfile({
      firstName: 'Pat', lastName: 'Example', email: 'pat@example.com', country: 'United States', needsSponsorship: 'no', howHeard: 'LinkedIn', voluntary: 'decline',
    }))).ok).toBe(true);
    await page.evaluate(() => (window as any).electronAPI.applicantSaveAnswers({ 'have you worked for acme before': 'No', 'highest degree earned': "Master's Degree" }));
    if (!(await page.getByTestId('agent-command-input').isVisible().catch(() => false))) await page.locator('.top-bar-ai').click();
    await page.getByTestId('agent-command-input').fill('apply to this job with my resume');
    await page.getByTestId('agent-command-input').press('Enter');
    const fillBtn = page.getByRole('button', { name: 'Fill these in' });
    for (let i = 0; i < 120 && !(await fillBtn.isVisible().catch(() => false)); i++) {
      if (await page.getByTestId('plan-approve').isVisible().catch(() => false)) await page.getByTestId('plan-approve').click();
      await sleep(500);
    }
    const card = page.locator('.feed-confirm-card').last();
    await expect(card).toContainText('Which office would you prefer?');
    await expect(card).toContainText('I filled 9 fields on 127.0.0.1');
    await expect(card.locator('select, textarea')).toHaveCount(1);   // só a pergunta que o perfil não responde
    expect(await card.locator('select option').allTextContents()).toEqual(['—', 'Amsterdam', 'San Francisco', 'London']);
    await card.locator('select').selectOption({ label: 'London' });
    await fillBtn.click();
    const tab = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w => w.getType() === 'webview').pop()!
      .executeJavaScript(`JSON.stringify({ fn: fn.value, country: document.querySelector('[name=country]').value, spons: document.querySelector('[name=spons]').value,
        heard: document.querySelector('[name=heard]').value, gender: document.querySelector('[name=gender]').value, office: document.querySelector('[name=office]').value,
        before: document.getElementById('wd-before').textContent, degree: document.getElementById('wd-degree').textContent,
        menus: document.querySelectorAll('.rs__menu,[data-wd-popup]').length, dialog: !window.__dialogClosed })`));
    let got: any = {};
    for (let i = 0; i < 60 && got.office !== 'London'; i++) { await sleep(250); got = JSON.parse(await tab()); }
    expect(got).toEqual({ fn: 'Pat', country: 'United States', spons: 'No', heard: 'Job board: LinkedIn', gender: "I don't wish to answer", office: 'London',
      before: 'No', degree: "Master's Degree", menus: 0, dialog: true });
    // O modelo recebe o que o Bah escolheu, e a lista de conferência marca as listas como feitas.
    let ps: string[] = [];
    for (let i = 0; i < 40 && !ps.some(p => /FORM FILLED BY BAH/.test(p)); i++) { await sleep(500); ps = await app.evaluate(() => (global as any).__e2ePrompts || []); }
    const p = ps.find(x => /FORM FILLED BY BAH/.test(x)) || '';
    expect(p).toContain('Country = United States');
    expect(p).toContain('How did you hear about this job? = Job board: LinkedIn');
    expect(p).toContain('Which office would you prefer? = London');
    expect(p).toMatch(/✓ Country/);
    expect(p).toMatch(/✓ Highest degree earned/);
    const stored = await page.evaluate(() => (window as any).electronAPI.applicantGet());
    expect(stored.answers['which office would you prefer']).toBe('London');
  } finally { await app.close(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
