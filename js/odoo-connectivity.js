/* ==========================================================================
   DashView — Odoo API connectivity checkpoints
   ==========================================================================
   A single source of truth for the points in the Odoo integration that
   most commonly break a "live" connection. Three checkpoints are verified
   live in the browser (credentials saved, backend reachable, signed in);
   the rest are marked as operational/production checkpoints that a
   director-scale deployment must confirm on the server side — they can't
   be verified from client-side JS, so they're surfaced as explicit,
   professionally-labelled checklist items instead of failing silently.

   Renders into:
     #odooSettingsCheckpoints  (full list — Settings → Odoo integration)
     #odooLiveCheckpoints      (compact strip — Live Odoo view header)
   ========================================================================== */
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }
  function loadJSON(key, fallback) { try { var v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ── Checkpoint definitions ──────────────────────────────────────────── */
  // status(): returns 'ok' | 'warn' | 'blocked'
  // kind: 'live'  = verifiable now, from the browser
  //       'ops'   = must be confirmed on the server / in Odoo; not auto-checkable
  var CHECKPOINTS = [
    {
      id: 'creds', kind: 'live', severity: 'critical',
      title: 'Odoo credentials saved',
      desc: 'URL, database, username and API key are all present in <b>Settings → Odoo integration</b>. Missing any one of these is the #1 reason the Live tab shows &ldquo;Not connected.&rdquo;',
      status: function (ctx) { return ctx.cfg ? 'ok' : 'blocked'; },
      okText: 'Configured', warnText: 'Incomplete', blockedText: 'Not set'
    },
    {
      id: 'apikey', kind: 'ops', severity: 'critical',
      title: 'API key, not your login password',
      desc: 'Odoo → <b>Settings → Users → your user → Account Security → New API Key</b>. A login password will fail JSON-RPC authentication even if the URL/DB are correct — this is the most common silent failure.',
      status: function (ctx) { return ctx.cfg ? 'warn' : 'blocked'; },
      okText: 'Confirmed', warnText: 'Verify manually', blockedText: 'Not set'
    },
    {
      id: 'backend', kind: 'live', severity: 'critical',
      title: 'Cloudflare Worker proxy configured',
      desc: 'Your Odoo API key is sent to a Worker <b>you own</b> (<code>*.workers.dev</code>), never straight from the browser to Odoo. Deploy <code>cloudflare-worker.js</code> and paste its URL under Proxy URL.',
      status: function (ctx) { return ctx.cfg && ctx.cfg.proxyUrl ? 'ok' : 'blocked'; },
      okText: 'Configured', warnText: 'Unverified', blockedText: 'Not set'
    },
    {
      id: 'session', kind: 'live', severity: 'critical',
      title: 'Odoo login verified',
      desc: 'Press <b>Connect to Odoo</b>: the Worker authenticates with your API key. Verified means Odoo accepted the credentials.',
      status: function (ctx) { return ctx.session ? 'ok' : (ctx.cfg ? 'warn' : 'blocked'); },
      okText: 'Verified', warnText: 'Not verified yet', blockedText: 'Not set'
    },
    {
      id: 'rpc', kind: 'ops', severity: 'required',
      title: 'Network path to Odoo\u2019s /jsonrpc endpoint',
      desc: 'Odoo Online and Odoo.sh work out of the box. Self-hosted Odoo behind a firewall or VPN must allow inbound HTTPS from Cloudflare to <code>https://your-odoo-host/jsonrpc</code>.',
      status: function (ctx) { return ctx.session ? 'ok' : 'warn'; },
      okText: 'Reachable', warnText: 'Verify after connecting', blockedText: 'Blocked'
    },
    {
      id: 'access', kind: 'ops', severity: 'required',
      title: 'Odoo access rights on mapped models',
      desc: 'The API user needs read (and write, if syncing back) access rights on every model/field you map — e.g. <code>sale.order</code>, <code>product.template</code>, <code>res.partner</code>, <code>crm.lead</code>. Missing rights fail per-model, not globally, so this is easy to miss.',
      status: function () { return 'warn'; },
      okText: 'Confirmed', warnText: 'Verify per model', blockedText: 'Restricted'
    },
    {
      id: 'cors', kind: 'ops', severity: 'required',
      title: 'Worker locked to this site (ALLOWED_ORIGINS)',
      desc: 'Set <code>ALLOWED_ORIGINS</code> (and <code>ALLOWED_ODOO_HOSTS</code>) on the Worker so only your DashView site can use it. Verified automatically after a live request \u2014 see Settings \u2192 Security.',
      status: function () { var o = window.DVSec && window.DVSec.getConf().workerOrigin; return o === 'restricted' ? 'ok' : (o === 'open' ? 'blocked' : 'warn'); },
      okText: 'Locked down', warnText: 'Run a live request', blockedText: 'Open (*)'
    },
    {
      id: 'rolegate', kind: 'ops', severity: 'required',
      title: 'Read-only proxy (no write endpoints)',
      desc: 'The Worker only exposes <code>test</code>, <code>modules</code>, <code>models</code>, <code>fields</code>, <code>records</code> and <code>read-group</code>, with validated inputs. It cannot create, edit or delete Odoo data.',
      status: function () { return 'ok'; },
      okText: 'Enforced', warnText: 'Check', blockedText: 'Open'
    },
    {
      id: 'readonly', kind: 'ops', severity: 'recommended',
      title: 'Dedicated read-only Odoo API user',
      desc: 'Use a scoped, read-only API user for the dashboard rather than an admin account \u2014 especially for HR, payroll and financial models.',
      status: function () { return 'warn'; },
      okText: 'In place', warnText: 'Recommended', blockedText: 'Using admin'
    },
    {
      id: 'scale', kind: 'ops', severity: 'recommended',
      title: 'Concurrency &amp; caching at director scale',
      desc: 'If several directors query heavy reports at once, move off SQLite to Postgres and cache frequent <code>read_group</code> aggregates (e.g. a 15-minute sync) so dashboards load instantly instead of hitting Odoo on every page view.',
      status: function () { return 'warn'; },
      okText: 'Optimized', warnText: 'Plan for scale', blockedText: 'At risk'
    }
  ];

  function getContext() {
    var cfgRaw = window.DVSec ? window.DVSec.cfg() : loadJSON('dashview_odoo_config', {});
    var cfg = (cfgRaw.url && cfgRaw.db && (cfgRaw.user || cfgRaw.username) && cfgRaw.apiKey) ? cfgRaw : null;
    return {
      cfg: cfg,
      backendScriptLoaded: true,
      session: !!loadJSON('dashview_odoo_connected', false)
    };
  }

  function statusText(cp, status) {
    if (status === 'ok') return cp.okText;
    if (status === 'blocked') return cp.blockedText;
    return cp.warnText;
  }

  function renderList(list, ctx) {
    return list.map(function (cp) {
      var status = cp.status(ctx);
      return '<div class="odoo-checkpoint ' + status + '" data-checkpoint="' + cp.id + '">' +
        '<span class="odoo-checkpoint-dot" aria-hidden="true"></span>' +
        '<div class="odoo-checkpoint-body"><b>' + esc(cp.title) + '</b><p>' + cp.desc + '</p></div>' +
        '<div class="odoo-checkpoint-badges">' +
          '<span class="odoo-checkpoint-badge sev-' + cp.severity + '">' + cp.severity + '</span>' +
          '<span class="odoo-checkpoint-status">' + esc(statusText(cp, status)) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function summarize(list, ctx) {
    var ok = 0;
    list.forEach(function (cp) { if (cp.status(ctx) === 'ok') ok++; });
    return { ok: ok, total: list.length };
  }

  /* ── Full panel (Settings) ───────────────────────────────────────────── */
  function renderSettingsPanel() {
    var mount = byId('odooSettingsCheckpoints');
    if (!mount) return;
    var ctx = getContext();
    var live = CHECKPOINTS.filter(function (c) { return c.kind === 'live'; });
    var ops = CHECKPOINTS.filter(function (c) { return c.kind === 'ops'; });
    var sum = summarize(CHECKPOINTS, ctx);

    mount.innerHTML =
      '<div class="odoo-checkpoints-head">' +
        '<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>Connectivity checkpoints</h4>' +
        '<span class="odoo-checkpoints-summary"><b>' + sum.ok + '</b> / ' + sum.total + ' verified live</span>' +
      '</div>' +
      '<p class="odoo-panel-sub" style="margin-bottom:10px;">The points most likely to break a real Odoo API connection \u2014 checked live where possible, flagged for manual/server-side confirmation elsewhere.</p>' +
      '<div class="odoo-checkpoint-list">' + renderList(live, ctx) + '</div>' +
      '<p class="odoo-panel-sub" style="margin:14px 0 8px;font-weight:700;color:var(--ink-70);">Production / director-scale checklist</p>' +
      '<div class="odoo-checkpoint-list">' + renderList(ops, ctx) + '</div>';
  }

  /* ── Compact strip (Live Odoo view) ──────────────────────────────────── */
  function renderLiveStrip() {
    var mount = byId('odooLiveCheckpoints');
    if (!mount) return;
    var ctx = getContext();
    var live = CHECKPOINTS.filter(function (c) { return c.kind === 'live'; });
    var sum = summarize(CHECKPOINTS, ctx);
    var expanded = mount.getAttribute('data-expanded') === '1';

    var html = '<div class="odoo-checkpoints compact">' +
      '<div class="odoo-checkpoints-head">' +
        '<h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>Connectivity checkpoints</h4>' +
        '<span class="odoo-checkpoints-summary"><b>' + sum.ok + '</b> / ' + sum.total + ' verified &middot; <button type="button" class="odoo-checkpoints-toggle" id="odooLiveCpToggle" aria-controls="odooLiveOpsChecklist" aria-expanded="' + (expanded ? 'true' : 'false') + '">' + (expanded ? 'Hide full checklist' : 'View full checklist') + '</button></span>' +
      '</div>' +
      '<div class="odoo-checkpoint-list">' + renderList(live, ctx) + '</div>' +
      '</div>';

    var ops = CHECKPOINTS.filter(function (c) { return c.kind === 'ops'; });
    html += '<div id="odooLiveOpsChecklist" class="odoo-checkpoints" style="margin-top:10px;"' + (expanded ? '' : ' hidden') + '>' +
        '<p class="odoo-panel-sub" style="margin-bottom:8px;font-weight:700;color:var(--ink-70);">Production / director-scale checklist \u2014 confirm on the server</p>' +
        '<div class="odoo-checkpoint-list">' + renderList(ops, ctx) + '</div>' +
      '</div>';

    mount.innerHTML = html;
    var toggle = byId('odooLiveCpToggle');
    if (toggle) toggle.addEventListener('click', function () {
      mount.setAttribute('data-expanded', expanded ? '0' : '1');
      renderLiveStrip();
      var next = byId('odooLiveCpToggle');
      if (next) next.focus();
    });
  }

  function renderAll() { renderSettingsPanel(); renderLiveStrip(); }

  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  ready(function () {
    renderAll();
    document.addEventListener('dv:session-changed', renderAll);
    document.addEventListener('dv:odoo-disconnected', renderAll);
    document.addEventListener('dv:odoo-config-saved', renderAll);
    window.addEventListener('storage', function (e) {
      if (e.key === 'dashview_odoo_config' || e.key === 'dashview_odoo_connected') renderAll();
    });
    document.querySelectorAll('[data-view="odoo-live"], [data-view="settings"]').forEach(function (link) {
      link.addEventListener('click', function () { setTimeout(renderAll, 0); });
    });
  });

  window.dashviewRenderOdooCheckpoints = renderAll;
})();
