// Does Chrome clamp the scroll range, or just single element heights?
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
const res = await page.evaluate(() => {
  // 1) single tall element
  const single = document.createElement('div')
  single.style.height = '50000000px'
  document.body.append(single)
  const singleH = single.getBoundingClientRect().height

  // 2) scroller with two sub-limit children (no wrapper)
  const scroller = document.createElement('div')
  scroller.style.cssText = 'overflow-y:auto;height:100px;width:100px'
  const a = document.createElement('div')
  a.style.height = '20000000px'
  const b = document.createElement('div')
  b.style.height = '20000000px'
  scroller.append(a, b)
  document.body.append(scroller)
  const twoChildren = scroller.scrollHeight

  // 3) scroller with one wrapper containing the same children
  const scroller2 = document.createElement('div')
  scroller2.style.cssText = 'overflow-y:auto;height:100px;width:100px'
  const wrap = document.createElement('div')
  wrap.append(a.cloneNode(), b.cloneNode())
  scroller2.append(wrap)
  document.body.append(scroller2)
  const withWrapper = scroller2.scrollHeight

  // 4) three 16M children
  const scroller3 = document.createElement('div')
  scroller3.style.cssText = 'overflow-y:auto;height:100px;width:100px'
  for (let k = 0; k < 4; k++) {
    const el = document.createElement('div')
    el.style.height = '16000000px'
    scroller3.append(el)
  }
  document.body.append(scroller3)
  const fourChildren = scroller3.scrollHeight

  return { singleH, twoChildren, withWrapper, fourChildren }
})
console.log(JSON.stringify(res, null, 1))
await browser.close()
