
import path from 'node:path'
import sqlite3 from 'sqlite3'

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')

sqlite3.verbose()

type LawRow = {
    id: number
    jurisdiction: string
    title: string
    gazette_date: string | null
    gazette_key: string | null
    group_id: number | null
}

function stripDiacritics(s: string): string {
    return s
        .replace(/č/g, 'c').replace(/ć/g, 'c').replace(/đ/g, 'dj').replace(/š/g, 's').replace(/ž/g, 'z')
        .replace(/Č/g, 'c').replace(/Ć/g, 'c').replace(/Đ/g, 'dj').replace(/Š/g, 's').replace(/Ž/g, 'z')
}

function cyrToLat(s: string): string {
    const map: Record<string, string> = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'ђ': 'dj', 'е': 'e', 'ж': 'z', 'з': 'z', 'и': 'i', 'ј': 'j', 'к': 'k', 'л': 'l', 'љ': 'lj', 'м': 'm', 'н': 'n', 'њ': 'nj', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'ћ': 'c', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'c', 'џ': 'dz', 'ш': 's',
        'А': 'a', 'Б': 'b', 'В': 'v', 'Г': 'g', 'Д': 'd', 'Ђ': 'dj', 'Е': 'e', 'Ж': 'z', 'З': 'z', 'И': 'i', 'Ј': 'j', 'К': 'k', 'Л': 'l', 'Љ': 'lj', 'М': 'm', 'Н': 'n', 'Њ': 'nj', 'О': 'o', 'П': 'p', 'Р': 'r', 'С': 's', 'Т': 't', 'Ћ': 'c', 'У': 'u', 'Ф': 'f', 'Х': 'h', 'Ц': 'c', 'Ч': 'c', 'Џ': 'dz', 'Ш': 's',
    }
    return s.split('').map((ch) => (map[ch] !== undefined ? map[ch] : ch)).join('')
}

function removeJurisdictionSuffixes(title: string): string {
    let s = title;
    const suffixes = [
        ' u republici srpskoj',
        ' republike srpske',
        ' u federaciji bosne i hercegovine',
        ' federacije bosne i hercegovine',
        ' bosne i hercegovine',
        ' u bosni i hercegovini',
        ' brcko distrikta bih',
        ' u brcko distriktu bih',
        ' crne gore',
        ' u crnoj gori',
        ' brcko distrikta',
        ' rs',
        ' fbih',
        ' bih',
        ' cg'
    ];
    
    // Iterate and remove. Since we normalized to lowercase/latin/no-diacritics before calling this usually?
    // Actually, getRootTitle calls this. Let's assume input is already lowercased and stripped of diacritics/cyrillic for easier matching?
    // Or we should do it on raw string?
    // It is safer to do it on the normalized string in getRootTitle.
    
    for (const suffix of suffixes) {
        if (s.endsWith(suffix)) {
            s = s.substring(0, s.length - suffix.length).trim();
        }
    }
    return s;
}

function getRootTitle(title: string): string {
    let s = String(title || '').toLowerCase().trim()
    s = cyrToLat(s)
    s = stripDiacritics(s)

    // Remove common prefixes for amendments
    // Order matters: longer phrases first
    const prefixes = [
        'zakon o izmjenama i dopunama',
        'zakon o izmjenama',
        'zakon o izmjeni',
        'zakon o dopunama',
        'zakon o dopuni',
        'zakona o izmjenama i dopunama', // sometimes it starts with genitive if extracted weirdly
        'ispravka',
        'odluka o'
    ]

    for (const p of prefixes) {
        if (s.startsWith(p)) {
            s = s.substring(p.length).trim()
        }
    }

    // Remove connecting words "zakona o" or "zakonika o" if they appear at start (after prefix removal)
    if (s.startsWith('zakona o ')) {
        s = s.substring('zakona o '.length).trim()
    } else if (s.startsWith('zakonika o ')) {
        s = s.substring('zakonika o '.length).trim()
    } else if (s.startsWith('zakona ')) {
        s = s.substring('zakona '.length).trim()
    } else if (s.startsWith('zakon o ')) {
        s = s.substring('zakon o '.length).trim()
    } else if (s.startsWith('zakonik o ')) {
        s = s.substring('zakonik o '.length).trim()
    }

    // Remove Jurisdiction Suffixes
    s = removeJurisdictionSuffixes(s);

    // Remove suffix " zakon" or " zakona" if present at the end (after jurisdiction removal)
    // This handles "Porodični zakon" vs "Porodičnog zakona"
    if (s.endsWith(' zakon')) {
        s = s.substring(0, s.length - ' zakon'.length).trim()
    } else if (s.endsWith(' zakona')) {
        s = s.substring(0, s.length - ' zakona'.length).trim()
    } else if (s.endsWith(' zakonik')) {
        s = s.substring(0, s.length - ' zakonik'.length).trim()
    } else if (s.endsWith(' zakonika')) {
        s = s.substring(0, s.length - ' zakonika'.length).trim()
    }

    // Clean up
    s = s.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

    // Aggressive stemming for adjectives at the end of words
    // Split into words, stem last word if it looks like an adjective
    const words = s.split(' ')
    if (words.length > 0) {
        // Only stem the last word if it's long enough to be an adjective with suffix
        const last = words[words.length - 1]
        if (last.length > 4) {
            // Common suffixes: -og, -om, -im, -og, -ih, -ima
            if (last.endsWith('og')) words[words.length - 1] = last.slice(0, -2)
            else if (last.endsWith('om')) words[words.length - 1] = last.slice(0, -2)
            else if (last.endsWith('im')) words[words.length - 1] = last.slice(0, -2)
            else if (last.endsWith('ih')) words[words.length - 1] = last.slice(0, -2)
            // -i (nominative adjective) -> remove to match base
            else if (last.endsWith('i')) words[words.length - 1] = last.slice(0, -1)
            // -a (genitive noun/adjective) -> remove
            else if (last.endsWith('a')) words[words.length - 1] = last.slice(0, -1)
            // -e (plural/female) -> remove
            else if (last.endsWith('e')) words[words.length - 1] = last.slice(0, -1)
            // -u (accusative/locative) -> remove
            else if (last.endsWith('u')) words[words.length - 1] = last.slice(0, -1)
        }
        s = words.join(' ')
    }

    return s
}

function all<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as unknown as T[])))
    })
}

function run(db: sqlite3.Database, sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err)
            else resolve(this)
        })
    })
}

async function main() {
    const args = process.argv.slice(2)
    const DRY_RUN = args.includes('--dry-run')

    console.log(`Connecting to DB at ${DB_PATH}`)
    if (DRY_RUN) console.log('⚡ DRY RUN MODE - No changes will be written')

    const db = new sqlite3.Database(DB_PATH)

    try {
        // Reset groups if not dry run
        if (!DRY_RUN) {
            console.log('Resetting existing groups...')
            await run(db, 'DELETE FROM law_groups')
            await run(db, 'UPDATE laws SET group_id = NULL')
            // Reset sequence
            await run(db, 'DELETE FROM sqlite_sequence WHERE name="law_groups"')
        }

        const laws = await all<LawRow>(
            db,
            `SELECT id, jurisdiction, title, gazette_date, gazette_key FROM laws`
        )
        console.log(`Loaded ${laws.length} laws.`)

        // Grouping logic
        const groups = new Map<string, LawRow[]>()

        for (const law of laws) {
            if (!law.title) continue
            const root = getRootTitle(law.title)
            
            // Debug specific metrology case
            if (law.title.toLowerCase().includes('metrolog')) {
                console.log(`DEBUG: ID ${law.id} | Title: ${law.title} | Root: '${root}'`)
            }

            if (root.length < 3) continue // Skip too short titles (noise)

            const key = `${law.jurisdiction}||${root}`

            if (!groups.has(key)) {
                groups.set(key, [])
            }
            groups.get(key)!.push(law)
        }

        console.log(`Found ${groups.size} potential groups.`)

        let updatedCount = 0
        let createdGroupsCount = 0

        for (const [key, members] of groups.entries()) {
            if (members.length < 2) continue // No grouping needed for singletons

            // Identify base law
            // Heuristic: Base law usually has the shortest title (no "izmjena i dopuna...")
            // If titles are similar length, pick the oldest date
            const sorted = [...members].sort((a, b) => {
                // Check for specific keywords to penalize
                const aIsAmendment = /izmj|dopun|ispravk/.test(stripDiacritics(cyrToLat(a.title.toLowerCase())))
                const bIsAmendment = /izmj|dopun|ispravk/.test(stripDiacritics(cyrToLat(b.title.toLowerCase())))

                if (aIsAmendment && !bIsAmendment) return 1
                if (!aIsAmendment && bIsAmendment) return -1

                // Prefer shorter title
                const lenDiff = a.title.length - b.title.length
                if (Math.abs(lenDiff) > 5) return lenDiff

                // Prefer older date
                if (a.gazette_date && b.gazette_date) {
                    return a.gazette_date.localeCompare(b.gazette_date)
                }
                // Prefer one with date over no date
                if (a.gazette_date && !b.gazette_date) return -1
                if (!a.gazette_date && b.gazette_date) return 1

                return a.id - b.id
            })

            const baseLaw = sorted[0]
            const [jurisdiction, root] = key.split('||')

            // Group Name: Capitalize root or use Base Law Title
            let groupName = baseLaw.title.trim()

            if (DRY_RUN) {
                console.log(`\nGroup: ${groupName} (${jurisdiction})`)
                console.log(`  Base: [${baseLaw.id}] ${baseLaw.title} (${baseLaw.gazette_date || '?'})`)
                for (const m of members) {
                    if (m.id !== baseLaw.id) {
                        console.log(`  - [${m.id}] ${m.title}`)
                    }
                }
            } else {
                // Create group
                try {
                    const res = await run(db,
                        'INSERT INTO law_groups (jurisdiction, name, base_law_id, created_at) VALUES (?, ?, ?, datetime("now"))',
                        [jurisdiction, groupName, baseLaw.id]
                    )
                    const groupId = res.lastID
                    createdGroupsCount++

                    // Update all members
                    for (const m of members) {
                        await run(db, 'UPDATE laws SET group_id = ? WHERE id = ?', [groupId, m.id])
                        updatedCount++
                    }
                } catch (insertError) {
                    console.error(`FAILED INSERT: ${groupName} (Base: ${baseLaw.id})`, insertError)
                }
            }
        }

        if (!DRY_RUN) {
            console.log(`\nDONE. Created ${createdGroupsCount} new groups. Updated ${updatedCount} laws.`)
        }

    } catch (e) {
        console.error('Error:', e)
    } finally {
        db.close()
    }
}

main()
