import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, Search, ArrowLeft, Eye, XCircle, ChevronLeft, ChevronRight, Pencil } from 'lucide-react'

type Law = {
  id: number
  title: string
  jurisdiction: string
  gazette_key?: string
  gazette_date?: string
}

const API_BASE = 'http://localhost:5000'
const JURISDICTIONS = ['RS', 'FBiH', 'BiH', 'Crna Gora', 'Brcko', 'Srbija']

export default function AdminLawsList() {
  const [laws, setLaws] = useState<Law[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<string>('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)

  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [selectedLaws, setSelectedLaws] = useState<Set<number>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const fetchLaws = async () => {
    setLoading(true)
    try {
      const offset = (page - 1) * limit
      const params = new URLSearchParams()
      params.set('limit', String(limit))
      params.set('offset', String(offset))
      params.set('format', 'paged')
      params.set('sort', 'date_desc')
      if (selectedJurisdiction) params.set('jurisdiction', selectedJurisdiction)
      if (search) params.set('q', search)
      
      const res = await fetch(`${API_BASE}/laws?${params}`)
      const data = await res.json()
      // Backend returns { data, total, limit, offset }
      if (data.data) {
        setLaws(data.data)
        setTotal(data.total)
      } else {
        // Fallback
        setLaws(Array.isArray(data) ? data : [])
        setTotal(0)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Debounce search
    const timer = setTimeout(() => {
      setPage(1)
      fetchLaws()
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    // Only refetch if search didn't change (handled above)
    // Avoid double fetch on search change
    // Actually, we can combine effects, but search needs debounce.
    // If we just add search to dep array of fetchLaws, it fetches on every keystroke.
    // So we invoke fetchLaws directly here for other deps.
    fetchLaws()
  }, [page, limit, selectedJurisdiction]) 

  // Reset page when filter changes
  useEffect(() => {
    setPage(1)
  }, [selectedJurisdiction, limit])

  const deleteLawApi = async (id: number) => {
    const res = await fetch(`${API_BASE}/api/admin/laws/${id}`, {
      method: 'DELETE'
    })
    if (!res.ok) throw new Error(`Brisanje zakona ${id} nije uspjelo`)
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('Da li ste sigurni da želite obrisati ovaj zakon? Ovo će obrisati i sve povezane fajlove.')) {
      return
    }

    setDeletingId(id)
    try {
      await deleteLawApi(id)
      
      // Remove from local state
      setLaws(prev => prev.filter(l => l.id !== id))
      setSelectedLaws(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    } catch (e) {
      alert('Greška pri brisanju: ' + String(e))
    } finally {
      setDeletingId(null)
    }
  }

  const handleBulkDelete = async () => {
    const count = selectedLaws.size
    if (count === 0) return
    
    if (!window.confirm(`Da li ste sigurni da želite obrisati ${count} odabranih zakona? Ova akcija je nepovratna.`)) {
      return
    }

    setBulkDeleting(true)
    try {
      // Execute sequentially to avoid overwhelming server or hitting locks
      for (const id of selectedLaws) {
        await deleteLawApi(id)
      }
      
      // Remove all deleted from state
      setLaws(prev => prev.filter(l => !selectedLaws.has(l.id)))
      setSelectedLaws(new Set())
    } catch (e) {
      alert('Došlo je do greške tokom brisanja: ' + String(e))
      // Refresh list to sync state
      fetchLaws()
    } finally {
      setBulkDeleting(false)
    }
  }

  const toggleSelectAll = (filtered: Law[]) => {
    if (selectedLaws.size === filtered.length && filtered.length > 0) {
      setSelectedLaws(new Set())
    } else {
      setSelectedLaws(new Set(filtered.map(l => l.id)))
    }
  }

  const toggleSelect = (id: number) => {
    setSelectedLaws(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filteredLaws = laws // Backend now handles filtering

  const totalPages = Math.ceil(total / limit)

  const allSelected = filteredLaws.length > 0 && selectedLaws.size === filteredLaws.length

  return (
    <div className="max-w-6xl mx-auto bg-white p-8 rounded-xl shadow-lg border border-slate-100">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link to="/" className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <ArrowLeft className="w-6 h-6 text-slate-600" />
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Administracija Zakona</h1>
        </div>
        <div className="flex items-center gap-3">
            {selectedLaws.size > 0 && (
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium border border-red-200"
              >
                {bulkDeleting ? (
                  'Brisanje...'
                ) : (
                  <>
                    <Trash2 size={18} />
                    Obriši odabrano ({selectedLaws.size})
                  </>
                )}
              </button>
            )}
            <Link 
              to="/admin/laws/new" 
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm font-medium"
            >
              <Plus size={20} />
              Dodaj Novi Zakon
            </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input 
            type="text" 
            placeholder="Pretraži zakone..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all"
          />
        </div>
        
        <div className="relative min-w-[200px]">
            <select
              value={selectedJurisdiction}
              onChange={(e) => setSelectedJurisdiction(e.target.value)}
              className="w-full pl-4 pr-10 py-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none appearance-none bg-white transition-all cursor-pointer"
            >
              <option value="">Sve nadležnosti</option>
              {JURISDICTIONS.map(j => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
            {selectedJurisdiction && (
                <button 
                  onClick={() => setSelectedJurisdiction('')}
                  className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                    <XCircle size={16} />
                </button>
            )}
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
            <tr>
              <th className="px-4 py-3 w-10 text-center">
                <input 
                  type="checkbox" 
                  checked={allSelected}
                  onChange={() => toggleSelectAll(filteredLaws)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </th>
              <th className="px-4 py-3 w-16 text-center">ID</th>
              <th className="px-4 py-3">Naslov</th>
              <th className="px-4 py-3 w-32">Nadležnost</th>
              <th className="px-4 py-3 w-32">Glasnik</th>
              <th className="px-4 py-3 w-32">Datum SG</th>
              <th className="px-4 py-3 w-32 text-right">Akcije</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">Učitavam zakone...</td>
              </tr>
            ) : filteredLaws.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">Nema pronađenih zakona.</td>
              </tr>
            ) : (
              filteredLaws.map(law => {
                const isSelected = selectedLaws.has(law.id)
                return (
                  <tr key={law.id} className={`hover:bg-slate-50 transition-colors group ${isSelected ? 'bg-blue-50/50' : ''}`}>
                    <td className="px-4 py-3 text-center">
                        <input 
                          type="checkbox" 
                          checked={isSelected}
                          onChange={() => toggleSelect(law.id)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                    </td>
                    <td className="px-4 py-3 text-center text-slate-500 font-mono text-xs">{law.id}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{law.title}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-xs font-semibold text-slate-600 border border-slate-200">
                        {law.jurisdiction}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 font-mono text-xs">{law.gazette_key || '—'}</td>
                    <td className="px-4 py-3 text-slate-600 font-mono text-xs whitespace-nowrap">
                      {law.gazette_date ? new Date(law.gazette_date).toLocaleDateString('sr-BA') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link 
                          to={`/viewer/${law.id}`} 
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="Pregledaj"
                        >
                          <Eye size={18} />
                        </Link>
                        <Link 
                          to={`/admin/laws/${law.id}/edit`} 
                          className="p-1.5 text-slate-500 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                          title="Izmijeni"
                        >
                          <Pencil size={18} />
                        </Link>
                        <button 
                          onClick={() => handleDelete(law.id)}
                          disabled={deletingId === law.id}
                          className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Obriši"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      
      <div className="mt-6 flex items-center justify-between text-sm text-slate-500">
        <div>
          {selectedLaws.size > 0 && <span className="font-medium text-blue-600">Odabrano: {selectedLaws.size}</span>}
        </div>
        
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-slate-600">
                <span>Prikaži:</span>
                <select 
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="bg-white border border-slate-200 rounded px-2 py-1 focus:ring-2 focus:ring-blue-100 outline-none"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={10000}>Svi</option>
                </select>
            </div>

            <div className="text-slate-400">
                Prikazano {filteredLaws.length} od {total} zakona (strana {page} od {totalPages})
            </div>
            
            <div className="flex items-center gap-1">
                <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading}
                    className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <ChevronLeft size={18} />
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    // Simple logic to show a window of pages around current page
                    let p = page - 2 + i
                    if (page < 3) p = i + 1
                    if (page > totalPages - 2) p = totalPages - 4 + i
                    
                    if (p > 0 && p <= totalPages) {
                        return (
                            <button
                                key={p}
                                onClick={() => setPage(p)}
                                disabled={loading}
                                className={`w-8 h-8 rounded-md text-sm font-medium transition-colors ${
                                    page === p 
                                    ? 'bg-blue-600 text-white' 
                                    : 'hover:bg-slate-50 text-slate-600'
                                }`}
                            >
                                {p}
                            </button>
                        )
                    }
                    return null
                })}
                <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || loading}
                    className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <ChevronRight size={18} />
                </button>
            </div>
        </div>
      </div>
    </div>
  )
}
