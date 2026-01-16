import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import AdminLayout from './components/AdminLayout'

import {
  Database, Server, RefreshCw, AlertTriangle, CheckCircle,
  FileText, Cloud, Download, Plus, Trash2, Search, XCircle,
  ChevronLeft, ChevronRight, Pencil, Home, Filter
} from 'lucide-react'

// Types
type SystemStats = {
  ram: { total: number; used: number; percent: number }
  disk: { total: number; used: number; percent: number }
  uptime: number
}

type MeiliStats = {
  db_count: number
  meili_count: number
  status: 'running' | 'error' | 'disabled' | 'unknown'
  sync_health: 'ok' | 'mismatch'
}

type SyncStats = {
  local_count: number
  remote_count: number
  diff: number
  status: 'online' | 'unreachable' | string
}

type Law = {
  id: number
  title: string
  jurisdiction: string
  gazette_key?: string
  gazette_date?: string
}

const API_BASE = import.meta.env.VITE_API_URL || '/api'
const JURISDICTIONS = ['RS', 'FBiH', 'BiH', 'Crna Gora', 'Brcko', 'Srbija']

export default function AdminDashboard() {
  // --- Stats State ---
  const [sysStats, setSysStats] = useState<SystemStats | null>(null)
  const [meiliStats, setMeiliStats] = useState<MeiliStats | null>(null)
  const [syncStats, setSyncStats] = useState<SyncStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(false)

  // --- Actions State ---
  const [actionLoading, setActionLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // --- Laws List State ---
  const [laws, setLaws] = useState<Law[]>([])
  const [totalLaws, setTotalLaws] = useState(0)
  const [loadingLaws, setLoadingLaws] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<string>('')
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [selectedLaws, setSelectedLaws] = useState<Set<number>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // --- Advanced Filters State ---
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [filterId, setFilterId] = useState('')
  const [filterTitle, setFilterTitle] = useState('')
  const [filterGazette, setFilterGazette] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')

  // --- Fetchers ---

  const fetchStats = async () => {
    setLoadingStats(true)
    try {
      const [sysRes, meiliRes, syncRes] = await Promise.all([
        fetch(`${API_BASE}/admin/stats/system`),
        fetch(`${API_BASE}/admin/stats/meili`),
        fetch(`${API_BASE}/admin/sync/compare`)
      ])

      if (sysRes.ok) setSysStats(await sysRes.json())
      if (meiliRes.ok) setMeiliStats(await meiliRes.json())
      if (syncRes.ok) setSyncStats(await syncRes.json())
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingStats(false)
    }
  }

  const fetchLaws = async () => {
    setLoadingLaws(true)
    try {
      const offset = (page - 1) * limit
      const params = new URLSearchParams()
      params.set('limit', String(limit))
      params.set('offset', String(offset))
      params.set('format', 'paged')
      params.set('sort', 'date_desc')
      if (selectedJurisdiction) params.set('jurisdiction', selectedJurisdiction)
      if (search) params.set('q', search)

      // Advanced filters
      if (filterId) params.set('id', filterId)
      if (filterTitle) params.set('title', filterTitle)
      if (filterGazette) params.set('gazette_key', filterGazette)
      if (filterDateFrom) params.set('date_from', filterDateFrom)
      if (filterDateTo) params.set('date_to', filterDateTo)

      // Note: API_BASE already includes /api. 
      // Nginx is configured to proxy /api/ to the backend root.
      // So /api/laws will be proxied to backend:5000/laws.
      const res = await fetch(`${API_BASE}/laws?${params}`)
      const data = await res.json()

      if (data.data) {
        setLaws(data.data)
        setTotalLaws(data.total)
      } else {
        setLaws(Array.isArray(data) ? data : [])
        setTotalLaws(0)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingLaws(false)
    }
  }

  // --- Effects ---

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 30000) // Refresh stats every 30s
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
      fetchLaws()
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    fetchLaws()
  }, [page, limit, selectedJurisdiction])

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
      fetchLaws()
    }, 300)
    return () => clearTimeout(timer)
  }, [filterId, filterTitle, filterGazette, filterDateFrom, filterDateTo])

  // --- Actions ---

  const triggerReindex = async () => {
    if (!confirm('Jeste li sigurni? Ovo će pokrenuti reindeksiranje u pozadini.')) return
    setActionLoading(true)
    try {
      const res = await fetch(`${API_BASE}/admin/actions/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'full' })
      })
      if (res.ok) {
        setMsg({ type: 'success', text: 'Reindeksiranje pokrenuto!' })
      } else {
        const data = await res.json()
        throw new Error(data.error)
      }
    } catch (e) {
      setMsg({ type: 'error', text: String(e) })
    } finally {
      setActionLoading(false)
    }
  }

  const triggerStartMeili = async () => {
    setActionLoading(true)
    try {
      const res = await fetch(`${API_BASE}/admin/actions/start-meili`, {
        method: 'POST'
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Ne mogu pokrenuti MeiliSearch')
      }
      setMsg({ type: 'success', text: data.message || 'MeiliSearch start pokrenut.' })
    } catch (e) {
      setMsg({ type: 'error', text: String(e) })
    } finally {
      setActionLoading(false)
    }
  }

  const triggerSync = async () => {
    if (!confirm('Pokrenuti sinhronizaciju sa produkcije? Ovo može potrajati.')) return
    setActionLoading(true)
    try {
      const res = await fetch(`${API_BASE}/admin/actions/sync`, { method: 'POST' })
      if (res.ok) {
        setMsg({ type: 'success', text: 'Sinhronizacija pokrenuta u pozadini.' })
      } else {
        throw new Error('Sync failed to start')
      }
    } catch (e) {
      setMsg({ type: 'error', text: String(e) })
    } finally {
      setActionLoading(false)
    }
  }

  const deleteLawApi = async (id: number) => {
    const res = await fetch(`${API_BASE}/admin/laws/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`Brisanje zakona ${id} nije uspjelo`)
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('Da li ste sigurni da želite obrisati ovaj zakon? Ova akcija je nepovratna.')) return
    try {
      await deleteLawApi(id)
      setLaws(prev => prev.filter(l => l.id !== id))
      setMsg({ type: 'success', text: 'Zakon obrisan.' })
    } catch (e) {
      alert(String(e))
    }
  }

  const handleBulkDelete = async () => {
    if (!window.confirm(`Obrisati ${selectedLaws.size} zakona?`)) return
    setBulkDeleting(true)
    try {
      for (const id of selectedLaws) await deleteLawApi(id)
      setLaws(prev => prev.filter(l => !selectedLaws.has(l.id)))
      setSelectedLaws(new Set())
      setMsg({ type: 'success', text: 'Zakoni obrisani.' })
    } catch (e) {
      alert(String(e))
      fetchLaws()
    } finally {
      setBulkDeleting(false)
    }
  }

  // --- Helpers ---
  const formatDateDisplay = (dateStr: string | undefined) => {
    if (!dateStr) return '-'
    const parts = dateStr.split('-')
    if (parts.length !== 3) return dateStr
    return `${parts[2]}/${parts[1]}/${parts[0]}`
  }

  const formatBytes = (bytes: number) => (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  const toggleSelect = (id: number) => {
    setSelectedLaws(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSelectAll = () => {
    if (selectedLaws.size === laws.length && laws.length > 0) setSelectedLaws(new Set())
    else setSelectedLaws(new Set(laws.map(l => l.id)))
  }

  return (
    <AdminLayout>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Kontrolna Tabla</h1>
          <p className="text-slate-500">Pregled sistema i upravljanje sadržajem.</p>
        </div>
        <div className="flex gap-2">
            <button onClick={fetchStats} className="p-2 hover:bg-white rounded-full shadow-sm border border-slate-200 text-slate-600 transition-all hover:text-blue-600">
              <RefreshCw className={`w-5 h-5 ${loadingStats ? 'animate-spin text-blue-600' : ''}`} />
            </button>
            <Link 
              to="/admin/laws/new" 
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-all shadow-sm hover:shadow-md"
            >
              <Plus size={20} />
              Dodaj Novi Zakon
            </Link>
        </div>
      </div>

      {msg && (
        <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${msg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.type === 'success' ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
          {msg.text}
          <button onClick={() => setMsg(null)} className="ml-auto hover:bg-black/5 p-1 rounded"><XCircle size={16} /></button>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">

        {/* System Stats */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 relative overflow-hidden group hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600"><Server size={20} /></div>
            <h2 className="font-semibold text-slate-700">Status Servera</h2>
          </div>
          {sysStats ? (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-500">RAM</span>
                  <span className="font-medium text-slate-700">{formatBytes(sysStats.ram.used)} / {formatBytes(sysStats.ram.total)}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${sysStats.ram.percent}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-500">Disk</span>
                  <span className="font-medium text-slate-700">{formatBytes(sysStats.disk.used)} / {formatBytes(sysStats.disk.total)}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${sysStats.disk.percent}%` }} />
                </div>
              </div>
            </div>
          ) : (
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-slate-100 rounded w-3/4"></div>
              <div className="h-4 bg-slate-100 rounded w-1/2"></div>
            </div>
          )}
        </div>

        {/* Search Engine Stats */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 group hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-50 rounded-lg text-amber-600"><Database size={20} /></div>
              <h2 className="font-semibold text-slate-700">Sistem za pretragu</h2>
            </div>
            <div className="flex items-center gap-2">
              {meiliStats && meiliStats.status !== 'running' && (
                <button
                  onClick={triggerStartMeili}
                  disabled={actionLoading}
                  className="text-xs font-medium px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md text-emerald-700 transition-colors"
                >
                  Start
                </button>
              )}
              <button
                onClick={triggerReindex}
                disabled={actionLoading}
                className="text-xs font-medium px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md text-slate-600 transition-colors"
              >
                Reindex
              </button>
            </div>
          </div>
          {meiliStats ? (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500">Status</span>
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${meiliStats.status === 'running' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {meiliStats.status === 'running' ? 'AKTIVAN' : meiliStats.status.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500">Indeksirani dokumenti</span>
                <span className="font-mono font-medium text-slate-700">{meiliStats.meili_count}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-slate-50">
                <span className="text-sm text-slate-500">Zdravlje sinhronizacije</span>
                {meiliStats.sync_health === 'ok' ? (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                    <CheckCircle size={12} /> Sinhronizovano
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                    <AlertTriangle size={12} /> Neslaganje ({meiliStats.db_count} u bazi)
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="animate-pulse space-y-3">
              <div className="h-4 bg-slate-100 rounded w-full"></div>
              <div className="h-4 bg-slate-100 rounded w-2/3"></div>
            </div>
          )}
        </div>

        {/* Sync Widget */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 group hover:shadow-md transition-shadow relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-purple-50 rounded-lg text-purple-600"><Cloud size={20} /></div>
            <h2 className="font-semibold text-slate-700">Sinhronizacija sa produkcijom</h2>
          </div>
          {syncStats ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2 bg-slate-50 rounded-lg">
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Lokalno</div>
                  <div className="font-bold text-slate-700 text-lg">{syncStats.local_count}</div>
                </div>
                <div className="p-2 bg-slate-50 rounded-lg">
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Udaljeno</div>
                  <div className="font-bold text-slate-700 text-lg">{syncStats.remote_count}</div>
                </div>
              </div>

              {syncStats.diff > 0 ? (
                <button
                  onClick={triggerSync}
                  disabled={actionLoading}
                  className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all shadow-sm shadow-purple-200"
                >
                  <Download size={16} />
                  Sinhronizuj {syncStats.diff} novih zakona
                </button>
              ) : syncStats.status === 'online' ? (
                <div className="w-full py-2 bg-green-50 text-green-700 rounded-lg text-sm font-medium flex items-center justify-center gap-2 border border-green-100">
                  <CheckCircle size={16} /> Sve je ažurno
                </div>
              ) : (
                <div className="w-full py-2 bg-red-50 text-red-700 rounded-lg text-sm font-medium flex items-center justify-center gap-2 border border-red-100">
                  <AlertTriangle size={16} /> Produkcija nedostupna
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-slate-400">
              <RefreshCw className="animate-spin w-6 h-6" />
            </div>
          )}
        </div>
      </div>

      {/* Laws List */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 md:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <FileText className="text-blue-600" />
            Dokumenti
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 group-focus-within:text-blue-500 transition-colors" />
              <input 
                type="text" 
                placeholder="Pretraži naslov..." 
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="pl-9 pr-4 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none w-full sm:w-64 transition-all"
              />
            </div>
            
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <select 
                value={selectedJurisdiction}
                onChange={e => { setSelectedJurisdiction(e.target.value); setPage(1); }}
                className="pl-9 pr-8 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none appearance-none bg-white cursor-pointer hover:border-slate-300 transition-colors"
              >
                <option value="">Sve jurisdikcije</option>
                {JURISDICTIONS.map(j => <option key={j} value={j}>{j}</option>)}
              </select>
            </div>

            {selectedLaws.size > 0 && (
              <button 
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-sm font-medium transition-colors"
              >
                {bulkDeleting ? <RefreshCw className="animate-spin w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                Obriši ({selectedLaws.size})
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
              <tr>
                <th className="px-6 py-3 w-10"><input type="checkbox" checked={selectedLaws.size === laws.length && laws.length > 0} onChange={toggleSelectAll} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" /></th>
                <th className="px-6 py-3 w-16">ID</th>
                <th className="px-6 py-3">Naslov</th>
                <th className="px-6 py-3 w-32">Jurisdikcija</th>
                <th className="px-6 py-3 w-32">Glasnik</th>
                <th className="px-6 py-3 w-32">Datum</th>
                <th className="px-6 py-3 w-24 text-right">Akcije</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingLaws ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-500">Učitavam zakone...</td></tr>
              ) : laws.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-500">Nema pronađenih zakona.</td></tr>
              ) : (
                laws.map(law => (
                  <tr key={law.id} className={`hover:bg-slate-50 group ${selectedLaws.has(law.id) ? 'bg-blue-50/30' : ''}`}>
                    <td className="px-6 py-3"><input type="checkbox" checked={selectedLaws.has(law.id)} onChange={() => toggleSelect(law.id)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" /></td>
                    <td className="px-6 py-3 text-slate-500 font-mono text-xs">{law.id}</td>
                    <td className="px-6 py-3 font-medium text-slate-900">
                      <Link to={`/viewer/${law.id}`} className="hover:text-blue-600 transition-all duration-200 inline-block hover:translate-x-1">
                        {law.title}
                      </Link>
                    </td>
                    <td className="px-6 py-3"><span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">{law.jurisdiction}</span></td>
                    <td className="px-6 py-3 text-slate-500 font-mono text-xs">{law.gazette_key || '-'}</td>
                    <td className="px-6 py-3 text-slate-500 text-xs">{formatDateDisplay(law.gazette_date)}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-2 transition-all">
                        <Link to={`/admin/laws/${law.id}/edit`} title="Izmijeni" className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded hover:scale-110 transition-transform"><Pencil size={16} /></Link>
                        <button onClick={() => handleDelete(law.id)} title="Obriši" className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded hover:scale-110 transition-transform"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
          <span className="text-sm text-slate-500">Prikazano {laws.length} od {totalLaws} zakona</span>
          <div className="flex items-center gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="p-2 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-50"><ChevronLeft size={16} /></button>
            <span className="text-sm font-medium text-slate-700">Stranica {page}</span>
            <button disabled={page * limit >= totalLaws} onClick={() => setPage(p => p + 1)} className="p-2 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-50"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
