#!/usr/bin/env node
/* Odoo connectivity + coverage check (read-only).
   Usage:
     ODOO_URL=https://xyz.odoo.com ODOO_DB=xyz ODOO_USER=you@mail.com ODOO_KEY=api-key node scripts/odoo-check.mjs
   Optional: WORKER_URL=https://dashview-proxy.you.workers.dev  → also tests the Cloudflare Worker path the dashboard uses. */
const { ODOO_URL, ODOO_DB, ODOO_USER, ODOO_KEY, WORKER_URL } = process.env;
if (!ODOO_URL || !ODOO_DB || !ODOO_USER || !ODOO_KEY) {
  console.error('Set ODOO_URL, ODOO_DB, ODOO_USER, ODOO_KEY (and optionally WORKER_URL).'); process.exit(2);
}
const base = ODOO_URL.replace(/\/+$/, '').replace(/\/(odoo|web)(\/.*)?$/, '');
const AREAS = [['Sales','sale.order'],['CRM','crm.lead'],['Invoicing','account.move'],['Purchase','purchase.order'],
  ['Inventory transfers','stock.picking'],['Stock levels','stock.quant'],['Contacts','res.partner'],['Products','product.template'],
  ['HR','hr.employee'],['Projects/Tasks','project.task'],['Expenses','hr.expense']];
const ms = (t) => Math.round(performance.now() - t) + ' ms';
async function rpc(service, method, args) {
  const r = await fetch(base + '/jsonrpc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: 1, params: { service, method, args } }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  if (d.error) throw new Error(d.error.data?.message || d.error.message);
  return d.result;
}
let bad = 0;
const line = (ok, msg) => { if (!ok) bad++; console.log((ok ? '  OK   ' : '  FAIL ') + msg); };

console.log('1) Odoo server ' + base);
let t = performance.now(), uid;
try { const v = await rpc('common', 'version', []); line(true, 'reachable, version ' + v.server_version + ' (' + ms(t) + ')'); }
catch (e) { line(false, 'cannot reach /jsonrpc: ' + e.message); process.exit(1); }
t = performance.now();
try { uid = await rpc('common', 'authenticate', [ODOO_DB, ODOO_USER, ODOO_KEY, {}]); line(!!uid, uid ? 'login ok, uid ' + uid + ' (' + ms(t) + ')' : 'login refused — wrong DB name (Odoo Online: the subdomain), username or API key'); }
catch (e) { line(false, 'login error: ' + e.message); }

if (uid) {
  console.log('2) Data access for this API user');
  for (const [label, model] of AREAS) {
    t = performance.now();
    try { const n = await rpc('object', 'execute_kw', [ODOO_DB, uid, ODOO_KEY, model, 'search_count', [[]]]); line(true, label.padEnd(20) + n + ' records (' + ms(t) + ')'); }
    catch (e) { line(false, label.padEnd(20) + (/access/i.test(e.message) ? 'no access rights' : 'module not installed / error') + ' — ' + e.message.split('\n')[0].slice(0, 90)); }
  }
}
if (WORKER_URL) {
  console.log('3) Cloudflare Worker ' + WORKER_URL);
  t = performance.now();
  try {
    const r = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'test', url: base, db: ODOO_DB, username: ODOO_USER, apiKey: ODOO_KEY }) });
    const d = await r.json();
    line(!!d.ok, d.ok ? 'Worker → Odoo ok (' + ms(t) + ')' : 'Worker error: ' + d.error + ' [HTTP ' + r.status + ']');
  } catch (e) { line(false, 'Worker unreachable: ' + e.message); }
}
console.log(bad ? `\n${bad} problem(s) found.` : '\nAll checks passed.');
process.exit(bad ? 1 : 0);
