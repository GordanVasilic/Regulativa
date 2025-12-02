import sqlite3 from 'sqlite3'
import path from 'path'

const DB_PATH = 'd:/Projekti/Regulativa/apps/api/data/regulativa.db'
const db = new sqlite3.Database(DB_PATH)

db.all(
  `SELECT l.id, l.title, l.path_pdf
   FROM laws l
   LEFT JOIN segments s ON s.law_id = l.id
   WHERE l.jurisdiction = 'Crna Gora'
   GROUP BY l.id
   HAVING COUNT(s.id) = 0
   ORDER BY l.id ASC`,
  [],
  (err, rows: any[]) => {
    if (err) {
      console.error('Error:', err)
      db.close()
      return
    }
    const result = {
      jurisdiction: 'Crna Gora',
      count_without_segments: rows.length,
      laws: rows,
    }
    console.log(JSON.stringify(result, null, 2))
    db.close()
  }
)

