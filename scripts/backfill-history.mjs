#!/usr/bin/env node
// Rebuild version.json "history" from CHANGELOG.md so Settings > Version history lists EVERY release, not only the ones
// cut with scripts/release.mjs. Existing history entries win (they are never overwritten); missing versions are added.
//   node scripts/backfill-history.mjs
import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const vj = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const have = new Map((vj.history || []).map(h => [h.version, h]));
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; };
let added = 0;
for (const m of log.matchAll(/^## (\d+\.\d+\.\d+) - (\d{4}-\d{2}-\d{2})\s*\n((?:- .*\n?)+)/gm)) {
  if (have.has(m[1])) continue;
  have.set(m[1], { version: m[1], date: m[2], notes: m[3].trim().split('\n').map(l => l.replace(/^- /, '').trim()).filter(Boolean) });
  added++;
}
vj.history = [...have.values()].sort((a, b) => cmp(a.version, b.version));
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify(vj, null, 2) + '\n');
console.log(`History now lists ${vj.history.length} releases (${added} added from CHANGELOG.md).`);
