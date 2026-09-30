// Focused probe: what exactly moves content at a scroll step?
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)))

await page.goto('http://localhost:5174/')
await page.waitForSelector('.vlist-inner', { timeout: 5000 })
await page.waitForTimeout(1500)
await page.evaluate(() => {
  const s = document.querySelector('.vlist')
  s.scrollTop = s.scrollHeight / 2
})
await page.waitForTimeout(2000)

const pick = () =>
  page.evaluate(() => {
    const scroller = document.querySelector('.vlist')
    const vpTop = scroller.getBoundingClientRect().top
    const vpBottom = vpTop + scroller.clientHeight
    for (const r of document.querySelectorAll('[data-vrow]')) {
      const rc = r.getBoundingClientRect()
      if (rc.bottom > vpTop && rc.top < vpBottom && r.classList.contains('row-loaded')) {
        return r.dataset.vrow
      }
    }
    return null
  })

const tracked = await pick()
console.log('tracking row', tracked)

for (let k = 0; k < 3; k++) {
  const r = await page.evaluate((idx) => {
    const scroller = document.querySelector('.vlist')
    const el = document.querySelector(`[data-vrow="${idx}"]`)
    const st0 = window.__vlist.state()
    const before = el.getBoundingClientRect().top
    const spacerBefore = st0.topSpacer
    const msBefore = st0.mountedStart
    scroller.scrollTop -= 200
    const afterScroll = el.getBoundingClientRect().top
    return new Promise((resolve) => {
      setTimeout(() => {
        const st1 = window.__vlist.state()
        resolve({
          before,
          afterScroll,
          afterSettle: el.getBoundingClientRect().top,
          scrollMove: afterScroll - before,
          settleMove: el.getBoundingClientRect().top - afterScroll,
          spacerBefore,
          spacerAfter: st1.topSpacer,
          spacerDelta: st1.topSpacer - spacerBefore,
          msBefore,
          msAfter: st1.mountedStart,
          domTopModel: (() => {
            const domTop = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
            return Math.round((domTop - st1.offsetOf(Number(idx))) * 10) / 10
          })(),
        })
      }, 200)
    })
  }, tracked)
  console.log(`step ${k + 1}:`, JSON.stringify(r))
  await page.waitForTimeout(450)
}
await browser.close()
