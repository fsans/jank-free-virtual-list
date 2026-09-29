import { useMemo } from 'react'
import VirtualList from './list/VirtualList'
import { MockApi } from './mock/api'
import { Dataset } from './mock/dataset'

interface Params {
  seed: number
  n: number
}

function readParams(): Params {
  const q = new URLSearchParams(window.location.search)
  const seed = Number(q.get('seed'))
  const n = Number(q.get('n'))
  return {
    seed: Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : 42,
    n: Number.isFinite(n) && n > 0 ? Math.floor(n) : 200_000,
  }
}

export default function App() {
  const params = useMemo(readParams, [])
  const api = useMemo(() => new MockApi(new Dataset(params.seed, params.n)), [params])
  return (
    <div className="app">
      <header className="app-header">
        <h1>jank-free virtual list</h1>
        <span className="app-meta">
          seed {params.seed} · {params.n.toLocaleString()} items
        </span>
      </header>
      <VirtualList api={api} />
    </div>
  )
}
