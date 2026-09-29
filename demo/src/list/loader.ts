import type { MockApi } from '../mock/api'
import type { Payload } from './types'

export type LoaderEventType = 'load_requested' | 'load_landed' | 'load_cancelled'

export interface LoaderEvent {
  type: LoaderEventType
  ids: number[]
}

export interface LoaderOptions {
  isLoaded: (i: number) => boolean
  onLanded: (items: Payload[]) => void
  onEvent?: (ev: LoaderEvent) => void
}

const MAX_QUEUE = 8

/**
 * Single-in-flight island loader with a queue, dedup and cancellation.
 *
 * Only one load group is requested at a time so that landings commit one at
 * a time and their height deltas can be compensated deterministically.
 * Groups whose range ends up entirely outside the current buffered range
 * (user flung elsewhere) are aborted or dropped.
 */
export class IslandLoader {
  private controller: AbortController | null = null
  private inflightIds = new Set<number>()
  private queuedIds = new Set<number>()
  private queue: number[][] = []
  private disposed = false

  constructor(
    private api: MockApi,
    private opts: LoaderOptions,
  ) {}

  get inflightCount(): number {
    return this.controller !== null ? 1 : 0
  }

  get queueLength(): number {
    return this.queue.length
  }

  isInflight(i: number): boolean {
    return this.inflightIds.has(i) || this.queuedIds.has(i)
  }

  /** Queue an island load. `immediate` (tail, jumps) goes to the front. */
  request(ids: readonly number[], immediate = false): void {
    if (this.disposed) return
    const fresh = ids.filter((i) => !this.opts.isLoaded(i) && !this.isInflight(i))
    if (fresh.length === 0) return
    if (this.controller !== null) {
      if (immediate) this.queue.unshift(fresh)
      else this.queue.push(fresh)
      for (const i of fresh) this.queuedIds.add(i)
      while (this.queue.length > MAX_QUEUE) this.dropOldest()
      return
    }
    this.start(fresh)
  }

  /**
   * Abort in-flight and queued groups whose ids all lie outside
   * [bufStart, bufEnd] — the current buffered range.
   */
  cancelIfOutside(bufStart: number, bufEnd: number): void {
    if (this.controller !== null && this.outside(this.inflightIds, bufStart, bufEnd)) {
      this.opts.onEvent?.({ type: 'load_cancelled', ids: [...this.inflightIds] })
      this.controller.abort()
    }
    this.queue = this.queue.filter((ids) => {
      if (this.outside(ids, bufStart, bufEnd)) {
        this.opts.onEvent?.({ type: 'load_cancelled', ids })
        for (const i of ids) this.queuedIds.delete(i)
        return false
      }
      return true
    })
  }

  dispose(): void {
    this.disposed = true
    this.controller?.abort()
    this.controller = null
    this.inflightIds.clear()
    this.queuedIds.clear()
    this.queue = []
  }

  private outside(ids: Iterable<number>, bufStart: number, bufEnd: number): boolean {
    for (const i of ids) {
      if (i >= bufStart && i <= bufEnd) return false
    }
    return true
  }

  private dropOldest(): void {
    const dropped = this.queue.shift()
    if (dropped === undefined) return
    this.opts.onEvent?.({ type: 'load_cancelled', ids: dropped })
    for (const i of dropped) this.queuedIds.delete(i)
  }

  private start(ids: number[]): void {
    this.controller = new AbortController()
    for (const i of ids) this.inflightIds.add(i)
    this.opts.onEvent?.({ type: 'load_requested', ids })
    this.api
      .getItems(ids, this.controller.signal)
      .then((items) => {
        this.finish()
        if (!this.disposed && items.length > 0) this.opts.onLanded(items)
        this.pump()
      })
      .catch(() => {
        this.finish()
        if (!this.disposed) this.pump()
      })
  }

  private finish(): void {
    this.inflightIds.clear()
    this.controller = null
  }

  private pump(): void {
    if (this.disposed || this.controller !== null) return
    while (this.queue.length > 0) {
      const next = this.queue.shift()
      if (next === undefined) break
      for (const i of next) this.queuedIds.delete(i)
      const fresh = next.filter((i) => !this.opts.isLoaded(i))
      if (fresh.length === 0) continue
      this.start(fresh)
      return
    }
  }
}
