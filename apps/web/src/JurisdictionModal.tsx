import { useEffect, useState, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { X, FileText, Calendar, ArrowRight } from 'lucide-react'

interface Law {
    id: number
    title: string
    jurisdiction: string
    gazette_key?: string | null
    gazette_date?: string | null
}

interface JurisdictionModalProps {
    jurisdiction: string
    onClose: () => void
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

export default function JurisdictionModal({ jurisdiction, onClose }: JurisdictionModalProps) {
    const [laws, setLaws] = useState<Law[]>([])
    const [loading, setLoading] = useState(false)
    const [hasMore, setHasMore] = useState(true)
    const [total, setTotal] = useState(0)
    const observerTarget = useRef<HTMLDivElement>(null)
    const offsetRef = useRef(0)
    const loadingRef = useRef(false)
    const limit = 20

    const loadMore = useCallback(() => {
        if (loadingRef.current || !hasMore) return

        loadingRef.current = true
        setLoading(true)

        const params = new URLSearchParams()
        params.set('jurisdiction', jurisdiction)
        params.set('limit', String(limit))
        params.set('offset', String(offsetRef.current))
        params.set('sort', 'gazette_desc')

        fetch(`/api/laws?${params}`)
            .then(res => res.json())
            .then(data => {
                const newLaws = Array.isArray(data) ? data : []
                setLaws(prev => [...prev, ...newLaws])
                offsetRef.current += newLaws.length
                setHasMore(newLaws.length === limit)
                setLoading(false)
                loadingRef.current = false
            })
            .catch(err => {
                console.error(err)
                setLoading(false)
                loadingRef.current = false
            })
    }, [jurisdiction, hasMore])

    // Fetch total count
    useEffect(() => {
        fetch(`/api/laws/stats`)
            .then(res => res.json())
            .then(data => {
                const stat = data.find((s: any) => s.jurisdiction === jurisdiction)
                if (stat) setTotal(stat.count)
            })
            .catch(err => console.error(err))
    }, [jurisdiction])

    // Reset state when jurisdiction changes
    useEffect(() => {
        setLaws([])
        setHasMore(true)
        setLoading(false)
        offsetRef.current = 0
        loadingRef.current = false
    }, [jurisdiction])

    // Initial load
    useEffect(() => {
        if (laws.length === 0 && hasMore) {
            loadMore()
        }
    }, [jurisdiction]) // eslint-disable-line react-hooks/exhaustive-deps

    // Infinite scroll observer
    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting && hasMore && !loadingRef.current) {
                    loadMore()
                }
            },
            { threshold: 0.1 }
        )

        const currentTarget = observerTarget.current
        if (currentTarget) {
            observer.observe(currentTarget)
        }

        return () => {
            if (currentTarget) {
                observer.unobserve(currentTarget)
            }
        }
    }, [hasMore, loadMore])

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-opacity" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">
                            {formatJurisdiction(jurisdiction)}
                        </h2>
                        <p className="text-sm text-slate-500 mt-0.5">
                            {laws.length} {hasMore ? `od ${total}` : ''} zakona
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500 hover:text-slate-700"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-0">
                    <div className="divide-y divide-slate-100">
                        {laws.map(law => (
                            <Link
                                key={law.id}
                                to={`/viewer/${law.id}`}
                                onClick={onClose}
                                className="block px-6 py-4 hover:bg-slate-50 transition-colors group"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="space-y-1">
                                        <div className="font-medium text-slate-800 group-hover:text-blue-600 transition-colors text-sm leading-snug line-clamp-2">
                                            {law.title}
                                        </div>
                                        <div className="flex items-center gap-3 text-xs text-slate-500">
                                            {law.gazette_key && (
                                                <span className="flex items-center gap-1">
                                                    <FileText size={12} />
                                                    {law.gazette_key}
                                                </span>
                                            )}
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

                    {/* Loading indicator and scroll target */}
                    <div ref={observerTarget} className="py-6 text-center">
                        {loading && (
                            <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                Učitavanje...
                            </div>
                        )}
                        {!hasMore && laws.length > 0 && (
                            <div className="text-sm text-slate-400">Svi zakoni su učitani</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
