import fs from 'fs';
import path from 'path';

function getArg(key: string, def?: string): string | undefined {
  const prefixed = `--${key}`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefixed + '=')) return arg.substring(prefixed.length + 1);
    if (arg === prefixed) return 'true';
  }
  return def;
}

function parseDate(str: string): number | null {
  const s = str.replace(/\s+/g, ' ').trim();
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const y = parseInt(m[3], 10);
    if (!isNaN(d) && !isNaN(mo) && !isNaN(y)) return Date.UTC(y, mo, d);
  }
  // Try ISO
  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const y = parseInt(iso[1], 10);
    const mo = parseInt(iso[2], 10) - 1;
    const d = parseInt(iso[3], 10);
    if (!isNaN(d) && !isNaN(mo) && !isNaN(y)) return Date.UTC(y, mo, d);
  }
  return null;
}

function extractCells(rowHtml: string): string[] {
  const tds = rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || [];
  return tds.map((cell) => cell.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

function findDateColumnIndex(headerRow: string): number {
  const cells = extractCells(headerRow);
  const idx = cells.findIndex((c) => /datum/i.test(c));
  return idx >= 0 ? idx : 3; // fallback: 4th column
}

function findYearColumnIndex(headerRow: string): number {
  const cells = extractCells(headerRow);
  const idx = cells.findIndex((c) => /godina/i.test(c));
  return idx >= 0 ? idx : 1; // fallback: 2nd column
}

function findGazetteColumnIndex(headerRow: string): number {
  const cells = extractCells(headerRow);
  const idx = cells.findIndex((c) => /službene\s+novine|novine|broj/i.test(c));
  return idx >= 0 ? idx : 2; // fallback: 3rd column
}

function sortTable(html: string): { html: string; sortedCount: number } {
  // Work within <tbody> if present; else sort all <tr> after the header
  const tbodyMatch = html.match(/<tbody[^>]*>[\s\S]*?<\/tbody>/i);
  if (tbodyMatch) {
    const tbody = tbodyMatch[0];
    const rows = tbody.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    if (rows.length < 2) return { html, sortedCount: 0 };
    const header = rows[0];
    const rest = rows.slice(1);
    const dateCol = findDateColumnIndex(header);
    const yearCol = findYearColumnIndex(header);
    const gazetteCol = findGazetteColumnIndex(header);

    const parsed = rest.map((r, i) => {
      const cells = extractCells(r);
      const year = parseInt((cells[yearCol] || '').replace(/[^0-9]/g, ''), 10);
      const dateKey = parseDate(cells[dateCol] || '');
      const gazette = (cells[gazetteCol] || '').replace(/\s+/g, ' ').trim();
      return { year: isNaN(year) ? null : year, dateKey, gazette, row: r, idx: i };
    });

    // Group by (year, gazette, date)
    const groups = new Map<string, { year: number | null; dateKey: number | null; gazette: string; rows: typeof parsed }>();
    for (const p of parsed) {
      const key = `${p.year ?? 'NA'}|${p.gazette || 'NA'}|${p.dateKey ?? 'NA'}`;
      if (!groups.has(key)) {
        groups.set(key, { year: p.year, dateKey: p.dateKey, gazette: p.gazette, rows: [] });
      }
      groups.get(key)!.rows.push(p);
    }

    const sortedGroups = Array.from(groups.values()).sort((a, b) => {
      // Year ASC, NA last
      if (a.year === null && b.year === null) {
        // continue
      } else if (a.year === null) return 1;
      else if (b.year === null) return -1;
      else if (a.year !== b.year) return (a.year as number) - (b.year as number);
      // Date ASC, NA last
      if (a.dateKey === null && b.dateKey === null) {
        // continue
      } else if (a.dateKey === null) return 1;
      else if (b.dateKey === null) return -1;
      else if (a.dateKey !== b.dateKey) return (a.dateKey as number) - (b.dateKey as number);
      // Gazette tie-breaker lexicographically
      return a.gazette.localeCompare(b.gazette);
    });

    const flattened: string[] = [header];
    for (const g of sortedGroups) {
      // preserve original order within group by original index
      g.rows.sort((x, y) => x.idx - y.idx);
      for (const r of g.rows) flattened.push(r.row);
    }
    const rebuilt = flattened.join('\n');
    const newTbody = tbody.replace(/([\s\S]*?)(<tr[\s\S]*?<\/tr>)+([\s\S]*)/i, rebuilt);
    const out = html.replace(tbody, newTbody);
    return { html: out, sortedCount: parsed.length };
  }

  // No <tbody>: attempt to sort all rows while preserving the first as header
  const allRows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  if (allRows.length < 2) return { html, sortedCount: 0 };
  const header = allRows[0];
  const rest = allRows.slice(1);
  const dateCol = findDateColumnIndex(header);
  const yearCol = findYearColumnIndex(header);
  const gazetteCol = findGazetteColumnIndex(header);
  const parsed = rest.map((r, i) => {
    const cells = extractCells(r);
    const year = parseInt((cells[yearCol] || '').replace(/[^0-9]/g, ''), 10);
    const dateKey = parseDate(cells[dateCol] || '');
    const gazette = (cells[gazetteCol] || '').replace(/\s+/g, ' ').trim();
    return { year: isNaN(year) ? null : year, dateKey, gazette, row: r, idx: i };
  });
  const groups = new Map<string, { year: number | null; dateKey: number | null; gazette: string; rows: typeof parsed }>();
  for (const p of parsed) {
    const key = `${p.year ?? 'NA'}|${p.gazette || 'NA'}|${p.dateKey ?? 'NA'}`;
    if (!groups.has(key)) {
      groups.set(key, { year: p.year, dateKey: p.dateKey, gazette: p.gazette, rows: [] });
    }
    groups.get(key)!.rows.push(p);
  }
  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    if (a.year === null && b.year === null) {
      // continue
    } else if (a.year === null) return 1;
    else if (b.year === null) return -1;
    else if (a.year !== b.year) return (a.year as number) - (b.year as number);
    if (a.dateKey === null && b.dateKey === null) {
      // continue
    } else if (a.dateKey === null) return 1;
    else if (b.dateKey === null) return -1;
    else if (a.dateKey !== b.dateKey) return (a.dateKey as number) - (b.dateKey as number);
    return a.gazette.localeCompare(b.gazette);
  });
  const flattened: string[] = [header];
  for (const g of sortedGroups) {
    g.rows.sort((x, y) => x.idx - y.idx);
    for (const r of g.rows) flattened.push(r.row);
  }
  const rebuilt = flattened.join('\n');
  const out = html.replace(/(<tr[^>]*>[\s\S]*?<\/tr>)+/i, rebuilt);
  return { html: out, sortedCount: parsed.length };
}

async function main() {
  const target = getArg('target', path.join('tmp', 'fbih_registry_preview.html'))!;
  const aliasTarget = getArg('alias_target', path.join('tmp', 'fbih_single_article_preview.html'))!;
  const targets = [target, aliasTarget];
  let totalSorted = 0;
  for (const t of targets) {
    const fullPath = path.resolve(t);
    if (!fs.existsSync(fullPath)) {
      console.error(`Target not found: ${fullPath}`);
      continue;
    }
    const input = fs.readFileSync(fullPath, 'utf8');
    const { html: out, sortedCount } = sortTable(input);
    fs.writeFileSync(fullPath, out, 'utf8');
    console.log(`Sorted by Year→Date→Gazette ASC in ${path.basename(fullPath)}; affected rows: ${sortedCount}`);
    totalSorted += sortedCount;
  }
  console.log(`Done. Total sorted rows: ${totalSorted}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});