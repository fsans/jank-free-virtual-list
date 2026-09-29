/**
 * Island load planning — pure functions. The scroll listener decides WHEN to
 * plan; this module decides WHAT to fetch.
 */

export type Direction = -1 | 0 | 1

/** Buffer around the viewport, in viewports: bigger in the scroll direction. */
export const BUFFER_VIEWPORTS = { inDirection: 1.5, opposite: 0.5 } as const

/** Max ids in one load group. */
export const MAX_GROUP_SIZE = 200

export interface PlanInput {
  visibleStart: number
  visibleEnd: number
  direction: Direction
  viewportPx: number
  n: number
  offsetOf: (i: number) => number
  heightOf: (i: number) => number
  indexAtOffset: (px: number) => number
  isLoaded: (i: number) => boolean
  isInflight: (i: number) => boolean
  maxGroupSize?: number
}

export interface LoadPlan {
  /** Inclusive index range after buffer expansion + islet absorption. */
  start: number
  end: number
  /** Unloaded, not-in-flight ids to fetch, ascending. */
  ids: number[]
  capped: boolean
}

/**
 * Plan the next island load around the visible range.
 *
 * Directional buffer: 1.5 viewports in the scroll direction, 0.5 opposite
 * (direction 0, e.g. a jump, gets 1.5 on both sides). Small unloaded pockets
 * next to the range are absorbed (islet rule). Loaded / in-flight rows are
 * excluded. If the group exceeds `maxGroupSize`, ids closest to the visible
 * range win (visible rows first, then by distance).
 */
export function planLoad(input: PlanInput): LoadPlan {
  const { n, viewportPx, direction } = input
  const cap = input.maxGroupSize ?? MAX_GROUP_SIZE
  if (input.visibleStart > input.visibleEnd || n <= 0) {
    return { start: Math.max(0, input.visibleStart), end: Math.min(n - 1, input.visibleEnd), ids: [], capped: false }
  }
  const vs = Math.max(0, Math.min(input.visibleStart, n - 1))
  const ve = Math.max(0, Math.min(input.visibleEnd, n - 1))

  const abovePx = (direction === 1 ? BUFFER_VIEWPORTS.opposite : BUFFER_VIEWPORTS.inDirection) * viewportPx
  const belowPx = (direction === -1 ? BUFFER_VIEWPORTS.opposite : BUFFER_VIEWPORTS.inDirection) * viewportPx

  let { start, end } = {
    start: input.indexAtOffset(input.offsetOf(vs) - abovePx),
    end: input.indexAtOffset(input.offsetOf(ve + 1) + belowPx),
  }
  ;({ start, end } = absorbIslets(start, end, {
    n,
    viewportPx,
    isLoaded: input.isLoaded,
    heightOf: input.heightOf,
  }))

  const ids: number[] = []
  for (let i = start; i <= end; i++) {
    if (!input.isLoaded(i) && !input.isInflight(i)) ids.push(i)
  }

  let capped = false
  if (ids.length > cap) {
    capped = true
    const dist = (i: number): number => (i < vs ? vs - i : i > ve ? i - ve : 0)
    const kept = ids
      .map((id) => [dist(id), id] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .slice(0, cap)
      .map(([, id]) => id)
      .sort((a, b) => a - b)
    ids.length = 0
    ids.push(...kept)
  }

  return { start, end, ids, capped }
}

export interface AbsorbInput {
  n: number
  viewportPx: number
  isLoaded: (i: number) => boolean
  heightOf: (i: number) => number
}

/**
 * Islet rule: extend [start, end] to swallow runs of unloaded rows adjacent to
 * the range whose estimated pixel height fits within one viewport — the far
 * side of the run must be a loaded row or a list edge. A small skeleton pocket
 * between loaded regions is the one place no anchor can be stable, so it gets
 * loaded together with the adjacent group.
 */
export function absorbIslets(
  start: number,
  end: number,
  x: AbsorbInput,
): { start: number; end: number } {
  let s = start
  let e = end

  // pocket above
  if (s > 0 && !x.isLoaded(s - 1)) {
    let gap = 0
    let i = s - 1
    while (i >= 0 && !x.isLoaded(i)) {
      gap += x.heightOf(i)
      if (gap > x.viewportPx) break
      i--
    }
    if (gap <= x.viewportPx) s = i + 1
  }

  // pocket below
  if (e < x.n - 1 && !x.isLoaded(e + 1)) {
    let gap = 0
    let i = e + 1
    while (i < x.n && !x.isLoaded(i)) {
      gap += x.heightOf(i)
      if (gap > x.viewportPx) break
      i++
    }
    if (gap <= x.viewportPx) e = i - 1
  }

  return { start: s, end: e }
}

/**
 * The initial load: the newest `count` items at the bottom of the list.
 * Rendered immediately; everything above starts as skeleton.
 */
export function planTail(n: number, count = 50): { start: number; end: number } {
  if (n <= 0) return { start: 0, end: -1 }
  return { start: Math.max(0, n - count), end: n - 1 }
}
