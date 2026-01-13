import { Routes, Route } from 'react-router-dom'
import LawViewer from './LawViewer'
import SearchPage from './SearchPage'
import HomePage from './HomePage'
import AdminAddLaw from './AdminAddLaw'
import AdminLawsList from './AdminLawsList'

export default function App() {

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-blue-100/40 rounded-full blur-3xl opacity-50 mix-blend-multiply" />
        <div className="absolute top-0 right-0 w-[800px] h-[600px] bg-indigo-100/40 rounded-full blur-3xl opacity-50 mix-blend-multiply" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/viewer/:id" element={<LawViewer />} />
          <Route path="/admin/laws" element={<AdminLawsList />} />
          <Route path="/admin/laws/new" element={<AdminAddLaw />} />
          <Route path="/admin/laws/:id/edit" element={<AdminAddLaw />} />
        </Routes>
      </div>
    </div>
  )
}
