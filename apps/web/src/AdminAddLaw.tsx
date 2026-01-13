
import { useState, useEffect } from 'react'
import { useNavigate, Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

const JURISDICTIONS = ['RS', 'FBiH', 'BiH', 'Crna Gora', 'Brcko', 'Srbija']

export default function AdminAddLaw() {
  const navigate = useNavigate()
  const { id } = useParams() // Check if we are editing
  const isEditing = Boolean(id)

  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '',
    jurisdiction: 'RS',
    date: '',
    gazette_key: '',
    text: ''
  })

  // Fetch existing law data if editing
  useEffect(() => {
    if (isEditing && id) {
      setFetching(true)
      fetch(`http://localhost:5000/api/laws/${id}`)
        .then(async res => {
           if (!res.ok) {
             const text = await res.text()
             throw new Error(text)
           }
           return res.json()
        })
        .then(data => {
          if (data.error) throw new Error(data.error)
          setForm({
            title: data.title || '',
            jurisdiction: data.jurisdiction || 'RS',
            date: data.gazette_date || '',
            gazette_key: data.gazette_key || '',
            text: data.text_content || '' // Will be empty for old laws
          })
        })
        .catch(err => setError('Ne mogu učitati podatke zakona: ' + String(err)))
        .finally(() => setFetching(false))
    }
  }, [id, isEditing])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const url = isEditing 
        ? `http://localhost:5000/api/admin/laws/${id}`
        : 'http://localhost:5000/api/admin/laws'
      
      const method = isEditing ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Greška pri čuvanju')

      // Redirect to viewer
      navigate(`/viewer/${isEditing ? id : data.id}`)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  if (fetching) {
    return (
      <div className="max-w-4xl mx-auto p-8 text-center text-slate-500">
        Učitavam podatke...
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto bg-white p-8 rounded-xl shadow-lg border border-slate-100">
      <div className="flex items-center gap-4 mb-6">
        <Link to="/admin/laws" className="p-2 hover:bg-slate-100 rounded-full transition-colors">
          <ArrowLeft className="w-6 h-6 text-slate-600" />
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">
            {isEditing ? 'Izmijeni Zakon' : 'Dodaj Novi Zakon'}
        </h1>
      </div>
      
      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Row 1 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Naslov Zakona
            </label>
            <input
              type="text"
              name="title"
              required
              value={form.title}
              onChange={handleChange}
              className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              placeholder="npr. Zakon o radu"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Nadležnost
            </label>
            <select
              name="jurisdiction"
              value={form.jurisdiction}
              onChange={handleChange}
              className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            >
              {JURISDICTIONS.map(j => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Datum Objave
            </label>
            <input
              type="date"
              name="date"
              value={form.date}
              onChange={handleChange}
              className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Broj Službenog Glasnika
            </label>
            <input
              type="text"
              name="gazette_key"
              value={form.gazette_key}
              onChange={handleChange}
              className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              placeholder="npr. 12/24"
            />
          </div>
        </div>

        {/* Text Area */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Tekst Zakona (Paste)
          </label>
          <textarea
            name="text"
            required
            value={form.text}
            onChange={handleChange}
            rows={20}
            className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-mono text-sm"
            placeholder="Ovdje nalepite puni tekst zakona..."
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={loading}
            className={`px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:ring-4 focus:ring-blue-200 transition-all ${
              loading ? 'opacity-70 cursor-not-allowed' : ''
            }`}
          >
            {loading ? 'Obrađujem...' : 'Sačuvaj Zakon'}
          </button>
        </div>
      </form>
    </div>
  )
}
