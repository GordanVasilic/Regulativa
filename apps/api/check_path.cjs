const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/regulativa.db');
db.get("SELECT path_pdf FROM laws WHERE path_pdf IS NOT NULL LIMIT 1", (err, row) => {
    if(err) console.error(err);
    else console.log(row.path_pdf);
});
