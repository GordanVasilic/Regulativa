
import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, RefreshCw, Settings, FileText } from 'lucide-react'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  
  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/')

  return (
    <div className="flex min-h-[calc(100vh-80px)]">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-slate-200 p-4 hidden md:block">
        <div className="space-y-1">
          <Link
            to="/admin"
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isActive('/admin') && !isActive('/admin/sync') && !isActive('/admin/settings') 
                ? 'bg-blue-50 text-blue-700 font-medium' 
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <LayoutDashboard size={20} />
            Pregled
          </Link>
          
          <Link
            to="/admin/sync"
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isActive('/admin/sync') 
                ? 'bg-blue-50 text-blue-700 font-medium' 
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <RefreshCw size={20} />
            Auto Sync
          </Link>

          <Link
            to="/admin/settings"
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isActive('/admin/settings') 
                ? 'bg-blue-50 text-blue-700 font-medium' 
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Settings size={20} />
            Podešavanja
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 overflow-x-hidden">
        {children}
      </div>
    </div>
  )
}
