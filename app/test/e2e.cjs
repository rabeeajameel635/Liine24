// End-to-end run in Chromium. Serve app/ first:  python3 -m http.server 8765  (inside app/)
const { chromium } = require('playwright');
const OUT = process.env.SHOTS || require('os').tmpdir() + '/ledger-shots';
require('fs').mkdirSync(OUT, { recursive: true });
const URL = process.env.APP_URL || 'http://127.0.0.1:8765/index.html';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const dialogAnswers = [];
  page.on('dialog', async (d) => { const a = dialogAnswers.shift(); if (d.type() === 'prompt') await d.accept(a ?? 'test reason'); else await d.accept(); });
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; if (!localStorage.getItem('lang')) localStorage.setItem('lang', 'en'); });
  const toast = async () => (await page.textContent('#toast')).trim();
  const step = (s) => console.log('▶', s);
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) await page.keyboard.press(k); };
  const focused = () => page.evaluate(() => document.activeElement?.dataset?.k || document.activeElement?.id || document.activeElement?.tagName);

  await page.goto(URL); await page.waitForSelector('h1');
  step('admin and company');
  await page.goto(URL + '#/settings'); await page.waitForSelector('#toAdmin');
  await page.click('#toAdmin'); await page.waitForSelector('#saveCo');
  await page.fill('[name=companyName]', 'Demo Medical Warehouse'); await page.fill('[name=taxNo]', '562000000');
  await page.click('#saveCo'); await page.waitForTimeout(300);

  step('import items and customers (AI JSON path)');
  await page.goto(URL + '#/import'); await page.waitForSelector('#json');
  await page.fill('#json', JSON.stringify({
    items: [
      { code: '1001', name: 'PARACETAMOL 500MG 20T', unit: 'PCS', buyPrice: 9, pricePharmacist: 12.5, openingQty: 1000 },
      { code: '1002', name: 'OMEPRAZOLE 20MG 28CAP', unit: 'PCS', buyPrice: 14, pricePharmacist: 18.25, openingQty: 800 },
      { code: '1003', name: 'AMOXICILLIN 500MG 21CAP', unit: 'PCS', buyPrice: 17, pricePharmacist: 24, openingQty: 2000 },
    ],
    customers: [
      { code: 'C-0100', name: 'صيدلية الرحمة', region: 'gaza', type: 'pharmacy', creditLimit: 50000, openingBalance: 1000 },
      { name: 'صيدلية الأمل', region: 'south', type: 'pharmacy' },
    ],
  }));
  await page.click('#importJson'); await page.click('#doImport'); await page.waitForTimeout(800);
  console.log('  toast:', await toast());

  step('a prepared .json file (items + purchase invoice) imports from the file picker');
  { const fp = OUT + '/prepared.json';
    require('fs').writeFileSync(fp, JSON.stringify({ items: [{ code: '7001', name: 'TEST ITEM A', buyPrice: 10 }, { code: '7002', name: 'TEST ITEM B', buyPrice: 4 }],
      suppliers: [{ code: 'C-0100', name: 'Test Supplier Co.' }],
      invoice: { type: 'PI', supplierCode: 'C-0100', reference: 'stock count', lines: [{ itemCode: '7001', qty: 3, price: 10, disc: 10, expiry: '2027-07' }, { itemCode: '7002', qty: 5, price: 4, disc: 10 }] } }));
    await page.goto(URL + '#/import'); await page.waitForSelector('#file'); await page.setInputFiles('#file', fp); await page.waitForTimeout(800);
    console.log('  json file preview:', (await page.textContent('#jsonOut')).replace(/\s+/g, ' ').slice(0, 80));
    await page.click('#doImport'); await page.waitForTimeout(1500);
    console.log('  purchase draft from file:', await page.locator('#lines tbody tr.found').count(), 'lines | total', (await page.textContent('#gTotal')).trim(), '| supplier (not the customer with the same code):', await page.inputValue('#party'));
    await page.goto(URL + '#/dashboard'); await page.waitForTimeout(300); }

  step('similar-name warning');
  await page.goto(URL + '#/customers'); await page.waitForSelector('#add');
  await page.click('#add'); console.log('  next customer code:', await page.inputValue('dialog [name=code]'));
  await page.fill('dialog [name=name]', 'صيدلية الرحمه'); dialogAnswers.push(undefined);
  await page.click('dialog button[value=save]'); await page.waitForTimeout(600);
  console.log('  customers now:', await page.locator('#tb tr').count());

  step('sales invoice with the keyboard only');
  await page.goto(URL + '#/new/SI'); await page.waitForSelector('#party'); await page.waitForTimeout(150);
  console.log('  starts on:', await focused());
  await page.keyboard.type('C-0100'); await key('Enter');
  console.log('  party resolved:', await page.inputValue('#party'), '| now on:', await focused());
  await key('Enter', 3); console.log('  after date, ref, salesman:', await focused());
  await page.keyboard.type('1001');
  console.log('  name filled by code:', await page.inputValue('#lines tbody tr:nth-child(1) [data-k=name]'));
  await key('Enter'); console.log('  code → ', await focused(), '(price prefilled:', await page.inputValue('#lines tbody tr:nth-child(1) [data-k=price]') + ')');
  await key('Enter'); await page.keyboard.type('100'); await key('Enter'); await page.keyboard.type('50'); await key('Enter'); await key('Enter');
  console.log('  line 2 on:', await focused(), '| line numbers:', await page.locator('#lines .lno').allTextContents());
  await key('Enter'); console.log('  empty code → ', await focused());
  await page.keyboard.type('omep'); await key('Enter');
  console.log('  name search picked:', await page.inputValue('#lines tbody tr:nth-child(2) [data-k=code]'), '| on:', await focused());
  await key('Enter'); await page.keyboard.type('200'); await key('Enter'); await key('Enter'); await page.keyboard.type('50'); await key('Enter');
  await key('Enter'); await key('Enter');
  console.log('  empty line → ', await focused(), '| rows:', await page.locator('#lines tbody tr').count());
  await page.locator('#lines tbody tr:nth-child(1) [data-k=batch]').fill('850');
  await page.locator('#lines tbody tr:nth-child(1) [data-k=expiry]').fill('2026-08');
  console.log('  totals:', (await page.textContent('#totals')).replace(/\s+/g, ' '));
  console.log('  lines table fits (no sideways scroll):', await page.evaluate(() => { const w = document.querySelector('#lines').closest('.tablewrap'); return w.scrollWidth <= w.clientWidth + 1; }));
  await page.screenshot({ path: OUT + '/1-invoice-entry.png', fullPage: true });
  await page.locator('#lines tbody tr:nth-child(1) [data-k=qty]').focus();
  await page.keyboard.press('F9'); await page.waitForTimeout(1200);
  console.log('  after F9 (asked first):', (await page.textContent('h1')).replace(/\s+/g, ' '), '| print calls:', await page.evaluate(() => window.__printed));
  console.log('  printed pages:', await page.locator('#printArea .doc-print .stamp').allTextContents());
  await page.evaluate(() => document.body.classList.add('printing')); await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: OUT + '/2-print.png', fullPage: true });
  await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => document.body.classList.remove('printing'));
  await page.click('#printBtn'); await page.waitForTimeout(500);
  console.log('  reprint:', await page.locator('#printArea .doc-print .stamp').allTextContents());

  step('receipt voucher by cheque with the keyboard');
  await page.goto(URL + '#/new/RV'); await page.waitForSelector('#party'); await page.waitForTimeout(150);
  await page.keyboard.type('صيدلية الرح'); await key('Enter'); await page.waitForTimeout(300);
  console.log('  two matches open the list:', await page.locator('dialog.lookup[open]').count() === 1, '| rows:', await page.locator('dialog.lookup tbody tr').count());
  await key('Escape'); await page.waitForTimeout(200);
  await page.fill('#party', ''); await key('Enter'); await page.waitForTimeout(300);
  console.log('  Enter on empty opens the list:', await page.locator('dialog.lookup[open]').count() === 1);
  await page.keyboard.type('C-01'); await key('Enter'); await page.waitForTimeout(300);
  console.log('  picked from list:', await page.inputValue('#party'), '| now on:', await focused());
  await page.focus('#party'); await key('F2'); await page.waitForTimeout(300);
  console.log('  F2 opens the list:', await page.locator('dialog.lookup[open]').count() === 1); await key('Escape'); await page.waitForTimeout(200);
  await page.focus('#party'); await key('Enter');
  await key('Enter', 2); console.log('  on:', await focused());
  await page.keyboard.type('1500'); await page.selectOption('#method', 'cheque');
  await page.fill('#chequeNo', '3333'); await page.fill('#chequeBank', 'Bank of Palestine'); await page.fill('#dueDate', '2026-12-01');
  await page.locator('#dueDate').press('Enter'); console.log('  last field → ', await focused());
  await page.keyboard.press('F9'); await page.waitForTimeout(1000);
  console.log('  receipt:', (await page.textContent('h1')).replace(/\s+/g, ' '), '| pages:', await page.locator('#printArea .doc-print .stamp').allTextContents());

  step('Bisan keys: F4 saves without asking, Esc goes back to where you were');
  await page.goto(URL + '#/docs?type=SI&tab=all'); await page.waitForSelector('.chips');
  await page.goto(URL + '#/new/SI'); await page.waitForSelector('#party'); await page.waitForTimeout(200);
  let asked = 0; const countDialogs = (d) => { asked++; }; page.on('dialog', countDialogs);
  await page.keyboard.type('C-0100'); await key('Enter'); await key('F4'); await page.waitForTimeout(700);
  console.log('  F4 saved:', (await page.textContent('.whead .pill')).trim(), '| browser questions asked:', asked);
  page.off('dialog', countDialogs);
  await key('Escape'); await page.waitForTimeout(500);
  console.log('  Esc on unchanged saved draft →', await page.evaluate(() => location.hash));
  await page.locator('#dl .drow', { hasText: 'SI-26-000001' }).click(); await page.waitForSelector('#printBtn');
  await key('Escape'); await page.waitForTimeout(500);
  console.log('  Esc on posted (archive) document →', await page.evaluate(() => location.hash));
  await page.goto(URL + '#/new/SI'); await page.waitForSelector('#party'); await page.waitForTimeout(200);
  await page.locator('#notes').focus(); await key('F2'); await page.waitForTimeout(300);
  console.log('  F2 from anywhere opens the list:', await page.locator('dialog.lookup[open]').count() === 1, '| title:', await page.textContent('dialog.lookup h2'));
  await key('Escape'); await page.waitForTimeout(200); await key('Escape'); await page.waitForTimeout(400);

  step('F2 on a chosen record opens its inquiry card; F2 again opens the full list');
  await page.goto(URL + '#/new/SI'); await page.waitForSelector('#party'); await page.waitForTimeout(200);
  await page.keyboard.type('C-0100'); await key('Enter');
  await page.focus('#party'); await key('F2'); await page.waitForTimeout(400);
  console.log('  pharmacy card:', (await page.textContent('dialog.card-dlg h2')).trim(), '| fields:', (await page.locator('dialog.card-dlg .kv span').allTextContents()).join(', '));
  await key('F2'); await page.waitForTimeout(400);
  console.log('  F2 again → full list rows:', await page.locator('dialog.lookup:not(.card-dlg) tbody tr').count());
  await key('Escape'); await page.waitForTimeout(200);
  await page.focus('#lines tbody tr [data-k=code]'); await page.keyboard.type('1001'); await key('F2'); await page.waitForTimeout(400);
  console.log('  item card:', (await page.textContent('dialog.card-dlg h2')).trim(), '| sections:', await page.locator('dialog.card-dlg h3').allTextContents());
  console.log('  last price to this customer shown:', (await page.textContent('dialog.card-dlg .kv')).includes('Last price to this customer'));
  await key('Escape'); await page.waitForTimeout(200);
  console.log('  back on:', await focused(), '| item kept:', await page.inputValue('#lines tbody tr [data-k=code]'));
  await key('Escape'); await page.waitForTimeout(300);
  if (await page.locator('dialog[open] [data-v=discard]').count()) { await page.click('dialog [data-v=discard]'); await page.waitForTimeout(400); }

  step('phone symbol keys: @ lookup, # save, € print & post; notes keep them as text');
  await page.goto(URL + '#/new/SI'); await page.waitForSelector('#party'); await page.waitForTimeout(400);
  await page.focus('#party'); await page.keyboard.type('@');
  const opened = await page.waitForSelector('dialog.lookup[open]', { timeout: 5000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(500);
  console.log('  @ opens exactly one list:', opened && (await page.locator('dialog[open]').count()) === 1, '| @ not typed:', (await page.inputValue('#party')) === '');
  await page.keyboard.type('C-0100'); await key('Enter');
  await page.waitForSelector('dialog.lookup[open]', { state: 'detached', timeout: 5000 }).catch(() => {});
  console.log('  picked:', await page.inputValue('#party'));
  await page.focus('#notes');
  await page.keyboard.type('order #12 @ shop');
  console.log('  notes keep symbols:', await page.inputValue('#notes'));
  await page.locator('#lines tbody tr [data-k=code]').first().fill('1001'); await page.locator('#lines tbody tr [data-k=code]').first().dispatchEvent('input');
  await page.locator('#lines tbody tr [data-k=qty]').first().fill('3');
  await page.focus('#ref'); await page.keyboard.type('#'); await page.waitForTimeout(1200);
  console.log('  # saved:', (await page.textContent('.whead .pill')).trim());
  await page.focus('#ref'); await page.keyboard.type('€'); await page.waitForTimeout(1500);
  console.log('  € posted:', (await page.textContent('h1')).replace(/\s+/g, ' '));

  step('letterhead: name - city, one line per contact');
  await page.evaluate(async () => { const db = await import('./js/db.js');
    for (const [k, v] of Object.entries({ companyNameAr: 'شركة الاختبار للأدوية', city: 'غزة', monogram: 'ش', contacts: 'الإدارة | 0590000001\nالمبيعات | د. اسم تجريبي | 0590000002\u202c\nالمخزن 0590000003' })) await db.setSetting(k, v, 'test'); });
  await page.goto(URL + '#/settings'); await page.waitForSelector('#lhPrev .lh');
  console.log('  letterhead preview:', (await page.locator('#lhPrev .lct').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()), '|', (await page.textContent('#lhPrev .co')).trim());
  await page.locator('#lhPrev').screenshot({ path: OUT + '/6-letterhead.png' });
  console.log('  phones recognised (hidden marks dropped):', await page.locator('#lhPrev .tel').count());

  step('statement');
  const cid = await page.evaluate(async () => (await (await import('./js/db.js')).all('parties')).find((p) => p.code === 'C-0100').id);
  await page.goto(URL + `#/statement/${cid}`); await page.waitForSelector('#out table');
  console.log('  closing:', (await page.textContent('#out tfoot')).replace(/\s+/g, ' '));
  await page.evaluate(async (pid) => { const db = await import('./js/db.js'); await db.saveDraft({ type: 'RV', partyId: pid, date: '2026-11-10', amount: 100, method: 'cash', cashAccount: '1100', lines: [] }, 'test'); }, cid);
  await page.click('#stOpts'); await page.waitForSelector('dialog.stopts');
  console.log('  options sheet:', (await page.locator('dialog.stopts label, dialog.stopts .f > span').allTextContents()).map((t) => t.trim().split(/\s{2,}/)[0]).join(' | '));
  await page.click('dialog.stopts [data-d="1"]'); await page.click('dialog.stopts [data-m=all]'); await page.waitForSelector('#out table.withst');
  console.log('  including saved, statuses:', (await page.locator('#out td.ss').allTextContents()).map((t) => t.trim()).join(','), '| detail rows:', await page.locator('#out tr.sdet').count());
  console.log('  closing with saved:', (await page.textContent('#out tfoot')).replace(/\s+/g, ' '));
  await page.click('#stOpts'); await page.waitForSelector('dialog.stopts'); await page.click('dialog.stopts [data-m=posted]'); await page.waitForTimeout(500);
  console.log('  posted only again has no status column:', await page.locator('#out td.ss').count() === 0);
  console.log('  descriptions:', (await page.locator('#out td.sn').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()).slice(0, 6));
  console.log('  required balance box:', (await page.textContent('#out .sthb')).replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: OUT + '/4-statement.png', fullPage: true });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#xl')]);
  const xp = OUT + '/statement.xlsx'; await dl.saveAs(xp);
  const XLSX = require(require('path').join(__dirname, '..', 'vendor', 'xlsx.full.min.js'));
  const wbx = XLSX.read(require('fs').readFileSync(xp)); const rowsx = XLSX.utils.sheet_to_json(wbx.Sheets[wbx.SheetNames[0]], { header: 1 });
  console.log('  excel export:', JSON.stringify(rowsx.slice(0, 6).map((r) => r.filter((c) => c !== '').slice(0, 3))), '| last:', JSON.stringify(rowsx.slice(-3)));
  await page.click('#pr'); await page.waitForTimeout(300);
  await page.evaluate(() => document.body.classList.add('printing')); await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: OUT + '/5-statement-print.png', fullPage: true });
  await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => document.body.classList.remove('printing'));
  const nums = await page.evaluate(async () => (await (await import('./js/db.js')).all('docs')).filter((x) => x.number).map((x) => x.number));
  console.log('  no document posted twice (numbers unique):', new Set(nums).size === nums.length, nums.filter((n) => /^(SI|RV)/.test(n)));

  step('void the invoice');
  await page.goto(URL + '#/docs?type=SI&tab=posted'); await page.click('#dl .drow');
  await page.waitForSelector('#void'); dialogAnswers.push('wrong customer');
  await page.click('#void'); await page.waitForTimeout(700);
  console.log('  after void:', (await page.textContent('h1')).replace(/\s+/g, ' '));

  step('reports');
  for (const r of ['tb', 'integrity', 'stock', 'sales', 'dashboard', 'audit']) {
    await page.goto(URL + '#/' + r); await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/4-${r}.png`, fullPage: true });
  }
  await page.goto(URL + '#/integrity'); await page.waitForTimeout(300);
  console.log('  integrity:', await page.locator('.pill').allTextContents());

  step('roles');
  await page.goto(URL + '#/settings'); await page.click('#toAcc'); await page.goto(URL + '#/items'); await page.waitForTimeout(300);
  console.log('  accountant sees Add item:', await page.locator('#add').count());

  step('smart entry, then post');
  await page.goto(URL + '#/new/SI'); await page.waitForSelector('#party');
  await page.fill('#party', 'C-0100');
  await page.click('#smart'); await page.fill('#smartText', '1003 50 +10\n1001 20\n9999 5');
  await page.click('#smartGo'); await page.waitForTimeout(800);
  console.log('  smart:', await toast(), '| rows:', await page.locator('#lines tbody tr').count());
  await page.click('#post'); await page.waitForTimeout(800);
  console.log('  posted:', (await page.textContent('h1')).replace(/\s+/g, ' '));
  await page.goto(URL + '#/sales'); await page.waitForTimeout(400);
  console.log('  sales totals:', (await page.textContent('#main tfoot')).replace(/\s+/g, ' '));

  step('F2 item list inside a line, and searching the items list');
  await page.goto(URL + '#/new/PI'); await page.waitForSelector('#party'); await page.waitForTimeout(200);
  await page.focus('#lines tbody tr [data-k=code]'); await key('F2'); await page.waitForTimeout(300);
  console.log('  item list rows:', await page.locator('dialog.lookup tbody tr').count());
  await key('ArrowDown'); await key('Enter'); await page.waitForTimeout(300);
  console.log('  picked item:', await page.inputValue('#lines tbody tr [data-k=code]'), '| now on:', await focused());
  await page.locator('#lines tbody tr [data-k=code]').fill('99'); await page.locator('#lines tbody tr [data-k=code]').press('Enter'); await page.waitForTimeout(300);
  console.log('  unknown code opens the list:', await page.locator('dialog.lookup[open]').count() === 1); await key('Escape'); await page.waitForTimeout(200);
  await page.locator('#lines tbody tr [data-k=code]').fill(''); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  if (await page.locator('dialog[open] [data-v=discard]').count()) await page.click('dialog [data-v=discard]');
  await page.goto(URL + '#/settings'); await page.click('#toAdmin'); await page.waitForTimeout(200);
  await page.goto(URL + '#/items'); await page.waitForSelector('#q');
  console.log('  search has focus:', await focused());
  await page.keyboard.type('omepr'); await key('Enter'); await page.waitForTimeout(400);
  console.log('  Enter opens the only match:', await page.locator('dialog[open] [name=code]').inputValue().catch(() => 'none'), '| dialogs open:', await page.locator('dialog[open]').count());
  await page.locator('dialog[open] button[value=cancel]').first().click(); await page.waitForTimeout(300);
  console.log('  dialogs left:', await page.locator('dialog[open]').count());

  step('names: free before movement, locked after');
  await page.goto(URL + '#/settings'); await page.waitForTimeout(200); if (await page.locator('#toAdmin').count()) await page.click('#toAdmin'); await page.waitForTimeout(200);
  await page.goto(URL + '#/items'); await page.waitForSelector('#add');
  await page.click('#add'); console.log('  next item code:', await page.inputValue('dialog [name=code]'));
  await page.fill('dialog [name=name]', 'VITAMN C 1000MG'); await page.click('dialog button[value=save]'); await page.waitForTimeout(500);
  await page.locator('#tb tr', { hasText: 'VITAMN C' }).locator('[data-edit]').click(); await page.waitForSelector('dialog [name=name]');
  await page.fill('dialog [name=name]', 'VITAMIN C 1000MG'); await page.click('dialog button[value=save]'); await page.waitForTimeout(500);
  console.log('  renamed unused:', await page.locator('#tb tr', { hasText: 'VITAMIN C 1000MG' }).count() === 1);
  const refused = await page.evaluate(async () => { const db = await import('./js/db.js'); const it = (await db.all('items')).find((i) => i.code === '1003');
    try { await db.saveMaster('items', { ...it, name: 'X' }, 'test'); return false; } catch (e) { return e.message; } });
  console.log('  used item rename refused:', !!refused);

  step('accounts setup: own codes and names, unique, postings untouched');
  await page.goto(URL + '#/accounts'); await page.waitForSelector('table.acct');
  console.log('  codes shown:', (await page.locator('table.acct .ac').evaluateAll((els) => els.map((e) => e.value))).slice(0, 9).join(' '));
  const tbBefore = await page.evaluate(async () => { const db = await import('./js/db.js'); return (await db.all('ledger')).length; });
  await page.locator('tr[data-k="1110"] .ac').fill('100'); await page.click('#saveAc'); await page.waitForTimeout(400);
  console.log('  duplicate code refused:', (await page.textContent('#toast')).slice(0, 40));
  await page.locator('tr[data-k="1110"] .ac').fill('101'); await page.locator('tr[data-k="1100"] .an').fill('الصندوق الرئيسي'); await page.click('#saveAc'); await page.waitForTimeout(500);
  await page.goto(URL + '#/tb'); await page.waitForTimeout(400);
  console.log('  trial balance shows own codes:', (await page.locator('#main tbody td:first-child').allTextContents()).join(' '), '| ledger rows unchanged:', tbBefore === await page.evaluate(async () => { const db = await import('./js/db.js'); return (await db.all('ledger')).length; }));

  step('regions directory: codes 01-03, customers grouped, balances by region');
  await page.goto(URL + '#/regions'); await page.waitForSelector('table.regs');
  console.log('  regions:', await page.locator('table.regs tr[data-i]').evaluateAll((trs) => trs.map((t) => t.querySelector('.rc').value + ' ' + t.querySelector('.rn').value + ' (' + t.cells[2].textContent + ')')));
  await page.click('#addReg'); await page.locator('table.regs tr[data-i]').last().locator('.rn').fill('Test region'); await page.locator('table.regs tr[data-i]').last().locator('.rc').fill('02');
  await page.click('#saveReg'); await page.waitForTimeout(300); console.log('  duplicate region code refused:', (await page.textContent('#toast')).slice(0, 40));
  await page.locator('table.regs tr[data-i]').last().locator('.rc').fill('04'); await page.click('#saveReg'); await page.waitForTimeout(500);
  console.log('  saved regions:', await page.locator('table.regs .rc').evaluateAll((els) => els.map((e) => e.value).join(' ')));
  await page.goto(URL + '#/customers'); await page.waitForSelector('#tb');
  console.log('  directory lines:', (await page.locator('#tb tr td.dl').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()));
  await page.goto(URL + '#/balances'); await page.waitForSelector('table.bal');
  console.log('  balances report:', (await page.locator('table.bal tr.rgh, table.bal tr.rgt, table.bal tfoot tr').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()).slice(0, 4));

  step('deactivate a pharmacy with a balance');
  await page.goto(URL + '#/customers'); await page.waitForSelector('[data-edit]');
  await page.locator('#tb tr', { hasText: 'C-0100' }).locator('[data-edit]').click(); await page.waitForSelector('dialog [name=active]');
  await page.selectOption('dialog [name=active]', 'false'); await page.click('dialog button[value=save]'); await page.waitForTimeout(600);
  await page.goto(URL + '#/new/SI'); await page.waitForSelector('#party');
  const inSI = (await page.locator('#dlParties option').evaluateAll((o) => o.map((x) => x.value))).some((v) => v.startsWith('C-0100'));
  await page.goto(URL + '#/new/RV'); await page.waitForSelector('#party');
  const inRV = (await page.locator('#dlParties option').evaluateAll((o) => o.map((x) => x.value))).some((v) => v.startsWith('C-0100'));
  console.log('  in invoice list:', inSI, '| in receipt list:', inRV);

  step('leaving a started document keeps it as a draft, without asking');
  await page.goto(URL + '#/new/SR'); await page.waitForSelector('#party'); await page.waitForTimeout(200);
  await page.keyboard.type('1002'); await page.keyboard.press('Enter');
  await page.focus('#lines tbody tr [data-k=code]'); await page.keyboard.type('1001'); await key('Enter'); await key('Enter'); await page.keyboard.type('2'); await key('Enter');
  await page.waitForTimeout(1200);
  console.log('  autosaved while typing:', (await page.textContent('.whead .pill')).trim(), '|', await page.evaluate(() => location.hash.startsWith('#/doc/')));
  await page.keyboard.type('3'); await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  console.log('  Esc asks nothing:', await page.locator('dialog[open]').count() === 0, '| back on:', await page.evaluate(() => location.hash));
  const draftId = await page.evaluate(async () => (await (await import('./js/db.js')).all('docs')).find((d) => d.status === 'draft' && d.type === 'SR').id);
  console.log('  draft kept with its last line:', await page.evaluate(async (id) => JSON.stringify((await (await import('./js/db.js')).get('docs', id)).lines.map((l) => [l.qty, l.bonus])), draftId));
  await page.goto(URL + '#/new/SI'); await page.waitForSelector('#party'); await page.waitForTimeout(200);
  await page.keyboard.type('1002'); await page.keyboard.press('Enter');
  await page.click('#nav a[href="#/items"]'); await page.waitForTimeout(500);
  console.log('  empty invoice leaves without a draft:', await page.locator('dialog[open]').count() === 0, await page.evaluate(() => location.hash));
  await page.goto(URL + '#/doc/' + draftId); await page.waitForSelector('#party'); await page.waitForTimeout(200);
  await page.click('#cancelDoc'); await page.waitForTimeout(600);
  console.log('  saved draft cancelled (kept, not erased):', await page.evaluate(async (id) => (await (await import('./js/db.js')).get('docs', id)).status, draftId), '| now on:', await page.evaluate(() => location.hash));

  step('documents list with status tabs');
  await page.goto(URL + '#/docs?type=SI'); await page.waitForSelector('.chips');
  console.log('  tabs:', (await page.locator('.seg a').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()));
  await page.goto(URL + '#/docs?type=SI&tab=all'); await page.waitForTimeout(300);
  console.log('  statuses shown:', await page.locator('#dl .pill').allTextContents());
  await page.locator('#dl .drow', { hasText: 'SI-26-000002' }).click(); await page.waitForSelector('#dup');
  await page.click('#dup'); await page.waitForTimeout(600);
  console.log('  duplicate opens draft with lines:', await page.locator('#lines tbody tr').count(), '| bar:', (await page.inputValue('#party')), (await page.textContent('#gTotal')));
  await page.goto(URL + '#/dashboard'); await page.waitForTimeout(200);

  step('Arabic, right to left');
  await page.click('#langBtn'); await page.waitForTimeout(600);
  console.log('  dir:', await page.evaluate(() => document.documentElement.dir), '| button:', await page.textContent('#langBtn'));
  const leftovers = new Set();
  for (const r of ['dashboard', 'new/SI', 'new/RV', 'docs', 'items', 'customers', 'statement', 'sales', 'stock', 'tb', 'integrity', 'import', 'backup', 'settings']) {
    await page.goto(URL + '#/' + r); await page.waitForTimeout(300);
    (await page.evaluate(() => {
      const out = []; const w = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
      while (w.nextNode()) { const n = w.currentNode; const t = n.nodeValue.trim(); const el = n.parentElement;
        if (/[A-Za-z]{3,}/.test(t) && !el.closest('[dir=auto],textarea,code,[data-notr],#tb,#dl,.doc-print') && !/^[A-Z0-9 .\-—₪%/·]+$/.test(t)) out.push(t); }
      return out;
    })).forEach((t) => leftovers.add(t));
    if (['dashboard', 'new/SI', 'settings'].includes(r)) await page.screenshot({ path: `${OUT}/6-ar-${r.replace('/', '-')}.png`, fullPage: true });
  }
  console.log('  untranslated:', [...leftovers].slice(0, 60));
  const indic = await page.evaluate(async () => {
    const pages = ['dashboard', 'docs?type=SI&tab=all', 'statement', 'tb', 'stock'];
    const bad = [];
    for (const r of pages) { location.hash = '#/' + r; await new Promise((ok) => setTimeout(ok, 350)); const m = document.body.innerText.match(/[\u0660-\u0669\u06F0-\u06F9]/g); if (m) bad.push(r + ':' + m.join('')); }
    return bad;
  });
  console.log('  Arabic-Indic digits anywhere:', indic.length ? indic : 'none');

  step('phone width');
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(URL + '#/new/SI'); await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/5-mobile.png', fullPage: false });
  console.log('  horizontal page scroll:', await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));

  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
