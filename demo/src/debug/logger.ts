/**
 * Structured virtualizer event log — the "agent view" (schema per
 * implementation-notes.md "Debug log schema"). Ring buffer of the last `cap`
 * events; the M8 debug panel reads this.
 */
export interface VListEvent {
  t: number
  event: string
  [key: string]: unknown
}

export class RingLog {
  private buf: VListEvent[] = []

  constructor(readonly cap = 10_000) {}

  push(event: string, fields?: Record<string, unknown>): void {
    this.buf.push({ ...(fields ?? {}), event, t: Date.now() })
    if (this.buf.length > this.cap) this.buf.splice(0, this.buf.length - this.cap)
  }

  events(): readonly VListEvent[] {
    return this.buf
  }

  get length(): number {
    return this.buf.length
  }

  clear(): void {
    this.buf = []
  }
}
