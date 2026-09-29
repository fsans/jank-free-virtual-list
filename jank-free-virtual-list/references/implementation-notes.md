# Implementation notes

## Contents
- Data model
- Anchor compensation pseudocode
- Island planning pseudocode
- Pitfalls
- Library notes

## Data model

```ts
type Outline = ItemType[]                 // index i -> type; from one index-only query
type Row = { id: string; type: ItemType; data?: Payload; height?: number }
// data === undefined => render skeleton (estimated height by type)
```

Keep `heights[i]` = measured height if known, else `estimate[type]`. Prefix sums (or a Fenwick tree) give O(log n) offset lookups for 100k+ rows. Do not recompute all offsets per frame.

## Anchor compensation

```ts
function applyLoad(newRows) {
  const anchor = pickAnchor()                 // see rules below
  const before = anchor.top - viewport.top    // px from viewport top

  commit(newRows)                             // state update; DOM updates
  // --- in layout phase, before paint ---
  const after = anchorElement(anchor.id).getBoundingClientRect().top - viewport.top
  scroller.scrollTop += (after - before)
}

function pickAnchor() {
  const visible = rowsIntersecting(viewport)
  return visible.find(r => r.loaded) ?? visible[0]   // topmost loaded, else topmost skeleton
}
```

Notes:
- If the anchor itself is being replaced (skeleton -> real), key rows by stable item ID so the same element/position is tracked across the swap.
- Serialize: one in-flight commit at a time. If a second island arrives while measuring, queue it.
- Use a layout-phase hook. A post-paint correction is visible as a flash.

## Island planning

```ts
function planLoad(visibleRange, direction) {
  const buf = direction === 'up' ? { above: BIG, below: SMALL } : { above: SMALL, below: BIG }
  let [start, end] = expand(visibleRange, buf)
  // islet rule: absorb small skeleton gaps adjacent to loaded rows
  [start, end] = absorbIslets(start, end, loadedSet, viewportRowCapacity)
  return idsInRange(start, end).filter(id => !loaded(id) && !inflight(id))
}
```

`absorbIslets`: if a run of unloaded rows bounded by loaded rows (or by the new load) is short enough that its two ends could be in the viewport together (compare its estimated pixel height to viewport height), include the whole run.

## Pitfalls

- **Estimates far from reality** cause big corrections, which are visible during fast flings. Calibrate per-type estimates from real measured heights (e.g. running median).
- **Async height changes** (images, syntax highlighting, lazy embeds, fonts) also move content: observe with `ResizeObserver` and route through the same compensation path. Reserve space (aspect-ratio, min-height) when possible.
- **Browser scroll anchoring** (`overflow-anchor`) can fight manual compensation. Disable it on the scroller (`overflow-anchor: none`) if you compensate yourself.
- **Stuck-to-bottom mode** must be explicit state, not inferred from scrollTop each frame, or streaming will fight the user.
- **Cancel stale loads** when the user flings past a region; don't let old responses trigger compensation for rows far from the viewport (they only need cache insertion, no scroll correction if entirely off-screen and below the anchor).
- **Jump-to-item** (search results, permalinks): scroll to the skeleton's estimated offset, load that island, then run normal anchor compensation.
- **Memory:** evict payloads of far-away islands back to skeletons (keep measured heights) when over budget.

## Library notes

- Libraries like TanStack Virtual, react-virtuoso, react-window give windowing and measurement, but few give a first-class anchor + prepend-compensation API. Expect to wrap or fork the offset logic.
- react-virtuoso has prepend/`firstItemIndex` support for the simple older-history case, but it doesn't solve island loading or interspersed skeletons.
- A custom virtualizer is justified when you need islands + skeleton map + exact control of the pre-paint scroll write.

## Debug log schema (suggested)

```json
{ "t": 1712345678123, "event": "load_landed",
  "ids": ["e_1200","e_1260"], "anchor": {"id":"e_1258","kind":"loaded"},
  "anchorTopBefore": 212, "anchorTopAfter": 388, "deltaApplied": 176,
  "scrollTopBefore": 40210, "scrollTopAfter": 40386,
  "viewport": {"h": 900}, "inflight": 1 }
```
Log: scroll events, visible range changes, load requested/landed/cancelled, anchor picks, every delta applied, ResizeObserver height changes, streaming appends, mode changes (pinned/free).
