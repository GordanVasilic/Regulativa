import sqlite3 from 'sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'regulativa.db');
const db = new sqlite3.Database(DB_PATH);

function all(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

async function findLaw() {
    try {
        const rows = await all("SELECT id, title, jurisdiction, url_pdf, path_pdf FROM laws WHERE title LIKE '%Porodični zakon%' AND jurisdiction = 'SRB'");
        console.log(JSON.stringify(rows, null, 2));
    } catch (error) {
        console.error('Error:', error);
    } finally {
        db.close();
    }
}

findLaw();
