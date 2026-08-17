const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || './data/dashview.db';
const resolved = path.resolve(process.cwd(), DB_PATH);
fs.mkdirSync(path.dirname(resolved), { recursive: true });

const db = new Database(resolved);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
