/* ==========================================================================
   DashView — Odoo client (window.DVOdooClient) + formatters (window.DVFmt)
   One place that knows how to talk to the Worker proxy, so Overview, Odoo
   Live and the Audit log all read the same credentials and fail the same way.
   ========================================================================== */
(function () {
  'use strict';

  var memo = {};
  var MSG = {
    none: 'Odoo is not connected yet. Add your URL, database, username, API key and Worker URL in Settings → Odoo.',
    noproxy: 'Worker URL is missing. Deploy cloudflare-worker.js and paste its URL in Settings → Odoo → Proxy URL.',
    locked: 'Workspace is locked. Unlock it to use your saved Odoo credentials.'
  };

  function cfg() {
    var c;
    if (window.DVSec) c = window.DVSec.cfg();
    else { try { c = JSON.parse(localStorage.getItem('dashview_odoo_config')) || {}; } catch (e) { c = {}; } }
    return { url: c.url, db: c.db, username: c.username || c.user, apiKey: c.apiKey, proxyUrl: c.proxyUrl || '' };
  }
  function state() {
    var c = cfg();
    if (window.DVSec && window.DVSec.isLocked()) return 'locked';
    if (!c.url || !c.db || !c.username) return 'none';
    if (!c.apiKey) return (window.DVSec && window.DVSec.hasPasscode()) ? 'locked' : 'none';
    if (!c.proxyUrl) return 'noproxy';
    return 'ok';
  }

  function noteCors(r) {
    try {
      var a = r.headers.get('access-control-allow-origin');
      if (!a || !window.DVSec) return;
      var v = a === '*' ? 'open' : 'restricted';
      if (window.DVSec.getConf().workerOrigin !== v) window.DVSec.setConf({ workerOrigin: v });
    } catch (e) {}
  }

  /* ── Concurrency throttle ────────────────────────────────────────────────────
     Overview + Odoo Live fire many parallel requests.  Odoo returns HTTP 429
     ("Rate limit exceeded") when too many arrive at once.  We cap in-flight
     Worker calls at MAX_CONCURRENT so Odoo never sees a burst. */
  var MAX_CONCURRENT = 3, _inFlight = 0, _queue = [];
  function _flush() {
    while (_inFlight < MAX_CONCURRENT && _queue.length) {
      var job = _queue.shift();
      _inFlight++;
      job.run().then(function (r) { _inFlight--; _flush(); job.resolve(r); },
                     function (e) { _inFlight--; _flush(); job.reject(e); });
    }
  }

  function _rawFetch(proxyUrl, body, t0) {
    return fetch(String(proxyUrl).replace(/\/+$/, ''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {
        noteCors(r);
        return r.text().then(function (t) {
          var d = null; try { d = JSON.parse(t); } catch (e) {}
          if (!d) throw new Error('Worker returned HTTP ' + r.status + ' (not JSON). Check the Worker URL in Settings.');
          if (!d.ok) throw new Error(d.error || 'Odoo request failed');
          api.lastLatency = Date.now() - t0;
          return d;
        });
      }, function () { throw new Error('Cannot reach the Worker. Check the Worker URL, your connection and ALLOWED_ORIGINS.'); });
  }

  /* -- Fast repeat reads ------------------------------------------------------
     Identical read-only requests that are already on the way share one answer, and a finished answer is reused for
     READ_TTL ms. Re-opening a drill, switching tabs back and forth, or several widgets asking the same thing now
     cost nothing. Any Refresh control (or api.reset / api.invalidate) clears it, so a manual refresh is always fresh. */
  var READ_TTL = 20000, READ_OPS = { records: 1, 'read-group': 1, fields: 1, companies: 1, modules: 1 }, _reads = {};
  function _clearReads() { _reads = {}; }
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[id*="efresh"],[class*="efresh"],[data-refresh],[aria-label*="efresh"]');
    if (t) _clearReads();
  }, true);

  function call(endpoint, extra) {
    if (READ_OPS[endpoint] && !(extra && extra.fresh)) {
      var key = endpoint + '|' + JSON.stringify(extra || {}) + '|' + (activeIds().join(',')), hit = _reads[key];
      if (hit && Date.now() - hit.at < READ_TTL) return hit.p;
      var p = _call(endpoint, extra);
      _reads[key] = { at: Date.now(), p: p };
      p.catch(function () { if (_reads[key] && _reads[key].p === p) delete _reads[key]; });
      return p;
    }
    if (extra && extra.fresh) { extra = Object.assign({}, extra); delete extra.fresh; }
    return _call(endpoint, extra);
  }

  function _call(endpoint, extra) {
    var s = state();
    if (s !== 'ok') { var err = new Error(MSG[s]); err.code = s; return Promise.reject(err); }
    var c = cfg(), t0 = Date.now();
    var body = Object.assign({}, extra || {}, { url: c.url, db: c.db, username: c.username, apiKey: c.apiKey, endpoint: endpoint });
    /* Multi-company: data calls carry the selected companies (explicit extra.companyIds wins, e.g. per-company comparison). */
    if (SCOPED[endpoint]) { var cids = (extra && extra.companyIds) || activeIds(); if (cids.length) body.companyIds = cids; else delete body.companyIds; }
    return new Promise(function (resolve, reject) {
      _queue.push({ resolve: resolve, reject: reject, run: function () { return _rawFetch(c.proxyUrl, body, t0); } });
      _flush();
    });
  }

  /* -- Company scope -------------------------------------------------------
     Odoo returns only the API user's default company unless allowed_company_ids is sent, so a
     multi-company database would silently show one company.  The scope is the set of companies the
     dashboard reads: empty selection = every company this user may access.  Shared by all views. */
  var SCOPED = { records: 1, 'read-group': 1 }, SCOPE_KEY = 'dashview_company_scope', companyList = null;
  var scopeSel = (function () { try { var v = JSON.parse(localStorage.getItem(SCOPE_KEY)); return Array.isArray(v) ? v.filter(Number.isInteger) : []; } catch (e) { return []; } })();
  function activeIds() {
    if (!companyList || companyList.length < 2) return [];                 /* single company: nothing to scope */
    var known = companyList.map(function (c) { return c.id; });
    var sel = scopeSel.filter(function (i) { return known.indexOf(i) > -1; });
    return sel.length ? sel : known;
  }

  function cached(key, fn) { if (!memo[key]) memo[key] = fn().catch(function (e) { delete memo[key]; throw e; }); return memo[key]; }

  var api = {
    state: state, cfg: cfg, call: call, lastLatency: null,
    message: function (s) { return MSG[s || state()] || ''; },
    reset: function () { memo = {}; companyList = null; _queue = []; _inFlight = 0; _reads = {}; },
    invalidate: function () { _reads = {}; },
    test: function () { return call('test'); },
    modules: function () { return cached('modules', function () { return call('modules').then(function (d) { return d.modules || []; }); }); },
    fields: function (model) { return cached('f:' + model, function () { return call('fields', { model: model }).then(function (d) { return d.fields || {}; }); }); },
    records: function (model, opts) { return call('records', Object.assign({ model: model }, opts || {})); },
    readGroup: function (model, opts) { return call('read-group', Object.assign({ model: model }, opts || {})).then(function (d) { return d.groups || []; }); },
    count: function (model, domain) { return api.records(model, { domain: domain || [], fields: ['id'], limit: 1 }).then(function (r) { return r.total || 0; }); },
    /* Aggregate a single measure over a domain → { sum, count } */
    sum: function (model, domain, field, companyIds) {
      return api.readGroup(model, Object.assign({ domain: domain || [], fields: field ? [field + ':sum'] : [], groupby: [] }, companyIds ? { companyIds: companyIds } : {}))
        .then(function (g) { g = g[0] || {}; return { sum: field ? (Number(g[field]) || 0) : 0, count: g.__count || 0 }; });
    },
    /* Companies this user can read: [{id,name,currency,parent,color}], cached. */
    companies: function () {
      return cached('companies', function () {
        return call('companies').then(function (d) {
          companyList = (d.companies || []).map(function (c, i) {
            return { id: c.id, name: c.name, currency: Array.isArray(c.currency_id) ? String(c.currency_id[1]).trim().slice(0, 3).toUpperCase() : null, parent: Array.isArray(c.parent_id) ? c.parent_id[0] : null, idx: i };
          });
          return companyList;
        });
      });
    },
    companyList: function () { return companyList || []; },
    /* Selected company ids ([] = all / single company). */
    selectedCompanies: function () { return scopeSel.slice(); },
    activeCompanyIds: activeIds,
    setCompanies: function (ids) {
      scopeSel = (ids || []).filter(Number.isInteger);
      try { localStorage.setItem(SCOPE_KEY, JSON.stringify(scopeSel)); } catch (e) {}
      document.dispatchEvent(new CustomEvent('dv:company-scope', { detail: { ids: activeIds() } }));
    },
    /* One stable colour per company (same everywhere: chips, bars, lines, table dots). */
    companyColor: function (id) {
      var i = -1; (companyList || []).some(function (c, k) { if (c.id === id) { i = k; return true; } return false; });
      return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
    },
    /* Company currency code (e.g. "USD"), or null. Null is never cached. */
    currency: function () {
      if (memo.cur) return memo.cur;
      memo.cur = api.records('res.company', { fields: ['currency_id'], limit: 1 })
        .then(function (r) { var v = r.rows && r.rows[0] && r.rows[0].currency_id; return Array.isArray(v) ? String(v[1]).trim().slice(0, 3).toUpperCase() : null; })
        .catch(function () { return null; })
        .then(function (v) { if (!v) delete memo.cur; return v; });
      return memo.cur;
    }
  };
  window.DVOdooClient = api;

  /* -- Formatters ---------------------------------------------------------- */
  var cur = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n, d) { return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: d == null ? 0 : d }); }
  function money(n, compact) {
    n = Number(n) || 0;
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'USD', notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(n);
    } catch (e) { return num(n); }
  }
  function stripHtml(h) {
    if (!h) return '';
    try { return (new DOMParser().parseFromString(String(h), 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim(); }
    catch (e) { return String(h).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
  }
  function when(s) {
    if (!s) return '–';
    var d = new Date(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
    if (isNaN(d)) return String(s);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function isoDaysAgo(n) { var d = new Date(Date.now() - n * 864e5); return d.toISOString().slice(0, 19).replace('T', ' '); }
  function csv(rows) {
    return rows.map(function (r) { return r.map(function (c) {
      var v = String(c == null ? '' : c);
      v = safeSpreadsheetValue(v);
      return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(','); }).join('\r\n');
  }
  function safeSpreadsheetValue(value) {
    if (typeof value === 'number') return value;
    var v = String(value == null ? '' : value);
    var negativeNumber = /^\s*-\d+(?:\.\d*)?(?:[eE][+-]?\d+)?\s*$/.test(v) ||
      /^\s*-\.\d+(?:[eE][+-]?\d+)?\s*$/.test(v);
    if (/^\s*[=+@\t\r]/.test(v) || (/^\s*-/.test(v) && !negativeNumber)) return "'" + v;
    return v;
  }
  function download(name, text) {
    var url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 800);
  }
  /* Categorical palette: brand amber first, then well-separated hues. Red and green are deliberately
     absent: they are reserved for bad/good so a category colour can never read as a verdict. */
  var PAL_DARK = ['#f2b04a', '#5b9cf5', '#a78bfa', '#2dd4bf', '#f472b6', '#38bdf8', '#fb923c', '#818cf8', '#c8d36a', '#94a3b8'];
  var PAL_LIGHT = ['#c2710c', '#2563eb', '#7c3aed', '#0d9488', '#db2777', '#0284c7', '#ea580c', '#4f46e5', '#65a30d', '#64748b'];

  /* ---- Chart colour schemes: scheme x theme (light/dark) x accent -------------------------------
     Settings > Appearance > Chart colours picks the scheme. 'auto' is the original palette, led by the
     active accent. Every scheme has a separate dark and light tone set so it stays readable on both. */
  var SCHEMES = {
    auto:   { label: 'Theme matched', note: 'Follows your accent and theme', dark: PAL_DARK, light: PAL_LIGHT },
    vivid:  { label: 'Vivid', note: 'High-energy, strong separation',
              dark:  ['#ffb020', '#3b82f6', '#a855f7', '#10b981', '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#84cc16', '#94a3b8'],
              light: ['#c27803', '#1d4ed8', '#7e22ce', '#047857', '#be185d', '#0e7490', '#c2410c', '#4338ca', '#4d7c0f', '#64748b'] },
    ocean:  { label: 'Ocean', note: 'Cool blues and teals',
              dark:  ['#38bdf8', '#22d3ee', '#2dd4bf', '#60a5fa', '#818cf8', '#a5b4fc', '#67e8f9', '#5eead4', '#93c5fd', '#94a3b8'],
              light: ['#0369a1', '#0e7490', '#0f766e', '#1d4ed8', '#4338ca', '#6366f1', '#0891b2', '#0d9488', '#2563eb', '#64748b'] },
    sunset: { label: 'Sunset', note: 'Warm ambers, corals, magentas',
              dark:  ['#fbbf24', '#fb923c', '#f87171', '#f472b6', '#e879f9', '#fcd34d', '#fdba74', '#fca5a5', '#c084fc', '#a8a29e'],
              light: ['#b45309', '#c2410c', '#b91c1c', '#be185d', '#a21caf', '#a16207', '#9a3412', '#dc2626', '#7e22ce', '#78716c'] },
    forest: { label: 'Forest', note: 'Greens, lime and earth tones',
              dark:  ['#4ade80', '#a3e635', '#2dd4bf', '#facc15', '#86efac', '#fdba74', '#67e8f9', '#bef264', '#d6d3d1', '#94a3b8'],
              light: ['#15803d', '#4d7c0f', '#0f766e', '#a16207', '#166534', '#9a3412', '#0e7490', '#3f6212', '#78716c', '#64748b'] },
    access: { label: 'Colour-blind safe', note: 'Okabe-Ito set, distinguishable for most colour-vision types',
              dark:  ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#4c8fe0', '#e8743b', '#cc79a7', '#b8b8b8', '#7fd1c1', '#94a3b8'],
              light: ['#b87800', '#0072b2', '#007a5a', '#9a8a00', '#2a5db0', '#d55e00', '#a8467f', '#6b6b6b', '#00806b', '#64748b'] },
    mono:   { label: 'Monochrome', note: 'Shades of your accent colour', mono: true }
  };
  var SCHEME_KEY = 'dashview_chart_scheme';
  var ACC_HEX = { amber: ['#f2b04a', '#c2710c'], teal: ['#2fbf9f', '#0e7c66'], blue: ['#6aa5ff', '#2563eb'], violet: ['#b197fc', '#7c3aed'], rose: ['#fb7a92', '#d61f4c'] };
  var ACC_SLOT = { amber: 0, blue: 1, violet: 2, teal: 3, rose: 4 };
  function hexMix(a, b, t) {
    var x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16), o = 0;
    [16, 8, 0].forEach(function (sh) { var c = Math.round(((x >> sh) & 255) * (1 - t) + ((y >> sh) & 255) * t); o = (o << 8) | c; });
    return '#' + ('000000' + o.toString(16)).slice(-6);
  }
  function accentKey() { try { var c = JSON.parse(localStorage.getItem('dashview-config')) || {}; return ACC_HEX[c.accent] ? c.accent : 'amber'; } catch (e) { return 'amber'; } }
  function schemeId() { var v = null; try { v = localStorage.getItem(SCHEME_KEY); } catch (e) {} return SCHEMES[v] ? v : 'auto'; }
  function paletteFor(id, light, acc) {
    id = SCHEMES[id] ? id : 'auto'; acc = ACC_HEX[acc] ? acc : 'amber';
    var sc = SCHEMES[id], a = ACC_HEX[acc][light ? 1 : 0], pal;
    if (sc.mono) {
      var ends = light ? [hexMix(a, '#000000', .22), hexMix(a, '#ffffff', .72)] : [hexMix(a, '#ffffff', .18), hexMix(a, '#000000', .55)];
      pal = []; for (var i = 0; i < 10; i++) pal.push(hexMix(ends[0], ends[1], i / 9));
      return pal;
    }
    pal = (light ? sc.light : sc.dark).slice();
    if (id === 'auto' && acc !== 'amber') { var slot = ACC_SLOT[acc], keep = pal[0]; pal[slot] = keep; pal[0] = a; }
    return pal;
  }
  /* 8 named tones used by the Overview (revenue / orders / pipeline / ...), derived from the same scheme */
  var SEM_DARK  = { blue: '#5AA2FF', teal: '#2FD1A5', amber: '#FFB547', coral: '#FF6F61', violet: '#A78BFA', cyan: '#3CCBE6', pink: '#F58AC4', slate: '#94A3B8' };
  var SEM_LIGHT = { blue: '#1D5FD1', teal: '#0A8F6B', amber: '#B86E00', coral: '#D1342A', violet: '#6A3FD6', cyan: '#0A7FA0', pink: '#BE2F7E', slate: '#566277' };
  function semantic(light) {
    var id = schemeId(), acc = accentKey(), base = Object.assign({}, light ? SEM_LIGHT : SEM_DARK);
    if (id === 'auto') {
      if (acc !== 'amber') { var key = { blue: 'blue', teal: 'teal', violet: 'violet', rose: 'pink' }[acc], a = ACC_HEX[acc][light ? 1 : 0], old = base.blue; if (key !== 'blue') base[key] = old; base.blue = a; }
      return base;
    }
    var p = paletteFor(id, light, acc), idx = { blue: 0, amber: 1, violet: 2, teal: 3, pink: 4, cyan: 5, coral: 6, slate: 9 };
    Object.keys(idx).forEach(function (k) { base[k] = p[idx[k]]; });
    return base;
  }
  var PALETTE = paletteFor(schemeId(), document.documentElement.getAttribute('data-theme') === 'light', accentKey());
  var palSig = '';
  function theme() {
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    return {
      text: light ? '#4a5064' : '#b9c0d8', strong: light ? '#161a24' : '#f1f3fb', grid: light ? 'rgba(20,24,40,.12)' : 'rgba(255,255,255,.12)',
      tipBg: light ? 'rgba(255,255,255,.98)' : 'rgba(43,53,80,.97)', tipText: light ? '#1a1625' : '#f1f4fb', light: light
    };
  }
  /* Create/replace a Chart.js chart on a canvas (keeps a registry so re-renders never leak). */
  var charts = {};
  /* ---- Visual polish: applied to every chart created through DVFmt.chart ---- */
  var polishReady = false;
  function compactNum(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(v * 100) / 100);
  }
  /* Scriptable gradient: strong at the data edge, fading away from it. */
  function gradient(color, horizontal, from, to) {
    return function (c) {
      var a = c.chart.chartArea; if (!a) return color + 'cc';
      var g = horizontal ? c.chart.ctx.createLinearGradient(a.left, 0, a.right, 0) : c.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
      g.addColorStop(0, color + from); g.addColorStop(1, color + to); return g;
    };
  }
  function gradientTagged(color, horizontal, from, to) { var f = gradient(color, horizontal, from, to); f._g = [color, horizontal, from, to]; return f; }
  /* Total in the middle of a doughnut. */
  var centerPlugin = {
    id: 'dvCenter',
    afterDraw: function (ch) {
      if (ch.config.type !== 'doughnut' || !ch.chartArea) return;
      var a = ch.chartArea, w = a.right - a.left, h = a.bottom - a.top;
      if (Math.min(w, h) < 150) return;
      var ds = ch.data.datasets[0]; if (!ds) return;
      var total = ds.data.reduce(function (s, v, i) { return ch.getDataVisibility(i) ? s + (Number(v) || 0) : s; }, 0);
      var t = theme(), ctx = ch.ctx, cx = (a.left + a.right) / 2, cy = (a.top + a.bottom) / 2;
      var fam = getComputedStyle(document.body).fontFamily;
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = t.strong; ctx.font = '700 ' + Math.max(18, Math.min(30, w / 7)) + 'px ' + fam; ctx.fillText(compactNum(total), cx, cy - 7);
      ctx.fillStyle = t.text; ctx.font = '600 11px ' + fam; ctx.fillText('TOTAL', cx, cy + 16);
      ctx.restore();
    }
  };

  /* ---- Line-chart detailing ------------------------------------------------
     dvLineMarks : average reference line + Peak / Low / Latest value badges.
     dvCrosshair : thin vertical guide that follows the hover/touch position.
     Both are drawn on the canvas, so they follow the theme and export/print.   */
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function overlap(a, b) { return !(a.x + a.w + 4 < b.x || b.x + b.w + 4 < a.x || a.y + a.h + 2 < b.y || b.y + b.h + 2 < a.y); }
  var lineMarksPlugin = {
    id: 'dvLineMarks',
    afterDatasetsDraw: function (ch, args, o) {
      if (!o || o.enabled === false || !ch.chartArea) return;
      var ds = ch.data.datasets[0], meta = ch.getDatasetMeta(0), area = ch.chartArea;
      if (!ds || !meta || meta.hidden || !meta.data || meta.data.length < 3) return;
      var ys = ch.scales[meta.yAxisID || 'y']; if (!ys) return;
      var vals = ds.data.map(function (v) { return Number(v); }), n = vals.length;
      var hi = 0, lo = 0, sum = 0, any = false;
      vals.forEach(function (v, i) { if (isNaN(v)) return; any = true; sum += v; if (v > vals[hi] || isNaN(vals[hi])) hi = i; if (v < vals[lo] || isNaN(vals[lo])) lo = i; });
      if (!any || vals[hi] === vals[lo]) return;
      var avg = sum / n, fmt = o.fmt || compactNum, t = theme(), ctx = ch.ctx, fam = getComputedStyle(document.body).fontFamily;
      var col = typeof ds.borderColor === 'string' ? ds.borderColor : PALETTE[0];
      ctx.save();
      /* average reference line (label is placed after the badges, on the clearest spot) */
      var ay = ys.getPixelForValue(avg), taken = [], at = 'Avg ' + fmt(avg), showAvg = ay > area.top + 4 && ay < area.bottom - 4;
      if (showAvg) {
        ctx.setLineDash([4, 5]); ctx.lineWidth = 1; ctx.strokeStyle = t.text; ctx.globalAlpha = .5;
        ctx.beginPath(); ctx.moveTo(area.left, ay); ctx.lineTo(area.right, ay); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      /* badges */
      function mark(i, kind) {
        var el = meta.data[i]; if (!el || isNaN(vals[i])) return;
        var x = el.x, y = el.y, above = kind !== 'low';
        var txt = (kind === 'high' ? 'Peak ' : kind === 'low' ? 'Low ' : '') + fmt(vals[i]);
        ctx.font = '700 11px ' + fam; var w = ctx.measureText(txt).width + 14, h = 20;
        var bx = Math.max(area.left + 2, Math.min(area.right - w - 2, x - w / 2)), by = above ? y - h - 9 : y + 9;
        if (by < 0) by = y + 9; if (by + h > ch.height - 2) by = y - h - 9;
        var box = { x: bx, y: by, w: w, h: h };
        for (var k = 0; k < taken.length; k++) if (overlap(box, taken[k])) return;
        taken.push(box);
        /* point */
        ctx.beginPath(); ctx.arc(x, y, kind === 'last' ? 5.5 : 4.5, 0, 6.2832);
        ctx.fillStyle = kind === 'last' ? col : '#fff'; ctx.fill();
        ctx.lineWidth = 2.2; ctx.strokeStyle = col; ctx.stroke();
        /* badge */
        ctx.shadowColor = 'rgba(30,40,80,.25)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
        ctx.fillStyle = kind === 'last' ? col : (t.light ? 'rgba(255,255,255,.96)' : 'rgba(52,64,96,.96)'); rr(ctx, bx, by, w, h, 10); ctx.fill();
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        if (kind !== 'last') { ctx.lineWidth = 1; ctx.strokeStyle = t.grid; ctx.stroke(); }
        ctx.fillStyle = kind === 'last' ? '#fff' : t.tipText; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, bx + w / 2, by + h / 2 + .5);
      }
      mark(n - 1, 'last');
      if (hi !== n - 1) mark(hi, 'high');
      if (lo !== n - 1 && lo !== hi) mark(lo, 'low');
      if (showAvg) {
        ctx.font = '600 10.5px ' + fam; var aw = ctx.measureText(at).width + 12, ah = 17, pts = meta.data, best = null, fallback = null;
        var hitsLine = function (r) {
          for (var i = 0; i < pts.length - 1; i++) {
            var p = pts[i], q = pts[i + 1], x0 = Math.max(r.x - 3, Math.min(p.x, q.x)), x1 = Math.min(r.x + r.w + 3, Math.max(p.x, q.x));
            if (x1 < x0) continue;
            var dx = q.x - p.x, y0 = dx ? p.y + (q.y - p.y) * ((x0 - p.x) / dx) : p.y, y1 = dx ? p.y + (q.y - p.y) * ((x1 - p.x) / dx) : q.y;
            if (Math.max(y0, y1) + 4 >= r.y && Math.min(y0, y1) - 4 <= r.y + r.h) return true;
          }
          return false;
        };
        [0.02, 0.2, 0.4, 0.6, 0.8, 0.98].some(function (f) {
          var rx = Math.max(area.left + 4, Math.min(area.right - aw - 4, area.left + (area.right - area.left - aw) * f));
          return [ay - ah - 4, ay + 4].some(function (ry) {
            var r = { x: rx, y: ry, w: aw, h: ah };
            if (ry < area.top || ry + ah > area.bottom) return false;
            for (var k = 0; k < taken.length; k++) if (overlap(r, taken[k])) return false;
            if (hitsLine(r)) { if (!fallback) fallback = r; return false; }
            best = r; return true;
          });
        });
        var onLine = !best && !!fallback; best = best || fallback;
        if (best) {
          ctx.fillStyle = t.light ? (onLine ? '#fff' : 'rgba(255,255,255,.9)') : (onLine ? 'rgb(52,64,96)' : 'rgba(52,64,96,.86)'); rr(ctx, best.x, best.y, aw, ah, 8); ctx.fill();
          if (onLine) { ctx.lineWidth = 1; ctx.strokeStyle = t.grid; ctx.stroke(); }
          ctx.fillStyle = t.text; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(at, best.x + 6, best.y + ah / 2 + .5);
        }
      }
      ctx.restore();
    }
  };
  var crosshairPlugin = {
    id: 'dvCrosshair',
    beforeDatasetsDraw: function (ch, args, o) {
      if (!o || o.enabled === false || !ch.tooltip || !ch.chartArea) return;
      var act = ch.tooltip.getActiveElements && ch.tooltip.getActiveElements(); if (!act || !act.length) return;
      var a = ch.chartArea, ctx = ch.ctx, t = theme(); ctx.save();
      ctx.lineWidth = 1; ctx.strokeStyle = t.light ? 'rgba(26,22,37,.22)' : 'rgba(234,237,248,.28)'; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(act[0].element.x, a.top); ctx.lineTo(act[0].element.x, a.bottom); ctx.stroke(); ctx.restore();
    }
  };

  /* v2.4 chart detailing: value labels on bars, hover focus (dims other bars/slices), staggered entrance, a11y summary */
  var barLabelsPlugin = {
    id: 'dvBarLabels',
    afterDatasetsDraw: function (ch, args, o) {
      if (!o || o.enabled === false) return;
      var ctx = ch.ctx, t = theme(), horiz = ch.options.indexAxis === 'y'; ctx.save();
      ctx.font = '600 11px ' + (ch.options.font && ch.options.font.family || 'system-ui'); ctx.fillStyle = t.strong;
      ch.data.datasets.forEach(function (d, di) {
        if ((d.type || ch.config.type) !== 'bar' || ch.data.datasets.length > 1) return;
        var meta = ch.getDatasetMeta(di); if (meta.hidden) return;
        meta.data.forEach(function (el, i) {
          var v = Number(d.data[i]); if (isNaN(v) || el.width < 14 && !horiz && meta.data.length > 14) return;
          var txt = compactNum(v); ctx.textAlign = horiz ? 'left' : 'center'; ctx.textBaseline = horiz ? 'middle' : 'bottom';
          ctx.fillText(txt, horiz ? el.x + 6 : el.x, horiz ? el.y : el.y - 5);
        });
      });
      ctx.restore();
    }
  };
  function makeDim(c) { var f = function (ctx) { var el = ctx.element; return el && el.options && el.options.dvDim ? String(c).slice(0, 7) + '40' : c; }; f._base = c; return f; }
  /* One scriptable function for a whole colour array. Chart.js only calls a function that is the option itself;
     a function sitting inside an array is handed to the canvas as-is and every bar / slice painted black. */
  function makeDimArr(arr) {
    var f = function (ctx) {
      var c = arr[(ctx && ctx.dataIndex || 0) % arr.length];
      if (typeof c === 'function') c = c(ctx);
      var el = ctx && ctx.element;
      return el && el.options && el.options.dvDim && typeof c === 'string' ? c.slice(0, 7) + '40' : c;
    };
    f._arr = arr; return f;
  }
  function focusHover(ch, evt, active) {
    var type = ch.config.type; if (type !== 'bar' && type !== 'doughnut' && type !== 'pie') return;
    ch.data.datasets.forEach(function (d, di) {
      if (ch.data.datasets.length > 1 && type === 'bar') return;
      var meta = ch.getDatasetMeta(di), idx = active && active.length ? active[0].index : -1;
      meta.data.forEach(function (el, i) { el.options.dvDim = idx > -1 && i !== idx; });
    });
    ch.canvas.style.cursor = active && active.length && ch.options.onClick ? 'pointer' : 'default';
  }
  function a11y(ch) {
    try {
      var d = ch.data.datasets[0] || {}, n = (d.data || []).length, labels = ch.data.labels || [];
      var top = n ? labels[(d.data || []).indexOf(Math.max.apply(null, d.data.map(Number)))] : '';
      ch.canvas.setAttribute('role', 'img');
      ch.canvas.setAttribute('aria-label', (ch.options.plugins.title && ch.options.plugins.title.text || 'Chart') + ': ' + ch.config.type + ' chart, ' + n + ' points' + (top ? ', highest ' + top : '') + '.');
    } catch (e) {}
  }

  function polish(config, t) {
    var C = window.Chart;
    if (!polishReady && C) {
      polishReady = true;
      C.defaults.font.family = getComputedStyle(document.body).fontFamily;
      C.defaults.font.size = 12; C.defaults.color = t.text;
      C.defaults.animation.easing = 'easeOutQuart';
    }
    var type = config.type, opt = config.options, ds = (config.data && config.data.datasets) || [];
    var horiz = opt.indexAxis === 'y', tiny = !!(opt.scales && opt.scales.x && opt.scales.x.display === false && opt.scales.y && opt.scales.y.display === false);
    var tip = opt.plugins.tooltip;
    if (tip && tip.enabled !== false) {
      tip.cornerRadius = tip.cornerRadius || 10; tip.padding = tip.padding || 12; tip.boxPadding = 5; tip.usePointStyle = true;
      tip.titleFont = tip.titleFont || { weight: '700', size: 12.5 }; tip.bodyFont = tip.bodyFont || { size: 12.5 };
      tip.caretSize = 6; tip.titleMarginBottom = 6;
      /* Line charts: show the change against the previous point (no extra work for callers). */
      if (type === 'line' && ds.length === 1) {
        tip.callbacks = tip.callbacks || {};
        if (!tip.callbacks.footer) tip.callbacks.footer = function (items) {
          var it = items && items[0]; if (!it || it.dataIndex < 1) return '';
          var p = Number(it.dataset.data[it.dataIndex - 1]), c = Number(it.dataset.data[it.dataIndex]);
          if (!p || isNaN(c)) return '';
          var d = (c - p) / Math.abs(p) * 100;
          return (d >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(d).toFixed(1) + '% vs ' + it.chart.data.labels[it.dataIndex - 1];
        };
        tip.footerFont = tip.footerFont || { weight: '600', size: 11.5 }; tip.footerMarginTop = 6;
      }
    }
    var single = type === 'line' && ds.length === 1 && !tiny && (ds[0].data || []).length >= 3;
    ds.forEach(function (d, i) {
      var col = typeof d.borderColor === 'string' ? d.borderColor : null, dt = d.type || type;
      if (dt === 'line') {
        /* Monotone cubic = smooth but never overshoots the data, so no fake dips / zigzag between points. */
        if (!d.stepped) { d.cubicInterpolationMode = 'monotone'; d.tension = 0; }
        d.borderCapStyle = 'round'; d.borderJoinStyle = 'round';
        if (col && d.fill && typeof d.backgroundColor === 'string') d.backgroundColor = gradientTagged(col, false, '44', '03');
        if (type === 'line' && !tiny) {
          d.pointBackgroundColor = d.pointBackgroundColor || '#fff'; d.pointBorderColor = d.pointBorderColor || col;
          d.pointBorderWidth = d.pointBorderWidth == null ? 2 : d.pointBorderWidth; d.pointHoverBorderWidth = 3; d.pointHitRadius = 14;
          if (single && (d.data || []).length > 16) d.pointRadius = 0;
        }
      } else if (type === 'bar' && ds.length === 1 && col && typeof d.backgroundColor === 'string') {
        d.backgroundColor = horiz ? gradientTagged(col, true, '66', 'ee') : gradientTagged(col, false, 'f2', '66');
        d.hoverBackgroundColor = col; d.borderWidth = 0; d.borderSkipped = false;
      } else if (type === 'bar') { d.borderRadius = d.borderRadius == null ? 6 : d.borderRadius; d.borderSkipped = false; }
    });
    /* Professional scale for single-series line charts */
    if (single) {
      var nums = (ds[0].data || []).map(Number).filter(function (v) { return !isNaN(v); }), mx = Math.max.apply(null, nums), mn = Math.min.apply(null, nums);
      var ys = opt.scales && opt.scales.y, xs = opt.scales && opt.scales.x;
      if (ys && ys.display !== false) {
        ys.grace = ys.grace || '10%';
        ys.ticks = Object.assign({ maxTicksLimit: 6 }, ys.ticks || {});
        if (mx > 0 && mn >= 0.6 * mx && ys.beginAtZero !== false) ys.beginAtZero = false;   /* values in a narrow band: zoom in instead of drawing a flat line */
        if (!ys.ticks.callback) ys.ticks.callback = function (v) { return compactNum(v); };
      }
      if (xs && xs.display !== false) xs.ticks = Object.assign({ maxTicksLimit: 12, maxRotation: 0, autoSkip: true }, xs.ticks || {});
      opt.layout = Object.assign({ padding: { top: 26, right: 14, bottom: 0, left: 0 } }, opt.layout || {});
      if (opt.plugins.dvLineMarks == null) opt.plugins.dvLineMarks = { enabled: true };
      if (opt.plugins.dvCrosshair == null) opt.plugins.dvCrosshair = { enabled: true };
      config.plugins = (config.plugins || []).concat([lineMarksPlugin, crosshairPlugin]);
    }
    if (type === 'doughnut') {
      opt.spacing = opt.spacing == null ? 2 : opt.spacing;
      ds.forEach(function (d) { d.borderRadius = d.borderRadius == null ? 7 : d.borderRadius; d.hoverOffset = d.hoverOffset == null ? 8 : d.hoverOffset; });
      opt.layout = opt.layout || { padding: 8 };
      config.plugins = (config.plugins || []).concat([centerPlugin]);
    }
    if (opt.scales && !tiny) {
      Object.keys(opt.scales).forEach(function (k) {
        var sc = opt.scales[k]; if (!sc || sc.display === false) return;
        sc.border = Object.assign({ display: false }, sc.border || {});
        sc.ticks = Object.assign({ padding: 8 }, sc.ticks || {});
        var isValueAxis = horiz ? k === 'x' : k === 'y';
        if (sc.grid && sc.grid.display !== false && (isValueAxis || type === 'line')) sc.grid = Object.assign({ borderDash: [4, 5], drawTicks: false }, sc.grid);
        else if (sc.grid) sc.grid = Object.assign({ drawTicks: false }, sc.grid);
      });
    }
    if (type === 'bar' && ds.length === 1 && (ds[0].data || []).length <= 12 && opt.plugins.dvBarLabels == null) { opt.plugins.dvBarLabels = { enabled: true }; opt.plugins.dashviewValueLabels = false; opt.layout = Object.assign({ padding: { top: 18, right: horiz ? 34 : 6 } }, opt.layout || {}); config.plugins = (config.plugins || []).concat([barLabelsPlugin]); }
    if (type === 'bar' || type === 'line') opt.animation = Object.assign({ duration: 700, delay: function (c) { return c.type === 'data' && c.mode === 'default' ? c.dataIndex * 35 : 0; } }, opt.animation || {});
    if (type === 'doughnut') opt.animation = Object.assign({ animateRotate: true, animateScale: true, duration: 900 }, opt.animation || {});
    if (type === 'bar' || type === 'doughnut') {
      var prevHover = opt.onHover; opt.onHover = function (e, a, ch) { focusHover(ch, e, a); ch.draw(); if (prevHover) prevHover(e, a, ch); };
      ds.forEach(function (d) { ['backgroundColor'].forEach(function (k) { var base = d[k]; if (Array.isArray(base) && base.length) d[k] = makeDimArr(base); }); });
    }
    if (type === 'line' || type === 'bar') opt.interaction = Object.assign({ mode: 'index', intersect: false }, opt.interaction || {});
    return config;
  }
  function chart(canvasId, config) {
    var el = document.getElementById(canvasId);
    if (!el || !window.Chart) return null;
    if (charts[canvasId]) { try { charts[canvasId].destroy(); } catch (e) {} }
    var t = theme(), pref = function (k) { try { return localStorage.getItem('dv-pref-' + k); } catch (e) { return null; } };
    config.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: pref('anim') === 'off' ? false : { duration: 600 } }, config.options || {});
    if (pref('labels') === 'off') { config.options.plugins = config.options.plugins || {}; config.options.plugins.dvBarLabels = { enabled: false }; }
    config.options.plugins = Object.assign({ legend: { display: false }, tooltip: { backgroundColor: t.tipBg, titleColor: t.tipText, bodyColor: t.tipText, borderColor: t.grid, borderWidth: 1, padding: 10 } }, config.options.plugins || {});
    try { polish(config, t); } catch (e) { /* polish is cosmetic - never block a chart */ }
    charts[canvasId] = new window.Chart(el.getContext('2d'), config);
    a11y(charts[canvasId]);
    return charts[canvasId];
  }

  /* ---- Live re-theme: black <-> white without re-fetching anything ---- */
  function mapColor(c, from, to) {
    if (typeof c !== 'string') return c;
    if (c === '#fff' || c === '#12141f') return '#ffffff';
    var i = from.indexOf(c.slice(0, 7).toLowerCase()); return i > -1 ? to.pal[i] + c.slice(7) : c;
  }
  function remapVal(v, from, to) {
    if (typeof v === 'string') return mapColor(v, from, to);
    if (Array.isArray(v)) return v.map(function (x) { return remapVal(x, from, to); });
    if (typeof v === 'function' && v._g) return gradientTagged(mapColor(v._g[0], from, to), v._g[1], v._g[2], v._g[3]);
    if (typeof v === 'function' && v._arr) return makeDimArr(remapVal(v._arr, from, to));
    if (typeof v === 'function' && v._base) return makeDim(remapVal(v._base, from, to));
    return v;
  }
  var curPal = PALETTE.map(function (c) { return c.toLowerCase(); });
  palSig = (document.documentElement.getAttribute('data-theme') === 'light') + '|' + schemeId() + '|' + accentKey();
  function applyTheme() {
    var t = theme(), sid = schemeId(), acc = accentKey(), sig = t.light + '|' + sid + '|' + acc;
    if (sig === palSig) return; palSig = sig;
    var from = curPal, pal = paletteFor(sid, t.light, acc);
    curPal = pal.map(function (c) { return c.toLowerCase(); });
    pal.forEach(function (c, i) { PALETTE[i] = c; });
    var to = { pal: pal, light: t.light };
    if (window.Chart) { window.Chart.defaults.color = t.text; }
    Object.keys(charts).forEach(function (id) {
      var ch = charts[id]; if (!ch || !ch.canvas || !document.contains(ch.canvas)) return;
      try {
        ch.data.datasets.forEach(function (d) { ['backgroundColor', 'borderColor', 'hoverBackgroundColor', 'pointBackgroundColor', 'pointBorderColor'].forEach(function (k) { if (d[k] != null) d[k] = remapVal(d[k], from, to); }); });
        var o = ch.options, sc = o.scales || {};
        Object.keys(sc).forEach(function (k) { if (!sc[k]) return; sc[k].ticks = sc[k].ticks || {}; sc[k].ticks.color = t.text; if (sc[k].grid && sc[k].grid.display !== false) sc[k].grid.color = t.grid; if (sc[k].title) sc[k].title.color = t.text; });
        var pl = o.plugins || {}; if (pl.legend && pl.legend.labels) pl.legend.labels.color = t.text;
        if (pl.tooltip) { pl.tooltip.backgroundColor = t.tipBg; pl.tooltip.titleColor = t.tipText; pl.tooltip.bodyColor = t.tipText; pl.tooltip.borderColor = t.grid; }
        ch.update('none');
      } catch (e) { /* cosmetic only */ }
    });
  }
  try { new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch (e) {}
  document.addEventListener('dv:theme', applyTheme);
  document.addEventListener('dv:chart-scheme', applyTheme);
  window.addEventListener('storage', function (e) { if (e.key === SCHEME_KEY || e.key === 'dashview-config') applyTheme(); });
  function setScheme(id) {
    if (!SCHEMES[id]) id = 'auto';
    try { if (id === 'auto') localStorage.removeItem(SCHEME_KEY); else localStorage.setItem(SCHEME_KEY, id); } catch (e) {}
    applyTheme(); document.dispatchEvent(new CustomEvent('dv:chart-scheme', { detail: id }));
    if (window.applyOverviewChartTheme) { try { window.applyOverviewChartTheme(); } catch (e) {} }
    return id;
  }
  function resizeCharts(root) {
    Object.keys(charts).forEach(function (k) { var c = charts[k]; if (c && c.canvas && (!root || root.contains(c.canvas))) { try { c.resize(); } catch (e) {} } });
  }
  function getChart(canvasId) { return charts[canvasId] || null; }
  api.currency().then(function (c) { cur = c; }, function () {});
  ['dv:unlocked', 'dv:odoo-config-saved'].forEach(function (ev) { document.addEventListener(ev, function () { memo = {}; api.currency().then(function (c) { cur = c; }); }); });

  window.DVFmt = { esc: esc, num: num, money: money, stripHtml: stripHtml, when: when, isoDaysAgo: isoDaysAgo, csv: csv, safeSpreadsheetValue: safeSpreadsheetValue, download: download, PALETTE: PALETTE, scheme: schemeId, setScheme: setScheme, schemes: SCHEMES, paletteFor: paletteFor, semantic: semantic, chart: chart, theme: theme, resizeCharts: resizeCharts, getChart: getChart, setCurrency: function (c) { cur = c; } };
})();

try { var __d = localStorage.getItem('dv-pref-density'); if (__d) document.documentElement.setAttribute('data-density', __d); } catch (e) {}
try { ['toastpos', 'glass'].forEach(function (k) { var v = localStorage.getItem('dv-pref-' + k); if (v) document.documentElement.setAttribute('data-' + k, v); }); } catch (e) {}
