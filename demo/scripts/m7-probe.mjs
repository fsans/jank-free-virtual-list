// probe: what happens right after jump(123456)?
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 800 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)))
await page.goto('http://localhost:5174/')
await page.waitForSelector('.vlist-inner', { timeout: 5000 })
await page.waitForTimeout(1800)

await page.evaluate(() => window.__vlist.jump(123456))
for (let k = 0; k < 20; k++) {
  const s = await page.evaluate(() => {
    const st = window.__vlist.state()
    const el = document.querySelector('[data-vrow="123456"]')
    const scr = document.querySelector('.vlist')
    return {
      scrollTop: Math.round(scr.scrollTop),
      vs: st.visibleStart,
      ve: st.visibleEnd,
      ms: st.mountedStart,
      me: st.mountedEnd,
      rowExists: el !== null,
      loaded: el?.classList.contains('row-loaded') ?? false,
      mountedCount: document.querySelectorAll('[data-vrow]').length,
    }
  })
  console.log(`t=${k * 100}ms`, JSON.stringify(s))
  await page.waitForTimeout(100)
}
const jumps = await page.evaluate(() =>
  window.__vlist.log().filter((e) => e.event.startsWith('jump') || e.event === 'load_landed' || e.event === 'load_cancelled'),
)
console.log(JSON.stringify(jumps))
await browser.close()
