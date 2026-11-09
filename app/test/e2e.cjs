const { chromium } = require('playwright');
const OUT = process.env.SHOTS || require('os').tmpdir() + '/ledger-shots';
require('fs').mkdirSync(OUT, { recursive: true });
const URL = process.env.APP_URL || 'http://127.0.0.1:8765/index.html';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const dialogAnswers = [];
  page.on('dialog', async (d) => { const a = dialogAnswers.shift(); if (d.type() === 'prompt') await d.accept(a ?? 'test reason'); else await d.accept(); });
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  const toast = async () => (await page.textContent('#toast')).trim();
  const step = (s) => console.log('▶', s);

  await page.goto(URL);
  await page.waitForSelector('h1');
  step('switch to admin and set company');
  await page.goto(URL + '#/settings'); await page.waitForSelector('#toAdmin');
  await page.click('#toAdmin'); await page.waitForSelector('#saveCo');
  await page.fill('[name=companyName]', 'Demo Medical Warehouse');
  await page.fill('[name=taxNo]', '562000000');
  await page.click('#saveCo'); await page.waitForTimeout(300);

  step('import items and customer through the AI JSON path');
  await page.goto(URL + '#/import'); await page.waitForSelector('#json');
  await page.fill('#json', JSON.stringify({
    items: [
      { code: 'ITM-A100', name: 'PARACETAMOL 500MG 20T', brand: 'Generic', unit: 'PCS', buyPrice: 12, pricePharmacist: 12.5, openingQty: 1000 },
      { code: 'ITM-B200', name: 'OMEPRAZOLE 20MG 28CAP', unit: 'PCS', buyPrice: 15, pricePharmacist: 18.25, openingQty: 800 },
      { code: 'ITM-C300', name: 'AMOXICILLIN 500MG 21CAP', unit: 'PCS', buyPrice: 20, pricePharmacist: 24, openingQty: 2000 },
    ],
    customers: [
      { code: 'C-0100', name: 'صيدلية الرحمة', region: 'gaza', type: 'pharmacy', creditLimit: 50000, openingBalance: 1000 },
      { name: 'صيدلية الأمل', region: 'south', type: 'pharmacy' },
    ],
  }));
  await page.click('#importJson'); await page.click('#doImport'); await page.waitForTimeout(800);
  console.log('  toast:', await toast());

  step('duplicate-name warning for a similar customer');
  await page.goto(URL + '#/customers'); await page.waitForSelector('#add');
  await page.click('#add'); await page.fill('dialog [name=name]', 'صيدلية الرحمه');
  dialogAnswers.push(undefined); // confirm -> accept
  await page.click('dialog button[value=save]'); await page.waitForTimeout(600);
  console.log('  customers now:', await page.locator('#tb tr').count());

  step('sales invoice with bonus, discount and batch');
  await page.goto(URL + '#/new/SI'); await page.waitForSelector('#party');
  await page.fill('#party', 'C-0100 — صيدلية الرحمة'); await page.dispatchEvent('#party', 'change');
  const row = (i) => page.locator('#lines tbody tr').nth(i);
  await row(0).locator('[data-k=item]').fill('ITM-A100 — PARACETAMOL 500MG 20T'); await row(0).locator('[data-k=item]').dispatchEvent('change');
  await row(0).locator('[data-k=qty]').fill('100'); await row(0).locator('[data-k=bonus]').fill('60');
  await row(0).locator('[data-k=batch]').fill('850'); await row(0).locator('[data-k=expiry]').fill('2026-08');
  await page.click('#addline');
  await row(1).locator('[data-k=item]').fill('ITM-B200'); await row(1).locator('[data-k=item]').dispatchEvent('change');
  await row(1).locator('[data-k=qty]').fill('200'); await row(1).locator('[data-k=disc]').fill('50');
  await row(1).locator('[data-k=qty]').dispatchEvent('input');
  console.log('  totals:', (await page.textContent('#totals')).replace(/\s+/g, ' '));
  await page.screenshot({ path: OUT + '/1-invoice-entry.png', fullPage: true });
  await page.click('#postprint'); await page.waitForTimeout(900);
  console.log('  after post:', await page.textContent('h1'), '| printed:', await page.evaluate(() => window.__printed));
  await page.evaluate(() => document.body.classList.add('printing'));
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: OUT + '/2-print-original.png', fullPage: true });
  await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => document.body.classList.remove('printing'));
  const stamp1 = await page.textContent('#printArea .stamp');
  await page.click('#printBtn'); await page.waitForTimeout(600);
  const stamp2 = await page.textContent('#printArea .stamp');
  console.log('  stamps:', stamp1, '→', stamp2);

  step('receipt voucher by cheque');
  await page.goto(URL + '#/new/RV'); await page.waitForSelector('#party');
  await page.fill('#party', 'C-0100 — صيدلية الرحمة'); await page.dispatchEvent('#party', 'change');
  await page.fill('#amount', '1500'); await page.selectOption('#method', 'cheque');
  await page.fill('#chequeNo', '3333'); await page.fill('#chequeBank', 'Bank of Palestine'); await page.fill('#dueDate', '2026-12-01');
  await page.click('#post'); await page.waitForTimeout(700);
  console.log('  receipt:', await page.textContent('h1'));

  step('statement');
  const cid = await page.evaluate(async () => (await (await import('./js/db.js')).all('parties')).find((p) => p.code === 'C-0100').id);
  await page.goto(URL + `#/statement/${cid}`); await page.waitForSelector('#out table');
  console.log('  statement rows:', await page.locator('#out tbody tr').count(), '| closing:', (await page.textContent('#out tfoot')).replace(/\s+/g, ' '));
  await page.screenshot({ path: OUT + '/3-statement.png', fullPage: true });

  step('void the invoice with reversal');
  await page.goto(URL + '#/docs?type=SI'); await page.click('#dl tbody tr');
  await page.waitForSelector('#void'); dialogAnswers.push('wrong customer');
  await page.click('#void'); await page.waitForTimeout(700);
  console.log('  after void:', await page.textContent('h1'));

  step('reports');
  for (const r of ['tb', 'integrity', 'stock', 'sales', 'dashboard', 'audit']) {
    await page.goto(URL + '#/' + r); await page.waitForTimeout(400);
    const t = (await page.textContent('main')).replace(/\s+/g, ' ').slice(0, 220);
    console.log(`  ${r}:`, t);
    await page.screenshot({ path: `${OUT}/4-${r}.png`, fullPage: true });
  }
  await page.goto(URL + '#/integrity'); await page.waitForTimeout(300);
  console.log('  integrity pills:', await page.locator('.pill').allTextContents());

  step('accountant cannot void or add items');
  await page.goto(URL + '#/settings'); await page.click('#toAcc'); await page.goto(URL + '#/items'); await page.waitForTimeout(300);
  console.log('  add button visible for accountant:', await page.locator('#add').count());

  step('smart entry text lines');
  await page.goto(URL + '#/new/SI'); await page.waitForSelector('#party');
  await page.fill('#party', 'C-0100 — صيدلية الرحمة');
  await page.click('#smart'); await page.fill('#smartText', 'ITM-C300 50 +10\nITM-A100 20\nUNKNOWN 5');
  await page.click('#smartGo'); await page.waitForTimeout(800);
  console.log('  smart toast:', await toast(), '| lines:', await page.locator('#lines tbody tr').count());

  step('post the smart-entry invoice, then sales report and inventory');
  await page.click('#post'); await page.waitForTimeout(800);
  console.log('  posted:', await page.textContent('h1'));
  await page.goto(URL + '#/sales'); await page.waitForTimeout(400);
  console.log('  sales tfoot:', (await page.textContent('tfoot')).replace(/\s+/g, ' '));
  await page.goto(URL + '#/stock'); await page.waitForTimeout(400);
  console.log('  stock rows:', (await page.locator('tbody tr').allTextContents()).map((t) => t.replace(/\s+/g, ' ')));
  await page.goto(URL + '#/integrity'); await page.waitForTimeout(300);
  console.log('  integrity pills:', await page.locator('.pill').allTextContents());

  step('names: free to fix before any movement, locked after');
  await page.goto(URL + '#/settings'); await page.click('#toAdmin'); await page.waitForTimeout(200);
  await page.goto(URL + '#/items'); await page.waitForSelector('#add');
  await page.click('#add'); await page.fill('dialog [name=name]', 'VITAMN C 1000MG'); await page.click('dialog button[value=save]'); await page.waitForTimeout(500);
  await page.locator('#tb tr', { hasText: 'VITAMN C' }).locator('[data-edit]').click(); await page.waitForSelector('dialog [name=name]');
  console.log('  unused item name editable:', !(await page.locator('dialog [name=name]').getAttribute('readonly')));
  await page.fill('dialog [name=name]', 'VITAMIN C 1000MG'); await page.click('dialog button[value=save]'); await page.waitForTimeout(500);
  console.log('  renamed unused item:', await page.locator('#tb tr', { hasText: 'VITAMIN C 1000MG' }).count() === 1);
  await page.locator('#tb tr', { hasText: 'ITM-C300' }).locator('[data-edit]').click(); await page.waitForSelector('dialog [name=name]');
  console.log('  used item name locked:', (await page.locator('dialog [name=name]').getAttribute('readonly')) !== null);
  await page.click('dialog button[value=cancel]'); await page.waitForTimeout(200);
  const refused = await page.evaluate(async () => { const db = await import('./js/db.js'); const it = (await db.all('items')).find((i) => i.code === 'ITM-C300');
    try { await db.saveMaster('items', { ...it, name: 'X' }, 'test'); return false; } catch (e) { return e.message; } });
  console.log('  database refuses rename of used item:', refused);

  step('deactivate a pharmacy with a balance: hidden from invoices, kept in accounts and vouchers');
  await page.goto(URL + '#/customers'); await page.waitForSelector('[data-edit]');
  await page.locator('#tb tr', { hasText: 'C-0100' }).locator('[data-edit]').click(); await page.waitForSelector('dialog [name=active]');
  await page.selectOption('dialog [name=active]', 'false');
  await page.click('dialog button[value=save]'); await page.waitForTimeout(600);
  console.log('  inactive pill:', await page.locator('#tb tr', { hasText: 'C-0100' }).locator('.pill').count() === 1);
  await page.goto(URL + '#/new/SI'); await page.waitForSelector('#party');
  console.log('  in invoice list:', (await page.locator('#dlParties option').evaluateAll((o) => o.map((x) => x.value))).some((v) => v.startsWith('C-0100')));
  await page.goto(URL + '#/new/RV'); await page.waitForSelector('#party');
  console.log('  in receipt list:', (await page.locator('#dlParties option').evaluateAll((o) => o.map((x) => x.value))).some((v) => v.startsWith('C-0100')));
  await page.goto(URL + '#/tb'); await page.waitForTimeout(300);
  console.log('  trial balance still balanced:', await page.locator('.pill.ok').count() === 1);

  step('mobile width');
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(URL + '#/dashboard'); await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/5-mobile.png', fullPage: false });
  console.log('  horizontal overflow:', await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));

  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
