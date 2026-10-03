require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);
const userColumns = db.pragma('table_info(users)');
if (!userColumns.some(column => column.name === 'token_version')) {
  db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
}
console.log('Migration complete:', process.env.DB_PATH || './data/dashview.db');
