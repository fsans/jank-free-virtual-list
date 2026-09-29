# Task: Build "jank-free-virtual-list" demo app

## Context

Repo: /Users/fsans/Desktop/jank-free-virtual-list
It contains an agent skill describing a strategy for scroll-stable virtualized rendering
of huge chat/feed UIs. READ THESE FIRST, fully, before writing code — they are the spec:

- jank-free-virtual-list/SKILL.md
- jank-free-virtual-list/references/implementation-notes.md
- AGENTS.md (repo conventions)

Build a small, self-contained demo web app that visibly proves the three pieces work:

1. Skeleton map
2. Island loading
3. Anchor-row scroll compensation

…plus streaming, jump-to-item, and a virtualization debugger (human + agent views).

## Hard constraints

- Put everything in the top-level folder `demo/` with its own package.json.
  Do NOT touch anything inside `jank-free-virtual-list/` (the skill folder).
- Stack: Vite + React 18 + TypeScript (strict). Plain CSS (CSS modules or one stylesheet).
- NO virtualization libraries (no react-window, react-virtuoso, tanstack-virtual) and no UI kits.
  Write the virtualizer yourself — that is the point of the demo.
- Dev deps allowed: vite, @vitejs/plugin-react, typescript, vitest, @playwright/test.
  Pin exact versions that were published at least 7 days ago. No other deps without asking.
- No real backend: mock API in-browser with simulated latency.
- Follow the anchor rules in SKILL.md exactly (topmost visible LOADED row, else topmost
  visible skeleton). Compensation must happen before paint (useLayoutEffect / ResizeObserver
  callback), never in useEffect or setTimeout.
- Small focused commits with imperative messages. Do not push.

## Target structure

```text
demo/
├── PLAN.md               # this file
├── package.json, tsconfig.json, vite.config.ts, index.html, playwright.config.ts
├── src/
│   ├── main.tsx, App.tsx, styles.css
│   ├── mock/
│   │   ├── dataset.ts        # seeded PRNG, deterministic item generation
│   │   └── api.ts            # getOutline(), getItems(ids, signal), stream()
│   ├── list/
│   │   ├── types.ts          # ItemType, OutlineEntry, Row, Payload
│   │   ├── fenwick.ts        # Fenwick tree for heights/prefix offsets
│   │   ├── heights.ts        # measured vs estimated heights, per-type running median
│   │   ├── anchor.ts         # pickAnchor() — pure function
│   │   ├── planner.ts        # planLoad(), absorbIslets() — pure functions
│   │   ├── loader.ts         # single-in-flight island loader, queue, abort, dedup
│   │   ├── cache.ts          # payload LRU with eviction (keeps measured heights)
│   │   ├── useVirtualList.ts # core hook: range, spacers, compensation, pinned mode
│   │   └── VirtualList.tsx
│   ├── rows/                 # one real + one skeleton component per ItemType
│   ├── debug/
│   │   ├── logger.ts         # structured ring-buffer log, window.__vlist
│   │   ├── Minimap.tsx       # canvas strip of whole list
│   │   └── DebugPanel.tsx
│   └── metrics.ts            # CLS observer, TTFR, time-to-item-#1
└── tests/
    ├── unit/*.test.ts        # vitest
    └── e2e/*.spec.ts         # playwright
```

## Spec by module

### 1. Mock dataset + API (`mock/`)

- Deterministic, seeded (seed in URL `?seed=42`). Default N = 200,000 items; `?n=` overrides.
- Item types, with realistic height variance (this variance is what makes jank visible):

  | type      | skeleton estimate | real height range      | notes                    |
  |-----------|-------------------|------------------------|--------------------------|
  | user      | 56px              | 40–160                 | short text               |
  | assistant | 140px             | 60–600                 | paragraphs               |
  | tool      | 36px              | 32–48                  | collapsed one-liner      |
  | code      | 220px             | 80–700                 | monospace block          |
  | image     | 240px             | fixed aspect-ratio box | async decode (see below) |
  | diff      | 180px             | 60–900                 | unified diff lines       |

- Image rows "decode" after 200–1500ms and may add a caption, producing an async height
  change that must go through the ResizeObserver compensation path.

- Generate payloads lazily from (seed, index) so 200k items cost no memory until requested.
- `getOutline(): Promise<OutlineEntry[]>` — run-length encoded `[{type, count}]`, ~30ms latency.
  Simulates the index-only query: types only, no payloads.
- `getItems(ids, signal): Promise<Payload[]>` — latency random 150–600ms (configurable
  via debug panel slider, incl. a "slow 3G" 1500ms+ preset). Must honor AbortSignal.
- `stream(onEvent)` — when enabled, every 300–800ms either appends a new item or appends
  text to the last assistant item (growth at the bottom).

### 2. Heights (`fenwick.ts`, `heights.ts`)

- `heights[i]` = measured if known, else estimate[type]. Fenwick tree gives O(log n)
  `offsetOf(i)`, `indexAtOffset(px)`, `total()`. Never recompute all offsets per frame.
- Per-type estimates calibrate from measured heights (running median); update the Fenwick
  entries of UNMEASURED rows lazily or in batches (not per-frame for all 200k).

### 3. Virtualizer (`useVirtualList.ts`, `VirtualList.tsx`)

- Layout: scroll container (`overflow-y: auto; overflow-anchor: none`) containing
  `[top spacer][mounted rows in normal flow][bottom spacer]`. Spacer heights come from the
  Fenwick tree. Rows keyed by stable item ID.
- Mounted range = visible range + overscan (~1 viewport each side). Rows with no payload
  render the skeleton for their type at estimated height.
- Measure mounted rows in useLayoutEffect and via a single shared ResizeObserver; write
  results into heights store.
- **Compensation (core):**
  - Load landing: before committing, `anchor = pickAnchor()`, record
    `anchorTopBefore = el.getBoundingClientRect().top - scroller.top`. Commit. In
    useLayoutEffect: measure `anchorTopAfter`, `scrollTop += after - before`. Log it.
  - Async resize (ResizeObserver): for each changed row ABOVE the anchor, sum height
    deltas and adjust scrollTop in the same callback. Rows at/below anchor → no correction.
  - Top-spacer changes (rows above get measured/calibrated) go through the same path.
  - Window resize: keep the anchor pinned the same way.
- `pickAnchor()` in `anchor.ts` is a pure function over (visible rows, loaded flags) —
  topmost visible loaded row, else topmost visible skeleton.
- Serialize: only one load group commits at a time; others wait in a queue.
- A debug toggle **"Compensation: ON/OFF"** disables correction, so viewers can A/B the jank.

### 4. Island loading (`planner.ts`, `loader.ts`, `cache.ts`)

- On scroll (rAF-throttled), compute visible range + direction.
- Buffer: 1.5 viewports in the scroll direction, 0.5 viewports opposite (constants in one place).
- `absorbIslets(start, end, loaded, viewportPx)`: any run of unloaded rows bounded by
  loaded rows (or the new load) whose estimated pixel height ≤ viewport height is swallowed
  into the load.
- Filter out loaded / in-flight IDs; cap group size (e.g. 200 ids).
- If the user flings far away, abort the in-flight request when its range is entirely outside
  the current buffered range; log `load_cancelled`. Stale responses that arrive for
  off-screen rows BELOW the anchor only populate the cache without scroll correction.
- On first load, fetch the newest tail immediately (last ~50 items) and start pinned to the bottom.
- LRU payload cache with a budget (default 5,000 items). Evict far islands back to skeletons,
  but KEEP their measured heights.

### 5. Streaming + pinned mode

- `mode: 'pinned' | 'free'` as explicit state (never inferred per-frame from scrollTop).
- User intent to scroll up (wheel up, touch drag, PageUp/ArrowUp/Home, scrollbar drag
  moving up) → `free`. Reaching bottom within 4px or clicking "Jump to latest" → `pinned`.
- Pinned: after each append or growth, scroll to bottom in layout phase.
- Free: growth below the anchor is a no-op; the user must never be yanked. Show a
  "N new ↓" pill.

### 6. Jump-to-item

- Controls: "Top (#1)", "Latest", "Random", numeric input "Go to #".
- Implementation: set scrollTop = offsetOf(i) from estimates, the island loads, normal
  anchor compensation keeps item i in place as rows resize. Record time-to-usable
  (target row loaded + stable for 2 frames) in metrics.

### 7. Debugger (`debug/`)

- **Human view (right-side panel, collapsible):**
  - Minimap canvas spanning the full list height: skeleton = grey, loaded = green,
    in-flight = amber, evicted-but-measured = blue-grey, viewport rectangle, anchor marker line.
    Clicking the minimap jumps there.
  - Live stats: N items, mounted DOM rows, loaded count, cache size, in-flight, queue length,
    mode, anchor id + kind, last delta px, scrollTop/scrollHeight, CLS so far.
  - Toggles/sliders: compensation on/off, latency, streaming on/off, height variance
    multiplier, show row index overlays, highlight anchor row outline.
- **Agent view (structured log):**
  - Ring buffer (last 10k events), schema per implementation-notes.md "Debug log schema":
    `{t, event, ids?, anchor?, anchorTopBefore?, anchorTopAfter?, deltaApplied?,
      scrollTopBefore?, scrollTopAfter?, viewport, inflight, ...}`
  - Events: scroll, visible_range, load_requested, load_landed, load_cancelled,
    anchor_picked, delta_applied, resize_observed (measured vs estimated), stream_append,
    mode_change, evict, jump.
  - "Download log (JSON)" button + `window.__vlist = { log(), state(), jump(i), setOpts() }`
    so a Playwright script or agent can read the state as data.
  - Log panel with a text filter by event type.

### 8. Metrics (`metrics.ts`)

- Time to first usable render (outline + tail rendered).
- CLS via PerformanceObserver('layout-shift'); show cumulative + per-interaction.
- Time to item #1 (from click to stable).
- Mounted DOM node count (should stay in the low hundreds with 200k items).

## Tests

Unit (vitest):

- fenwick: update/prefix/indexAtOffset vs a naive array, randomized 10k ops.
- pickAnchor: loaded-visible wins; all-skeleton → topmost skeleton; partially visible top row.
- planLoad: directional buffer; excludes loaded/in-flight; group cap.
- absorbIslets: gap ≤ viewport absorbed, gap > viewport not; edges at list bounds.

E2E (playwright, chromium), using `window.__vlist`:

1. Stability on scroll-up: scroll to the middle, pick the anchor row, perform 30 wheel-up steps
   with latency 400ms; after every `load_landed`, the anchor row's viewport top must drift
   ≤ 1px from its pre-load value (read from log deltas + DOM).
2. Same test with compensation OFF must FAIL the threshold (proves the demo shows jank).
3. Jump to #1 on n=200k: target row loaded and stable in < 1.5s at default latency.
4. Streaming while free: scroll up 2000px, enable streaming for 5s, the anchor row's top must not move.
5. Streaming while pinned: stays at bottom (distance ≤ 4px) after 10 appends.
6. Mounted DOM rows < 300 at all times.

## Milestones (commit after each)

1. Scaffold `demo/` (Vite React TS, vitest, playwright); `npm run dev|build|test|e2e` scripts.
2. Mock dataset + API, with unit sanity tests.
3. Fenwick + heights + pure anchor/planner, with unit tests green.
4. Virtualizer rendering skeleton map for 200k from the outline; tail loaded; pinned to bottom.
5. Island loader + compensation + islet rule + cancellation + eviction.
6. Async image resize path, window resize, streaming + pinned/free mode.
7. Jump-to-item controls.
8. Debugger panel, minimap, structured log, window.__vlist, metrics.
9. E2E tests green; polish styling (clean, chat-like, dark/light).
10. Docs: add a short "Demo" section to root README.md (how to run, what to try:
    toggle compensation OFF and scroll up to see jank). Update AGENTS.md layout
    tree + note that `demo/` has its own build/test commands and the skill-folder rules
    are unchanged.

## Definition of done

- `cd demo && npm install && npm run build && npm test && npm run e2e` all pass.
- `npm run dev` opens a 200k-item chat that scrolls anywhere instantly, shows skeletons
  briefly, and never shifts the row being read, with compensation ON. It visibly jumps with
  compensation OFF.
- The skill folder `jank-free-virtual-list/` is byte-for-byte unchanged (`git diff --stat` shows
  no changes there).
- Final report: what was built, commands to run, test results, any deviations from this
  spec and why, known limitations.
