import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import GlobalSearch, { type Law, type Segment } from './GlobalSearch'
import HomeLists from './HomeLists'
import SearchResults from './SearchResults'
import JurisdictionModal from './JurisdictionModal'
import { BarChart3, Scale, PlusCircle } from 'lucide-react'
import HealthStatus from './HealthStatus'

const API = '/api'

type JurisdictionStat = {
    jurisdiction: string
    count: number
}

function formatJurisdiction(jurisdiction: string): string {
    if (jurisdiction === 'BRCKO') return 'BRČKO DISTRIKT'
    if (jurisdiction === 'Crna Gora') return 'CRNA GORA'
    return jurisdiction
}

export default function HomePage() {
    const [searchLaws, setSearchLaws] = useState<Law[]>([])
    const [searchSegments, setSearchSegments] = useState<Segment[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [stats, setStats] = useState<JurisdictionStat[]>([])
    const [selectedJurisdiction, setSelectedJurisdiction] = useState<string | null>(null)

    const handleSearchResults = (laws: Law[], segments: Segment[], query?: string) => {
        setSearchLaws(laws)
        setSearchSegments(segments)
        setSearchQuery(query || '')
    }

    useEffect(() => {
        fetch(`${API}/laws/stats`)
            .then(res => res.json())
            .then(data => setStats(data))
            .catch(err => console.error('Failed to fetch stats:', err))
    }, [])

    const totalLaws = stats.reduce((sum, s) => sum + s.count, 0)

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="text-center space-y-2 py-4">
                <div className="inline-flex items-center justify-center p-2 bg-blue-50 rounded-xl mb-1 relative group">
                    <Scale className="w-6 h-6 text-blue-600" />
                    <HealthStatus />
                </div>
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
                    Regulativa.ba
                </h1>
                <p className="text-base text-slate-600 max-w-2xl mx-auto">
                    Centralizovana baza pravnih propisa regiona.
                </p>
                <div className="pt-2">
                    <Link to="/admin/laws" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 transition-colors">
                        <PlusCircle size={12} />
                        Admin Panel
                    </Link>
                </div>
            </div>
            <GlobalSearch onSearchResults={handleSearchResults} />

            {/* Statistics Pills */}
            {stats.length > 0 && (
                <div className="flex flex-wrap justify-center gap-3">
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-full shadow-sm">
                        <BarChart3 size={16} />
                        <span className="text-sm font-medium">Ukupno: {totalLaws}</span>
                    </div>
                    {stats.map(stat => (
                        <button
                            key={stat.jurisdiction}
                            onClick={() => setSelectedJurisdiction(stat.jurisdiction)}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-700 rounded-full shadow-sm transition-all duration-200 cursor-pointer"
                        >
                            <span className="text-sm font-medium">{formatJurisdiction(stat.jurisdiction)}</span>
                            <span className="inline-flex items-center justify-center bg-slate-100 text-slate-600 text-xs font-bold px-2 py-0.5 rounded-full">
                                {stat.count}
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {/* Search Results Section - Only shows if there are results */}
            <SearchResults laws={searchLaws} segments={searchSegments} query={searchQuery} />

            <HomeLists jurisdiction={new URLSearchParams(window.location.search).get('jurisdiction') || ''} />

            {/* Jurisdiction Modal */}
            {selectedJurisdiction && (
                <JurisdictionModal
                    jurisdiction={selectedJurisdiction}
                    onClose={() => setSelectedJurisdiction(null)}
                />
            )}
        </div>
    )
}
