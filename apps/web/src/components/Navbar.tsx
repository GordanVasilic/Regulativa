import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { ArrowLeft, Home, Settings } from 'lucide-react'

export default function Navbar() {
    const navigate = useNavigate()
    const location = useLocation()
    const [stats, setStats] = useState<{ jurisdiction: string; count: number }[]>([])

    // Logic for button visibility
    const isHome = location.pathname === '/'
    // Admin pages start with /admin
    const isAdmin = location.pathname.startsWith('/admin')

    const showBack = !isHome && !isAdmin
    const showHome = !isHome

    useEffect(() => {
        fetch('/api/laws/stats')
            .then(res => res.json())
            .then(data => setStats(data))
            .catch(err => console.error('Failed to fetch stats:', err))
    }, [])

    function formatJurisdiction(jurisdiction: string): string {
        if (jurisdiction === 'BRCKO') return 'BRČKO DISTRIKT'
        if (jurisdiction === 'Crna Gora') return 'CRNA GORA'
        return jurisdiction
    }

    const totalLaws = stats.reduce((sum: number, s: { count: number }) => sum + s.count, 0)

    return (
        <nav className="sticky top-0 z-50 w-full backdrop-blur-md bg-white/75 border-b border-slate-200 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">

                    {/* Left: Navigation Controls */}
                    <div className="flex items-center gap-2">
                        {showBack && (
                            <button
                                onClick={() => navigate(-1)}
                                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white/50 hover:bg-white hover:text-blue-600 border border-slate-200/60 rounded-lg transition-all shadow-sm hover:shadow-md active:scale-95"
                                title="Povratak nazad"
                            >
                                <ArrowLeft size={18} />
                                <span className="hidden sm:inline">Nazad</span>
                            </button>
                        )}

                        {showHome && (
                            <Link
                                to="/"
                                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white/50 hover:bg-white hover:text-blue-600 border border-slate-200/60 rounded-lg transition-all shadow-sm hover:shadow-md active:scale-95"
                                title="Početna"
                            >
                                <Home size={18} />
                                <span className="hidden sm:inline">Početna</span>
                            </Link>
                        )}
                    </div>

                    {/* Center: Statistics (Moved from branding/bottom bar) */}
                    <div className="flex-1 flex justify-center overflow-hidden">
                        {stats.length > 0 && (
                            <div className="flex items-center gap-4 md:gap-6 overflow-x-auto no-scrollbar whitespace-nowrap text-xs sm:text-sm text-slate-600 font-medium px-4">
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 rounded-full text-slate-800">
                                    Ukupno: <span className="font-bold">{totalLaws}</span>
                                </span>
                                {stats.map(stat => (
                                    <span key={stat.jurisdiction} className="inline-flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500/50"></span>
                                        {formatJurisdiction(stat.jurisdiction)}: <span className="font-semibold text-slate-800">{stat.count}</span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2">
                        <Link
                            to="/admin"
                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-all"
                            title="Admin Panel"
                        >
                            <Settings size={20} />
                        </Link>
                    </div>

                </div>
            </div>
        </nav>
    )
}
