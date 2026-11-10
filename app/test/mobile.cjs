// Phone run: iPhone 13 emulation, taps only (no F-keys)
const { chromium, devices } = require('playwright');
const OUT = process.env.SHOTS || require('os').tmpdir() + '/ledger-mobile';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  for (const lang of ['ar', 'en']) {
    const ctx = await b.newContext({ ...devices['iPhone 13'] });
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
    await p.locator('dialog.lookup tbody tr').first().tap(); await p.waitForTimeout(300);
    console.log(lang, 'party:', await p.inputValue('#party'));
    await p.tap('#cLook'); await p.waitForTimeout(400);
    await p.locator('dialog.lookup tbody tr').nth(1).tap(); await p.waitForTimeout(300);
    await p.fill('#cQty', '40'); await p.fill('#cBonus', '8'); await p.tap('#cAdd'); await p.waitForTimeout(300);
    await p.fill('#cItem', '1001'); await p.locator('#cItem').press('Enter'); await p.waitForTimeout(300);
    await p.locator('#cPrice').press('Enter'); await p.keyboard.type('10'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    await p.fill('#cItem', 'omep'); await p.locator('#cItem').press('Enter'); await p.waitForTimeout(300);
    const r1 = p.locator('#lines tbody tr.found').first();
    await r1.locator('[data-k=expiry]').fill('2026-12');
    console.log(lang, 'lines:', await p.locator('#lines tbody tr.found').count(), '| first:', await r1.locator('[data-k=code]').inputValue(), await r1.locator('[data-k=name]').inputValue(), '| total bar:', await p.textContent('#barTotal'), '| composer holds:', await p.textContent('#cName b'));
    await p.tap('#cClear');
    console.log(lang, 'bar balance:', (await p.textContent('#barBal')).trim(), '| on hand on line:', (await r1.locator('.oh').textContent()).trim(), '| sheet closed:', !(await p.evaluate(() => document.body.classList.contains('sheet-open'))));
    console.log(lang, 'page scrolls sideways:', await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
    await p.screenshot({ path: `${OUT}/${lang}-3-invoice.png` });
    await p.tap('#toNotes'); await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/${lang}-3b-sheet.png` }); await p.tap('#grab'); await p.waitForTimeout(400);
    await p.tap('#postprint'); await p.waitForTimeout(1200);
    console.log(lang, 'posted:', (await p.textContent('h1')).replace(/\s+/g, ' '), '| printed:', await p.evaluate(() => window.__printed));
    await p.screenshot({ path: `${OUT}/${lang}-4-posted.png` });
    await p.tap('#tabs a[data-tab=inv]'); await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/${lang}-5-docs.png` });
    await p.goto(U + '#/new/RV'); await p.waitForTimeout(600);
    await p.tap('.lkbtn[data-lk=party]'); await p.waitForTimeout(400); await p.locator('dialog.lookup tbody tr').first().tap(); await p.waitForTimeout(400);
    await p.fill('#amount', '250'); await p.waitForTimeout(200);
    console.log(lang, 'voucher bar balance:', (await p.textContent('#barBal')).trim());
    await p.screenshot({ path: `${OUT}/${lang}-6-voucher.png` });
    console.log(lang, 'errors:', errors.length ? errors : 'none');
    await ctx.close();
  }
  await b.close();
})();
