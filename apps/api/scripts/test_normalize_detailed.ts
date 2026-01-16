import sqlite3 from 'sqlite3'
import path from 'path'

const DB_PATH = path.resolve(process.cwd(), 'data/regulativa.db')
const db = new sqlite3.Database(DB_PATH)

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

function getRootTitleDebug(title: string): string {
    console.log(`Original: "${title}"`)
    let s = String(title || '').toLowerCase().trim()
    console.log(`LowerTrim: "${s}"`)

    s = cyrToLat(s)
    s = stripDiacritics(s)
    console.log(`LatStrip: "${s}"`)

    const prefixes = [
        'zakon o izmjenama i dopunama',
        'zakon o izmjenama',
        'zakon o izmjeni',
        'zakon o dopunama',
        'zakon o dopuni',
        'ispravka',
        'odluka o'
    ]

    for (const p of prefixes) {
        if (s.startsWith(p)) {
            s = s.substring(p.length).trim()
            console.log(`Removed prefix "${p}": "${s}"`)
        }
    }

    if (s.startsWith('zakona o ')) {
        s = s.substring('zakona o '.length).trim()
    } else if (s.startsWith('zakonika o ')) {
        s = s.substring('zakonika o '.length).trim()
    } else if (s.startsWith('zakona ')) {
        s = s.substring('zakona '.length).trim()
    }
    console.log(`After connect words: "${s}"`)

    if (s.endsWith(' zakon')) {
        s = s.substring(0, s.length - ' zakon'.length).trim()
        console.log(`Removed suffix " zakon": "${s}"`)
    } else if (s.endsWith(' zakona')) {
        s = s.substring(0, s.length - ' zakona'.length).trim()
        console.log(`Removed suffix " zakona": "${s}"`)
    } else if (s.endsWith(' zakonik')) {
        s = s.substring(0, s.length - ' zakonik'.length).trim()
    } else if (s.endsWith(' zakonika')) {
        s = s.substring(0, s.length - ' zakonika'.length).trim()
    }

    s = s.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    console.log(`Cleaned: "${s}"`)

    const words = s.split(' ')
    if (words.length > 0) {
        const last = words[words.length - 1]
        console.log(`Stemming last word: "${last}"`)
        if (last.length > 4) {
            if (last.endsWith('og')) words[words.length - 1] = last.slice(0, -2)
            else if (last.endsWith('om')) words[words.length - 1] = last.slice(0, -2)
            else if (last.endsWith('im')) words[words.length - 1] = last.slice(0, -2)
            else if (last.endsWith('ih')) words[words.length - 1] = last.slice(0, -2)
            else if (last.endsWith('i')) words[words.length - 1] = last.slice(0, -1)
            // else if (last.endsWith('a')) words[words.length - 1] = last.slice(0, -1) // Removed 'a' check to match group_all_laws? No, wait. 
            // In group_all_laws I added 'a'.
            else if (last.endsWith('a')) words[words.length - 1] = last.slice(0, -1)
            else if (last.endsWith('e')) words[words.length - 1] = last.slice(0, -1)
            else if (last.endsWith('u')) words[words.length - 1] = last.slice(0, -1)
        }
        s = words.join(' ')
    }
    console.log(`Stemmed: "${s}"`)

    return s
}

db.all(`SELECT id, title FROM laws WHERE id IN (245, 991)`, [], (err, rows: any[]) => {
    if (err) return console.error(err)

    rows.forEach(row => {
        console.log(`--- Processing ID ${row.id} ---`)
        getRootTitleDebug(row.title)
        console.log('------------------------------')
    })
})
