
import { useState } from 'react'
import { RefreshCw, Download, Check, AlertCircle, FileText, ExternalLink } from 'lucide-react'
import AdminLayout from './components/AdminLayout'

type ScrapedLaw = {
  title: string
  title_normalized: string
  gazette_number: string | null
  gazette_date: string | null
  url_pdf: string
  jurisdiction: string
  status: 'new' | 'exists'
}

export default function AdminSync() {
  const [jurisdiction, setJurisdiction] = useState('RS')
  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const [foundLaws, setFoundLaws] = useState<ScrapedLaw[]>([])
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const handleCheck = async () => {
    setChecking(true)
    setError(null)
    setFoundLaws([])
    setSelectedIndices(new Set())
    setSuccessMsg(null)

    try {
      const res = await fetch('http://localhost:5000/api/admin/scraper/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jurisdiction })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      
      setFoundLaws(data.laws || [])
      if (data.laws.length === 0) {
        setSuccessMsg('Nema novih zakona. Sve je ažurno.')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setChecking(false)
    }
  }

  const toggleSelect = (index: number) => {
    const next = new Set(selectedIndices)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setSelectedIndices(next)
  }

  const toggleAll = () => {
    if (selectedIndices.size === foundLaws.length) {
      setSelectedIndices(new Set())
    } else {
      const next = new Set<number>()
      foundLaws.forEach((_, i) => next.add(i))
      setSelectedIndices(next)
    }
  }

  const handleImport = async () => {
    if (selectedIndices.size === 0) return
    setImporting(true)
    setError(null)
    
    const toImport = foundLaws.filter((_, i) => selectedIndices.has(i))

    try {
      const res = await fetch('http://localhost:5000/api/admin/scraper/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ laws: toImport })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      
      setSuccessMsg(`Uspješno importovano ${data.imported} zakona.`)
      // Remove imported from list
      setFoundLaws(prev => prev.filter((_, i) => !selectedIndices.has(i)))
      setSelectedIndices(new Set())
      
      if (data.errors && data.errors.length > 0) {
         setError(`Greška kod ${data.errors.length} zakona: ${data.errors[0].error}`)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setImporting(false)
    }
  }

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Automatska Sinhronizacija</h1>
        <p className="text-slate-500">Provjerite i preuzmite nove zakone sa službenih izvora.</p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-6">
        <div className="flex items-end gap-4">
          <div className="flex-1 max-w-xs">
            <label className="block text-sm font-medium text-slate-700 mb-1">Jurisdikcija</label>
            <select 
              value={jurisdiction}
              onChange={e => setJurisdiction(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="RS">Republika Srpska</option>
              {/* Add others when supported */}
            </select>
          </div>
          <button 
            onClick={handleCheck}
            disabled={checking || importing}
            className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-70 flex items-center gap-2"
          >
            {checking ? <RefreshCw className="animate-spin" size={20} /> : <RefreshCw size={20} />}
            {checking ? 'Provjeravam...' : 'Provjeri nove zakone'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 flex items-center gap-3">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {successMsg && (
        <div className="mb-6 p-4 bg-green-50 text-green-700 rounded-lg border border-green-200 flex items-center gap-3">
          <Check size={20} />
          {successMsg}
        </div>
      )}

      {foundLaws.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <h3 className="font-semibold text-slate-700">Pronađeni novi zakoni ({foundLaws.length})</h3>
            <button 
              onClick={handleImport}
              disabled={importing || selectedIndices.size === 0}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              {importing ? <RefreshCw className="animate-spin" size={16} /> : <Download size={16} />}
              Importuj odabrane ({selectedIndices.size})
            </button>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 font-medium">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input 
                      type="checkbox" 
                      checked={foundLaws.length > 0 && selectedIndices.size === foundLaws.length}
                      onChange={toggleAll}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
                    />
                  </th>
                  <th className="px-4 py-3">Naslov</th>
                  <th className="px-4 py-3 w-32">Glasnik</th>
                  <th className="px-4 py-3 w-32">Datum</th>
                  <th className="px-4 py-3 w-20">PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {foundLaws.map((law, i) => (
                  <tr key={i} className={`hover:bg-slate-50 ${selectedIndices.has(i) ? 'bg-blue-50/30' : ''}`}>
                    <td className="px-4 py-3">
                      <input 
                        type="checkbox" 
                        checked={selectedIndices.has(i)}
                        onChange={() => toggleSelect(i)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{law.title}</td>
                    <td className="px-4 py-3 text-slate-500">{law.gazette_number || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{law.gazette_date || '-'}</td>
                    <td className="px-4 py-3">
                      <a href={law.url_pdf} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">
                        <FileText size={18} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
