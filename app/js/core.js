// Ledger core: pure functions, no storage, no DOM. Tested in test/core.test.mjs.
// Rules locked in projects/accounting-system/README.md:
//  - posted documents never change; corrections are reversals
//  - numbers are given at posting, per series, without gaps
//  - balances and stock are always derived from ledger entries and stock moves

export const SCHEMA_VERSION = 1;

export const ACCOUNTS = {
  '1100': { name: 'Cash box', type: 'asset' },
  '1110': { name: 'Bank', type: 'asset' },
  '1120': { name: 'Cheques on hand', type: 'asset' },
  '1200': { name: 'Accounts receivable', type: 'asset' },
  '1300': { name: 'Inventory', type: 'asset' },
  '2100': { name: 'Accounts payable', type: 'liability' },
  '2200': { name: 'VAT', type: 'liability' },
  '3100': { name: 'Opening balances / equity', type: 'equity' },
  '4100': { name: 'Sales', type: 'income' },
  '4110': { name: 'Sales returns', type: 'income' },
  '4120': { name: 'Sales discounts (credit notes)', type: 'income' },
  '4200': { name: 'Other income (debit notes)', type: 'income' },
  '5100': { name: 'Cost of goods sold', type: 'expense' },
};

export const CASH_ACCOUNTS = ['1100', '1110', '1120'];

export const DOC_TYPES = {
  SI: { name: 'Sales invoice', party: 'customer', lines: true, stock: -1 },
  SR: { name: 'Sales return', party: 'customer', lines: true, stock: +1 },
  PI: { name: 'Purchase invoice', party: 'supplier', lines: true, stock: +1 },
  PR: { name: 'Purchase return', party: 'supplier', lines: true, stock: -1 },
  RV: { name: 'Receipt voucher', party: 'customer', lines: false },
  PV: { name: 'Payment voucher', party: 'supplier', lines: false },
  CN: { name: 'Credit note', party: 'customer', lines: false },
  DN: { name: 'Debit note', party: 'customer', lines: false },
  OB: { name: 'Opening balance', party: 'any', lines: false },
  OS: { name: 'Opening stock', party: 'none', lines: true, stock: +1 },
};

export const REGIONS = { gaza: 'Gaza', middle: 'Middle Area', south: 'South' };
export const CUSTOMER_TYPES = {
  pharmacy: 'Pharmacy', warehouse: 'Medical warehouse', cosmetics: 'Medical cosmetics center', other: 'Other',
};
export const PAY_METHODS = { cash: 'Cash', cheque: 'Cheque', transfer: 'Bank transfer', wallet: 'Wallet app' };

// Money is kept in agorot (integer) internally to avoid float drift.
export const toCents = (x) => Math.round((Number(x) || 0) * 100);
export const fromCents = (c) => c / 100;
export const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

export function fmt(x, digits = 2) {
  const n = Number(x) || 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// ---------- totals ----------
// lines: [{ qty, bonus, price, disc }]  disc = percent on the line
// pricesIncludeVat: prices on lines already include VAT (Gaza pharma default)
// Rounding rule (Rabee, Nov 2026): price and line amount to one decimal; the grand total to the
// nearest shekel, with exactly half going down (300.5 → 300, 300.6 → 301). VAT and net are taken
// from the rounded total, so the entry stays balanced and needs no rounding account.
export const round1 = (x) => Math.round(Math.round((Number(x) || 0) * 1000) / 100) / 10;
export const roundShekelHalfDown = (c) => { const r = ((c % 100) + 100) % 100; return r > 50 ? c - r + 100 : c - r; };
// the totals options a document uses: posted documents keep the rule they were posted with
export function docTotalsOpts(doc, settings = {}) {
  const snap = doc.settingsAtPost;
  const src = snap || settings;
  const roundTotals = doc.type !== 'OS' && !!DOC_TYPES[doc.type]?.lines && (snap ? !!snap.roundTotals : (settings.roundTotals ?? true));
  return { vatRate: src.vatRate ?? 16, pricesIncludeVat: src.pricesIncludeVat ?? true, invoiceDiscount: doc.invoiceDiscount || 0, roundTotals };
}

export function computeTotals(lines, { vatRate = 16, pricesIncludeVat = true, invoiceDiscount = 0, roundTotals = false } = {}) {
  const out = lines.map((l) => {
    const qty = Number(l.qty) || 0;
    const price = Number(l.price) || 0;
    const disc = Math.min(100, Math.max(0, Number(l.disc) || 0));
    const v = qty * price * (1 - disc / 100);
    const amountC = roundTotals ? Math.round(Math.round(v * 1000) / 100) * 10 : Math.round(v * 100);
    return { ...l, amountC };
  });
  const subtotalC = out.reduce((s, l) => s + l.amountC, 0);
  const discC = Math.min(subtotalC, Math.max(0, toCents(invoiceDiscount)));
  const grossC = subtotalC - discC;
  const r = (Number(vatRate) || 0) / 100;
  let netC, vatC, totalC, roundC = 0;
  if (pricesIncludeVat) {
    totalC = roundTotals ? roundShekelHalfDown(grossC) : grossC;
    roundC = totalC - grossC;
    vatC = Math.round((totalC * r) / (1 + r));
    netC = totalC - vatC;
  } else {
    netC = grossC;
    vatC = Math.round(netC * r);
    totalC = netC + vatC;
    if (roundTotals) { const t = roundShekelHalfDown(totalC); roundC = t - totalC; netC += roundC; totalC = t; }
  }
  // net value of each line after invoice discount and VAT, used for stock cost on purchases
  const factor = subtotalC ? netC / subtotalC : 0;
  out.forEach((l) => { l.netC = Math.round(l.amountC * factor); });
  const qtyTotal = out.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const bonusTotal = out.reduce((s, l) => s + (Number(l.bonus) || 0), 0);
  return { lines: out, subtotalC, discC, grossC, roundC, netC, vatC, totalC, qtyTotal, bonusTotal };
}

// ---------- average cost ----------
// moves: [{ itemId, qty, valueC }] ; inbound moves carry value
export function avgCostC(moves, itemId, fallbackC = 0) {
  // weighted average over real receipts; a voided receipt removes its qty and value again,
  // a voided issue (sale reversal) does not change the cost base
  let q = 0, v = 0;
  for (const m of moves) {
    if (m.itemId !== itemId) continue;
    if (!m.reversal && m.qty > 0) { q += m.qty; v += m.valueC; }
    else if (m.reversal && m.qty < 0 && m.valueC < 0) { q += m.qty; v += m.valueC; }
  }
  return q > 0 ? v / q : fallbackC;
}

// ---------- posting ----------
// Returns { entries, moves } for a document. Entries: { account, debitC, creditC, partyId }
export function buildPosting(doc, { moves = [], items = {}, settings = {} } = {}) {
  const t = DOC_TYPES[doc.type];
  if (!t) throw new Error('Unknown document type ' + doc.type);
  const entries = [];
  const sm = [];
  const E = (account, debitC, creditC, partyId = null) => {
    if (!debitC && !creditC) return;
    entries.push({ account, debitC: debitC || 0, creditC: creditC || 0, partyId });
  };
  const p = doc.partyId || null;

  if (t.lines) {
    const tot = computeTotals(doc.lines, docTotalsOpts(doc, settings));
    const r = (settings.vatRate ?? 16) / 100;
    let costC = 0;
    for (const l of tot.lines) {
      if (!l.itemId) continue;
      const units = (Number(l.qty) || 0) + (Number(l.bonus) || 0);
      if (!units) continue;
      const item = items[l.itemId] || {};
      const fallback = toCents(item.buyPrice || 0) / ((settings.pricesIncludeVat ?? true) ? 1 + r : 1);
      if (doc.type === 'PI' || doc.type === 'OS') {
        sm.push({ itemId: l.itemId, qty: units, valueC: l.netC, bonus: Number(l.bonus) || 0, batch: l.batch || '', expiry: l.expiry || '' });
      } else {
        const unitC = avgCostC(moves, l.itemId, fallback);
        const vC = Math.round(unitC * units);
        costC += vC;
        const sign = t.stock;
        sm.push({ itemId: l.itemId, qty: sign * units, valueC: sign > 0 ? vC : 0, bonus: Number(l.bonus) || 0, batch: l.batch || '', expiry: l.expiry || '' });
      }
    }
    if (doc.type === 'SI') {
      E('1200', tot.totalC, 0, p); E('4100', 0, tot.netC); E('2200', 0, tot.vatC);
      E('5100', costC, 0); E('1300', 0, costC);
    } else if (doc.type === 'SR') {
      E('4110', tot.netC, 0); E('2200', tot.vatC, 0); E('1200', 0, tot.totalC, p);
      E('1300', costC, 0); E('5100', 0, costC);
    } else if (doc.type === 'PI') {
      E('1300', tot.netC, 0); E('2200', tot.vatC, 0); E('2100', 0, tot.totalC, p);
    } else if (doc.type === 'PR') {
      // purchase returns leave at the price on the return, VAT reclaimed back
      E('2100', tot.totalC, 0, p); E('1300', 0, tot.netC); E('2200', 0, tot.vatC);
      // stock moves for PR carry no value; recompute so inventory value follows the credit
      sm.forEach((m) => { m.valueC = 0; });
    } else if (doc.type === 'OS') {
      E('1300', tot.netC, 0); E('3100', 0, tot.netC);
    }
    return { entries, moves: sm, totals: tot };
  }

  const a = toCents(doc.amount);
  if (a <= 0) throw new Error('Amount must be greater than zero');
  const cash = CASH_ACCOUNTS.includes(doc.cashAccount) ? doc.cashAccount : '1100';
  if (doc.type === 'RV') { E(cash, a, 0); E('1200', 0, a, p); }
  else if (doc.type === 'PV') { E('2100', a, 0, p); E(cash, 0, a); }
  else if (doc.type === 'CN') { E('4120', a, 0); E('1200', 0, a, p); }
  else if (doc.type === 'DN') { E('1200', a, 0, p); E('4200', 0, a); }
  else if (doc.type === 'OB') {
    // positive = they owe us (customer) / we owe them (supplier)
    if (doc.partyKind === 'supplier') { E('3100', a, 0); E('2100', 0, a, p); }
    else { E('1200', a, 0, p); E('3100', 0, a); }
  }
  return { entries, moves: sm, totals: { totalC: a } };
}

export function reverse(posting) {
  return {
    entries: posting.entries.map((e) => ({ ...e, debitC: e.creditC, creditC: e.debitC, reversal: true })),
    moves: posting.moves.map((m) => ({ ...m, qty: -m.qty, valueC: -m.valueC, reversal: true })),
  };
}

export function isBalanced(entries) {
  const d = entries.reduce((s, e) => s + e.debitC, 0);
  const c = entries.reduce((s, e) => s + e.creditC, 0);
  return d === c;
}

// ---------- numbering ----------
export function seriesKey(type, date, branch = '') {
  const yy = String(new Date(date || Date.now()).getFullYear()).slice(-2);
  return [type, branch, yy].filter(Boolean).join('-');
}
export function formatNumber(series, n) {
  return `${series}-${String(n).padStart(6, '0')}`;
}
// items and parties get plain numbers: 1001, 1002, ... (codes typed by the user are kept as they are)
export function nextNumericCode(existing, start = 1001) {
  let max = start - 1;
  for (const c of existing) if (/^\d+$/.test(String(c))) max = Math.max(max, Number(c));
  return String(max + 1);
}
export function nextPartyCode(prefix, existing) {
  let max = 0;
  for (const c of existing) {
    const m = String(c || '').match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

// ---------- reports ----------
export function trialBalance(entries) {
  const acc = {};
  for (const e of entries) {
    const a = (acc[e.account] ||= { account: e.account, debitC: 0, creditC: 0 });
    a.debitC += e.debitC; a.creditC += e.creditC;
  }
  const rows = Object.values(acc).sort((x, y) => x.account.localeCompare(y.account)).map((a) => {
    const bal = a.debitC - a.creditC;
    return { ...a, name: ACCOUNTS[a.account]?.name || a.account, balDebitC: bal > 0 ? bal : 0, balCreditC: bal < 0 ? -bal : 0 };
  });
  const tot = rows.reduce((s, r) => ({ d: s.d + r.balDebitC, c: s.c + r.balCreditC }), { d: 0, c: 0 });
  return { rows, totalDebitC: tot.d, totalCreditC: tot.c, balanced: tot.d === tot.c };
}

// statement for one party on AR (customer) or AP (supplier)
export function statement(entries, docs, partyId, kind = 'customer', { from, to } = {}) {
  const account = kind === 'supplier' ? '2100' : '1200';
  const byDoc = new Map(docs.map((d) => [d.id, d]));
  const rows = entries
    .filter((e) => e.account === account && e.partyId === partyId)
    .map((e) => ({ ...e, doc: byDoc.get(e.docId) }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.seq - b.seq);
  let bal = 0, opening = 0;
  const out = [];
  for (const r of rows) {
    const delta = kind === 'supplier' ? r.creditC - r.debitC : r.debitC - r.creditC;
    if (from && r.date < from) { opening += delta; bal += delta; continue; }
    if (to && r.date > to) continue;
    bal += delta;
    out.push({ ...r, balanceC: bal });
  }
  return { opening, rows: out, closing: bal };
}

export function stockOnHand(moves) {
  // a reversal undoes its original: it reduces the same in/out bucket instead of adding to the opposite one
  const q = {};
  for (const m of moves) {
    const s = (q[m.itemId] ||= { qty: 0, in: 0, out: 0, bonusIn: 0, bonusOut: 0 });
    s.qty += m.qty;
    const b = m.bonus || 0;
    if (!m.reversal) {
      if (m.qty > 0) { s.in += m.qty; s.bonusIn += b; } else { s.out += -m.qty; s.bonusOut += b; }
    } else if (m.qty > 0) { s.out -= m.qty; s.bonusOut -= b; }
    else { s.in -= -m.qty; s.bonusIn -= b; }
  }
  return q;
}

// gaps inside every series; numbers must run 1..n without holes
export function sequenceGaps(docs) {
  const bySeries = {};
  for (const d of docs) if (d.number) (bySeries[d.series] ||= []).push(d.seqNo);
  const gaps = [];
  for (const [s, ns] of Object.entries(bySeries)) {
    ns.sort((a, b) => a - b);
    for (let i = 0; i < ns.length; i++) if (ns[i] !== i + 1) { gaps.push({ series: s, expected: i + 1, found: ns[i] }); break; }
  }
  return gaps;
}

// ---------- similar names (for duplicate warnings) ----------
const normAr = (s) => String(s || '').toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ًٌٍَُِّْ]/g, '')
  .replace(/^(صيدليه|صيدلية|pharmacy)\s*/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
export function similarNames(name, list) {
  const a = normAr(name);
  if (!a) return [];
  return list.filter((x) => {
    const b = normAr(x.name);
    if (!b) return false;
    if (a === b) return true;
    const d = lev(a, b);
    return d <= Math.max(1, Math.floor(Math.min(a.length, b.length) / 5));
  });
}

// ---------- amount in Arabic words (shekel) ----------
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
  'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
function below1000(n) {
  const parts = [];
  const h = Math.floor(n / 100), rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const o = rest % 10, t = Math.floor(rest / 10);
      parts.push(o ? `${ONES[o]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(' و');
}
function scale(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${below1000(n)} ${few}`;
  return `${below1000(n)} ${many}`;
}
export function intToArabic(n) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'صفر';
  const parts = [];
  const bil = Math.floor(n / 1e9), mil = Math.floor((n % 1e9) / 1e6), th = Math.floor((n % 1e6) / 1e3), rest = n % 1e3;
  if (bil) parts.push(scale(bil, 'مليار', 'ملياران', 'مليارات', 'مليار'));
  if (mil) parts.push(scale(mil, 'مليون', 'مليونان', 'ملايين', 'مليون'));
  if (th) parts.push(scale(th, 'ألف', 'ألفان', 'آلاف', 'ألف'));
  if (rest) parts.push(below1000(rest));
  return parts.join(' و');
}
export function amountInWords(x) {
  const c = Math.round(Math.abs(Number(x) || 0) * 100);
  const sh = Math.floor(c / 100), ag = c % 100;
  let s = `فقط ${intToArabic(sh)} شيكل`;
  if (ag) s += ` و${intToArabic(ag)} أغورة`;
  return s + ' لا غير';
}

// ---------- AI / Excel import validation ----------
// The contract any assistant (Claude, ChatGPT, Gemini) must produce. See app/AI-IMPORT.md
export function validateImport(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['Not a JSON object'] };
  const kinds = ['items', 'customers', 'suppliers', 'invoice'];
  if (!kinds.some((k) => k in obj)) errors.push('Expected one of: ' + kinds.join(', '));
  for (const [i, it] of (obj.items || []).entries()) {
    if (!it.name) errors.push(`items[${i}]: name is required`);
    for (const f of ['buyPrice', 'pricePublic', 'pricePharmacist', 'openingQty'])
      if (it[f] != null && isNaN(Number(it[f]))) errors.push(`items[${i}].${f}: must be a number`);
  }
  for (const k of ['customers', 'suppliers'])
    for (const [i, c] of (obj[k] || []).entries()) {
      if (!c.name) errors.push(`${k}[${i}]: name is required`);
      if (c.region && !REGIONS[c.region]) errors.push(`${k}[${i}].region: use gaza, middle or south`);
      if (c.openingBalance != null && isNaN(Number(c.openingBalance))) errors.push(`${k}[${i}].openingBalance: must be a number`);
    }
  if (obj.invoice) {
    const inv = obj.invoice;
    if (!['SI', 'SR', 'PI', 'PR'].includes(inv.type || 'SI')) errors.push('invoice.type must be SI, SR, PI or PR');
    if (!Array.isArray(inv.lines) || !inv.lines.length) errors.push('invoice.lines must be a non-empty array');
    for (const [i, l] of (inv.lines || []).entries()) {
      if (!l.itemCode && !l.itemName) errors.push(`invoice.lines[${i}]: itemCode or itemName required`);
      if (!(Number(l.qty) > 0) && !(Number(l.bonus) > 0)) errors.push(`invoice.lines[${i}]: qty or bonus must be > 0`);
    }
  }
  return { ok: errors.length === 0, errors };
}
