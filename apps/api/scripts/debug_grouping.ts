import sqlite3 from 'sqlite3'
import path from 'path'

const DB_PATH = path.resolve(process.cwd(), 'data/regulativa.db')
const db = new sqlite3.Database(DB_PATH)

db.all(`SELECT id, title, group_id, jurisdiction, gazette_key FROM laws WHERE title LIKE '%orodi%n%zakon%' AND jurisdiction = 'RS'`, [], (err, rows) => {
    if (err) console.error(err)
    else console.log(JSON.stringify(rows, null, 2))
})
