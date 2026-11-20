// Screens for Rabee: «اليوم» (the cover), the segment sheet with «شوف إزاي اتعملت», and the work sheet, at 390 and 1440, light and dark, 2×.
// Usage (server on 4317 or PORT, Playwright on NODE_PATH): node scripts/shots-inspo.cjs <out-dir> <segment-id> [suffix]
const { chromium } = require('playwright');
const [O, seg, suf = ''] = process.argv.slice(2);
const B = 'http://127.0.0.1:' + (process.env.PORT || 4317);
(async () => { const b = await chromium.launch();
  for (const [w, h] of [[390, 844], [1440, 900]]) for (const scheme of ['light', 'dark']) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: scheme });
    const snap = async n => { await p.waitForTimeout(1800); await p.screenshot({ path: `${O}/${w}-${scheme}-${n}${suf}.png` }); };
    await p.goto(`${B}/#/home`); await snap('today');
    await p.goto('about:blank'); await p.goto(`${B}/#/board/iatw-v44/${seg}`); await p.waitForSelector('.fit-cell', { timeout: 10000 }).catch(() => {}); await snap('sheet');
    const c = p.locator('.fit-cell').first(); if (await c.count()) { await c.click(); await snap('inspo-sheet'); }
    await p.close(); }
  await b.close(); })();
