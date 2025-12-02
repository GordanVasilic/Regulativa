import sqlite3 from 'sqlite3'

const DB_PATH = 'd:/Projekti/Regulativa/apps/api/data/regulativa.db'
const db = new sqlite3.Database(DB_PATH)

db.all(
  `SELECT id, jurisdiction FROM laws WHERE id IN (5711, 5737, 5803, 5943, 6128)`,
  [],
  (err, rows: any[]) => {
    if (err) console.error(err)
    else console.log(JSON.stringify(rows, null, 2))
    db.close()
  }
)

