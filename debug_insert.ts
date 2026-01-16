import sqlite3 from 'sqlite3'
import path from 'path'

// Adjust path based on where we run it from
const DB_PATH = path.resolve('apps/api/data/regulativa.db')
console.log('Opening DB:', DB_PATH)

const db = new sqlite3.Database(DB_PATH)

// Try to find a valid ID first
db.get('SELECT id FROM laws LIMIT 1', [], (err, row: any) => {
    if (err) {
        console.error('Failed to get any law:', err)
        process.exit(1)
    }
    const validId = row.id
    console.log('Using valid law ID:', validId)

    const SQL = 'INSERT INTO law_groups (jurisdiction, name, base_law_id, created_at, law_count) VALUES (?, ?, ?, datetime("now"), ?)'
    const PARAMS = ['TestJurisdiction', 'TestGroup', validId, 2]

    console.log('Attempting insert with params:', PARAMS)

    db.run(SQL, PARAMS, function (err) {
        if (err) {
            console.error('INSERT FAILED:')
            console.error('Message:', err.message)
            console.error('Code:', (err as any).code)
            console.error('Errno:', (err as any).errno)
        } else {
            console.log('INSERT SUCCESS! ID:', this.lastID)
        }
    })
})
