
import { useState, useEffect } from 'react'
import { Save, AlertCircle, Check } from 'lucide-react'
import AdminLayout from './components/AdminLayout'

type ScraperConfig = {
  id: number
  jurisdiction: string
  url: string
  last_check: string | null
}

export default function AdminSettings() {
  const [configs, setConfigs] = useState<ScraperConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    fetchConfigs()
  }, [])

  const fetchConfigs = async () => {
    setLoading(true)
    try {
      const res = await fetch('http://localhost:5000/api/admin/scraper/configs')
      const data = await res.json()
      setConfigs(data)
    } catch (e) {
      setError('Failed to load configs')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdate = async (id: number, url: string) => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(`http://localhost:5000/api/admin/scraper/configs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      })
      if (!res.ok) throw new Error('Failed to update')
      setSuccess('Podešavanja sačuvana')
      fetchConfigs() // reload
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Podešavanja</h1>
        <p className="text-slate-500">Konfiguracija izvora za automatsku sinhronizaciju.</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 flex items-center gap-3">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-green-50 text-green-700 rounded-lg border border-green-200 flex items-center gap-3">
          <Check size={20} />
          {success}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50">
          <h3 className="font-semibold text-slate-700">Izvori podataka (Scraper URLs)</h3>
        </div>
        
        <div className="p-6 space-y-6">
          {loading ? (
            <div className="text-center text-slate-500 py-8">Učitavam...</div>
          ) : configs.length === 0 ? (
            <div className="text-center text-slate-500 py-8">Nema konfigurisanih izvora.</div>
          ) : (
            configs.map(config => (
              <div key={config.id} className="grid gap-2">
                <label className="text-sm font-medium text-slate-700 flex justify-between">
                  <span>{config.jurisdiction === 'RS' ? 'Republika Srpska' : config.jurisdiction}</span>
                  <span className="text-xs text-slate-400 font-normal">Posljednja provjera: {config.last_check || 'Nikad'}</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    defaultValue={config.url}
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-300 outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm text-slate-600"
                    onBlur={(e) => {
                      if (e.target.value !== config.url) {
                        handleUpdate(config.id, e.target.value)
                      }
                    }}
                  />
                  <button 
                    disabled={saving}
                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Sačuvaj (automatski na izlasku iz polja)"
                  >
                    <Save size={20} />
                  </button>
                </div>
                <p className="text-xs text-slate-500">URL stranice sa koje se preuzimaju zakoni.</p>
              </div>
            ))
          )}
        </div>
      </div>
    </AdminLayout>
  )
}
