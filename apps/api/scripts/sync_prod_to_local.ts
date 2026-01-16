import Client from 'ssh2-sftp-client';
import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';

dotenv.config();

// Configuration
const CONFIG = {
  host: process.env.ORACLE_HOST || '152.67.109.136',
  username: process.env.ORACLE_USER || 'ubuntu',
  // Try to find a private key in standard locations if not in ENV
  privateKey: process.env.ORACLE_KEY || '', 
  privateKeyPath: process.env.ORACLE_KEY_PATH || path.join(process.env.USERPROFILE || '', '.ssh', 'id_rsa'),
  remoteDbPath: '/var/www/regulativa/apps/api/data/regulativa.db',
  remoteDocsRoot: '/var/www/regulativa/Dokumenti',
  localDbPath: path.resolve(process.cwd(), 'data', 'regulativa.db'),
  localDocsRoot: path.resolve(process.cwd(), '../../Dokumenti')
};

async function main() {
  console.log('🔄 Starting Smart Sync (Oracle -> Local)...');
  
  const sftp = new Client();
  
  // 1. Connect
  try {
    console.log(`🔌 Connecting to ${CONFIG.host}...`);
    
    // Check if key exists
    let privateKey = CONFIG.privateKey;
    if (!privateKey && await fs.pathExists(CONFIG.privateKeyPath)) {
      privateKey = await fs.readFile(CONFIG.privateKeyPath, 'utf8');
    }

    if (!privateKey) {
        console.warn("⚠️  Warning: No SSH Key found in ENV or default path. Authentication might fail if not using agent.");
    }

    await sftp.connect({
      host: CONFIG.host,
      username: CONFIG.username,
      privateKey: privateKey,
      agent: process.env.SSH_AUTH_SOCK // Support for Pageant/SSH Agent
    });
    console.log('✅ Connected.');

    // 2. Download DB
    console.log('📦 Downloading Database...');
    const tempDbPath = CONFIG.localDbPath + '.temp';
    await sftp.fastGet(CONFIG.remoteDbPath, tempDbPath);
    
    // Backup existing
    if (await fs.pathExists(CONFIG.localDbPath)) {
      await fs.copy(CONFIG.localDbPath, CONFIG.localDbPath + '.bak', { overwrite: true });
    }
    
    // Replace
    // Ensure API is not holding the lock? Windows might block this if API is running.
    try {
        await fs.move(tempDbPath, CONFIG.localDbPath, { overwrite: true });
        console.log('✅ Database synced (Backup created at .bak).');
    } catch (e) {
        console.error('❌ Could not overwrite regulativa.db. Is the local API running?');
        console.error('   Manual step: Rename regulativa.db.temp to regulativa.db');
        await sftp.end();
        return;
    }

    // 3. Analyze DB for Files
    console.log('🔍 Analyzing files to sync...');
    const db = new sqlite3.Database(CONFIG.localDbPath);
    const all = (sql: string) => new Promise<any[]>((resolve, reject) => 
      db.all(sql, [], (err, rows) => err ? reject(err) : resolve(rows))
    );

    const rows = await all('SELECT id, title, path_pdf FROM laws WHERE path_pdf IS NOT NULL AND path_pdf != ""');
    db.close();

    console.log(`📄 Found ${rows.length} documents in database.`);

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    // 4. Download missing files
    for (const row of rows) {
      const remotePath = row.path_pdf; // e.g. /var/www/regulativa/Dokumenti/RS/2024/Zakon.pdf
      
      // Check if it's actually in the remote docs root
      if (!remotePath.startsWith(CONFIG.remoteDocsRoot)) {
        // Handle absolute paths that might be legacy or different
        // console.warn(`   Skipping non-standard path: ${remotePath}`);
        continue;
      }

      const relativePath = remotePath.substring(CONFIG.remoteDocsRoot.length); // /RS/2024/Zakon.pdf
      const localPath = path.join(CONFIG.localDocsRoot, relativePath); // D:\...\Dokumenti\RS\2024\Zakon.pdf

      const exists = await fs.pathExists(localPath);
      
      if (exists) {
        // Optional: Check size mismatch? For now, assume immutable PDFs.
        skipped++;
        continue;
      }

      // Download
      try {
        await fs.ensureDir(path.dirname(localPath));
        
        // Check if remote file exists
        const fileExists = await sftp.exists(remotePath);
        if (!fileExists) {
            console.warn(`⚠️  Remote file missing (DB inconsistency): ${remotePath}`);
            errors++;
            continue;
        }

        process.stdout.write(`⬇️  Downloading: ${path.basename(remotePath)}... `);
        await sftp.fastGet(remotePath, localPath);
        process.stdout.write('Done\n');
        synced++;
      } catch (e) {
        console.error(`\n❌ Error downloading ${remotePath}:`, e);
        errors++;
      }
    }

    console.log('\n📊 Sync Summary:');
    console.log(`   ✅ Synced: ${synced}`);
    console.log(`   ⏭️  Skipped: ${skipped} (Already exists)`);
    console.log(`   ❌ Errors: ${errors}`);

  } catch (e) {
    console.error('💥 Critical Error:', e);
  } finally {
    await sftp.end();
    console.log('👋 Connection closed.');
  }
}

main();
