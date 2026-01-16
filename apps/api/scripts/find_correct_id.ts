import sqlite3 from 'sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = path.resolve(process.cwd(), 'data/regulativa.db')
const db = new sqlite3.Database(DB_PATH)

db.all(`SELECT id, title, gazette_key, jurisdiction FROM laws WHERE jurisdiction='RS' AND gazette_key LIKE '%27_24%'`, [], (err, rows) => {
    if (err) console.error(err)
    else {
        fs.writeFileSync('found_id.txt', JSON.stringify(rows, null, 2))
    }
})
