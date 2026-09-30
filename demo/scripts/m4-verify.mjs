// Scratch M4 verification (not committed): skeleton map, tail loaded, pinned bottom.
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5174/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto(url)
await page.waitForSelector('.vlist-inner', { timeout: 5000 })
// outline (30ms) + tail load (150-600ms) + settle
await page.waitForTimeout(1500)

const boot = await page.evaluate(() => {
  const scroller = document.querySelector('.vlist')
  const rows = [...document.querySelectorAll('[data-vrow]')]
  const loaded = rows.filter((r) => r.classList.contains('row-loaded'))
  return {
    status: document.querySelector('.vlist-status')?.textContent,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    scrollTop: Math.round(scroller.scrollTop),
    mounted: rows.length,
    loadedMounted: loaded.length,
    lastRowLoaded: rows.length ? rows[rows.length - 1].classList.contains('row-loaded') : false,
    lastRowNo: rows.length ? rows[rows.length - 1].querySelector('.row-no')?.textContent : null,
    badge: document.querySelector('.mode-badge')?.textContent,
  }
})
console.log('== after boot ==', JSON.stringify(boot, null, 1))

// pinned to bottom within 4px?
const distBottom = boot.scrollHeight - boot.clientHeight - boot.scrollTop
console.log('pinned to bottom:', distBottom <= 4 ? 'PASS' : `FAIL (${distBottom}px from bottom)`)

// tail loaded: last mounted rows are real content
console.log('tail loaded:', boot.lastRowLoaded && boot.loadedMounted >= 40 ? 'PASS' : 'FAIL')
console.log('mounted rows bounded (<150):', boot.mounted < 150 ? 'PASS' : `FAIL (${boot.mounted})`)
console.log('scrollbar range ~20M px:', boot.scrollHeight > 5_000_000 ? 'PASS' : `FAIL (${boot.scrollHeight})`)

// scroll to the middle -> skeletons everywhere, mounted stays bounded
await page.evaluate(() => {
  const s = document.querySelector('.vlist')
  s.scrollTop = s.scrollHeight / 2
})
await page.waitForTimeout(700)
const mid = await page.evaluate(() => {
  const scroller = document.querySelector('.vlist')
  const rows = [...document.querySelectorAll('[data-vrow]')]
  const skeletons = rows.filter((r) => !r.classList.contains('row-loaded'))
  const firstVisible = document.elementFromPoint(640, 100)?.closest('[data-vrow]')
  return {
    scrollTop: Math.round(scroller.scrollTop),
    mounted: rows.length,
    skeletons: skeletons.length,
    visibleTopRow: firstVisible?.querySelector('.row-no')?.textContent ?? null,
    visibleTopIsSkeleton: firstVisible ? !firstVisible.classList.contains('row-loaded') : null,
    mode: document.querySelector('.mode-badge')?.textContent,
  }
})
console.log('== after jump to middle ==', JSON.stringify(mid, null, 1))
console.log('skeletons visible in middle:', mid.skeletons >= mid.mounted - 5 ? 'PASS' : 'FAIL')
console.log('mode free after scrolling up:', mid.mode === 'free' ? 'PASS' : 'FAIL')

await page.screenshot({ path: '/tmp/vlist-m4-middle.png' })

// scroll back to bottom -> pinned again
await page.evaluate(() => {
  const s = document.querySelector('.vlist')
  s.scrollTop = s.scrollHeight
})
await page.waitForTimeout(700)
const end = await page.evaluate(() => {
  const s = document.querySelector('.vlist')
  return {
    distBottom: Math.round(s.scrollHeight - s.clientHeight - s.scrollTop),
    mode: document.querySelector('.mode-badge')?.textContent,
  }
})
console.log('== back at bottom ==', JSON.stringify(end))
console.log('re-pinned:', end.mode === 'pinned' && end.distBottom <= 4 ? 'PASS' : 'FAIL')

console.log('page errors:', errors.length === 0 ? 'none' : errors)
await page.screenshot({ path: '/tmp/vlist-m4-bottom.png' })
await browser.close()
