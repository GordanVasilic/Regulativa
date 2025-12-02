import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { ZoomIn, ZoomOut, Eye, EyeOff, ChevronLeft, ChevronRight, RotateCcw, RotateCw, Printer, Download, AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter, Search, X, ArrowUp, ArrowDown, ArrowLeft } from 'lucide-react'
import { Document, Page, pdfjs } from 'react-pdf/dist/index.js'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'

type Law = {
  id: number
  title: string
  path_pdf: string
  gazette_key?: string | null
  gazette_date?: string | null
}
type Segment = {
  id: number
  law_id: number
  label: string
  number: number
  page_hint: number
  text: string
}

const API = '/api'

export default function LawViewer() {
  const { id } = useParams()

  const location = useLocation()
  const [law, setLaw] = useState<Law | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [page, setPage] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [numPages, setNumPages] = useState<number | null>(null)
  const [scale, setScale] = useState(1)
  const [showHighlights, setShowHighlights] = useState(true)
  const [rotate, setRotate] = useState(0)
  const [fitMode, setFitMode] = useState<'custom' | 'width' | 'height'>('custom')
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 900, h: 800 })
  const headerRef = useRef<HTMLDivElement | null>(null)
  const [rightOffset, setRightOffset] = useState(0)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const viewerShellRef = useRef<HTMLDivElement | null>(null)
  const [rightHeight, setRightHeight] = useState<number | undefined>(undefined)
  const [hoverSegId, setHoverSegId] = useState<number | null>(null)
  // Lokalna pretraga unutar PDF-a
  const [pdfSearch, setPdfSearch] = useState('')
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchIdx, setSearchIdx] = useState(0)
  const lawId = Number(id)
  const params = new URLSearchParams(location.search)
  const query = params.get('q') || ''
  const articleNumParam = params.get('num') ? Number(params.get('num')!) : null
  const [targetArticleNum, setTargetArticleNum] = useState<number | null>(
    typeof articleNumParam === 'number' && !Number.isNaN(articleNumParam) ? articleNumParam : null
  )

  // Configure PDF.js worker via Vite asset URL
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      try {
        const lawRes = await fetch(`${API}/laws/${lawId}`)
        const lawJson = await lawRes.json()
        const segRes = await fetch(`${API}/segments?law_id=${lawId}&limit=500`)
        const segJson = await segRes.json()
        if (!mounted) return
        setLaw(lawJson)
        setSegments(segJson)
        const hash = typeof window !== 'undefined' ? window.location.hash : ''
        const m = hash.match(/page=(\d+)/)
        const hinted = m ? Number(m[1]) : null
        if (hinted) setPage(hinted)
        else setPage(1)
      } catch (e) {
        console.error(e)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    // ping API to increment views
    fetch(`${API}/laws/${lawId}/open`, { method: 'POST' }).catch(() => { })
    return () => {
      mounted = false
    }
  }, [lawId])

  // Measure container for fit width/height
  useEffect(() => {
    const el = viewerRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      setContainerSize({ w: Math.max(600, Math.floor(rect.width - 48)), h: Math.max(400, Math.floor(rect.height - 48)) })
    }
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [viewerRef.current])

  // Measure height of the area above the PDF toolbar to align the right panel top
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      // include vertical spacing between header and toolbar (Tailwind space-y-3 ≈ 12px)
      const gap = 12
      setRightOffset(Math.max(0, Math.floor(rect.height + gap)))
    }
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [law])

  // Measure toolbar + viewer shell height to match right panel to PDF box bottom
  useEffect(() => {
    const t = toolbarRef.current
    const v = viewerShellRef.current
    if (!t || !v) return
    const update = () => {
      const th = t.getBoundingClientRect().height
      const vh = v.getBoundingClientRect().height
      setRightHeight(Math.max(0, Math.floor(th + vh)))
    }
    update()
    const obsT = new ResizeObserver(update)
    const obsV = new ResizeObserver(update)
    obsT.observe(t)
    obsV.observe(v)
    return () => { obsT.disconnect(); obsV.disconnect() }
  }, [toolbarRef.current, viewerShellRef.current])

  // Do not return early before hooks; render conditionally in JSX below

  const pdfUrl = `${API}/pdf/${lawId}`

  // Helpers for highlight
  const stripDiacritics = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const norm = (s: string) => stripDiacritics(s).toLowerCase()
  const highlightTerms = useMemo(() => {
    // Ako korisnik traži unutar PDF-a, označi SAMO taj novi pojam.
    // U suprotnom, označi pojmove iz početnog upita (q) s liste.
    const qSrc = (query || '').trim()
    const qTokens = qSrc.split(/\s+/).filter((t) => t.length >= 3)
    const sSrc = pdfSearch.trim()
    const sTokens = sSrc.split(/\s+/).filter((t) => t.length >= 2)
    const activeTokens = sTokens.length > 0 ? sTokens : qTokens
    const set = new Set(activeTokens.map((t) => norm(t)))
    // Dodaj broj člana SAMO kada nema aktivne lokalne pretrage
    if (sTokens.length === 0 && typeof targetArticleNum === 'number' && !Number.isNaN(targetArticleNum)) {
      set.add(String(targetArticleNum))
      set.add(`clan ${targetArticleNum}`) // Add "clan X" as well for better context match
    }
    return Array.from(set)
  }, [query, pdfSearch, targetArticleNum])

  // NEW: When segments are loaded and we have a target article, jump to its page
  useEffect(() => {
    if (!targetArticleNum || segments.length === 0) return
    const seg = segments.find(s => s.number === targetArticleNum)
    if (seg && seg.page_hint) {
      setPage(seg.page_hint)
    }
  }, [targetArticleNum, segments])

  // Filter segments by text/label if filter is set
  const [segFilter] = useState('')
  const filteredSegments = useMemo(() => {
    const f = segFilter.trim().toLowerCase()
    if (!f) return segments
    return segments.filter((s) =>
      String(s.label || '').toLowerCase().includes(f) ||
      String(s.text || '').toLowerCase().includes(f)
    )
  }, [segments, segFilter])

  const customTextRenderer = (textItem: { str: string }) => {
    const original = textItem.str
    if (!original || !showHighlights || highlightTerms.length === 0) return original
    const n = norm(original)
    // Find all match ranges for any term
    const matches: { start: number; end: number }[] = []
    for (const term of highlightTerms) {
      let idx = 0
      while (true) {
        const found = n.indexOf(term, idx)
        if (found === -1) break
        matches.push({ start: found, end: found + term.length })
        idx = found + term.length
      }
    }
    if (matches.length === 0) return original
    // Merge overlapping ranges
    matches.sort((a, b) => a.start - b.start)
    const merged: { start: number; end: number }[] = []
    for (const m of matches) {
      const last = merged[merged.length - 1]
      if (!last || m.start > last.end) merged.push({ ...m })
      else last.end = Math.max(last.end, m.end)
    }
    // Build HTML with <span class="pdf-hl"> for transparent underline-style highlight
    let html = ''
    let cursor = 0
    for (const rng of merged) {
      if (cursor < rng.start) html += original.slice(cursor, rng.start)
      const segment = original.slice(rng.start, rng.end)
      html += `<span class="pdf-hl">${segment}</span>`
      cursor = rng.end
    }
    if (cursor < original.length) html += original.slice(cursor)
    return html
  }

  // Kada je odabrana stranica i dokument učitan, skrolaj na tu stranicu
  useEffect(() => {
    if (!numPages || !page) return
    const container = viewerRef.current
    // sačekaj da se stranice renderuju
    const t = setTimeout(() => {
      if (!container) return
      const el = container.querySelector(`#page-${page}`) as HTMLElement | null
      if (el) {
        // Ako je aktivna PDF pretraga ili imamo target/highlighte, prepusti skrolanje drugom efektu
        if (!pdfSearch.trim() && !targetArticleNum && highlightTerms.length === 0) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }
    }, 150)
    return () => clearTimeout(t)
  }, [page, numPages, targetArticleNum, highlightTerms.length])

  // Nakon promjene stranice ili termina, pokušaj skrolati do markiranog broja člana (ako postoji),
  // u suprotnom do prvog highlight-a na stranici. Pokušaj nekoliko puta jer textLayer može kasniti.
  useEffect(() => {
    let attempts = 0
    const maxAttempts = 10
    const tick = () => {
      const container = viewerRef.current
      if (!container) return
      const scope = page ? (container.querySelector(`#page-${page} .textLayer`) as HTMLElement | null) : null
      const layer = scope || (container.querySelector('.textLayer') as HTMLElement | null)
      if (!layer) {
        if (++attempts < maxAttempts) setTimeout(tick, 200)
        return
      }
      let target: HTMLElement | null = null
      if (typeof targetArticleNum === 'number' && !Number.isNaN(targetArticleNum)) {
        const marks = Array.from(layer.querySelectorAll('span.pdf-hl')) as HTMLElement[]
        const numStr = String(targetArticleNum)
        // Priority 1: Look for "Član X" style matches (normalized)
        target = marks.find((m) => {
          const t = m.textContent?.trim().toLowerCase() || ''
          const normT = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          return normT.includes(`clan ${numStr}`) || normT.includes(`cl ${numStr}`) || normT.includes(`cl. ${numStr}`)
        }) || null

        // Priority 2: Exact number match (if "Član X" not found)
        if (!target) {
          target = marks.find((m) => m.textContent?.trim() === numStr) || null
        }
      }
      if (!target) {
        // Fallback na prvi PDF highlight element
        target = (layer.querySelector('span.pdf-hl') as HTMLElement | null)
      }
      if (target) {
        const container = viewerRef.current
        if (container) {
          const cRect = container.getBoundingClientRect()
          const tRect = target.getBoundingClientRect()
          const offset = (tRect.top - cRect.top) + container.scrollTop
          const centeredTop = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, Math.round(offset - container.clientHeight / 2)))
          container.scrollTo({ top: centeredTop, behavior: 'smooth' })
        }
      } else if (++attempts < maxAttempts) {
        setTimeout(tick, 200)
      } else {
        // Fallback: ako nismo našli highlight/target, skrolaj na vrh stranice
        // Ovo pokriva slučaj kada smo promijenili stranicu ali nema highlighta
        const el = container.querySelector(`#page-${page}`) as HTMLElement | null
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
    const t = setTimeout(tick, 250)
    return () => clearTimeout(t)
  }, [page, highlightTerms.join('|'), targetArticleNum])

  // Pomoćne funkcije za skokove po highlightima (lokalna pretraga)
  const getHighlights = () => {
    const container = viewerRef.current
    if (!container) return [] as HTMLElement[]
    return Array.from(container.querySelectorAll('span.pdf-hl')) as HTMLElement[]
  }
  const jumpToFirstHighlight = () => {
    let attempts = 0
    const maxAttempts = 10
    const tick = () => {
      const marks = getHighlights()
      if (marks.length === 0) {
        if (++attempts < maxAttempts) setTimeout(tick, 200)
        return
      }
      setSearchTotal(marks.length)
      setSearchIdx(1)
      const target = marks[0]
      const container = viewerRef.current
      if (container) {
        const cRect = container.getBoundingClientRect()
        const tRect = target.getBoundingClientRect()
        const offset = (tRect.top - cRect.top) + container.scrollTop
        const centeredTop = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, Math.round(offset - container.clientHeight / 2)))
        container.scrollTo({ top: centeredTop, behavior: 'smooth' })
      }
      const pageEl = target.closest('[id^="page-"]') as HTMLElement | null
      if (pageEl?.id) {
        const num = Number(pageEl.id.replace('page-', ''))
        if (!Number.isNaN(num)) setPage(num)
      }
    }
    setTimeout(tick, 200)
  }

  const jumpToHighlight = (direction: 'next' | 'prev') => {
    const all = getHighlights()
    const total = all.length
    if (total === 0) return
    let nextIdx = searchIdx
    if (direction === 'next') nextIdx = Math.min((searchIdx || 0) + 1, total)
    else nextIdx = searchIdx === 0 ? total : Math.max(1, searchIdx - 1)
    const target = all[nextIdx - 1]
    if (!target) return
    setSearchTotal(total)
    setSearchIdx(nextIdx)
    const container = viewerRef.current
    if (container) {
      const cRect = container.getBoundingClientRect()
      const tRect = target.getBoundingClientRect()
      const offset = (tRect.top - cRect.top) + container.scrollTop
      const centeredTop = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, Math.round(offset - container.clientHeight / 2)))
      container.scrollTo({ top: centeredTop, behavior: 'smooth' })
    }
    const pageEl = target.closest('[id^="page-"]') as HTMLElement | null
    if (pageEl?.id) {
      const num = Number(pageEl.id.replace('page-', ''))
      if (!Number.isNaN(num)) setPage(num)
    }
  }

  // Kada korisnik upiše pojam u toolbaru, automatski označimo i skočimo na prvi nalaz
  useEffect(() => {
    const term = pdfSearch.trim()
    if (!term) return
    // Resetuj brojače prije računanja novih nalaza
    setSearchTotal(0)
    setSearchIdx(0)
    const t = setTimeout(() => {
      // osiguraj da su se textLayer-i renderovali s novim highlightTerms
      jumpToFirstHighlight()
    }, 300)
    return () => clearTimeout(t)
  }, [pdfSearch])

  // Filtriraj poznato upozorenje iz react-pdf (AbortException: TextLayer task cancelled)
  useEffect(() => {
    const origError = console.error
    console.error = (...args: any[]) => {
      const msg = typeof args[0] === 'string' ? args[0] : ''
      if (msg.includes('AbortException: TextLayer task cancelled')) return
      origError(...args)
    }
    return () => { console.error = origError }
  }, [])

  return (
    <div className="space-y-4">
      {/* Povratno dugme */}
      <div className="mb-4">
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm"
        >
          <ArrowLeft size={16} />
          Povratak na rezultate
        </button>
      </div>

      {/* Conditional content to maintain consistent hook order */}
      {loading && (
        <div className="text-sm text-slate-500">Učitavam…</div>
      )}
      {!loading && !law && (
        <div className="text-sm text-slate-500">Nije pronađeno.</div>
      )}
      {!loading && law && (
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_160px] gap-6 items-start">
          <div className="space-y-3">
            {/* Law Title */}
            <div ref={headerRef} className="border-b pb-4 mb-4">
              <h1 className="text-2xl font-semibold mb-2 leading-tight">{law.title}</h1>
              {(law.gazette_key || law.gazette_date) && (
                <div className="text-sm text-gray-600">
                  {((key?: string | null, date?: string | null) => {
                    const num = key ? key.replace('_', '/') : null
                    let dateStr: string | null = null
                    if (date) {
                      const dt = new Date(date)
                      if (!Number.isNaN(dt.getTime())) {
                        const dd = String(dt.getDate()).padStart(2, '0')
                        const mm = String(dt.getMonth() + 1).padStart(2, '0')
                        const yyyy = dt.getFullYear()
                        dateStr = `${dd}.${mm}.${yyyy}.`
                      } else {
                        dateStr = date
                      }
                    }
                    return [num, dateStr].filter(Boolean).join(' • ')
                  })(law.gazette_key ?? null, law.gazette_date ?? null)}
                </div>
              )}
            </div>
            {/* Viewer toolbar styled like common PDF viewers */}
            <div className="rounded-lg border border-legalistik-cardBorder overflow-hidden shadow-sm">
              <div ref={toolbarRef} className="pdf-toolbar flex items-center justify-between text-white px-3 py-2 sticky top-0 z-10">
                {/* Left: search */}
                <div className="flex items-center gap-1">
                  <Search size={16} className="text-white/80" />
                  <input
                    type="text"
                    placeholder="Traži u PDF-u…"
                    value={pdfSearch}
                    onChange={(e) => setPdfSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') jumpToFirstHighlight() }}
                    className="w-40 md:w-52 rounded bg-white/5 px-2 py-1 text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-legalistik-teal"
                  />
                  <span className="text-xs text-white/70 tabular-nums">{searchIdx}/{searchTotal}</span>
                  <button
                    type="button"
                    aria-label="Prethodni nalaz"
                    title="Prethodni"
                    disabled={!pdfSearch.trim() || searchTotal < 1}
                    onClick={() => jumpToHighlight('prev')}
                    className="inline-flex items-center rounded bg-white/5 hover:bg-white/10 px-2 py-1 disabled:opacity-40"
                  >
                    <ArrowUp size={16} className="text-white/90" />
                  </button>
                  <button
                    type="button"
                    aria-label="Sljedeći nalaz"
                    title="Sljedeći"
                    disabled={!pdfSearch.trim() || searchTotal < 1}
                    onClick={() => jumpToHighlight('next')}
                    className="inline-flex items-center rounded bg-white/5 hover:bg-white/10 px-2 py-1 disabled:opacity-40"
                  >
                    <ArrowDown size={16} className="text-white/90" />
                  </button>
                  <button
                    type="button"
                    aria-label="Očisti pretragu"
                    title="Očisti"
                    disabled={!pdfSearch.trim()}
                    onClick={() => { setPdfSearch(''); setSearchTotal(0); setSearchIdx(0) }}
                    className="inline-flex items-center rounded bg-white/5 hover:bg-white/10 px-2 py-1 disabled:opacity-40"
                  >
                    <X size={16} className="text-white/90" />
                  </button>
                </div>
                {/* Center: nav, page count, zoom */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label="Prethodna stranica"
                    title="Prethodna"
                    disabled={!numPages || !page || page <= 1}
                    onClick={() => setPage((p) => (p && p > 1 ? (p - 1) : p))}
                    className="inline-flex items-center rounded bg-white/5 hover:bg-white/10 px-2 py-1 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-legalistik-teal"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <div className="text-sm whitespace-nowrap">{page ?? 1} / {numPages ?? '—'}</div>
                  <button
                    type="button"
                    aria-label="Sljedeća stranica"
                    title="Sljedeća"
                    disabled={!numPages || !page || page >= (numPages || 0)}
                    onClick={() => setPage((p) => (p && numPages ? Math.min(p + 1, numPages) : p))}
                    className="inline-flex items-center rounded bg-white/5 hover:bg-white/10 px-2 py-1 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-legalistik-teal"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Zoom -"
                      title="Zoom -"
                      onClick={() => { setFitMode('custom'); setScale((s) => Math.max(0.5, Number((s - 0.1).toFixed(2)))) }}
                      className="inline-flex items-center rounded bg-white/5 hover:bg-white/10 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-legalistik-teal"
                    >
                      <ZoomOut size={16} className="text-white/90" />
                    </button>
                    <select
                      aria-label="Zoom"
                      value={String(Math.round(scale * 100))}
                      onChange={(e) => { setFitMode('custom'); setScale(Math.max(0.5, Math.min(2, Number(e.target.value) / 100))) }}
                      className="rounded bg-white/5 hover:bg-white/10 px-2 py-1 text-white focus:outline-none focus:ring-2 focus:ring-legalistik-teal"
                    >
                      {['50', '75', '100', '125', '150', '200'].map((p) => (
                        <option key={p} value={p}>{p}%</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label="Zoom +"
                      title="Zoom +"
                      onClick={() => { setFitMode('custom'); setScale((s) => Math.min(2, Number((s + 0.1).toFixed(2)))) }}
                      className="inline-flex items-center rounded bg-white/5 hover:bg-white/10 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-legalistik-teal"
                    >
                      <ZoomIn size={16} className="text-white/90" />
                    </button>
                    <button
                      type="button"
                      aria-label="Fit širina"
                      title="Fit širina"
                      onClick={() => setFitMode('width')}
                      className="inline-flex items-center rounded bg-white/5 hover:bg-white/10 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-legalistik-teal"
                    >
                      <AlignHorizontalJustifyCenter size={16} className="text-white/90" />
                    </button>
                    <button
                      type="button"
                      aria-label="Fit visina"
                      title="Fit visina"
                      onClick={() => setFitMode('height')}
                      className="inline-flex items-center rounded bg-white/5 hover:bg-white/10 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-legalistik-teal"
                    >
                      <AlignVerticalJustifyCenter size={16} className="text-white/90" />
                    </button>
                  </div>
                </div>
                {/* Right: actions */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={showHighlights ? 'Sakrij istaknuto' : 'Prikaži istaknuto'}
                    title={showHighlights ? 'Sakrij istaknuto' : 'Prikaži istaknuto'}
                    onClick={() => setShowHighlights((v) => !v)}
                    className="inline-flex items-center rounded bg-white/5 hover:bg-white/10 px-2 py-1"
                  >
                    {showHighlights ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    type="button"
                    aria-label="Rotiraj lijevo"
                    title="Rotiraj lijevo"
                    onClick={() => setRotate((r) => (r - 90) % 360)}
                    className="inline-flex items-center rounded bg-white/5 hover:bg-white/10 px-2 py-1"
                  >
                    <RotateCcw size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label="Rotiraj desno"
                    title="Rotiraj desno"
                    onClick={() => setRotate((r) => (r + 90) % 360)}
                    className="inline-flex items-center rounded bg-white/5 hover:bg-white/10 px-2 py-1"
                  >
                    <RotateCw size={16} />
                  </button>
                  <a
                    href={pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Otvori/Preuzmi PDF"
                    title="Otvori/Preuzmi PDF"
                    className="inline-flex items-center rounded bg-white/5 hover:bg-white/10 px-2 py-1"
                  >
                    <Download size={16} />
                  </a>
                  <button
                    type="button"
                    aria-label="Štampa"
                    title="Štampa"
                    onClick={() => { try { window.open(pdfUrl, '_blank'); } catch { } }}
                    className="inline-flex items-center rounded bg-white/5 hover:bg-white/10 px-2 py-1"
                  >
                    <Printer size={16} />
                  </button>

                </div>
              </div>
              <div ref={viewerShellRef} className="h-[70vh] bg-neutral-200">
                <div ref={viewerRef} className="w-full h-full overflow-auto p-6">
                  <Document
                    file={pdfUrl}
                    onLoadSuccess={(info) => setNumPages(info.numPages)}
                    loading={<div className="p-3 text-sm text-gray-400">Učitavam PDF…</div>}
                  >
                    {numPages
                      ? Array.from({ length: numPages }, (_, i) => (
                        <div id={`page-${i + 1}`} key={i} className="mb-6 flex justify-center">
                          <div className="pdf-page bg-white shadow-md">
                            <Page
                              pageNumber={i + 1}
                              renderTextLayer={Math.abs((i + 1) - (page ?? 1)) <= 1}
                              customTextRenderer={showHighlights ? customTextRenderer : undefined}
                              {...(fitMode === 'width'
                                ? { width: containerSize.w }
                                : fitMode === 'height'
                                  ? { height: containerSize.h }
                                  : { width: Math.max(300, Math.round(containerSize.w * scale)) })}
                              rotate={rotate}
                            />
                          </div>
                        </div>
                      ))
                      : null}
                  </Document>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-2" style={{ marginTop: rightOffset }}>
            <div className="overflow-auto border border-[#e5eef5] rounded-lg bg-white shadow-sm" style={{ height: rightHeight }}>
              {filteredSegments.map((s) => {
                const isActive = page === s.page_hint
                const isHover = hoverSegId === s.id
                const label = String(s.label || '').trim()
                // Ako label već sadrži "Član <broj>", ne prikazuj dupli bedž
                const hasClanPrefix = label.toLowerCase().startsWith(`član ${String(s.number)}`)
                return (
                  <button
                    key={s.id}
                    onMouseEnter={() => setHoverSegId(s.id)}
                    onMouseLeave={() => setHoverSegId((prev) => (prev === s.id ? null : prev))}
                    className={`group w-full text-left px-3 py-2 border-l-4 ${isActive ? 'border-legalistik-teal bg-legalistik-tealSoft' : isHover ? 'border-legalistik-teal bg-[#e8eef4]' : 'border-transparent bg-white'} transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-legalistik-teal`}
                    onClick={() => { setPage(s.page_hint || null); setTargetArticleNum(s.number) }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium text-slate-800 group-hover:text-legalistik-teal">{hasClanPrefix ? `Član ${s.number}` : (label || `Član ${s.number}`)}</div>
                      {/* Bez desnog bedža da ne ponavlja broj */}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{s.text}</div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
