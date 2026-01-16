import sqlite3 from 'sqlite3'
import path from 'path'

const DB_PATH = path.resolve(process.cwd(), 'data/regulativa.db')
const db = new sqlite3.Database(DB_PATH)

db.run(`UPDATE laws SET group_id = 1 WHERE id = 245`, [], function (err) {
    if (err) console.error(err)
    else console.log(`Updated ${this.changes} laws.`)
})
