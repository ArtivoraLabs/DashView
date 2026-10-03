#!/usr/bin/env node
// Cut a new DashView version so users get the "Software Update" prompt.
//   node scripts/release.mjs patch "Fixed X" "Improved Y"      (also: minor | major; add --critical to make the update banner non-dismissible)
// Updates version.json (+history), package.json, sw.js (VERSION + PRECACHE) and CHANGELOG.md.
import fs from 'node:fs'; import path from 'node:path';
const argv = process.argv.slice(2), critical = argv.includes('--critical'), [bump = 'patch', ...notes] = argv.filter(a => a !== '--critical');
if (!['patch', 'minor', 'major'].includes(bump) || !notes.length) { console.error('Usage: node scripts/release.mjs <patch|minor|major> "note" ["note"...]'); process.exit(1); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), rd = f => fs.readFileSync(path.join(root, f), 'utf8'), wr = (f, t) => fs.writeFileSync(path.join(root, f), t);
const v = JSON.parse(rd('version.json')); let [a, b, c] = v.version.split('.').map(Number);
if (bump === 'major') { a++; b = 0; c = 0; } else if (bump === 'minor') { b++; c = 0; } else c++;
const next = `${a}.${b}.${c}`, today = new Date().toISOString().slice(0, 10);
v.version = next; v.build = today.replace(/-/g, '.'); v.released = today; v.notes = notes;
v.history = [{ version: next, date: today, notes }, ...(v.history || [])].slice(0, 30);
wr('version.json', JSON.stringify(v, null, 2) + '\n');
const p = JSON.parse(rd('package.json')); p.version = next; wr('package.json', JSON.stringify(p, null, 2) + '\n');
let sw = rd('sw.js').replace(/var VERSION = '[^']*';/, `var VERSION = 'dv-${next}';`);
const m = sw.match(/var PRECACHE = \[([\s\S]*?)\];/), have = new Set([...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]));
const ls = d => fs.existsSync(path.join(root, d)) ? fs.readdirSync(path.join(root, d)).filter(f => /\.(css|js)$/.test(f)).map(f => `${d}/${f}`) : [];
for (const f of [...fs.readdirSync(root).filter(f => f.endsWith('.html')), 'manifest.json', 'version.json', ...ls('css'), ...ls('js')]) have.add(f);
sw = sw.replace(m[0], `var PRECACHE = [\n${[...have].map(f => ` "${f}"`).join(',\n')}\n];`); wr('sw.js', sw);
const cl = rd('CHANGELOG.md'); wr('CHANGELOG.md', cl.replace('# Changelog\n', `# Changelog\n\n## ${next} - ${today}\n${notes.map(n => `- ${n}`).join('\n')}\n`));
v.critical = critical; v.size = [...have].reduce((n, f) => { try { return n + fs.statSync(path.join(root, f)).size; } catch { return n; } }, 0);
v.history[0].critical = critical; wr('version.json', JSON.stringify(v, null, 2) + '\n');
console.log(`Download size: ${(v.size / 1024).toFixed(0)} KB${critical ? ' (critical update)' : ''}`);
console.log(`Released ${next}. Deploy the files; users will see the Software Update prompt.`);
