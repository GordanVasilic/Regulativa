import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import GlobalSearch, { type Law, type Segment } from './GlobalSearch'
import HomeLists from './HomeLists'
import SearchResults from './SearchResults'
import JurisdictionModal from './JurisdictionModal'
import { Scale } from 'lucide-react'
import HealthStatus from './HealthStatus'




export default function HomePage() {
    const [searchParams, setSearchParams] = useSearchParams()
    const [searchLaws, setSearchLaws] = useState<Law[]>([])
    const [searchSegments, setSearchSegments] = useState<Segment[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedJurisdiction, setSelectedJurisdiction] = useState<string | null>(null)

    // Load saved jurisdiction on mount if no param present
    useEffect(() => {
        const saved = localStorage.getItem('user_jurisdiction')
        const currentParam = searchParams.get('jurisdiction')

        if (saved && !currentParam && saved !== 'all') {
            setSearchParams({ jurisdiction: saved })
        }
    }, [])

    const handleSearchResults = (laws: Law[], segments: Segment[], query?: string) => {
        setSearchLaws(laws)
        setSearchSegments(segments)
        setSearchQuery(query || '')
    }





    const currentJurisdiction = searchParams.get('jurisdiction')

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="text-center space-y-2 py-4">
                <div className="inline-flex items-center justify-center p-2 bg-blue-50 rounded-xl mb-1 relative group">
                    <Scale className="w-6 h-6 text-blue-600" />
                    <HealthStatus />
                </div>
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
                    Regulativa - <a href="https://www.legalistik.com" target="_blank" rel="noopener noreferrer" className="hover:text-blue-600 transition-colors">Legalistik</a>
                </h1>
                <p className="text-base text-slate-600 max-w-2xl mx-auto">
                    Centralizovana baza pravnih propisa regiona.
                </p>
            </div>
            <GlobalSearch onSearchResults={handleSearchResults} />

            {/* Search Results Section - Only shows if there are results */}
            <SearchResults laws={searchLaws} segments={searchSegments} query={searchQuery} />

            <HomeLists jurisdiction={currentJurisdiction || ''} />

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
