import { useEffect, useState } from 'react'
import { Database, Server, Search as SearchIcon } from 'lucide-react'

type Health = {
  ok: boolean
  db: boolean
  meili: boolean
  port?: number
}

export default function HealthStatus() {
  const [health, setHealth] = useState<Health | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    fetch('/api/health')
      .then(r => r.json())
      .then(d => { if (mounted) setHealth(d) })
      .catch(() => { if (mounted) setHealth(null) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  return (
    <div className="absolute left-1/2 top-full -translate-x-1/2 mt-2 z-50 w-max max-w-[220px] opacity-0 scale-95 invisible group-hover:opacity-100 group-hover:scale-100 group-hover:visible transition-all duration-150">
      <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-2 text-xs">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-slate-800"><Server size={12} /> API</span>
            <span className="inline-flex items-center gap-1">
              <span className={`${health?.ok ? 'bg-emerald-500' : loading ? 'bg-slate-400' : 'bg-amber-500'} w-2 h-2 rounded-full`}></span>
              {health?.ok ? 'OK' : loading ? 'Provjera…' : 'N/A'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-slate-800"><Database size={12} /> DB</span>
            <span className="inline-flex items-center gap-1">
              <span className={`${health?.db ? 'bg-emerald-500' : loading ? 'bg-slate-400' : 'bg-amber-500'} w-2 h-2 rounded-full`}></span>
              {health?.db ? 'Povezano' : loading ? 'Provjera…' : 'Nepovezano'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-slate-800"><SearchIcon size={12} /> Search</span>
            <span className="inline-flex items-center gap-1">
              <span className={`${health?.meili ? 'bg-emerald-500' : 'bg-slate-400'} w-2 h-2 rounded-full`}></span>
              {health?.meili ? 'MeiliSearch' : 'SQLite'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
