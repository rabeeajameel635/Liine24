import * as db from './db.js';
import {
  DOC_TYPES, REGIONS, CUSTOMER_TYPES, PAY_METHODS, ACCOUNTS, CASH_ACCOUNTS,
  computeTotals, docTotalsOpts, round1, draftEntries, DEFAULT_ACCOUNT_CODES, checkAccountCodes, DEFAULT_REGIONS, checkRegions, fmt, fromCents, toCents, amountInWords, trialBalance, statement, stockOnHand,
  sequenceGaps, similarNames, validateImport, nextNumericCode, avgCostC,
} from './core.js';
import { ic, TYPE_ICON } from './icons.js';
import { apply as applyLang, getLang, setLang, translate, T } from './i18n.js';

// ---------- state ----------
const S = { settings: null, items: [], parties: [], docs: [], role: sessionStorage.getItem('role') || 'accountant', user: sessionStorage.getItem('user') || 'User' };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => fmt(fromCents(c || 0));
// the account as people know it: their own code and name (Accounts setup), over the fixed internal key
const acctCode = (k) => String((S.settings.accountCodes || {})[k] || DEFAULT_ACCOUNT_CODES[k] || k);
const acctName = (k) => (S.settings.accountNames || {})[k] || T(ACCOUNTS[k]?.name || k);
// regions as defined in the regions directory: code + name, by the key a customer carries
const regionsList = () => [...(S.settings.regions || DEFAULT_REGIONS)].sort((a, b) => a.code.localeCompare(b.code));
const regionOf = (k) => regionsList().find((r) => r.key === k);
const regionName = (k) => { const r = regionOf(k); return r ? T(r.name) : ''; };
const regionLabel = (k) => { const r = regionOf(k); return r ? `${r.code} · ${T(r.name)}` : ''; };
const regionOptions = (cur, all = '') => `${all ? `<option value="">${esc(T(all))}</option>` : ''}${regionsList().map((r) => `<option value="${r.key}" ${cur === r.key ? 'selected' : ''}>${esc(r.code)} · ${esc(T(r.name))}</option>`).join('')}`;
// invoice amounts under the rounding rule show one decimal (31,600.0), others keep agorot
const amt = (c, r) => (r ? fmt(fromCents(c || 0), 1) : money(c));
const pricef = (v, r) => fmt(Number(v) || 0, r ? 1 : 3);
const today = () => new Date().toISOString().slice(0, 10);
const isAdmin = () => S.role === 'admin';
const itemById = (id) => S.items.find((i) => i.id === id);
const partyById = (id) => S.parties.find((p) => p.id === id);
const partyLabel = (p) => (p ? `${p.code} — ${p.name}` : '');
const docLabel = (d) => d.number || 'DRAFT';
const docPartyName = (d) => partyById(d.partyId)?.name || '';
const lineItem = (l) => { const it = itemById(l.itemId) || {}; return { code: it.code || '', name: it.name || '' }; };

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = T(msg); t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.className = ''), err ? 6000 : 2800);
}
async function guard(fn) {
  try { return await fn(); } catch (e) { console.warn(e); toast(e.message || String(e), true); }
}
async function reload() {
  [S.settings, S.items, S.parties, S.docs] = await Promise.all([db.getSettings(), db.all('items'), db.all('parties'), db.all('docs')]);
  S.items.sort((a, b) => a.code.localeCompare(b.code));
  S.parties.sort((a, b) => a.code.localeCompare(b.code));
  document.documentElement.dataset.size = S.settings.fontScale;
  $('#brandName').textContent = S.settings.companyName || 'Ledger';
  $('#whoami').innerHTML = `<span data-notr>${esc(S.user)}</span> · <b>${isAdmin() ? 'Admin' : 'Accountant'}</b><br><a href="#/settings">Switch role</a>`;
}

// ---------- router ----------
const routes = {};
const GROUPS = { inv: ['SI', 'SR', 'CN', 'DN'], pur: ['PI', 'PR'], vch: ['RV', 'PV'] };
// The open editor registers itself here so leaving it can be guarded.
let guardEditor = null, currentHash = location.hash, bypass = false;
// Bisan keys: F2 lookup · F4 save · F9 print (posts, so it asks) · Esc exit back to where you were
let pageKeys = null, lastPlace = '#/dashboard';
const isDocRoute = (h) => /^#\/(new|doc)\//.test(h || '');
document.addEventListener('keydown', (e) => { if (pageKeys && !e.defaultPrevented) pageKeys(e); });
const backToPlace = () => go(lastPlace || '#/dashboard');
async function render() {
  $$('dialog').forEach((d) => d.remove());   // a sheet never outlives its screen
  guardEditor = null; pageKeys = null; onMasters = null; document.onvisibilitychange = null; document.body.classList.remove('editing', 'sheet-open');
  $('#main').onbeforeinput = null; $('#main').onclick = null;
  if (!isDocRoute(location.hash)) lastPlace = location.hash || '#/dashboard';
  const hash = location.hash.replace(/^#\//, '') || 'dashboard';
  const [name, ...args] = hash.split('?')[0].split('/');
  const navKey = name === 'new' ? `docs?type=${args[0]}` : hash;
  const best = $$('#nav a').filter((a) => navKey.startsWith(a.dataset.k)).sort((x, y) => y.dataset.k.length - x.dataset.k.length)[0];
  $$('#nav a').forEach((a) => a.classList.toggle('on', a === best));
  document.body.classList.remove('menu-open');
  const qType = name === 'new' ? args[0] : new URLSearchParams(hash.split('?')[1] || '').get('type');
  const tab = name === 'dashboard' ? 'home'
    : name === 'invoices' ? 'inv' : name === 'vouchers' ? 'vch' : name === 'purchases' ? 'pur'
    : (name === 'docs' || name === 'new') ? (GROUPS.vch.includes(qType) ? 'vch' : GROUPS.pur.includes(qType) ? 'pur' : 'inv')
    : ['reports', 'statement', 'sales', 'stock', 'tb', 'balances'].includes(name) ? 'rep'
    : ['dirs', 'customers', 'suppliers', 'items', 'accounts', 'regions'].includes(name) ? 'dir' : '';
  $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  $('#mTitle').textContent = best ? best.textContent : (S.settings?.companyName || 'Ledger');
  const fn = routes[name] || routes.dashboard;
  await reload();
  $('#main').innerHTML = '';
  await guard(() => fn(...args));
  translate(document.body);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', async () => {
  if (bypass) { bypass = false; currentHash = location.hash; return; }
  if (guardEditor && guardEditor.isDirty()) {
    const target = location.hash;
    bypass = true; location.hash = currentHash;          // stay put until the user decides
    const ok = await guardEditor.leave();
    if (ok) { guardEditor = null; currentHash = target; location.hash = target; }
    return;
  }
  currentHash = location.hash; render();
});
window.addEventListener('beforeunload', (e) => { if (guardEditor && guardEditor.isDirty()) { e.preventDefault(); e.returnValue = ''; } });
const go = (h) => { guardEditor = null; if (location.hash === h) render(); else location.hash = h; };

// "You started this document. What now?"  → 'stay' | 'discard' | 'save' | 'post'
// Long press (half a second) opens the inquiry for what is under the finger; right-click does the same on a
// desktop. Attach it to an element that is rebuilt with its screen, so handlers never stack up.
let holdFiredAt = 0;
function holdable(root, selector, fn) {
  let timer = null, ringT = null, ring = null, sx = 0, sy = 0;
  const stop = () => { clearTimeout(timer); clearTimeout(ringT); timer = null; ring?.remove(); ring = null; };
  const fire = (el) => { stop(); holdFiredAt = Date.now(); navigator.vibrate?.(12); fn(el); };
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(selector); if (!el || !root.contains(el) || e.button > 0) return;
    stop(); sx = e.clientX; sy = e.clientY;
    ringT = setTimeout(() => { ring = document.createElement('div'); ring.className = 'holdring'; ring.style.left = sx + 'px'; ring.style.top = sy + 'px'; document.body.appendChild(ring); }, 110);
    timer = setTimeout(() => fire(el), 500);
  });
  root.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) stop(); });
  ['pointerup', 'pointercancel'].forEach((t) => root.addEventListener(t, stop));
  root.addEventListener('contextmenu', (e) => {
    const el = e.target.closest(selector); if (!el || !root.contains(el)) return;
    e.preventDefault(); if (Date.now() - holdFiredAt < 900) return; fire(el);
  });
  root.addEventListener('click', (e) => { if (Date.now() - holdFiredAt < 700 && e.target.closest(selector)) { e.preventDefault(); e.stopPropagation(); } }, true);
}
// set by an open document so a card edit (spelling, prices) shows at once in its lines
let onMasters = null;

// a small yes / no question in the app's own style (not the browser's box)
function ask(question, yes = 'Yes', no = 'Cancel') {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'ask';
    dlg.innerHTML = `<p class="q">${esc(question)}</p><div class="actions"><button class="btn" data-v="no">${esc(no)}</button><button class="btn ink" data-v="yes">${esc(yes)}</button></div>`;
    document.body.appendChild(dlg); translate(dlg); dlg.showModal();
    const end = (v) => { dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); end(false); });
    $('[data-v=yes]', dlg).onclick = () => end(true); $('[data-v=no]', dlg).onclick = () => end(false);
    setTimeout(() => $('[data-v=no]', dlg).focus(), 30);
  });
}
function leaveDialog(hasSavedDraft) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `<h2 style="margin-top:0">Leave this document?</h2>
      <p class="muted">You started entering this document. Choose what to do with it.</p>
      <div class="actions" style="flex-direction:column;align-items:stretch">
        <button class="btn ink" data-v="post">Print &amp; post</button>
        <button class="btn tonal" data-v="save">Save draft</button>
        <button class="btn danger" data-v="discard">${hasSavedDraft ? 'Cancel & delete draft' : 'Discard'}</button>
        <button class="btn" data-v="stay">Continue editing</button>
      </div>`;
    document.body.appendChild(dlg); translate(dlg); dlg.showModal();
    const end = (v) => { dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); end('stay'); });
    $$('[data-v]', dlg).forEach((b) => (b.onclick = () => end(b.dataset.v)));
    setTimeout(() => $('[data-v=post]', dlg).focus(), 30);
  });
}

// ---------- ledger helpers ----------
async function ledger() { return db.all('ledger'); }
async function partyBalanceC(partyId) {
  const p = partyById(partyId); if (!p) return 0;
  const rows = await db.byIndex('ledger', 'partyId', partyId);
  return rows.reduce((s, e) => s + (p.kind === 'supplier' ? e.creditC - e.debitC : e.debitC - e.creditC), 0);
}

// ---------- dashboard ----------
// which home sections are open is a per-device convenience
const homeOpen = () => { try { return JSON.parse(localStorage.getItem('homeOpen') || '["inv"]'); } catch { return ['inv']; } };
routes.dashboard = async () => {
  const tb = trialBalance(await ledger());
  const healthy = tb.balanced && !sequenceGaps(S.docs.filter((d) => d.number)).length;
  const recent = S.docs.filter((d) => d.status !== 'cancelled' && !['OB', 'OS'].includes(d.type))
    .sort((a, b) => (b.postedAt || b.updatedAt || '').localeCompare(a.postedAt || a.updatedAt || '')).slice(0, 12);
  const tile = (href, icon, label) => `<a class="tile" href="${href}"><span class="tico">${ic(icon)}</span><span>${label}</span></a>`;
  $('#main').innerHTML = `
    <div class="homehead"><div><h1 dir="auto">${esc(S.settings.companyName)}</h1>
      <p class="date">${new Date().toLocaleDateString(getLang() === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p></div>
      <a href="#/integrity" class="pill ${healthy ? 'ok' : 'bad'}">${healthy ? 'Balanced' : 'Check'}</a></div>
    <div class="homemap">${MAP.map((sec) => `<details class="hsec" data-k="${sec.k}" ${homeOpen().includes(sec.k) ? 'open' : ''}>
      <summary><span class="tico">${ic(sec.icon)}</span><b class="grow">${sec.title}</b><span class="hchev">${ic('chev')}</span></summary>
      <div class="hbody">${mapGroups(sec)}</div></details>`).join('')}</div>
    <div class="listhead"><h2>Recent documents</h2><a class="btn small" href="#/docs?type=SI">All</a></div>
    ${docTable(recent)}
    ${S.items.length ? '' : `<div class="note" style="margin-top:20px">Start here: add items and customers in <a href="#/items">Items</a> and <a href="#/customers">Customers</a>, or import them from Excel in <a href="#/import">Import</a>.</div>`}`;
  $$('.hsec').forEach((d) => d.addEventListener('toggle', () => { try { localStorage.setItem('homeOpen', JSON.stringify($$('.hsec[open]').map((x) => x.dataset.k))); } catch { /* private mode: fine */ } }));
};

// one hub screen for a group of links (Reports, Directories)
// The program's map (Rabee, Nov 2026). Each section is groups of entries; a line separates groups.
// entry: [route, icon, label, newType?] — no route means not built yet ("Soon").
const MAP = [
  { k: 'inv', title: 'Invoices', icon: 'doc', groups: [
    [['#/docs?type=SI', 'doc', 'Sales invoices', 'SI'], ['#/docs?type=SR', 'undo', 'Sales returns', 'SR']],
    [['#/docs?type=CN', 'minus', 'Credit notes', 'CN'], ['#/docs?type=DN', 'pluscircle', 'Debit notes', 'DN']]] },
  { k: 'pur', title: 'Purchases', icon: 'cart', groups: [
    [['#/docs?type=PI', 'cart', 'Purchase invoices', 'PI'], ['#/docs?type=PR', 'undo', 'Purchase returns', 'PR']]] },
  { k: 'vch', title: 'Vouchers', icon: 'wallet', groups: [
    [['#/docs?type=RV', 'in', 'Receipt vouchers', 'RV']], [['#/docs?type=PV', 'out', 'Payment vouchers', 'PV']], [['', 'journal', 'Journal vouchers']]] },
  { k: 'dir', title: 'Definitions', icon: 'book', groups: [
    [['#/customers', 'users', 'Customers directory'], ['#/suppliers', 'truck', 'Suppliers directory']], [['#/items', 'box', 'Items']], [['', 'users', 'Employees']], [['#/regions', 'pin', 'Regions']], [['#/accounts', 'book', 'Accounts setup']]] },
  { k: 'rep', title: 'Reports', icon: 'bars', groups: [
    [['#/statement', 'list', 'Account statement'], ['#/balances', 'users', 'Customer balances']],
    [['#/sales?kind=sales&by=item', 'bars', 'Sales by item'], ['#/sales?kind=sales&by=customer', 'users', 'Sales by customer'], ['#/sales?kind=sales&by=region', 'pin', 'Sales by region']],
    [['#/sales?kind=purchases&by=item', 'cart', 'Purchases by item'], ['#/sales?kind=purchases&by=customer', 'truck', 'Purchases by supplier']],
    [['#/stock', 'box', 'Inventory'], ['#/tb', 'layers', 'Trial balance']]] },
  { k: 'sys', title: 'System', icon: 'gear', groups: [
    [['#/settings?f=pin', 'lock', 'Password'], ['#/settings?f=lang', 'grid', 'Language'], ['#/settings?f=cur', 'wallet', 'Currency']],
    [['#/settings', 'gear', 'Settings'], ['#/import', 'spark', 'Import · Excel · AI'], ['#/backup', 'saved', 'Backup']],
    [['#/integrity', 'check', 'Integrity check'], ['#/audit', 'list', 'Audit log']]] },
];
const mapEntry = ([href, icon, label, nt]) => (href
  ? `<div class="hrow"><a class="hgo" href="${href}"><span class="tico">${ic(icon)}</span><span class="grow">${label}</span></a>${nt ? `<a class="hnew" href="#/new/${nt}" title="New" aria-label="New">${ic('plus')}</a>` : ic('chev')}</div>`
  : `<span class="hrow off"><span class="tico">${ic(icon)}</span><span class="grow">${label}</span><em>Soon</em></span>`);
const mapGroups = (sec) => sec.groups.map((g) => `<div class="hgrp">${g.map(mapEntry).join('')}</div>`).join('');
function hub(title, rows) {
  $('#main').innerHTML = `<h1>${title}</h1><div class="hublist">${rows.map(([href, icon, label]) => href
    ? `<a class="hrow" href="${href}"><span class="tico">${ic(icon)}</span><span class="grow">${label}</span>${ic('chev')}</a>`
    : `<span class="hrow off"><span class="tico">${ic(icon)}</span><span class="grow">${label}</span><em>Soon</em></span>`).join('')}</div>`;
}
const sectionPage = (k) => { const sec = MAP.find((x) => x.k === k); $('#main').innerHTML = `<h1>${sec.title}</h1><div class="hublist grouped">${mapGroups(sec)}</div>`; };
routes.reports = async () => sectionPage('rep');
routes.dirs = async () => sectionPage('dir');
routes.invoices = async () => sectionPage('inv');
routes.vouchers = async () => sectionPage('vch');
routes.purchases = async () => sectionPage('pur');
routes.system = async () => sectionPage('sys');
// ---------- regions directory: code + name; customers carry the region, reports group by it ----------
routes.regions = async () => {
  const entries = await ledger();
  const bal = {}; for (const e of entries) if (e.partyId && e.account === '1200') bal[e.partyId] = (bal[e.partyId] || 0) + e.debitC - e.creditC;
  const cust = S.parties.filter((p) => p.kind === 'customer');
  let list = regionsList().map((r) => ({ ...r }));
  const ro = isAdmin() ? '' : 'readonly';
  const draw = () => {
    $('#main').innerHTML = `<h1>Regions</h1><p class="sub">Each region has a two-digit code. Customers carry their region; the customers directory and the reports group by it.</p>
      <div class="tablewrap"><table class="t regs"><thead><tr><th>Code</th><th>Region</th><th class="n">Customers</th></tr></thead><tbody>
      ${list.map((r, i) => { const mine = cust.filter((p) => p.region === r.key); return `<tr data-i="${i}"><td><input class="rc" inputmode="numeric" dir="ltr" maxlength="2" value="${esc(r.code)}" ${ro}></td><td><input class="rn" dir="auto" value="${esc(T(r.name))}" ${ro}></td>
        <td class="n">${mine.length}</td></tr>`; }).join('')}</tbody></table></div>
      ${isAdmin() ? '<div class="actions"><button class="btn" id="addReg">+ Region</button><button class="btn primary" id="saveReg">Save regions</button></div>' : '<p class="muted">Switch to admin to change regions.</p>'}`;
    translate($('#main'));
    $('#addReg') && ($('#addReg').onclick = () => { read(); const n = Math.max(0, ...list.map((r) => Number(r.code) || 0)) + 1; list.push({ key: 'r' + Date.now().toString(36), code: String(n).padStart(2, '0'), name: '' }); draw(); $$('.rn').at(-1).focus(); });
    $('#saveReg') && ($('#saveReg').onclick = () => guard(async () => {
      read(); const errs = checkRegions(list); if (errs.length) throw new Error(errs.join('\n'));
      await db.setSetting('regions', list, S.user); await reload(); toast('Saved'); render();
    }));
  };
  // a default name left as shown (translated) keeps its English key so both languages stay right
  const read = () => $$('tr[data-i]').forEach((tr) => { const r = list[Number(tr.dataset.i)]; r.code = $('.rc', tr).value.trim(); const n = $('.rn', tr).value.trim(); if (n !== T(r.name)) r.name = n; });
  draw();
};
// ---------- customer balances (Bisan's list): one line per customer, grouped by region, with totals ----------
routes.balances = async () => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const reg = q.get('region') || '';
  const entries = await ledger();
  const dr = {}, cr = {}; for (const e of entries) if (e.partyId && e.account === '1200') { dr[e.partyId] = (dr[e.partyId] || 0) + e.debitC; cr[e.partyId] = (cr[e.partyId] || 0) + e.creditC; }
  const cust = S.parties.filter((p) => p.kind === 'customer' && (!reg || p.region === reg))
    .sort((a, b) => (regionOf(a.region)?.code || '99').localeCompare(regionOf(b.region)?.code || '99') || a.code.localeCompare(b.code, undefined, { numeric: true }));
  const groups = []; for (const p of cust) { const g = groups.at(-1); if (g && g.key === (p.region || '')) g.rows.push(p); else groups.push({ key: p.region || '', rows: [p] }); }
  const sum = (rows, m) => rows.reduce((t, p) => t + (m[p.id] || 0), 0);
  const row = (p) => `<tr><td dir="ltr">${esc(p.code)}</td><td dir="auto"><a href="#/statement/${p.id}">${esc(p.name)}</a></td><td class="n">${money(dr[p.id] || 0)}</td><td class="n">${money(cr[p.id] || 0)}</td><td class="n"><b>${money((dr[p.id] || 0) - (cr[p.id] || 0))}</b></td></tr>`;
  $('#main').innerHTML = `<h1>Customer balances</h1><p class="sub">${esc(acctCode('1200'))} · ${esc(acctName('1200'))} · <span>NIS</span></p>
    <div class="searchbar"><select id="reg">${regionOptions(reg, 'All regions')}</select><button class="btn" id="pr">Print / PDF</button><button class="btn" id="xl">Excel</button></div>
    <div class="tablewrap"><table class="t bal"><thead><tr><th>Code</th><th>Customer</th><th class="n">Total debit</th><th class="n">Total credit</th><th class="n">Balance</th></tr></thead><tbody>
    ${groups.map((g) => `<tr class="rgh"><td colspan="5"><b>${esc(regionLabel(g.key) || T('No region'))}</b></td></tr>${g.rows.map(row).join('')}
      <tr class="rgt"><td colspan="2">${esc(T('Region total'))}</td><td class="n">${money(sum(g.rows, dr))}</td><td class="n">${money(sum(g.rows, cr))}</td><td class="n"><b>${money(sum(g.rows, dr) - sum(g.rows, cr))}</b></td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="2">Total</td><td class="n">${money(sum(cust, dr))}</td><td class="n">${money(sum(cust, cr))}</td><td class="n">${money(sum(cust, dr) - sum(cust, cr))}</td></tr></tfoot></table></div>`;
  $('#reg').onchange = () => go('#/balances?region=' + $('#reg').value);
  $('#pr').onclick = () => printHtml(`<div class="tb"><div class="t1">${esc(T('Customer balances'))}</div><div class="tno">${esc(reg ? regionLabel(reg) : T('All regions'))} · ${esc(today())}</div></div>` + $('.tablewrap').outerHTML.replace(/<a [^>]*>|<\/a>/g, ''));
  $('#xl').onclick = () => toExcel('customer-balances.xlsx', [[S.settings.companyName], [T('Customer balances'), reg ? regionLabel(reg) : T('All regions')], [],
    ['Region', 'Code', 'Customer', 'Total debit', 'Total credit', 'Balance'].map(T),
    ...cust.map((p) => [regionLabel(p.region), p.code, p.name, fromCents(dr[p.id] || 0), fromCents(cr[p.id] || 0), fromCents((dr[p.id] || 0) - (cr[p.id] || 0))]),
    [T('Total'), '', '', fromCents(sum(cust, dr)), fromCents(sum(cust, cr)), fromCents(sum(cust, dr) - sum(cust, cr))]], { cols: [22, 10, 40, 14, 14, 14] });
};
routes.accounts = async () => {
  const tb = trialBalance(await ledger());
  const bal = Object.fromEntries(tb.rows.map((r) => [r.account, r.balDebitC - r.balCreditC]));
  const USED = { '1100': 'Receipt and payment vouchers (cash)', '1110': 'Receipt and payment vouchers (bank)', '1120': 'Cheques received', '1200': 'Customers: sales, returns, receipts, notes',
    '2100': 'Suppliers: purchases, returns, payments', '1300': 'Stock value', '2200': 'VAT on invoices', '3100': 'Opening balances', '4100': 'Sales invoices', '4110': 'Sales returns',
    '4120': 'Credit notes', '4200': 'Debit notes', '5100': 'Cost of what was sold', '5200': 'Journal vouchers (soon)', '1400': 'Journal vouchers (soon)', '1250': 'Journal vouchers (soon)' };
  const order = Object.keys(ACCOUNTS).sort((a, b) => Number(acctCode(a)) - Number(acctCode(b)));
  const ro = isAdmin() ? '' : 'readonly';
  $('#main').innerHTML = `<h1>Accounts setup</h1><p class="sub">Your own code and name for each account. Postings keep their fixed link, so changing a code or a name never changes a number. Balances are in the trial balance.</p>
    <div class="tablewrap"><table class="t acct"><thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Used by</th></tr></thead><tbody>
    ${order.map((k) => `<tr data-k="${k}"><td><input class="ac" inputmode="numeric" dir="ltr" value="${esc(acctCode(k))}" ${ro}></td><td><input class="an" dir="auto" value="${esc(acctName(k))}" ${ro}></td><td>${esc(T(ACCOUNTS[k].type))}</td><td class="muted">${esc(T(USED[k] || ''))}</td></tr>`).join('')}</tbody></table></div>
    ${isAdmin() ? '<div class="actions"><button class="btn primary" id="saveAc">Save accounts</button></div>' : '<p class="muted">Switch to admin to change codes and names.</p>'}`;
  $('#saveAc') && ($('#saveAc').onclick = () => guard(async () => {
    const codes = {}, names = {};
    $$('tr[data-k]').forEach((tr) => { const k = tr.dataset.k; codes[k] = $('.ac', tr).value.trim(); const n = $('.an', tr).value.trim(); if (n && n !== T(ACCOUNTS[k].name)) names[k] = n; });
    const errs = checkAccountCodes(codes); if (errs.length) throw new Error(errs.join('\n'));
    await db.setSetting('accountCodes', codes, S.user); await db.setSetting('accountNames', names, S.user);
    await reload(); toast('Saved'); render();
  }));
};


// documents as soft list rows (same on phone and desktop)
function docTable(docs) {
  if (!docs.length) return '<p class="muted">Nothing here.</p>';
  return `<div class="dlist">${docs.map((d) => `<a class="drow" href="#/doc/${d.id}">
      <span class="dthumb s-${d.status}">${ic(TYPE_ICON[d.type] || 'doc')}</span>
      <span class="dmain"><span class="dtop"><b dir="ltr">${esc(docLabel(d))}</b><span class="dtype">${DOC_TYPES[d.type].name}</span>${d.backdated ? '<span class="pill bad">Backdated</span>' : ''}</span>
        <span class="dsub"><span dir="auto">${esc(docPartyName(d) || '—')}</span> · <span dir="ltr">${esc(d.date)}</span>${d.reference ? ` · <span dir="ltr">${esc(d.reference)}</span>` : ''}</span></span>
      <span class="dend"><b class="n">${d.status === 'draft' || d.status === 'cancelled' ? money(draftTotalC(d)) : money(d.totalC)}</b><span class="pill ${d.status}">${d.status}</span></span>
    </a>`).join('')}</div>`;
}
function draftTotalC(d) {
  if (!DOC_TYPES[d.type].lines) return toCents(d.amount);
  return computeTotals(d.lines || [], docTotalsOpts(d, S.settings)).totalC;
}

// ---------- documents ----------
routes.new = async (type) => {
  if (!DOC_TYPES[type]) throw new Error('Unknown document type');
  // Bisan-style chain: customer → statement → new document, with the customer already filled in
  const pre = partyById(new URLSearchParams(location.hash.split('?')[1] || '').get('party'));
  const doc = { type, date: today(), partyId: pre?.id || '', reference: '', notes: '', lines: [], invoiceDiscount: 0, amount: '', method: 'cash', cashAccount: '1100' };
  if (DOC_TYPES[type].lines) doc.lines = [blankLine()];
  editor(doc);
};
routes.doc = async (id) => {
  const d = await db.get('docs', id);
  if (!d) throw new Error('Document not found');
  if (d.status === 'draft') editor(d); else await viewDoc(d);
};
// Status capsule: four circles, the active one opens into a pill with its name.
const STATUS_TABS = [
  ['draft', 'Saved', 'saved', (d) => d.status === 'draft'],
  ['posted', 'Posted', 'check', (d) => d.status === 'posted'],
  ['voided', 'Voided', 'ban', (d) => d.status === 'voided' || d.status === 'cancelled'],   // voided posted documents and cancelled drafts
  ['all', 'All', 'layers', () => true],
];
routes.docs = async () => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const type = q.get('type') || '';
  const ofType = S.docs.filter((d) => !type || d.type === type);
  // default: saved documents if there are any waiting, otherwise posted
  const tab = q.get('tab') || (ofType.some((d) => d.status === 'draft') ? 'draft' : 'posted');
  const pred = (STATUS_TABS.find((x) => x[0] === tab) || STATUS_TABS[0])[3];
  const list = ofType.filter(pred).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.seqNo || 0) - (a.seqNo || 0) || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const link = (t, tb) => `#/docs?type=${t}&tab=${tb}`;
  const group = GROUPS.vch.includes(type) ? GROUPS.vch : GROUPS.pur.includes(type) ? GROUPS.pur : type ? GROUPS.inv : [...GROUPS.inv, ...GROUPS.pur, ...GROUPS.vch];
  $('#main').innerHTML = `<div class="listhead"><h1>${type ? DOC_TYPES[type].name : 'All documents'}</h1>
      ${type && DOC_TYPES[type].party !== 'none' && type !== 'OB' ? `<a class="btn ink" id="newDoc" href="#/new/${type}">${ic('plus')}<span>New</span></a>` : ''}</div>
    <div class="chips scroll">${group.map((k) => `<a class="chip small ${k === type ? 'on' : ''}" href="${link(k, q.get('tab') || '')}">${DOC_TYPES[k].name}</a>`).join('')}</div>
    <div class="segrow"><div class="seg">${STATUS_TABS.map(([k, label, icon, f]) => `<a class="s-${k} ${k === tab ? 'on' : ''}" href="${link(type, k)}" title="${label}"><i>${ic(icon)}</i><span>${label}</span><b>${ofType.filter(f).length}</b></a>`).join('')}</div>
      <label class="searchpill">${ic('search')}<input id="fq" placeholder="Number, party, reference"></label></div>
    <div id="dl">${docTable(list)}</div>`;
  $('#fq').oninput = (e) => {
    const s = e.target.value.toLowerCase();
    $('#dl').innerHTML = docTable(list.filter((d) => [d.number, docPartyName(d), d.reference].join(' ').toLowerCase().includes(s)));
    translate($('#dl'));
  };
};

const blankLine = () => ({ itemId: '', qty: '', bonus: '', price: '', disc: '', batch: '', expiry: '' });

function editor(doc) {
  const t = DOC_TYPES[doc.type];
  const partyKind = t.party === 'supplier' ? 'supplier' : 'customer';
  const pickParties = () => S.parties.filter((p) => (t.party === 'any' || p.kind === partyKind) && (p.active !== false || !t.lines));
  let parties = pickParties();
  const itemsList = S.items.filter((i) => i.active !== false);
  const phone = window.matchMedia('(max-width: 860px)').matches;
  // One sheet laid out like the printed page:
  //   top: party ——— region · date ——— (ref, salesman)
  //   middle: the grey work grid, filled in its own rows
  //   bottom: notes + approved balance | totals
  //   last line: icon buttons in four groups (save · post · export · cancel)
  $('#main').innerHTML = `<div class="ws">
    <datalist id="dlNames">${itemsList.map((i) => `<option value="${esc(i.name)}" label="${esc(i.code)}">`).join('')}</datalist>
    <datalist id="dlParties">${parties.map((p) => `<option value="${esc(partyLabel(p))}">`).join('')}</datalist>
    <header class="whead">
      <div class="wl0"><button class="wback" id="eBack" tabindex="-1" title="Exit" aria-label="Exit">${ic('chev')}</button><span class="wtype">${t.name}</span> <span class="pill draft">${doc.id ? 'Saved' : 'New'}</span></div>
      ${t.party !== 'none' ? `<div class="wl"><label class="lf grow"><span>${partyKind === 'supplier' ? 'Supplier' : 'Customer'}</span><input id="party" data-flow list="dlParties" dir="auto" placeholder="Code, name, or Enter / F2 for the list" value="${esc(partyLabel(partyById(doc.partyId)))}" enterkeyhint="next"><button type="button" class="lkbtn" data-lk="party" tabindex="-1" title="Lookup (F2)">${ic('search')}</button></label>
        <label class="lf reg"><span>Region</span><output id="pRegion" dir="auto">—</output></label></div>` : ''}
      <div class="wl"><label class="lf date"><span>Date</span><input id="date" data-flow type="date" value="${esc(doc.date)}"></label>
        <label class="lf"><span>Ref.</span><input id="ref" data-flow value="${esc(doc.reference || '')}" enterkeyhint="next"></label>
        ${doc.type === 'SI' ? `<label class="lf"><span>Salesman</span><input id="salesman" data-flow value="${esc(doc.salesman || '')}" enterkeyhint="next"></label>` : ''}</div>
    </header>
    <section class="wbody">${t.lines ? linesUI(doc) : voucherUI(doc)}</section>
    <footer class="wfoot">
      <div class="wcard wnote"><label class="wnl">Notes<textarea id="notes" dir="auto" rows="2">${esc(doc.notes || '')}</textarea></label>
        ${t.party !== 'none' ? `<div class="wbal"><span class="wlbl">Approved balance</span><b id="balAfter">—</b><button type="button" class="wsub wlink" id="balBefore" title="Statement before this document"></button></div>` : ''}</div>
      <div class="wcard wsum" id="totals">
        ${t.lines ? `<div class="sr"><span>Items total</span><b id="tSub">0.00</b></div>
        <div class="sr"><span>Invoice discount</span><input id="invdisc" inputmode="decimal" value="${esc(doc.invoiceDiscount || '')}" placeholder="0.00"></div>
        <div class="sr" id="tRoundRow" hidden><span>Rounding</span><b id="tRound" dir="ltr"></b></div>
        <div class="sr"><span>VAT ${S.settings.vatRate}%</span><b id="tVat">0.00</b></div>` : ''}
        <div class="sr grand"><span>${t.lines ? 'Grand total' : 'Amount'}</span><b id="gTotal">0.00</b></div>
        <div class="wwords" id="tWords"></div></div>
    </footer>
    <div class="finish wbar" id="finish" tabindex="0">
      <div class="g"><button class="rb" id="save" title="Save draft (F4)" aria-label="Save draft (F4)">${ic('disk')}</button><button class="rb" id="printdraft" title="Save & print draft" aria-label="Save & print draft">${ic('printer')}</button></div>
      <div class="g"><button class="rb" id="post" title="Post" aria-label="Post">${ic('lock')}</button><button class="rb main" id="postprint" title="Post & print (F9)" aria-label="Post & print (F9)">${ic('printer')}</button></div>
      <div class="g"><button class="rb" id="export" title="Export to Excel" aria-label="Export to Excel">${ic('in')}</button></div>
      <div class="g"><button class="rb" id="cancelDoc" title="Cancel document" aria-label="Cancel document">${ic('x')}</button></div>
    </div></div>`;
  document.body.classList.add('editing');

  // exact code or label wins; a name search picks only when exactly one record matches
  const findParty = (v, report = false) => {
    v = v.trim(); if (!v) return null;
    const low = v.toLowerCase();
    const exact = parties.find((x) => partyLabel(x) === v || x.code.toLowerCase() === low || x.name.toLowerCase() === low);
    if (exact) return exact;
    return uniqueMatch(parties, low, report);
  };
  const readDoc = () => {
    const d = { ...doc, date: $('#date').value, reference: $('#ref').value.trim(), notes: $('#notes').value.trim() };
    if ($('#salesman')) d.salesman = $('#salesman').value.trim();
    if ($('#party')) d.partyId = findParty($('#party').value)?.id || '';
    if (t.lines) {
      d.lines = $$('#lines tbody tr').map((tr) => {
        const g = (k) => $(`[data-k="${k}"]`, tr).value.trim();
        const it = itemById(tr.dataset.item);
        return { itemId: it?.id || '', itemText: g('code') || g('name'), qty: num(g('qty')), bonus: num(g('bonus')), price: R && g('price') !== '' ? round1(num(g('price'))) : num(g('price')), disc: num(g('disc')), batch: g('batch'), expiry: expParse(g('expiry')) };
      }).filter((l) => l.itemId || l.itemText || l.qty || l.bonus);
      d.invoiceDiscount = num($('#invdisc').value);
    } else {
      Object.assign(d, { amount: num($('#amount').value), method: $('#method').value, cashAccount: $('#cashAccount').value, chequeNo: $('#chequeNo').value.trim(), chequeBank: $('#chequeBank').value.trim(), dueDate: $('#dueDate').value });
    }
    return d;
  };
  const validate = (d, forPost) => {
    if (t.party !== 'none' && !d.partyId) throw new Error(`Choose a ${partyKind} from the list. New ${partyKind}s are added by the admin.`);
    if (t.lines) {
      const bad = d.lines.find((l) => !l.itemId);
      if (bad) throw new Error(`Unknown item "${bad.itemText}". Pick it from the list.`);
      const off = d.lines.map((l) => itemById(l.itemId)).find((i) => i && i.active === false);
      if (off) throw new Error(`${off.code} is inactive${off.replacedBy ? `, use ${itemById(off.replacedBy)?.code} instead` : ''}.`);
      if (forPost && !d.lines.length) throw new Error('Add at least one line');
    } else if (forPost && !(d.amount > 0)) throw new Error('Amount must be greater than zero');
    if (['OB', 'OS'].includes(d.type) && !isAdmin()) throw new Error('Opening balances are entered by the admin');
  };
  const save = async (forPost) => { const d = readDoc(); validate(d, forPost); const r = await db.saveDraft(d, S.user); doc.id = r.id; return r; };
  const saveDraftNow = () => { if (!busy) guard(async () => { const r = await save(false); toast('Draft saved'); go('#/doc/' + r.id); }); };
  const doPost = async (andPrint) => {
    const r = await save(true);
    const p = partyById(r.partyId);
    if (r.type === 'SI' && p?.creditLimit) {
      const after = (await partyBalanceC(p.id)) + draftTotalC(r);
      if (after > toCents(p.creditLimit) && !confirm(T(`Credit limit ${fmt(p.creditLimit)} will be exceeded (balance after: ${money(after)}). Post anyway?`))) return;
    }
    let posted;
    try { posted = await db.post(r.id, S.user, S.settings); }
    catch (e) {
      if (!/Owner approval/.test(e.message)) throw e;
      if (!isAdmin()) throw new Error(e.message + ' Switch to admin.');
      const reason = prompt(e.message + '\n\nReason for backdating:');
      if (!reason) return;
      posted = await db.post(r.id, S.user, S.settings, { allowBackdate: true, backdateReason: reason });
    }
    toast(`Posted ${posted.number}`);
    if (andPrint) await printDoc(posted, '', copiesFor(posted.type));
    go('#/doc/' + posted.id);
    return true;
  };
  // one posting at a time: a double key press or double click can never post twice
  let busy = false;
  const once = (fn) => async () => { if (busy) return; busy = true; try { await guard(fn); } finally { busy = false; } };
  const postAndPrintNow = once(() => doPost(true));
  const printAndPost = () => { if (!busy && confirm(T('Print and post this document?'))) return postAndPrintNow(); };
  $('#save').onclick = saveDraftNow;
  $('#post').onclick = once(() => doPost(false));

  // unsaved-changes guard: Esc, a menu click or closing the tab all ask first
  const alive = () => document.body.contains(finish);
  const snapshot = () => (alive() ? JSON.stringify(readDoc()) : null);
  let clean = null;
  setTimeout(() => { if (alive()) clean = snapshot(); }, 120);
  const isDirty = () => alive() && clean !== null && snapshot() !== clean;
  // Autosave (Rabee, Nov 2026): once a document has a real line (or an amount), every change is kept
  // as a draft in the background. Leaving never asks; the draft waits in the Saved tab.
  const meaningful = (d) => (t.lines ? d.lines.some((l) => l.itemId) : num(d.amount) > 0);
  let saving = null, lastSaved = null;
  const autosave = async () => {
    if (!alive() || busy) return;
    const d = readDoc(); if (!meaningful(d)) return;
    const snap = JSON.stringify(d); if (snap === lastSaved) return;
    await saving;
    saving = (async () => {
      try {
        const r = await db.saveDraft({ ...d, id: doc.id }, S.user);
        doc.id = r.id; lastSaved = snap; if (alive()) clean = snapshot();
        const pill = $('.whead .pill'); if (pill && pill.dataset.s !== 'saved') { pill.dataset.s = 'saved'; pill.textContent = T('Saved'); }
        history.replaceState(null, '', '#/doc/' + r.id); currentHash = location.hash;
      } catch (e) { console.warn('autosave', e); }
    })();
    await saving;
  };
  let tmr = null;
  const soon = () => { clearTimeout(tmr); tmr = setTimeout(autosave, 700); };
  $('#main').addEventListener('change', soon);
  document.onvisibilitychange = () => { if (document.hidden) autosave(); };
  const leave = async () => { clearTimeout(tmr); await autosave(); if (doc.id && isDirty()) toast('Draft saved'); return true; };
  guardEditor = { isDirty, leave };
  const back = () => { if (isDirty()) leave().then(() => { guardEditor = null; backToPlace(); }); else backToPlace(); };
  $('#postprint').onclick = printAndPost;
  $('#printdraft').onclick = () => guard(async () => { const r = await save(false); await printDoc(r); go('#/doc/' + r.id); });
  // cancel: a saved draft becomes "cancelled" (kept in the records); a new one is simply dropped
  $('#cancelDoc').onclick = () => guard(async () => {
    if (doc.id) {
      if (!confirm(T('Cancel this draft? It stays in the records as cancelled.'))) return;
      await db.cancelDraft(doc.id, S.user); toast('Draft cancelled');
    } else if (isDirty() && !confirm(T('Discard this new document?'))) return;
    guardEditor = null; backToPlace();
  });
  // export: the document as it stands, to Excel
  $('#export').onclick = () => guard(async () => {
    const d = readDoc(); const p = partyById(d.partyId);
    const head = [[T(t.name), d.number || T('Draft')], [T('Date'), d.date], ...(p ? [[T(partyKind === 'supplier' ? 'Supplier' : 'Customer'), `${p.code} — ${p.name}`]] : []), ...(d.reference ? [[T('Ref.'), d.reference]] : []), []];
    if (t.lines) {
      const tot = computeTotals(d.lines, docTotalsOpts(d, S.settings));
      const body = tot.lines.map((l) => { const it = itemById(l.itemId) || {}; return [it.code, it.name, l.qty || 0, l.bonus || 0, Number(l.price) || 0, l.disc || 0, l.amountC / 100, l.batch, l.expiry]; });
      toExcel(`${d.number || doc.type + '-draft'}.xlsx`, [...head, ['Code', 'Item', 'Qty', 'Bonus', 'Price', 'Disc %', 'Amount', 'Batch', 'Expiry'].map(T), ...body, [],
        [T('Subtotal'), tot.subtotalC / 100], [T('Invoice discount'), tot.discC / 100], [T(`VAT ${S.settings.vatRate}%`), tot.vatC / 100], [T('Grand total'), tot.totalC / 100]]);
    } else toExcel(`${d.number || doc.type + '-draft'}.xlsx`, [...head, [T('Amount'), d.amount || 0], [T('Method'), T(PAY_METHODS[d.method] || '')], ...(d.chequeNo ? [['Cheque', d.chequeNo, d.chequeBank, d.dueDate]] : []), ...(d.notes ? [[T('Notes'), d.notes]] : [])]);
    toast('Exported');
  });

  // Enter walks the form: header fields, then lines, then the finish bar.
  const finish = $('#finish');
  const arm = () => { finish.classList.add('armed'); finish.focus(); };
  finish.addEventListener('blur', () => finish.classList.remove('armed'));
  finish.addEventListener('keydown', (e) => {
    if (e.target !== finish) return;
    if (e.key === 'Enter' || e.code === 'KeyS') { e.preventDefault(); e.stopPropagation(); saveDraftNow(); }
    else if (e.code === 'KeyP') { e.preventDefault(); e.stopPropagation(); printAndPost(); }
  });
  pageKeys = (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') { e.preventDefault(); back(); return; }
    if (e.key === 'F4') { e.preventDefault(); saveDraftNow(); return; }            // save, no question
    if (e.key === 'F9') { e.preventDefault(); printAndPost(); return; }           // print = post, asks first
    if (e.key === 'F2') {                                                          // lookup from anywhere
      e.preventDefault();
      const target = ($('#party') && !findParty($('#party').value) && $('#party'))
        || (t.lines && ($$('#lines tbody tr').find((tr) => !tr.dataset.item) || ($('#addline').click(), $('#lines tbody tr:last-child')))?.querySelector('[data-k=code]'));
      if (target) { target.focus(); target.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true })); }
      return;
    }
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (!typing && e.code === 'KeyP' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); printAndPost(); }
  };

  const firstEntry = () => (t.lines ? ($('#lines tbody tr:not(.found) [data-k=code]') || $('#lines tbody tr [data-k=code]')) : $('#amount'));
  const header = $$('[data-flow]');
  header.forEach((el, i) => el.addEventListener('keydown', async (e) => {
    if (e.key === 'F2' && el.id === 'party') {
      e.preventDefault();
      const chosen = parties.find((x) => partyLabel(x) === el.value.trim() || x.code.toLowerCase() === el.value.trim().toLowerCase());
      if (chosen && (await partyCard(chosen)) !== 'list') { el.focus(); return; }
      const p = await lookupParty(parties, chosen ? '' : el.value.trim()); el.focus();
      if (p) { el.value = partyLabel(p); el.dispatchEvent(new Event('change')); }
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (el.id === 'party') {
      const p = findParty(el.value) || (await lookupParty(parties, el.value.trim()));
      el.focus();
      if (!p) return;
      el.value = partyLabel(p); el.dispatchEvent(new Event('change'));
    }
    const next = header[i + 1];
    (next || firstEntry()).focus();
  }));

  // approved balance: the party's balance before this document, and after it, live with every line
  let balBase = null; let totalC = 0; let curPartyId = doc.partyId || null;
  const BAL_SIGN = { SI: 1, DN: 1, PI: 1, SR: -1, CN: -1, PR: -1, RV: -1, PV: -1 };
  const showBal = () => {
    const a = $('#balAfter'); if (!a) return;
    if (balBase === null) { a.textContent = '—'; $('#balBefore').textContent = ''; return; }
    const sg = BAL_SIGN[doc.type] || 0;
    a.textContent = money(balBase + sg * totalC);
    const p = findParty($('#party').value);
    $('#balBefore').innerHTML = `<span>Before</span> ${money(balBase)}${p?.creditLimit ? ` · <span>Remaining</span> ${money(toCents(p.creditLimit) - balBase - sg * totalC)}` : ''}`;
    translate($('#balBefore'));
  };
  const R = docTotalsOpts(doc, S.settings).roundTotals;
  const setTotal = (c) => {
    totalC = c; $('#gTotal').textContent = amt(c, R);
    $('#tWords').textContent = c > 0 ? amountInWords(fromCents(c)) : '';
    showBal();
  };
  if ($('#party')) {
    const info = async () => {
      const p = findParty($('#party').value); curPartyId = p?.id || null;
      $('#pRegion').textContent = p?.region ? regionName(p.region) : '—';
      balBase = null; showBal();
      if (!p) return;
      balBase = await partyBalanceC(p.id); showBal();
    };
    $('#party').addEventListener('change', info); info();
  }
  if (t.lines) wireLines(doc, arm, () => curPartyId, setTotal);
  else {
    const m = () => { const c = $('#method').value === 'cheque'; $$('.cheque').forEach((x) => (x.style.display = c ? '' : 'none')); if (c && $('#cashAccount').value === '1100') $('#cashAccount').value = '1120'; };
    $('#method').onchange = m; m();
    const w = () => setTotal(toCents(num($('#amount').value) || 0));
    $('#amount').oninput = w; w();
    const vf = ['#amount', '#method', '#cashAccount', '#chequeNo', '#chequeBank', '#dueDate'].map((q) => $(q)).filter((x) => x && x.type !== 'hidden');
    vf.forEach((el) => el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return; e.preventDefault();
      const rest = vf.slice(vf.indexOf(el) + 1).filter((x) => x.offsetParent);
      rest.length ? rest[0].focus() : arm();
    }));
  }
  $('#smart') && ($('#smart').onclick = () => smartEntry(doc, readDoc));
  // Symbol keys for phone keyboards (no F-keys there): @ lookup · # save · € print & post.
  // They act only in single-line fields of the document; notes and other text areas keep them as text.
  const SYMBOL_KEYS = { '@': 'F2', '#': 'F4', '€': 'F9' };
  // assigned (not added) so each screen owns exactly one handler; render() clears them
  $('#main').onbeforeinput = (e) => {
    const k = SYMBOL_KEYS[e.data];
    if (!k || !e.inputType?.startsWith('insert') || e.target.tagName !== 'INPUT' || e.target.closest('dialog')) return;
    e.preventDefault();
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    if (k === 'F2' && (e.target.id === 'party' || e.target.dataset.k === 'code' || e.target.dataset.k === 'name')) e.target.dispatchEvent(ev);
    else pageKeys && pageKeys(ev);
  };
  // touch: the search buttons do what F2 does
  $('#main').onclick = (e) => {
    const b = e.target.closest('.lkbtn'); if (!b) return;
    const el = b.dataset.lk === 'party' ? $('#party') : $('[data-k=name]', b.closest('tr'));
    el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
  };
  $('#eBack').onclick = back;
  if ($('#balBefore')) $('#balBefore').onclick = () => { const p = partyById(curPartyId); if (p) statementSheet(p, doc.id); };
  if ($('#party')) holdable($('.whead'), '#party', (el) => { el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true })); });
  onMasters = () => {
    parties = pickParties();
    $('#dlParties').innerHTML = parties.map((p) => `<option value="${esc(partyLabel(p))}">`).join('');
    const p = partyById(curPartyId); if (p && $('#party')) { $('#party').value = partyLabel(p); $('#pRegion').textContent = p.region ? regionName(p.region) : '—'; }
    $$('#lines tbody tr').forEach((tr) => { const it = itemById(tr.dataset.item); if (it) $('[data-k=name]', tr).value = it.name; });
    if (alive()) soon();
  };
  setTimeout(() => {
    if (!phone) return ($('#party') || $('#date')).focus();
    if ($('#party') && !findParty($('#party').value)) $('#party').focus();
    else if (!doc.id) firstEntry()?.focus();
  }, 50);
}
// Lookup list like Bisan's F2: type to filter, ↑ ↓ to move, Enter to pick, Esc to close.
// rows: [{ id, code, name, extra: [...] }] ; resolves the picked id or null
function lookup({ title, headers, rows, filter = '', onHold }) {
  const getRows = typeof rows === 'function' ? rows : () => rows;
  let all = getRows();
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'lookup';
    dlg.innerHTML = `<button class="dlg-x" data-x type="button" title="Close" aria-label="Close">${ic('x')}</button><h2 style="margin-top:0">${esc(title)}</h2>
      <input class="lk-q" placeholder="Search by code or name" dir="auto" value="${esc(filter)}">
      <div class="lk-list"><table class="t"><thead><tr><th>Code</th><th>Name</th>${headers.map((h) => `<th class="n">${esc(h)}</th>`).join('')}</tr></thead><tbody></tbody></table></div>
      <p class="hint" style="margin:10px 0 0"><kbd>↑</kbd> <kbd>↓</kbd> <span>move</span> · <kbd>Enter</kbd> <span>pick</span> · <kbd>Esc</kbd> <span>close</span>${onHold ? ' · <span>hold a row: its card</span>' : ''}</p>`;
    document.body.appendChild(dlg);
    const q = $('.lk-q', dlg), tb = $('tbody', dlg);
    let shown = [], idx = 0;
    const draw = () => {
      const low = q.value.trim().toLowerCase();
      shown = all.filter((r) => !low || r.code.toLowerCase().includes(low) || r.name.toLowerCase().includes(low));
      shown.sort((a, b) => (b.code.toLowerCase().startsWith(low) || b.name.toLowerCase().startsWith(low)) - (a.code.toLowerCase().startsWith(low) || a.name.toLowerCase().startsWith(low)));
      idx = Math.min(idx, Math.max(0, shown.length - 1));
      tb.innerHTML = shown.slice(0, 200).map((r, i) => `<tr data-i="${i}" class="${i === idx ? 'sel' : ''}"><td><b dir="ltr">${esc(r.code)}</b></td><td dir="auto">${esc(r.name)}</td>${r.extra.map((x) => `<td class="n">${x}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${2 + headers.length}" class="muted">Nothing matches</td></tr>`;
      $('tr.sel', tb)?.scrollIntoView({ block: 'nearest' });
      translate(dlg);
    };
    const end = (v) => { dlg.remove(); resolve(v); };
    q.addEventListener('input', () => { idx = 0; draw(); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, shown.length - 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[idx]) end(shown[idx].id); }
    });
    tb.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr) end(shown[Number(tr.dataset.i)].id); });
    if (onHold) holdable(tb, 'tr[data-i]', async (tr) => { const r = shown[Number(tr.dataset.i)]; if (!r) return; await onHold(r.id); all = getRows(); draw(); });
    $('[data-x]', dlg).onclick = () => end(null);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); end(null); });
    dlg.showModal(); draw(); q.focus(); q.select();
  });
}
async function lookupParty(list, filter = '') {
  const entries = await ledger();
  const bal = {};
  for (const e of entries) if (e.partyId) bal[e.partyId] = (bal[e.partyId] || 0) + e.debitC - e.creditC;
  const id = await lookup({ title: list[0]?.kind === 'supplier' ? 'Suppliers' : 'Customers', headers: ['Region', 'Balance'], filter,
    rows: list.map((p) => ({ id: p.id, code: p.code, name: p.name, extra: [regionLabel(p.region), money(p.kind === 'supplier' ? -(bal[p.id] || 0) : bal[p.id] || 0)] })) });
  return id ? partyById(id) : null;
}
async function lookupItem(filter = '', type = 'SI', partyId = null) {
  const oh = stockOnHand(await db.all('stock'));
  const R = docTotalsOpts({ type, lines: [] }, S.settings).roundTotals;
  const id = await lookup({ title: 'Items', headers: ['Price', 'On hand'], filter,
    rows: () => S.items.filter((i) => i.active !== false).map((i) => ({ id: i.id, code: i.code, name: i.name, extra: [pricef(defaultPrice(i, type), R), fmt(oh[i.id]?.qty || 0, 0)] })),
    onHold: (iid) => itemCard(itemById(iid), partyId, type, { change: false }) });
  return id ? itemById(id) : null;
}

// Inquiry card (F2 on a field that already holds a record): the record's definition, read-only.
// Resolves 'list' when the user presses F2 again (or the button) to change the choice, else null.
// fields: [label, html] or [label, html, { k, v, type, options }] — the third part makes it editable.
// Editable: names (spelling only once there are movements), contact details and list prices.
// Never editable here: codes, balances, stock, posted numbers.
function recordCard({ title, fields, sections = [], onSave = null, change = true }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'lookup card-dlg';
    let editing = false;
    fields = fields.map(([k, v, ed]) => [k, v, ed || undefined]);
    const body = () => fields.filter(([, v, ed]) => (editing && ed) || (v !== '' && v != null)).map(([k, v, ed]) => {
      if (!editing || !ed) return `<div><span>${esc(k)}</span><b dir="auto">${v}</b></div>`;
      const inp = ed.type === 'select'
        ? `<select data-ek="${ed.k}">${ed.options.map(([o, l]) => `<option value="${esc(o)}" ${String(ed.v ?? '') === String(o) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
        : `<input data-ek="${ed.k}" dir="auto" ${ed.type === 'number' ? 'inputmode="decimal"' : ''} value="${esc(ed.v ?? '')}">`;
      return `<div class="ed"><span>${esc(k)}</span>${inp}</div>`;
    }).join('');
    const draw = () => {
      dlg.innerHTML = `<button class="dlg-x" data-x type="button" title="Close" aria-label="Close">${ic('x')}</button><h2 style="margin-top:0" dir="auto">${esc(title)}</h2>
        <div class="kv">${body()}</div>
        ${editing ? '' : sections.map(([h, html]) => `<h3>${esc(h)}</h3>${html}`).join('')}
        <div class="actions" style="margin-bottom:0">${editing
          ? '<button class="btn ink" data-v="save">Save</button><button class="btn" data-v="view">Cancel</button>'
          : `${onSave ? '<button class="btn tonal" data-v="edit">Edit</button>' : ''}${change ? '<button class="btn tonal" data-v="list">Change <kbd>F2</kbd></button>' : ''}<button class="btn" data-v="close">Close <kbd>Esc</kbd></button>`}</div>`;
      translate(dlg);
      $('[data-x]', dlg).onclick = () => end(null);
      $$('[data-v]', dlg).forEach((b) => (b.onclick = () => act(b.dataset.v)));
      setTimeout(() => (editing ? $('[data-ek]', dlg) : $('[data-v=close]', dlg))?.focus(), 20);
    };
    const end = (v) => { dlg.remove(); resolve(v); };
    const act = async (v) => {
      if (v === 'edit') { editing = true; draw(); return; }
      if (v === 'view') { editing = false; draw(); return; }
      if (v === 'save') {
        const vals = {};
        $$('[data-ek]', dlg).forEach((el) => { const ed = fields.find((f) => f[2]?.k === el.dataset.ek)[2]; vals[ed.k] = ed.type === 'number' ? (el.value.trim() === '' ? '' : num(el.value)) : el.value.trim(); });
        try { await onSave(vals); toast('Saved'); end('saved'); } catch (e) { toast(T(e.message), true); }
        return;
      }
      end(v === 'list' ? 'list' : null);
    };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (editing) act('view'); else end(null); });
    dlg.addEventListener('keydown', (e) => {
      if (editing) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); act('save'); } return; }
      if (e.key === 'F2' && change) { e.preventDefault(); end('list'); }
      else if (e.key === 'Enter') { e.preventDefault(); end(null); }
    });
    document.body.appendChild(dlg); dlg.showModal(); draw();
  });
}
const saveFromCard = async (store, rec, vals) => {
  if (vals.name !== undefined && !vals.name) throw new Error('Name is required');
  await db.saveMaster(store, { ...rec, ...vals }, S.user);
  await reload(); onMasters?.();
};
const miniTable = (head, rows) => rows.length
  ? `<div class="lk-list"><table class="t"><thead><tr>${head.map((h, i) => `<th class="${i ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'n' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  : '<p class="muted">None</p>';

async function partyCard(p, opts = {}) {
  const entries = await db.byIndex('ledger', 'partyId', p.id);
  const bal = entries.reduce((s, e) => s + (p.kind === 'supplier' ? e.creditC - e.debitC : e.debitC - e.creditC), 0);
  const docs = S.docs.filter((d) => d.partyId === p.id && d.status === 'posted').sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.seqNo || 0) - (a.seqNo || 0));
  const last = (types) => docs.find((d) => types.includes(d.type));
  const li = last(['SI', 'PI']), lr = last(['RV', 'PV']);
  return recordCard({
    title: `${p.code} — ${p.name}`,
    fields: [
      ['Code', esc(p.code)], ['Name', esc(p.name), { k: 'name', v: p.name }],
      ['Region', esc(regionLabel(p.region)), p.kind === 'customer' ? { k: 'region', v: p.region || '', type: 'select', options: [['', '—'], ...regionsList().map((r) => [r.key, `${r.code} · ${T(r.name)}`])] } : null],
      ['Type', esc(T(CUSTOMER_TYPES[p.type] || ''))],
      ['Phone', esc(p.phone || ''), { k: 'phone', v: p.phone }], ['Address', esc(p.address || ''), { k: 'address', v: p.address }],
      ['Tax / licensed dealer no.', esc(p.taxNo || ''), { k: 'taxNo', v: p.taxNo }], ['Guarantor', esc(p.guarantor || ''), p.kind === 'customer' ? { k: 'guarantor', v: p.guarantor } : null],
      ['Balance', `<span dir="ltr">${money(bal)}</span>`],
      ['Credit limit', p.creditLimit ? fmt(p.creditLimit) : '', p.kind === 'customer' ? { k: 'creditLimit', v: p.creditLimit, type: 'number' } : null], ['Remaining', p.creditLimit ? money(toCents(p.creditLimit) - bal) : ''],
      ['Last invoice', li ? `${esc(li.number)} · ${esc(li.date)} · ${money(li.totalC)}` : ''],
      ['Last payment', lr ? `${esc(lr.number)} · ${esc(lr.date)} · ${money(lr.totalC)}` : ''],
      ['Status', p.active === false ? esc(T('inactive')) : ''],
    ],
    onSave: (vals) => saveFromCard('parties', p, vals), change: opts.change !== false,
  });
}

async function itemCard(it, partyId, type, opts = {}) {
  const moves = (await db.all('stock')).filter((m) => m.itemId === it.id);
  const onHand = moves.reduce((s, m) => s + m.qty, 0);
  const lots = {};
  for (const m of moves) { const k = `${m.batch || '—'}|${m.expiry || '—'}`; lots[k] = (lots[k] || 0) + m.qty; }
  const lotRows = Object.entries(lots).filter(([, q]) => q > 0).sort(([a], [b]) => a.split('|')[1].localeCompare(b.split('|')[1]))
    .map(([k, q]) => { const [b, x] = k.split('|'); return [esc(b), esc(x), fmt(q, 0)]; });
  const posted = S.docs.filter((d) => d.status === 'posted' && (d.lines || []).some((l) => l.itemId === it.id))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.seqNo || 0) - (a.seqNo || 0));
  const lineOf = (d) => d.lines.find((l) => l.itemId === it.id);
  const lastSaleHere = partyId ? posted.find((d) => d.type === 'SI' && d.partyId === partyId) : null;
  const lastBuy = posted.find((d) => d.type === 'PI');
  const R = (d) => docTotalsOpts(d, S.settings).roundTotals;
  const mine = partyId ? posted.filter((d) => ['SI', 'PI'].includes(d.type) && d.partyId === partyId).slice(0, 5)
    .map((d) => { const l = lineOf(d); return [esc(d.date), esc(d.number), fmt(l.qty || 0, 0), fmt(l.bonus || 0, 0), pricef(l.price, R(d))]; }) : [];
  const recent = posted.filter((d) => d.type === 'SI').slice(0, 5).map((d) => { const l = lineOf(d); return [esc(d.number), esc(partyById(d.partyId)?.name || ''), fmt(l.qty || 0, 0), fmt(l.bonus || 0, 0), pricef(l.price, docTotalsOpts(d, S.settings).roundTotals)]; });
  return recordCard({
    title: `${it.code} — ${it.name}`,
    fields: [
      ['Code', esc(it.code)], ['Name', esc(it.name), { k: 'name', v: it.name }], ['Company', esc(it.brand || ''), { k: 'brand', v: it.brand }],
      ['Supplier', lastBuy ? esc(partyById(lastBuy.partyId)?.name || '') : ''],
      ['Category', esc(it.category || ''), { k: 'category', v: it.category }], ['Unit', esc(it.unit || ''), { k: 'unit', v: it.unit }], ['Barcode', esc(it.barcode || ''), { k: 'barcode', v: it.barcode }],
      ['Buy price', fmt(it.buyPrice || 0, 3), { k: 'buyPrice', v: it.buyPrice, type: 'number' }], ['Public price', fmt(it.pricePublic || 0, 3), { k: 'pricePublic', v: it.pricePublic, type: 'number' }], ['Pharmacist price', fmt(it.pricePharmacist || 0, 3), { k: 'pricePharmacist', v: it.pricePharmacist, type: 'number' }],
      ['On hand', `<b>${fmt(onHand, 0)}</b>`],
      ['Last price to this customer', lastSaleHere ? `${pricef(lineOf(lastSaleHere).price, R(lastSaleHere))} · ${esc(lastSaleHere.date)}` : ''],
      ['Last purchase price', lastBuy ? `${pricef(lineOf(lastBuy).price, R(lastBuy))} · ${esc(lastBuy.date)}` : ''],
    ],
    sections: [['Batches in stock', miniTable(['Batch', 'Expiry', 'Qty'], lotRows)],
      ...(partyId ? [[`${partyById(partyId)?.kind === 'supplier' ? 'This supplier' : 'This customer'}: earlier prices`, miniTable(['Date', 'Number', 'Qty', 'Bonus', 'Price'], mine)]] : []),
      ['Last sales', miniTable(['Number', 'Customer', 'Qty', 'Bonus', 'Price'], recent)]],
    onSave: (vals) => saveFromCard('items', it, vals), change: opts.change !== false,
  });
}

function uniqueMatch(list, low, report) {
  let m = list.filter((x) => x.name.toLowerCase().startsWith(low));
  if (!m.length) m = list.filter((x) => x.name.toLowerCase().includes(low));
  if (m.length === 1) return m[0];
  if (report) toast(m.length ? `${m.length} matches: type more letters or pick from the list` : `Nothing matches "${low}"`, true);
  return null;
}
const copiesFor = (type) => Math.max(1, Number(DOC_TYPES[type].lines ? S.settings.copiesInvoice : S.settings.copiesVoucher) || 1);

const num = (v) => (v === '' || v == null ? '' : Number(String(v).replace(/,/g, '')));
function findItem(text) {
  if (!text) return null;
  const code = text.split(' — ')[0].trim().toLowerCase();
  return S.items.find((i) => i.code.toLowerCase() === code) || S.items.find((i) => `${i.code} — ${i.name}` === text) || S.items.find((i) => i.name.toLowerCase() === text.toLowerCase());
}
function expParse(v) {
  v = String(v || '').trim(); if (!v) return '';
  let m = v.match(/^(\d{4})-(\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})\s*[\/\s.-]?\s*(\d{4}|\d{2})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2].length === 2 ? '20' + m[2] : m[2]}-${m[1].padStart(2, '0')}`;
  return v;
}
function expShow(v) { const m = String(v || '').match(/^(\d{4})-(\d{2})$/); return m ? `${m[2]}/${m[1]}` : v || ''; }
function defaultPrice(item, type) {
  if (!item) return '';
  const v = ['PI', 'PR', 'OS'].includes(type) ? item.buyPrice ?? '' : item.pricePharmacist || item.pricePublic || '';
  return v !== '' && docTotalsOpts({ type, lines: [] }, S.settings).roundTotals ? round1(v) : v;
}

function linesUI(doc) {
  const row = (l) => {
    const it = itemById(l.itemId);
    return `<tr data-item="${esc(it?.id || '')}" class="${it ? 'found' : ''}">
      <td class="ln"><button type="button" class="lno" data-del tabindex="-1" title="Remove line from draft"></button></td>
      <td class="code"><input data-k="code" dir="ltr" inputmode="numeric" enterkeyhint="next" value="${esc(it ? it.code : '')}" placeholder="Code"></td>
      <td class="item"><div class="namewrap"><input data-k="name" list="dlNames" dir="auto" value="${esc(it ? it.name : l.itemText || '')}" placeholder="Item name" enterkeyhint="next"><button type="button" class="lkbtn" data-lk="item" tabindex="-1" title="Lookup (F2)">${ic('search')}</button></div>
        <div class="subline"><label class="xl"><span dir="ltr" data-notr>Exp. Date</span><input data-k="expiry" dir="ltr" inputmode="numeric" value="${esc(expShow(l.expiry))}" placeholder="--/----" title="Expiry (MM/YYYY)" tabindex="-1"></label><input data-k="batch" dir="ltr" value="${esc(l.batch)}" placeholder="Batch" tabindex="-1"><span class="oh"></span></div></td>
      <td class="num" data-label="Price"><input data-k="price" inputmode="decimal" enterkeyhint="next" value="${esc(l.price)}" style="width:104px"></td>
      <td class="num" data-label="Qty"><input data-k="qty" inputmode="decimal" enterkeyhint="next" value="${esc(l.qty)}" style="width:92px"></td>
      <td class="num" data-label="Bonus"><input data-k="bonus" inputmode="decimal" enterkeyhint="next" value="${esc(l.bonus)}" style="width:84px"></td>
      <td class="num" data-label="Disc %"><input data-k="disc" inputmode="decimal" enterkeyhint="next" value="${esc(l.disc)}" placeholder="%" style="width:72px"></td>
      <td class="n amt"></td></tr>`;
  };
  return `<div class="tablewrap"><table class="t lines" id="lines"><thead><tr>
    <th>#</th><th>Code</th><th>Item</th><th class="n">Price</th><th class="n">Qty</th><th class="n">Bonus</th><th class="n">Disc %</th><th class="n">Amount</th></tr></thead>
    <tbody>${(doc.lines.length ? doc.lines : [blankLine()]).map(row).join('')}</tbody></table></div>
    <div class="gfoot"><span id="gStats"></span><span class="gact"><button class="btn small" id="addline" tabindex="-1">+ Line</button><button class="btn small" id="smart" tabindex="-1">${ic('spark')}<span>Smart entry (AI / paste)</span></button></span></div>
    <template id="rowTpl">${row(blankLine())}</template>`;
}

function wireLines(doc, arm, getPid = () => null, setTotal = () => {}) {
  const tbody = $('#lines tbody');
  const ORDER = ['code', 'name', 'price', 'qty', 'bonus', 'disc'];
  const renumber = () => $$('tr', tbody).forEach((tr, i) => ($('.lno', tr).textContent = i + 1));
  const phoneGrid = window.matchMedia('(max-width: 860px)').matches;
  const recalc = () => {
    const lines = $$('tr', tbody).map((tr) => ({ qty: num($('[data-k=qty]', tr).value) || 0, bonus: num($('[data-k=bonus]', tr).value) || 0, price: num($('[data-k=price]', tr).value) || 0, disc: num($('[data-k=disc]', tr).value) || 0 }));
    const tot = computeTotals(lines, { ...docTotalsOpts(doc, S.settings), invoiceDiscount: num($('#invdisc').value) || 0 });
    const R = docTotalsOpts(doc, S.settings).roundTotals;
    $$('tr', tbody).forEach((tr, i) => { $('.amt', tr).textContent = tot.lines[i].amountC ? amt(tot.lines[i].amountC, R) : ''; });
    $('#tSub').textContent = amt(tot.subtotalC, R);
    $('#tRoundRow').hidden = !tot.roundC; $('#tRound').textContent = tot.roundC ? `${tot.roundC > 0 ? '+' : '−'}${amt(Math.abs(tot.roundC), R)}` : '';
    $('#tVat').textContent = money(tot.vatC);
    const n = $$('tr', tbody).filter((tr) => tr.dataset.item).length;
    $('#gStats').innerHTML = n ? `${n} <span>${n === 1 ? 'item' : 'items'}</span> · <span>Qty</span> ${fmt(tot.qtyTotal, 0)} · <span>Bonus</span> ${fmt(tot.bonusTotal, 0)}${tot.discC ? ` · <span>Invoice discount</span> −${amt(tot.discC, R)}` : ''}` : '';
    translate($('#gStats'));
    setTotal(tot.totalC);
    showOh();
  };
  // stock on hand beside the expiry: on screen only, never printed
  let oh = null;
  // Rabee's rule: a sale never stops at zero; the stock goes below zero until the purchase invoice arrives.
  // The line shows the count, and what it will be after this document when that goes below zero.
  const outSign = DOC_TYPES[doc.type].stock || 0;
  const showOh = () => {
    if (!oh) return;
    const need = {};
    $$('tr', tbody).forEach((tr) => { const it = tr.dataset.item; if (it) need[it] = (need[it] || 0) + (num($('[data-k=qty]', tr).value) || 0) + (num($('[data-k=bonus]', tr).value) || 0); });
    $$('tr', tbody).forEach((tr) => {
      const el = $('.oh', tr); const it = tr.dataset.item;
      if (!it) { el.innerHTML = ''; el.classList.remove('short'); return; }
      const have = oh[it]?.qty || 0; const after = have + outSign * need[it];
      const short = outSign < 0 && after < 0;
      el.classList.toggle('short', short || have < 0);
      el.innerHTML = `<span>Stock count</span>: <b dir="ltr">${fmt(have, 0)}</b>${short ? ` · <span>after this document</span>: <b dir="ltr">${fmt(after, 0)}</b>` : ''}`;
      translate(el);
    });
  };
  db.all('stock').then((m) => { oh = stockOnHand(m); showOh(); });
  const setItem = (tr, it) => {
    tr.dataset.item = it ? it.id : '';
    tr.classList.toggle('found', !!it);
    if (!it) return;
    $('[data-k=code]', tr).value = it.code;
    $('[data-k=name]', tr).value = it.name;
    const pr = $('[data-k=price]', tr); if (!pr.value) pr.value = defaultPrice(it, doc.type);
  };
  const byName = (v) => {
    const low = v.trim().toLowerCase(); if (!low) return null;
    const act = S.items.filter((i) => i.active !== false);
    return act.find((i) => i.name.toLowerCase() === low) || uniqueMatch(act, low, false);
  };
  const addRow = () => { tbody.insertAdjacentHTML('beforeend', $('#rowTpl').innerHTML); renumber(); translate(tbody.lastElementChild); return tbody.lastElementChild; };
  const isEmpty = (tr) => !tr.dataset.item && !$('[data-k=code]', tr).value.trim() && !$('[data-k=name]', tr).value.trim();

  tbody.addEventListener('input', (e) => {
    const tr = e.target.closest('tr'); const k = e.target.dataset.k;
    if (k === 'code') {
      const v = e.target.value.trim().toLowerCase();
      const it = v ? S.items.find((i) => i.code.toLowerCase() === v && i.active !== false) : null;
      if (it) setItem(tr, it);
      else { tr.dataset.item = ''; tr.classList.remove('found'); $('[data-k=name]', tr).value = ''; }
      tr.classList.toggle('unknown', !!v && !it);
    }
    if (k === 'name') { const it = S.items.find((i) => i.name === e.target.value && i.active !== false); if (it) setItem(tr, it); }
    recalc();
  });
  tbody.addEventListener('change', (e) => { if (e.target.dataset.k === 'price' && docTotalsOpts(doc, S.settings).roundTotals && e.target.value.trim() !== '') { e.target.value = round1(num(e.target.value)); recalc(); } });
  tbody.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    const tr = b.closest('tr'); if (isEmpty(tr)) return;
    const it = itemById(tr.dataset.item);
    if (!(await ask(T('Remove this item from the invoice?') + (it ? `\n${it.code} — ${it.name}` : ''), 'Yes, remove', 'Cancel'))) return;
    tr.remove(); if (!tbody.children.length) addRow(); renumber(); recalc();
    if (phoneGrid && !$$('tr', tbody).some((r) => isEmpty(r))) addRow();
  });
  tbody.addEventListener('change', (e) => { if (e.target.dataset.k === 'expiry') e.target.value = expShow(expParse(e.target.value)); });
  const pick = async (tr, filter) => {
    const it = await lookupItem(filter, doc.type, getPid());
    if (it) { setItem(tr, it); tr.classList.remove('unknown'); recalc(); const el = $('[data-k=price]', tr); el.focus(); el.select(); }
    else $('[data-k=code]', tr).focus();
  };
  tbody.addEventListener('keydown', async (e) => {
    const tr0 = e.target.closest('tr'); const k0 = e.target.dataset.k;
    if (e.key === 'F2' && k0 === 'price' && tr0.dataset.item) { e.preventDefault(); return lastPrice(tr0); }
    if (e.key === 'F2' && (k0 === 'code' || k0 === 'name')) {
      e.preventDefault();
      if (tr0.dataset.item) {
        const pid = getPid();
        if ((await itemCard(itemById(tr0.dataset.item), pid, doc.type)) !== 'list') { e.target.focus(); return; }
        return pick(tr0, '');
      }
      return pick(tr0, e.target.value.trim());
    }
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const tr = tr0; const k = k0;
    const focus = (key, row = tr) => { const el = $(`[data-k=${key}]`, row); el.focus(); el.select?.(); };
    if (k === 'code') {
      const v = e.target.value.trim();
      if (tr.dataset.item) return focus('price');
      if (!v) return focus('name');
      return pick(tr, v);
    }
    if (k === 'name') {
      if (isEmpty(tr)) {
        // empty line: drop it and go to saving
        if (tbody.children.length > 1) { tr.remove(); renumber(); recalc(); }
        return arm();
      }
      const it = tr.dataset.item ? itemById(tr.dataset.item) : byName(e.target.value);
      if (!it) return pick(tr, e.target.value.trim());
      setItem(tr, it); recalc(); return focus('price');
    }
    const i = ORDER.indexOf(k);
    if (i >= 0 && i < ORDER.length - 1) return focus(ORDER[i + 1]);
    // last field of the line (or batch/expiry): next line
    const next = tr.nextElementSibling || addRow();
    focus('code', next);
  });
  $('#addline').onclick = () => { const tr = addRow(); $('[data-k=code]', tr).focus(); };

  // Bisan's price inquiry: the last price this customer (or supplier) took for the item, approve or not
  const lastPrice = async (tr) => {
    const it = itemById(tr.dataset.item); if (!it) return;
    const pid = getPid(); const P = partyById(pid);
    const types = ['PI', 'PR'].includes(doc.type) ? ['PI'] : ['SI'];
    const hist = S.docs.filter((d) => d.status === 'posted' && types.includes(d.type) && d.partyId === pid && (d.lines || []).some((l) => l.itemId === it.id))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.seqNo || 0) - (a.seqNo || 0));
    const R = docTotalsOpts(doc, S.settings).roundTotals;
    const last = hist[0], ll = last?.lines.find((l) => l.itemId === it.id);
    const opts = [
      ...(ll ? [['last', ll.price, `${esc(last.date)} · <span dir="ltr">${esc(last.number)}</span> · ${T('Qty')} ${fmt(ll.qty || 0, 0)}${ll.bonus ? ` + ${fmt(ll.bonus, 0)}` : ''}`]] : []),
      ...(types[0] === 'PI' ? [['buy', it.buyPrice, T('Buy price')]] : [['ph', it.pricePharmacist, T('Pharmacist price')], ['pub', it.pricePublic, T('Public price')]]),
    ].filter(([, v]) => Number(v) > 0);
    const v = await new Promise((resolve) => {
      const dlg = document.createElement('dialog'); dlg.className = 'lookup card-dlg pricedlg';
      dlg.innerHTML = `<button class="dlg-x" data-x type="button" title="Close" aria-label="Close">${ic('x')}</button>
        <h2 style="margin-top:0" dir="auto">${esc(it.code)} — ${esc(it.name)}</h2>
        <p class="muted" style="margin:-6px 0 14px" dir="auto">${P ? esc(P.name) : ''}</p>
        ${ll ? `<div class="lp"><span>${T(P?.kind === 'supplier' ? 'Last price from this supplier' : 'Last price to this customer')}</span><b dir="ltr">${pricef(ll.price, R)}</b><small dir="auto">${opts[0][2]}</small></div>`
          : `<p class="lp none">${T(P?.kind === 'supplier' ? 'No earlier price from this supplier' : 'No earlier price for this customer')}</p>`}
        <div class="lpo">${opts.filter(([k]) => k !== 'last').map(([k, val, l]) => `<button class="btn tonal small" data-p="${val}">${esc(l)} <b dir="ltr">${pricef(val, R)}</b></button>`).join('')}</div>
        <div class="actions" style="margin-bottom:0">${ll ? `<button class="btn ink" data-p="${ll.price}">${T('Approve')}</button>` : ''}<button class="btn" data-no>${T(ll ? 'No' : 'Close')}</button></div>`;
      document.body.appendChild(dlg); dlg.showModal();
      const end = (x) => { dlg.remove(); resolve(x); };
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); end(null); });
      $('[data-x]', dlg).onclick = () => end(null); $('[data-no]', dlg).onclick = () => end(null);
      $$('[data-p]', dlg).forEach((b) => (b.onclick = () => end(Number(b.dataset.p))));
      setTimeout(() => ($('.actions [data-p]', dlg) || $('[data-no]', dlg)).focus(), 20);
    });
    const el = $('[data-k=price]', tr);
    if (v != null) { el.value = R ? round1(v) : v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    el.focus();
  };
  // long press on a field of a line: code / name → item list (hold a row there for its card),
  // price → last price with Approve, the other fields → the item card
  holdable(tbody, '[data-k]', async (el) => {
    const tr = el.closest('tr'); const k = el.dataset.k;
    if (k === 'code' || k === 'name') return pick(tr, '');
    if (!tr.dataset.item) return;
    if (k === 'price') return lastPrice(tr);
    await itemCard(itemById(tr.dataset.item), getPid(), doc.type, { change: false });
  });

  // Phone: you fill the line itself, like Bisan's grid; there is always one empty line to write on.
  if (window.matchMedia('(max-width: 860px)').matches) {
    ORDER.pop();                                          // discount is not part of the Enter walk on phones
    if (!$$('tr', tbody).some((r) => isEmpty(r))) addRow();
    tbody.addEventListener('focusin', (e) => { if (e.target.dataset.k) e.target.closest('tr').scrollIntoView({ block: 'nearest' }); });
  }
  $('#invdisc').oninput = recalc;
  renumber(); recalc();
}

function voucherUI(doc) {
  return `<div class="row vrow">
    <label class="f vamt">Amount (₪)<input id="amount" inputmode="decimal" value="${esc(doc.amount)}"></label>
    ${['RV', 'PV'].includes(doc.type) ? `
    <label class="f">Method<select id="method">${Object.entries(PAY_METHODS).map(([k, v]) => `<option value="${k}" ${doc.method === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="f">Into / from<select id="cashAccount">${CASH_ACCOUNTS.map((a) => `<option value="${a}" ${doc.cashAccount === a ? 'selected' : ''}>${esc(acctCode(a))} · ${esc(acctName(a))}</option>`).join('')}</select></label>
    <label class="f cheque">Cheque no.<input id="chequeNo" value="${esc(doc.chequeNo || '')}"></label>
    <label class="f cheque">Bank<input id="chequeBank" value="${esc(doc.chequeBank || '')}"></label>
    <label class="f cheque">Due date<input id="dueDate" type="date" value="${esc(doc.dueDate || '')}"></label>`
    : `<input id="method" type="hidden" value=""><input id="cashAccount" type="hidden" value=""><input id="chequeNo" type="hidden"><input id="chequeBank" type="hidden"><input id="dueDate" type="hidden">`}
  </div>`;
}

function smartEntry(doc, readDoc) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<h2 style="margin-top:0">Smart entry</h2>
    <p class="muted">Paste JSON produced by Claude, ChatGPT or Gemini (see the prompt on the Import page), or simple lines like <code>1001 100 +20 @12.5</code> (code, qty, +bonus, @price).</p>
    <textarea id="smartText" dir="auto"></textarea>
    <div class="actions"><button class="btn primary" id="smartGo">Add to draft</button><button class="btn" id="smartClose">Close</button></div>`;
  document.body.appendChild(dlg); dlg.showModal();
  $('#smartClose', dlg).onclick = () => dlg.remove();
  $('#smartGo', dlg).onclick = () => guard(async () => {
    const lines = parseSmart($('#smartText', dlg).value);
    const d = readDoc();
    const missing = lines.filter((l) => !l.itemId).map((l) => l.itemText);
    d.lines = [...d.lines, ...lines.filter((l) => l.itemId)];
    if (!d.lines.length) throw new Error('No known items found');
    const r = await db.saveDraft(d, S.user);
    dlg.remove();
    toast(`${lines.length - missing.length} lines added${missing.length ? ` · not found: ${missing.join(', ')}` : ''}`, !!missing.length);
    go('#/doc/' + r.id);
  });
}
function parseSmart(text) {
  text = text.trim();
  if (text.startsWith('{')) {
    const obj = JSON.parse(text);
    const v = validateImport(obj); if (!v.ok) throw new Error(v.errors.join('\n'));
    return (obj.invoice?.lines || []).map((l) => {
      const it = findItem(l.itemCode || '') || findItem(l.itemName || '');
      return { itemId: it?.id || '', itemText: l.itemCode || l.itemName, qty: num(l.qty) || '', bonus: num(l.bonus) || '', price: l.price != null ? num(l.price) : defaultPrice(it, 'SI'), disc: num(l.disc) || '', batch: l.batch || '', expiry: l.expiry || '' };
    });
  }
  return text.split(/\n+/).map((line) => {
    const tok = line.trim().split(/\s+/); if (!tok[0]) return null;
    const it = findItem(tok[0]);
    const qty = tok.find((x, i) => i > 0 && /^\d+(\.\d+)?$/.test(x));
    const bonus = (tok.find((x) => /^\+\d+/.test(x)) || '').slice(1);
    const price = (tok.find((x) => /^@\d/.test(x)) || '').slice(1);
    return { itemId: it?.id || '', itemText: tok[0], qty: num(qty || ''), bonus: num(bonus), price: price ? num(price) : defaultPrice(it, 'SI'), disc: '', batch: '', expiry: '' };
  }).filter(Boolean);
}

// ---------- view posted / voided ----------
async function viewDoc(d) {
  const t = DOC_TYPES[d.type];
  const p = partyById(d.partyId);
  const prints = await db.byIndex('printlog', 'docId', d.id);
  const tot = t.lines ? computeTotals(d.lines, docTotalsOpts(d, S.settings)) : null;
  const R = t.lines && docTotalsOpts(d, S.settings).roundTotals;
  $('#main').innerHTML = `
    <h1><span>${t.name}</span> <span dir="ltr">${esc(d.number)}</span> <span class="pill ${d.status}">${d.status}</span>${d.backdated ? ' <span class="pill bad">Backdated</span>' : ''}</h1>
    <p class="sub">${esc(d.date)} · ${esc(partyLabel(p))}${d.reference ? ` · Ref. ${esc(d.reference)}` : ''} · posted by ${esc(d.postedBy)} ${esc((d.postedAt || '').slice(0, 16).replace('T', ' '))}</p>
    ${d.status === 'voided' ? `<div class="note bad">Voided by ${esc(d.voidedBy)} on ${esc(d.voidedAt?.slice(0, 10))}: ${esc(d.voidReason)}. A reversing entry was posted; the number stays used.</div>` : ''}
    ${t.lines ? `<div class="tablewrap" style="margin-top:16px"><table class="t"><thead><tr><th>Code</th><th>Item</th><th>Batch</th><th>Expiry</th><th class="n">Qty</th><th class="n">Bonus</th><th class="n">Price</th><th class="n">Disc %</th><th class="n">Amount</th></tr></thead><tbody>
      ${tot.lines.map((l) => { const it = lineItem(l); return `<tr><td>${esc(it.code)}</td><td dir="auto">${esc(it.name)}</td><td>${esc(l.batch)}</td><td>${esc(l.expiry)}</td><td class="n">${fmt(l.qty || 0, 0)}</td><td class="n">${l.bonus ? fmt(l.bonus, 0) : ''}</td><td class="n">${pricef(l.price, R)}</td><td class="n">${l.disc ? l.disc + '%' : ''}</td><td class="n">${amt(l.amountC, R)}</td></tr>`; }).join('')}
      </tbody><tfoot><tr><td colspan="4">Totals</td><td class="n">${fmt(tot.qtyTotal, 0)}</td><td class="n">${fmt(tot.bonusTotal, 0)}</td><td></td><td></td><td class="n">${amt(tot.subtotalC, R)}</td></tr></tfoot></table></div>
      <div class="row" style="margin-top:14px"><div class="totals card">
        ${tot.discC ? `<div><span>Invoice discount</span><span>−${amt(tot.discC, R)}</span></div>` : ''}${tot.roundC ? `<div><span>Rounding</span><span dir="ltr">${tot.roundC > 0 ? '+' : '−'}${amt(Math.abs(tot.roundC), R)}</span></div>` : ''}
        <div><span>Net</span><span>${money(tot.netC)}</span></div><div><span>VAT</span><span>${money(tot.vatC)}</span></div>
        <div class="grand"><span>Total ₪</span><span>${amt(tot.totalC, R)}</span></div><div class="words">${esc(amountInWords(fromCents(tot.totalC)))}</div></div></div>`
    : `<div class="card" style="margin-top:16px"><div class="kpi"><div class="label">Amount</div><div class="value">${money(d.totalC)} ₪</div></div>
        <p class="words">${esc(amountInWords(fromCents(d.totalC)))}</p>
        ${d.method ? `<p>${PAY_METHODS[d.method] || ''} → ${d.cashAccount ? `${esc(acctCode(d.cashAccount))} ${esc(acctName(d.cashAccount))}` : ''}${d.chequeNo ? ` · Cheque ${esc(d.chequeNo)} ${esc(d.chequeBank)} due ${esc(d.dueDate)}` : ''}</p>` : ''}</div>`}
    ${d.notes ? `<p dir="auto">${esc(d.notes)}</p>` : ''}
    <div class="actions">
      <button class="btn ink" id="printBtn">${prints.length ? `Print copy ${prints.length + 1}` : 'Print original'} <kbd>F9</kbd></button>
      <button class="btn" id="backBtn">Back <kbd>Esc</kbd></button>
      ${t.party !== 'none' && d.type !== 'OB' ? '<button class="btn tonal" id="dup">Duplicate as new draft</button>' : ''}
      ${d.status === 'posted' && isAdmin() ? '<button class="btn danger" id="void">Void (reversing entry)</button>' : ''}
      ${d.status === 'posted' && !isAdmin() ? '<span class="muted">Only the admin can void.</span>' : ''}
    </div>
    <h2>Print history</h2>
    ${prints.length ? `<table class="t"><tbody>${prints.map((x) => `<tr><td>${x.copyNo === 1 ? '<b>Original</b>' : 'Copy ' + x.copyNo}</td><td>${esc(x.user)}</td><td>${esc(x.at.slice(0, 16).replace('T', ' '))}</td><td>${esc(x.reason || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Not printed yet. The first print will be marked Original, once only.</p>'}`;
  pageKeys = (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') { e.preventDefault(); backToPlace(); }
    else if (e.key === 'F9') { e.preventDefault(); $('#printBtn').click(); }
  };
  $('#printBtn').onclick = () => guard(async () => {
    let reason = '';
    if (prints.length && isAdmin() && !prints.some((x) => x.copyNo > 1) && confirm('Was the original lost (printer jam, damaged)? Press OK to record a reason; it still prints as a Copy.')) reason = prompt('Reason:') || '';
    await printDoc(d, reason); render();
  });
  $('#backBtn').onclick = backToPlace;
  $('#dup') && ($('#dup').onclick = () => guard(async () => {
    const { id, number, series, seqNo, status, postedAt, postedBy, voidedAt, voidedBy, voidReason, backdated, backdateReason, totalC, vatC, netC, qtyTotal, bonusTotal, settingsAtPost, createdAt, createdBy, updatedAt, cancelledAt, cancelledBy, ...rest } = d;
    const r = await db.saveDraft({ ...rest, date: today(), reference: '', notes: rest.notes ? rest.notes : '' }, S.user);
    toast('Draft created'); go('#/doc/' + r.id);
  }));
  $('#void') && ($('#void').onclick = () => guard(async () => {
    const reason = prompt(`Void ${d.number}? A reversing entry will be posted and the number stays used.\n\nReason:`);
    if (!reason) return;
    await db.voidDoc(d.id, reason, S.user); toast('Voided with reversing entry'); render();
  }));
}

// ---------- printing ----------
async function printDoc(d, reason = '', copies = 1) {
  const pages = [];
  for (let i = 0; i < (d.status === 'draft' ? 1 : copies); i++) pages.push(await db.logPrint(d.id, S.user, 'print', reason));
  const t = DOC_TYPES[d.type];
  const p = partyById(d.partyId) || {};
  const s = S.settings;
  const opt = docTotalsOpts(d, s);
  const tot = t.lines ? computeTotals(d.lines, opt) : { totalC: toCents(d.amount) };
  const stampOf = ({ label, copyNo }) => (label === 'ORIGINAL' ? 'ORIGINAL · أصلية' : label === 'COPY' ? `COPY ${copyNo} · نسخة ${copyNo}` : 'DRAFT · مسودة');
  const ar = { SI: 'فاتورة ضريبية', SR: 'مرتجع مبيعات', PI: 'فاتورة مشتريات', PR: 'مرتجع مشتريات', RV: 'سند قبض', PV: 'سند صرف', CN: 'إشعار دائن', DN: 'إشعار مدين', OB: 'رصيد افتتاحي', OS: 'بضاعة أول المدة' }[d.type];
  // Print layout: company head with a monogram, grey title block, black table head, zebra rows,
  // boxed total, amount in words, signature. Digits stay Latin; the screen-only stock never prints.
  const A = getLang() === 'ar';
  const L = (en, a) => (A ? a : en);
  const page = ({ label, copyNo }, idx) => { const stamp = stampOf({ label, copyNo }); return `<div class="doc-print page" dir="${A ? 'rtl' : 'ltr'}">
    ${label === 'DRAFT' ? '<div class="wm">مسودة</div>' : ''}
    ${letterhead()}
    <div class="tb"><div class="tbh"><div><div class="t1">${L(t.name, ar)}</div>
        <div class="tno">${L('No.', 'الرقم')}: <b dir="ltr">${esc(d.number || L('DRAFT', 'مسودة'))}</b> · ${L('Date', 'التاريخ')}: <b dir="ltr">${esc(d.date)}</b>${d.reference ? ` · ${L('Ref.', 'مرجع')}: <b>${esc(d.reference)}</b>` : ''}</div></div>
        <div class="stamp">${stamp}</div></div>
      ${t.party !== 'none' ? `<div class="pl">${p.kind === 'supplier' ? L('Supplier', 'المورد') : L('Customer', 'الزبون')}: <b dir="auto">${esc(p.code)} — ${esc(p.name)}</b>${p.address || p.region ? ` — ${L('Address', 'العنوان')}: <b dir="auto">${esc([p.address, p.region ? regionName(p.region) : ''].filter(Boolean).join(' · '))}</b>` : ''}</div>
      <div class="ps">${[p.taxNo ? `${L('Tax no.', 'رقم المشتغل')} ${esc(p.taxNo)}` : '', d.salesman ? `${L('Salesman', 'المندوب')} ${esc(d.salesman)}` : '', L('All amounts in NIS', 'جميع المبالغ بالشيكل') + (t.lines && opt.pricesIncludeVat ? L(', VAT included', '، الأسعار تشمل ض.ق.م') : '')].filter(Boolean).join(' · ')}</div>` : ''}</div>
    ${t.lines ? `<table><thead><tr><th class="c">${L('#', 'م.')}</th><th>${L('Code', 'الكود')}</th><th>${L('Item', 'الصنف')}</th><th class="c">${L('Qty', 'الكمية')}</th><th class="c">${L('Bonus', 'بونص')}</th><th class="c">${L('Price', 'السعر')}</th><th class="c">${L('Disc.', 'خصم')}</th><th class="n">${L('Amount', 'المجموع')}</th></tr></thead><tbody>
      ${tot.lines.map((l, k) => { const it = lineItem(l); return `<tr><td class="c">${String(k + 1).padStart(2, '0')}</td><td>${esc(it.code)}</td><td dir="auto">${esc(it.name)}${l.batch || l.expiry ? `<div class="batch">${L('Batch', 'دفعة')} <span dir="ltr">${esc(l.batch || '—')}</span> · ${L('Exp.', 'انتهاء')} <span dir="ltr">${esc(l.expiry || '—')}</span></div>` : ''}</td>
        <td class="c">${fmt(l.qty || 0, 0)}</td><td class="c">${l.bonus ? fmt(l.bonus, 0) : ''}</td><td class="c">${pricef(l.price, opt.roundTotals)}</td><td class="c">${l.disc ? l.disc + '%' : ''}</td><td class="n"><b>${amt(l.amountC, opt.roundTotals)}</b></td></tr>`; }).join('')}
      </tbody></table>
      <div class="tot"><div class="sum"><div><span>${L('Lines', 'عدد الأصناف')} ${tot.lines.length} · ${L('Total qty', 'مجموع الكمية')} ${fmt(tot.qtyTotal, 0)} · ${L('Total bonus', 'مجموع البونص')} ${fmt(tot.bonusTotal, 0)}</span><span></span></div>
          <div><span>${L('Items total', 'المجموع')}</span><span>${amt(tot.subtotalC, opt.roundTotals)}</span></div>
          ${tot.discC ? `<div><span>${L('Invoice discount', 'خصم على الفاتورة')}</span><span>−${amt(tot.discC, opt.roundTotals)}</span></div>` : ''}${tot.roundC ? `<div><span>${L('Rounding', 'تقريب')}</span><span dir="ltr">${tot.roundC > 0 ? '+' : '−'}${amt(Math.abs(tot.roundC), opt.roundTotals)}</span></div>` : ''}
          <div><span>${L('Net before VAT', 'الصافي قبل الضريبة')}</span><span>${money(tot.netC)}</span></div><div><span>${L('VAT', 'الضريبة')} ${opt.vatRate}%</span><span>${money(tot.vatC)}</span></div></div>
        <div class="g"><span>${L('Total (NIS)', 'المبلغ (شيكل)')}</span><span>${amt(tot.totalC, opt.roundTotals)}</span></div></div>`
    : `${d.method ? `<table><tbody><tr><td>${L('Method', 'طريقة الدفع')}</td><td><b>${esc(T(PAY_METHODS[d.method] || ''))}</b></td></tr>${d.chequeNo ? `<tr><td>${L('Cheque', 'شيك')}</td><td><b><span dir="ltr">${esc(d.chequeNo)}</span> · <span dir="auto">${esc(d.chequeBank)}</span> · <span dir="ltr">${esc(d.dueDate)}</span></b></td></tr>` : ''}</tbody></table>` : ''}
       <div class="tot"><div class="g"><span>${L('Amount (NIS)', 'المبلغ (شيكل)')}</span><span>${money(tot.totalC)}</span></div></div>`}
    <div class="wbox"><div class="wl">${L('Amount in words', 'المبلغ كتابةً')}</div><div class="words" dir="rtl">${esc(amountInWords(fromCents(tot.totalC)))}</div>${d.notes ? `<div class="nt" dir="auto">${esc(d.notes)}</div>` : ''}</div>
    <div class="sign"><span>${L('Signature', 'التوقيع')}</span><span>${L('Received by', 'المستلم')}</span></div>
    <div class="meta"><span>${L('Printed by', 'طُبعت بواسطة')} <span dir="auto">${esc(S.user)}</span> · <span dir="ltr">${new Date().toLocaleString('en-GB')}</span> · ${esc(stamp)}</span><span dir="ltr">${String(idx + 1).padStart(2, '0')} / ${String(pages.length).padStart(2, '0')}</span></div>
  </div>`; };
  $('#printArea').innerHTML = pages.map(page).join('');
  document.body.classList.add('printing');
  setTimeout(() => { window.print(); document.body.classList.remove('printing'); }, 50);
}

// ---------- items ----------
routes.items = async () => {
  $('#main').innerHTML = `<h1>Items</h1><p class="sub">${S.items.length} items. Codes are permanent. Items are never deleted, only deactivated.</p>
    <div class="searchbar"><input id="q" placeholder="Search by code or name" autofocus>${isAdmin() ? '<button class="btn primary" id="add">Add item</button>' : '<span class="muted">Only the admin adds or edits items.</span>'}</div>
    <p class="hint" style="margin:-6px 4px 16px">${isAdmin() ? 'Click a row to edit it.' : ''} <kbd>Enter</kbd> <span>opens the only match.</span></p>
    <div class="tablewrap"><table class="t deflist"><tbody id="tb">
    ${S.items.map((i) => `<tr data-id="${i.id}" data-s="${esc((i.code + ' ' + i.name + ' ' + (i.brand || '')).toLowerCase())}"><td class="dl"><b dir="ltr">${esc(i.code)}</b> <span dir="auto">${esc(i.name)}</span>${i.active === false ? ` <span class="pill">inactive</span>` : ''}</td>
      <td class="de">${isAdmin() ? `<button class="btn small" data-edit="${i.id}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  $('#q').oninput = (e) => { const s = e.target.value.toLowerCase(); $$('#tb tr').forEach((tr) => (tr.style.display = tr.dataset.s.includes(s) ? '' : 'none')); };
  $('#add') && ($('#add').onclick = () => itemForm({}));
  const openItem = (id) => (isAdmin() ? guard(async () => itemForm(itemById(id), await db.hasMovements('items', id))) : itemCard(itemById(id), null, 'SI', { change: false }));
  $$('[data-edit]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openItem(b.dataset.edit); }));
  $$('#tb tr').forEach((tr) => { tr.style.cursor = 'pointer'; tr.onclick = () => openItem(tr.dataset.id); });
  $('#q').onkeydown = (e) => { if (e.key !== 'Enter') return; const vis = $$('#tb tr').filter((tr) => tr.style.display !== 'none'); if (vis.length === 1) openItem(vis[0].dataset.id); };
  $('#q').focus();
};
function itemForm(it, locked = false) {
  const dlg = document.createElement('dialog');
  const f = (k, label, type = 'text') => `<label class="f">${label}<input name="${k}" type="${type}" ${type === 'number' ? 'step="any"' : ''} dir="auto" value="${esc(it[k] ?? '')}" ${k === 'code' && it.id ? 'readonly' : ''}></label>`;
  dlg.innerHTML = `<h2 style="margin-top:0">${it.id ? 'Edit item' : 'New item'}</h2><form method="dialog" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    ${f('code', 'Code (permanent)')}${f('name', 'Name')}${f('brand', 'Brand / company')}${f('category', 'Category')}${f('unit', 'Unit')}${f('barcode', 'Barcode')}
    ${f('buyPrice', 'Buy price', 'number')}${f('pricePublic', 'Public price', 'number')}${f('pricePharmacist', 'Pharmacist price', 'number')}
    <label class="f">Active<select name="active"><option value="true">Yes</option><option value="false" ${it.active === false ? 'selected' : ''}>No</option></select></label>
    ${it.id ? `<label class="f">Replaced by (if inactive)<select name="replacedBy"><option value="">—</option>${S.items.filter((x) => x.id !== it.id && x.active !== false).map((x) => `<option value="${x.id}" ${it.replacedBy === x.id ? 'selected' : ''}>${esc(x.code)} — ${esc(x.name)}</option>`).join('')}</select></label>` : ''}
    <p class="muted" style="grid-column:1/-1;margin:0">${locked ? 'This item has movements: its name takes spelling fixes only. For a different name, set Active to No (it stays in every account and report) and add a new item.' : 'No movements yet, so the name can still be corrected freely.'}</p>
    <div class="actions" style="grid-column:1/-1"><button class="btn primary" value="save">Save</button><button class="btn" value="cancel">Cancel</button></div></form>`;
  document.body.appendChild(dlg); translate(dlg); dlg.showModal();
  if (!it.id) $('[name=code]', dlg).value = nextNumericCode(S.items.map((i) => i.code));
  dlg.addEventListener('close', () => guard(async () => {
    if (dlg.returnValue !== 'save') return dlg.remove();
    const fd = Object.fromEntries(new FormData($('form', dlg)));
    dlg.remove();
    if (!fd.name || !fd.code) throw new Error('Code and name are required');
    if (!it.id && S.items.some((i) => i.code.toLowerCase() === fd.code.toLowerCase())) throw new Error('This code already exists');
    const sim = similarNames(fd.name, S.items.filter((i) => i.id !== it.id));
    if (sim.length && !confirm(`Similar item exists: ${sim.map((x) => x.code + ' ' + x.name).join(', ')}. Add anyway?`)) return;
    for (const k of ['buyPrice', 'pricePublic', 'pricePharmacist']) fd[k] = fd[k] === '' ? '' : Number(fd[k]);
    fd.active = fd.active === 'true';
    await db.saveMaster('items', { ...it, ...fd }, S.user); toast('Saved'); render();
  }));
}

// ---------- customers / suppliers ----------
routes.customers = () => partiesPage('customer');
routes.suppliers = () => partiesPage('supplier');
async function partiesPage(kind) {
  const list = S.parties.filter((p) => p.kind === kind);
  const entries = await ledger();
  const bal = {};
  for (const e of entries) if (e.partyId) bal[e.partyId] = (bal[e.partyId] || 0) + (kind === 'supplier' ? e.creditC - e.debitC : e.debitC - e.creditC);
  const title = kind === 'customer' ? 'Customers' : 'Suppliers';
  $('#main').innerHTML = `<h1>${title}</h1><p class="sub">${list.length} ${title.toLowerCase()}. Codes are permanent. Only the admin adds them.</p>
    <div class="searchbar"><input id="q" placeholder="Search by code or name" autofocus>
    ${kind === 'customer' ? `<select id="reg">${regionOptions(new URLSearchParams(location.hash.split('?')[1] || '').get('region') || '', 'All regions')}</select>` : ''}
    ${isAdmin() ? `<button class="btn primary" id="add">Add ${kind}</button>` : ''}</div>
    <p class="hint" style="margin:-6px 4px 16px">${isAdmin() ? 'Click a row to edit it.' : 'Click a row for its card.'} <kbd>Enter</kbd> <span>opens the only match.</span></p>
    <div class="tablewrap"><table class="t deflist"><tbody id="tb">
    ${(kind === 'customer' ? [...list].sort((a, b) => (regionOf(a.region)?.code || '99').localeCompare(regionOf(b.region)?.code || '99') || a.code.localeCompare(b.code, undefined, { numeric: true })) : [...list].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })))
      .map((p) => `<tr data-id="${p.id}" data-s="${esc((p.code + ' ' + p.name + ' ' + (p.phone || '')).toLowerCase())}" data-r="${p.region || ''}"><td class="dl"><b dir="ltr">${esc(p.code)}</b> <span dir="auto">${esc(p.name)}</span>${kind === 'customer' && regionName(p.region) ? ` <span class="dreg">- ${esc(regionName(p.region))}</span>` : ''}${p.active === false ? ` <span class="pill">inactive</span>` : ''}</td>
      <td class="de">${isAdmin() ? `<button class="btn small" data-edit="${p.id}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  const filt = () => { const s = $('#q').value.toLowerCase(); const r = $('#reg')?.value || ''; $$('#tb tr').forEach((tr) => (tr.style.display = tr.dataset.s.includes(s) && (!r || tr.dataset.r === r) ? '' : 'none')); };
  $('#q').oninput = filt; $('#reg') && ($('#reg').onchange = filt);
  $('#add') && ($('#add').onclick = () => partyForm({ kind }));
  const openParty = (id) => (isAdmin() ? guard(async () => partyForm(partyById(id), await db.hasMovements('parties', id))) : partyCard(partyById(id), { change: false }));
  $$('[data-edit]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openParty(b.dataset.edit); }));
  $$('#tb tr a').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  $$('#tb tr[data-id]').forEach((tr) => { tr.style.cursor = 'pointer'; tr.onclick = () => openParty(tr.dataset.id); });
  $('#q').onkeydown = (e) => { if (e.key !== 'Enter') return; const vis = $$('#tb tr[data-id]').filter((tr) => tr.style.display !== 'none'); if (vis.length === 1) openParty(vis[0].dataset.id); };
  filt(); $('#q').focus();
}
function partyForm(p, locked = false) {
  const dlg = document.createElement('dialog');
  const f = (k, label, type = 'text') => `<label class="f">${label}<input name="${k}" type="${type}" ${type === 'number' ? 'step="any"' : ''} dir="auto" value="${esc(p[k] ?? '')}" ${k === 'code' && p.id ? 'readonly' : ''}></label>`;
  const cust = p.kind === 'customer';
  dlg.innerHTML = `<h2 style="margin-top:0">${p.id ? 'Edit' : 'New'} ${p.kind}</h2><form method="dialog" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    ${f('code', 'Code (permanent)')}${f('name', 'Name')}${f('phone', 'Phone')}${f('address', 'Address')}${f('taxNo', 'Tax / licensed dealer no.')}
    ${cust ? `<label class="f">Region<select name="region">${regionOptions(p.region || regionsList()[0]?.key)}</select></label>
      <label class="f">Type<select name="type">${Object.entries(CUSTOMER_TYPES).map(([k, v]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${f('creditLimit', 'Credit limit (₪)', 'number')}${f('guarantor', 'Guarantor')}` : ''}
    ${p.id ? '' : f('openingBalance', 'Opening balance (₪)', 'number')}
    ${p.id ? `<label class="f">Active<select name="active"><option value="true">Yes</option><option value="false" ${p.active === false ? 'selected' : ''}>No</option></select></label>
      <label class="f">Replaced by (if inactive)<select name="replacedBy"><option value="">—</option>${S.parties.filter((x) => x.kind === p.kind && x.id !== p.id && x.active !== false).map((x) => `<option value="${x.id}" ${p.replacedBy === x.id ? 'selected' : ''}>${esc(partyLabel(x))}</option>`).join('')}</select></label>
      <p class="muted" style="grid-column:1/-1;margin:0">${locked ? `This ${p.kind} has movements: its name takes spelling fixes only. For a different name, set Active to No (it stays in every account and report) and add a new ${p.kind}.` : 'No movements yet, so the name can still be corrected freely.'}</p>` : ''}
    <div class="actions" style="grid-column:1/-1"><button class="btn primary" value="save">Save</button><button class="btn" value="cancel">Cancel</button></div></form>`;
  document.body.appendChild(dlg); translate(dlg); dlg.showModal();
  if (!p.id) $('[name=code]', dlg).value = nextNumericCode(S.parties.filter((x) => x.kind === p.kind).map((x) => x.code));
  dlg.addEventListener('close', () => guard(async () => {
    if (dlg.returnValue !== 'save') return dlg.remove();
    const fd = Object.fromEntries(new FormData($('form', dlg)));
    dlg.remove();
    if (!fd.name || !fd.code) throw new Error('Code and name are required');
    if (!p.id && S.parties.some((x) => x.code.toLowerCase() === fd.code.toLowerCase())) throw new Error('This code already exists');
    const sim = similarNames(fd.name, S.parties.filter((x) => x.id !== p.id));
    if (sim.length && !confirm(`Similar name exists: ${sim.map((x) => x.code + ' ' + x.name).join(', ')}. Add anyway?`)) return;
    const ob = Number(fd.openingBalance || 0); delete fd.openingBalance;
    if (fd.active !== undefined) fd.active = fd.active === 'true';
    if (p.id && fd.active === false && p.active !== false) {
      const bal = await partyBalanceC(p.id);
      if (bal !== 0 && !confirm(`${p.code} has a balance of ${money(bal)}. It stays on this account and in every report. Receipts, payments and notes can still be posted to it. Deactivate?`)) return;
    }
    if (fd.creditLimit !== undefined) fd.creditLimit = fd.creditLimit === '' ? '' : Number(fd.creditLimit);
    const rec = await db.saveMaster('parties', { ...p, ...fd }, S.user);
    if (ob) await postOpening(rec, ob);
    toast('Saved'); render();
  }));
}
async function postOpening(party, amount) {
  const d = await db.saveDraft({ type: 'OB', date: today(), partyId: party.id, partyKind: party.kind, amount, notes: 'Opening balance' }, S.user);
  await db.post(d.id, S.user, S.settings, { allowBackdate: true, backdateReason: 'opening balance' });
}

// ---------- reports ----------
// ---------- account statement (Bisan's way: a refresh button opens the choice screen) ----------
// options: party, region (narrows the party list), from / to, brief or detailed, posted only or including saved
async function statementOf(party, { from = '', to = '', saved = false, except = null } = {}) {
  const entries = await ledger();
  const extra = saved ? draftEntries(S.docs, S.settings, { partyId: party.id, except }) : [];
  return statement([...entries, ...extra], S.docs, party.id, party.kind, { from, to });
}
const stLines = (d) => {
  if (!d || !DOC_TYPES[d.type]?.lines) return '';
  const R = docTotalsOpts(d, S.settings).roundTotals;
  const tot = computeTotals(d.lines || [], docTotalsOpts(d, S.settings));
  return tot.lines.filter((l) => l.itemId).map((l) => { const it = itemById(l.itemId) || {}; return `<div><span dir="ltr">${esc(it.code || '')}</span> <span dir="auto">${esc(it.name || '')}</span> · ${fmt(l.qty || 0, 0)}${l.bonus ? ` + ${fmt(l.bonus, 0)}` : ''} × ${pricef(l.price, R)} = <b>${amt(l.amountC, R)}</b></div>`; }).join('');
};
// the description of a statement line, written out like an accountant would: type and number, reference,
// how a voucher was paid (cheque no., bank, due date), how many items an invoice carried
function stDesc(r, link = true) {
  const d = r.doc || {};
  const t = DOC_TYPES[r.type]?.name || '';
  const num = r.number || d.number;
  const no = num ? (link ? `<a href="#/doc/${r.docId}" dir="ltr">${esc(num)}</a>` : `<span dir="ltr">${esc(num)}</span>`)
    : (link ? `<a href="#/doc/${r.docId}">${esc(T('saved, no number yet'))}</a>` : esc(T('saved, no number yet')));
  const bits = [];
  if (d.reference) bits.push(`${esc(T('Ref.'))} <span dir="auto">${esc(d.reference)}</span>`);
  if (['RV', 'PV'].includes(r.type) && d.method) bits.push(d.method === 'cheque' && d.chequeNo
    ? `${esc(T('Cheque'))} <span dir="ltr">${esc(d.chequeNo)}</span>${d.chequeBank ? ` · <span dir="auto">${esc(d.chequeBank)}</span>` : ''}${d.dueDate ? ` · ${esc(T('due'))} <span dir="ltr">${esc(d.dueDate)}</span>` : ''}`
    : esc(T(PAY_METHODS[d.method] || '')));
  if (DOC_TYPES[r.type]?.lines) { const n = (d.lines || []).filter((l) => l.itemId).length; if (n) bits.push(`${n} ${esc(T(n === 1 ? 'item' : 'items'))}`); }
  if (d.notes && r.type !== 'OB') bits.push(`<span dir="auto">${esc(d.notes.slice(0, 60))}</span>`);
  const head = r.type === 'OB' ? `${esc(T('Opening balance'))} ${no}` : `${r.reversal ? esc(T('Void of')) + ' ' : ''}${esc(T(t))} ${esc(T('no.'))} ${no}`;
  return `<span class="dh">${head}</span>${bits.length ? `<span class="dx">${bits.join(' · ')}</span>` : ''}`;
}
function statementTable(st, { saved = false, detail = false, print = false } = {}) {
  const status = (r) => (saved ? `<td class="ss"><span class="pill ${r.draft ? 'draft' : 'posted'}">${esc(T(r.draft ? 'Saved (draft)' : 'Posted'))}</span></td>` : '');
  const span = saved ? 3 : 2;
  const dr = st.rows.reduce((s, r) => s + r.debitC, 0), cr = st.rows.reduce((s, r) => s + r.creditC, 0);
  return `<div class="${print ? '' : 'tablewrap'}"><table class="${print ? 'pst' : `t st${saved ? ' withst' : ''}`}"><thead><tr><th>${esc(T('Date'))}</th><th>${esc(T('Description'))}</th>${saved ? `<th>${esc(T('Status'))}</th>` : ''}<th class="n">${esc(T('Debit'))}</th><th class="n">${esc(T('Credit'))}</th><th class="n">${esc(T('Balance'))}</th></tr></thead><tbody>
    ${st.opening ? `<tr class="sop"><td class="sd"></td><td class="sn"><span class="dh">${esc(T('Balance brought forward'))}</span></td>${saved ? '<td class="ss"></td>' : ''}<td class="n sdb"></td><td class="n scr"></td><td class="n sb"><b>${money(st.opening)}</b></td></tr>` : ''}
    ${st.rows.map((r) => `<tr class="${r.draft ? 'isdraft' : ''}"><td class="sd" dir="ltr">${esc(r.date)}</td><td class="sn">${stDesc(r, !print)}</td>${status(r)}
      <td class="n sdb">${r.debitC ? money(r.debitC) : ''}</td><td class="n scr">${r.creditC ? money(r.creditC) : ''}</td><td class="n sb"><b>${money(r.balanceC)}</b></td></tr>
      ${detail && !r.reversal && stLines(r.doc) ? `<tr class="sdet"><td></td><td colspan="${span + 3}">${stLines(r.doc)}</td></tr>` : ''}`).join('')}
    </tbody><tfoot><tr><td colspan="${span}">${esc(T('Total balance'))}</td><td class="n">${money(dr)}</td><td class="n">${money(cr)}</td><td class="n">${money(st.closing)}</td></tr></tfoot></table></div>`;
}
// head of a statement, screen and paper alike: who, which period, and the balance they owe (or we owe)
function statementHead(party, o, st) {
  const owes = st.closing >= 0;
  const word = party.kind === 'supplier' ? (owes ? 'We owe' : 'They owe us') : (owes ? 'Required balance' : 'Credit balance');
  return `<div class="sthd"><div class="sthp"><div class="sthn" dir="auto">${esc(party.code)} — ${esc(party.name)}</div>
      <div class="sths">${party.region ? `${esc(regionName(party.region))} · ` : ''}<span dir="ltr">${esc(o.from || '…')} → ${esc(o.to || today())}</span> · ${esc(T('NIS'))}${o.saved ? ` · ${esc(T('Including saved'))}` : ''}</div></div>
    <div class="sthb"><span>${esc(T(word))}</span><b dir="ltr">${money(Math.abs(st.closing))}</b></div></div>`;
}
function statementOptions(cur = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog'); dlg.className = 'lookup card-dlg stopts';
    let party = partyById(cur.pid);
    const regionSel = `<select id="soRegion">${regionOptions(cur.region, 'All regions')}</select>`;
    dlg.innerHTML = `<button class="dlg-x" data-x type="button" title="Close" aria-label="Close">${ic('x')}</button><h2 style="margin-top:0">Account statement</h2>
      <div class="sog">
        <label class="f wide">Customer or supplier<div class="namewrap"><input id="soParty" dir="auto" readonly placeholder="Tap to choose" value="${esc(partyLabel(party))}"><button type="button" class="lkbtn" id="soLook" title="Lookup">${ic('search')}</button></div></label>
        <label class="f">Region${regionSel}</label>
        <label class="f">From<input id="soFrom" type="date" value="${esc(cur.from || '')}"></label>
        <label class="f">To<input id="soTo" type="date" value="${esc(cur.to || '')}"></label>
        <div class="f wide"><span>Display</span><div class="seg2"><button type="button" data-d="0" class="${cur.detail ? '' : 'on'}">Brief</button><button type="button" data-d="1" class="${cur.detail ? 'on' : ''}">Detailed</button></div></div>
      </div>
      <div class="actions sobtn" style="margin-bottom:0"><button class="btn tonal" data-m="all">Including saved</button><button class="btn ink" data-m="posted">Posted only</button></div>`;
    document.body.appendChild(dlg); translate(dlg); dlg.showModal();
    let detail = !!cur.detail;
    const end = (v) => { dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); end(null); });
    $('[data-x]', dlg).onclick = () => end(null);
    $$('[data-d]', dlg).forEach((b) => (b.onclick = () => { detail = b.dataset.d === '1'; $$('[data-d]', dlg).forEach((x) => x.classList.toggle('on', x === b)); }));
    const choose = async () => {
      const reg = $('#soRegion', dlg).value;
      const list = S.parties.filter((p) => !reg || p.region === reg);
      const cust = list.filter((p) => p.kind === 'customer'), sup = list.filter((p) => p.kind === 'supplier');
      const p = await lookupParty(party?.kind === 'supplier' && sup.length ? sup : cust.length ? cust : sup, '');
      if (p) { party = p; $('#soParty', dlg).value = partyLabel(p); }
    };
    $('#soLook', dlg).onclick = choose; $('#soParty', dlg).onclick = choose;
    $$('[data-m]', dlg).forEach((b) => (b.onclick = () => {
      if (!party) { toast('Choose a customer or supplier', true); return; }
      end({ pid: party.id, region: $('#soRegion', dlg).value, from: $('#soFrom', dlg).value, to: $('#soTo', dlg).value, detail, saved: b.dataset.m === 'all' });
    }));
  });
}
routes.statement = async (pid) => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const party = partyById(pid);
  const o = { pid, region: q.get('region') || '', from: q.get('from') || '', to: q.get('to') || '', detail: q.get('detail') === '1', saved: q.get('saved') === '1' };
  const open = async () => {
    const r = await statementOptions(o); if (!r) return;
    go(`#/statement/${r.pid}?from=${r.from}&to=${r.to}&region=${r.region}&detail=${r.detail ? 1 : 0}&saved=${r.saved ? 1 : 0}`);
  };
  $('#main').innerHTML = `<div class="sthead"><div><h1>Account statement</h1>
      <p class="sub">${party ? `<b dir="auto">${esc(partyLabel(party))}</b>${party.region ? ` · <span>${esc(regionName(party.region))}</span>` : ''} · <span dir="ltr">${esc(o.from || '…')} → ${esc(o.to || today())}</span> · <span>${o.saved ? 'Including saved' : 'Posted only'}</span> · <span>${o.detail ? 'Detailed' : 'Brief'}</span>` : 'Choose a customer or supplier'}</p></div>
      <div class="stbtns"><button class="rb main" id="stOpts" title="Statement options" aria-label="Statement options">${ic('undo')}</button><button class="rb" id="pr" title="Print / PDF" aria-label="Print / PDF">${ic('printer')}</button><button class="rb" id="xl" title="Excel" aria-label="Excel">${ic('in')}</button></div></div>
    <div id="out" style="margin-top:16px"></div>`;
  $('#stOpts').onclick = open;
  if (!party) { $('#pr').disabled = $('#xl').disabled = true; setTimeout(open, 60); return; }
  const mk = party.kind === 'supplier' ? [['PV', 'Payment voucher'], ['PI', 'Purchase invoice']] : [['RV', 'Receipt voucher'], ['SI', 'Sales invoice']];
  $('#out').insertAdjacentHTML('beforebegin', `<div class="chain">${mk.map(([k, n], i) => `<a class="btn ${i ? '' : 'ink'}" href="#/new/${k}?party=${party.id}">${ic('plus')}<span>${n}</span></a>`).join('')}</div>`);
  const st = await statementOf(party, o);
  $('#out').innerHTML = statementHead(party, o, st) + statementTable(st, o) + `<p class="words">${esc(amountInWords(fromCents(Math.abs(st.closing))))}</p>`;
  const plain = (r) => { const el = document.createElement('div'); el.innerHTML = stDesc(r, false); return el.textContent.replace(/\s+/g, ' ').trim(); };
  // export in the same order as the paper: company, customer, required balance, the table, the total
  $('#xl').onclick = () => {
    const w = o.saved ? 6 : 5; const pad = (row) => [...row, ...Array(Math.max(0, w - row.length)).fill('')];
    const head = [pad([S.settings.companyName]), pad([`${party.code} — ${party.name}`]), pad([`${party.region ? regionName(party.region) + ' · ' : ''}${o.from || '…'} → ${o.to || today()} · ${T('NIS')}${o.saved ? ' · ' + T('Including saved') : ''}`]),
      pad([T('Required balance'), fromCents(st.closing)]), pad([])];
    const body = [['Date', 'Description', ...(o.saved ? ['Status'] : []), 'Debit', 'Credit', 'Balance'].map(T),
      ...(st.opening ? [['', T('Balance brought forward'), ...(o.saved ? [''] : []), '', '', fromCents(st.opening)]] : []),
      ...st.rows.map((r) => [r.date, plain(r), ...(o.saved ? [T(r.draft ? 'Saved (draft)' : 'Posted')] : []), r.debitC ? fromCents(r.debitC) : '', r.creditC ? fromCents(r.creditC) : '', fromCents(r.balanceC)]),
      [T('Total balance'), '', ...(o.saved ? [''] : []), fromCents(st.rows.reduce((a, r) => a + r.debitC, 0)), fromCents(st.rows.reduce((a, r) => a + r.creditC, 0)), fromCents(st.closing)],
      [], [amountInWords(fromCents(Math.abs(st.closing)))]];
    toExcel(`statement-${party.code}.xlsx`, [...head, ...body], { cols: [12, 58, ...(o.saved ? [10] : []), 14, 14, 14], sheet: T('Account statement').slice(0, 31),
      merges: [0, 1, 2].map((r) => ({ s: { r, c: 0 }, e: { r, c: w - 1 } })) });
  };
  $('#pr').onclick = () => printStatement(party, o, st);
};
// the party's statement before the document being entered, opened over the document
async function statementSheet(party, exceptId) {
  const st = await statementOf(party, { except: exceptId });
  const last = st.rows.slice(-12);
  const dlg = document.createElement('dialog'); dlg.className = 'lookup card-dlg stsheet';
  dlg.innerHTML = `<button class="dlg-x" data-x type="button" title="Close" aria-label="Close">${ic('x')}</button>
    <h2 style="margin-top:0" dir="auto">${esc(partyLabel(party))}</h2><p class="muted" style="margin:-6px 0 12px">Statement before this document</p>
    ${statementTable({ opening: st.rows.length > last.length ? st.rows[st.rows.length - last.length - 1].balanceC : st.opening, rows: last, closing: st.closing })}
    <div class="actions" style="margin-bottom:0"><a class="btn tonal" href="#/statement/${party.id}">Open full statement</a><button class="btn" data-x2>Close</button></div>`;
  document.body.appendChild(dlg); translate(dlg); dlg.showModal();
  const end = () => dlg.remove();
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); end(); });
  $('[data-x]', dlg).onclick = end; $('[data-x2]', dlg).onclick = end; $('a', dlg).addEventListener('click', end);
}

routes.tb = async () => {
  const tb = trialBalance(await ledger());
  $('#main').innerHTML = `<h1>Trial balance</h1><p class="sub">Built only from posted entries. ${tb.balanced ? '<span class="pill ok">Balanced</span>' : '<span class="pill bad">Not balanced</span>'}</p>
    <div class="tablewrap"><table class="t"><thead><tr><th>Account</th><th>Name</th><th class="n">Total debit</th><th class="n">Total credit</th><th class="n">Debit balance</th><th class="n">Credit balance</th></tr></thead><tbody>
    ${[...tb.rows].sort((x, y) => Number(acctCode(x.account)) - Number(acctCode(y.account))).map((r) => `<tr><td dir="ltr">${esc(acctCode(r.account))}</td><td>${esc(acctName(r.account))}</td><td class="n">${money(r.debitC)}</td><td class="n">${money(r.creditC)}</td><td class="n">${r.balDebitC ? money(r.balDebitC) : ''}</td><td class="n">${r.balCreditC ? money(r.balCreditC) : ''}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="4">Totals</td><td class="n">${money(tb.totalDebitC)}</td><td class="n">${money(tb.totalCreditC)}</td></tr></tfoot></table></div>
    <div class="actions"><button class="btn" id="pr">Print / PDF</button></div>`;
  $('#pr').onclick = () => printHtml(`<h2>Trial balance · ميزان المراجعة</h2><p>${today()}</p>` + $('.tablewrap').outerHTML);
};

routes.stock = async () => {
  const moves = await db.all('stock');
  const oh = stockOnHand(moves);
  const rows = S.items.map((i) => {
    const s = oh[i.id] || { qty: 0, in: 0, out: 0, bonusIn: 0, bonusOut: 0 };
    const avg = avgCostC(moves, i.id, 0);
    return { i, s, avg, value: Math.round(avg * s.qty) };
  });
  $('#main').innerHTML = `<h1>Inventory</h1><p class="sub">Quantities come only from posted documents.</p>
    <div class="tablewrap"><table class="t"><thead><tr><th>Code</th><th>Item</th><th class="n">In</th><th class="n">Bonus in</th><th class="n">Out</th><th class="n">Bonus out</th><th class="n">On hand</th><th class="n">Avg cost</th><th class="n">Value</th></tr></thead><tbody>
    ${rows.map(({ i, s, avg, value }) => `<tr><td>${esc(i.code)}</td><td dir="auto">${esc(i.name)}</td><td class="n">${fmt(s.in, 0)}</td><td class="n">${fmt(s.bonusIn, 0)}</td><td class="n">${fmt(s.out, 0)}</td><td class="n">${fmt(s.bonusOut, 0)}</td>
      <td class="n" style="${s.qty < 0 ? 'color:var(--bad)' : ''}"><b>${fmt(s.qty, 0)}</b></td><td class="n">${fmt(avg / 100, 3)}</td><td class="n">${money(value)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="8">Inventory value</td><td class="n">${money(rows.reduce((t, r) => t + r.value, 0))}</td></tr></tfoot></table></div>
    <div class="actions"><button class="btn" id="xl">Excel</button><button class="btn" id="pr">Print / PDF</button></div>`;
  $('#xl').onclick = () => toExcel('inventory.xlsx', [['Code', 'Item', 'In', 'Bonus in', 'Out', 'Bonus out', 'On hand', 'Avg cost', 'Value'], ...rows.map(({ i, s, avg, value }) => [i.code, i.name, s.in, s.bonusIn, s.out, s.bonusOut, s.qty, avg / 100, value / 100])]);
  $('#pr').onclick = () => printHtml(`<h2>Inventory · جرد البضاعة</h2><p>${today()}</p>` + $('.tablewrap').outerHTML);
};

routes.sales = async () => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const kind = q.get('kind') === 'purchases' ? 'purchases' : 'sales';
  const from = q.get('from') || today().slice(0, 8) + '01', to = q.get('to') || today(), by = q.get('by') || 'item';
  const [plus, minus] = kind === 'purchases' ? ['PI', 'PR'] : ['SI', 'SR'];
  const partyWord = kind === 'purchases' ? 'Supplier' : 'Customer';
  const docs = S.docs.filter((d) => d.status === 'posted' && (d.type === plus || d.type === minus) && d.date >= from && d.date <= to);
  const agg = {};
  for (const d of docs) {
    const sign = d.type === plus ? 1 : -1;
    const tot = computeTotals(d.lines, docTotalsOpts(d, { vatRate: 16, pricesIncludeVat: true, roundTotals: false }));
    const factor = tot.subtotalC ? tot.totalC / tot.subtotalC : 0;
    const p = partyById(d.partyId) || {};
    for (const l of tot.lines) {
      const it = lineItem(l);
      const key = by === 'item' ? it.code : by === 'region' ? regionLabel(p.region) || '—' : by === 'type' ? CUSTOMER_TYPES[p.type] || '—' : by === 'customer' ? p.code + ' — ' + p.name : d.date;
      const a = (agg[key] ||= { key, name: by === 'item' ? it.name : '', qty: 0, bonus: 0, amountC: 0, det: [] });
      const amt = sign * Math.round(l.amountC * factor);
      a.qty += sign * (Number(l.qty) || 0); a.bonus += sign * (Number(l.bonus) || 0); a.amountC += amt;
      a.det.push({ id: d.id, number: d.number, date: d.date, who: by === 'item' ? p.name || '' : `${it.code} ${it.name}`, qty: sign * (Number(l.qty) || 0), bonus: sign * (Number(l.bonus) || 0), price: Number(l.price) || 0, amt });
    }
  }
  const rows = Object.values(agg).sort((a, b) => b.amountC - a.amountC);
  const tsum = rows.reduce((s, r) => ({ q: s.q + r.qty, b: s.b + r.bonus, a: s.a + r.amountC }), { q: 0, b: 0, a: 0 });
  const byOpts = [['item', 'Item'], ['customer', partyWord], ...(kind === 'sales' ? [['region', 'Region'], ['type', 'Customer type']] : []), ['date', 'Date']];
  const cols = by === 'item' ? 6 : 5;
  const title = kind === 'purchases' ? 'Purchases report' : 'Sales report';
  $('#main').innerHTML = `<h1>${title}</h1><p class="sub">Posted invoices minus returns, VAT included. Tap a row for its details.</p>
    <div class="row"><label class="f">From<input id="from" type="date" value="${from}"></label><label class="f">To<input id="to" type="date" value="${to}"></label>
    <label class="f">Group by<select id="by">${byOpts.map(([k, v]) => `<option value="${k}" ${k === by ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <button class="btn primary" id="show">Show</button><button class="btn" id="xl">Excel</button><button class="btn" id="pr">Print / PDF</button></div>
    <div class="tablewrap" style="margin-top:20px"><table class="t" id="rep"><thead><tr><th>${Object.fromEntries(byOpts)[by]}</th>${by === 'item' ? '<th>Name</th>' : ''}<th class="n">Qty</th><th class="n">Bonus</th><th class="n">Total qty</th><th class="n">Total ₪</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="grp" data-i="${i}" style="cursor:pointer"><td dir="auto"><b>${esc(r.key)}</b></td>${by === 'item' ? `<td dir="auto">${esc(r.name)}</td>` : ''}<td class="n">${fmt(r.qty, 0)}</td><td class="n">${fmt(r.bonus, 0)}</td><td class="n">${fmt(r.qty + r.bonus, 0)}</td><td class="n">${money(r.amountC)}</td></tr>
      <tr class="det" data-d="${i}" hidden><td colspan="${cols}">${miniTable(['Number', 'Date', by === 'item' ? partyWord : 'Item', 'Qty', 'Bonus', 'Price', 'Amount'], r.det.map((x) => [`<a href="#/doc/${x.id}" dir="ltr">${esc(x.number)}</a>`, esc(x.date), `<span dir="auto">${esc(x.who)}</span>`, fmt(x.qty, 0), fmt(x.bonus, 0), fmt(x.price, 3), money(x.amt)]))}</td></tr>`).join('')}
    </tbody><tfoot><tr><td ${by === 'item' ? 'colspan="2"' : ''}>Totals</td><td class="n">${fmt(tsum.q, 0)}</td><td class="n">${fmt(tsum.b, 0)}</td><td class="n">${fmt(tsum.q + tsum.b, 0)}</td><td class="n">${money(tsum.a)}</td></tr></tfoot></table></div>`;
  $$('#rep tr.grp').forEach((tr) => (tr.onclick = () => { const d = $(`#rep tr.det[data-d="${tr.dataset.i}"]`); d.hidden = !d.hidden; }));
  $('#show').onclick = () => (location.hash = `#/sales?kind=${kind}&by=${$('#by').value}&from=${$('#from').value}&to=${$('#to').value}`);
  $('#xl').onclick = () => toExcel(`${kind}-${by}.xlsx`, [[by, 'Name', 'Qty', 'Bonus', 'Total qty', 'Total ILS'], ...rows.map((r) => [r.key, r.name, r.qty, r.bonus, r.qty + r.bonus, r.amountC / 100])]);
  $('#pr').onclick = () => { $$('#rep tr.det').forEach((d) => (d.hidden = false)); printHtml(`<h2>${title}</h2><p>${from} → ${to}</p>` + $('.tablewrap').outerHTML); };
};

routes.integrity = async () => {
  const entries = await ledger();
  const tb = trialBalance(entries);
  const gaps = sequenceGaps(S.docs.filter((d) => d.number));
  const oh = stockOnHand(await db.all('stock'));
  const negative = S.items.filter((i) => (oh[i.id]?.qty || 0) < 0);
  const backdated = S.docs.filter((d) => d.backdated && d.type !== 'OB');
  const oldDrafts = S.docs.filter((d) => d.status === 'draft' && d.date < new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10));
  const check = (ok, title, detail) => `<div class="card" style="margin-bottom:10px"><span class="pill ${ok ? 'ok' : 'bad'}">${ok ? 'OK' : 'Check'}</span> <b>${title}</b><div class="muted" style="margin-top:6px">${detail}</div></div>`;
  $('#main').innerHTML = `<h1>Integrity check</h1><p class="sub">Runs on every visit. The forensic audit questions, answered by the system itself.</p>
    ${check(tb.balanced, 'Trial balance is balanced', `Debit ${money(tb.totalDebitC)} · Credit ${money(tb.totalCreditC)}`)}
    ${check(!gaps.length, 'No gaps in any numbering series', gaps.length ? gaps.map((g) => `${g.series}: expected ${g.expected}, found ${g.found}`).join('<br>') : `${new Set(S.docs.filter((d) => d.series).map((d) => d.series)).size} series checked`)}
    ${negative.length ? `<div class="card" style="margin-bottom:10px"><span class="pill draft">Waiting</span> <b>Items below zero, waiting for a purchase invoice</b><div class="muted" style="margin-top:6px">${negative.map((i) => `<span dir="ltr">${esc(i.code)}</span> <span dir="auto">${esc(i.name)}</span>: <b dir="ltr">${fmt(oh[i.id].qty, 0)}</b>`).join('<br>')}</div><div class="muted" style="margin-top:6px">Allowed: a sale never stops at zero. The count comes back when the purchase invoice is entered.</div></div>` : check(true, 'No item below zero', 'All items at zero or above')}
    ${check(!backdated.length, 'No backdated documents', backdated.map((d) => `${esc(d.number)}: ${esc(d.backdateReason)}`).join('<br>') || 'None')}
    ${check(!oldDrafts.length, 'No drafts older than 3 days', oldDrafts.map((d) => `${DOC_TYPES[d.type].name} ${esc(d.date)}`).join('<br>') || 'None')}`;
};

routes.audit = async () => {
  const rows = (await db.all('audit')).reverse();
  $('#main').innerHTML = `<h1>Audit log</h1><p class="sub">Who did what, when. This log cannot be edited or deleted.</p>
    <div class="tablewrap"><table class="t"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Reference</th><th>Detail</th></tr></thead><tbody>
    ${rows.slice(0, 500).map((r) => `<tr><td>${esc(r.at.slice(0, 19).replace('T', ' '))}</td><td>${esc(r.user)}</td><td>${esc(r.action)}</td><td>${esc(r.ref)}</td><td dir="auto">${esc(typeof r.detail === 'object' ? JSON.stringify(r.detail) : r.detail)}</td></tr>`).join('')}</tbody></table></div>`;
};

// ---------- import ----------
const AI_PROMPT = `You convert business data into JSON for a pharmacy accounting app. Reply with JSON only, no prose.
Schema (include only the keys you need):
{
  "items": [{"code": "optional", "name": "required", "brand": "", "category": "", "unit": "PCS",
             "buyPrice": 0, "pricePublic": 0, "pricePharmacist": 0, "barcode": "", "openingQty": 0}],
  "customers": [{"code": "optional", "name": "required", "phone": "", "region": "gaza|middle|south",
                 "type": "pharmacy|warehouse|cosmetics|other", "creditLimit": 0, "openingBalance": 0}],
  "suppliers": [{"code": "optional", "name": "required", "phone": "", "openingBalance": 0}],
  "invoice": {"type": "SI|SR|PI|PR", "customerCode": "", "date": "YYYY-MM-DD", "reference": "",
              "lines": [{"itemCode": "", "itemName": "", "qty": 0, "bonus": 0, "price": null, "disc": 0,
                         "batch": "", "expiry": "YYYY-MM"}]}
}
Rules: numbers without currency signs or commas; prices include VAT; leave price null to use the default price;
bonus = free units; never invent items, customers or prices that are not in the source.
Source data:`;

routes.import = async () => {
  $('#main').innerHTML = `<h1>Import · Excel · AI</h1><p class="sub">Bring data in from Excel, CSV, or any AI assistant. Everything is checked before it is saved, and invoices arrive as drafts.</p>
    <h2>1 · From Excel or CSV</h2>
    <div class="row"><label class="f">What<select id="kind"><option value="items">Items</option><option value="customers">Customers</option><option value="suppliers">Suppliers</option></select></label>
      <label class="f grow">File<input id="file" type="file" accept=".xlsx,.xls,.csv,.json"></label><button class="btn" id="tpl">Download template</button></div>
    <div id="preview" style="margin-top:14px"></div>
    <h2>2 · From an AI assistant (Claude, ChatGPT, Gemini)</h2>
    <p class="muted">Copy this prompt, add your Excel sheet, photo or message under it, and paste the JSON answer below.</p>
    <textarea readonly id="prompt" style="min-height:160px;font-family:ui-monospace,monospace;font-size:.8em">${esc(AI_PROMPT)}</textarea>
    <div class="actions"><button class="btn" id="copy">Copy prompt</button></div>
    <textarea id="json" placeholder="Paste the JSON answer here" style="font-family:ui-monospace,monospace;font-size:.85em"></textarea>
    <div class="actions"><button class="btn primary" id="importJson">Check and import</button></div><div id="jsonOut"></div>`;
  $('#copy').onclick = () => { navigator.clipboard?.writeText(AI_PROMPT); toast('Prompt copied'); };
  $('#tpl').onclick = () => {
    const k = $('#kind').value;
    const head = { items: ['code', 'name', 'brand', 'category', 'unit', 'buyPrice', 'pricePublic', 'pricePharmacist', 'barcode', 'openingQty'], customers: ['code', 'name', 'phone', 'address', 'region', 'type', 'creditLimit', 'openingBalance'], suppliers: ['code', 'name', 'phone', 'address', 'openingBalance'] }[k];
    toExcel(`template-${k}.xlsx`, [head]);
  };
  $('#file').onchange = () => guard(async () => {
    const f = $('#file').files[0]; if (!f) return;
    // a prepared .json file (items + purchase invoice) goes through the same check as pasted JSON
    if (/\.json$/i.test(f.name)) { $('#json').value = await f.text(); $('#importJson').click(); $('#json').scrollIntoView({ block: 'start' }); return; }
    const wb = XLSX.read(await f.arrayBuffer());
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const kind = $('#kind').value;
    const data = { [kind]: rows.map((r) => mapRow(r, kind)).filter((r) => r.name) };
    showImportPreview(data, $('#preview'));
  });
  $('#importJson').onclick = () => guard(async () => {
    const obj = JSON.parse($('#json').value.trim().replace(/^```(json)?|```$/g, ''));
    showImportPreview(obj, $('#jsonOut'));
  });
};
const SYN = {
  code: ['code', 'item code', 'رقم الصنف', 'الكود', 'رقم', 'كود', 'رقم الزبون'], name: ['name', 'item', 'اسم الصنف', 'الاسم', 'اسم', 'البيان', 'الصنف', 'اسم الزبون'],
  brand: ['brand', 'company', 'الشركة', 'الماركة'], category: ['category', 'الفئة', 'الفئة/الاستخدام', 'المجموعة'], unit: ['unit', 'الوحدة'],
  buyPrice: ['buyprice', 'buy price', 'cost', 'سعر الشراء', 'الكلفة'], pricePublic: ['pricepublic', 'public price', 'سعر الجمهور', 'السعر جمهور', 'سعر البيع'],
  pricePharmacist: ['pricepharmacist', 'pharmacist price', 'سعر الصيدلي', 'السعر صيدلي'], barcode: ['barcode', 'باركود'], openingQty: ['openingqty', 'opening qty', 'qty', 'الكمية', 'رصيد'],
  phone: ['phone', 'mobile', 'هاتف', 'جوال', 'الهاتف'], address: ['address', 'العنوان'], region: ['region', 'المنطقة'], type: ['type', 'النوع'],
  creditLimit: ['creditlimit', 'credit limit', 'سقف'], openingBalance: ['openingbalance', 'opening balance', 'balance', 'الرصيد', 'رصيد افتتاحي'],
};
function mapRow(r, kind) {
  const out = {};
  const keys = Object.keys(r);
  for (const [field, names] of Object.entries(SYN)) {
    const k = keys.find((x) => names.includes(String(x).trim().toLowerCase()));
    if (k !== undefined && r[k] !== '') out[field] = typeof r[k] === 'string' ? r[k].trim() : r[k];
  }
  if (kind !== 'items') { delete out.openingQty; delete out.brand; delete out.category; delete out.unit; }
  if (out.region) { const v = String(out.region).toLowerCase(); out.region = /mid|وسط/.test(v) ? 'middle' : /south|جنوب/.test(v) ? 'south' : 'gaza'; }
  return out;
}
function showImportPreview(obj, el) {
  const v = validateImport(obj);
  if (!v.ok) { el.innerHTML = `<div class="note bad">${v.errors.map(esc).join('<br>')}</div>`; return; }
  const parts = [];
  for (const k of ['items', 'customers', 'suppliers']) if (obj[k]?.length) {
    const kind = k === 'items' ? null : k.slice(0, -1);
    const dupes = obj[k].filter((r) => (k === 'items' ? S.items : S.parties.filter((p) => p.kind === kind)).some((x) => (r.code && x.code === String(r.code)) || x.name === r.name));
    parts.push(`<p><b>${obj[k].length}</b> ${k}${dupes.length ? ` · <span style="color:var(--warn)">${dupes.length} already exist and will be skipped</span>` : ''}</p>`);
  }
  if (obj.invoice) parts.push(`<p><b>1</b> ${DOC_TYPES[obj.invoice.type || 'SI'].name} draft with ${obj.invoice.lines.length} lines</p>`);
  el.innerHTML = `<div class="card">${parts.join('')}<div class="actions"><button class="btn primary" id="doImport" ${isAdmin() || (obj.invoice && !obj.items && !obj.customers && !obj.suppliers) ? '' : 'disabled'}>Import now</button>
    ${isAdmin() ? '' : '<span class="muted">Items, customers and suppliers are imported by the admin.</span>'}</div></div>`;
  $('#doImport', el).onclick = () => guard(async () => { const r = await runImport(obj); toast(r.msg); if (r.go) go(r.go); else render(); });
}
async function runImport(obj) {
  let n = 0; const osLines = [];
  for (const it of obj.items || []) {
    if (S.items.some((x) => (it.code && x.code === String(it.code)) || x.name === it.name)) continue;
    const code = String(it.code || nextNumericCode(S.items.map((i) => i.code)));
    const rec = await db.saveMaster('items', { code, name: it.name, brand: it.brand || '', category: it.category || '', unit: it.unit || 'PCS', barcode: String(it.barcode || ''),
      buyPrice: Number(it.buyPrice) || '', pricePublic: Number(it.pricePublic) || '', pricePharmacist: Number(it.pricePharmacist) || '', active: true }, S.user);
    S.items.push(rec); n++;
    if (Number(it.openingQty) > 0) osLines.push({ itemId: rec.id, qty: Number(it.openingQty), price: Number(it.buyPrice) || 0 });
  }
  if (osLines.length) {
    const d = await db.saveDraft({ type: 'OS', date: today(), lines: osLines, notes: 'Opening stock from import' }, S.user);
    await db.post(d.id, S.user, S.settings, { allowBackdate: true, backdateReason: 'opening stock' });
  }
  for (const k of ['customers', 'suppliers']) for (const c of obj[k] || []) {
    const kind = k.slice(0, -1);
    if (S.parties.some((x) => x.kind === kind && ((c.code && x.code === String(c.code)) || x.name === c.name))) continue;
    const code = String(c.code || nextNumericCode(S.parties.filter((x) => x.kind === kind).map((x) => x.code)));
    const rec = await db.saveMaster('parties', { kind, code, name: c.name, phone: String(c.phone || ''), address: c.address || '', region: c.region || (kind === 'customer' ? 'gaza' : ''), type: c.type || (kind === 'customer' ? 'pharmacy' : ''), creditLimit: Number(c.creditLimit) || '' }, S.user);
    S.parties.push(rec); n++;
    if (Number(c.openingBalance)) await postOpening(rec, Number(c.openingBalance));
  }
  if (obj.invoice) {
    const inv = obj.invoice;
    // look for the party among the right kind only: suppliers for purchases, customers for sales
    const kind = ['PI', 'PR'].includes(inv.type) ? 'supplier' : 'customer';
    const pool = S.parties.filter((x) => x.kind === kind);
    const code = String((kind === 'supplier' ? inv.supplierCode : inv.customerCode) || '');
    const p = (code && pool.find((x) => x.code === code)) || pool.find((x) => x.name === (kind === 'supplier' ? inv.supplierName : inv.customerName));
    const lines = parseSmart(JSON.stringify({ invoice: inv }));
    const d = await db.saveDraft({ type: inv.type || 'SI', date: inv.date || today(), partyId: p?.id || '', reference: inv.reference || '', notes: 'Imported from AI', lines: lines.filter((l) => l.itemId), invoiceDiscount: 0 }, S.user);
    const missing = lines.filter((l) => !l.itemId).length;
    return { msg: `Draft created${missing ? ` · ${missing} unknown items skipped` : ''}${p ? '' : kind === 'supplier' ? ' · choose the supplier' : ' · choose the customer'}`, go: '#/doc/' + d.id };
  }
  return { msg: `${n} records imported${osLines.length ? ' · opening stock posted' : ''}` };
}

// ---------- backup ----------
routes.backup = async () => {
  const last = localStorage.getItem('lastBackup');
  $('#main').innerHTML = `<h1>Backup</h1><p class="sub">Your books live in this browser and in every backup file you keep. Keep one copy in your own Google Drive or Dropbox.</p>
    ${!last || Date.now() - Number(last) > 864e5 ? '<div class="note warn">No backup in the last 24 hours.</div>' : `<div class="note">Last backup: ${new Date(Number(last)).toLocaleString('en-GB')}</div>`}
    <div class="actions"><button class="btn primary" id="json">Download full backup (.json)</button><button class="btn" id="xlsx">Download everything as Excel</button></div>
    <h2>Restore</h2><p class="muted">Restore works only into an empty app (new device or new browser), so it can never overwrite existing books. The file checksum is verified first.</p>
    <input type="file" id="restore" accept=".json" ${isAdmin() ? '' : 'disabled'}>`;
  $('#json').onclick = () => guard(async () => {
    const data = await db.exportAll();
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `ledger-backup-${today()}.json`);
    localStorage.setItem('lastBackup', String(Date.now())); render();
  });
  $('#xlsx').onclick = () => guard(async () => {
    const wb = XLSX.utils.book_new();
    const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), name);
    add('Items', S.items); add('Parties', S.parties);
    add('Documents', S.docs.map(({ lines, settingsAtPost, ...d }) => ({ ...d, total: fromCents(d.totalC || 0) })));
    add('Lines', S.docs.flatMap((d) => (d.lines || []).map((l) => ({ number: d.number || 'DRAFT', type: d.type, status: d.status, code: itemById(l.itemId)?.code, ...l }))));
    add('Ledger', (await ledger()).map((e) => ({ ...e, debit: e.debitC / 100, credit: e.creditC / 100 })));
    add('Stock', await db.all('stock')); add('Audit', await db.all('audit'));
    XLSX.writeFile(wb, `ledger-${today()}.xlsx`);
  });
  $('#restore').onchange = () => guard(async () => {
    const f = $('#restore').files[0]; if (!f) return;
    await db.restoreAll(JSON.parse(await f.text())); toast('Restored'); go('#/dashboard');
  });
};

// ---------- settings ----------
routes.settings = async () => {
  const s = S.settings;
  const f = (k, label, type = 'text') => `<label class="f">${label}<input name="${k}" type="${type}" dir="auto" value="${esc(s[k] ?? '')}" ${isAdmin() ? '' : 'readonly'}></label>`;
  $('#main').innerHTML = `<h1>Settings</h1>
    <h2>You</h2><div class="row"><label class="f">Your name<input id="uname" value="${esc(S.user)}"></label>
      <label class="f">Text size<select id="size">${[['normal', 'Normal'], ['large', 'Large'], ['xlarge', 'Extra large']].map(([k, v]) => `<option value="${k}" ${s.fontScale === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f" id="sec-lang">Language<select id="lang"><option value="en">English</option><option value="ar" ${getLang() === 'ar' ? 'selected' : ''}>العربية</option></select></label>
      <button class="btn" id="saveMe">Save</button></div>
    <h2>Role</h2><p class="muted">Admin adds items, customers and suppliers, voids documents, imports and restores. Accountant enters and posts documents.</p>
    <div class="actions">${isAdmin() ? '<button class="btn" id="toAcc">Switch to accountant</button>' : '<button class="btn primary" id="toAdmin">Switch to admin</button>'}</div>
    <h2>Company</h2><form id="co" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
      ${f('companyName', 'Company name')}${f('companyNameAr', 'Company name (Arabic)')}${f('city', 'City')}${f('monogram', 'Monogram (2–3 letters)')}
      <label class="f" style="grid-column:1/-1">Letterhead contacts · one per line: department | person | phone<textarea name="contacts" dir="auto" rows="3" ${isAdmin() ? '' : 'readonly'}>${esc(s.contacts || '')}</textarea></label>
      <div class="lhprev" id="lhPrev" style="grid-column:1/-1"></div>
      ${f('taxNo', 'Licensed dealer no.')}${f('address', 'Address')}${f('phone', 'Phone')}${f('branch', 'Branch / vehicle code (series prefix)')}
      ${f('vatRate', 'VAT %', 'number')}${f('copiesInvoice', 'Print copies · Invoices', 'number')}${f('copiesVoucher', 'Print copies · Vouchers', 'number')}<label class="f">Prices include VAT<select name="pricesIncludeVat" ${isAdmin() ? '' : 'disabled'}><option value="true">Yes</option><option value="false" ${s.pricesIncludeVat ? '' : 'selected'}>No</option></select></label></form>
    ${isAdmin() ? `<div class="actions"><button class="btn primary" id="saveCo">Save company</button></div><h2 id="sec-pin">Password · admin PIN</h2><div class="row"><label class="f">New PIN<input id="pin" type="password" inputmode="numeric"></label><button class="btn" id="savePin">Set PIN</button></div>` : ''}
    <h2 id="sec-cur">Currency</h2><div class="row"><label class="f grow">Currency<input value="${esc(T('Israeli new shekel (₪, NIS)'))}" readonly></label></div>
    <p class="muted">One currency in this version: every amount, statement and report is in shekels.</p>
    ${isAdmin() ? '' : '<h2 id="sec-pin">Password</h2><p class="muted">Switch to admin to set or change the admin PIN.</p>'}
    <div class="note" style="margin-top:24px">This is version 0.1. Data is stored in this browser on this device. Cloud sync, real user accounts and permissions enforced by the server come in stage 3.</div>`;
  const prev = () => { const fd = Object.fromEntries(new FormData($('#co'))); const keep = S.settings; S.settings = { ...keep, ...fd }; $('#lhPrev').innerHTML = `<div class="doc-print" dir="${getLang() === 'ar' ? 'rtl' : 'ltr'}">${letterhead()}</div>`; S.settings = keep; };
  $('#co').addEventListener('input', prev); prev();
  const fq = new URLSearchParams(location.hash.split('?')[1] || '').get('f');
  if (fq) setTimeout(() => { const el = $('#sec-' + fq); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); (el.querySelector('select,input') || el.nextElementSibling?.querySelector?.('input'))?.focus(); } }, 60);
  $('#saveMe').onclick = () => guard(async () => {
    S.user = $('#uname').value.trim() || 'User'; sessionStorage.setItem('user', S.user); await db.setSetting('fontScale', $('#size').value, S.user);
    if ($('#lang').value !== getLang()) { setLang($('#lang').value); location.reload(); return; }
    toast('Saved'); render();
  });
  $('#toAcc') && ($('#toAcc').onclick = () => { S.role = 'accountant'; sessionStorage.setItem('role', 'accountant'); render(); });
  $('#toAdmin') && ($('#toAdmin').onclick = () => guard(async () => {
    if (S.settings.adminPin) { const pin = prompt('Admin PIN'); if (pin !== S.settings.adminPin) throw new Error('Wrong PIN'); }
    S.role = 'admin'; sessionStorage.setItem('role', 'admin'); toast(S.settings.adminPin ? 'Admin' : 'Admin. Set a PIN now.'); render();
  }));
  $('#saveCo') && ($('#saveCo').onclick = () => guard(async () => {
    const fd = Object.fromEntries(new FormData($('#co')));
    fd.vatRate = Number(fd.vatRate); fd.pricesIncludeVat = fd.pricesIncludeVat === 'true';
    fd.copiesInvoice = Math.max(1, Number(fd.copiesInvoice) || 2); fd.copiesVoucher = Math.max(1, Number(fd.copiesVoucher) || 2);
    for (const [k, v] of Object.entries(fd)) await db.setSetting(k, v, S.user);
    toast('Saved'); render();
  }));
  $('#savePin') && ($('#savePin').onclick = () => guard(async () => { const p = $('#pin').value.trim(); if (p.length < 4) throw new Error('At least 4 digits'); await db.setSetting('adminPin', p, S.user); toast('PIN set'); }));
};

// ---------- utils ----------
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function toExcel(name, aoa, { cols, merges, sheet = 'Sheet1' } = {}) {
  const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (cols) ws['!cols'] = cols.map((w) => ({ wch: w }));
  if (merges) ws['!merges'] = merges;
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  if (getLang() === 'ar') wb.Workbook = { Views: [{ RTL: true }] };   // the sheet opens right to left
  XLSX.writeFile(wb, name);
}
// Letterhead (Rabee, Nov 2026): name and city on one line, then one line per contact: department · person · phone.
// Contacts are typed in Settings, one per line: "Management | 05xxxxxxxx" or "Sales | Dr. Name | 05xxxxxxxx".
function contactLines(txt) {
  // hidden direction marks come along when numbers are copied from a phone: drop them
  return String(txt || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    let parts = l.split('|').map((x) => x.trim()).filter(Boolean);
    if (parts.length === 1) { const m = l.match(/^(.*?)[\s:·-]*((?:\+|00)?[\d][\d\s-]{6,})$/); parts = m ? [m[1].trim(), m[2].trim()].filter(Boolean) : [l]; }
    const tel = /^(?:\+|00)?[\d][\d\s-]{6,}$/.test(parts[parts.length - 1]) ? parts.pop() : '';
    return { label: parts.shift() || '', who: parts.join(' · '), tel };
  });
}
function letterhead() {
  const s = S.settings; const A = getLang() === 'ar';
  const name = A && s.companyNameAr ? s.companyNameAr : s.companyName;
  const mono = (s.monogram || (s.companyName || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('')).toUpperCase().slice(0, 3);
  const cl = contactLines(s.contacts);
  const old = !cl.length && (s.address || s.phone) ? `<div class="cosub">${[s.address, s.phone].filter(Boolean).map(esc).join(' — ')}</div>` : '';
  return `<div class="ph lh"><div class="lhm">
      <div class="co" dir="auto">${esc(name)}${s.city ? `<span class="lcity"> - ${esc(s.city)}</span>` : ''}</div>
      ${cl.length ? `<div class="lhc">${cl.map((c) => `<div class="lct"><b dir="auto">${esc(c.label)}</b>${c.who ? `<span dir="auto">${esc(c.who)}</span>` : ''}${c.tel ? `<span class="tel" dir="ltr">${esc(c.tel)}</span>` : ''}</div>`).join('')}</div>` : old}
      ${s.taxNo ? `<div class="cosub">${esc(T('Licensed dealer no.'))}: <span dir="ltr">${esc(s.taxNo)}</span></div>` : ''}</div>
    ${mono ? `<div class="mono"><span>${esc(mono)}</span></div>` : ''}</div>`;
}
function printStatement(party, o, st) {
  const s = S.settings; const A = getLang() === 'ar';
  $('#printArea').innerHTML = `<div class="doc-print page stprint" dir="${A ? 'rtl' : 'ltr'}">
    ${letterhead()}
    <div class="tb"><div class="tbh"><div><div class="t1">${esc(T('Account statement'))}</div></div></div>${statementHead(party, o, st)}</div>
    ${statementTable(st, { ...o, print: true })}
    <div class="wbox"><div class="wl">${esc(T('Amount in words'))}</div><div class="words" dir="rtl">${esc(amountInWords(fromCents(Math.abs(st.closing))))}</div></div>
    <div class="sign"><span>${esc(T('Signature'))}</span><span>${esc(T('Received by'))}</span></div>
    <div class="meta"><span>${esc(T('Printed by'))} <span dir="auto">${esc(S.user)}</span> · <span dir="ltr">${new Date().toLocaleString('en-GB')}</span></span><span></span></div></div>`;
  document.body.classList.add('printing'); setTimeout(() => { window.print(); document.body.classList.remove('printing'); }, 50);
}
function printHtml(html) {
  $('#printArea').innerHTML = `<div class="doc-print" dir="${getLang() === 'ar' ? 'rtl' : 'ltr'}">${letterhead()}${html}<div class="meta"><span dir="ltr">${new Date().toLocaleString('en-GB')}</span><span></span></div></div>`;
  document.body.classList.add('printing'); setTimeout(() => { window.print(); document.body.classList.remove('printing'); }, 50);
}

// ---------- boot ----------
(async () => {
  applyLang();
  $$('[data-ic]').forEach((el) => (el.innerHTML = ic(el.dataset.ic)));
  const vv = window.visualViewport;
  if (vv) { const kb = () => document.documentElement.style.setProperty('--kb', Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px'); vv.addEventListener('resize', kb); vv.addEventListener('scroll', kb); kb(); }
  const lb = $('#langBtn');
  lb.textContent = getLang() === 'ar' ? 'English' : 'العربية';
  lb.onclick = () => { setLang(getLang() === 'ar' ? 'en' : 'ar'); location.reload(); };
  $('#langBtnM').textContent = lb.textContent; $('#langBtnM').onclick = lb.onclick;
  $('#menuBtn').onclick = () => document.body.classList.toggle('menu-open');
  $('#app').addEventListener('click', (e) => { if (document.body.classList.contains('menu-open') && !e.target.closest('#nav')) document.body.classList.remove('menu-open'); });
  await db.open();
  if (!location.hash) location.hash = '#/dashboard';
  await render();
})();
