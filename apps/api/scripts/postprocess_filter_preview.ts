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

type Mode = 'remove-rows' | 'strip-phrase' | 'normalize-language';

function rowHasUrlSubstring(row: string, urlSubstrLower?: string): boolean {
  if (!urlSubstrLower) return false;
  const hrefs = row.match(/href\s*=\s*(["'])([^"']+)\1/gi) || [];
  for (const h of hrefs) {
    const m = h.match(/href\s*=\s*(["'])([^"']+)\1/i);
    const url = m ? m[2] : '';
    if (url.toLowerCase().includes(urlSubstrLower)) return true;
  }
  return false;
}

function processHtml(html: string, phrase: string, mode: Mode, urlContains?: string): { html: string; removed: number } {
  const lowerPhrase = (phrase || '').toLowerCase().trim();
  const urlSubstrLower = (urlContains || '').toLowerCase().trim();
  if (mode === 'remove-rows') {
    let removed = 0;
    const filtered = html.replace(/<tr[\s\S]*?<\/tr>/g, (row) => {
      const byPhrase = lowerPhrase.length > 0 && row.toLowerCase().includes(lowerPhrase);
      const byUrl = urlSubstrLower.length > 0 && rowHasUrlSubstring(row, urlSubstrLower);
      if (byPhrase || byUrl) {
        removed++;
        return '';
      }
      return row;
    });
    return { html: filtered, removed };
  }

  if (mode === 'normalize-language') {
    // Keep bosanski titles, drop hrvatski-only rows, and strip hrvatski segment if both appear in the same cell
    let removed = 0;
    const normalized = html.replace(/<tr[\s\S]*?<\/tr>/g, (row) => {
      const tdMatch = row.match(/<td[\s\S]*?<\/td>/i);
      if (!tdMatch) return row;
      const nazivCell = tdMatch[0];
      const lower = nazivCell.toLowerCase();
      const hasBos = lower.includes('(bosanski jezik)');
      const hasHrv = lower.includes('(hrvatski jezik)');

      if (hasHrv && !hasBos) {
        removed++;
        return '';
      }
      if (hasBos && hasHrv) {
        // Trim Naziv cell to only bosanski part (up to and including '(bosanski jezik)')
        const bosRegex = /(\(bosanski jezik\))/i;
        const m = nazivCell.match(bosRegex);
        if (m && typeof m.index === 'number') {
          const end = m.index + m[0].length;
          const trimmedNaziv = nazivCell.slice(0, end);
          return row.replace(nazivCell, trimmedNaziv);
        }
      }
      return row;
    });
    return { html: normalized, removed };
  }

  // strip-phrase: remove the phrase occurrences without dropping whole rows
  // Also remove optional surrounding parentheses and extra spaces
  const phraseRegex = new RegExp(`\\s*\\(?${phrase.replace(/[.*+?^${}()|[\]\\]/g, r => `\\${r}`)}\\)?`, 'gi');
  const filtered = html.replace(phraseRegex, '');
  // clean double spaces introduced by removal
  const cleaned = filtered.replace(/\s{2,}/g, ' ');
  // We count occurrences roughly by comparing lengths
  const removed = (html.match(phraseRegex)?.length) || 0;
  return { html: cleaned, removed };
}

async function main() {
  const phrase = getArg('phrase', '')!;
  const modeArg = (getArg('mode', 'remove-rows') || 'remove-rows') as Mode;
  const target = getArg('target', path.join('tmp', 'fbih_registry_preview.html'))!;
  const aliasTarget = getArg('alias_target', path.join('tmp', 'fbih_single_article_preview.html'))!;
  const urlContains = getArg('url_contains');

  const targets = [target, aliasTarget];
  let totalRemoved = 0;
  for (const t of targets) {
    const fullPath = path.resolve(t);
    if (!fs.existsSync(fullPath)) {
      console.error(`Target not found: ${fullPath}`);
      continue;
    }
    const input = fs.readFileSync(fullPath, 'utf8');
    const { html: out, removed } = processHtml(input, phrase, modeArg, urlContains);
    fs.writeFileSync(fullPath, out, 'utf8');
    const unit = modeArg === 'remove-rows' || modeArg === 'normalize-language' ? 'rows' : 'occurrences';
    const phraseInfo = lowerCaseSafe(phrase) ? `phrase='${phrase}'` : 'phrase=<none>';
    const urlInfo = urlContains ? ` url_contains='${urlContains}'` : '';
    console.log(`Filtered (${phraseInfo}${urlInfo}) with mode='${modeArg}' from ${path.basename(fullPath)}; removed ${unit}: ${removed}`);
    totalRemoved += removed;
  }
  console.log(`Done. Total removed: ${totalRemoved}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

function lowerCaseSafe(s?: string): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  return t.length ? t.toLowerCase() : undefined;
}