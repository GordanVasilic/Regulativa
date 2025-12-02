import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, TrendingUp, FileText, Calendar, ArrowRight } from 'lucide-react'

interface Law {
  id: number
  title: string
  jurisdiction: string
  gazette_key: string
  gazette_date: string
  views_count: number
}

interface HomeListsProps {
  jurisdiction?: string
}

function formatJurisdiction(jurisdiction: string): string {
  if (jurisdiction === 'BRCKO') return 'BRČKO DISTRIKT'
  return jurisdiction
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return null
  try {
    const date = new Date(dateStr)
    return new Intl.DateTimeFormat('sr-BA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date)
  } catch (e) {
    return dateStr
  }
}

export default function HomeLists({ jurisdiction }: HomeListsProps) {
  const [latest, setLatest] = useState<Law[]>([])
  const [popular, setPopular] = useState<Law[]>([])

  useEffect(() => {
    const params = new URLSearchParams()
    params.set('limit', '6')
    params.set('sort', 'gazette_desc')
    if (jurisdiction) params.set('jurisdiction', jurisdiction)

    fetch(`/api/laws?${params}`)
      .then(res => res.json())
      .then(data => setLatest(Array.isArray(data) ? data : []))
      .catch(err => console.error(err))

    const topParams = new URLSearchParams()
    topParams.set('limit', '6')
    if (jurisdiction) topParams.set('jurisdiction', jurisdiction)

    fetch(`/api/laws/top?${topParams}`)
      .then(res => res.json())
      .then(data => setPopular(Array.isArray(data) ? data : []))
      .catch(err => console.error(err))
  }, [jurisdiction])

  return (
    <div className="grid md:grid-cols-2 gap-8">
      {/* Latest Laws */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
              <Clock size={20} />
            </div>
            <h3 className="font-semibold text-slate-900">Najnoviji propisi</h3>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {latest.map(law => (
            <Link
              key={law.id}
              to={`/viewer/${law.id}`}
              className="block p-4 hover:bg-slate-50 transition-all group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="font-medium text-slate-800 group-hover:text-blue-600 transition-colors line-clamp-2 leading-snug">
                    {law.title}
                  </h4>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                      {formatJurisdiction(law.jurisdiction)}
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText size={12} />
                      {law.gazette_key}
                    </span>
                    {law.gazette_date && (
                      <span className="flex items-center gap-1">
                        <Calendar size={12} />
                        {formatDate(law.gazette_date)}
                      </span>
                    )}
                  </div>
                </div>
                <ArrowRight size={16} className="text-slate-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all mt-1" />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Most Viewed */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
              <TrendingUp size={20} />
            </div>
            <h3 className="font-semibold text-slate-900">Najčitanije</h3>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {popular.map(law => (
            <Link
              key={law.id}
              to={`/viewer/${law.id}`}
              className="block p-4 hover:bg-slate-50 transition-all group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="font-medium text-slate-800 group-hover:text-emerald-600 transition-colors line-clamp-2 leading-snug">
                    {law.title}
                  </h4>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                      {formatJurisdiction(law.jurisdiction)}
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText size={12} />
                      {law.gazette_key}
                    </span>
                    <span className="text-emerald-600 font-medium flex items-center gap-1">
                      <TrendingUp size={12} />
                      {law.views_count}
                    </span>
                  </div>
                </div>
                <ArrowRight size={16} className="text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all mt-1" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
