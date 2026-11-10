import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTotals, buildPosting, reverse, isBalanced, trialBalance, statement, stockOnHand,
  sequenceGaps, amountInWords, intToArabic, similarNames, validateImport, nextPartyCode, seriesKey, formatNumber,
} from '../js/core.js';

const settings = { vatRate: 16, pricesIncludeVat: true };

test('VAT is extracted from VAT-inclusive totals (prices include VAT)', () => {
  const t = computeTotals([{ qty: 100, bonus: 50, price: 12.5, disc: 0 }], settings);
  assert.equal(t.totalC, 125000);
  assert.equal(t.vatC, Math.round(125000 * 0.16 / 1.16));
  assert.equal(t.netC + t.vatC, t.totalC);
  assert.equal(t.bonusTotal, 50);
});

test('line discount percent and invoice discount amount', () => {
  const t = computeTotals([{ qty: 10, price: 10, disc: 50 }, { qty: 1, price: 50 }], { ...settings, invoiceDiscount: 5 });
  assert.equal(t.subtotalC, 10000);
  assert.equal(t.grossC, 9500);
});

test('VAT-exclusive mode adds VAT on top', () => {
  const t = computeTotals([{ qty: 1, price: 100 }], { vatRate: 16, pricesIncludeVat: false });
  assert.equal(t.totalC, 11600);
});

test('every document type posts balanced entries, and reversals cancel out', () => {
  const items = { a: { buyPrice: 11.6 } };
  const pi = buildPosting({ type: 'PI', partyId: 's1', lines: [{ itemId: 'a', qty: 100, bonus: 25, price: 11.6 }] }, { items, settings });
  assert.ok(isBalanced(pi.entries));
  assert.equal(pi.moves[0].qty, 125);
  const moves = pi.moves;
  const si = buildPosting({ type: 'SI', partyId: 'c1', lines: [{ itemId: 'a', qty: 50, bonus: 10, price: 20 }] }, { moves, items, settings });
  assert.ok(isBalanced(si.entries));
  assert.equal(si.moves[0].qty, -60);
  const cogs = si.entries.find((e) => e.account === '5100').debitC;
  // unit cost = 100*10 net / 125 units = 8.00 ; 60 units => 480.00
  assert.equal(cogs, 48000);
  for (const type of ['SR', 'PR']) {
    const p = buildPosting({ type, partyId: 'x', lines: [{ itemId: 'a', qty: 5, price: 20 }] }, { moves, items, settings });
    assert.ok(isBalanced(p.entries), type);
  }
  for (const type of ['RV', 'PV', 'CN', 'DN', 'OB']) {
    const p = buildPosting({ type, partyId: 'x', amount: 123.45, cashAccount: '1110' }, { settings });
    assert.ok(isBalanced(p.entries), type);
  }
  const all = [...si.entries, ...reverse(si).entries];
  const tb = trialBalance(all);
  assert.ok(tb.balanced);
  assert.ok(tb.rows.every((r) => r.balDebitC === 0 && r.balCreditC === 0));
  const stock = stockOnHand([...si.moves, ...reverse(si).moves]);
  assert.equal(stock.a.qty, 0);
});

test('amount must be positive on vouchers', () => {
  assert.throws(() => buildPosting({ type: 'RV', partyId: 'c', amount: 0 }, { settings }));
});

test('customer statement runs a balance', () => {
  const docs = [{ id: 'd1' }, { id: 'd2' }];
  const entries = [
    { docId: 'd1', account: '1200', partyId: 'c', debitC: 10000, creditC: 0, date: '2026-01-01', seq: 1 },
    { docId: 'd2', account: '1200', partyId: 'c', debitC: 0, creditC: 4000, date: '2026-01-05', seq: 2 },
  ];
  const s = statement(entries, docs, 'c');
  assert.equal(s.closing, 6000);
  assert.equal(s.rows[1].balanceC, 6000);
  const s2 = statement(entries, docs, 'c', 'customer', { from: '2026-01-03' });
  assert.equal(s2.opening, 10000);
});

test('sequence gaps are detected per series', () => {
  assert.deepEqual(sequenceGaps([{ number: 'x', series: 'SI-26', seqNo: 1 }, { number: 'x', series: 'SI-26', seqNo: 2 }]), []);
  assert.equal(sequenceGaps([{ number: 'x', series: 'SI-26', seqNo: 1 }, { number: 'x', series: 'SI-26', seqNo: 3 }]).length, 1);
});

test('numbering helpers', () => {
  assert.equal(seriesKey('SI', '2026-05-08'), 'SI-26');
  assert.equal(formatNumber('SI-26', 7), 'SI-26-000007');
  assert.equal(nextPartyCode('CUS', ['CUS-0001', 'CUS-0009']), 'CUS-0010');
});

test('Arabic amount in words', () => {
  assert.equal(intToArabic(54614), 'أربعة وخمسون ألف وستمائة وأربعة عشر');
  assert.equal(intToArabic(2000), 'ألفان');
  assert.equal(intToArabic(3000), 'ثلاثة آلاف');
  assert.match(amountInWords(1769.5), /^فقط ألف وسبعمائة وتسعة وستون شيكل وخمسون أغورة لا غير$/);
});

test('similar customer names are flagged (ة vs ه)', () => {
  const list = [{ name: 'صيدلية الرحمة' }, { name: 'صيدلية الأمل' }];
  assert.equal(similarNames('صيدلية الرحمه', list).length, 1);
  assert.equal(similarNames('صيدلية النور', list).length, 0);
});

test('AI import contract is validated', () => {
  assert.ok(validateImport({ items: [{ name: 'Panadol', buyPrice: 5 }] }).ok);
  assert.ok(!validateImport({ invoice: { lines: [] } }).ok);
  assert.ok(!validateImport({ customers: [{ name: 'X', region: 'north' }] }).ok);
});

test('void of a sale does not distort inventory buckets or average cost', async () => {
  const { buildPosting, reverse, stockOnHand, avgCostC } = await import('../js/core.js');
  const items = { a: {} };
  const os = buildPosting({ type: 'OS', lines: [{ itemId: 'a', qty: 1000, price: 11.6 }] }, { items, settings });
  const si = buildPosting({ type: 'SI', partyId: 'c', lines: [{ itemId: 'a', qty: 100, bonus: 50, price: 12.5 }] }, { moves: os.moves, items, settings });
  const all = [...os.moves, ...si.moves, ...reverse(si).moves];
  const s = stockOnHand(all).a;
  assert.deepEqual([s.qty, s.in, s.out, s.bonusOut], [1000, 1000, 0, 0]);
  assert.equal(avgCostC(all, 'a'), 1000); // 11.60 incl. VAT -> 10.00 cost per unit
});

test('numeric codes start at 1001 and skip typed non-numeric codes', async () => {
  const { nextNumericCode } = await import('../js/core.js');
  assert.equal(nextNumericCode([]), '1001');
  assert.equal(nextNumericCode(['1001', '1007', 'ABC', '07100x']), '1008');
});

test('rounding rule: one decimal per line, total to the shekel, half goes down', async () => {
  const { computeTotals, buildPosting, docTotalsOpts, roundShekelHalfDown, round1, isBalanced } = await import('../js/core.js');
  assert.equal(roundShekelHalfDown(30060), 30100);
  assert.equal(roundShekelHalfDown(30040), 30000);
  assert.equal(roundShekelHalfDown(30050), 30000);
  assert.equal(roundShekelHalfDown(30051), 30100);
  assert.equal(round1(27.492), 27.5); assert.equal(round1(18.25), 18.3); assert.equal(round1(12.5), 12.5);
  const lines = [{ itemId: 'a', qty: 3, price: 33.4 }, { itemId: 'b', qty: 1, price: 0.25 }];
  const t = computeTotals(lines, { vatRate: 16, pricesIncludeVat: true, roundTotals: true });
  assert.equal(t.lines[0].amountC, 10020);          // 100.2
  assert.equal(t.lines[1].amountC, 30);             // 0.25 → 0.3
  assert.equal(t.subtotalC, 10050);
  assert.equal(t.totalC, 10000);                    // 100.5 → 100
  assert.equal(t.roundC, -50);
  assert.equal(t.vatC + t.netC, t.totalC);          // VAT taken from the rounded total
  // posted with the rule: the entry balances with no rounding account
  const doc = { type: 'SI', partyId: 'p', lines, invoiceDiscount: 0 };
  const { entries } = buildPosting(doc, { settings: { vatRate: 16, pricesIncludeVat: true, roundTotals: true }, items: { a: {}, b: {} } });
  assert.ok(isBalanced(entries));
  assert.equal(entries.find((e) => e.account === '1200').debitC, 10000);
  // a document posted before the rule keeps its printed numbers
  const old = { type: 'SI', lines, settingsAtPost: { vatRate: 16, pricesIncludeVat: true } };
  assert.equal(docTotalsOpts(old, { roundTotals: true }).roundTotals, false);
  assert.equal(computeTotals(lines, docTotalsOpts(old, {})).totalC, 10045);
  // vouchers and opening stock never round
  assert.equal(docTotalsOpts({ type: 'OS', lines: [] }, { roundTotals: true }).roundTotals, false);
  assert.equal(docTotalsOpts({ type: 'RV' }, { roundTotals: true }).roundTotals, false);
});

test('names with movements take spelling fixes only', async () => {
  const { isSpellingFix } = await import('../js/core.js');
  assert.ok(isSpellingFix('PARACETAMOL 500MG 20T', 'PARACETAMOL 500 MG 20T'));
  assert.ok(isSpellingFix('صيدلية الرحمه', 'صيدلية الرحمة'));
  assert.ok(isSpellingFix('OMEPRAZOL 20MG', 'OMEPRAZOLE 20MG'));
  assert.ok(!isSpellingFix('PARACETAMOL 500MG 20T', 'IBUPROFEN 400MG 20T'));
  assert.ok(!isSpellingFix('صيدلية الشفاء', 'صيدلية النور'));
});

test('statement including saved drafts marks them and keeps posted rows first', async () => {
  const { draftEntries, statement } = await import('../js/core.js');
  const posted = [{ account: '1200', partyId: 'p', debitC: 10000, creditC: 0, docId: 'd1', date: '2026-11-01', number: 'SI-26-000001', type: 'SI', seq: 1 }];
  const docs = [
    { id: 'd2', type: 'RV', status: 'draft', partyId: 'p', date: '2026-11-01', amount: 40, cashAccount: '1100' },
    { id: 'd3', type: 'SI', status: 'draft', partyId: 'p', date: '2026-11-02', lines: [{ itemId: 'a', qty: 1, price: 25.3 }] },
    { id: 'd4', type: 'RV', status: 'draft', partyId: 'q', date: '2026-11-02', amount: 5 },
    { id: 'd5', type: 'RV', status: 'draft', partyId: 'p', date: '2026-11-02', amount: 0 },
  ];
  const extra = draftEntries(docs, { vatRate: 16, pricesIncludeVat: true, roundTotals: true }, { partyId: 'p', except: 'd3' });
  assert.equal(extra.length, 1);
  const st = statement([...posted, ...extra], docs, 'p', 'customer');
  assert.deepEqual(st.rows.map((r) => [r.docId, !!r.draft, r.balanceC]), [['d1', false, 10000], ['d2', true, 6000]]);
  const all = statement([...posted, ...draftEntries(docs, { roundTotals: true }, { partyId: 'p' })], docs, 'p', 'customer');
  assert.equal(all.closing, 10000 - 4000 + 2500);   // 25.3 → 25 shekels (rounded total)
});

test('a sale never stops at zero: stock goes below zero until the purchase arrives', async () => {
  const { buildPosting, stockOnHand, isBalanced } = await import('../js/core.js');
  const items = { a: { buyPrice: 11.6 } };
  const settings = { vatRate: 16, pricesIncludeVat: true, roundTotals: true };
  const os = buildPosting({ type: 'OS', lines: [{ itemId: 'a', qty: 5, price: 11.6 }] }, { items, settings });
  const sale = buildPosting({ type: 'SI', partyId: 'p', lines: [{ itemId: 'a', qty: 8, price: 20 }] }, { moves: os.moves, items, settings });
  assert.ok(isBalanced(sale.entries));
  assert.equal(stockOnHand([...os.moves, ...sale.moves]).a.qty, -3);
  const buy = buildPosting({ type: 'PI', partyId: 's', lines: [{ itemId: 'a', qty: 10, price: 11.6 }] }, { items, settings });
  assert.equal(stockOnHand([...os.moves, ...sale.moves, ...buy.moves]).a.qty, 7);
});

test('account codes: Rabee\'s chart as default, codes digits-only and unique', async () => {
  const { DEFAULT_ACCOUNT_CODES, checkAccountCodes } = await import('../js/core.js');
  assert.equal(DEFAULT_ACCOUNT_CODES['1100'], '100'); assert.equal(DEFAULT_ACCOUNT_CODES['1110'], '101');
  assert.equal(DEFAULT_ACCOUNT_CODES['5200'], '102'); assert.equal(DEFAULT_ACCOUNT_CODES['4100'], '103'); assert.equal(DEFAULT_ACCOUNT_CODES['1400'], '104');
  assert.equal(DEFAULT_ACCOUNT_CODES['2100'], '1300'); assert.equal(DEFAULT_ACCOUNT_CODES['1200'], '2300'); assert.equal(DEFAULT_ACCOUNT_CODES['1250'], '3300');
  assert.deepEqual(checkAccountCodes(DEFAULT_ACCOUNT_CODES), []);
  assert.equal(checkAccountCodes({ ...DEFAULT_ACCOUNT_CODES, '1110': '100' }).length, 1);
  assert.equal(checkAccountCodes({ ...DEFAULT_ACCOUNT_CODES, '1110': 'B1' }).length, 1);
});
