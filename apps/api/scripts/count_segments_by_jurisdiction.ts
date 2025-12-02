import sqlite3 from 'sqlite3'

const DB_PATH = 'd:/Projekti/Regulativa/apps/api/data/regulativa.db'
const db = new sqlite3.Database(DB_PATH)

db.all(
  `SELECT l.jurisdiction AS j, COUNT(*) AS cnt
   FROM segments s JOIN laws l ON l.id = s.law_id
   GROUP BY l.jurisdiction
   ORDER BY cnt DESC`,
  [],
  (err, rows: any[]) => {
    if (err) {
      console.error(err)
    } else {
      console.log(JSON.stringify(rows, null, 2))
    }
    db.close()
  }
)

