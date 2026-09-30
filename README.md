# jank-free-virtual-list

An [agent skill](jank-free-virtual-list/SKILL.md) for designing and implementing scroll-stable, virtualized rendering for huge chat/feed/timeline UIs — tens of thousands to hundreds of thousands of items — without scroll jank, layout shift, or slow random access.

## What it does

Distills a strategy for building list UIs that *feel* already local: scroll anywhere immediately, tolerate at most a brief loader. It combines three techniques:

1. **Skeleton map** — fetch a lightweight outline of every item (types only, no payloads) from an index-only query, and render the full scroll range as skeletons so the scrollbar is right from the first paint.
2. **Island loading** — fetch full data only for the rows near the viewport (with a directional buffer), one load group at a time, absorbing small skeleton pockets ("islets").
3. **Anchor-row scroll compensation** — pin one visible row and correct `scrollTop` in the layout phase whenever content above it changes height, so nothing the user is reading ever shifts.

It also covers streaming behavior, a virtualization debugger design that both humans and AI agents can reason over, and success metrics (time to first render, CLS, dropped frames, memory, time-to-item-#1).

Distilled from Cognition's write-up on rebuilding Devin's chat renderer (Aug 2026): reported 70% faster loads and 86% less layout shift on sessions with 100k+ events.

## When to reach for it

- Long chat transcripts, activity logs, event streams, or infinite feeds that load slowly, drop frames, use too much memory, or jump while scrolling up or streaming
- "Virtualize my list", "react-window / virtuoso / tanstack-virtual is janky"
- "Scroll position jumps when older messages load", "layout shift when streaming"
- "Scroll to any point in a huge session instantly"
- Building a virtualization debugger so an agent can root-cause scroll bugs from logs

## Install

Copy the skill folder into your agent's skills directory:

```bash
# Claude Code
git clone https://github.com/fsans/jank-free-virtual-list.git
cp -R jank-free-virtual-list/jank-free-virtual-list ~/.claude/skills/

# Agent-agnostic locations (~/.agents/skills/ works for Devin and similar tools)
cp -R jank-free-virtual-list/jank-free-virtual-list ~/.agents/skills/
```

Or copy it into a project at `.agents/skills/jank-free-virtual-list/` to make it available to agents working in that repo.

## Demo

`demo/` is a self-contained Vite + React + TypeScript app that implements the strategy against a seeded mock API (200,000 items by default — `?seed=` and `?n=` in the URL change it). No virtualization libraries; the virtualizer is hand-rolled per the skill.

```bash
cd demo
npm install
npm run dev        # http://localhost:5173
npm test           # vitest unit tests
npm run e2e        # playwright e2e (spins up its own dev server)
```

Things to try:

- **A/B the jank** — toggle "compensation" off in the status bar (or the debugger panel), scroll to the middle, then scroll up. The row you were reading visibly jumps; toggle it back on and it stays put.
- **Streaming** — enable "stream". While pinned at the bottom new items keep it glued; scroll up to go free and a "N new ↓" pill counts arrivals without yanking the anchor.
- **Jump anywhere** — "top #1", "latest", "random", or the "go to #" input; the debugger shows `jump_usable` timings in the event log.
- **Debugger panel** (right side) — minimap of the whole list (grey skeleton / green loaded / amber in-flight / blue-grey measured-only; click to jump), live stats, latency and height-variance sliders, row overlays, anchor outline, and a filterable structured event log with JSON download. `window.__vlist` exposes `log()`, `state()`, `jump(i)`, `setOpts()` for scripts and agents.

## Repository structure

```text
jank-free-virtual-list/          # this repo
├── README.md
├── AGENTS.md                    # conventions for agents editing this repo
├── demo/                        # demo app — own package.json, build & test commands
└── jank-free-virtual-list/      # the skill itself
    ├── SKILL.md                 # skill entry point (frontmatter + instructions)
    └── references/
        └── implementation-notes.md
```

The skill folder is self-contained: that's the only directory agents load. Everything else in the repo is for humans and maintenance.
