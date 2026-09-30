/** The virtualized list: scroller + spacers + mounted rows + status strip + debugger. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { MockApi } from '../mock/api'
import { DebugPanel } from '../debug/DebugPanel'
import { Row } from '../rows/Row'
import { useVirtualList } from './useVirtualList'

declare global {
  interface Window {
    __vlist?: {
      log: () => readonly unknown[]
      state: () => Record<string, unknown>
      jump: (i: number) => void
      setOpts: (o: Record<string, unknown>) => void
      setStreaming: (on: boolean) => void
      jumpToLatest: () => void
    }
  }
}

export default function VirtualList({ api }: { api: MockApi }) {
  const v = useVirtualList(api)
  const hs = v.heights
  const vRef = useRef(v)
  vRef.current = v
  const scrollerEl = useRef<HTMLDivElement | null>(null)
  const gotoRef = useRef<HTMLInputElement>(null)
  const [dbgIndex, setDbgIndex] = useState(false)
  const [dbgAnchor, setDbgAnchor] = useState(false)

  useEffect(() => {
    window.__vlist = {
      log: () => vRef.current.log.events(),
      jump: (i) => vRef.current.jumpTo(i),
      setOpts: (o) => vRef.current.setOpts(o),
      setStreaming: (on) => vRef.current.setStreaming(on),
      jumpToLatest: () => vRef.current.jumpToLatest(),
      state: () => {
        const s = vRef.current
        return {
          n: s.n,
          mode: s.mode,
          compensation: s.compensation,
          streaming: s.streaming,
          newCount: s.newCount,
          loadedCount: s.loadedCount,
          cacheSize: s.cacheSize,
          inflight: s.inflight,
          queueLength: s.queueLength,
          scrollTop: s.scrollTop,
          viewportH: s.viewportH,
          visibleStart: s.visibleStart,
          visibleEnd: s.visibleEnd,
          mountedStart: s.mountedStart,
          mountedEnd: s.mountedEnd,
          topSpacer: s.topSpacer,
          bottomSpacer: s.bottomSpacer,
          total: s.heights?.total() ?? 0,
          metrics: s.metrics(),
          offsetOf: (i: number) => s.heights?.offsetOf(i) ?? 0,
          heightOf: (i: number) => s.heights?.heightOf(i) ?? 0,
        }
      },
    }
  }, [])

  // anchor-row outline (debugger): re-mark after every render while enabled
  useLayoutEffect(() => {
    const el = scrollerEl.current
    el?.querySelector('.anchor-hl')?.classList.remove('anchor-hl')
    if (!dbgAnchor || !el) return
    const vpTop = el.getBoundingClientRect().top
    const vpBot = vpTop + el.clientHeight
    let first: HTMLElement | null = null
    for (const r of el.querySelectorAll<HTMLElement>('[data-vrow]')) {
      const rc = r.getBoundingClientRect()
      if (rc.bottom <= vpTop || rc.top >= vpBot) continue
      if (first === null) first = r
      if (r.classList.contains('row-loaded')) {
        r.classList.add('anchor-hl')
        return
      }
    }
    first?.classList.add('anchor-hl')
  })

  const goToInput = () => {
    const i = Number(gotoRef.current?.value)
    if (Number.isFinite(i) && i >= 1) v.jumpTo(i - 1)
  }

  const rows: ReactNode[] = []
  if (hs) {
    for (let i = v.mountedStart; i <= v.mountedEnd; i++) {
      rows.push(
        <Row key={i} index={i} type={hs.typeOf(i)} payload={v.payloadOf(i)} height={hs.bakedHeightOf(i)} />,
      )
    }
  }

  return (
    <div className="vlist-wrap">
      <div className="vlist-status">
        <span>
          {v.n.toLocaleString()} items · {v.loadedCount} loaded · {rows.length} mounted · cache{' '}
          {v.cacheSize}
        </span>
        <span className="vlist-status-right">
          {v.inflight > 0 || v.queueLength > 0 ? (
            <span className="load-ind">
              {v.inflight} in flight · {v.queueLength} queued
            </span>
          ) : null}
          <button
            className={`comp-toggle ${v.compensation ? 'on' : 'off'}`}
            onClick={() => v.setCompensation(!v.compensation)}
            title="Toggle anchor-row scroll compensation (A/B the jank)"
          >
            compensation {v.compensation ? 'on' : 'off'}
          </button>
          <button
            className={`comp-toggle ${v.streaming ? 'on' : ''}`}
            onClick={() => v.setStreaming(!v.streaming)}
            title="Toggle the mock stream (appends + growth at the bottom)"
          >
            stream {v.streaming ? 'on' : 'off'}
          </button>
          <span className={`mode-badge mode-${v.mode}`}>{v.mode}</span>
        </span>
      </div>
      <div className="vlist-controls">
        <button onClick={() => v.jumpTo(0)}>top #1</button>
        <button onClick={v.jumpToLatest}>latest</button>
        <button onClick={() => v.jumpTo(Math.floor(Math.random() * v.n))}>random</button>
        <input
          ref={gotoRef}
          className="goto"
          type="number"
          min={1}
          max={v.n}
          placeholder="go to #"
          onKeyDown={(e) => {
            if (e.key === 'Enter') goToInput()
          }}
        />
        <button onClick={goToInput}>go</button>
      </div>
      <div className="vlist-body">
        <div
          className={`vlist${dbgIndex ? ' dbg-index' : ''}`}
          ref={(el) => {
            scrollerEl.current = el
            v.setScroller(el)
          }}
          onScroll={v.onScroll}
        >
          {v.ready ? (
            <div className="vlist-inner">
              <div className="vlist-spacer" style={{ height: v.topSpacer }} />
              {rows}
              <div className="vlist-spacer" style={{ height: v.bottomSpacer }} />
            </div>
          ) : (
            <div className="vlist-boot">loading outline…</div>
          )}
        </div>
        <DebugPanel
          v={v}
          api={api}
          dbgIndex={dbgIndex}
          dbgAnchor={dbgAnchor}
          onDbgIndex={setDbgIndex}
          onDbgAnchor={setDbgAnchor}
        />
      </div>
      {v.newCount > 0 ? (
        <button className="new-pill" onClick={v.jumpToLatest}>
          {v.newCount} new ↓
        </button>
      ) : null}
    </div>
  )
}
