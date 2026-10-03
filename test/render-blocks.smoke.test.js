// Verifies the ```chart (bar/line/donut) and ```kpi renderers in ai.html and js/ai-embed.js.
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(' ok  ', name); } else { fail++; console.log(' FAIL', name); } };

function load(file, ctxEsc) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const a = src.indexOf('function renderChartBlock(raw)');
  const b = src.indexOf('function renderMarkdown', a);
  const code = src.slice(a, b) + '\nreturn { R: renderChartBlock, K: renderKpiBlock };';
  return new Function('esc', code)(ctxEsc);
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

for (const [file, e] of [['ai.html', (s) => s], ['js/ai-embed.js', (s) => s]]) {
  const { R, K } = load(file, e);
  ok(file + ': bar chart', /ai-chart-bar-fill/.test(R('Top\nA: 5\nB: 3')));
  ok(file + ': line chart', /ai-chart-line/.test(R('type: line\nTrend\nJul: 1\nAug: 3\nSep: 2')));
  ok(file + ': donut chart', /conic-gradient/.test(R('type: donut\nMix\nA: 30\nB: 70')));
  ok(file + ': <2 rows falls through', R('type: line\nonly: 1') === null);
  const k = K('Sales: PKR 1.2M | +12%\nOverdue: 340K | -3%');
  ok(file + ': kpi cards + colour', /ai-kpi-delta up/.test(k) && /ai-kpi-delta down/.test(k));
}
// Whole-message hardening: model output that echoes attacker-controlled Odoo text must not become live HTML.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'ai.html'), 'utf8');
  const a = src.indexOf('function renderChartBlock(raw)');
  const b = src.indexOf('// ══════════ MESSAGES', a);
  const renderers = new Function('esc', 'let aiDashboardArtifactId = 0; const aiDashboardPayloads = Object.create(null);\n' + src.slice(a, b) + '\nreturn { markdown: renderMarkdown, dashboard: renderAIDashboard };')(esc);
  const md = renderers.markdown;
  const out = md('Lead: <img src=x onerror=alert(1)> and [click](javascript:alert(1)) and [ok](https://example.com)\n\n```chart\nA & B\nX: 5\nY: 3\n```');
  ok('ai.html renderMarkdown escapes raw HTML', !/<img/.test(out) && /&lt;img/.test(out));
  ok('ai.html blocks javascript: links, keeps https', !/href="javascript/.test(out) && /href="https:\/\/example.com"/.test(out));
  ok('ai.html chart still renders after escaping', /ai-chart-bar-fill/.test(out) && /A &amp; B/.test(out) && !/&amp;amp;/.test(out));
  const artifact = {
    version: 1, title: 'Sales board', generatedAt: '2026-09-26T00:00:00.000Z',
    source: 'Live Odoo query results', currency: 'PKR',
    methods: ['q1: read-group sale.order'], limitations: ['Returned groups may be incomplete.'],
    metrics: [{ title: 'Amount by partner', measure: 'amount_total:sum', rows: [{ label: '<img src=x onerror=alert(1)>', value: 42, count: 2 }] }]
  };
  const board = renderers.dashboard(artifact, 'Observed data, evidence, trade-offs, and next steps.');
  ok('AI dashboard renders a visual plus a semantic exact-values table and PDF controls',
    /ai-dashboard-bars/.test(board) && /ai-dashboard-table/.test(board) && /Export board-ready PDF/.test(board) && /Print \/ Save as PDF/.test(board));
  ok('AI dashboard escapes Odoo labels and prints source/method/limitations',
    !/<img src=x/.test(board) && /&lt;img/.test(board) && /Live Odoo query results/.test(board) && /read-group sale\.order/.test(board) && /Returned groups may be incomplete/.test(board));
  const untrustedModelBlock = md('```dashboard\n' + JSON.stringify(artifact) + '\n```');
  ok('model-authored dashboard JSON is not promoted to a trusted Odoo artifact', !/ai-dashboard-artifact/.test(untrustedModelBlock) && /<pre><code>/.test(untrustedModelBlock));
  const unverifiedMetricChart = md('```chart\nSales\nA: 90\nB: 40\n```', true);
  ok('live Odoo answers do not promote model-authored chart numbers to visuals', !/ai-chart/.test(unverifiedMetricChart));
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
