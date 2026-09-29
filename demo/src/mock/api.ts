/** In-browser mock API: outline query, island fetches with latency, streaming. */
import type { OutlineEntry, Payload } from '../list/types'
import { Dataset, weightedType, type StreamEvent } from './dataset'

export type { StreamEvent }
export { Dataset }

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function abortError(): Error {
  const e = new Error('The request was aborted')
  e.name = 'AbortError'
  return e
}

/**
 * Mock API over a Dataset. All latencies are simulated with timers; no network.
 */
export class MockApi {
  latencyMin = 150
  latencyMax = 600
  private dataset: Dataset
  private streamTimer: ReturnType<typeof setTimeout> | null = null
  private streamHandler: ((ev: StreamEvent) => void) | null = null

  constructor(dataset: Dataset) {
    this.dataset = dataset
  }

  /** Index-only query: run-length encoded [{type, count}], ~30ms. */
  getOutline(): Promise<OutlineEntry[]> {
    return delay(30).then(() => this.dataset.outline())
  }

  /** Fetch payloads for ids; latency 150-600ms by default. Honors AbortSignal. */
  getItems(ids: readonly number[], signal?: AbortSignal): Promise<Payload[]> {
    if (signal?.aborted) return Promise.reject(abortError())
    const latency = this.latencyMin + Math.random() * Math.max(0, this.latencyMax - this.latencyMin)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve(ids.map((i) => this.dataset.payloadOf(i)))
      }, latency)
      function onAbort() {
        clearTimeout(timer)
        reject(abortError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** Streaming: every 300-800ms append an item or grow the last assistant item. */
  stream(onEvent: (ev: StreamEvent) => void): void {
    this.stopStream()
    this.streamHandler = onEvent
    const step = () => {
      if (!this.streamHandler) return
      if (Math.random() < 0.4) {
        const grown = this.dataset.growLastAssistant()
        if (grown !== null) {
          this.streamHandler({ kind: 'grow', index: grown.index, text: grown.text })
          this.streamTimer = setTimeout(step, 300 + Math.random() * 500)
          return
        }
      }
      const type = weightedType(Math.random())
      const index = this.dataset.append(type)
      this.streamHandler({ kind: 'append', index, type })
      this.streamTimer = setTimeout(step, 300 + Math.random() * 500)
    }
    this.streamTimer = setTimeout(step, 300 + Math.random() * 500)
  }

  stopStream(): void {
    if (this.streamTimer !== null) clearTimeout(this.streamTimer)
    this.streamTimer = null
    this.streamHandler = null
  }

  get streaming(): boolean {
    return this.streamHandler !== null
  }

  setLatency(min: number, max: number): void {
    this.latencyMin = min
    this.latencyMax = Math.max(min, max)
  }
}
