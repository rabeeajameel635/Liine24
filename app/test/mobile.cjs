// Phone run: iPhone 13 emulation, taps only (no F-keys)
const { chromium, devices } = require('playwright');
const OUT = process.env.SHOTS || require('os').tmpdir() + '/ledger-mobile';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  for (const lang of ['ar', 'en']) {
    const ctx = await b.newContext({ ...devices[process.env.PHONE || 'iPhone 13'] });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => d.accept());
    await p.addInitScript((l) => { localStorage.setItem('lang', l); sessionStorage.setItem('role', 'admin'); window.print = () => { window.__printed = (window.__printed || 0) + 1; }; }, lang);
    const U = process.env.APP_URL || 'http://127.0.0.1:8765/index.html';
    await p.goto(U + '#/import'); await p.waitForSelector('#json');
    await p.fill('#json', JSON.stringify({ items: [{ name: 'PARACETAMOL 500MG 20T', pricePharmacist: 12.5, buyPrice: 9, openingQty: 500 }, { name: 'OMEPRAZOLE 20MG 28CAP', pricePharmacist: 18.25, buyPrice: 14, openingQty: 300 }],
      customers: [{ name: 'صيدلية الشفاء', region: 'gaza', openingBalance: 1000 }, { name: 'صيدلية النور', region: 'middle' }] }));
    await p.tap('#importJson'); await p.tap('#doImport'); await p.waitForTimeout(700);
    await p.goto(U + '#/dashboard'); await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/${lang}-1-home.png` });
    await p.tap('#menuBtn'); await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/${lang}-2-menu.png` });
    await p.tap('#nav a[href="#/docs?type=SI"]'); await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/${lang}-2b-list.png` });
    await p.tap('#newDoc'); await p.waitForTimeout(500);
    console.log(lang, 'menu closed after tap:', !(await p.evaluate(() => document.body.classList.contains('menu-open'))));
    await p.tap('.lkbtn[data-lk=party]'); await p.waitForTimeout(400);
    console.log(lang, 'party list rows:', await p.locator('dialog.lookup tbody tr').count());
    await p.locator('dialog.lookup tbody tr').first().tap(); await p.waitForTimeout(400);
    console.log(lang, 'party:', await p.inputValue('#party'), '| region:', await p.textContent('#pRegion'));
    // fill the line itself: the search button in the empty row opens the item list
    await p.locator('#lines tbody tr:not(.found) .lkbtn').first().tap(); await p.waitForTimeout(400);
    await p.locator('dialog.lookup tbody tr').nth(1).tap(); await p.waitForTimeout(300);
    const rA = p.locator('#lines tbody tr.found').last();
    await rA.locator('[data-k=qty]').fill('40'); await rA.locator('[data-k=bonus]').fill('8'); await rA.locator('[data-k=bonus]').press('Enter'); await p.waitForTimeout(300);
    await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); await p.keyboard.type('10'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    await p.keyboard.press('Enter'); await p.keyboard.type('omep'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    console.log(lang, 'name search fills the line:', await p.locator('#lines tbody tr.found').last().locator('[data-k=name]').inputValue());
    for (const q of ['3', '4']) { await p.locator('#lines tbody tr.found').last().locator('[data-k=qty]').fill(q); await p.locator('#lines tbody tr.found').last().locator('[data-k=bonus]').press('Enter'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await p.waitForTimeout(150); }
    await p.locator('#lines tbody tr.found').last().locator('[data-k=qty]').fill('5'); await p.locator('#invdisc').fill('10'); await p.waitForTimeout(200);
    await p.screenshot({ path: `${OUT}/${lang}-3a-five-lines.png` });
    const box = await p.evaluate(() => { const w = document.querySelector('#lines').closest('.tablewrap'); return { h: w.clientHeight, scrolls: w.scrollHeight > w.clientHeight, fitsScreen: Math.round(document.querySelector('#finish').getBoundingClientRect().bottom) + ' / ' + window.innerHeight }; });
    console.log(lang, 'grid box:', JSON.stringify(box));
    await p.evaluate(() => window.scrollTo(0, 9999)); await p.waitForTimeout(150); await p.screenshot({ path: `${OUT}/${lang}-3c-bottom.png` });
    console.log(lang, 'buttons:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('#finish .rb')].map((b) => [b.id, Math.round(b.getBoundingClientRect().left)]))));
    await p.fill('#invdisc', '');
    for (let i = 0; i < 3; i++) { await p.locator('#lines tbody tr.found').last().locator('[data-del]').tap(); await p.waitForTimeout(150); }
    const r1 = p.locator('#lines tbody tr.found').first();
    await r1.locator('[data-k=expiry]').fill('2026-12');
    console.log(lang, 'lines:', await p.locator('#lines tbody tr.found').count(), '| first:', await r1.locator('[data-k=code]').inputValue(), await r1.locator('[data-k=name]').inputValue(), '| total:', await p.textContent('#gTotal'));
    console.log(lang, 'approved balance:', (await p.textContent('#balAfter')).trim(), '|', (await p.textContent('#balBefore')).trim(), '| on hand on line:', (await r1.locator('.oh').textContent()).trim());
    console.log(lang, 'totals box:', (await p.textContent('#totals')).replace(/\s+/g, ' ').trim());
    console.log(lang, 'page scrolls sideways:', await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
    await p.screenshot({ path: `${OUT}/${lang}-3-invoice.png` });
    await p.tap('#postprint'); await p.waitForTimeout(1200);
    console.log(lang, 'posted:', (await p.textContent('h1')).replace(/\s+/g, ' '), '| printed:', await p.evaluate(() => window.__printed));
    await p.screenshot({ path: `${OUT}/${lang}-4-posted.png` });
    await p.tap('#tabs a[data-tab=inv]'); await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/${lang}-5-docs.png` });
    await p.goto(U + '#/new/RV'); await p.waitForTimeout(600);
    await p.tap('.lkbtn[data-lk=party]'); await p.waitForTimeout(400); await p.locator('dialog.lookup tbody tr').first().tap(); await p.waitForTimeout(400);
    await p.fill('#amount', '250'); await p.waitForTimeout(200);
    console.log(lang, 'voucher balance:', (await p.textContent('#balAfter')).trim(), '|', (await p.textContent('#balBefore')).trim(), '| total:', await p.textContent('#gTotal'));
    await p.screenshot({ path: `${OUT}/${lang}-6-voucher.png` });
    await p.goto(U + '?s=1#/customers'); await p.waitForTimeout(700);
    await p.locator('a[href^="#/statement/"]').first().tap(); await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/${lang}-7-statement.png` });
    await p.locator('.chain a').first().tap(); await p.waitForTimeout(600);
    console.log(lang, 'chain statement → receipt, party filled:', await p.inputValue('#party'));
    console.log(lang, 'errors:', errors.length ? errors : 'none');
    await ctx.close();
  }
  await b.close();
})();
