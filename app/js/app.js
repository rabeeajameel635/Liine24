import * as db from './db.js';
import {
  DOC_TYPES, REGIONS, CUSTOMER_TYPES, PAY_METHODS, ACCOUNTS, CASH_ACCOUNTS,
  computeTotals, fmt, fromCents, toCents, amountInWords, trialBalance, statement, stockOnHand,
  sequenceGaps, similarNames, validateImport, nextPartyCode, avgCostC,
} from './core.js';

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

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.className = ''), err ? 6000 : 2800);
}
async function guard(fn) {
  try { return await fn(); } catch (e) { console.error(e); toast(e.message || String(e), true); }
}
async function reload() {
  [S.settings, S.items, S.parties, S.docs] = await Promise.all([db.getSettings(), db.all('items'), db.all('parties'), db.all('docs')]);
  S.items.sort((a, b) => a.code.localeCompare(b.code));
  S.parties.sort((a, b) => a.code.localeCompare(b.code));
  document.documentElement.dataset.size = S.settings.fontScale;
  $('#brandName').textContent = S.settings.companyName || 'Ledger';
  $('#whoami').innerHTML = `${esc(S.user)} · <b>${isAdmin() ? 'Admin' : 'Accountant'}</b><br><a href="#/settings">Switch role</a>`;
}

// ---------- router ----------
const routes = {};
async function render() {
  const hash = location.hash.replace(/^#\//, '') || 'dashboard';
  const [name, ...args] = hash.split('?')[0].split('/');
  $$('#nav a').forEach((a) => a.classList.toggle('on', hash.startsWith(a.dataset.k)));
  const fn = routes[name] || routes.dashboard;
  await reload();
  $('#main').innerHTML = '';
  await guard(() => fn(...args));
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);
const go = (h) => { if (location.hash === h) render(); else location.hash = h; };

// ---------- ledger helpers ----------
async function ledger() { return db.all('ledger'); }
async function partyBalanceC(partyId) {
  const p = partyById(partyId); if (!p) return 0;
  const rows = await db.byIndex('ledger', 'partyId', partyId);
  return rows.reduce((s, e) => s + (p.kind === 'supplier' ? e.creditC - e.debitC : e.debitC - e.creditC), 0);
}

// ---------- dashboard ----------
routes.dashboard = async () => {
  const entries = await ledger();
  const tb = trialBalance(entries);
  const ar = entries.filter((e) => e.account === '1200').reduce((s, e) => s + e.debitC - e.creditC, 0);
  const ap = entries.filter((e) => e.account === '2100').reduce((s, e) => s + e.creditC - e.debitC, 0);
  const cash = entries.filter((e) => CASH_ACCOUNTS.includes(e.account)).reduce((s, e) => s + e.debitC - e.creditC, 0);
  const posted = S.docs.filter((d) => d.status === 'posted');
  const month = today().slice(0, 7);
  const salesOf = (pred) => posted.filter((d) => pred(d) && (d.type === 'SI' || d.type === 'SR')).reduce((s, d) => s + (d.type === 'SI' ? d.totalC : -d.totalC), 0);
  const drafts = S.docs.filter((d) => d.status === 'draft');
  const gaps = sequenceGaps(S.docs.filter((d) => d.number));
  const healthy = tb.balanced && !gaps.length;
  $('#main').innerHTML = `
    <h1>${esc(S.settings.companyName)}</h1><p class="sub">${new Date().toDateString()}</p>
    <div class="cards">
      ${kpi("Today's sales", money(salesOf((d) => d.date === today())))}
      ${kpi('This month', money(salesOf((d) => (d.date || '').startsWith(month))))}
      ${kpi('Receivables', money(ar))}
      ${kpi('Payables', money(ap))}
      ${kpi('Cash, bank, cheques', money(cash))}
      ${kpi('Books', healthy ? '<span class="pill ok">Balanced</span>' : '<span class="pill bad">Check</span>', '#/integrity')}
    </div>
    <div class="actions">
      <a class="btn primary" href="#/new/SI">New sales invoice</a>
      <a class="btn" href="#/new/RV">Receipt</a>
      <a class="btn" href="#/new/PI">Purchase invoice</a>
      <a class="btn" href="#/statement">Statement</a>
      <a class="btn" href="#/import">Import Excel / AI</a>
    </div>
    <h2>Pending drafts <span class="muted">(${drafts.length})</span></h2>
    ${docTable(drafts.slice(-15).reverse())}
    <h2>Latest posted</h2>
    ${docTable(posted.sort((a, b) => (b.postedAt || '').localeCompare(a.postedAt || '')).slice(0, 12))}
    ${S.items.length ? '' : `<div class="note" style="margin-top:20px">Start here: add items and customers in <a href="#/items">Items</a> and <a href="#/customers">Customers</a>, or import them from Excel in <a href="#/import">Import</a>.</div>`}`;
};
const kpi = (label, value, href) => `<${href ? `a href="${href}"` : 'div'} class="card kpi"><div class="label">${label}</div><div class="value">${value}</div></${href ? 'a' : 'div'}>`;

function docTable(docs) {
  if (!docs.length) return '<p class="muted">Nothing here.</p>';
  return `<div class="tablewrap"><table class="t"><thead><tr><th>Number</th><th>Type</th><th>Date</th><th>Party</th><th>Ref.</th><th class="n">Total</th><th>Status</th></tr></thead><tbody>
    ${docs.map((d) => `<tr style="cursor:pointer" onclick="location.hash='#/doc/${d.id}'">
      <td><b>${esc(docLabel(d))}</b>${d.backdated ? ' <span class="pill bad">Backdated</span>' : ''}</td><td>${DOC_TYPES[d.type].name}</td><td>${esc(d.date)}</td>
      <td dir="auto">${esc(partyById(d.partyId)?.name || '')}</td><td>${esc(d.reference || '')}</td>
      <td class="n">${d.status === 'draft' ? money(draftTotalC(d)) : money(d.totalC)}</td><td><span class="pill ${d.status}">${d.status}</span></td></tr>`).join('')}
  </tbody></table></div>`;
}
function draftTotalC(d) {
  if (!DOC_TYPES[d.type].lines) return toCents(d.amount);
  return computeTotals(d.lines || [], { vatRate: S.settings.vatRate, pricesIncludeVat: S.settings.pricesIncludeVat, invoiceDiscount: d.invoiceDiscount }).totalC;
}

// ---------- documents ----------
routes.new = async (type) => {
  if (!DOC_TYPES[type]) throw new Error('Unknown document type');
  const doc = { type, date: today(), partyId: '', reference: '', notes: '', lines: [], invoiceDiscount: 0, amount: '', method: 'cash', cashAccount: '1100' };
  if (DOC_TYPES[type].lines) doc.lines = [blankLine()];
  editor(doc);
};
routes.doc = async (id) => {
  const d = await db.get('docs', id);
  if (!d) throw new Error('Document not found');
  if (d.status === 'draft') editor(d); else viewDoc(d);
};
routes.docs = async () => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const type = q.get('type') || '', status = q.get('status') || '';
  const list = S.docs.filter((d) => (!type || d.type === type) && (!status || d.status === status))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || '').localeCompare(a.number || ''));
  $('#main').innerHTML = `<h1>All documents</h1><p class="sub">Nothing is ever deleted. Voided documents stay visible with their reversal.</p>
    <div class="row" style="margin-bottom:16px">
      <label class="f">Type<select id="ft"><option value="">All</option>${Object.entries(DOC_TYPES).map(([k, v]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
      <label class="f">Status<select id="fs"><option value="">All</option>${['draft', 'posted', 'voided'].map((s) => `<option ${s === status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="f grow">Search<input id="fq" placeholder="Number, party, reference"></label>
    </div><div id="dl">${docTable(list)}</div>`;
  const apply = () => { location.hash = `#/docs?type=${$('#ft').value}&status=${$('#fs').value}`; };
  $('#ft').onchange = apply; $('#fs').onchange = apply;
  $('#fq').oninput = (e) => {
    const s = e.target.value.toLowerCase();
    $('#dl').innerHTML = docTable(list.filter((d) => [d.number, partyById(d.partyId)?.name, d.reference].join(' ').toLowerCase().includes(s)));
  };
};

const blankLine = () => ({ itemId: '', qty: '', bonus: '', price: '', disc: '', batch: '', expiry: '' });

function editor(doc) {
  const t = DOC_TYPES[doc.type];
  const partyKind = t.party === 'supplier' ? 'supplier' : 'customer';
  const parties = S.parties.filter((p) => t.party === 'any' || p.kind === partyKind);
  const itemsList = S.items.filter((i) => i.active !== false);
  $('#main').innerHTML = `
    <h1>${t.name} <span class="pill draft">${doc.id ? 'Draft' : 'New'}</span></h1>
    <p class="sub">Drafts can be edited freely. Posting gives the permanent number and locks the document.</p>
    <datalist id="dlItems">${itemsList.map((i) => `<option value="${esc(i.code)} — ${esc(i.name)}">`).join('')}</datalist>
    <datalist id="dlParties">${parties.map((p) => `<option value="${esc(partyLabel(p))}">`).join('')}</datalist>
    <div class="row">
      ${t.party !== 'none' ? `<label class="f grow">${partyKind === 'supplier' ? 'Supplier' : 'Customer'}<input id="party" list="dlParties" dir="auto" placeholder="Type code or name" value="${esc(partyLabel(partyById(doc.partyId)))}"></label>` : ''}
      <label class="f">Date<input id="date" type="date" value="${esc(doc.date)}"></label>
      <label class="f">Reference no. (optional)<input id="ref" value="${esc(doc.reference || '')}"></label>
      ${doc.type === 'SI' ? `<label class="f">Salesman<input id="salesman" value="${esc(doc.salesman || '')}"></label>` : ''}
    </div>
    <div id="partyInfo" class="muted" style="margin:10px 0 0"></div>
    ${t.lines ? linesUI(doc) : voucherUI(doc)}
    <label class="f" style="margin-top:16px">Notes<input id="notes" dir="auto" value="${esc(doc.notes || '')}"></label>
    <div class="actions">
      <button class="btn" id="save">Save draft</button>
      <button class="btn primary" id="post">Post</button>
      <button class="btn primary" id="postprint">Post &amp; print original</button>
      <button class="btn" id="printdraft">Print draft</button>
      ${t.lines ? '<button class="btn" id="smart">Smart entry (AI / paste)</button>' : ''}
    </div>`;

  const readDoc = () => {
    const d = { ...doc, date: $('#date').value, reference: $('#ref').value.trim(), notes: $('#notes').value.trim() };
    if ($('#salesman')) d.salesman = $('#salesman').value.trim();
    if ($('#party')) {
      const v = $('#party').value.trim();
      const p = parties.find((x) => partyLabel(x) === v || x.code === v);
      d.partyId = p ? p.id : '';
    }
    if (t.lines) {
      d.lines = $$('#lines tbody tr').map((tr) => {
        const g = (k) => $(`[data-k="${k}"]`, tr).value.trim();
        const it = findItem(g('item'));
        return { itemId: it?.id || '', itemText: g('item'), qty: num(g('qty')), bonus: num(g('bonus')), price: num(g('price')), disc: num(g('disc')), batch: g('batch'), expiry: g('expiry') };
      }).filter((l) => l.itemId || l.qty || l.bonus);
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
      if (forPost && !d.lines.length) throw new Error('Add at least one line');
    } else if (forPost && !(d.amount > 0)) throw new Error('Amount must be greater than zero');
    if (['OB', 'OS'].includes(d.type) && !isAdmin()) throw new Error('Opening balances are entered by the admin');
  };
  const save = async (forPost) => { const d = readDoc(); validate(d, forPost); const r = await db.saveDraft(d, S.user); doc.id = r.id; return r; };
  $('#save').onclick = () => guard(async () => { const r = await save(false); toast('Draft saved'); go('#/doc/' + r.id); });
  const doPost = async (andPrint) => {
    const r = await save(true);
    const p = partyById(r.partyId);
    if (r.type === 'SI' && p?.creditLimit) {
      const after = (await partyBalanceC(p.id)) + draftTotalC(r);
      if (after > toCents(p.creditLimit) && !confirm(`Credit limit ${fmt(p.creditLimit)} will be exceeded (balance after: ${money(after)}). Post anyway?`)) return;
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
    if (andPrint) await printDoc(posted);
    go('#/doc/' + posted.id);
  };
  $('#post').onclick = () => guard(() => doPost(false));
  $('#postprint').onclick = () => guard(() => doPost(true));
  $('#printdraft').onclick = () => guard(async () => { const r = await save(false); await printDoc(r); });

  if ($('#party')) {
    const info = async () => {
      const v = $('#party').value.trim();
      const p = parties.find((x) => partyLabel(x) === v || x.code === v);
      if (!p) { $('#partyInfo').textContent = ''; return; }
      const bal = await partyBalanceC(p.id);
      $('#partyInfo').innerHTML = `Balance <b>${money(bal)}</b>${p.creditLimit ? ` · Credit limit ${fmt(p.creditLimit)} · Remaining <b>${money(toCents(p.creditLimit) - bal)}</b>` : ''}${p.region ? ` · ${REGIONS[p.region]}` : ''}`;
    };
    $('#party').addEventListener('change', info); info();
  }
  if (t.lines) wireLines(doc);
  else {
    const m = () => { const c = $('#method').value === 'cheque'; $$('.cheque').forEach((x) => (x.style.display = c ? '' : 'none')); if (c && $('#cashAccount').value === '1100') $('#cashAccount').value = '1120'; };
    $('#method').onchange = m; m();
    const w = () => { const a = num($('#amount').value); $('#amtWords').textContent = a > 0 ? amountInWords(a) : ''; };
    $('#amount').oninput = w; w();
  }
  $('#smart') && ($('#smart').onclick = () => smartEntry(doc, readDoc));
}

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
    return `<tr>
      <td class="item"><input data-k="item" list="dlItems" dir="auto" value="${esc(it ? `${it.code} — ${it.name}` : l.itemText || '')}" placeholder="Code or name"></td>
      <td><input data-k="batch" value="${esc(l.batch)}" placeholder="Batch" style="width:100px"></td>
      <td><input data-k="expiry" type="month" value="${esc(l.expiry)}" style="width:150px"></td>
      <td class="num"><input data-k="qty" inputmode="decimal" value="${esc(l.qty)}" style="width:90px"></td>
      <td class="num"><input data-k="bonus" inputmode="decimal" value="${esc(l.bonus)}" style="width:80px"></td>
      <td class="num"><input data-k="price" inputmode="decimal" value="${esc(l.price)}" style="width:100px"></td>
      <td class="num"><input data-k="disc" inputmode="decimal" value="${esc(l.disc)}" placeholder="%" style="width:70px"></td>
      <td class="n amt"></td>
      <td><button class="btn small" data-del title="Remove line from draft">×</button></td></tr>`;
  };
  return `<div class="tablewrap" style="margin-top:18px"><table class="t lines" id="lines"><thead><tr>
    <th>Item</th><th>Batch</th><th>Expiry</th><th class="n">Qty</th><th class="n">Bonus</th><th class="n">Price</th><th class="n">Disc %</th><th class="n">Amount</th><th></th></tr></thead>
    <tbody>${doc.lines.map(row).join('')}</tbody></table></div>
    <div class="row" style="margin-top:10px"><button class="btn small" id="addline">+ Line</button><span class="muted" style="font-size:.85em">Enter moves to the next field. Enter on the last field adds a line.</span></div>
    <div class="row" style="margin-top:16px;align-items:flex-start">
      <label class="f">Invoice discount (₪)<input id="invdisc" inputmode="decimal" value="${esc(doc.invoiceDiscount || '')}" style="width:160px"></label>
      <div class="totals card" id="totals"></div>
    </div>
    <template id="rowTpl">${row(blankLine())}</template>`;
}

function wireLines(doc) {
  const tbody = $('#lines tbody');
  const recalc = () => {
    const lines = $$('tr', tbody).map((tr) => ({ qty: num($('[data-k=qty]', tr).value) || 0, bonus: num($('[data-k=bonus]', tr).value) || 0, price: num($('[data-k=price]', tr).value) || 0, disc: num($('[data-k=disc]', tr).value) || 0 }));
    const tot = computeTotals(lines, { vatRate: S.settings.vatRate, pricesIncludeVat: S.settings.pricesIncludeVat, invoiceDiscount: num($('#invdisc').value) || 0 });
    $$('tr', tbody).forEach((tr, i) => { $('.amt', tr).textContent = tot.lines[i].amountC ? money(tot.lines[i].amountC) : ''; });
    $('#totals').innerHTML = `
      <div><span>Lines</span><span>${lines.filter((l) => l.qty || l.bonus).length}</span></div>
      <div><span>Total qty / bonus</span><span>${fmt(tot.qtyTotal, 0)} / ${fmt(tot.bonusTotal, 0)}</span></div>
      <div><span>Subtotal</span><span>${money(tot.subtotalC)}</span></div>
      ${tot.discC ? `<div><span>Invoice discount</span><span>−${money(tot.discC)}</span></div>` : ''}
      <div><span>Net before VAT</span><span>${money(tot.netC)}</span></div>
      <div><span>VAT ${S.settings.vatRate}%${S.settings.pricesIncludeVat ? ' (included)' : ''}</span><span>${money(tot.vatC)}</span></div>
      <div class="grand"><span>Total ₪</span><span>${money(tot.totalC)}</span></div>
      <div class="words">${esc(amountInWords(fromCents(tot.totalC)))}</div>`;
  };
  const addRow = () => { tbody.insertAdjacentHTML('beforeend', $('#rowTpl').innerHTML); const tr = tbody.lastElementChild; $('[data-k=item]', tr).focus(); return tr; };
  tbody.addEventListener('input', recalc);
  tbody.addEventListener('change', (e) => {
    if (e.target.dataset.k !== 'item') return;
    const tr = e.target.closest('tr'); const it = findItem(e.target.value);
    if (it) { const pr = $('[data-k=price]', tr); if (!pr.value) pr.value = defaultPrice(it, doc.type); $('[data-k=qty]', tr).focus(); }
    recalc();
  });
  tbody.addEventListener('click', (e) => { if (e.target.dataset.del !== undefined) { e.target.closest('tr').remove(); if (!tbody.children.length) addRow(); recalc(); } });
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const inputs = $$('input', tbody); const i = inputs.indexOf(e.target);
    if (i === inputs.length - 1) addRow(); else inputs[i + 1].focus();
  });
  $('#addline').onclick = () => addRow();
  $('#invdisc').oninput = recalc;
  recalc();
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
    <p class="muted">Paste JSON produced by Claude, ChatGPT or Gemini (see the prompt on the Import page), or simple lines like <code>ITM-0001 100 +20 @12.5</code> (code, qty, +bonus, @price).</p>
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
    <h1>${t.name} ${esc(d.number)} <span class="pill ${d.status}">${d.status}</span>${d.backdated ? ' <span class="pill bad">Backdated</span>' : ''}</h1>
    <p class="sub">${esc(d.date)} · ${esc(partyLabel(p))}${d.reference ? ` · Ref. ${esc(d.reference)}` : ''} · posted by ${esc(d.postedBy)} ${esc((d.postedAt || '').slice(0, 16).replace('T', ' '))}</p>
    ${d.status === 'voided' ? `<div class="note bad">Voided by ${esc(d.voidedBy)} on ${esc(d.voidedAt?.slice(0, 10))}: ${esc(d.voidReason)}. A reversing entry was posted; the number stays used.</div>` : ''}
    ${t.lines ? `<div class="tablewrap" style="margin-top:16px"><table class="t"><thead><tr><th>Code</th><th>Item</th><th>Batch</th><th>Expiry</th><th class="n">Qty</th><th class="n">Bonus</th><th class="n">Price</th><th class="n">Disc %</th><th class="n">Amount</th></tr></thead><tbody>
      ${tot.lines.map((l) => { const it = itemById(l.itemId) || {}; return `<tr><td>${esc(it.code)}</td><td dir="auto">${esc(it.name)}</td><td>${esc(l.batch)}</td><td>${esc(l.expiry)}</td><td class="n">${fmt(l.qty || 0, 0)}</td><td class="n">${l.bonus ? fmt(l.bonus, 0) : ''}</td><td class="n">${fmt(l.price || 0, 3)}</td><td class="n">${l.disc ? l.disc + '%' : ''}</td><td class="n">${money(l.amountC)}</td></tr>`; }).join('')}
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
      <button class="btn primary" id="printBtn">${prints.length ? `Print copy ${prints.length + 1}` : 'Print original'}</button>
      ${d.status === 'posted' && isAdmin() ? '<button class="btn danger" id="void">Void (reversing entry)</button>' : ''}
      ${d.status === 'posted' && !isAdmin() ? '<span class="muted">Only the admin can void.</span>' : ''}
    </div>
    <h2>Print history</h2>
    ${prints.length ? `<table class="t"><tbody>${prints.map((x) => `<tr><td>${x.copyNo === 1 ? '<b>Original</b>' : 'Copy ' + x.copyNo}</td><td>${esc(x.user)}</td><td>${esc(x.at.slice(0, 16).replace('T', ' '))}</td><td>${esc(x.reason || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Not printed yet. The first print will be marked Original, once only.</p>'}`;
  $('#printBtn').onclick = () => guard(async () => {
    let reason = '';
    if (prints.length && isAdmin() && !prints.some((x) => x.copyNo > 1) && confirm('Was the original lost (printer jam, damaged)? Press OK to record a reason; it still prints as a Copy.')) reason = prompt('Reason:') || '';
    await printDoc(d, reason); render();
  });
  $('#void') && ($('#void').onclick = () => guard(async () => {
    const reason = prompt(`Void ${d.number}? A reversing entry will be posted and the number stays used.\n\nReason:`);
    if (!reason) return;
    await db.voidDoc(d.id, reason, S.user); toast('Voided with reversing entry'); render();
  }));
}

// ---------- printing ----------
async function printDoc(d, reason = '') {
  const { label, copyNo } = await db.logPrint(d.id, S.user, 'print', reason);
  const t = DOC_TYPES[d.type];
  const p = partyById(d.partyId) || {};
  const s = S.settings;
  const opt = { vatRate: d.settingsAtPost?.vatRate ?? s.vatRate, pricesIncludeVat: d.settingsAtPost?.pricesIncludeVat ?? s.pricesIncludeVat, invoiceDiscount: d.invoiceDiscount };
  const tot = t.lines ? computeTotals(d.lines, opt) : { totalC: toCents(d.amount) };
  const stamp = label === 'ORIGINAL' ? 'ORIGINAL · أصلية' : label === 'COPY' ? `COPY ${copyNo} · نسخة ${copyNo}` : 'DRAFT · مسودة';
  const ar = { SI: 'فاتورة ضريبية', SR: 'مرتجع مبيعات', PI: 'فاتورة مشتريات', PR: 'مرتجع مشتريات', RV: 'سند قبض', PV: 'سند صرف', CN: 'إشعار دائن', DN: 'إشعار مدين', OB: 'رصيد افتتاحي', OS: 'بضاعة أول المدة' }[d.type];
  $('#printArea').innerHTML = `<div class="doc-print">
    ${label === 'DRAFT' ? '<div class="wm">مسودة</div>' : ''}
    <div class="ph"><div><div class="co" dir="auto">${esc(s.companyName)}</div>${s.companyNameAr ? `<div dir="rtl">${esc(s.companyNameAr)}</div>` : ''}
      <div>${esc(s.address)} ${s.phone ? '· ' + esc(s.phone) : ''}</div>${s.taxNo ? `<div>Licensed dealer no. / رقم المشتغل: ${esc(s.taxNo)}</div>` : ''}</div>
      <div class="title"><div class="t1">${t.name} · ${ar}</div><div style="font-size:13pt"><b>${esc(d.number || 'DRAFT')}</b></div><div>${esc(d.date)}</div><div class="stamp">${stamp}</div></div></div>
    ${t.party !== 'none' ? `<div class="party"><div><b>${p.kind === 'supplier' ? 'Supplier · المورد' : 'Customer · الزبون'}:</b> <span dir="auto">${esc(p.code)} — ${esc(p.name)}</span></div>
      <div><b>Ref.</b> ${esc(d.reference || '—')}</div><div dir="auto">${esc(p.address || '')} ${p.region ? '· ' + REGIONS[p.region] : ''}</div><div>${p.taxNo ? 'Tax no. ' + esc(p.taxNo) : ''} ${d.salesman ? '· Salesman ' + esc(d.salesman) : ''}</div></div>` : ''}
    ${t.lines ? `<table><thead><tr><th>Code</th><th>Item · البيان</th><th class="n">Qty · كمية</th><th class="n">Bonus · بونص</th><th class="n">Price · سعر</th><th class="n">Disc · خصم</th><th class="n">Amount · المجموع</th></tr></thead><tbody>
      ${tot.lines.map((l) => { const it = itemById(l.itemId) || {}; return `<tr><td>${esc(it.code)}</td><td dir="auto">${esc(it.name)}${l.batch || l.expiry ? `<div class="batch">Batch ${esc(l.batch || '—')} · Exp. ${esc(l.expiry || '—')}</div>` : ''}</td>
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
  </div>`;
  document.body.classList.add('printing');
  setTimeout(() => { window.print(); document.body.classList.remove('printing'); }, 50);
}

// ---------- items ----------
routes.items = async () => {
  const moves = await db.all('stock');
  const oh = stockOnHand(moves);
  $('#main').innerHTML = `<h1>Items</h1><p class="sub">${S.items.length} items. Codes are permanent. Items are never deleted, only deactivated.</p>
    <div class="actions">${isAdmin() ? '<button class="btn primary" id="add">Add item</button>' : '<span class="muted">Only the admin adds or edits items.</span>'}<input id="q" placeholder="Search" class="grow" style="max-width:360px"></div>
    <div class="tablewrap"><table class="t"><thead><tr><th>Code</th><th>Name</th><th>Brand</th><th>Category</th><th>Unit</th><th class="n">Buy</th><th class="n">Public</th><th class="n">Pharmacist</th><th class="n">On hand</th><th></th></tr></thead><tbody id="tb">
    ${S.items.map((i) => `<tr data-s="${esc((i.code + ' ' + i.name + ' ' + (i.brand || '')).toLowerCase())}"><td><b>${esc(i.code)}</b></td><td dir="auto">${esc(i.name)}${i.active === false ? ' <span class="pill">inactive</span>' : ''}</td><td>${esc(i.brand || '')}</td><td>${esc(i.category || '')}</td><td>${esc(i.unit || '')}</td>
      <td class="n">${fmt(i.buyPrice || 0, 3)}</td><td class="n">${fmt(i.pricePublic || 0, 3)}</td><td class="n">${fmt(i.pricePharmacist || 0, 3)}</td><td class="n">${fmt(oh[i.id]?.qty || 0, 0)}</td>
      <td>${isAdmin() ? `<button class="btn small" data-edit="${i.id}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  $('#q').oninput = (e) => { const s = e.target.value.toLowerCase(); $$('#tb tr').forEach((tr) => (tr.style.display = tr.dataset.s.includes(s) ? '' : 'none')); };
  $('#add') && ($('#add').onclick = () => itemForm({}));
  $$('[data-edit]').forEach((b) => (b.onclick = () => itemForm(itemById(b.dataset.edit))));
};
function itemForm(it) {
  const dlg = document.createElement('dialog');
  const f = (k, label, type = 'text') => `<label class="f">${label}<input name="${k}" type="${type}" ${type === 'number' ? 'step="any"' : ''} dir="auto" value="${esc(it[k] ?? '')}" ${k === 'code' && it.id ? 'readonly' : ''}></label>`;
  dlg.innerHTML = `<h2 style="margin-top:0">${it.id ? 'Edit item' : 'New item'}</h2><form method="dialog" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    ${f('code', 'Code (permanent)')}${f('name', 'Name')}${f('brand', 'Brand / company')}${f('category', 'Category')}${f('unit', 'Unit')}${f('barcode', 'Barcode')}
    ${f('buyPrice', 'Buy price', 'number')}${f('pricePublic', 'Public price', 'number')}${f('pricePharmacist', 'Pharmacist price', 'number')}
    <label class="f">Active<select name="active"><option value="true">Yes</option><option value="false" ${it.active === false ? 'selected' : ''}>No</option></select></label>
    <div class="actions" style="grid-column:1/-1"><button class="btn primary" value="save">Save</button><button class="btn" value="cancel">Cancel</button></div></form>`;
  document.body.appendChild(dlg); dlg.showModal();
  if (!it.id) $('[name=code]', dlg).value = nextPartyCode('ITM', S.items.map((i) => i.code));
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
    <div class="actions">${isAdmin() ? `<button class="btn primary" id="add">Add ${kind}</button>` : ''}<input id="q" placeholder="Search" style="max-width:360px">
    ${kind === 'customer' ? `<select id="reg"><option value="">All regions</option>${Object.entries(REGIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>` : ''}</div>
    <div class="tablewrap"><table class="t"><thead><tr><th>Code</th><th>Name</th><th>Phone</th>${kind === 'customer' ? '<th>Region</th><th>Type</th><th class="n">Credit limit</th>' : ''}<th class="n">Balance</th><th></th></tr></thead><tbody id="tb">
    ${list.map((p) => `<tr data-s="${esc((p.code + ' ' + p.name + ' ' + (p.phone || '')).toLowerCase())}" data-r="${p.region || ''}"><td><b>${esc(p.code)}</b></td><td dir="auto">${esc(p.name)}</td><td>${esc(p.phone || '')}</td>
      ${kind === 'customer' ? `<td>${REGIONS[p.region] || ''}</td><td>${CUSTOMER_TYPES[p.type] || ''}</td><td class="n">${p.creditLimit ? fmt(p.creditLimit) : ''}</td>` : ''}
      <td class="n"><b>${money(bal[p.id] || 0)}</b></td><td style="white-space:nowrap"><a class="btn small" href="#/statement/${p.id}">Statement</a> ${isAdmin() ? `<button class="btn small" data-edit="${p.id}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  const filt = () => { const s = $('#q').value.toLowerCase(); const r = $('#reg')?.value || ''; $$('#tb tr').forEach((tr) => (tr.style.display = tr.dataset.s.includes(s) && (!r || tr.dataset.r === r) ? '' : 'none')); };
  $('#q').oninput = filt; $('#reg') && ($('#reg').onchange = filt);
  $('#add') && ($('#add').onclick = () => partyForm({ kind }));
  $$('[data-edit]').forEach((b) => (b.onclick = () => partyForm(partyById(b.dataset.edit))));
}
function partyForm(p) {
  const dlg = document.createElement('dialog');
  const f = (k, label, type = 'text') => `<label class="f">${label}<input name="${k}" type="${type}" ${type === 'number' ? 'step="any"' : ''} dir="auto" value="${esc(p[k] ?? '')}" ${k === 'code' && p.id ? 'readonly' : ''}></label>`;
  const cust = p.kind === 'customer';
  dlg.innerHTML = `<h2 style="margin-top:0">${p.id ? 'Edit' : 'New'} ${p.kind}</h2><form method="dialog" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    ${f('code', 'Code (permanent)')}${f('name', 'Name')}${f('phone', 'Phone')}${f('address', 'Address')}${f('taxNo', 'Tax / licensed dealer no.')}
    ${cust ? `<label class="f">Region<select name="region">${Object.entries(REGIONS).map(([k, v]) => `<option value="${k}" ${p.region === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f">Type<select name="type">${Object.entries(CUSTOMER_TYPES).map(([k, v]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${f('creditLimit', 'Credit limit (₪)', 'number')}${f('guarantor', 'Guarantor')}` : ''}
    ${p.id ? '' : f('openingBalance', 'Opening balance (₪)', 'number')}
    <div class="actions" style="grid-column:1/-1"><button class="btn primary" value="save">Save</button><button class="btn" value="cancel">Cancel</button></div></form>`;
  document.body.appendChild(dlg); dlg.showModal();
  if (!p.id) $('[name=code]', dlg).value = nextPartyCode(cust ? 'CUS' : 'SUP', S.parties.filter((x) => x.kind === p.kind).map((x) => x.code));
  dlg.addEventListener('close', () => guard(async () => {
    if (dlg.returnValue !== 'save') return dlg.remove();
    const fd = Object.fromEntries(new FormData($('form', dlg)));
    dlg.remove();
    if (!fd.name || !fd.code) throw new Error('Code and name are required');
    if (!p.id && S.parties.some((x) => x.code.toLowerCase() === fd.code.toLowerCase())) throw new Error('This code already exists');
    const sim = similarNames(fd.name, S.parties.filter((x) => x.id !== p.id));
    if (sim.length && !confirm(`Similar name exists: ${sim.map((x) => x.code + ' ' + x.name).join(', ')}. Add anyway?`)) return;
    const ob = Number(fd.openingBalance || 0); delete fd.openingBalance;
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
      <button class="btn primary" id="show">Show</button><button class="btn" id="pr">Print</button><button class="btn" id="xl">Excel</button></div><div id="out" style="margin-top:20px"></div>`;
  $('#show').onclick = () => { const p = all.find((x) => partyLabel(x) === $('#p').value.trim()); if (p) location.hash = `#/statement/${p.id}?from=${$('#from').value}&to=${$('#to').value}`; };
  if (!party) return;
  const st = statement(await ledger(), S.docs, party.id, party.kind, { from: q.get('from') || '', to: q.get('to') || '' });
  const rows = st.rows.map((r) => [r.date, r.number || r.doc?.number, DOC_TYPES[r.type]?.name + (r.reversal ? ' (void reversal)' : ''), r.doc?.reference || '', r.debitC, r.creditC, r.balanceC]);
  $('#out').innerHTML = `<div class="tablewrap"><table class="t"><thead><tr><th>Date</th><th>Document</th><th>Type</th><th>Ref.</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr></thead><tbody>
    ${st.opening ? `<tr><td colspan="6"><i>Opening balance</i></td><td class="n">${money(st.opening)}</td></tr>` : ''}
    ${st.rows.map((r) => `<tr><td>${esc(r.date)}</td><td><a href="#/doc/${r.docId}">${esc(r.number || '')}</a></td><td>${esc(DOC_TYPES[r.type]?.name || '')}${r.reversal ? ' <span class="pill voided">reversal</span>' : ''}</td><td>${esc(r.doc?.reference || '')}</td>
      <td class="n">${r.debitC ? money(r.debitC) : ''}</td><td class="n">${r.creditC ? money(r.creditC) : ''}</td><td class="n"><b>${money(r.balanceC)}</b></td></tr>`).join('')}
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
    <div class="actions"><button class="btn" id="pr">Print</button></div>`;
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
    <div class="actions"><button class="btn" id="xl">Excel</button><button class="btn" id="pr">Print</button></div>`;
  $('#xl').onclick = () => toExcel('inventory.xlsx', [['Code', 'Item', 'In', 'Bonus in', 'Out', 'Bonus out', 'On hand', 'Avg cost', 'Value'], ...rows.map(({ i, s, avg, value }) => [i.code, i.name, s.in, s.bonusIn, s.out, s.bonusOut, s.qty, avg / 100, value / 100])]);
  $('#pr').onclick = () => printHtml(`<h2>Inventory · جرد البضاعة</h2><p>${today()}</p>` + $('.tablewrap').outerHTML);
};

routes.sales = async () => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const from = q.get('from') || today().slice(0, 8) + '01', to = q.get('to') || today(), by = q.get('by') || 'item';
  const docs = S.docs.filter((d) => d.status === 'posted' && (d.type === 'SI' || d.type === 'SR') && d.date >= from && d.date <= to);
  const agg = {};
  for (const d of docs) {
    const sign = d.type === 'SI' ? 1 : -1;
    const tot = computeTotals(d.lines, { vatRate: d.settingsAtPost?.vatRate ?? 16, pricesIncludeVat: d.settingsAtPost?.pricesIncludeVat ?? true, invoiceDiscount: d.invoiceDiscount });
    const factor = tot.subtotalC ? tot.totalC / tot.subtotalC : 0;
    const p = partyById(d.partyId) || {};
    for (const l of tot.lines) {
      const it = itemById(l.itemId) || {};
      const key = by === 'item' ? it.code : by === 'region' ? REGIONS[p.region] || '—' : by === 'type' ? CUSTOMER_TYPES[p.type] || '—' : by === 'customer' ? p.code + ' ' + p.name : d.date;
      const a = (agg[key] ||= { key, name: by === 'item' ? it.name : '', qty: 0, bonus: 0, amountC: 0 });
      a.qty += sign * (Number(l.qty) || 0); a.bonus += sign * (Number(l.bonus) || 0); a.amountC += sign * Math.round(l.amountC * factor);
    }
  }
  const rows = Object.values(agg).sort((a, b) => b.amountC - a.amountC);
  const tsum = rows.reduce((s, r) => ({ q: s.q + r.qty, b: s.b + r.bonus, a: s.a + r.amountC }), { q: 0, b: 0, a: 0 });
  $('#main').innerHTML = `<h1>Sales report</h1><p class="sub">Posted sales minus returns, VAT included.</p>
    <div class="row"><label class="f">From<input id="from" type="date" value="${from}"></label><label class="f">To<input id="to" type="date" value="${to}"></label>
    <label class="f">Group by<select id="by">${[['item', 'Item'], ['customer', 'Customer'], ['region', 'Region'], ['type', 'Customer type'], ['date', 'Date']].map(([k, v]) => `<option value="${k}" ${k === by ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <button class="btn primary" id="show">Show</button><button class="btn" id="xl">Excel</button><button class="btn" id="pr">Print</button></div>
    <div class="tablewrap" style="margin-top:20px"><table class="t"><thead><tr><th>${by}</th>${by === 'item' ? '<th>Name</th>' : ''}<th class="n">Qty</th><th class="n">Bonus</th><th class="n">Total qty</th><th class="n">Total ₪</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td dir="auto"><b>${esc(r.key)}</b></td>${by === 'item' ? `<td dir="auto">${esc(r.name)}</td>` : ''}<td class="n">${fmt(r.qty, 0)}</td><td class="n">${fmt(r.bonus, 0)}</td><td class="n">${fmt(r.qty + r.bonus, 0)}</td><td class="n">${money(r.amountC)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td ${by === 'item' ? 'colspan="2"' : ''}>Totals</td><td class="n">${fmt(tsum.q, 0)}</td><td class="n">${fmt(tsum.b, 0)}</td><td class="n">${fmt(tsum.q + tsum.b, 0)}</td><td class="n">${money(tsum.a)}</td></tr></tfoot></table></div>`;
  $('#show').onclick = () => (location.hash = `#/sales?from=${$('#from').value}&to=${$('#to').value}&by=${$('#by').value}`);
  $('#xl').onclick = () => toExcel(`sales-${by}.xlsx`, [[by, 'Name', 'Qty', 'Bonus', 'Total qty', 'Total ILS'], ...rows.map((r) => [r.key, r.name, r.qty, r.bonus, r.qty + r.bonus, r.amountC / 100])]);
  $('#pr').onclick = () => printHtml(`<h2>Sales report · تقرير المبيعات</h2><p>${from} → ${to} · by ${by}</p>` + $('.tablewrap').outerHTML);
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
    const code = String(it.code || nextPartyCode('ITM', S.items.map((i) => i.code)));
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
    const code = String(c.code || nextPartyCode(kind === 'customer' ? 'CUS' : 'SUP', S.parties.filter((x) => x.kind === kind).map((x) => x.code)));
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
      <button class="btn" id="saveMe">Save</button></div>
    <h2>Role</h2><p class="muted">Admin adds items, customers and suppliers, voids documents, imports and restores. Accountant enters and posts documents.</p>
    <div class="actions">${isAdmin() ? '<button class="btn" id="toAcc">Switch to accountant</button>' : '<button class="btn primary" id="toAdmin">Switch to admin</button>'}</div>
    <h2>Company</h2><form id="co" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
      ${f('companyName', 'Company name')}${f('companyNameAr', 'Company name (Arabic)')}${f('taxNo', 'Licensed dealer no.')}${f('address', 'Address')}${f('phone', 'Phone')}${f('branch', 'Branch / vehicle code (series prefix)')}
      ${f('vatRate', 'VAT %', 'number')}<label class="f">Prices include VAT<select name="pricesIncludeVat" ${isAdmin() ? '' : 'disabled'}><option value="true">Yes</option><option value="false" ${s.pricesIncludeVat ? '' : 'selected'}>No</option></select></label></form>
    ${isAdmin() ? `<div class="actions"><button class="btn primary" id="saveCo">Save company</button></div><h2>Admin PIN</h2><div class="row"><label class="f">New PIN<input id="pin" type="password" inputmode="numeric"></label><button class="btn" id="savePin">Set PIN</button></div>` : ''}
    <div class="note" style="margin-top:24px">This is version 0.1. Data is stored in this browser on this device. Cloud sync, real user accounts and permissions enforced by the server come in stage 3.</div>`;
  $('#saveMe').onclick = () => guard(async () => { S.user = $('#uname').value.trim() || 'User'; sessionStorage.setItem('user', S.user); await db.setSetting('fontScale', $('#size').value, S.user); toast('Saved'); render(); });
  $('#toAcc') && ($('#toAcc').onclick = () => { S.role = 'accountant'; sessionStorage.setItem('role', 'accountant'); render(); });
  $('#toAdmin') && ($('#toAdmin').onclick = () => guard(async () => {
    if (S.settings.adminPin) { const pin = prompt('Admin PIN'); if (pin !== S.settings.adminPin) throw new Error('Wrong PIN'); }
    S.role = 'admin'; sessionStorage.setItem('role', 'admin'); toast(S.settings.adminPin ? 'Admin' : 'Admin. Set a PIN now.'); render();
  }));
  $('#saveCo') && ($('#saveCo').onclick = () => guard(async () => {
    const fd = Object.fromEntries(new FormData($('#co')));
    fd.vatRate = Number(fd.vatRate); fd.pricesIncludeVat = fd.pricesIncludeVat === 'true';
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
  await db.open();
  if (!location.hash) location.hash = '#/dashboard';
  await render();
})();
