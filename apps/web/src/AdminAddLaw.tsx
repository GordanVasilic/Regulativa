
import { useState, useEffect } from 'react'
import { useNavigate, Link, useParams } from 'react-router-dom'
import { ArrowLeft, Link as LinkIcon, X, Check, Search } from 'lucide-react'

const JURISDICTIONS = ['RS', 'FBiH', 'BiH', 'Crna Gora', 'Brcko', 'Srbija']

type LawMetadata = {
  id: number
  title: string
  gazette_key?: string
  gazette_date?: string
}

type GroupSuggestion = {
  id: number
  name: string
  jurisdiction: string
  score?: number
  reason?: string
  law_count: number
  laws?: LawMetadata[]
  type?: 'group' | 'law'
}

const formatDate = (d?: string) => {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('hr-BA')
}

// Tooltip Component
const LawListTooltip = ({ laws, visible }: { laws?: LawMetadata[], visible: boolean }) => {
  if (!visible || !laws || laws.length === 0) return null
  return (
    <div className="absolute left-0 bottom-full mb-2 w-96 bg-white rounded-lg shadow-xl border border-slate-200 z-50 p-3 text-left">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 pb-1 border-b border-slate-100">
        Povezani zakoni
      </div>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {laws.map(law => (
          <div key={law.id} className="text-sm">
             <a 
               href={`/admin/laws/${law.id}/edit`} 
               target="_blank" 
               rel="noreferrer"
               className="font-medium text-blue-600 hover:underline block truncate"
               title={law.title}
             >
               {law.title}
             </a>
             <div className="text-xs text-slate-500 flex gap-2">
               <span>SG: {law.gazette_key || '-'}</span>
               <span>•</span>
               <span>{formatDate(law.gazette_date)}</span>
             </div>
          </div>
        ))}
      </div>
      <div className="absolute left-4 -bottom-1 w-2 h-2 bg-white border-b border-r border-slate-200 transform rotate-45"></div>
    </div>
  )
}

// Helper component for group item
const GroupItem = ({ group, onSelect, isSelected }: { group: GroupSuggestion, onSelect?: () => void, isSelected?: boolean }) => {
  const [hoveringCount, setHoveringCount] = useState(false)
  
  return (
    <div className={`w-full flex items-center gap-3 p-3 bg-white border ${isSelected ? 'border-blue-200 bg-blue-50' : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50/50'} rounded-lg transition-all text-left group relative`}>
      {isSelected ? (
         <LinkIcon size={18} className="text-blue-500" />
      ) : (
         <div className="p-2 bg-slate-100 group-hover:bg-blue-100 rounded-full text-slate-500 group-hover:text-blue-600">
           <LinkIcon size={16} />
         </div>
      )}
      
      <div className="flex-1 min-w-0">
        <div className="font-medium text-slate-900 truncate" title={group.name}>{group.name}</div>
        <div className="text-xs text-slate-500 flex items-center gap-1">
          {group.type === 'law' ? (
            <span className="text-orange-600 font-semibold bg-orange-50 px-1 rounded">Nije grupisano</span>
          ) : (
            group.reason && (<span>{group.reason === 'group_match' ? 'Sličan naziv' : 'Povezano'} • </span>)
          )}
          {group.type === 'law' ? (
             <span>(Biće kreirana nova grupa)</span>
          ) : (
             <div 
                className="relative cursor-help hover:text-blue-600 font-medium transition-colors"
                onMouseEnter={() => setHoveringCount(true)}
                onMouseLeave={() => setHoveringCount(false)}
             >
                {group.law_count} zakona
                <LawListTooltip laws={group.laws} visible={hoveringCount} />
             </div>
          )}
          {isSelected && <span>• ID: {group.id}</span>}
        </div>
      </div>
      
      {isSelected ? (
        <button 
          type="button" 
          onClick={onSelect} // actually clear
          className="p-1 hover:bg-blue-100 rounded-full text-blue-600 transition-colors"
          title="Ukloni poveznicu"
        >
          <X size={18} />
        </button>
      ) : (
        <button
           type="button"
           onClick={onSelect}
           className="opacity-0 group-hover:opacity-100 text-blue-600 text-sm font-medium pr-2"
        >
           Odaberi
        </button>
      )}
    </div>
  )
}

const API_BASE = import.meta.env.VITE_API_URL || '/api'

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
    text: '',
    group_id: null as number | null
  })

  const [suggestions, setSuggestions] = useState<GroupSuggestion[]>([])
  const [selectedGroup, setSelectedGroup] = useState<GroupSuggestion | null>(null)
  const [checkingGroups, setCheckingGroups] = useState(false)
  
  // Manual search state
  const [manualSearchMode, setManualSearchMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<GroupSuggestion[]>([])
  const [searchingManual, setSearchingManual] = useState(false)

  const [initialText, setInitialText] = useState<string>('')

  // Fetch existing law data if editing
  useEffect(() => {
    if (isEditing && id) {
      setFetching(true)
      fetch(`${API_BASE}/laws/${id}`)
        .then(async res => {
          if (!res.ok) {
            const text = await res.text()
            throw new Error(text)
          }
          return res.json()
        })
        .then(data => {
          if (data.error) throw new Error(data.error)
          
          // Remove PAGE tags for editor view
          const cleanText = (data.text_content || '').replace(/\[\[PAGE_\d+\]\]/g, '')
          
          setForm({
            title: data.title || '',
            jurisdiction: data.jurisdiction || 'RS',
            date: data.gazette_date || '',
            gazette_key: data.gazette_key || '',
            text: cleanText,
            group_id: data.group_id || null
          })
          setInitialText(cleanText)
          
          // If has group, fetch group details to display name
          if (data.group_id) {
             fetch(`${API_BASE}/admin/law-groups/${data.group_id}`)
               .then(res => res.json())
               .then(group => {
                 if (group && !group.error) {
                   setSelectedGroup(group)
                 }
               })
               .catch(console.error)
          }
        })
        .catch(err => setError('Ne mogu učitati podatke zakona: ' + String(err)))
        .finally(() => setFetching(false))
    }
  }, [id, isEditing])

  const fetchSuggestions = async (title: string, jurisdiction: string) => {
    if (!title || !jurisdiction || manualSearchMode) return // Don't auto-suggest in manual mode
    setCheckingGroups(true)
    try {
      const params = new URLSearchParams({ title, jurisdiction })
      const res = await fetch(`${API_BASE}/admin/law-groups/suggest?${params}`)
      const data = await res.json()
      if (Array.isArray(data)) {
        setSuggestions(data)
      }
    } catch (e) {
      console.error('Failed to fetch suggestions', e)
    } finally {
      setCheckingGroups(false)
    }
  }

  const handleManualSearch = async () => {
    if (!searchQuery.trim()) return
    setSearchingManual(true)
    try {
      const params = new URLSearchParams({ q: searchQuery, jurisdiction: form.jurisdiction })
      const res = await fetch(`${API_BASE}/admin/law-groups/search?${params}`)
      const data = await res.json()
      if (Array.isArray(data)) {
        setSearchResults(data)
      }
    } catch (e) {
      console.error('Failed to search groups', e)
    } finally {
      setSearchingManual(false)
    }
  }

  const handleBlurTitle = () => {
    if (!manualSearchMode) {
      fetchSuggestions(form.title, form.jurisdiction)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    
    if (name === 'jurisdiction') {
      // Re-fetch suggestions when jurisdiction changes
      if (!manualSearchMode) {
        fetchSuggestions(form.title, value)
      }
    }
  }

  const selectGroup = (group: GroupSuggestion) => {
    if (group.type === 'law') {
      // If user selected a single law, we need to tell backend to create a group from it
      // We will pass this special structure
      setForm(prev => ({ ...prev, group_id: null, link_to_law_id: group.id }))
    } else {
      setForm(prev => ({ ...prev, group_id: group.id, link_to_law_id: null }))
    }
    setSelectedGroup(group)
    setSuggestions([]) // Hide suggestions after selection
    setManualSearchMode(false) // Exit manual mode
  }

  const clearGroup = () => {
    setForm(prev => ({ ...prev, group_id: null, link_to_law_id: null }))
    setSelectedGroup(null)
  }

  const toggleManualSearch = () => {
    setManualSearchMode(!manualSearchMode)
    setSearchQuery('')
    setSearchResults([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const url = isEditing
        ? `${API_BASE}/admin/laws/${id}`
        : `${API_BASE}/admin/laws`

      const method = isEditing ? 'PUT' : 'POST'

      const payload = { ...form }
      // If text hasn't changed from initial load (ignoring hidden tags), don't send it
      // This prevents PDF regeneration which breaks formatting for imported docs
      if (isEditing && form.text === initialText) {
          // @ts-ignore
          delete payload.text
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
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
        <Link to="/admin" className="p-2 hover:bg-slate-100 rounded-full transition-colors">
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
              onBlur={handleBlurTitle}
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

        {/* Group Selection */}
        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Povezana Grupa Zakona
          </label>
          
          {selectedGroup ? (
            <GroupItem group={selectedGroup} isSelected onSelect={clearGroup} />
          ) : (
            <div className="space-y-4">
              {!manualSearchMode ? (
                // Auto-suggest mode
                <div className="space-y-2">
                  {checkingGroups && (
                    <div className="text-sm text-slate-500 animate-pulse">Tražim povezane grupe...</div>
                  )}
                  
                  {!checkingGroups && suggestions.length > 0 && (
                    <div className="space-y-2">
                       <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">Predložene grupe:</div>
                       {suggestions.map(g => (
                         <GroupItem key={g.id} group={g} onSelect={() => selectGroup(g)} />
                       ))}
                    </div>
                  )}
                  
                  {!checkingGroups && suggestions.length === 0 && form.title.length > 3 && (
                    <div className="text-sm text-slate-400 italic">
                      Nema pronađenih grupa za ovaj naslov.
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                       type="button"
                       onClick={toggleManualSearch}
                       className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                    >
                      <Search size={14} />
                      Pretraži ručno sve grupe
                    </button>
                  </div>
                </div>
              ) : (
                // Manual search mode
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Upišite naziv grupe..."
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleManualSearch())}
                    />
                    <button 
                      type="button"
                      onClick={handleManualSearch}
                      disabled={searchingManual}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {searchingManual ? 'Tražim...' : 'Traži'}
                    </button>
                    <button 
                      type="button"
                      onClick={toggleManualSearch}
                      className="px-3 py-2 text-slate-500 hover:bg-slate-100 rounded-lg"
                      title="Otkaži pretragu"
                    >
                      <X size={20} />
                    </button>
                  </div>

                  {searchResults.length > 0 && (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                       <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">Rezultati pretrage:</div>
                       {searchResults.map(g => (
                         <GroupItem key={g.id} group={g} onSelect={() => selectGroup(g)} />
                       ))}
                    </div>
                  )}
                  
                  {!searchingManual && searchResults.length === 0 && searchQuery.length > 0 && (
                     <div className="text-sm text-slate-400 italic">
                       Nema rezultata za "{searchQuery}".
                     </div>
                  )}
                </div>
              )}
            </div>
          )}
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
            className={`px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:ring-4 focus:ring-blue-200 transition-all ${loading ? 'opacity-70 cursor-not-allowed' : ''
              }`}
          >
            {loading ? 'Obrađujem...' : 'Sačuvaj Zakon'}
          </button>
        </div>
      </form>
    </div>
  )
}
