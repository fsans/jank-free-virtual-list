/** Seeded deterministic dataset: types up-front, payloads lazily from (seed, index). */
import type { DiffLine, ItemType, Payload } from '../list/types'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hash2(a: number, b: number): number {
  let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b ^ 0x27d4eb2f, 0x165667b1)) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 0x2545f491)
  h ^= h >>> 13
  return h >>> 0
}

export const ITEM_TYPES: readonly ItemType[] = ['user', 'assistant', 'tool', 'code', 'image', 'diff']

const TYPE_CODES: Record<ItemType, number> = { user: 0, assistant: 1, tool: 2, code: 3, image: 4, diff: 5 }
const TYPE_NAMES: readonly ItemType[] = ['user', 'assistant', 'tool', 'code', 'image', 'diff']

const WORDS = [
  'scroll', 'anchor', 'island', 'skeleton', 'viewport', 'buffer', 'heights',
  'offset', 'compensate', 'stream', 'append', 'render', 'measure', 'observe',
  'stable', 'frame', 'paint', 'layout', 'shift', 'jank', 'cache', 'evict',
  'median', 'estimate', 'measure', 'session', 'history', 'timeline', 'feed',
]

const TOOL_NAMES = ['shell: npm test', 'grep: TODO', 'edit: loader.ts', 'read: PLAN.md', 'search: anchor']

const HEIGHT_RANGE: Record<ItemType, readonly [number, number]> = {
  user: [40, 160],
  assistant: [60, 600],
  tool: [32, 48],
  code: [80, 700],
  image: [200, 560],
  diff: [60, 900],
}

/** Draw a target rendered height (px) for an item, spread by `variance`. */
export function drawTarget(type: ItemType, rng: () => number, variance: number): number {
  const [lo, hi] = HEIGHT_RANGE[type]
  const u = Math.min(Math.max(0.5 + (rng() - 0.5) * variance, 0), 1)
  return Math.round(lo + u * (hi - lo))
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)] as T
}

/** Chat-like type distribution, shared by generation and streaming appends. */
export function weightedType(r: number): ItemType {
  if (r < 0.3) return 'user'
  if (r < 0.62) return 'assistant'
  if (r < 0.74) return 'tool'
  if (r < 0.86) return 'code'
  if (r < 0.93) return 'image'
  return 'diff'
}

function words(rng: () => number, n: number): string {
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(pick(rng, WORDS))
  return out.join(' ')
}

function sentence(rng: () => number): string {
  const s = words(rng, 8 + Math.floor(rng() * 10))
  return s.charAt(0).toUpperCase() + s.slice(1) + '.'
}

function makeUserText(rng: () => number, targetPx: number): string {
  const chars = Math.max(8, Math.round(((targetPx - 34) / 22) * 64))
  let out = words(rng, 3)
  while (out.length < chars) out += ' ' + pick(rng, WORDS)
  return out.slice(0, chars)
}

function makeAssistantText(rng: () => number, targetPx: number): string {
  const paras = Math.max(1, Math.round((targetPx - 40) / 110))
  const out: string[] = []
  for (let i = 0; i < paras; i++) {
    const n = 2 + Math.floor(rng() * 4)
    const parts: string[] = []
    for (let j = 0; j < n; j++) parts.push(sentence(rng))
    out.push(parts.join(' '))
  }
  return out.join('\n\n')
}

function makeCodeLines(rng: () => number, targetPx: number): string[] {
  const n = Math.max(2, Math.min(34, Math.round((targetPx - 28) / 20)))
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const indent = '  '.repeat(Math.floor(rng() * 3))
    out.push(`${indent}${pick(rng, ['const', 'let', 'await', 'return'])} ${pick(rng, ['row', 'offset', 'anchor', 'island'])} = ${pick(rng, ['measure', 'plan', 'load', 'absorb'])}(${Math.floor(rng() * 999)})`)
  }
  return out
}

function makeDiff(rng: () => number, targetPx: number): DiffLine[] {
  const n = Math.max(3, Math.min(42, Math.round((targetPx - 30) / 20)))
  const out: DiffLine[] = [
    { kind: 'hunk', text: `@@ -${1 + Math.floor(rng() * 40)},${n} +${1 + Math.floor(rng() * 40)},${n} @@` },
  ]
  for (let i = 1; i < n; i++) {
    const r = rng()
    const kind: DiffLine['kind'] = r < 0.42 ? 'del' : r < 0.84 ? 'add' : 'ctx'
    out.push({ kind, text: `${kind === 'ctx' ? ' ' : kind === 'add' ? '+' : '-'} ${words(rng, 3 + Math.floor(rng() * 8))}` })
  }
  return out
}

const IMAGE_ASPECTS = [16 / 9, 4 / 3, 1, 4 / 5, 3 / 4]

function makeImageSrc(rng: () => number, index: number): string {
  const aspect = IMAGE_ASPECTS[Math.floor(rng() * IMAGE_ASPECTS.length)] ?? 1
  const w = 560
  const h = Math.round(w / aspect)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${Math.floor(rng() * 360)},60%,55%)"/>` +
    `<stop offset="1" stop-color="hsl(${Math.floor(rng() * 360)},60%,30%)"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    `<text x="50%" y="52%" text-anchor="middle" font-family="monospace" font-size="20" fill="rgba(0,0,0,0.55)">img #${index}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export type StreamEvent =
  | { kind: 'append'; index: number; type: ItemType }
  | { kind: 'grow'; index: number; text: string }

/**
 * Deterministic, seeded dataset. Types for all N items are materialized once
 * (the outline); payloads are derived lazily from (seed, index) so 200k items
 * cost no memory until requested.
 */
export class Dataset {
  readonly seed: number
  variance: number
  private types: Uint8Array
  private count = 0
  private runs: Array<{ type: ItemType; count: number }> = []
  private growthByIndex = new Map<number, string>()
  private rng: () => number

  constructor(seed: number, n: number, variance = 1) {
    this.seed = seed
    this.variance = variance
    this.rng = mulberry32(hash2(seed, 0x51ed) || 1)
    this.types = new Uint8Array(n + 1024)
    while (this.count < n) {
      const type = weightedType(this.rng())
      const run = Math.min(1 + Math.floor(this.rng() * 10), n - this.count)
      for (let k = 0; k < run; k++) this.types[this.count + k] = TYPE_CODES[type]
      this.count += run
      this.runs.push({ type, count: run })
    }
  }

  get n(): number {
    return this.count
  }

  typeOf(index: number): ItemType {
    return TYPE_NAMES[this.types[index] ?? 0] ?? 'user'
  }

  /** Run-length encoded outline: [{type, count}] — types only, no payloads. */
  outline(): Array<{ type: ItemType; count: number }> {
    return this.runs.map((r) => ({ type: r.type, count: r.count }))
  }

  payloadOf(index: number): Payload {
    const type = this.typeOf(index)
    const rng = mulberry32(hash2(this.seed, index))
    const target = drawTarget(type, rng, this.variance)
    const base = { id: `e_${index}`, index, type }
    switch (type) {
      case 'user':
        return { ...base, text: makeUserText(rng, target) }
      case 'assistant': {
        const text = makeAssistantText(rng, target) + (this.growthByIndex.get(index) ?? '')
        return { ...base, text }
      }
      case 'tool':
        return { ...base, toolName: pick(rng, TOOL_NAMES), toolMs: 20 + Math.floor(rng() * 480) }
      case 'code':
        return { ...base, lines: makeCodeLines(rng, target) }
      case 'image': {
        const aspect = IMAGE_ASPECTS[Math.floor(rng() * IMAGE_ASPECTS.length)] ?? 1
        const payload: Payload = {
          ...base,
          src: makeImageSrc(rng, index),
          aspect,
          decodeMs: 200 + Math.floor(rng() * 1301),
        }
        if (rng() < 0.5) payload.caption = words(rng, 4 + Math.floor(rng() * 8))
        return payload
      }
      case 'diff':
        return { ...base, diff: makeDiff(rng, target) }
    }
  }

  /** Streaming: append one item; returns its index. */
  append(type: ItemType): number {
    if (this.count >= this.types.length) {
      const grown = new Uint8Array(this.types.length + 1024)
      grown.set(this.types)
      this.types = grown
    }
    const index = this.count++
    this.types[index] = TYPE_CODES[type]
    const last = this.runs[this.runs.length - 1]
    if (last && last.type === type) last.count++
    else this.runs.push({ type, count: 1 })
    return index
  }

  /**
   * Appends text to the last item if it is an assistant message (growth at the
   * bottom); returns its index plus the appended chunk, else null.
   */
  growLastAssistant(): { index: number; text: string } | null {
    const index = this.count - 1
    if (index < 0 || this.typeOf(index) !== 'assistant') return null
    const text = ` ${words(this.rng, 6 + Math.floor(this.rng() * 10))}`
    this.growthByIndex.set(index, (this.growthByIndex.get(index) ?? '') + text)
    return { index, text }
  }
}
