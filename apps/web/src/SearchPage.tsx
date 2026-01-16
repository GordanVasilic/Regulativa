import { useEffect, useState } from 'react'
import { X, Search, ChevronRight } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

type SegmentHit = {
  id: number
  law_id: number
  label: string
  number: number
  page_hint: number
  text: string
  law_title?: string
  gazette_key?: string | null
}

const API_BASE = import.meta.env.VITE_API_URL || '/api'

export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [hits, setHits] = useState<SegmentHit[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState<number | null>(null)
  const [offset, setOffset] = useState(0)
  const pageSize = 20
  const [jurisdiction, setJurisdiction] = useState<string>(params.get('jurisdiction') ?? '')
  const [lawId, setLawId] = useState<number | null>(params.get('law_id') ? Number(params.get('law_id')!) : null)
  const [gazetteKey, setGazetteKey] = useState<string>(params.get('gazette_key') || '')

  useEffect(() => {
    const initial = params.get('q') || ''
    const initialJur = params.get('jurisdiction') ?? jurisdiction
    const initialOffset = Number(params.get('offset') || 0)
    const initialLawId = params.get('law_id') ? Number(params.get('law_id')!) : null
    const initialGazette = params.get('gazette_key') || ''
    setQ(initial)
    setJurisdiction(initialJur)
    setLawId(typeof initialLawId === 'number' && !Number.isNaN(initialLawId) ? initialLawId : null)
    setGazetteKey(initialGazette)
    async function restore() {
      if (!initial) return
      if (initialOffset > 0) {
        await fetchUpTo(initial, initialOffset, initialJur)
      } else {
        await doSearch(initial, true, initialJur)
      }
    }
    void restore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function doSearch(term: string, replace = false, jur?: string) {
    setLoading(true)
    try {
      const usp = new URLSearchParams()
      usp.set('q', term)
      usp.set('limit', String(pageSize))
      usp.set('offset', String(replace ? 0 : offset))
      const effectiveJur = jur ?? jurisdiction
      if (effectiveJur) usp.set('jurisdiction', effectiveJur)
      let lawIdToUse: number | null = lawId
      const lower = term.toLowerCase()
      const hasArticle = /(?:\b[čc]lan(?:ak)?\b|\b[čc]l\.?\b)\s*(\d{1,4})/i.test(lower)
      if (hasArticle && (lawIdToUse === null || Number.isNaN(lawIdToUse))) {
        const lsp = new URLSearchParams()
        lsp.set('q', term)
        lsp.set('limit', '10')
        lsp.set('offset', '0')
        if (effectiveJur) lsp.set('jurisdiction', effectiveJur)
        try {
          const lres = await fetch(`${API_BASE}/laws/search?${lsp.toString()}`)
          const ljson = await lres.json()
          const candidates = Array.isArray(ljson?.hits) ? ljson.hits : (Array.isArray(ljson) ? ljson : [])
          const stripDia = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          const norm = (s: string) => stripDia(s).toLowerCase()
          const rawTokens = term.split(/\s+/).map((t) => t.trim()).filter(Boolean)
          const meaningful = rawTokens
            .map((t) => norm(t))
            .filter((t) => t.length >= 3)
            .filter((t) => !/^\d+$/.test(t))
            .filter((t) => !/^(clan|cl|cl\.|clanak|zakon|o)$/.test(t))
          let picked: any = null
          for (const c of candidates) {
            const titleN = norm(String(c.title ?? ''))
            const okAll = meaningful.length > 0 && meaningful.every((t) => titleN.includes(t))
            const okSome = meaningful.length > 0 && meaningful.some((t) => titleN.includes(t))
            if (okAll) { picked = c; break }
            if (!picked && okSome) picked = c
          }
          if (picked && typeof picked.id === 'number') {
            lawIdToUse = picked.id
            setLawId(picked.id)
          }
        } catch { }
      }
      if (lawIdToUse !== null && !Number.isNaN(lawIdToUse)) usp.set('law_id', String(lawIdToUse))
      if (gazetteKey) usp.set('gazette_key', gazetteKey)
      const res = await fetch(`${API_BASE}/segments/search?${usp.toString()}`)
      const json = await res.json()
      const newHits = json.hits ?? json
      setHits(replace ? newHits : [...hits, ...newHits])
      setTotal(json.total ?? null)
      const newOffset = (replace ? 0 : offset) + (Array.isArray(newHits) ? newHits.length : 0)
      setOffset(newOffset)
      const next = new URLSearchParams()
      next.set('q', term)
      if (effectiveJur) next.set('jurisdiction', effectiveJur)
      if (lawIdToUse !== null && !Number.isNaN(lawIdToUse)) next.set('law_id', String(lawIdToUse))
      if (gazetteKey) next.set('gazette_key', gazetteKey)
      next.set('offset', String(newOffset))
      setParams(next)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function fetchUpTo(term: string, upto: number, jur?: string) {
    setLoading(true)
    try {
      const usp = new URLSearchParams()
      usp.set('q', term)
      usp.set('limit', String(Math.max(pageSize, upto)))
      usp.set('offset', '0')
      const effectiveJur = jur ?? jurisdiction
      if (effectiveJur) usp.set('jurisdiction', effectiveJur)
      if (lawId !== null && !Number.isNaN(lawId)) usp.set('law_id', String(lawId))
      if (gazetteKey) usp.set('gazette_key', gazetteKey)
      const res = await fetch(`${API_BASE}/segments/search?${usp.toString()}`)
      const json = await res.json()
      const newHits = json.hits ?? json
      setHits(newHits)
      setTotal(json.total ?? null)
      const newOffset = Array.isArray(newHits) ? newHits.length : 0
      setOffset(newOffset)
      const next = new URLSearchParams()
      next.set('q', term)
      if (effectiveJur) next.set('jurisdiction', effectiveJur)
      if (lawId !== null && !Number.isNaN(lawId)) next.set('law_id', String(lawId))
      if (gazetteKey) next.set('gazette_key', gazetteKey)
      next.set('offset', String(newOffset))
      setParams(next)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const next = new URLSearchParams()
    next.set('q', q)
    if (jurisdiction) next.set('jurisdiction', jurisdiction)
    if (lawId !== null && !Number.isNaN(lawId)) next.set('law_id', String(lawId))
    if (gazetteKey) next.set('gazette_key', gazetteKey)
    next.set('offset', '0')
    setParams(next)
    setOffset(0)
    setHits([])
    void doSearch(q, true)
  }

  function clearSearch() {
    const next = new URLSearchParams()
    if (jurisdiction) next.set('jurisdiction', jurisdiction)
    if (lawId !== null && !Number.isNaN(lawId)) next.set('law_id', String(lawId))
    if (gazetteKey) next.set('gazette_key', gazetteKey)
    next.set('offset', '0')
    setParams(next)
    setQ('')
    setHits([])
    setOffset(0)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Rezultati pretrage</h1>

      {/* Search Form */}
      <form onSubmit={onSubmit} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
              <Search size={18} />
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Unesite pojam..."
              className="w-full pl-11 pr-10 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {q && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full p-1"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <select
            value={jurisdiction}
            onChange={(e) => { const j = e.target.value; setJurisdiction(j); setOffset(0); setHits([]); const next = new URLSearchParams(); next.set('q', q); if (j) next.set('jurisdiction', j); if (lawId !== null && !Number.isNaN(lawId)) next.set('law_id', String(lawId)); if (gazetteKey) next.set('gazette_key', gazetteKey); next.set('offset', '0'); setParams(next); if (q) void doSearch(q, true, j) }}
            className="border-2 border-gray-200 rounded-xl px-4 py-3 bg-white text-gray-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-[180px]"
          >
            <option value="">Sve</option>
            <option value="RS">Republika Srpska</option>
            <option value="FBiH">Federacija BiH</option>
            <option value="SRB">Srbija</option>
            <option value="BRCKO">Brčko Distrikt</option>
            <option value="Crna Gora">Crna Gora</option>
          </select>
          <button type="submit" className="bg-gradient-to-r from-blue-600 to-blue-500 text-white px-8 py-3 rounded-xl font-semibold hover:from-blue-700 hover:to-blue-600 shadow-md hover:shadow-lg transition-all">
            Traži
          </button>
        </div>
      </form>

      {/* Active Filters */}
      {(lawId !== null && !Number.isNaN(lawId)) || gazetteKey ? (
        <div className="flex gap-2">
          {lawId !== null && !Number.isNaN(lawId) && (
            <span className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium">Zakon #{lawId}</span>
          )}
          {gazetteKey && (
            <span className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium">{gazetteKey}</span>
          )}
        </div>
      ) : null}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-gray-600">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          Pretraga u toku...
        </div>
      )}

      {/* No Results */}
      {!loading && hits.length === 0 && q && (
        <div className="text-center py-12 bg-white rounded-2xl border border-gray-200">
          <div className="text-gray-600">Nema rezultata za vašu pretragu.</div>
        </div>
      )}

      {/* Results */}
      {hits.length > 0 && (
        <div className="space-y-4">
          <div className="text-sm text-gray-600 font-medium">
            {total !== null ? `Pronađeno ${total} rezultata` : `${hits.length} rezultata`}
          </div>

          <div className="space-y-3">
            {hits.map((h) => (
              <div key={h.id} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 hover:shadow-md hover:border-blue-300 transition-all group">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1">
                    <div className="font-semibold text-lg mb-2 text-gray-900 group-hover:text-blue-600 transition-colors">
                      {h.law_title || 'Zakon'}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {h.gazette_key && (
                        <span className="px-2.5 py-1 bg-gray-100 rounded-lg font-medium text-gray-700">{h.gazette_key}</span>
                      )}
                      <span className="px-2.5 py-1 bg-blue-100 rounded-lg font-semibold text-blue-700">{h.label}</span>
                      {h.page_hint && (
                        <span className="text-gray-600">Strana {h.page_hint}</span>
                      )}
                    </div>
                  </div>
                </div>
                <p className="text-gray-700 leading-relaxed mb-4">
                  {h.text?.slice(0, 280)}{h.text && h.text.length > 280 ? '...' : ''}
                </p>
                <Link
                  className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold group/link"
                  to={{
                    pathname: `/viewer/${h.law_id}`,
                    search: `?from=search&q=${encodeURIComponent(q)}${jurisdiction ? `&jurisdiction=${jurisdiction}` : ''}&offset=${offset}&hl=${encodeURIComponent((h.text || '').slice(0, 200))}${typeof h.number === 'number' ? `&num=${h.number}` : ''}`,
                    hash: h.page_hint ? `#page=${h.page_hint}` : ''
                  }}
                >
                  Otvori PDF
                  <ChevronRight className="group-hover/link:translate-x-1 transition-transform" size={16} />
                </Link>
              </div>
            ))}
          </div>

          {/* Load More */}
          {(total === null || hits.length < total) && (
            <div className="text-center pt-4">
              <button
                onClick={() => doSearch(q)}
                className="px-8 py-3 bg-white border-2 border-blue-600 text-blue-600 rounded-xl font-semibold hover:bg-blue-50 transition-all shadow-sm hover:shadow-md"
                disabled={loading}
              >
                {loading ? 'Učitavam...' : 'Prikaži još rezultata'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}