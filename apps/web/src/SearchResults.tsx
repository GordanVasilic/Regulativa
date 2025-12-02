import { Link } from 'react-router-dom'
import { FileText, Scale, AlignLeft, Calendar, ArrowRight } from 'lucide-react'

interface Law {
    id: number
    title: string
    jurisdiction: string
    gazette_key?: string | null
    gazette_date?: string | null
}

interface Segment {
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

interface SearchResultsProps {
    laws: Law[]
    segments: Segment[]
    query?: string
}

function formatDate(dateStr?: string | null) {
    if (!dateStr) return null
    try {
        const date = new Date(dateStr)
        return new Intl.DateTimeFormat('sr-BA', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).format(date)
    } catch (e) {
        return dateStr
    }
}

function formatJurisdiction(jurisdiction: string): string {
    if (jurisdiction === 'BRCKO') return 'BRČKO DISTRIKT'
    if (jurisdiction === 'Crna Gora') return 'CRNA GORA'
    return jurisdiction
}

function HighlightText({ text, query }: { text: string, query?: string }) {
    if (!query || !query.trim()) return <>{text}</>

    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2)
    if (terms.length === 0) return <>{text}</>

    // Create a regex that matches any of the terms, case insensitive
    // We escape special regex characters in terms just in case
    const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')

    const parts = text.split(pattern)

    return (
        <>
            {parts.map((part, i) => {
                const isMatch = terms.some(t => t === part.toLowerCase())
                return isMatch ? (
                    <span key={i} className="bg-yellow-200 text-slate-900 font-medium rounded px-0.5 box-decoration-clone">
                        {part}
                    </span>
                ) : (
                    part
                )
            })}
        </>
    )
}

export default function SearchResults({ laws, segments, query }: SearchResultsProps) {
    if (laws.length === 0 && segments.length === 0) return null

    return (
        <div className="grid md:grid-cols-2 gap-8 mb-12">
            {/* Laws Results */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <Scale size={20} />
                        </div>
                        <h3 className="font-semibold text-slate-900">Pronađeni zakoni</h3>
                    </div>
                    <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full">
                        {laws.length}
                    </span>
                </div>
                <div className="divide-y divide-slate-100">
                    {laws.length > 0 ? (
                        <div className="divide-y divide-slate-100">
                            {laws.map(law => (
                                <Link
                                    key={law.id}
                                    to={`/viewer/${law.id}${query ? `?q=${encodeURIComponent(query)}` : ''}`}
                                    className="block p-4 hover:bg-slate-50 transition-all group"
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="space-y-1">
                                            <div className="font-medium text-slate-800 group-hover:text-blue-600 transition-colors text-sm leading-snug line-clamp-2">
                                                <HighlightText text={law.title} query={query} />
                                            </div>
                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                                                    {formatJurisdiction(law.jurisdiction)}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <FileText size={12} />
                                                    {law.gazette_key}
                                                </span>
                                                {law.gazette_date && (
                                                    <span className="flex items-center gap-1">
                                                        <Calendar size={12} />
                                                        {formatDate(law.gazette_date)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <ArrowRight size={16} className="text-slate-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all mt-1" />
                                    </div>
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <div className="p-8 text-sm text-slate-500 italic text-center">
                            Nema pronađenih zakona za ovu pretragu.
                        </div>
                    )}
                </div>
            </div>

            {/* Segments Results */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                            <AlignLeft size={20} />
                        </div>
                        <h3 className="font-semibold text-slate-900">Pronađeni članovi</h3>
                    </div>
                    <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full">
                        {segments.length}
                    </span>
                </div>
                <div className="divide-y divide-slate-100">
                    {segments.length > 0 ? (
                        <div className="divide-y divide-slate-100">
                            {segments.map(seg => (
                                <Link
                                    key={seg.id}
                                    to={`/viewer/${seg.law_id}?${[
                                        seg.number ? `num=${seg.number}` : '',
                                        query ? `q=${encodeURIComponent(query)}` : ''
                                    ].filter(Boolean).join('&')}`}
                                    className="block p-4 hover:bg-slate-50 transition-all group"
                                >
                                    <div className="font-medium text-emerald-700 group-hover:text-emerald-800 text-sm mb-1 flex items-center gap-2">
                                        <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded text-xs font-semibold">
                                            {seg.label}
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-600 line-clamp-3 leading-relaxed mb-3">
                                        <HighlightText text={seg.text} query={query} />
                                    </div>
                                    {seg.law_title && (
                                        <div className="pt-3 border-t border-slate-50">
                                            <div className="flex items-center gap-2 mb-1">
                                                {seg.jurisdiction && (
                                                    <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-medium text-[10px] whitespace-nowrap">
                                                        {formatJurisdiction(seg.jurisdiction)}
                                                    </span>
                                                )}
                                                <Link
                                                    to={`/viewer/${seg.law_id}${query ? `?q=${encodeURIComponent(query)}` : ''}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-xs font-medium text-slate-700 line-clamp-1 hover:text-blue-600 transition-colors"
                                                >
                                                    {seg.law_title}
                                                </Link>
                                            </div>
                                            <div className="flex items-center gap-3 text-xs text-slate-400">
                                                <span className="flex items-center gap-1">
                                                    <FileText size={11} />
                                                    {seg.gazette_key}
                                                </span>
                                                {seg.gazette_date && (
                                                    <span className="flex items-center gap-1">
                                                        <Calendar size={11} />
                                                        {formatDate(seg.gazette_date)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <div className="p-8 text-sm text-slate-500 italic text-center">
                            Nema pronađenih članova za ovu pretragu.
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
