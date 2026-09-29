---
name: jank-free-virtual-list
description: Design and implement scroll-stable, virtualized rendering for huge chat/feed/timeline UIs (tens of thousands to hundreds of thousands of items) using the "skeleton map + island loading + anchor-row scroll compensation" strategy. Use this whenever the user is building or fixing a long chat transcript, activity log, event stream, or infinite feed that loads slowly, drops frames, uses too much memory, or jumps/shifts while scrolling up or streaming - even if they only say "virtualize my list", "react-window/virtuoso/tanstack-virtual is janky", "scroll position jumps when older messages load", "layout shift when streaming", or "scroll to any point in a huge session instantly". Also use it when asked to build a virtualization debugger so an AI agent can root-cause scroll bugs from logs.
---

# Jank-free virtual list (skeleton map + anchor row)

Strategy distilled from Cognition's write-up on rebuilding Devin's chat renderer (Aug 2026). Reported result: 70% faster loads, 86% less layout shift on sessions with 100k+ events.

## Why the textbook approach isn't enough

The textbook fix is: (1) fetch only the newest N items and page older ones in on scroll-up, (2) virtualize so only on-screen rows are in the DOM. It fails in two ways:

1. **Scroll jank.** Rows change from estimated to measured height as they load/render, pushing what the user is reading. Streaming moves content even when the user isn't scrolling.
2. **Slow random access.** Reaching anything outside the preloaded tail means spinner -> scroll -> spinner. Reaching message #1 can take minutes.

The goal is to make the whole history *feel* already local: scroll anywhere immediately, tolerate at most a brief loader.

## The three pieces

### 1. Skeleton map (reserve the whole scroll range cheaply)
- Fetch a lightweight **outline of every item**: just an array of item *types* (or type + tiny hint like size class). No payloads.
- Make this query index-only: scan an index, never materialize JSON. Payload is one small array, so it stays fast at 100k+ rows.
- Render the full list as skeleton components whose heights approximate each type's typical height/shape. The scrollbar and total height are now roughly right from the first paint, so the user can jump anywhere.
- Load the real tail (newest items) immediately; everything else starts as skeletons.

### 2. Island loading (fill in the map where the user is)
- Compute which item IDs are on screen, plus a buffer above and below (bigger buffer in the scroll direction) so slow scrolling finds content already loaded.
- Fetch full data for exactly those IDs; swap skeletons for real rows. Each loaded region is an "island".
- Allow only **one load group to land at a time**, so height deltas can be compensated deterministically.
- **Islet rule:** if a load would leave a small pocket of skeletons between loaded rows, small enough that both its ends fit in the viewport, extend the load to swallow the whole pocket. This prevents the one situation where no anchor can be stable.

### 3. Anchor-row scroll compensation (the anti-jank core)
Rows above the user's focal point changing height is what shifts content. Keep one row visually pinned:

**Choose the anchor row** (deterministic, two rules):
1. If any *loaded* row is visible, use the **topmost visible loaded row**.
2. Otherwise (only skeletons visible), use the **topmost visible skeleton**.

**Compensate:**
1. Before applying the load, record `anchorTopBefore` = anchor's top offset relative to the viewport.
2. Apply the new rows and let the browser lay them out (do not paint yet).
3. Measure `anchorTopAfter`. Set `scrollTop += (anchorTopAfter - anchorTopBefore)`.
4. Do steps 3 in a layout-phase hook (`useLayoutEffect`, `requestAnimationFrame` before paint, or equivalent) so the user never sees the intermediate frame.

Rows resizing *below* the anchor need no correction, since scroll position is measured from the top. Only changes above the anchor matter.

Apply the same compensation to any height change above the anchor: images/video decoding, code blocks expanding, diffs rendering, streaming text, and window resize. Not just skeleton->real swaps.

See `references/implementation-notes.md` for pseudocode, pitfalls, and library-specific notes.

## Workflow when applying this skill

1. **Profile first.** Identify the actual bottleneck: payload size, DB query time, DOM node count, layout per resize, or scroll jank. The strategy addresses all four, but you may only need part of it.
2. **Define the outline query.** Decide what "type" means for skeleton height; add or verify an index that can answer it without touching payloads. Return a compact array (consider run-length encoding for long runs of the same type).
3. **Build the skeleton components**, one per item type, with heights near the observed median for that type. Better estimates mean smaller corrections.
4. **Pick or wrap a virtualizer** that lets you control scroll offset and measure rows (see notes). Add anchor selection + compensation on top.
5. **Implement island loading** with buffer, single in-flight group, islet expansion, and request dedup/cancellation when the user scrolls elsewhere.
6. **Handle streaming**: when pinned to the bottom, follow new content; when the user has scrolled up, treat growth below the anchor as no-ops and never yank them.
7. **Build the virtualization debugger** (below) and test with adversarial sessions: 100k+ items, mixed item heights, fast flings to the top, rapid resize, streaming while scrolled up, jump-to-first-message.

## Build a debugger that agents and humans can both read

The team found computer-use/screenshot agents were poor at diagnosing scroll bugs. What worked was giving the agent tooling that exposes state as data:

- **Human view:** visualize the list: which rows are mounted, which are placeholders, loaded vs skeleton islands (color-coded), current scroll state, anchor row.
- **Agent view:** a timestamped, structured log of *every* virtualizer action: loads requested/landed, anchor chosen, `anchorTopBefore/After`, delta applied, measured vs estimated heights, viewport size.
- **Loop:** capture a failing session's log -> load in the debugger -> reason from log to root cause -> fix -> replay to confirm the issue no longer reproduces. Batches of failing logs can be handed to an agent to fix in parallel, with the debugger as its verification step.

General lesson: agents default to tools they already have. When a bug class is hard to *see*, explicitly ask the agent to build a purpose-made observability tool first, then debug with it.

## Success metrics

Track before/after: time to first usable render on the largest sessions, CLS / layout-shift score during scroll-up and streaming, dropped frames while scrolling, memory (DOM node count and JS heap), time to scroll to item #1.
