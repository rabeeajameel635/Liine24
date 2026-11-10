import * as db from './db.js';
import {
  DOC_TYPES, REGIONS, CUSTOMER_TYPES, PAY_METHODS, ACCOUNTS, CASH_ACCOUNTS,
  computeTotals, fmt, fromCents, toCents, amountInWords, trialBalance, statement, stockOnHand,
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
const GROUPS = { inv: ['SI', 'SR', 'PI', 'PR', 'CN', 'DN'], vch: ['RV', 'PV'] };
// The open editor registers itself here so leaving it can be guarded.
let guardEditor = null, currentHash = location.hash, bypass = false;
// Bisan keys: F2 lookup · F4 save · F9 print (posts, so it asks) · Esc exit back to where you were
let pageKeys = null, lastPlace = '#/dashboard';
const isDocRoute = (h) => /^#\/(new|doc)\//.test(h || '');
document.addEventListener('keydown', (e) => { if (pageKeys && !e.defaultPrevented) pageKeys(e); });
const backToPlace = () => go(lastPlace || '#/dashboard');
async function render() {
  guardEditor = null; pageKeys = null; document.body.classList.remove('editing', 'sheet-open');
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
    : (name === 'docs' || name === 'new') ? (GROUPS.vch.includes(qType) ? 'vch' : 'inv')
    : ['reports', 'statement', 'sales', 'stock', 'tb'].includes(name) ? 'rep'
    : ['dirs', 'customers', 'suppliers', 'items', 'accounts'].includes(name) ? 'dir' : '';
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
    <div class="hero">
      <a class="bigcard" href="#/new/SI"><span class="bico">${ic('plus')}</span><b>New sales invoice</b></a>
      <a class="bigcard alt" href="#/new/RV"><span class="bico">${ic('in')}</span><b>Receipt voucher</b></a>
    </div>
    <div class="tiles">
      ${tile('#/new/SR', 'undo', 'Sales return')}${tile('#/new/PI', 'cart', 'Purchase invoice')}${tile('#/new/PV', 'out', 'Payment voucher')}${tile('#/statement', 'list', 'Account statement')}
      ${tile('#/items', 'box', 'Items')}${tile('#/customers', 'users', 'Customers')}${tile('#/reports', 'bars', 'Reports')}${tile('#/import', 'spark', 'AI import')}
    </div>
    <div class="listhead"><h2>Recent documents</h2><a class="btn small" href="#/docs?type=SI">All</a></div>
    ${docTable(recent)}
    ${S.items.length ? '' : `<div class="note" style="margin-top:20px">Start here: add items and customers in <a href="#/items">Items</a> and <a href="#/customers">Customers</a>, or import them from Excel in <a href="#/import">Import</a>.</div>`}`;
};

// one hub screen for a group of links (Reports, Directories)
function hub(title, rows) {
  $('#main').innerHTML = `<h1>${title}</h1><div class="hublist">${rows.map(([href, icon, label]) => href
    ? `<a class="hrow" href="${href}"><span class="tico">${ic(icon)}</span><span class="grow">${label}</span>${ic('chev')}</a>`
    : `<span class="hrow off"><span class="tico">${ic(icon)}</span><span class="grow">${label}</span><em>Soon</em></span>`).join('')}</div>`;
}
routes.reports = async () => hub('Reports', [
  ['#/statement', 'list', 'Account statement'], ['#/sales?kind=sales&by=item', 'bars', 'Sales by item'], ['#/sales?kind=sales&by=customer', 'users', 'Sales by customer'],
  ['#/sales?kind=purchases&by=item', 'cart', 'Purchases by item'], ['#/sales?kind=purchases&by=customer', 'truck', 'Purchases by supplier'],
  ['#/stock', 'box', 'Inventory'], ['#/tb', 'layers', 'Trial balance']]);
routes.dirs = async () => hub('Directories', [
  ['#/customers', 'users', 'Customers'], ['#/suppliers', 'truck', 'Suppliers'], ['#/items', 'box', 'Items'], ['#/accounts', 'book', 'Chart of accounts'],
  ['', 'users', 'Employees'], ['', 'pin', 'Regions']]);
routes.accounts = async () => {
  const tb = trialBalance(await ledger());
  const bal = Object.fromEntries(tb.rows.map((r) => [r.account, r.balDebitC - r.balCreditC]));
  $('#main').innerHTML = `<h1>Chart of accounts</h1><p class="sub">Fixed chart in this version. Balances come from posted entries only.</p>
    <div class="tablewrap"><table class="t"><thead><tr><th>Code</th><th>Name</th><th>Type</th><th class="n">Balance</th></tr></thead><tbody>
    ${Object.entries(ACCOUNTS).map(([k, a]) => `<tr><td><b>${k}</b></td><td>${a.name}</td><td>${a.type}</td><td class="n">${money(bal[k] || 0)}</td></tr>`).join('')}</tbody></table></div>`;
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
  return computeTotals(d.lines || [], { vatRate: S.settings.vatRate, pricesIncludeVat: S.settings.pricesIncludeVat, invoiceDiscount: d.invoiceDiscount }).totalC;
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
  ['voided', 'Voided', 'ban', (d) => d.status === 'voided'],
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
  const group = GROUPS.vch.includes(type) ? GROUPS.vch : type ? GROUPS.inv : [...GROUPS.inv, ...GROUPS.vch];
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
  const parties = S.parties.filter((p) => (t.party === 'any' || p.kind === partyKind) && (p.active !== false || !t.lines));
  const itemsList = S.items.filter((i) => i.active !== false);
  $('#main').innerHTML = `
    <div class="docbar"><button class="iconbtn monly" id="eBack" tabindex="-1" title="Exit">${ic('chev')}</button>
      <div><div class="dtitle"><span>${t.name}</span> <span class="pill draft">${doc.id ? 'Saved' : 'New'}</span></div>
      <div class="dparty" id="barParty" dir="auto">—</div><div class="dbal" id="barBal"></div></div>
      <div class="dtotal"><span class="muted">Total ₪</span><b id="barTotal">0.00</b></div>
      <button class="btn small" id="toNotes" tabindex="-1" title="Notes">${ic('journal')}<span>Notes</span></button></div>
    <p class="sub">Drafts can be edited freely. Posting gives the permanent number and locks the document.</p>
    <datalist id="dlNames">${itemsList.map((i) => `<option value="${esc(i.name)}" label="${esc(i.code)}">`).join('')}</datalist>
    <datalist id="dlParties">${parties.map((p) => `<option value="${esc(partyLabel(p))}">`).join('')}</datalist>
    <div class="row">
      ${t.party !== 'none' ? `<label class="f grow">${partyKind === 'supplier' ? 'Supplier' : 'Customer'}<div class="namewrap"><input id="party" data-flow list="dlParties" dir="auto" placeholder="Code, name, or Enter / F2 for the list" value="${esc(partyLabel(partyById(doc.partyId)))}"><button type="button" class="lkbtn" data-lk="party" tabindex="-1" title="Lookup (F2)">⌕</button></div></label>` : ''}
      <label class="f">Date<input id="date" data-flow type="date" value="${esc(doc.date)}"></label>
      <label class="f"><span>Reference no.</span> <span class="opt">(optional)</span><input id="ref" data-flow value="${esc(doc.reference || '')}"></label>
      ${doc.type === 'SI' ? `<label class="f">Salesman<input id="salesman" data-flow value="${esc(doc.salesman || '')}"></label>` : ''}
    </div>
    <div id="partyInfo" class="muted" style="margin:12px 0 0"></div>
    ${t.lines ? linesUI(doc) : voucherUI(doc)}
    <label class="f" style="margin-top:20px">Notes<textarea id="notes" dir="auto" rows="3" style="min-height:96px">${esc(doc.notes || '')}</textarea></label>
    <div class="dock">
    ${t.lines ? `<div class="composer" id="composer">
      <div class="cname" id="cName" hidden><b dir="auto"></b><button type="button" class="cx" id="cClear" tabindex="-1">×</button></div>
      <div class="cmain">
        <input id="cItem" dir="auto" placeholder="Code or item name" enterkeyhint="next" autocomplete="off">
        <span class="cnums" id="cNums" hidden><label>Price<input id="cPrice" inputmode="decimal" enterkeyhint="next"></label><label>Qty<input id="cQty" inputmode="decimal" enterkeyhint="next"></label><label>B.<input id="cBonus" inputmode="decimal" enterkeyhint="done"></label></span>
      </div>
      <div class="crow">
        <button type="button" class="cbtn" id="cLook" tabindex="-1" title="Lookup (F2)">${ic('search')}</button>
        <span class="coh muted" id="cOh"></span>
        <button type="button" class="cbtn send" id="cAdd" tabindex="-1" title="Add line">${ic('up')}</button>
      </div></div>` : '<div class="composer" id="composer"></div>'}
    <div class="finish" id="finish" tabindex="0">
      <span class="grow hint"><kbd>F2</kbd> <kbd>@</kbd> <span>Lookup</span> · <kbd>F4</kbd> <kbd>#</kbd> <span>Save</span> · <kbd>F9</kbd> <kbd>€</kbd> <span>Print &amp; post</span> · <kbd>Esc</kbd> <span>Exit</span></span>
      <span class="symkeys"><kbd>@</kbd> <span>Lookup</span> · <kbd>#</kbd> <span>Save</span> · <kbd>€</kbd> <span>Print &amp; post</span></span>
      <button class="btn" id="save">Save draft <kbd>F4</kbd></button>
      <button class="btn ink" id="postprint">Print &amp; post <kbd>F9</kbd></button>
      <button class="btn" id="post">Post</button>
      <button class="btn" id="printdraft">Print draft</button>
      ${t.lines ? '<button class="btn" id="smart">Smart entry (AI / paste)</button>' : ''}
    </div></div>`;
  document.body.classList.add('editing');
  const phone = window.matchMedia('(max-width: 860px)').matches;
  const firstEntry = () => $('#lines tbody tr:not(.found) [data-k=code]') || $('#amount');
  const openSheet = () => document.body.classList.add('sheet-open');
  const closeSheet = () => document.body.classList.remove('sheet-open');
  if (phone) {
    const sh = document.createElement('div'); sh.className = 'psheet'; sh.id = 'psheet';
    sh.append($('#main > .row'), $('#partyInfo'));
    if (t.lines) sh.append($('#invdisc').closest('.row')); else $('#composer').append($('#amount').closest('.row'), $('#amtWords'));
    sh.append($('#notes').closest('label'));
    sh.insertAdjacentHTML('beforeend', '<button type="button" class="grab" id="grab" tabindex="-1" aria-label="Close"></button>');
    const bk = document.createElement('div'); bk.className = 'pback'; bk.onclick = closeSheet;
    $('#main').append(bk, sh);
    $('#grab', sh).onclick = closeSheet;
    // pull the top bar down to open, push the sheet up to close
    const drag = (el, fn) => { let y0 = null; el.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true }); el.addEventListener('touchmove', (e) => { if (y0 !== null) { const dy = e.touches[0].clientY - y0; if (Math.abs(dy) > 28) { fn(dy); y0 = null; } } }, { passive: true }); };
    drag($('.docbar'), (dy) => dy > 0 && openSheet());
    drag(sh, (dy) => dy < 0 && sh.scrollTop <= 0 && closeSheet());
    $('.docbar > div:nth-of-type(1)').onclick = openSheet;
    document.documentElement.style.setProperty('--bar', $('.docbar').offsetHeight + 'px');
  }

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
        return { itemId: it?.id || '', itemText: g('code') || g('name'), qty: num(g('qty')), bonus: num(g('bonus')), price: num(g('price')), disc: num(g('disc')), batch: g('batch'), expiry: g('expiry') };
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
  const leave = async () => {
    const v = await leaveDialog(!!doc.id);
    if (v === 'stay') return false;
    if (v === 'save') { const r = await guard(() => save(false)); if (!r) return false; toast('Draft saved'); return true; }
    if (v === 'post') { await postAndPrintNow(); return false; }
    if (v === 'discard') { if (doc.id) await guard(() => db.cancelDraft(doc.id, S.user)); toast(doc.id ? 'Draft cancelled' : 'Discarded'); return true; }
    return false;
  };
  guardEditor = { isDirty, leave };
  const back = () => { if (isDirty()) leave().then((ok) => ok && backToPlace()); else backToPlace(); };
  $('#postprint').onclick = printAndPost;
  $('#printdraft').onclick = () => guard(async () => { const r = await save(false); await printDoc(r); });

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
    if (next) next.focus();
    else if (t.lines) ($('#cItem').offsetParent ? $('#cItem') : $('#lines tbody tr [data-k=code]')).focus();
    else $('#amount').focus();
  }));

  let balBase = null;
  const BAL_SIGN = { SI: 1, DN: 1, PI: 1, SR: -1, CN: -1, PR: -1, RV: -1, PV: -1 };
  const showBal = () => {
    const el = $('#barBal'); if (!el) return;
    if (balBase === null) { el.textContent = ''; return; }
    const tot = Number($('#barTotal').dataset.c || 0), sg = BAL_SIGN[doc.type];
    el.innerHTML = `<span>Balance</span> <b>${money(balBase)}</b>${sg && tot ? ` · <span>After</span> <b>${money(balBase + sg * tot)}</b>` : ''}`;
    translate(el);
  };
  $('#barTotal').addEventListener('total', showBal);
  if ($('#party')) {
    const info = async () => {
      const p = findParty($('#party').value);
      $('#barParty').textContent = p ? partyLabel(p) : '—';
      balBase = null; showBal();
      if (!p) { $('#partyInfo').textContent = ''; return; }
      const bal = await partyBalanceC(p.id);
      balBase = bal; showBal();
      if (phone && document.activeElement === $('#party')) { closeSheet(); firstEntry()?.focus(); }
      $('#partyInfo').innerHTML = `Balance <b>${money(bal)}</b>${p.creditLimit ? ` · Credit limit ${fmt(p.creditLimit)} · Remaining <b>${money(toCents(p.creditLimit) - bal)}</b>` : ''}${p.region ? ` · <span>${esc(T(REGIONS[p.region]))}</span>` : ''}`;
      translate($('#partyInfo'));
    };
    $('#party').addEventListener('change', info); info();
  }
  if (t.lines) wireLines(doc, arm, parties);
  else {
    const m = () => { const c = $('#method').value === 'cheque'; $$('.cheque').forEach((x) => (x.style.display = c ? '' : 'none')); if (c && $('#cashAccount').value === '1100') $('#cashAccount').value = '1120'; };
    $('#method').onchange = m; m();
    const w = () => { const a = num($('#amount').value); $('#amtWords').textContent = a > 0 ? amountInWords(a) : ''; $('#barTotal').textContent = fmt(a || 0); $('#barTotal').dataset.c = toCents(a || 0); $('#barTotal').dispatchEvent(new Event('total')); };
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
    if (k === 'F2' && (e.target.id === 'party' || e.target.id === 'cItem' || e.target.dataset.k === 'code' || e.target.dataset.k === 'name')) e.target.dispatchEvent(ev);
    else pageKeys && pageKeys(ev);
  };
  // touch: the ⌕ buttons do what F2 does
  $('#main').onclick = (e) => {
    const b = e.target.closest('.lkbtn'); if (!b) return;
    const el = b.dataset.lk === 'party' ? $('#party') : $('[data-k=name]', b.closest('tr'));
    el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
  };
  $('#toNotes').onclick = () => { if (phone) return document.body.classList.toggle('sheet-open'); $('#notes').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#notes').focus(); };
  $('#eBack').onclick = back;
  setTimeout(() => {
    if (!phone) return ($('#party') || $('#date')).focus();
    if ($('#party') && !findParty($('#party').value)) { openSheet(); $('#party').focus(); }
    else if (!doc.id) firstEntry()?.focus();
  }, 50);
}
// Lookup list like Bisan's F2: type to filter, ↑ ↓ to move, Enter to pick, Esc to close.
// rows: [{ id, code, name, extra: [...] }] ; resolves the picked id or null
function lookup({ title, headers, rows, filter = '' }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'lookup';
    dlg.innerHTML = `<h2 style="margin-top:0">${esc(title)}</h2>
      <input class="lk-q" placeholder="Search by code or name" dir="auto" value="${esc(filter)}">
      <div class="lk-list"><table class="t"><thead><tr><th>Code</th><th>Name</th>${headers.map((h) => `<th class="n">${esc(h)}</th>`).join('')}</tr></thead><tbody></tbody></table></div>
      <p class="hint" style="margin:10px 0 0"><kbd>↑</kbd> <kbd>↓</kbd> <span>move</span> · <kbd>Enter</kbd> <span>pick</span> · <kbd>Esc</kbd> <span>close</span></p>`;
    document.body.appendChild(dlg);
    const q = $('.lk-q', dlg), tb = $('tbody', dlg);
    let shown = [], idx = 0;
    const draw = () => {
      const low = q.value.trim().toLowerCase();
      shown = rows.filter((r) => !low || r.code.toLowerCase().includes(low) || r.name.toLowerCase().includes(low));
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
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); end(null); });
    dlg.showModal(); draw(); q.focus(); q.select();
  });
}
async function lookupParty(list, filter = '') {
  const entries = await ledger();
  const bal = {};
  for (const e of entries) if (e.partyId) bal[e.partyId] = (bal[e.partyId] || 0) + e.debitC - e.creditC;
  const id = await lookup({ title: list[0]?.kind === 'supplier' ? 'Suppliers' : 'Customers', headers: ['Region', 'Balance'], filter,
    rows: list.map((p) => ({ id: p.id, code: p.code, name: p.name, extra: [REGIONS[p.region] || '', money(p.kind === 'supplier' ? -(bal[p.id] || 0) : bal[p.id] || 0)] })) });
  return id ? partyById(id) : null;
}
async function lookupItem(filter = '', type = 'SI') {
  const oh = stockOnHand(await db.all('stock'));
  const id = await lookup({ title: 'Items', headers: ['Price', 'On hand'], filter,
    rows: S.items.filter((i) => i.active !== false).map((i) => ({ id: i.id, code: i.code, name: i.name, extra: [fmt(Number(defaultPrice(i, type)) || 0, 3), fmt(oh[i.id]?.qty || 0, 0)] })) });
  return id ? itemById(id) : null;
}

// Inquiry card (F2 on a field that already holds a record): the record's definition, read-only.
// Resolves 'list' when the user presses F2 again (or the button) to change the choice, else null.
function recordCard({ title, fields, sections = [] }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'lookup card-dlg';
    dlg.innerHTML = `<h2 style="margin-top:0" dir="auto">${esc(title)}</h2>
      <div class="kv">${fields.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `<div><span>${esc(k)}</span><b dir="auto">${v}</b></div>`).join('')}</div>
      ${sections.map(([h, html]) => `<h3>${esc(h)}</h3>${html}`).join('')}
      <div class="actions" style="margin-bottom:0"><button class="btn tonal" data-v="list">Change <kbd>F2</kbd></button><button class="btn" data-v="close">Close <kbd>Esc</kbd></button></div>`;
    document.body.appendChild(dlg); translate(dlg);
    const end = (v) => { dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); end(null); });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'F2') { e.preventDefault(); end('list'); }
      else if (e.key === 'Enter') { e.preventDefault(); end(null); }
    });
    $$('[data-v]', dlg).forEach((b) => (b.onclick = () => end(b.dataset.v === 'list' ? 'list' : null)));
    dlg.showModal(); $('[data-v=close]', dlg).focus();
  });
}
const miniTable = (head, rows) => rows.length
  ? `<div class="lk-list"><table class="t"><thead><tr>${head.map((h, i) => `<th class="${i ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'n' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  : '<p class="muted">None</p>';

async function partyCard(p) {
  const entries = await db.byIndex('ledger', 'partyId', p.id);
  const bal = entries.reduce((s, e) => s + (p.kind === 'supplier' ? e.creditC - e.debitC : e.debitC - e.creditC), 0);
  const docs = S.docs.filter((d) => d.partyId === p.id && d.status === 'posted').sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.seqNo || 0) - (a.seqNo || 0));
  const last = (types) => docs.find((d) => types.includes(d.type));
  const li = last(['SI', 'PI']), lr = last(['RV', 'PV']);
  return recordCard({
    title: `${p.code} — ${p.name}`,
    fields: [
      ['Code', esc(p.code)], ['Name', esc(p.name)], ['Region', esc(T(REGIONS[p.region] || ''))], ['Type', esc(T(CUSTOMER_TYPES[p.type] || ''))],
      ['Phone', esc(p.phone || '')], ['Address', esc(p.address || '')], ['Tax / licensed dealer no.', esc(p.taxNo || '')], ['Guarantor', esc(p.guarantor || '')],
      ['Balance', `<span dir="ltr">${money(bal)}</span>`],
      ['Credit limit', p.creditLimit ? fmt(p.creditLimit) : ''], ['Remaining', p.creditLimit ? money(toCents(p.creditLimit) - bal) : ''],
      ['Last invoice', li ? `${esc(li.number)} · ${esc(li.date)} · ${money(li.totalC)}` : ''],
      ['Last payment', lr ? `${esc(lr.number)} · ${esc(lr.date)} · ${money(lr.totalC)}` : ''],
      ['Status', p.active === false ? esc(T('inactive')) : ''],
    ],
  });
}

async function itemCard(it, partyId, type) {
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
  const recent = posted.filter((d) => d.type === 'SI').slice(0, 5).map((d) => { const l = lineOf(d); return [esc(d.number), esc(partyById(d.partyId)?.name || ''), fmt(l.qty || 0, 0), fmt(l.bonus || 0, 0), fmt(l.price || 0, 3)]; });
  return recordCard({
    title: `${it.code} — ${it.name}`,
    fields: [
      ['Code', esc(it.code)], ['Name', esc(it.name)], ['Brand', esc(it.brand || '')], ['Category', esc(it.category || '')], ['Unit', esc(it.unit || '')], ['Barcode', esc(it.barcode || '')],
      ['Buy price', fmt(it.buyPrice || 0, 3)], ['Public price', fmt(it.pricePublic || 0, 3)], ['Pharmacist price', fmt(it.pricePharmacist || 0, 3)],
      ['On hand', `<b>${fmt(onHand, 0)}</b>`],
      ['Last price to this customer', lastSaleHere ? `${fmt(lineOf(lastSaleHere).price || 0, 3)} · ${esc(lastSaleHere.date)}` : ''],
      ['Last purchase price', lastBuy ? `${fmt(lineOf(lastBuy).price || 0, 3)} · ${esc(lastBuy.date)}` : ''],
    ],
    sections: [['Batches in stock', miniTable(['Batch', 'Expiry', 'Qty'], lotRows)], ['Last sales', miniTable(['Number', 'Customer', 'Qty', 'Bonus', 'Price'], recent)]],
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
function defaultPrice(item, type) {
  if (!item) return '';
  if (['PI', 'PR', 'OS'].includes(type)) return item.buyPrice ?? '';
  return item.pricePharmacist || item.pricePublic || '';
}

function linesUI(doc) {
  const row = (l) => {
    const it = itemById(l.itemId);
    return `<tr data-item="${esc(it?.id || '')}" class="${it ? 'found' : ''}">
      <td class="ln"></td>
      <td class="code"><input data-k="code" dir="ltr" inputmode="numeric" value="${esc(it ? it.code : '')}" placeholder="Code"></td>
      <td class="item"><div class="namewrap"><input data-k="name" list="dlNames" dir="auto" value="${esc(it ? it.name : l.itemText || '')}" placeholder="Item name"><button type="button" class="lkbtn" data-lk="item" tabindex="-1" title="Lookup (F2)">⌕</button></div>
        <div class="subline"><input data-k="batch" value="${esc(l.batch)}" placeholder="Batch" tabindex="-1"><input data-k="expiry" type="month" value="${esc(l.expiry)}" title="Expiry" tabindex="-1"><span class="oh"></span></div></td>
      <td class="num" data-label="Price"><input data-k="price" inputmode="decimal" value="${esc(l.price)}" style="width:104px"></td>
      <td class="num" data-label="Qty"><input data-k="qty" inputmode="decimal" value="${esc(l.qty)}" style="width:92px"></td>
      <td class="num" data-label="Bonus"><input data-k="bonus" inputmode="decimal" value="${esc(l.bonus)}" style="width:84px"></td>
      <td class="num" data-label="Disc %"><input data-k="disc" inputmode="decimal" value="${esc(l.disc)}" placeholder="%" style="width:72px"></td>
      <td class="n amt"></td>
      <td><button class="btn small" data-del tabindex="-1" title="Remove line from draft">×</button></td></tr>`;
  };
  return `<div class="tablewrap" style="margin-top:24px"><table class="t lines" id="lines"><thead><tr>
    <th>#</th><th>Code</th><th>Item</th><th class="n">Price</th><th class="n">Qty</th><th class="n">Bonus</th><th class="n">Disc %</th><th class="n">Amount</th><th></th></tr></thead>
    <tbody>${(doc.lines.length ? doc.lines : [blankLine()]).map(row).join('')}</tbody></table></div>
    <p class="hint" style="margin:12px 4px">Type the item code, or leave it empty and type the first letters of the name. <kbd>Enter</kbd> moves: code → name → price → qty → bonus → discount → next line. <kbd>Enter</kbd> on an empty line finishes. <kbd>F2</kbd> opens the item list.</p>
    <div class="row" style="margin-top:8px;align-items:flex-start">
      <div><button class="btn small" id="addline" tabindex="-1">+ Line</button>
      <label class="f" style="margin-top:16px">Invoice discount (₪)<input id="invdisc" inputmode="decimal" value="${esc(doc.invoiceDiscount || '')}" style="width:180px"></label></div>
      <div class="totals card" id="totals"></div>
    </div>
    <template id="rowTpl">${row(blankLine())}</template>`;
}

function wireLines(doc, arm, parties = []) {
  const tbody = $('#lines tbody');
  const ORDER = ['code', 'name', 'price', 'qty', 'bonus', 'disc'];
  const renumber = () => $$('tr', tbody).forEach((tr, i) => ($('.ln', tr).textContent = i + 1));
  const recalc = () => {
    const lines = $$('tr', tbody).map((tr) => ({ qty: num($('[data-k=qty]', tr).value) || 0, bonus: num($('[data-k=bonus]', tr).value) || 0, price: num($('[data-k=price]', tr).value) || 0, disc: num($('[data-k=disc]', tr).value) || 0 }));
    const tot = computeTotals(lines, { vatRate: S.settings.vatRate, pricesIncludeVat: S.settings.pricesIncludeVat, invoiceDiscount: num($('#invdisc').value) || 0 });
    $$('tr', tbody).forEach((tr, i) => { $('.amt', tr).textContent = tot.lines[i].amountC ? money(tot.lines[i].amountC) : ''; });
    $('#totals').innerHTML = `
      <div><span>Lines</span><span>${$$('tr', tbody).filter((tr) => tr.dataset.item).length}</span></div>
      <div><span>Total qty / bonus</span><span>${fmt(tot.qtyTotal, 0)} / ${fmt(tot.bonusTotal, 0)}</span></div>
      <div><span>Subtotal</span><span>${money(tot.subtotalC)}</span></div>
      ${tot.discC ? `<div><span>Invoice discount</span><span>−${money(tot.discC)}</span></div>` : ''}
      <div><span>Net before VAT</span><span>${money(tot.netC)}</span></div>
      <div><span>VAT ${S.settings.vatRate}%</span><span>${money(tot.vatC)}</span></div>
      <div class="grand"><span>Total ₪</span><span>${money(tot.totalC)}</span></div>
      <div class="words">${esc(amountInWords(fromCents(tot.totalC)))}</div>`;
    translate($('#totals'));
    $('#barTotal').textContent = money(tot.totalC); $('#barTotal').dataset.c = tot.totalC; $('#barTotal').dispatchEvent(new Event('total'));
    showOh();
  };
  // stock on hand beside the expiry: on screen only, never printed
  let oh = null;
  const showOh = () => { if (oh) $$('tr', tbody).forEach((tr) => { const el = $('.oh', tr); const it = tr.dataset.item; el.innerHTML = it ? `<span>On hand</span> <b>${fmt(oh[it]?.qty || 0, 0)}</b>` : ''; if (it && !el.dataset.done) translate(el); }); };
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
  tbody.addEventListener('click', (e) => { if (e.target.dataset.del !== undefined) { e.target.closest('tr').remove(); if (!tbody.children.length) addRow(); renumber(); recalc(); } });
  const pick = async (tr, filter) => {
    const it = await lookupItem(filter, doc.type);
    if (it) { setItem(tr, it); tr.classList.remove('unknown'); recalc(); const el = $('[data-k=price]', tr); el.focus(); el.select(); }
    else $('[data-k=code]', tr).focus();
  };
  tbody.addEventListener('keydown', async (e) => {
    const tr0 = e.target.closest('tr'); const k0 = e.target.dataset.k;
    if (e.key === 'F2' && (k0 === 'code' || k0 === 'name')) {
      e.preventDefault();
      if (tr0.dataset.item) {
        const pid = parties.find((x) => partyLabel(x) === ($('#party')?.value || '').trim())?.id;
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

  // Phone composer: one capsule above the keyboard that feeds the next line.
  // Enter: item → price → qty → bonus → line added, back to item.
  // Phone: the card above the keyboard IS the lines table. You fill the line itself, like Bisan's grid;
  // the card's two buttons are lookup (F2) and next (Enter).
  const phone = window.matchMedia('(max-width: 860px)').matches;
  if (phone) {
    $('#composer').prepend($('#lines').closest('.tablewrap'));
    ORDER.pop();                                          // discount is not part of the Enter walk on phones
    if (!$$('tr', tbody).some((r) => isEmpty(r))) addRow();
    let lastIn = null;
    tbody.addEventListener('click', (e) => { if (e.target.dataset.del !== undefined && !$$('tr', tbody).some((r) => isEmpty(r))) addRow(); });   // always one empty line to write on
    tbody.addEventListener('focusin', (e) => { if (e.target.dataset.k) { lastIn = e.target; e.target.closest('tr').scrollIntoView({ block: 'nearest' }); } });
    const cur = () => (lastIn && tbody.contains(lastIn) ? lastIn : $('[data-k=code]', $$('tr', tbody).find((r) => isEmpty(r)) || addRow()));
    const key = (k) => { const el = cur(); const t = k === 'F2' && !['code', 'name'].includes(el.dataset.k) ? $('[data-k=code]', el.closest('tr')) : el; t.focus(); t.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); };
    setTimeout(() => { $('#cLook').onclick = () => key('F2'); $('#cAdd').onclick = () => key('Enter'); });
  }
  const C = { item: $('#cItem'), price: $('#cPrice'), qty: $('#cQty'), bonus: $('#cBonus'), name: $('#cName'), nums: $('#cNums') };
  let cPicked = null;
  const cReset = () => { cPicked = null; C.item.value = ''; C.price.value = ''; C.qty.value = ''; C.bonus.value = ''; C.name.hidden = true; C.nums.hidden = true; C.item.hidden = false; $('#cOh').textContent = ''; };
  const cPick = (it) => {
    cPicked = it; $('b', C.name).textContent = `${it.code} — ${it.name}`; C.name.hidden = false; C.nums.hidden = false; C.item.hidden = true;
    C.price.value = defaultPrice(it, doc.type); C.qty.focus();
    $('#cOh').innerHTML = oh ? `<span>On hand</span> <b>${fmt(oh[it.id]?.qty || 0, 0)}</b>` : ''; translate($('#cOh'));
  };
  const cResolve = async () => {
    const v = C.item.value.trim();
    const act = S.items.filter((i) => i.active !== false);
    const it = v ? (act.find((i) => i.code.toLowerCase() === v.toLowerCase()) || byName(v)) : null;
    const got = it || (await lookupItem(v, doc.type));
    if (got) cPick(got); else C.item.focus();
  };
  const cAdd = () => {
    if (!cPicked) return cResolve();
    if (!(num(C.qty.value) > 0) && !(num(C.bonus.value) > 0)) { C.qty.focus(); return; }
    const tr = $$('tr', tbody).find((r) => isEmpty(r)) || addRow();
    setItem(tr, cPicked);
    $('[data-k=price]', tr).value = C.price.value; $('[data-k=qty]', tr).value = C.qty.value; $('[data-k=bonus]', tr).value = C.bonus.value;
    renumber(); recalc(); cReset(); C.item.focus();
    tr.scrollIntoView({ block: 'nearest' });
  };
  C.item.addEventListener('keydown', (e) => {
    if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); cResolve(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (C.item.value.trim()) cResolve(); else arm(); }
  });
  [[C.qty, () => C.bonus.focus()], [C.price, () => C.qty.focus()], [C.bonus, cAdd]].forEach(([el, next]) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } }));
  $('#cLook').onclick = async () => { const it = await lookupItem(cPicked ? '' : C.item.value.trim(), doc.type); if (it) cPick(it); };
  $('#cAdd').onclick = cAdd;
  $('#cClear').onclick = () => { cReset(); C.item.focus(); };
  $('#invdisc').oninput = recalc;
  renumber(); recalc();
}

function voucherUI(doc) {
  return `<div class="row" style="margin-top:18px">
    <label class="f">Amount (₪)<input id="amount" inputmode="decimal" value="${esc(doc.amount)}" style="width:180px;font-size:1.2em"></label>
    ${['RV', 'PV'].includes(doc.type) ? `
    <label class="f">Method<select id="method">${Object.entries(PAY_METHODS).map(([k, v]) => `<option value="${k}" ${doc.method === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="f">Into / from<select id="cashAccount">${CASH_ACCOUNTS.map((a) => `<option value="${a}" ${doc.cashAccount === a ? 'selected' : ''}>${ACCOUNTS[a].name}</option>`).join('')}</select></label>
    <label class="f cheque">Cheque no.<input id="chequeNo" value="${esc(doc.chequeNo || '')}"></label>
    <label class="f cheque">Bank<input id="chequeBank" value="${esc(doc.chequeBank || '')}"></label>
    <label class="f cheque">Due date<input id="dueDate" type="date" value="${esc(doc.dueDate || '')}"></label>`
    : `<input id="method" type="hidden" value=""><input id="cashAccount" type="hidden" value=""><input id="chequeNo" type="hidden"><input id="chequeBank" type="hidden"><input id="dueDate" type="hidden">`}
  </div><div class="words" style="text-align:left;direction:rtl" id="amtWords"></div>`;
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
  const tot = t.lines ? computeTotals(d.lines, { vatRate: d.settingsAtPost?.vatRate ?? S.settings.vatRate, pricesIncludeVat: d.settingsAtPost?.pricesIncludeVat ?? S.settings.pricesIncludeVat, invoiceDiscount: d.invoiceDiscount }) : null;
  $('#main').innerHTML = `
    <h1><span>${t.name}</span> <span dir="ltr">${esc(d.number)}</span> <span class="pill ${d.status}">${d.status}</span>${d.backdated ? ' <span class="pill bad">Backdated</span>' : ''}</h1>
    <p class="sub">${esc(d.date)} · ${esc(partyLabel(p))}${d.reference ? ` · Ref. ${esc(d.reference)}` : ''} · posted by ${esc(d.postedBy)} ${esc((d.postedAt || '').slice(0, 16).replace('T', ' '))}</p>
    ${d.status === 'voided' ? `<div class="note bad">Voided by ${esc(d.voidedBy)} on ${esc(d.voidedAt?.slice(0, 10))}: ${esc(d.voidReason)}. A reversing entry was posted; the number stays used.</div>` : ''}
    ${t.lines ? `<div class="tablewrap" style="margin-top:16px"><table class="t"><thead><tr><th>Code</th><th>Item</th><th>Batch</th><th>Expiry</th><th class="n">Qty</th><th class="n">Bonus</th><th class="n">Price</th><th class="n">Disc %</th><th class="n">Amount</th></tr></thead><tbody>
      ${tot.lines.map((l) => { const it = lineItem(l); return `<tr><td>${esc(it.code)}</td><td dir="auto">${esc(it.name)}</td><td>${esc(l.batch)}</td><td>${esc(l.expiry)}</td><td class="n">${fmt(l.qty || 0, 0)}</td><td class="n">${l.bonus ? fmt(l.bonus, 0) : ''}</td><td class="n">${fmt(l.price || 0, 3)}</td><td class="n">${l.disc ? l.disc + '%' : ''}</td><td class="n">${money(l.amountC)}</td></tr>`; }).join('')}
      </tbody><tfoot><tr><td colspan="4">Totals</td><td class="n">${fmt(tot.qtyTotal, 0)}</td><td class="n">${fmt(tot.bonusTotal, 0)}</td><td></td><td></td><td class="n">${money(tot.subtotalC)}</td></tr></tfoot></table></div>
      <div class="row" style="margin-top:14px"><div class="totals card">
        ${tot.discC ? `<div><span>Invoice discount</span><span>−${money(tot.discC)}</span></div>` : ''}
        <div><span>Net</span><span>${money(tot.netC)}</span></div><div><span>VAT</span><span>${money(tot.vatC)}</span></div>
        <div class="grand"><span>Total ₪</span><span>${money(tot.totalC)}</span></div><div class="words">${esc(amountInWords(fromCents(tot.totalC)))}</div></div></div>`
    : `<div class="card" style="margin-top:16px"><div class="kpi"><div class="label">Amount</div><div class="value">${money(d.totalC)} ₪</div></div>
        <p class="words">${esc(amountInWords(fromCents(d.totalC)))}</p>
        ${d.method ? `<p>${PAY_METHODS[d.method] || ''} → ${ACCOUNTS[d.cashAccount]?.name || ''}${d.chequeNo ? ` · Cheque ${esc(d.chequeNo)} ${esc(d.chequeBank)} due ${esc(d.dueDate)}` : ''}</p>` : ''}</div>`}
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
  const opt = { vatRate: d.settingsAtPost?.vatRate ?? s.vatRate, pricesIncludeVat: d.settingsAtPost?.pricesIncludeVat ?? s.pricesIncludeVat, invoiceDiscount: d.invoiceDiscount };
  const tot = t.lines ? computeTotals(d.lines, opt) : { totalC: toCents(d.amount) };
  const stampOf = ({ label, copyNo }) => (label === 'ORIGINAL' ? 'ORIGINAL · أصلية' : label === 'COPY' ? `COPY ${copyNo} · نسخة ${copyNo}` : 'DRAFT · مسودة');
  const ar = { SI: 'فاتورة ضريبية', SR: 'مرتجع مبيعات', PI: 'فاتورة مشتريات', PR: 'مرتجع مشتريات', RV: 'سند قبض', PV: 'سند صرف', CN: 'إشعار دائن', DN: 'إشعار مدين', OB: 'رصيد افتتاحي', OS: 'بضاعة أول المدة' }[d.type];
  const page = ({ label, copyNo }) => { const stamp = stampOf({ label, copyNo }); return `<div class="doc-print page" dir="${getLang() === 'ar' ? 'rtl' : 'ltr'}">
    ${label === 'DRAFT' ? '<div class="wm">مسودة</div>' : ''}
    <div class="ph"><div><div class="co" dir="auto">${esc(s.companyName)}</div>${s.companyNameAr ? `<div dir="rtl">${esc(s.companyNameAr)}</div>` : ''}
      <div>${esc(s.address)} ${s.phone ? '· ' + esc(s.phone) : ''}</div>${s.taxNo ? `<div>Licensed dealer no. / رقم المشتغل: ${esc(s.taxNo)}</div>` : ''}</div>
      <div class="title"><div class="t1">${t.name} · ${ar}</div><div style="font-size:13pt"><b>${esc(d.number || 'DRAFT')}</b></div><div>${esc(d.date)}</div><div class="stamp">${stamp}</div></div></div>
    ${t.party !== 'none' ? `<div class="party"><div><b>${p.kind === 'supplier' ? 'Supplier · المورد' : 'Customer · الزبون'}:</b> <span dir="auto">${esc(p.code)} — ${esc(p.name)}</span></div>
      <div><b>Ref.</b> ${esc(d.reference || '—')}</div><div dir="auto">${esc(p.address || '')} ${p.region ? '· ' + REGIONS[p.region] : ''}</div><div>${p.taxNo ? 'Tax no. ' + esc(p.taxNo) : ''} ${d.salesman ? '· Salesman ' + esc(d.salesman) : ''}</div></div>` : ''}
    ${t.lines ? `<table><thead><tr><th>Code</th><th>Item · البيان</th><th class="n">Qty · كمية</th><th class="n">Bonus · بونص</th><th class="n">Price · سعر</th><th class="n">Disc · خصم</th><th class="n">Amount · المجموع</th></tr></thead><tbody>
      ${tot.lines.map((l) => { const it = lineItem(l); return `<tr><td>${esc(it.code)}</td><td dir="auto">${esc(it.name)}${l.batch || l.expiry ? `<div class="batch">Batch ${esc(l.batch || '—')} · Exp. ${esc(l.expiry || '—')}</div>` : ''}</td>
        <td class="n">${fmt(l.qty || 0, 0)}</td><td class="n">${l.bonus ? fmt(l.bonus, 0) : ''}</td><td class="n">${fmt(l.price || 0, 3)}</td><td class="n">${l.disc ? l.disc + '%' : ''}</td><td class="n">${money(l.amountC)}</td></tr>`; }).join('')}
      </tbody></table>
      <div class="foot"><div><div>Lines ${tot.lines.length} · Total qty ${fmt(tot.qtyTotal, 0)} · Total bonus ${fmt(tot.bonusTotal, 0)}</div>
        <div class="words" dir="rtl">${esc(amountInWords(fromCents(tot.totalC)))}</div>${d.notes ? `<div dir="auto">Notes: ${esc(d.notes)}</div>` : ''}</div>
        <div class="sum">${tot.discC ? `<div><span>Invoice discount</span><span>−${money(tot.discC)}</span></div>` : ''}
          <div><span>Net · الصافي قبل الضريبة</span><span>${money(tot.netC)}</span></div><div><span>VAT ${opt.vatRate}% · الضريبة</span><span>${money(tot.vatC)}</span></div>
          <div class="g"><span>Total ₪ · المجموع</span><span>${money(tot.totalC)}</span></div></div></div>`
    : `<div style="font-size:14pt;margin:16px 0"><b>Amount · المبلغ: ${money(tot.totalC)} ₪</b></div><div class="words" dir="rtl">${esc(amountInWords(fromCents(tot.totalC)))}</div>
       ${d.method ? `<p>${PAY_METHODS[d.method] || ''}${d.chequeNo ? ` · Cheque ${esc(d.chequeNo)} · ${esc(d.chequeBank)} · due ${esc(d.dueDate)}` : ''}</p>` : ''}${d.notes ? `<p dir="auto">${esc(d.notes)}</p>` : ''}`}
    <div class="sign"><span>Received by · المستلم</span><span>Signature · التوقيع</span></div>
    <div class="meta"><span>Printed by ${esc(S.user)} · ${new Date().toLocaleString('en-GB')}</span><span>${esc(stamp)}</span></div>
  </div>`; };
  $('#printArea').innerHTML = pages.map(page).join('');
  document.body.classList.add('printing');
  setTimeout(() => { window.print(); document.body.classList.remove('printing'); }, 50);
}

// ---------- items ----------
routes.items = async () => {
  const moves = await db.all('stock');
  const oh = stockOnHand(moves);
  $('#main').innerHTML = `<h1>Items</h1><p class="sub">${S.items.length} items. Codes are permanent. Items are never deleted, only deactivated.</p>
    <div class="searchbar"><input id="q" placeholder="Search by code or name" autofocus>${isAdmin() ? '<button class="btn primary" id="add">Add item</button>' : '<span class="muted">Only the admin adds or edits items.</span>'}</div>
    <p class="hint" style="margin:-6px 4px 16px">${isAdmin() ? 'Click a row to edit it.' : ''} <kbd>Enter</kbd> <span>opens the only match.</span></p>
    <div class="tablewrap"><table class="t"><thead><tr><th>Code</th><th>Name</th><th>Brand</th><th>Category</th><th>Unit</th><th class="n">Buy</th><th class="n">Public</th><th class="n">Pharmacist</th><th class="n">On hand</th><th></th></tr></thead><tbody id="tb">
    ${S.items.map((i) => `<tr data-id="${i.id}" data-s="${esc((i.code + ' ' + i.name + ' ' + (i.brand || '')).toLowerCase())}"><td><b>${esc(i.code)}</b></td><td dir="auto">${esc(i.name)}${i.active === false ? ` <span class="pill">inactive</span>${i.replacedBy ? ` → ${esc(itemById(i.replacedBy)?.code || '')}` : ''}` : ''}</td><td>${esc(i.brand || '')}</td><td>${esc(i.category || '')}</td><td>${esc(i.unit || '')}</td>
      <td class="n">${fmt(i.buyPrice || 0, 3)}</td><td class="n">${fmt(i.pricePublic || 0, 3)}</td><td class="n">${fmt(i.pricePharmacist || 0, 3)}</td><td class="n">${fmt(oh[i.id]?.qty || 0, 0)}</td>
      <td>${isAdmin() ? `<button class="btn small" data-edit="${i.id}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  $('#q').oninput = (e) => { const s = e.target.value.toLowerCase(); $$('#tb tr').forEach((tr) => (tr.style.display = tr.dataset.s.includes(s) ? '' : 'none')); };
  $('#add') && ($('#add').onclick = () => itemForm({}));
  const openItem = (id) => isAdmin() && guard(async () => itemForm(itemById(id), await db.hasMovements('items', id)));
  $$('[data-edit]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openItem(b.dataset.edit); }));
  $$('#tb tr').forEach((tr) => { tr.style.cursor = isAdmin() ? 'pointer' : ''; tr.onclick = () => openItem(tr.dataset.id); });
  $('#q').onkeydown = (e) => { if (e.key !== 'Enter') return; const vis = $$('#tb tr').filter((tr) => tr.style.display !== 'none'); if (vis.length === 1) openItem(vis[0].dataset.id); };
  $('#q').focus();
};
function itemForm(it, locked = false) {
  const dlg = document.createElement('dialog');
  const f = (k, label, type = 'text') => `<label class="f">${label}<input name="${k}" type="${type}" ${type === 'number' ? 'step="any"' : ''} dir="auto" value="${esc(it[k] ?? '')}" ${(k === 'code' && it.id) || (k === 'name' && locked) ? 'readonly' : ''}></label>`;
  dlg.innerHTML = `<h2 style="margin-top:0">${it.id ? 'Edit item' : 'New item'}</h2><form method="dialog" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    ${f('code', 'Code (permanent)')}${f('name', 'Name')}${f('brand', 'Brand / company')}${f('category', 'Category')}${f('unit', 'Unit')}${f('barcode', 'Barcode')}
    ${f('buyPrice', 'Buy price', 'number')}${f('pricePublic', 'Public price', 'number')}${f('pricePharmacist', 'Pharmacist price', 'number')}
    <label class="f">Active<select name="active"><option value="true">Yes</option><option value="false" ${it.active === false ? 'selected' : ''}>No</option></select></label>
    ${it.id ? `<label class="f">Replaced by (if inactive)<select name="replacedBy"><option value="">—</option>${S.items.filter((x) => x.id !== it.id && x.active !== false).map((x) => `<option value="${x.id}" ${it.replacedBy === x.id ? 'selected' : ''}>${esc(x.code)} — ${esc(x.name)}</option>`).join('')}</select></label>` : ''}
    <p class="muted" style="grid-column:1/-1;margin:0">${locked ? 'This item has movements, so its name is locked: one code is one account with one name. If the name is wrong, set Active to No (it disappears from the lists but stays in every account and report) and add a new item with the right name.' : 'No movements yet, so the name can still be corrected freely.'}</p>
    <div class="actions" style="grid-column:1/-1"><button class="btn primary" value="save">Save</button><button class="btn" value="cancel">Cancel</button></div></form>`;
  document.body.appendChild(dlg); dlg.showModal();
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
    ${kind === 'customer' ? `<select id="reg"><option value="">All regions</option>${Object.entries(REGIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>` : ''}
    ${isAdmin() ? `<button class="btn primary" id="add">Add ${kind}</button>` : ''}</div>
    <p class="hint" style="margin:-6px 4px 16px">${isAdmin() ? 'Click a row to edit it.' : 'Click a row for its statement.'} <kbd>Enter</kbd> <span>opens the only match.</span></p>
    <div class="tablewrap"><table class="t"><thead><tr><th>Code</th><th>Name</th><th>Phone</th>${kind === 'customer' ? '<th>Region</th><th>Type</th><th class="n">Credit limit</th>' : ''}<th class="n">Balance</th><th></th></tr></thead><tbody id="tb">
    ${list.map((p) => `<tr data-id="${p.id}" data-s="${esc((p.code + ' ' + p.name + ' ' + (p.phone || '')).toLowerCase())}" data-r="${p.region || ''}"><td><b>${esc(p.code)}</b></td><td dir="auto">${esc(p.name)}${p.active === false ? ` <span class="pill">inactive</span>${p.replacedBy ? ` → ${esc(partyById(p.replacedBy)?.code || '')}` : ''}` : ''}</td><td>${esc(p.phone || '')}</td>
      ${kind === 'customer' ? `<td>${REGIONS[p.region] || ''}</td><td>${CUSTOMER_TYPES[p.type] || ''}</td><td class="n">${p.creditLimit ? fmt(p.creditLimit) : ''}</td>` : ''}
      <td class="n"><b>${money(bal[p.id] || 0)}</b></td><td style="white-space:nowrap"><a class="btn small" href="#/statement/${p.id}">Statement</a> ${isAdmin() ? `<button class="btn small" data-edit="${p.id}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  const filt = () => { const s = $('#q').value.toLowerCase(); const r = $('#reg')?.value || ''; $$('#tb tr').forEach((tr) => (tr.style.display = tr.dataset.s.includes(s) && (!r || tr.dataset.r === r) ? '' : 'none')); };
  $('#q').oninput = filt; $('#reg') && ($('#reg').onchange = filt);
  $('#add') && ($('#add').onclick = () => partyForm({ kind }));
  const openParty = (id) => (isAdmin() ? guard(async () => partyForm(partyById(id), await db.hasMovements('parties', id))) : go('#/statement/' + id));
  $$('[data-edit]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openParty(b.dataset.edit); }));
  $$('#tb tr a').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  $$('#tb tr').forEach((tr) => { tr.style.cursor = 'pointer'; tr.onclick = () => openParty(tr.dataset.id); });
  $('#q').onkeydown = (e) => { if (e.key !== 'Enter') return; const vis = $$('#tb tr').filter((tr) => tr.style.display !== 'none'); if (vis.length === 1) openParty(vis[0].dataset.id); };
  $('#q').focus();
}
function partyForm(p, locked = false) {
  const dlg = document.createElement('dialog');
  const f = (k, label, type = 'text') => `<label class="f">${label}<input name="${k}" type="${type}" ${type === 'number' ? 'step="any"' : ''} dir="auto" value="${esc(p[k] ?? '')}" ${(k === 'code' && p.id) || (k === 'name' && locked) ? 'readonly' : ''}></label>`;
  const cust = p.kind === 'customer';
  dlg.innerHTML = `<h2 style="margin-top:0">${p.id ? 'Edit' : 'New'} ${p.kind}</h2><form method="dialog" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    ${f('code', 'Code (permanent)')}${f('name', 'Name')}${f('phone', 'Phone')}${f('address', 'Address')}${f('taxNo', 'Tax / licensed dealer no.')}
    ${cust ? `<label class="f">Region<select name="region">${Object.entries(REGIONS).map(([k, v]) => `<option value="${k}" ${p.region === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f">Type<select name="type">${Object.entries(CUSTOMER_TYPES).map(([k, v]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${f('creditLimit', 'Credit limit (₪)', 'number')}${f('guarantor', 'Guarantor')}` : ''}
    ${p.id ? '' : f('openingBalance', 'Opening balance (₪)', 'number')}
    ${p.id ? `<label class="f">Active<select name="active"><option value="true">Yes</option><option value="false" ${p.active === false ? 'selected' : ''}>No</option></select></label>
      <label class="f">Replaced by (if inactive)<select name="replacedBy"><option value="">—</option>${S.parties.filter((x) => x.kind === p.kind && x.id !== p.id && x.active !== false).map((x) => `<option value="${x.id}" ${p.replacedBy === x.id ? 'selected' : ''}>${esc(partyLabel(x))}</option>`).join('')}</select></label>
      <p class="muted" style="grid-column:1/-1;margin:0">${locked ? `This ${p.kind} has movements, so its name is locked: one code is one account with one name. If the name is wrong, set Active to No (it disappears from the lists but stays in every account and report) and add a new ${p.kind} with the right name.` : 'No movements yet, so the name can still be corrected freely.'}</p>` : ''}
    <div class="actions" style="grid-column:1/-1"><button class="btn primary" value="save">Save</button><button class="btn" value="cancel">Cancel</button></div></form>`;
  document.body.appendChild(dlg); dlg.showModal();
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
routes.statement = async (pid) => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const party = partyById(pid);
  const all = S.parties;
  $('#main').innerHTML = `<h1>Account statement</h1><p class="sub">Every number links to its document.</p>
    <datalist id="dlP">${all.map((p) => `<option value="${esc(partyLabel(p))}">`).join('')}</datalist>
    <div class="row"><label class="f grow">Customer or supplier<input id="p" list="dlP" dir="auto" value="${esc(partyLabel(party))}"></label>
      <label class="f">From<input id="from" type="date" value="${esc(q.get('from') || '')}"></label><label class="f">To<input id="to" type="date" value="${esc(q.get('to') || '')}"></label>
      <button class="btn primary" id="show">Show</button><button class="btn" id="pr">Print / PDF</button><button class="btn" id="xl">Excel</button></div><div id="out" style="margin-top:20px"></div>`;
  $('#show').onclick = () => { const p = all.find((x) => partyLabel(x) === $('#p').value.trim()); if (p) location.hash = `#/statement/${p.id}?from=${$('#from').value}&to=${$('#to').value}`; };
  if (!party) return;
  const mk = party.kind === 'supplier' ? [['PV', 'Payment voucher'], ['PI', 'Purchase invoice']] : [['RV', 'Receipt voucher'], ['SI', 'Sales invoice']];
  $('#out').insertAdjacentHTML('beforebegin', `<div class="chain">${mk.map(([k, n], i) => `<a class="btn ${i ? '' : 'ink'}" href="#/new/${k}?party=${party.id}">${ic('plus')}<span>${n}</span></a>`).join('')}</div>`);
  const st = statement(await ledger(), S.docs, party.id, party.kind, { from: q.get('from') || '', to: q.get('to') || '' });
  const rows = st.rows.map((r) => [r.date, r.number || r.doc?.number, DOC_TYPES[r.type]?.name + (r.reversal ? ' (void reversal)' : ''), r.doc?.reference || '', r.debitC, r.creditC, r.balanceC]);
  $('#out').innerHTML = `<div class="tablewrap"><table class="t st"><thead><tr><th>Date</th><th>Document</th><th>Type</th><th>Ref.</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr></thead><tbody>
    ${st.opening ? `<tr><td colspan="6"><i>Opening balance</i></td><td class="n">${money(st.opening)}</td></tr>` : ''}
    ${st.rows.map((r) => `<tr><td class="sd">${esc(r.date)}</td><td class="sn"><a href="#/doc/${r.docId}">${esc(r.number || '')}</a></td><td class="sy">${esc(DOC_TYPES[r.type]?.name || '')}${r.reversal ? ' <span class="pill voided">reversal</span>' : ''}</td><td class="sr">${esc(r.doc?.reference || '')}</td>
      <td class="n sdb">${r.debitC ? money(r.debitC) : ''}</td><td class="n scr">${r.creditC ? money(r.creditC) : ''}</td><td class="n sb"><b>${money(r.balanceC)}</b></td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="4">Closing balance</td><td class="n">${money(st.rows.reduce((s, r) => s + r.debitC, 0))}</td><td class="n">${money(st.rows.reduce((s, r) => s + r.creditC, 0))}</td><td class="n">${money(st.closing)}</td></tr></tfoot></table></div>
    <p class="words">${esc(amountInWords(fromCents(Math.abs(st.closing))))}</p>`;
  $('#xl').onclick = () => toExcel(`statement-${party.code}.xlsx`, [['Date', 'Document', 'Type', 'Ref', 'Debit', 'Credit', 'Balance'], ...rows.map((r) => [...r.slice(0, 4), fromCents(r[4]), fromCents(r[5]), fromCents(r[6])])]);
  $('#pr').onclick = () => printHtml(`<h2>Statement · كشف حساب</h2><p><b dir="auto">${esc(partyLabel(party))}</b> · ${esc(q.get('from') || 'start')} → ${esc(q.get('to') || today())}</p>${$('#out').innerHTML}`);
};

routes.tb = async () => {
  const tb = trialBalance(await ledger());
  $('#main').innerHTML = `<h1>Trial balance</h1><p class="sub">Built only from posted entries. ${tb.balanced ? '<span class="pill ok">Balanced</span>' : '<span class="pill bad">Not balanced</span>'}</p>
    <div class="tablewrap"><table class="t"><thead><tr><th>Account</th><th>Name</th><th class="n">Total debit</th><th class="n">Total credit</th><th class="n">Debit balance</th><th class="n">Credit balance</th></tr></thead><tbody>
    ${tb.rows.map((r) => `<tr><td>${r.account}</td><td>${esc(r.name)}</td><td class="n">${money(r.debitC)}</td><td class="n">${money(r.creditC)}</td><td class="n">${r.balDebitC ? money(r.balDebitC) : ''}</td><td class="n">${r.balCreditC ? money(r.balCreditC) : ''}</td></tr>`).join('')}
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
    const tot = computeTotals(d.lines, { vatRate: d.settingsAtPost?.vatRate ?? 16, pricesIncludeVat: d.settingsAtPost?.pricesIncludeVat ?? true, invoiceDiscount: d.invoiceDiscount });
    const factor = tot.subtotalC ? tot.totalC / tot.subtotalC : 0;
    const p = partyById(d.partyId) || {};
    for (const l of tot.lines) {
      const it = lineItem(l);
      const key = by === 'item' ? it.code : by === 'region' ? REGIONS[p.region] || '—' : by === 'type' ? CUSTOMER_TYPES[p.type] || '—' : by === 'customer' ? p.code + ' — ' + p.name : d.date;
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
    ${check(!negative.length, 'No item below zero', negative.map((i) => esc(i.code)).join(', ') || 'All items at zero or above')}
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
      <label class="f grow">File<input id="file" type="file" accept=".xlsx,.xls,.csv"></label><button class="btn" id="tpl">Download template</button></div>
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
    const p = S.parties.find((x) => x.code === String(inv.customerCode || inv.supplierCode || '')) || S.parties.find((x) => x.name === inv.customerName);
    const lines = parseSmart(JSON.stringify({ invoice: inv }));
    const d = await db.saveDraft({ type: inv.type || 'SI', date: inv.date || today(), partyId: p?.id || '', reference: inv.reference || '', notes: 'Imported from AI', lines: lines.filter((l) => l.itemId), invoiceDiscount: 0 }, S.user);
    const missing = lines.filter((l) => !l.itemId).length;
    return { msg: `Draft created${missing ? ` · ${missing} unknown items skipped` : ''}${p ? '' : ' · choose the customer'}`, go: '#/doc/' + d.id };
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
      <label class="f">Language<select id="lang"><option value="en">English</option><option value="ar" ${getLang() === 'ar' ? 'selected' : ''}>العربية</option></select></label>
      <button class="btn" id="saveMe">Save</button></div>
    <h2>Role</h2><p class="muted">Admin adds items, customers and suppliers, voids documents, imports and restores. Accountant enters and posts documents.</p>
    <div class="actions">${isAdmin() ? '<button class="btn" id="toAcc">Switch to accountant</button>' : '<button class="btn primary" id="toAdmin">Switch to admin</button>'}</div>
    <h2>Company</h2><form id="co" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
      ${f('companyName', 'Company name')}${f('companyNameAr', 'Company name (Arabic)')}${f('taxNo', 'Licensed dealer no.')}${f('address', 'Address')}${f('phone', 'Phone')}${f('branch', 'Branch / vehicle code (series prefix)')}
      ${f('vatRate', 'VAT %', 'number')}${f('copiesInvoice', 'Print copies · Invoices', 'number')}${f('copiesVoucher', 'Print copies · Vouchers', 'number')}<label class="f">Prices include VAT<select name="pricesIncludeVat" ${isAdmin() ? '' : 'disabled'}><option value="true">Yes</option><option value="false" ${s.pricesIncludeVat ? '' : 'selected'}>No</option></select></label></form>
    ${isAdmin() ? `<div class="actions"><button class="btn primary" id="saveCo">Save company</button></div><h2>Admin PIN</h2><div class="row"><label class="f">New PIN<input id="pin" type="password" inputmode="numeric"></label><button class="btn" id="savePin">Set PIN</button></div>` : ''}
    <div class="note" style="margin-top:24px">This is version 0.1. Data is stored in this browser on this device. Cloud sync, real user accounts and permissions enforced by the server come in stage 3.</div>`;
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
function toExcel(name, aoa) { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1'); XLSX.writeFile(wb, name); }
function printHtml(html) {
  $('#printArea').innerHTML = `<div class="doc-print"><div class="ph"><div class="co">${esc(S.settings.companyName)}</div><div>${new Date().toLocaleString('en-GB')}</div></div>${html}</div>`;
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
