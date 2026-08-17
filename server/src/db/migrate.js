require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);
console.log('Migration complete:', process.env.DB_PATH || './data/dashview.db');
