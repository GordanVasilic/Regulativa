import { useState, useEffect, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, X, ChevronDown } from 'lucide-react'

export type Law = {
  id: number
  title: string
  jurisdiction: string
  gazette_key?: string | null
  gazette_date?: string | null
}

export type Segment = {
  id: number
  law_id: number
  label: string
  text: string
  number?: number
  law_title?: string
  jurisdiction?: string
  gazette_key?: string | null
  gazette_date?: string | null
}

const API = '/api'

interface GlobalSearchProps {
  onSearchResults?: (laws: Law[], segments: Segment[], query?: string) => void
}

export default function GlobalSearch({ onSearchResults }: GlobalSearchProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [jurisdiction, setJurisdiction] = useState(searchParams.get('jurisdiction') || '')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const newParams = new URLSearchParams(searchParams)
    if (query) {
      newParams.set('q', query)
    } else {
      newParams.delete('q')
    }

    if (jurisdiction) {
      newParams.set('jurisdiction', jurisdiction)
    } else {
      newParams.delete('jurisdiction')
    }

    setSearchParams(newParams, { replace: true })

    if (!query.trim()) {
      if (onSearchResults) onSearchResults([], [], '')
      return
    }

    const timer = setTimeout(() => {
      doSearch(query)
    }, 300)

    return () => clearTimeout(timer)
  }, [query, jurisdiction])

  const doSearch = async (term: string) => {
    if (!term.trim()) return

    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('q', term)
      params.set('limit', '8')
      if (jurisdiction) params.set('jurisdiction', jurisdiction)

      const [lawsRes, segsRes] = await Promise.all([
        fetch(`${API}/laws/search?${params.toString()}`),
        fetch(`${API}/segments/search?${params.toString()}`)
      ])

      const lawsData = await lawsRes.json()
      const segsData = await segsRes.json()

      const laws = Array.isArray(lawsData?.hits) ? lawsData.hits : Array.isArray(lawsData) ? lawsData : []
      const segments = Array.isArray(segsData?.hits) ? segsData.hits : Array.isArray(segsData) ? segsData : []

      // Extract unique parent laws from segments that aren't already in the laws list
      const existingLawIds = new Set(laws.map((l: Law) => l.id))
      const inferredLaws: Law[] = []

      for (const seg of segments) {
        if (!existingLawIds.has(seg.law_id) && seg.law_title) {
          existingLawIds.add(seg.law_id)
          inferredLaws.push({
            id: seg.law_id,
            title: seg.law_title,
            jurisdiction: seg.jurisdiction || '',
            gazette_key: seg.gazette_key,
            gazette_date: seg.gazette_date
          })
        }
      }

      // Combine direct matches with inferred laws
      const allLaws = [...laws, ...inferredLaws]

      if (onSearchResults) {
        onSearchResults(allLaws, segments, term)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    if (!query.trim()) return
    doSearch(query)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  return (
    <div className="relative z-50 max-w-4xl mx-auto">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-2 flex flex-col md:flex-row gap-2">

        {/* Jurisdiction Select */}
        <div className="relative min-w-[180px]">
          <select
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            className="w-full h-12 pl-4 pr-10 bg-slate-50 hover:bg-slate-100 border-none rounded-xl text-slate-700 font-medium focus:ring-2 focus:ring-blue-100 appearance-none cursor-pointer transition-colors"
          >
            <option value="">Sve jurisdikcije</option>
            <option value="FBiH">FBiH</option>
            <option value="RS">Republika Srpska</option>
            <option value="SRB">Srbija</option>
            <option value="BRCKO">Brčko Distrikt</option>
            <option value="Crna Gora">Crna Gora</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
        </div>

        {/* Search Input */}
        <div className="flex-1 relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
            <Search size={20} />
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pretražite zakone, članove, pojmove..."
            className="w-full h-12 pl-12 pr-10 bg-white border-none text-lg text-slate-800 placeholder-slate-400 focus:ring-0 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); if (onSearchResults) onSearchResults([], [], ''); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-300 hover:text-slate-500 rounded-full hover:bg-slate-100 transition-colors"
            >
              <X size={16} />
            </button>
          )}

          {/* Loading indicator */}
          {loading && (
            <div className="absolute right-10 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}
        </div>

        {/* Search Button */}
        <button
          onClick={handleSearch}
          className="h-12 px-8 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-lg shadow-blue-200 transition-all active:scale-95"
        >
          Pretraži
        </button>
      </div>
    </div>
  )
}
