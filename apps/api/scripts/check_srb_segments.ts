import sqlite3 from 'sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'regulativa.db');
const db = new sqlite3.Database(DB_PATH);

function get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

async function checkSrbSegments() {
    try {
        const count = await get("SELECT COUNT(id) as count FROM segments WHERE law_id IN (SELECT id FROM laws WHERE jurisdiction = 'SRB')");
        console.log('SRB Segments count:', count?.count);

        const lawsCount = await get("SELECT COUNT(id) as count FROM laws WHERE jurisdiction = 'SRB'");
        console.log('SRB Laws count:', lawsCount?.count);
    } catch (error) {
        console.error('Error checking segments:', error);
    } finally {
        db.close();
    }
}

checkSrbSegments();
