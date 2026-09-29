/**
 * Anchor selection — the deterministic rule that keeps one row visually pinned
 * while heights change around it (see SKILL.md, "Choose the anchor row").
 */

export interface VisibleRow {
  index: number
  loaded: boolean
}

export interface Anchor {
  index: number
  kind: 'loaded' | 'skeleton'
}

/**
 * Topmost visible LOADED row, else the topmost visible skeleton.
 *
 * `visible` must be ordered top-to-bottom and contain every row intersecting
 * the viewport — partially visible rows count as visible.
 */
export function pickAnchor(visible: readonly VisibleRow[]): Anchor | null {
  const first = visible[0]
  if (first === undefined) return null
  for (const r of visible) {
    if (r.loaded) return { index: r.index, kind: 'loaded' }
  }
  return { index: first.index, kind: 'skeleton' }
}
