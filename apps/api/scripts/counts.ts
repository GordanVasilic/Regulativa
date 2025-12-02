import sqlite3 from 'sqlite3';
import path from 'path';

function getDbPath() {
  const dbRel = process.env.DB_PATH || './data/regulativa.db';
  // Resolve relative to current working directory (apps/api)
  return path.resolve(process.cwd(), dbRel);
}

function runQuery<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

async function main() {
  const dbPath = getDbPath();
  const db = new sqlite3.Database(dbPath);

  try {
    const [{ c: laws }] = await runQuery<{ c: number }>(db, 'SELECT COUNT(*) as c FROM laws');
    const [{ c: segments }] = await runQuery<{ c: number }>(db, 'SELECT COUNT(*) as c FROM segments');
    let documents = 0;
    try {
      const [{ c }] = await runQuery<{ c: number }>(db, 'SELECT COUNT(*) as c FROM documents');
      documents = c;
    } catch (_) {
      documents = 0; // table may not exist in some setups
    }

    const [{ c: lawsWithPdf }] = await runQuery<{ c: number }>(db, "SELECT COUNT(*) as c FROM laws WHERE path_pdf IS NOT NULL AND path_pdf <> ''");

    const byJurisdiction = await runQuery<{ jurisdiction: string; c: number }>(
      db,
      'SELECT jurisdiction, COUNT(*) as c FROM laws GROUP BY jurisdiction ORDER BY jurisdiction'
    );

    const result = {
      dbPath,
      totals: {
        laws,
        segments,
        documents,
        laws_with_pdf: lawsWithPdf,
      },
      breakdown: {
        by_jurisdiction: byJurisdiction,
      },
    };

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error counting records:', err);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();