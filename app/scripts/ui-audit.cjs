// UI rule audit (4 Nov): on every screen at 390 and 1440 px, ≤ 25 visible words before scrolling, no text under 17px, no button under 56px.
// Usage (server on 4317 or PORT, Playwright installed): node scripts/ui-audit.cjs <out-dir> <segment-id> [screen…]
// frames / takes: the segment sheet's «الكادرات» and «النسخ» panels (opened from their section titles).
// Rule audit per screen: visible words (no scroll) ≤ 25, every visible text ≥ 17px, every button ≥ 56px tall.
const { chromium } = require('playwright');
const [O, segId, ...only] = process.argv.slice(2);
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 4317);
const routes = [['gallery', 'gallery'], ['home', ''], ['song', 'board/iatw-v44'], ['sheet', `board/iatw-v44/${segId}`], ['frames', `board/iatw-v44/${segId}#board`], ['takes', `board/iatw-v44/${segId}#takes`], ['library', 'library/all'], ['viewer', 'library/all#v'], ['character', 'characters'], ['connections', 'connections'], ['studio', 'studio'], ['assistant', 'assistant'], ['montage', 'montage/iatw-v44'], ['inspiration', 'inspiration'], ['constants', 'constants'], ['setup', 'setup'], ['search', '#search']];
(async () => {
  const b = await chromium.launch(); const rows = [];
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    // LAYOUT_STANDIN: where feed thumbnails can't be reached (cloud container), measure with a same-size neutral image.
    // Layout measurement only: screenshots from this script are not shown as the real page.
    if (process.env.LAYOUT_STANDIN) await p.route(/admin\.promonews\.tv|directorsnotes\.com\/wp-content/, r => r.fulfill({ path: process.env.LAYOUT_STANDIN, contentType: 'image/jpeg' }));
    for (const [n, u] of routes) {
      if (only.length && !only.includes(n)) continue;
      if (n === 'viewer') { await p.goto(BASE + '/#/library/all'); await p.waitForTimeout(1800); await p.click('.tile >> nth=0'); }
      else if (n === 'search') { await p.goto(BASE + '/#/home'); await p.waitForTimeout(1500); await p.click(w < 821 ? '.tab-search' : '.side-search'); }
      else if (n === 'frames' || n === 'takes') { await p.goto('about:blank'); await p.goto(BASE + '/#/' + u.split('#')[0]); await p.waitForSelector('[data-panel]', { timeout: 8000 }); await p.click(`[data-panel="${u.split('#')[1]}"]`); }
      else { await p.goto(BASE + '/#/' + u); }
      await p.waitForTimeout(1800);
      const r = await p.evaluate(() => {
        const W = innerWidth, H = innerHeight, words = [], small = new Map(), btn = [];
        const vis = el => { for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; } return true; };
        const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let t; (t = tw.nextNode());) {
          const txt = t.textContent.trim(); if (!txt) continue; const el = t.parentElement; if (!vis(el)) continue;
          const cd = el.closest('details:not([open])'); if (cd && !el.closest('summary')) continue; // closed «تفاصيل»
          const rg = document.createRange(); rg.selectNodeContents(t); const rc = [...rg.getClientRects()].filter(c => c.width > 1 && c.bottom > 0 && c.top < H && c.right > 0 && c.left < W);
          if (!rc.length) continue;
          // covered by something on top? sample the first rect's centre
          const c = rc[0], top = document.elementFromPoint(Math.min(W - 1, Math.max(0, c.left + c.width / 2)), Math.min(H - 1, Math.max(0, c.top + c.height / 2)));
          if (top && !(top === el || el.contains(top) || top.contains(el))) continue; // covered by an overlay
          words.push(...txt.split(/\s+/).filter(x => /[\p{L}\p{N}]/u.test(x)));
          const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 17 && !el.closest('.tabbar')) small.set(txt.slice(0, 30), fs); // tab bar: Apple-style 13px exception
        }
        for (const e of document.querySelectorAll('button,a.gbtn,[role=button]')) { if (!vis(e)) continue; const rc = e.getBoundingClientRect(); if (rc.bottom < 0 || rc.top > H || rc.width === 0) continue; if (rc.height < 56 - 0.5 && rc.width < 56 - 0.5 || rc.height < 44) btn.push(`${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 18)} ${Math.round(rc.width)}×${Math.round(rc.height)}`); }
        return { n: words.length, words: words.join(' '), small: [...small].slice(0, 12), btn: btn.slice(0, 10) };
      });
      await p.screenshot({ path: `${O}/${w}-${n}.png` });
      rows.push(`${w} ${n}: words ${r.n}${r.n > 25 ? ' ✗' : ' ✓'} | small ${r.small.length} | btn ${r.btn.length}\n   ${r.words.slice(0, 260)}\n   small: ${r.small.map(([t, f]) => `${t}=${f}`).join(' · ').slice(0, 300)}\n   btn: ${r.btn.join(' · ').slice(0, 200)}`);
    }
    await p.close();
  }
  console.log(rows.join('\n')); await b.close();
})();
