
import fs from 'fs-extra';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface LawSegment {
  label: string;
  number: number;
  text: string;
  page_hint: number;
}

function normalizeLabel(input: string) {
  return input.replace(/\s+/g, ' ').trim();
}

function stripRtf(rtf: string): string {
  let text = rtf;
  text = text.replace(/\\u(-?\d+)\?/g, (_, code) => String.fromCharCode(Number(code)));
  text = text
    .replace(/\\par\b/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\\line\b/g, '\n');
  text = text.replace(/\\[a-z]+\d*/g, '');
  text = text.replace(/[{}]/g, '');
  return text;
}

export function normalizeTitle(input: string) {
  const map: Record<string, string> = {
    č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj', Č: 'c', Ć: 'c', Ž: 'z', Š: 's', Đ: 'dj'
  };
  return input
    .replace(/[čćžšđČĆŽŠĐ]/g, (ch) => map[ch] || ch)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeText(input: string) {
  let out = input;
  out = stripRtf(out);
  // Normalize non-breaking spaces before anything else
  out = out.replace(/\u00A0/g, ' ');
  
  if (/[ÃÄÅ]/.test(out)) {
    try {
      // @ts-ignore
      out = decodeURIComponent(escape(out));
    } catch { }
  }
  try {
    out = out.normalize('NFC');
  } catch { }
  out = out.replace(/Č[\s\u00A0\u2000-\u200B]+lan/g, 'Član');
  out = out.replace(/C[\s\u00A0\u2000-\u200B]+lan/g, 'Clan');
  out = out.replace(/Č[\s\u00A0\u2000-\u200B]+l\./g, 'Čl.');
  out = out.replace(/Ч[\s\u00A0\u2000-\u200B]+лан/g, 'Члан');
  return out;
}

const ARTICLE_RE = /(\b|\n)\s*((?:Č\s*lan|C\s*lan|Č\s*lanak|C\s*lanak|Č\s*l\.|C\s*l\.))\s*(\d{1,3})\s*[\.)\-:\u2013\u2014]?/i;

export function parseSegments(fullText: string, disableHeuristics = false): LawSegment[] {
  // Initial normalization
  fullText = normalizeText(fullText);

  const segments: LawSegment[] = [];
  
  // Regex definitions
  const wsClass = "[\\s\\u00A0\\u2000-\\u200B]";
  const lineStart = "(?:^|\\n)";
  const upperClass = '[A-ZČĆŠŽĐА-ЯЉЊЂЋЏ]';
  const headingTokens = '(?:Č\\s*lan|C\\s*lan|Č\\s*lanak|C\\s*lanak|Č\\s*l\\.|C\\s*l\\.|Ч\\s*лан|Ч\\s*л\\.)';
  
  const strictHeading = (n: number) => new RegExp(`${lineStart}${headingTokens}${wsClass}*${n}(?:\\.|-|:\\u2013|\\u2014)${wsClass}*`, 'i');
  const looseHeading = (n: number) => new RegExp(`${lineStart}${headingTokens}${wsClass}*${n}${wsClass}*(?:\\.|-|:\\u2013|\\u2014)`, 'i');
  const noDotHeading = (n: number) => new RegExp(`${lineStart}${headingTokens}${wsClass}*${n}(?!\\d)${wsClass}+`, 'i');

  const candidateNums: number[] = [];
  {
    const mAll: number[] = [];
    const reAll = new RegExp(`${headingTokens}${wsClass}*(\\d{1,3})(?:\\.|-|:\\u2013|\\u2014)${wsClass}*`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = reAll.exec(fullText))) {
      const num = Number(m[1]);
      if (!Number.isNaN(num)) mAll.push(num);
    }
    const uniq = new Set<number>(mAll);
    candidateNums.push(...uniq);
  }

  const maxNum = candidateNums.length ? Math.max(...candidateNums) : 0;
  const matches: { idx: number; num: number; raw: string }[] = [];

  if (maxNum > 0) {
    for (let n = 1; n <= maxNum; n++) {
      let idx = fullText.search(strictHeading(n));
      let raw = '';
      if (idx < 0) idx = fullText.search(looseHeading(n));
      if (idx < 0) idx = fullText.search(noDotHeading(n));
      if (idx < 0) {
        const inlineHeading = new RegExp(`(?:^|${wsClass})${headingTokens}${wsClass}*${n}${wsClass}+(?=${upperClass})`, 'iu');
        idx = fullText.search(inlineHeading);
      }
      if (idx < 0) {
        const inlineNoDot = new RegExp(`${headingTokens}${wsClass}*${n}(?!\\d)${wsClass}+`, 'i');
        idx = fullText.search(inlineNoDot);
      }

      if (idx >= 0) {
        raw = fullText.slice(idx, Math.min(fullText.length, idx + 48));
        matches.push({ idx, num: n, raw });
      }
    }
    matches.sort((a, b) => a.idx - b.idx);
  } else {
    // Fallback
    const regex = new RegExp(ARTICLE_RE.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = regex.exec(fullText))) {
      const num = Number(m[3]);
      const raw = m[0];
      matches.push({ idx: m.index, num, raw });
    }
  }

  const seen = new Set<number>();
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i];
    const endIdx = i + 1 < matches.length ? matches[i + 1].idx : fullText.length;
    const isCyr = /Члан/i.test(start.raw);
    const labelBase = isCyr ? 'Члан' : 'Član';
    const label = normalizeLabel(`${labelBase} ${start.num}`);
    
    // Slice text
    const snippetRaw = fullText.slice(start.idx, Math.min(endIdx, start.idx + 15000)); // Increased limit for pasted text
    const snippet = normalizeText(snippetRaw.trim());
    
    // Page hint is always 1 for pasted text
    const page_hint = 1;

    if (!seen.has(start.num)) {
      segments.push({ label, number: start.num, text: snippet, page_hint });
      seen.add(start.num);
    }
  }

  // Heuristics for missing numbers
  const hasCyrillic = /Члан/i.test(fullText);
  const labelBaseAll = hasCyrillic ? 'Члан' : 'Član';
  
  if (maxNum > 0 && !disableHeuristics) {
    const missing: number[] = [];
    for (let n = 1; n <= maxNum; n++) if (!seen.has(n)) missing.push(n);
    
    for (const n of missing) {
      const label = normalizeLabel(`${labelBaseAll} ${n}`);
      const anyHeading = new RegExp(`(?:Č\\s*lan|C\\s*lan|Č\\s*l\\.|C\\s*l\\.|Ч\\s*лан|Ч\\s*л\\.)${wsClass}*${n}`, 'i');
      const idx = fullText.search(anyHeading);
      const page_hint = 1;
      
      if (idx >= 0) {
        // If found but not caught by main loop (rare but possible)
        // We can try to extract a snippet, or just mark it as found via heuristic
        const snippetRaw = fullText.slice(idx, Math.min(fullText.length, idx + 2000));
        const text = normalizeText(snippetRaw.trim());
        segments.push({ label, number: n, text, page_hint });
      } else {
        // Not found at all
        // segments.push({ label, number: n, text: "Nije detektovan tekst.", page_hint });
      }
      seen.add(n);
    }
  }
  
  // Add Intro if empty or starts late
  if (segments.length === 0) {
     const snippet = normalizeText(fullText.slice(0, Math.min(fullText.length, 4000)).trim());
     segments.push({ label: 'Uvod', number: 0, text: snippet, page_hint: 1 });
  } else if (segments[0].number > 1) {
      // Check if there is text before the first segment
      const firstIdx = matches[0]?.idx || 0;
      if (firstIdx > 50) {
          const introText = normalizeText(fullText.slice(0, firstIdx).trim());
          if (introText.length > 20) {
              segments.unshift({ label: 'Uvod', number: 0, text: introText, page_hint: 1 });
          }
      }
  }

  return segments;
}

export async function parseSegmentsFromPdf(pdfPath: string): Promise<LawSegment[]> {
  try {
    const buf = await fs.readFile(pdfPath);
    const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const loadingTask = getDocument({ data: u8 });
    const pdf = await loadingTask.promise;
    
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent: any = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      let lastY = null as number | null;
      let lastX = null as number | null;
      let lastChar = '';
      let text = '';
      for (const item of textContent.items) {
        const str = String(item.str || '');
        const y = item.transform ? item.transform[5] : null;
        const x = item.transform ? item.transform[4] : null;
        if (lastY !== null && y !== null && Math.abs(lastY - y) > 9) text += '\n';
        else if (lastX !== null && x !== null && Math.abs(lastX - x) > 2) {
          const f = str.charAt(0);
          if (/\w/.test(lastChar) && /\w/.test(f)) text += ' ';
        }
        text += str;
        if (y !== null) lastY = y;
        if (x !== null) lastX = x;
        if (str.length) lastChar = str.charAt(str.length - 1);
      }
      const cleaned = text.replace(/\s+\n/g, '\n').replace(/\s{2,}/g, ' ').trim();
      const cleanedNorm = normalizeText(cleaned);
      pages.push(cleanedNorm);
    }
    await pdf.cleanup();

    const PAGE_SEP = '\n\n';
    const fullText = pages.join(PAGE_SEP);

    // Calculate page offsets
    const pageOffsets: number[] = [];
    let acc = 0;
    for (let i = 0; i < pages.length; i++) {
      pageOffsets.push(acc);
      acc += pages[i].length + PAGE_SEP.length;
    }

    const pageForIndex = (idx: number) => {
      let lo = 0, hi = pageOffsets.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const start = pageOffsets[mid];
        const nextStart = mid + 1 < pageOffsets.length ? pageOffsets[mid + 1] : Number.POSITIVE_INFINITY;
        if (idx >= start && idx < nextStart) return mid + 1;
        if (idx < start) hi = mid - 1;
        else lo = mid + 1;
      }
      return 1;
    };

    // Use the main parsing logic but now mapped to pages
    // Note: We're basically duplicating the logic from parseSegments but adding page_hint calculation
    // Ideally we'd refactor parseSegments to accept pageOffsets, but copying is safer for now to avoid breaking existing code
    
    const wsClass = "[\\s\\u00A0\\u2000-\\u200B]";
    const lineStart = "(?:^|\\n)";
    const upperClass = '[A-ZČĆŠŽĐА-ЯЉЊЂЋЏ]';
    const headingTokens = '(?:Č\\s*lan|C\\s*lan|Č\\s*lanak|C\\s*lanak|Č\\s*l\\.|C\\s*l\\.|Ч\\s*лан|Ч\\s*л\\.)';
    const strictHeading = (n: number) => new RegExp(`${lineStart}${headingTokens}${wsClass}*${n}(?:\\.|-|:\\u2013|\\u2014)${wsClass}*`, 'i');
    const looseHeading = (n: number) => new RegExp(`${lineStart}${headingTokens}${wsClass}*${n}${wsClass}*(?:\\.|-|:\\u2013|\\u2014)`, 'i');
    const noDotHeading = (n: number) => new RegExp(`${lineStart}${headingTokens}${wsClass}*${n}(?!\\d)${wsClass}+`, 'i');

    const candidateNums: number[] = [];
    {
      const mAll: number[] = [];
      const reAll = new RegExp(`${headingTokens}${wsClass}*(\\d{1,3})(?:\\.|-|:\\u2013|\\u2014)${wsClass}*`, 'gi');
      let m: RegExpExecArray | null;
      while ((m = reAll.exec(fullText))) {
        const num = Number(m[1]);
        if (!Number.isNaN(num)) mAll.push(num);
      }
      const uniq = new Set<number>(mAll);
      candidateNums.push(...uniq);
    }

    const maxNum = candidateNums.length ? Math.max(...candidateNums) : 0;
    const matches: { idx: number; num: number; raw: string }[] = [];

    if (maxNum > 0) {
      for (let n = 1; n <= maxNum; n++) {
        let idx = fullText.search(strictHeading(n));
        let raw = '';
        if (idx < 0) idx = fullText.search(looseHeading(n));
        if (idx < 0) idx = fullText.search(noDotHeading(n));
        if (idx < 0) {
          const inlineHeading = new RegExp(`(?:^|${wsClass})${headingTokens}${wsClass}*${n}${wsClass}+(?=${upperClass})`, 'iu');
          idx = fullText.search(inlineHeading);
        }
        if (idx < 0) {
          const inlineNoDot = new RegExp(`${headingTokens}${wsClass}*${n}(?!\\d)${wsClass}+`, 'i');
          idx = fullText.search(inlineNoDot);
        }

        if (idx >= 0) {
          raw = fullText.slice(idx, Math.min(fullText.length, idx + 48));
          matches.push({ idx, num: n, raw });
        }
      }
      matches.sort((a, b) => a.idx - b.idx);
    } else {
        const regex = new RegExp(ARTICLE_RE.source, 'gi');
        let m: RegExpExecArray | null;
        while ((m = regex.exec(fullText))) {
            const num = Number(m[3]);
            const raw = m[0];
            matches.push({ idx: m.index, num, raw });
        }
    }

    const segments: LawSegment[] = [];
    const seen = new Set<number>();
    
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i];
      const endIdx = i + 1 < matches.length ? matches[i + 1].idx : fullText.length;
      const isCyr = /Члан/i.test(start.raw);
      const labelBase = isCyr ? 'Члан' : 'Član';
      const label = normalizeLabel(`${labelBase} ${start.num}`);
      const snippetRaw = fullText.slice(start.idx, Math.min(endIdx, start.idx + 15000));
      const snippet = normalizeText(snippetRaw.trim());
      const page_hint = pageForIndex(start.idx);

      if (!seen.has(start.num)) {
        segments.push({ label, number: start.num, text: snippet, page_hint });
        seen.add(start.num);
      }
    }

    // Heuristics for missing numbers
    const hasCyrillic = /Члан/i.test(fullText);
    const labelBaseAll = hasCyrillic ? 'Члан' : 'Član';
    
    if (maxNum > 0) {
      const missing: number[] = [];
      for (let n = 1; n <= maxNum; n++) if (!seen.has(n)) missing.push(n);
      
      for (const n of missing) {
        const label = normalizeLabel(`${labelBaseAll} ${n}`);
        const anyHeading = new RegExp(`(?:Č\\s*lan|C\\s*lan|Č\\s*l\\.|C\\s*l\\.|Ч\\s*лан|Ч\\s*л\\.)${wsClass}*${n}`, 'i');
        const idx = fullText.search(anyHeading);
        const page_hint = idx >= 0 ? pageForIndex(idx) : 1;
        
        if (idx >= 0) {
          const snippetRaw = fullText.slice(idx, Math.min(fullText.length, idx + 2000));
          const text = normalizeText(snippetRaw.trim());
          segments.push({ label, number: n, text, page_hint });
        }
        seen.add(n);
      }
    }

    // Intro
    if (segments.length === 0) {
        const snippet = normalizeText(fullText.slice(0, Math.min(fullText.length, 4000)).trim());
        segments.push({ label: 'Uvod', number: 0, text: snippet, page_hint: 1 });
    } else if (segments[0].number > 1) {
        const firstIdx = matches[0]?.idx || 0;
        if (firstIdx > 50) {
            const introText = normalizeText(fullText.slice(0, firstIdx).trim());
            if (introText.length > 20) {
                segments.unshift({ label: 'Uvod', number: 0, text: introText, page_hint: 1 });
            }
        }
    }

    return segments;

  } catch (e) {
    console.error('Failed to parse segments from PDF:', e);
    return [];
  }
}
