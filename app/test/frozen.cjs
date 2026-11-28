// Frozen items, in Chromium. Serve app/ first:  python3 -m http.server 8765  (inside app/)
const { chromium } = require('playwright');
const OUT = process.env.SHOTS || require('os').tmpdir() + '/ledger-shots';
require('fs').mkdirSync(OUT, { recursive: true });
const URL = process.env.APP_URL || 'http://127.0.0.1:8765/index.html';
(async () => {
  const browser = await chromium.launch();
  const bad = []; const ok = (name, v) => { console.log(v ? '  ok ' : '  BAD', name); if (!v) bad.push(name); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => { window.print = () => {}; if (!localStorage.getItem('lang')) localStorage.setItem('lang', 'en'); });
  const toast = async () => (await page.textContent('#toast')).trim();
  const code = (n = 1) => `#lines tbody tr:nth-child(${n}) [data-k=code]`, name = (n = 1) => `#lines tbody tr:nth-child(${n}) [data-k=name]`;
  const rowOf = (c) => page.locator('#tb tr', { has: page.locator('b', { hasText: new RegExp('^' + c + '$') }) });
  const newSI = async () => { await page.goto(URL + '#/dashboard'); await page.waitForTimeout(350); await page.goto(URL + '#/new/SI'); await page.waitForSelector('#party'); await page.waitForTimeout(250); await page.fill('#party', 'C-0100'); await page.keyboard.press('Enter'); await page.waitForTimeout(150); };

  await page.goto(URL); await page.waitForSelector('h1');
  await page.goto(URL + '#/settings'); await page.waitForSelector('#toAdmin'); await page.click('#toAdmin'); await page.waitForSelector('#saveCo');
  await page.goto(URL + '#/import'); await page.waitForSelector('#json');
  await page.fill('#json', JSON.stringify({ items: [
    { code: '1001', name: 'ALPHA 10', buyPrice: 5, pricePharmacist: 8, openingQty: 10 },
    { code: '1002', name: 'BETA NO STOCK', buyPrice: 5, pricePharmacist: 8 },
    { code: '1003', name: 'GAMMA 50', buyPrice: 5, pricePharmacist: 8, openingQty: 50 }],
    customers: [{ code: 'C-0100', name: 'Test Pharmacy', region: 'gaza' }], suppliers: [{ code: 'S-1', name: 'Test Supplier' }] }));
  await page.click('#importJson'); await page.click('#doImport'); await page.waitForTimeout(900);

  console.log('▶ an item with no stock is frozen by itself');
  await page.goto(URL + '#/items'); await page.waitForSelector('#tb tr');
  ok('1002 is marked frozen in the directory', await rowOf('1002').evaluate((tr) => tr.classList.contains('frz') && !!tr.querySelector('.pill.frz')));
  ok('1001 and 1003 are not', !(await rowOf('1001').evaluate((tr) => tr.classList.contains('frz'))) && !(await rowOf('1003').evaluate((tr) => tr.classList.contains('frz'))));
  ok('the counter says 1', (await page.textContent('#fzOnly b')).trim() === '1');
  await page.click('#fzOnly'); ok('the frozen filter leaves one row', await page.locator('#tb tr:visible').count() === 1); await page.click('#fzOnly');
  ok('its colour is crimson', await rowOf('1002').locator('span[dir=auto]').evaluate((el) => getComputedStyle(el).color) === 'rgb(193, 18, 31)');

  console.log('▶ a frozen item takes no new sales invoice');
  await newSI();
  await page.fill(code(), '1002'); await page.waitForTimeout(200);
  ok('typed code is refused with a message', (await page.inputValue(name())) === '' && /is frozen/.test(await toast()));
  ok('it is not offered in the names list', !(await page.locator('#dlNames option').evaluateAll((o) => o.map((x) => x.value))).includes('BETA NO STOCK'));
  await page.fill(code(), '1001'); await page.waitForTimeout(150);
  ok('an item with stock is taken', (await page.inputValue(name())) === 'ALPHA 10');
  await page.fill('#lines tbody tr:nth-child(1) [data-k=qty]', '10'); await page.keyboard.press('F4'); await page.waitForTimeout(700);
  ok('saved as a draft holding all 10', /Draft saved/.test(await toast()));
  const draftHash = await page.evaluate(() => location.hash);

  console.log('▶ a saved invoice that holds the last of it freezes the item for the next invoice');
  await page.goto(URL + '#/items'); await page.waitForSelector('#tb tr');
  ok('1001 is now frozen (held by the saved invoice)', await rowOf('1001').evaluate((tr) => tr.classList.contains('frz')));
  await newSI(); await page.fill(code(), '1001'); await page.waitForTimeout(200);
  ok('a second invoice cannot take it', (await page.inputValue(name())) === '' && /is frozen/.test(await toast()));
  await page.keyboard.press('F2'); await page.waitForSelector('dialog.lookup tbody tr');
  ok('the lookup still lists it, in crimson, tagged', await page.locator('dialog.lookup tr.frz .pill.frz').count() === 2);
  await page.click('dialog.lookup [data-x]');
  await page.goto(URL + '#/dashboard'); if (await page.locator('dialog [data-v=discard], dialog button[value=discard]').count()) await page.locator('dialog [data-v=discard], dialog button[value=discard]').first().click();
  await page.goto(URL + draftHash); await page.waitForSelector('#party'); await page.waitForTimeout(300);
  ok('the saved invoice keeps its own line', (await page.inputValue(name())) === 'ALPHA 10');
  await page.keyboard.press('F4'); await page.waitForTimeout(700);
  ok('and saves again', /Draft saved/.test(await toast()));

  console.log('▶ a purchase still takes a frozen item, and stock brings it back');
  await page.goto(URL + '#/new/PI'); await page.waitForSelector('#party'); await page.waitForTimeout(250);
  await page.fill('#party', 'S-1'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  await page.fill(code(), '1002'); await page.waitForTimeout(150);
  ok('purchase invoice takes 1002', (await page.inputValue(name())) === 'BETA NO STOCK');
  await page.fill('#lines tbody tr:nth-child(1) [data-k=qty]', '7'); await page.fill('#lines tbody tr:nth-child(1) [data-k=price]', '5');
  await page.keyboard.press('F9'); await page.waitForTimeout(400);
  for (let i = 0; i < 3 && await page.locator('dialog.ask [data-v=yes]').count(); i++) { await page.click('dialog.ask [data-v=yes]'); await page.waitForTimeout(500); }
  await page.waitForTimeout(800);
  await page.goto(URL + '#/items'); await page.waitForSelector('#tb tr');
  const posted = await page.evaluate(async () => (await (await import('./js/db.js')).all('docs')).filter((d) => d.type === 'PI' && d.status === 'posted').length);
  ok('the purchase was posted', posted === 1);
  ok('1002 unfroze by itself', !(await rowOf('1002').evaluate((tr) => tr.classList.contains('frz'))));

  console.log('▶ the admin freezes and unfreezes by right-click');
  await rowOf('1003').click({ button: 'right' }); await page.waitForSelector('dialog.lmenu');
  ok('menu offers Freeze', await page.locator('dialog.lmenu [data-v=freeze]').count() === 1);
  await page.screenshot({ path: OUT + '/frozen-menu.png' });
  await page.click('dialog.lmenu [data-v=freeze]'); await page.waitForTimeout(600);
  ok('1003 is frozen though it has 50', await rowOf('1003').evaluate((tr) => tr.classList.contains('frz')));
  ok('the freeze is in the audit log', await page.evaluate(async () => (await (await import('./js/db.js')).all('audit')).some((a) => a.ref === 'items:1003' && /frozen: .*→ true/.test(a.detail))));
  await newSI(); await page.fill(code(), '1003'); await page.waitForTimeout(200);
  ok('no sale takes it', (await page.inputValue(name())) === '' && /is frozen/.test(await toast()));
  await page.goto(URL + '#/dashboard'); if (await page.locator('dialog [data-v=discard]').count()) await page.click('dialog [data-v=discard]');
  await page.goto(URL + '#/items'); await page.waitForSelector('#tb tr');
  await rowOf('1003').click(); await page.waitForSelector('dialog.card-dlg');
  ok('the card shows the red circle and who froze it', await page.locator('dialog.card-dlg .frzline.on .frzdot.on').count() === 1);
  await page.screenshot({ path: OUT + '/frozen-card.png' });
  await page.click('dialog.card-dlg [data-v=edit]'); await page.selectOption('dialog.card-dlg [data-ek=frozen]', 'false'); await page.click('dialog.card-dlg [data-v=save]'); await page.waitForTimeout(600);
  ok('unfrozen from the card', !(await rowOf('1003').evaluate((tr) => tr.classList.contains('frz'))));
  await rowOf('1001').click({ button: 'right' }); await page.waitForSelector('dialog.lmenu');
  ok('an automatic freeze says why', /nothing left to sell/.test(await page.textContent('dialog.lmenu')));
  await page.click('dialog.lmenu [data-v=cancel]');

  console.log('▶ the accountant cannot freeze');
  await page.goto(URL + '#/settings'); await page.waitForSelector('#toAcc'); await page.click('#toAcc'); await page.waitForTimeout(600);
  await page.goto(URL + '#/items'); await page.waitForSelector('#tb tr'); await page.waitForTimeout(400);
  console.log('  (role now:', (await page.textContent('#whoami')).replace(/\s+/g, ' ').trim(), '| hash', await page.evaluate(() => location.hash), ')');
  await rowOf('1003').click({ button: 'right' }); await page.waitForSelector('dialog.lmenu');
  ok('no Freeze button for the accountant', await page.locator('dialog.lmenu [data-v=freeze], dialog.lmenu [data-v=unfreeze]').count() === 0);
  await page.click('dialog.lmenu [data-v=cancel]');

  console.log('▶ Arabic, on a phone');
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => localStorage.setItem('lang', 'ar')); await page.reload();
  const p2 = page; await p2.waitForSelector('#tb tr'); await p2.waitForTimeout(500);
  ok('the tag reads مجمد', (await p2.locator('#tb .pill.frz').first().textContent()).trim() === 'مجمد');
  ok('no sideways scroll', await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await p2.screenshot({ path: OUT + '/frozen-items-ar-phone.png' });

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'ERRORS: none');
  console.log(bad.length ? `\n${bad.length} check(s) failed: ${bad.join(' | ')}` : '\nall frozen-item checks passed');
  await browser.close(); process.exit(bad.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
