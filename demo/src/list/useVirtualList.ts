/**
 * Core virtualizer hook: outline -> skeleton map, tail load, mounted range,
 * spacers from the Fenwick tree, measurement, and pinned-to-bottom mode.
 *
 * Layout: `[top spacer][mounted rows in normal flow][bottom spacer]` inside a
 * scroll container with `overflow-anchor: none`.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Payload } from './types'
import { expandOutline, HeightsStore } from './heights'
import { planTail } from './planner'
import type { MockApi } from '../mock/api'

export type ListMode = 'pinned' | 'free'

export interface VirtualListState {
  ready: boolean
  n: number
  mode: ListMode
  loadedCount: number
  scrollTop: number
  viewportH: number
  visibleStart: number
  visibleEnd: number
  mountedStart: number
  mountedEnd: number
  topSpacer: number
  bottomSpacer: number
  heights: HeightsStore | null
  payloadOf: (i: number) => Payload | undefined
  setScroller: (el: HTMLDivElement | null) => void
  onScroll: () => void
}

const EMPTY_RANGE = {
  visibleStart: 0,
  visibleEnd: -1,
  mountedStart: 0,
  mountedEnd: -1,
  topSpacer: 0,
  bottomSpacer: 0,
}

export function useVirtualList(api: MockApi): VirtualListState {
  const [heights, setHeights] = useState<HeightsStore | null>(null)
  const [payloads, setPayloads] = useState<ReadonlyMap<number, Payload>>(() => new Map())
  const [rev, setRev] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)
  const [mode, setMode] = useState<ListMode>('pinned')

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const observedRef = useRef(new Set<HTMLElement>())
  const heightsRef = useRef<HeightsStore | null>(null)
  const payloadsRef = useRef(payloads)
  const rafRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    heightsRef.current = heights
    payloadsRef.current = payloads
  })

  // 1. outline: the index-only query that reserves the whole scroll range
  useEffect(() => {
    let alive = true
    api.getOutline().then((outline) => {
      if (!alive) return
      setHeights(new HeightsStore(expandOutline(outline)))
    })
    return () => {
      alive = false
    }
  }, [api])

  // 2. initial load: the newest tail, then calibrate estimates from it
  useEffect(() => {
    if (!heights) return
    let alive = true
    const tail = planTail(heights.n)
    const ids: number[] = []
    for (let i = tail.start; i <= tail.end; i++) ids.push(i)
    api.getItems(ids).then((items) => {
      if (!alive || items.length === 0) return
      setPayloads((prev) => {
        const m = new Map(prev)
        for (const p of items) m.set(p.index, p)
        return m
      })
      heights.calibrate()
      heights.flushCalibration(heights.n)
      setRev((r) => r + 1)
    })
    return () => {
      alive = false
    }
  }, [api, heights])

  // 3. scroller attachment: one shared ResizeObserver for viewport + rows
  const setScroller = useCallback((el: HTMLDivElement | null) => {
    scrollerRef.current = el
    if (el) {
      if (roRef.current === null) {
        roRef.current = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const t = entry.target as HTMLElement
            if (t === scrollerRef.current) {
              const h = t.clientHeight
              setViewportH((prev) => (prev === h ? prev : h))
              continue
            }
            const i = Number(t.dataset.vrow)
            const hs = heightsRef.current
            if (Number.isFinite(i) && hs !== null && payloadsRef.current.has(i)) {
              if (hs.measure(i, t.offsetHeight)) setRev((r) => r + 1)
            }
          }
        })
      }
      roRef.current.observe(el)
      setViewportH(el.clientHeight)
    } else if (roRef.current !== null) {
      roRef.current.disconnect()
      roRef.current = null
      observedRef.current.clear()
    }
  }, [])

  // 4. scroll: rAF-throttled range updates + pinned/free transitions
  const onScroll = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const el = scrollerRef.current
      if (!el) return
      setScrollTop(el.scrollTop)
      const distFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop
      setMode(distFromBottom <= 4 ? 'pinned' : 'free')
    })
  }, [])

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  const range = useMemo(() => {
    if (!heights || viewportH <= 0) return EMPTY_RANGE
    const n = heights.n
    if (n === 0) return EMPTY_RANGE
    const visibleStart = heights.indexAtOffset(scrollTop)
    const visibleEnd = Math.min(n - 1, heights.indexAtOffset(scrollTop + viewportH - 1))
    const mountedStart = heights.indexAtOffset(Math.max(0, scrollTop - viewportH))
    const mountedEnd = Math.min(n - 1, heights.indexAtOffset(scrollTop + 2 * viewportH))
    const topSpacer = heights.offsetOf(mountedStart)
    const bottomSpacer = Math.max(0, heights.total() - heights.offsetOf(mountedEnd + 1))
    return { visibleStart, visibleEnd, mountedStart, mountedEnd, topSpacer, bottomSpacer }
  }, [heights, viewportH, scrollTop, rev])

  // 5. measure mounted real rows pre-paint; keep row observation in sync
  useLayoutEffect(() => {
    const hs = heights
    const el = scrollerRef.current
    const ro = roRef.current
    if (!hs || !el) return
    let changed = false
    const seen = new Set<HTMLElement>()
    el.querySelectorAll<HTMLElement>('[data-vrow]').forEach((rowEl) => {
      seen.add(rowEl)
      if (ro !== null && !observedRef.current.has(rowEl)) {
        ro.observe(rowEl)
        observedRef.current.add(rowEl)
      }
      const i = Number(rowEl.dataset.vrow)
      if (Number.isFinite(i) && payloads.has(i) && hs.measure(i, rowEl.offsetHeight)) changed = true
    })
    if (ro !== null) {
      for (const prev of observedRef.current) {
        if (!seen.has(prev)) {
          ro.unobserve(prev)
          observedRef.current.delete(prev)
        }
      }
    }
    if (changed) setRev((r) => r + 1)
  }, [heights, payloads, range.mountedStart, range.mountedEnd, viewportH, rev])

  // 6. pinned mode: keep the newest content on screen after every change
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || mode !== 'pinned') return
    const max = el.scrollHeight - el.clientHeight
    if (max > 0 && el.scrollTop !== max) el.scrollTop = max
  }, [mode, heights, rev, viewportH, payloads])

  const payloadOf = useCallback((i: number) => payloads.get(i), [payloads])

  return {
    ready: heights !== null,
    n: heights?.n ?? 0,
    mode,
    loadedCount: payloads.size,
    scrollTop,
    viewportH,
    visibleStart: range.visibleStart,
    visibleEnd: range.visibleEnd,
    mountedStart: range.mountedStart,
    mountedEnd: range.mountedEnd,
    topSpacer: range.topSpacer,
    bottomSpacer: range.bottomSpacer,
    heights,
    payloadOf,
    setScroller,
    onScroll,
  }
}
