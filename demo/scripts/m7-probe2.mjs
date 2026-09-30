// probe: why doesn't jump(0) reach "usable"?
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 800 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)))
await page.goto('http://localhost:5174/')
await page.waitForSelector('.vlist-inner', { timeout: 5000 })
await page.waitForTimeout(1800)

await page.evaluate(() => window.__vlist.jump(0))
for (let k = 0; k < 25; k++) {
  const s = await page.evaluate(() => {
    const st = window.__vlist.state()
    const el = document.querySelector('[data-vrow="0"]')
    const scr = document.querySelector('.vlist')
    return {
      st: Math.round(scr.scrollTop),
      vs: st.visibleStart,
      ve: st.visibleEnd,
      ms: st.mountedStart,
      me: st.mountedEnd,
      row0: el ? (el.classList.contains('row-loaded') ? 'loaded' : 'skel') : 'none',
      mode: st.mode,
      m: st.metrics,
    }
  })
  console.log(`t=${k * 200}ms`, JSON.stringify(s))
  if (s.m.timeToItem1 !== null) break
  await page.waitForTimeout(200)
}
const tail = await page.evaluate(() => window.__vlist.log().slice(-20))
console.log(JSON.stringify(tail))
await browser.close()
