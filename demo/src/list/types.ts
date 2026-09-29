/** Item types rendered by the list. Each type has a skeleton estimate and a real row component. */
export type ItemType = 'user' | 'assistant' | 'tool' | 'code' | 'image' | 'diff'

/** Run-length encoded outline: the "index-only query" result. */
export interface OutlineEntry {
  type: ItemType
  count: number
}

export interface DiffLine {
  kind: 'ctx' | 'add' | 'del' | 'hunk'
  text: string
}

/**
 * Payload for one item. Rows without a payload render the skeleton for their type
 * at the estimated height for that type.
 */
export interface Payload {
  id: string
  index: number
  type: ItemType
  /** user/assistant: message text (assistant uses \n\n between paragraphs) */
  text?: string
  /** code block lines */
  lines?: string[]
  /** unified diff lines */
  diff?: DiffLine[]
  /** tool one-liner */
  toolName?: string
  toolMs?: number
  /** image: object URL / data URI + aspect ratio (w/h) */
  src?: string
  aspect?: number
  /** image: simulated decode delay (200-1500ms) before image + caption appear */
  decodeMs?: number
  /** image caption, only added to the DOM after the image "decodes" */
  caption?: string
}

/** A row as the virtualizer sees it. `payload === undefined` => skeleton. */
export interface Row {
  id: string
  index: number
  type: ItemType
  payload?: Payload
}

export const ITEM_TYPES: readonly ItemType[] = [
  'user',
  'assistant',
  'tool',
  'code',
  'image',
  'diff',
]

/** Initial skeleton height estimates per type (px), from the spec. */
export const INITIAL_ESTIMATES: Record<ItemType, number> = {
  user: 56,
  assistant: 140,
  tool: 36,
  code: 220,
  image: 240,
  diff: 180,
}
