
import sqlite3 from 'sqlite3';

export class GroupingService {
    
    // --- Helper Functions (Pure Logic) ---

    stripDiacritics(s: string): string {
        return s
            .replace(/č/g, 'c').replace(/ć/g, 'c').replace(/đ/g, 'dj').replace(/š/g, 's').replace(/ž/g, 'z')
            .replace(/Č/g, 'c').replace(/Ć/g, 'c').replace(/Đ/g, 'dj').replace(/Š/g, 's').replace(/Ž/g, 'z');
    }

    cyrToLat(s: string): string {
        const map: Record<string, string> = {
            'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'ђ': 'dj', 'е': 'e', 'ж': 'z', 'з': 'z', 'и': 'i', 'ј': 'j', 'к': 'k', 'л': 'l', 'љ': 'lj', 'м': 'm', 'н': 'n', 'њ': 'nj', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'ћ': 'c', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'c', 'џ': 'dz', 'ш': 's',
            'А': 'a', 'Б': 'b', 'В': 'v', 'Г': 'g', 'Д': 'd', 'Ђ': 'dj', 'Е': 'e', 'Ж': 'z', 'З': 'z', 'И': 'i', 'Ј': 'j', 'К': 'k', 'Л': 'l', 'Љ': 'lj', 'М': 'm', 'Н': 'n', 'Њ': 'nj', 'О': 'o', 'П': 'p', 'Р': 'r', 'С': 's', 'Т': 't', 'Ћ': 'c', 'У': 'u', 'Ф': 'f', 'Х': 'h', 'Ц': 'c', 'Ч': 'c', 'Џ': 'dz', 'Ш': 's',
        };
        return s.split('').map((ch) => (map[ch] !== undefined ? map[ch] : ch)).join('');
    }

    removeJurisdictionSuffixes(title: string): string {
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
        
        for (const suffix of suffixes) {
            if (s.endsWith(suffix)) {
                s = s.substring(0, s.length - suffix.length).trim();
            }
        }
        return s;
    }

    getRootTitle(title: string): string {
        let s = String(title || '').toLowerCase().trim();
        s = this.cyrToLat(s);
        s = this.stripDiacritics(s);

        const prefixes = [
            'zakon o izmjenama i dopunama',
            'zakon o izmjeni i dopunama',
            'zakon o izmjenama i dopuni',
            'zakon o izmjeni i dopuni',
            'zakon o izmjenama',
            'zakon o izmjeni',
            'zakon o dopunama',
            'zakon o dopuni',
            'zakona o izmjenama i dopunama',
            'ispravka',
            'odluka o'
        ];

        let changed = true;
        while (changed) {
            changed = false;
            for (const p of prefixes) {
                if (s.startsWith(p)) {
                    s = s.substring(p.length).trim();
                    changed = true;
                    // Restart loop to prioritize longer prefixes again or find next prefix
                    break; 
                }
            }
        }

        if (s.startsWith('zakona o ')) {
            s = s.substring('zakona o '.length).trim();
        } else if (s.startsWith('zakonika o ')) {
            s = s.substring('zakonika o '.length).trim();
        } else if (s.startsWith('zakona ')) {
            s = s.substring('zakona '.length).trim();
        } else if (s.startsWith('zakon o ')) {
            s = s.substring('zakon o '.length).trim();
        } else if (s.startsWith('zakonik o ')) {
            s = s.substring('zakonik o '.length).trim();
        }

        s = this.removeJurisdictionSuffixes(s);

        if (s.endsWith(' zakon')) {
            s = s.substring(0, s.length - ' zakon'.length).trim();
        } else if (s.endsWith(' zakona')) {
            s = s.substring(0, s.length - ' zakona'.length).trim();
        } else if (s.endsWith(' zakonik')) {
            s = s.substring(0, s.length - ' zakonik'.length).trim();
        } else if (s.endsWith(' zakonika')) {
            s = s.substring(0, s.length - ' zakonika'.length).trim();
        }

        s = s.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

        const words = s.split(' ');
        if (words.length > 0) {
            const last = words[words.length - 1];
            if (last.length > 4) {
                if (last.endsWith('og')) words[words.length - 1] = last.slice(0, -2);
                else if (last.endsWith('om')) words[words.length - 1] = last.slice(0, -2);
                else if (last.endsWith('im')) words[words.length - 1] = last.slice(0, -2);
                else if (last.endsWith('ih')) words[words.length - 1] = last.slice(0, -2);
                else if (last.endsWith('i')) words[words.length - 1] = last.slice(0, -1);
                else if (last.endsWith('a')) words[words.length - 1] = last.slice(0, -1);
                else if (last.endsWith('e')) words[words.length - 1] = last.slice(0, -1);
                else if (last.endsWith('u')) words[words.length - 1] = last.slice(0, -1);
            }
            s = words.join(' ');
        }

        return s;
    }

    // --- Write Operations ---

    async handleNewLaw(db: sqlite3.Database, lawId: number, title: string, jurisdiction: string): Promise<void> {
        const root = this.getRootTitle(title);
        if (root.length < 3) return;

        console.log(`[Grouping] Handling new law ${lawId}: "${title}" (Root: "${root}")`);

        // 1. Try to find an existing group
        const existingGroups = await new Promise<any[]>((resolve, reject) => {
            db.all(
                `SELECT id, name FROM law_groups WHERE jurisdiction = ?`,
                [jurisdiction],
                (err, rows) => err ? reject(err) : resolve(rows as any[])
            );
        });

        let bestGroup: any = null;
        for (const group of existingGroups) {
            const groupRoot = this.getRootTitle(group.name);
            if (groupRoot === root) {
                bestGroup = group;
                break;
            }
        }

        if (bestGroup) {
            console.log(`[Grouping] Found existing group ${bestGroup.id} ("${bestGroup.name}")`);
            await new Promise<void>((resolve, reject) => {
                db.run('UPDATE laws SET group_id = ? WHERE id = ?', [bestGroup.id, lawId], (err) => err ? reject(err) : resolve());
            });
            return;
        }

        // 2. If no group, look for ungrouped laws with same root
        // We can't do fuzzy match in SQL easily, so we might need to fetch candidate titles
        // Optimization: Fetch laws with similar title start or just search by simple LIKE
        // Because getRootTitle removes prefixes, the law title usually contains the root.
        
        // Let's try to match laws that "look like" they belong together.
        // A simple approach is to fetch laws that contain the root string (if it's long enough)
        // or just fetch all ungrouped laws for jurisdiction (might be slow if many)
        
        // Better: Search for laws where title contains the most significant part of root?
        // For now, let's just fetch laws that share some tokens?
        // Or simpler: Just fetch all ungrouped laws from same jurisdiction and filter in JS (ok for <10k laws maybe?)
        
        const candidates = await new Promise<any[]>((resolve, reject) => {
            db.all(
                `SELECT id, title FROM laws WHERE jurisdiction = ? AND group_id IS NULL AND id != ?`,
                [jurisdiction, lawId],
                (err, rows) => err ? reject(err) : resolve(rows as any[])
            );
        });

        const matches: any[] = [];
        for (const cand of candidates) {
            const candRoot = this.getRootTitle(cand.title);
            if (candRoot === root) {
                matches.push(cand);
            }
        }

        if (matches.length > 0) {
            console.log(`[Grouping] Found ${matches.length} matching ungrouped laws. Creating new group.`);
            
            // Create new group
            // We use the title of the "base" law (usually the oldest or the one without "izmjenama")
            // But here we can just use the root or the shortest title?
            // Let's try to find a "clean" title among matches + current law
            const allLaws = [...matches, { id: lawId, title }];
            
            // Heuristic: shortest title is usually the main law name
            allLaws.sort((a, b) => a.title.length - b.title.length);
            const groupName = allLaws[0].title; // Use shortest title as group name
            const baseLawId = allLaws[0].id;

            const groupId = await new Promise<number>((resolve, reject) => {
                db.run(
                    `INSERT INTO law_groups (jurisdiction, name, base_law_id) VALUES (?, ?, ?)`,
                    [jurisdiction, groupName, baseLawId],
                    function(this: any, err: Error | null) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    }
                );
            });

            // Update all laws
            const ids = allLaws.map(l => l.id);
            const placeholders = ids.map(() => '?').join(',');
            await new Promise<void>((resolve, reject) => {
                db.run(
                    `UPDATE laws SET group_id = ? WHERE id IN (${placeholders})`,
                    [groupId, ...ids],
                    (err) => err ? reject(err) : resolve()
                );
            });
            console.log(`[Grouping] Created group ${groupId} and assigned ${ids.length} laws.`);
        }
    }

    // --- Database Interactions ---

    async suggestGroup(db: sqlite3.Database, title: string, jurisdiction: string): Promise<any[]> {
        const root = this.getRootTitle(title);
        if (root.length < 3) return [];

        return new Promise((resolve, reject) => {
            // 1. First check existing groups in same jurisdiction
            // We fetch ALL groups for jurisdiction and filter in JS because SQLite fuzzy matching on normalized roots is hard without stored roots
            db.all(
                `SELECT id, name, jurisdiction FROM law_groups WHERE jurisdiction = ?`, 
                [jurisdiction], 
                (err, rows: any[]) => {
                    if (err) return reject(err);
                    
                    const candidates: any[] = [];
                    
                    for (const group of rows) {
                        const groupRoot = this.getRootTitle(group.name);
                        // Exact match of roots or one contains another
                        if (groupRoot === root || (groupRoot.length > 4 && root.includes(groupRoot)) || (root.length > 4 && groupRoot.includes(root))) {
                            candidates.push({ ...group, score: 100, reason: 'group_match' });
                        }
                    }

                    // 2. If no group found, check for similar laws that might NOT be grouped yet (optional, maybe V2)
                    // For now, let's just return group matches
                    
                    // Sort by exactness
                    candidates.sort((a, b) => {
                        const aRoot = this.getRootTitle(a.name);
                        const bRoot = this.getRootTitle(b.name);
                        const aExact = aRoot === root;
                        const bExact = bRoot === root;
                        if (aExact && !bExact) return -1;
                        if (!aExact && bExact) return 1;
                        return 0;
                    });

                    // Enrich candidates with laws
                    const promises = candidates.slice(0, 5).map(async (group) => {
                        const countRes = await new Promise<any>((res, rej) => {
                            db.get('SELECT COUNT(*) as cnt FROM laws WHERE group_id = ?', [group.id], (err, row) => err ? rej(err) : res(row));
                        });
                        group.law_count = countRes?.cnt || 0;
                        
                        group.laws = await new Promise<any[]>((res, rej) => {
                            db.all(
                                'SELECT id, title, gazette_key, gazette_date FROM laws WHERE group_id = ? ORDER BY gazette_date DESC, id DESC', 
                                [group.id], 
                                (err, rows) => err ? rej(err) : res(rows)
                            );
                        });
                        return group;
                    });

                    Promise.all(promises).then(resolve).catch(reject);
                }
            );
        });
    }
}

export const groupingService = new GroupingService();
