/**
 * Minimap: a canvas strip covering the whole list. Each horizontal band maps
 * to a bucket of rows, colored by state — skeleton grey, loaded green,
 * in-flight amber, evicted-but-measured blue-grey. The viewport rectangle and
 * the current anchor row are overlaid; clicking jumps there.
 */
import { useEffect, useRef } from 'react'
import type { VirtualListState } from '../list/useVirtualList'

function colors(canvas: HTMLCanvasElement) {
  const cs = getComputedStyle(canvas)
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb
  return {
    skeleton: v('--mm-skeleton', '#2a333d'),
    loaded: v('--mm-loaded', '#7dd0a8'),
    inflight: v('--mm-inflight', '#f2c94c'),
    measured: v('--mm-measured', '#5b7484'),
    vp: v('--mm-vp', 'rgba(215,221,227,0.8)'),
    anchor: v('--mm-anchor', '#4f9cf9'),
  }
}

export function Minimap({ v }: { v: VirtualListState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const vRef = useRef(v)
  vRef.current = v

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = () => {
      const s = vRef.current
      const hs = s.heights
      const ctx = canvas.getContext('2d')
      if (!ctx || !hs || hs.n === 0) return
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0 || h === 0) return
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const COLORS = colors(canvas)
      const n = hs.n
      for (let y = 0; y < h; y++) {
        const i0 = Math.floor((y / h) * n)
        const i1 = Math.max(i0 + 1, Math.floor(((y + 1) / h) * n))
        let loaded = 0
        let inflight = 0
        let measuredOnly = 0
        for (let i = i0; i < i1; i++) {
          if (s.isInflight(i)) inflight++
          else if (s.isLoaded(i)) loaded++
          else if (s.isMeasured(i)) measuredOnly++
        }
        const total = i1 - i0
        let color = COLORS.skeleton
        if (inflight > 0) color = COLORS.inflight
        else if (loaded > total * 0.3) color = COLORS.loaded
        else if (measuredOnly > total * 0.3) color = COLORS.measured
        ctx.fillStyle = color
        ctx.fillRect(0, y, w, 1)
      }
      // viewport rectangle
      const total = hs.total()
      if (total > 0) {
        const y0 = (s.scrollTop / total) * h
        const y1 = ((s.scrollTop + s.viewportH) / total) * h
        ctx.strokeStyle = COLORS.vp
        ctx.lineWidth = 1
        ctx.strokeRect(0.5, y0 + 0.5, w - 1, Math.max(2, y1 - y0))
        // anchor marker line
        const anchor = anchorIndex(s)
        if (anchor !== null) {
          const ay = (hs.offsetOf(anchor) / total) * h
          ctx.strokeStyle = COLORS.anchor
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(0, ay)
          ctx.lineTo(w, ay)
          ctx.stroke()
        }
      }
    }
    draw()
    const iv = setInterval(draw, 350)
    return () => clearInterval(iv)
  }, [])

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = vRef.current
    const hs = s.heights
    const el = canvasRef.current
    if (!hs || !el || hs.n === 0) return
    const rect = el.getBoundingClientRect()
    const frac = (e.clientY - rect.top) / rect.height
    s.jumpTo(hs.indexAtOffset(frac * hs.total()))
  }

  return (
    <canvas
      ref={canvasRef}
      className="minimap"
      onClick={onClick}
      title="minimap — click to jump"
    />
  )
}

/** pickAnchor semantics over the model: topmost visible loaded, else topmost visible. */
function anchorIndex(s: VirtualListState): number | null {
  if (s.visibleEnd < s.visibleStart) return null
  for (let i = s.visibleStart; i <= s.visibleEnd; i++) {
    if (s.isLoaded(i)) return i
  }
  return s.visibleStart
}
