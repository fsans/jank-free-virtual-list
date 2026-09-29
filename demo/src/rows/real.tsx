/** One real (loaded) component per ItemType. */
import { useEffect, useState, type ComponentType } from 'react'
import type { Payload, ItemType } from '../list/types'

function UserRow({ payload }: { payload: Payload }) {
  return (
    <div className="msg msg-user">
      {(payload.text ?? '').split('\n').map((line, k) => (
        <p key={k}>{line}</p>
      ))}
    </div>
  )
}

function AssistantRow({ payload }: { payload: Payload }) {
  return (
    <div className="msg msg-assistant">
      {(payload.text ?? '').split('\n\n').map((para, k) => (
        <p key={k}>{para}</p>
      ))}
    </div>
  )
}

function ToolRow({ payload }: { payload: Payload }) {
  return (
    <div className="tool">
      <span className="tool-dot" />
      <span>{payload.toolName}</span>
      <span className="tool-ms">{payload.toolMs}ms</span>
    </div>
  )
}

function CodeRow({ payload }: { payload: Payload }) {
  return (
    <pre className="code">
      <code>{(payload.lines ?? []).join('\n')}</code>
    </pre>
  )
}

/**
 * Payloads whose simulated decode already finished — remounts (row recycled
 * and re-mounted later) render decoded immediately instead of replaying.
 */
const decoded = new WeakSet<Payload>()

function ImageRow({ payload }: { payload: Payload }) {
  const [ready, setReady] = useState(() => decoded.has(payload))
  useEffect(() => {
    if (ready) return
    const t = setTimeout(() => {
      decoded.add(payload)
      setReady(true)
    }, payload.decodeMs ?? 300)
    return () => clearTimeout(t)
  }, [payload, ready])
  return (
    <figure className="img">
      <div className="img-box" style={{ aspectRatio: String(payload.aspect ?? 1) }}>
        {ready ? (
          <img src={payload.src} alt={`item ${payload.index}`} />
        ) : (
          <div className="img-decoding">decoding…</div>
        )}
      </div>
      {ready && payload.caption ? <figcaption>{payload.caption}</figcaption> : null}
    </figure>
  )
}

function DiffRow({ payload }: { payload: Payload }) {
  return (
    <div className="diff">
      {(payload.diff ?? []).map((l, k) => (
        <div key={k} className={`dl dl-${l.kind}`}>
          {l.text}
        </div>
      ))}
    </div>
  )
}

export const REAL: Record<ItemType, ComponentType<{ payload: Payload }>> = {
  user: UserRow,
  assistant: AssistantRow,
  tool: ToolRow,
  code: CodeRow,
  image: ImageRow,
  diff: DiffRow,
}
