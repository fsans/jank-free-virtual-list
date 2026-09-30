// quick probe: what's happening with loads?
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)))
page.on('console', (m) => console.log('console.' + m.type() + ':', m.text()))

await page.goto('http://localhost:5174/')
await page.waitForSelector('.vlist-inner', { timeout: 5000 })
await page.waitForTimeout(2000)
console.log('boot status:', await page.textContent('.vlist-status'))

await page.evaluate(() => {
  const s = document.querySelector('.vlist')
  s.scrollTop = s.scrollHeight / 2
})
await page.waitForTimeout(500)
console.log('mid+500ms status:', await page.textContent('.vlist-status'))
await page.waitForTimeout(1500)
console.log('mid+2s status:', await page.textContent('.vlist-status'))
const probe = await page.evaluate(() => {
  const s = document.querySelector('.vlist')
  return {
    scrollTop: Math.round(s.scrollTop),
    scrollHeight: s.scrollHeight,
    loadedInDom: document.querySelectorAll('.row-loaded').length,
    mounted: document.querySelectorAll('[data-vrow]').length,
  }
})
console.log('probe:', JSON.stringify(probe))
await browser.close()
