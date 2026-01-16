import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { ZoomIn, ZoomOut, Eye, EyeOff, ChevronLeft, ChevronRight, RotateCcw, RotateCw, Printer, Download, AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter, Search, X, ArrowUp, ArrowDown, FileText, ChevronDown, ChevronUp as ChevronUpIcon } from 'lucide-react'
import { Document, Page, pdfjs } from 'react-pdf/dist/index.js'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import 'react-pdf/dist/Page/TextLayer.css'
import 'react-pdf/dist/Page/AnnotationLayer.css'

type RelatedLaw = {
  id: number
  title: string
  gazette_key?: string | null
  gazette_date?: string | null
}

type Law = {
  id: number
  title: string
  path_pdf: string
  gazette_key?: string | null
  gazette_date?: string | null
  group_id?: number | null
  related_laws?: RelatedLaw[]
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
  const [showRelated, setShowRelated] = useState(true)
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
  const norm = (s: string) => stripDiacritics(s).toLowerCase().replace(/\u00A0/g, ' ')
  const highlightTerms = useMemo(() => {
    // Ako korisnik traži unutar PDF-a, označi SAMO taj novi pojam.
    // U suprotnom, označi pojmove iz početnog upita (q) s liste.
    const qSrc = (query || '').trim()
    const qTokens = qSrc.split(/\s+/).filter((t) => t.length >= 3)
    const sSrc = pdfSearch.trim()

    // Ako korisnik traži unutar PDF-a, koristimo ISKLJUČIVO uneseni izraz kao frazu.
    // Ovo sprječava da se za "član 4" označe sva pojavljivanja riječi "član" i broja "4" odvojeno.
    const activeTokens = sSrc ? [sSrc] : qTokens
    const set = new Set(activeTokens.map((t) => norm(t)))
    // Dodaj broj člana SAMO kada nema aktivne lokalne pretrage
    if (!sSrc && typeof targetArticleNum === 'number' && !Number.isNaN(targetArticleNum)) {
      // Ne dodajemo sam broj (npr. "5") jer to matchuje i datume, stranice itd.
      // Umjesto toga, dodajemo specifične prefikse.
      set.add(`clan ${targetArticleNum}`)
      set.add(`cl ${targetArticleNum}`)
      set.add(`cl. ${targetArticleNum}`)
      // Za svaki slučaj, ako je u PDF-u "Član5" (bez razmaka)
      set.add(`clan${targetArticleNum}`)
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

  // Helper: Robustly find text in the text layer (handles split spans, formatting)
  const findTextInLayer = (layer: HTMLElement, searchText: string, isArticleSearch = false): HTMLElement | null => {
    const spans = Array.from(layer.querySelectorAll('span, div')) as HTMLElement[]
    if (spans.length === 0) return null

    let fullText = ''
    const spanMap: { start: number; el: HTMLElement }[] = []

    // Normalize: NFD decomposition, strip marks, toLowerCase, handle non-breaking space and collapsible whitespace
    const normalize = (s: string) =>
      s.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[\u00A0\r\n\t]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    for (const span of spans) {
      const content = span.textContent || ''
      const txt = normalize(content)
      if (!txt) continue

      spanMap.push({ start: fullText.length, el: span })
      fullText += txt + ' '
    }

    let matchIndex = -1
    const searchNorm = normalize(searchText).trim()

    if (isArticleSearch) {
      // Specific logic for Article Numbers (e.g. "Clan 34")
      const num = parseInt(searchText, 10)
      if (Number.isNaN(num)) return null

      // Priority 1: Prefix + Number
      // Using a more robust regex that ignores extra junk and handles diacritics better
      // Permissive ending: dot, boundary, or end of string
      // Also allow optional spaces inside words (e.g. "C lan") to match server-side parsing logic
      // Updated to be even more permissive with splitting and characters
      const regexPrefix = new RegExp(`(?:c|č|ч)\\s*(?:l|л)\\s*(?:a|а)\\s*(?:n|н)(?:ak|ак)?(?:\\.|\\s)*\\W{0,30}${num}(?:\\..{0,10}|\\b|$)`, 'i')
      const m1 = regexPrefix.exec(fullText)
      if (m1) {
        matchIndex = m1.index
      } else {
        // Priority 2: Standalone Number (risky, but sometimes necessary)
        const regexNum = new RegExp(`(?:^|[^0-9])(${num})(?!\\d)`, 'i')
        const m2 = regexNum.exec(fullText)
        if (m2) {
          const offset = m2[0].indexOf(m2[1])
          matchIndex = m2.index + offset
        }
      }
    } else {
      // Generic Phrase Search
      matchIndex = fullText.indexOf(searchNorm)
    }

    if (matchIndex !== -1) {
      // Find the span corresponding to matchIndex
      for (const item of spanMap) {
        if (item.start <= matchIndex) {
          // Check if this span is "close enough" or covers the start
          // Since spans are sequential, the last one with start <= matchIndex is the one containing the start.
          // We iterate and keep updating 'bestSpan' until we pass the index.
        } else {
          break
        }
      }
      // Efficient lookup:
      let bestSpan: HTMLElement | null = null
      for (let i = 0; i < spanMap.length; i++) {
        if (spanMap[i].start <= matchIndex) {
          bestSpan = spanMap[i].el
        } else {
          break
        }
      }
      return bestSpan
    }
    return null
  }

  // Unified Scroll/Navigation Effect
  useEffect(() => {
    if (!page || !viewerRef.current) return

    // Flag to track if we are attempting a specific target scroll
    const isTargeting = !!targetArticleNum || !!pdfSearch.trim()

    let attempts = 0
    const maxAttempts = 30 // ~6 seconds

    const attemptScroll = () => {
      const container = viewerRef.current
      if (!container) return

      const pageEl = container.querySelector(`#page-${page}`) as HTMLElement | null
      if (!pageEl) {
        // Page container not rendered yet
        if (++attempts < maxAttempts) setTimeout(attemptScroll, 200)
        return
      }

      // If we are just changing pages (no specific target), scroll to top of page
      if (!isTargeting) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }

      // We have a target (Article or Search Term)
      const layer = pageEl.querySelector('.textLayer') as HTMLElement | null
      if (!layer || layer.children.length === 0) {
        // Text layer not ready
        if (++attempts < maxAttempts) setTimeout(attemptScroll, 200)
        return
      }

      let targetEl: HTMLElement | null = null

      // 1. Try finding by Article Number
      if (targetArticleNum) {
        targetEl = findTextInLayer(layer, String(targetArticleNum), true)
      }

      // 2. Try finding by Search Term (if no article target or article not found)
      if (!targetEl && pdfSearch.trim()) {
        // First try standard highlights
        targetEl = layer.querySelector('span.pdf-hl') as HTMLElement | null
        // If not found (e.g. split spans), try robust text search
        if (!targetEl) {
          targetEl = findTextInLayer(layer, pdfSearch)
        }
      }

      // 3. Fallback for Article: try existing highlights if robust search failed
      if (!targetEl && targetArticleNum) {
        targetEl = layer.querySelector('span.pdf-hl') as HTMLElement | null
      }

      if (targetEl) {
        // Double check if targetEl is a span and if we can find a pdf-hl inside it (better accuracy)
        const hl = targetEl.querySelector('.pdf-hl') as HTMLElement | null
        const finalTarget = hl || targetEl

        const container = viewerRef.current
        if (container) {
          const cRect = container.getBoundingClientRect()
          const tRect = finalTarget.getBoundingClientRect()
          const scrollNeeded = (tRect.top - cRect.top) + container.scrollTop - (cRect.height / 2) + (tRect.height / 2)
          container.scrollTo({ top: scrollNeeded, behavior: 'smooth' })
        }
      } else {
        // Target not found on this page despite text layer being ready.
        // Fallback: Scroll to the top of the page so the user at least lands on the correct page.
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }

    // Debounce slightly to allow rendering
    const t = setTimeout(attemptScroll, 100)
    return () => clearTimeout(t)
  }, [page, targetArticleNum, pdfSearch, highlightTerms]) // Re-run when these change



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
      let target: HTMLElement | null = null

      if (marks.length > 0) {
        setSearchTotal(marks.length)
        setSearchIdx(1)
        target = marks[0]
      } else if (pdfSearch.trim()) {
        // Fallback: Try robust search in visible text layers
        const container = viewerRef.current
        if (container) {
          const layers = Array.from(container.querySelectorAll('.textLayer')) as HTMLElement[]
          for (const layer of layers) {
            const found = findTextInLayer(layer, pdfSearch)
            if (found) {
              target = found
              // Note: We can't easily count total matches for robust search without scanning everything,
              // so we just set 1/1 to indicate "found something".
              setSearchTotal(1)
              setSearchIdx(1)
              break
            }
          }
        }
      }

      if (target) {
        const container = viewerRef.current
        if (container) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        const pageEl = target.closest('[id^="page-"]') as HTMLElement | null
        if (pageEl?.id) {
          const num = Number(pageEl.id.replace('page-', ''))
          if (!Number.isNaN(num)) setPage(num)
        }
      } else {
        if (++attempts < maxAttempts) setTimeout(tick, 200)
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
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
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

              {/* Related Laws Section */}
              {law.related_laws && law.related_laws.length > 1 && (
                <div className="mt-4">
                  <button
                    onClick={() => setShowRelated((v) => !v)}
                    className="flex items-center gap-2 text-sm font-medium text-legalistik-teal hover:text-legalistik-tealDark transition-colors"
                  >
                    <FileText size={16} />
                    Povezani propisi ({law.related_laws.length})
                    {showRelated ? <ChevronUpIcon size={16} /> : <ChevronDown size={16} />}
                  </button>
                  {showRelated && (
                    <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <ul className="space-y-2">
                        {law.related_laws.map((rel, idx) => {
                          const isCurrent = rel.id === law.id
                          const isBase = idx === 0
                          const gazetteNum = rel.gazette_key ? rel.gazette_key.replace('_', '/') : null

                          let dateStr: string | null = null
                          if (rel.gazette_date) {
                            const dt = new Date(rel.gazette_date)
                            if (!Number.isNaN(dt.getTime())) {
                              const dd = String(dt.getDate()).padStart(2, '0')
                              const mm = String(dt.getMonth() + 1).padStart(2, '0')
                              const yyyy = dt.getFullYear()
                              dateStr = `${dd}.${mm}.${yyyy}.`
                            } else {
                              dateStr = rel.gazette_date
                            }
                          }

                          const infoStr = [gazetteNum, dateStr].filter(Boolean).join(' • ')

                          return (
                            <li key={rel.id} className="flex items-start gap-2">
                              <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${isCurrent ? 'bg-legalistik-teal' : 'bg-slate-300'}`} />
                              {isCurrent ? (
                                <span className="text-sm font-medium text-slate-800">
                                  {rel.title}
                                  {infoStr && <span className="text-slate-500 font-normal"> ({infoStr})</span>}
                                  {isBase && <span className="ml-2 text-xs bg-legalistik-teal text-white px-1.5 py-0.5 rounded">Osnovni</span>}
                                  <span className="ml-2 text-xs text-legalistik-teal">← Trenutni</span>
                                </span>
                              ) : (
                                <a
                                  href={`/viewer/${rel.id}`}
                                  className="text-sm text-slate-700 hover:text-legalistik-teal hover:underline transition-colors"
                                >
                                  {rel.title}
                                  {infoStr && <span className="text-slate-500"> ({infoStr})</span>}
                                  {isBase && <span className="ml-2 text-xs bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">Osnovni</span>}
                                </a>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
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
