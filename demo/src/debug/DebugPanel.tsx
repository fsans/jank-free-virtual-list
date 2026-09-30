/**
 * Right-side debugger panel (the human view): minimap, live stats, toggles
 * and sliders, and a filtered view of the structured event log with a JSON
 * download. Collapses to a strip when not needed.
 */
import { useState } from 'react'
import type { MockApi } from '../mock/api'
import type { VirtualListState } from '../list/useVirtualList'
import { Minimap } from './Minimap'

interface Props {
  v: VirtualListState
  api: MockApi
  dbgIndex: boolean
  dbgAnchor: boolean
  onDbgIndex: (b: boolean) => void
  onDbgAnchor: (b: boolean) => void
}

const fmt = (n: number) => n.toLocaleString()

export function DebugPanel({ v, api, dbgIndex, dbgAnchor, onDbgIndex, onDbgAnchor }: Props) {
  const [open, setOpen] = useState(true)
  const [filter, setFilter] = useState('')
  const [latMax, setLatMax] = useState(api.latencyMax)
  const [variance, setVariance] = useState(1)

  if (!open) {
    return (
      <button className="dbg-collapsed" onClick={() => setOpen(true)} title="open debugger">
        ◀ dbg
      </button>
    )
  }

  const mounted = v.mountedEnd >= v.mountedStart ? v.mountedEnd - v.mountedStart + 1 : 0
  let anchor = '—'
  if (v.visibleEnd >= v.visibleStart) {
    for (let i = v.visibleStart; i <= v.visibleEnd; i++) {
      if (v.isLoaded(i)) {
        anchor = `#${i + 1} loaded`
        break
      }
    }
    if (anchor === '—') anchor = `#${v.visibleStart + 1} skeleton`
  }
  const m = v.metrics()
  const events = v.log.events()
  const filtered = filter
    ? events.filter((e) => e.event.includes(filter) || JSON.stringify(e).includes(filter))
    : events
  const shown = filtered.slice(-160)

  const download = () => {
    const blob = new Blob([JSON.stringify(events, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'vlist-log.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <aside className="dbg">
      <div className="dbg-head">
        <span>debugger</span>
        <button onClick={() => setOpen(false)} title="collapse">
          ▶
        </button>
      </div>

      <Minimap v={v} />

      <div className="dbg-stats">
        <span>{fmt(v.n)} items</span>
        <span>{mounted} mounted</span>
        <span>{fmt(v.loadedCount)} loaded</span>
        <span>cache {fmt(v.cacheSize)}</span>
        <span>
          {v.inflight} in-flight · {v.queueLength} queued
        </span>
        <span>mode {v.mode}</span>
        <span>anchor {anchor}</span>
        <span>scrollTop {Math.round(v.scrollTop)}</span>
        <span>total {fmt(Math.round(v.heights?.total() ?? 0))}px</span>
        <span>CLS {m.cls ?? 0}</span>
        <span>ttfr {m.ttfr ?? '—'}ms</span>
        <span>jump {m.lastJumpMs ?? '—'}ms</span>
        <span>to#1 {m.timeToItem1 ?? '—'}ms</span>
      </div>

      <div className="dbg-controls">
        <label>
          <input
            type="checkbox"
            checked={v.compensation}
            onChange={(e) => v.setCompensation(e.target.checked)}
          />
          compensation
        </label>
        <label>
          <input
            type="checkbox"
            checked={v.streaming}
            onChange={(e) => v.setStreaming(e.target.checked)}
          />
          streaming
        </label>
        <label>
          <input type="checkbox" checked={dbgIndex} onChange={(e) => onDbgIndex(e.target.checked)} />
          row overlays
        </label>
        <label>
          <input
            type="checkbox"
            checked={dbgAnchor}
            onChange={(e) => onDbgAnchor(e.target.checked)}
          />
          anchor outline
        </label>
        <label className="dbg-slider">
          latency ≤{latMax}ms
          <input
            type="range"
            min={100}
            max={2500}
            step={50}
            value={latMax}
            onChange={(e) => {
              const val = Number(e.target.value)
              setLatMax(val)
              api.setLatency(100, val)
            }}
          />
        </label>
        <button
          className="dbg-preset"
          onClick={() => {
            api.setLatency(1500, 2600)
            setLatMax(2600)
          }}
        >
          slow 3G
        </button>
        <label className="dbg-slider">
          height variance ×{variance.toFixed(1)}
          <input
            type="range"
            min={0.2}
            max={2}
            step={0.1}
            value={variance}
            onChange={(e) => {
              const val = Number(e.target.value)
              setVariance(val)
              v.setOpts({ variance: val })
            }}
          />
        </label>
      </div>

      <div className="dbg-log">
        <div className="dbg-log-head">
          <input
            placeholder="filter events…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button onClick={download} title="download full log as JSON">
            ↓ json
          </button>
        </div>
        <div className="dbg-log-list">
          {shown
            .map((e, k) => (
              <div key={k} className="dbg-ev">
                <span className="dbg-ev-name">{e.event}</span>
                <span className="dbg-ev-body">{summarize(e)}</span>
              </div>
            ))
            .reverse()}
        </div>
      </div>
    </aside>
  )
}

function summarize(e: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, val] of Object.entries(e)) {
    if (k === 't' || k === 'event') continue
    if (k === 'ids' && Array.isArray(val)) {
      parts.push(`ids[${val.length}]`)
      continue
    }
    if (k === 'anchor' && val !== null && typeof val === 'object') {
      parts.push(`anchor=${(val as { id?: string }).id ?? '?'}`)
      continue
    }
    parts.push(`${k}=${typeof val === 'number' ? Math.round(val * 100) / 100 : String(val)}`)
  }
  return parts.join(' ')
}
