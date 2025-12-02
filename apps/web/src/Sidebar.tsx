import { NavLink } from 'react-router-dom'
import { Home, Search } from 'lucide-react'

function Sidebar() {
  return (
    <aside className="flex flex-col w-60 bg-[#1e2a3a] text-white sticky top-0 min-h-screen">
      <div className="px-4 py-4 border-b border-white/10">
        <div className="font-semibold tracking-wide">LEGALISTIK</div>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-1">
        <NavLink
          to="/"
          className={({ isActive }) =>
            `flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-white/10 ${isActive ? 'bg-white/15' : ''}`
          }
        >
          <Home size={16} className="text-[#00a9b7]" />
          <span>Početna</span>
        </NavLink>
        <NavLink
          to="/search"
          className={({ isActive }) =>
            `flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-white/10 ${isActive ? 'bg-white/15' : ''}`
          }
        >
          <Search size={16} className="text-[#00a9b7]" />
          <span>Pretraga</span>
        </NavLink>
      </nav>
      <div className="px-4 py-3 text-xs text-white/70 border-t border-white/10">
        © {new Date().getFullYear()}
      </div>
    </aside>
  )
}

export default Sidebar