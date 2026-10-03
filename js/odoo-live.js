/* ==========================================================================
   DashView — Odoo Live  (v3)
   Pick an installed Odoo app → the model dropdown lists only that app's own
   models → Insights shows KPIs + charts built for that app (js/odoo-profiles.js),
   Records is the full explorer (filters, columns, saved views, export).
   All calls go through DVOdooClient (Cloudflare Worker proxy).
   ========================================================================== */
(function () {
  'use strict';
  if (!document.getElementById('view-odoo-live')) return;

  var C = window.DVOdooClient, F = window.DVFmt, PR = window.DVOdooProfiles;
  var esc = F.esc;
  function byId(id) { return document.getElementById(id); }
  function loadJSON(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }

  var GROUPABLE = { selection: 1, many2one: 1, boolean: 1 };
  var DATEABLE = { date: 1, datetime: 1 };
  var MEASURABLE = { integer: 1, float: 1, monetary: 1 };
  var DISPLAYABLE = { char: 1, text: 1, selection: 1, many2one: 1, integer: 1, float: 1, monetary: 1, boolean: 1, date: 1, datetime: 1 };
  var FILTERABLE = { char: 1, text: 1, html: 1, selection: 1, many2one: 1 };
  var NOISE = /^(message_|activity_|website_|access_|__|write_|create_uid|create_date|x_studio|has_|is_|display_name$|id$)/;
  var PREFER = ['display_name', 'name', 'partner_id', 'user_id', 'state', 'stage_id', 'amount_total', 'amount_untaxed', 'expected_revenue', 'date_order', 'invoice_date', 'email', 'phone', 'company_id'];
  var COMPACT = function (v) { return Math.abs(v) >= 1000 ? (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k') : String(v); };
  var PAGE_SIZE = 25, COLUMNS_KEY = 'dashview_odoo_columns', VIEWS_KEY = 'dashview_odoo_saved_views';
  var FIRST_APPS = ['sale', 'crm', 'account', 'purchase', 'stock', 'hr', 'project', 'mrp', 'point_of_sale'];

  var state = {
    modules: [], activeModule: null, models: [], activeModel: null, fields: {}, filters: [],
    page: 0, total: 0, records: [], columns: [], tab: 'executive', dirty: { insights: true, records: true, exec: true }, period: 30,
    lastSynced: null, version: null, timer: null, seq: 0,
    columnPrefs: loadJSON(COLUMNS_KEY, {}), savedViews: loadJSON(VIEWS_KEY, []),
    drill: null, drillMeta: null
  };

  /* -- Status / banner / connection strip --------------------------------- */
  function setStatus(mode, text) {
    var pill = byId('odooLiveStatus'), label = byId('odooLiveStatusText');
    if (!pill || !label) return;
    pill.classList.remove('is-live', 'is-error', 'is-connecting', 'is-disconnected');
    if (mode === 'live') pill.classList.add('is-live');
    if (mode === 'error') pill.classList.add('is-error');
    if (mode === 'connecting' || mode === 'testing') pill.classList.add('is-connecting');
    if (mode === 'disconnected') pill.classList.add('is-disconnected');
    pill.setAttribute('data-state', mode);
    label.textContent = text;
  }
  function safeError(e) {
    var message = String(e && e.message || 'Odoo request failed.');
    var cfg = C.cfg();
    [cfg.apiKey, cfg.username].forEach(function (secret) {
      if (secret) message = message.split(String(secret)).join('[redacted]');
    });
    if (/401|403|auth|credential|login|uid/i.test(message)) return 'Authentication was refused. Verify the database name, username and Odoo API key.';
    if (/429|rate.?limit/i.test(message)) return 'Odoo is receiving too many requests. Wait a moment, then retry.';
    if (/access.?denied|access rights|permission|forbidden/i.test(message)) return 'This Odoo user cannot read the selected app or model. Ask an Odoo administrator to grant read access.';
    if (/cannot reach|failed to fetch|networkerror|load failed/i.test(message)) return 'Could not reach the configured proxy. Check its URL, deployment and allowed site origins.';
    return message;
  }
  function showLiveError(e) {
    var banner = byId('odooLiveConnectBanner'), text = byId('odooLiveConnectBannerText'), retry = byId('odooLiveRetryBtn');
    if (banner && text) {
      text.innerHTML = '<strong>Connection issue.</strong> ' + esc(safeError(e));
      banner.hidden = false;
    }
    if (retry) retry.hidden = false;
    setStatus('error', 'Connection error');
  }
  function renderBanner() {
    var s = C.state(), banner = byId('odooLiveConnectBanner'), text = byId('odooLiveConnectBannerText'), retry = byId('odooLiveRetryBtn');
    var connected = window.DVOdoo && window.DVOdoo.isConnected && window.DVOdoo.isConnected();
    if (s === 'ok' && connected) {
      banner.hidden = true;
      if (retry) retry.hidden = true;
      return true;
    }
    banner.hidden = false;
    var message = s === 'ok'
      ? 'Connect from Settings before browsing live records. Your saved credentials remain in this browser.'
      : C.message(s);
    text.innerHTML = '<strong>' + (s === 'locked' ? 'Workspace locked.' : s === 'noproxy' ? 'Proxy URL missing.' : s === 'ok' ? 'Odoo is disconnected.' : 'Odoo is not configured.') + '</strong> ' + esc(message);
    if (retry) retry.hidden = true;
    setStatus('disconnected', s === 'locked' ? 'Locked' : 'Not connected');
    byId('odooLiveConn').innerHTML = '';
    return false;
  }
  function renderConn() {
    var c = C.cfg(), host = ''; try { host = new URL(c.url).host; } catch (e) { host = c.url || ''; }
    var chips = [['Instance', host], ['Database', c.db], ['User', c.username]];
    if (state.version) chips.push(['Odoo', state.version]);
    if (C.lastLatency != null) chips.push(['Latency', C.lastLatency + ' ms']);
    if (state.lastSynced) chips.push(['Synced', state.lastSynced.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })]);
    byId('odooLiveConn').innerHTML = chips.map(function (x) { return '<span class="olx-chip"><em>' + esc(x[0]) + '</em>' + esc(x[1]) + '</span>'; }).join('');
  }

  /* -- Module select (filter, same pattern as the Model select) ------------- */
  function fillModuleSelect() {
    var sel = byId('odooLiveModuleSelect');
    var opt = function (m) { return '<option value="' + esc(m.technicalName) + '">' + esc(m.label) + (PR.has(m.technicalName) ? ' \u2605' : '') + '</option>'; };
    var apps = state.modules.filter(function (m) { return m.isApp; }).sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); });
    var mods = state.modules.filter(function (m) { return !m.isApp; }).sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); });
    var html = '<option value="__all__">\u2605 Executive overview \u2014 all modules</option>';
    if (apps.length) html += '<optgroup label="Apps">' + apps.map(opt).join('') + '</optgroup>';
    if (mods.length) html += '<optgroup label="Modules">' + mods.map(opt).join('') + '</optgroup>';
    sel.innerHTML = html || '<option value="">No modules found</option>';
    sel.disabled = !state.modules.length;
    if (state.activeModule) sel.value = state.activeModule;
    byId('odooLiveModCount').textContent = state.modules.length ? state.modules.length + ' installed' : '';
  }
  function defaultModule() {
    var names = state.modules.map(function (m) { return m.technicalName; });
    for (var i = 0; i < FIRST_APPS.length; i++) if (names.indexOf(FIRST_APPS[i]) > -1) return FIRST_APPS[i];
    var app = state.modules.filter(function (m) { return m.isApp; })[0];
    return (app || state.modules[0] || {}).technicalName;
  }

  /* -- Module → its own models -------------------------------------------- */
  function modelRows(where) {
    return C.records('ir.model', { domain: where, fields: ['model', 'name', 'transient'], limit: 300 })
      .then(function (r) { return (r.rows || []).filter(function (x) { return !x.transient; }); });
  }
  function discover(mod) {
    return C.records('ir.model.data', { domain: [['module', '=', mod], ['model', '=', 'ir.model']], fields: ['res_id'], limit: 300 })
      .then(function (r) { var ids = (r.rows || []).map(function (x) { return x.res_id; }); return ids.length ? modelRows([['id', 'in', ids]]) : []; })
      .catch(function () { return []; })
      .then(function (rows) {
        if (rows.length) return rows;
        var prefix = mod.replace(/_/g, '.').split('.')[0];
        return modelRows([['model', '=like', prefix + '.%']]).catch(function () { return []; });
      });
  }
  function resolveModels(mod) {
    var prof = PR.get(mod), curated = prof ? prof.models : [];
    return discover(mod).then(function (found) {
      var byName = {}; found.forEach(function (m) { byName[m.model] = m; });
      var need = curated.filter(function (n) { return !byName[n]; });
      return (need.length ? modelRows([['model', 'in', need]]).catch(function () { return []; }) : Promise.resolve([])).then(function (extra) {
        extra.forEach(function (m) { byName[m.model] = m; });
        var primary = curated.filter(function (n) { return byName[n]; }).map(function (n) { return { model: n, label: byName[n].name, group: 'Main' }; });
        var seen = {}; primary.forEach(function (p) { seen[p.model] = 1; });
        var rest = Object.keys(byName).filter(function (n) { return !seen[n]; }).map(function (n) { return { model: n, label: byName[n].name, group: 'More' }; })
          .sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); });
        return primary.concat(rest);
      });
    });
  }
  function fillModelSelect() {
    var sel = byId('odooLiveModelSelect');
    var opt = function (m) { return '<option value="' + esc(m.model) + '">' + esc(m.label) + ' — ' + esc(m.model) + '</option>'; };
    var main = state.models.filter(function (m) { return m.group === 'Main'; }), more = state.models.filter(function (m) { return m.group === 'More'; });
    var html = '';
    if (main.length) html += '<optgroup label="Main models">' + main.map(opt).join('') + '</optgroup>';
    if (more.length) html += '<optgroup label="Other models in this app">' + more.map(opt).join('') + '</optgroup>';
    sel.innerHTML = html || '<option value="">No readable models</option>';
    sel.disabled = !state.models.length;
    byId('odooLiveModelCount').textContent = state.models.length ? state.models.length + ' models' : '';
  }
  function selectModule(name) {
    var root = byId('view-odoo-live');
    if (name === '__all__') {
      state.activeModule = '__all__'; state.activeModel = null; state.drill = null; state.drillMeta = null; state.dirty.exec = true; root.classList.add('olx-all');
      byId('odooLiveModuleSelect').value = name;
      byId('odooLiveCrumb').innerHTML = '<b>Company overview</b><span>All installed apps</span>';
      byId('odooLiveModelSelect').innerHTML = '<option value="">\u2014</option>'; byId('odooLiveModelCount').textContent = '';
      state.tab = 'executive'; return showTab('executive');
    }
    root.classList.remove('olx-all'); state.dirty.exec = true;
    var mod = state.modules.filter(function (m) { return m.technicalName === name; })[0];
    state.activeModule = name;
    if (state.tab === 'executive') refreshTab();
    var msel = byId('odooLiveModuleSelect'); if (msel.value !== name) msel.value = name;
    byId('odooLiveCrumb').innerHTML = '<b>' + esc(mod ? mod.label : name) + '</b><span>' + esc(name) + '</span>';
    byId('odooLiveModelSelect').disabled = true;
    byId('odooLiveModelSelect').innerHTML = '<option>Loading models…</option>';
    var seq = ++state.seq;
    resolveModels(name).then(function (models) {
      if (seq !== state.seq) return;
      state.models = models; fillModelSelect();
      if (models.length) selectModel(models[0].model); else showEmpty('This module has no readable data models.');
    }).catch(function (e) { showEmpty(safeError(e)); });
  }

  /* -- Model + fields ------------------------------------------------------- */
  function selectModel(model) {
    state.activeModel = model; state.filters = []; state.drill = null; state.drillMeta = null; state.page = 0; state.dirty = { insights: true, records: true, exec: state.dirty.exec || !PR.exec(state.activeModule) };
    byId('odooLiveModelSelect').value = model;
    closePops(); renderChips();
    C.fields(model).then(function (f) {
      if (state.activeModel !== model) return;
      state.fields = f; populateControls(); refreshTab();
    }).catch(function (e) { showEmpty(safeError(e)); });
  }
  function showEmpty(msg) {
    setStatus('error', 'Error');
    byId('odooLiveKpis').innerHTML = ''; byId('odooLiveCharts').innerHTML = '<div class="olx-empty" role="alert">' + esc(safeError({ message: msg })) + '</div>';
  }
  function populateControls() {
    var f = state.fields, names = Object.keys(f);
    var label = function (n) { return esc(f[n].string || n); };
    byId('odooLiveFilterField').innerHTML = '<option value="">Filter field…</option>' + names.filter(function (n) { return FILTERABLE[f[n].type]; }).sort().map(function (n) { return '<option value="' + esc(n) + '">' + label(n) + '</option>'; }).join('');
    var groups = names.filter(function (n) { return GROUPABLE[f[n].type]; }).sort().map(function (n) { return '<option value="' + esc(n) + '">' + label(n) + '</option>'; });
    var dates = names.filter(function (n) { return DATEABLE[f[n].type]; }).sort().map(function (n) { return '<option value="' + esc(n) + ':month">' + label(n) + ' (by month)</option>'; });
    byId('odooLiveGroupBy').innerHTML = '<option value="">Group by…</option>' + groups.concat(dates).join('');
    byId('odooLiveMeasure').innerHTML = '<option value="__count">Count records</option>' + names.filter(function (n) { return MEASURABLE[f[n].type]; }).sort().map(function (n) { return '<option value="' + esc(n) + '">Sum of ' + label(n) + '</option>'; }).join('');
    ['odooLiveFilterValue', 'odooLiveAddFilterBtn', 'odooLiveQuickSearch', 'odooLiveColumnsBtn', 'odooLiveViewsBtn', 'odooLiveExportBtn'].forEach(function (id) { if (byId(id)) byId(id).disabled = false; });
    byId('odooLiveBuilderBody').innerHTML = '<div class="olx-empty-s">Pick a “Group by” field to build your own chart for ' + esc(state.activeModel) + '.</div>';
  }

  /* -- Tabs ----------------------------------------------------------------- */
  function showTab(tab) {
    state.tab = tab;
    document.querySelectorAll('#odooLiveTabs [role="tab"]').forEach(function (b) {
      var selected = b.getAttribute('data-tab') === tab;
      b.classList.toggle('active', selected);
      b.setAttribute('aria-selected', selected ? 'true' : 'false');
      b.tabIndex = selected ? 0 : -1;
    });
    byId('odooLiveExec').hidden = tab !== 'executive'; byId('odooLiveInsights').hidden = tab !== 'insights'; byId('odooLiveRecords').hidden = tab !== 'records';
    refreshTab();
  }
  function refreshTab() {
    if (!renderBanner()) return;
    if (state.tab === 'executive') { if (state.dirty.exec && state.activeModule) loadExecutive(); return; }
    if (!state.activeModel) return;
    if (state.tab === 'insights') { if (state.dirty.insights) loadInsights(); }
    else if (state.dirty.records) loadRecords();
  }

  /* -- Insights ------------------------------------------------------------- */
  function profileFor() {
    var p = PR.get(state.activeModule), m = state.activeModel;
    if (p && p.models[0] === m) return p;
    if (p) {
      var k = p.kpis.filter(function (x) { return x.model === m; }), c = p.charts.filter(function (x) { return x.model === m; });
      if (k.length || c.length) return { title: p.title, kpis: k, charts: c, models: p.models };
    }
    return PR.build(m, state.fields);
  }
  function shortLabel(l) { var m = String(l).match(/^(.+?)\s+(\d{4})$/); return m ? m[1].slice(0, 3) + ' \u2019' + m[2].slice(2) : String(l); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /* Turn an Odoo read_group month bucket label ("August 2024") into a [from, to) date-range pair for drill-in. */
  function monthRangeFromLabel(label) {
    var m = String(label).match(/^([A-Za-z]+)\s+(\d{4})$/); if (!m) return null;
    var mi = MONTHS.indexOf(m[1]); if (mi === -1) return null;
    var y = +m[2], from = new Date(Date.UTC(y, mi, 1)), to = new Date(Date.UTC(y, mi + 1, 1));
    var iso = function (d) { return d.toISOString().slice(0, 10) + ' 00:00:00'; };
    return { from: iso(from), to: iso(to) };
  }
  /* field/value pair(s) that isolate exactly this bar/segment/point, for click-to-drill. Null = not drillable. */
  function drillDomain(base, isDate, row) {
    if (isDate) { var r = monthRangeFromLabel(row.fullLabel); return r ? [[base, '>=', r.from], [base, '<', r.to]] : null; }
    if (Array.isArray(row.raw)) return [[base, '=', row.raw[0]]];
    if (row.raw === false || row.raw == null) return [[base, '=', false]];
    return [[base, '=', row.raw]];
  }
  function rowsFrom(groups, gb, meas, fields, spec) {
    var base = gb.split(':')[0], f = fields[base] || {}, sel = {};
    (f.selection || []).forEach(function (x) { sel[x[0]] = x[1]; });
    var rows = groups.map(function (g) {
      var raw = g[gb], label = Array.isArray(raw) ? raw[1] : (raw === false || raw == null ? '(none)' : (sel[raw] || String(raw)));
      var v = meas ? Number(g[meas]) || 0 : (g.__count || g[base + '_count'] || 0);
      return { label: String(label), fullLabel: String(label), value: v, raw: raw, field: base };
    });
    if (gb.indexOf(':') > -1) return rows.map(function (r) { return { label: shortLabel(r.label), fullLabel: r.fullLabel, value: r.value, raw: r.raw, field: r.field, dateBucket: true }; }).slice(-(spec.last || 12));
    rows.sort(function (a, b) { return b.value - a.value; });
    return rows.slice(0, spec.limit || 8);
  }
  function chartConfig(spec, rows, isMoney, onPick) {
    var t = F.theme(), labels = rows.map(function (r) { return r.label; }), data = rows.map(function (r) { return r.value; });
    var fmt = function (v) { return isMoney ? F.money(v) : F.num(v, 2); };
    var canDrill = typeof onPick === 'function';
    var tipTitle = canDrill ? { title: function (items) { return (items[0] ? items[0].label : '') + '  \u2192 click to drill in'; } } : {};
    var tip = { callbacks: Object.assign({ label: function (c) { var v = c.parsed && c.parsed.y != null && spec.type !== 'hbar' ? c.parsed.y : (c.parsed && c.parsed.x != null && spec.type === 'hbar' ? c.parsed.x : c.raw); return (c.datasetIndex ? ' ' + (c.dataset.label || '') + ': ' : ' ') + fmt(v); } }, tipTitle) };
    var pickHandlers = canDrill ? {
      onClick: function (evt, els) { if (els && els.length) onPick(els[0].index); },
      onHover: function (evt, els) { if (evt.native && evt.native.target) evt.native.target.style.cursor = (els && els.length) ? 'pointer' : 'default'; }
    } : {};
    if (spec.type === 'doughnut') {
      return { type: 'doughnut', data: { labels: labels, datasets: [{ data: data, backgroundColor: F.PALETTE, borderColor: t.light ? '#fff' : 'rgba(255,255,255,0)', borderWidth: 3, hoverOffset: 6 }] }, options: Object.assign({ cutout: '68%', plugins: { tooltip: tip } }, pickHandlers) };
    }
    var horiz = spec.type === 'hbar', line = spec.type === 'line';
    var ds = { data: data, borderRadius: 6, maxBarThickness: 34, backgroundColor: F.PALETTE[0] + 'cc', borderColor: F.PALETTE[0] };
    if (line) Object.assign(ds, { fill: true, tension: 0, cubicInterpolationMode: 'monotone', borderWidth: 2.5, pointRadius: canDrill ? 4 : 3, pointHoverRadius: 6, backgroundColor: F.PALETTE[0] + '22' });
    var val = { grid: { color: t.grid }, ticks: { color: t.text, callback: COMPACT }, beginAtZero: true };
    var cat = { grid: { display: false }, ticks: { color: t.text, maxRotation: 0, autoSkip: true } };
    var plug = { tooltip: tip };
    if (line) plug.dvLineMarks = { enabled: true, fmt: function (v) { return isMoney ? F.money(v, true) : COMPACT(Math.round(v * 10) / 10); } };
    return { type: line ? 'line' : 'bar', data: { labels: labels, datasets: [ds] }, options: Object.assign({ indexAxis: horiz ? 'y' : 'x', scales: horiz ? { x: val, y: cat } : { x: cat, y: val }, plugins: plug }, pickHandlers) };
  }
  function legend(rows, isMoney, drillable) {
    var total = rows.reduce(function (s, r) { return s + r.value; }, 0) || 1;
    return rows.map(function (r, i) {
      var pct = Math.round(r.value / total * 100), col = F.PALETTE[i % F.PALETTE.length];
      return '<div class="olx-leg' + (drillable ? ' is-drillable' : '') + '" style="--p:' + pct + '%;--c:' + col + '"' + (drillable ? ' data-i="' + i + '" tabindex="0" role="button" title="Click to drill in"' : '') + '><i style="background:' + F.PALETTE[i % F.PALETTE.length] + '"></i><span title="' + esc(r.label) + '">' + esc(r.label) + '</span><b>' + (isMoney ? F.money(r.value, true) : F.num(r.value)) + '</b><em>' + Math.round(r.value / total * 100) + '%</em></div>';
    }).join('');
  }
  /* Resolve which installed module owns a model, so a drill-in lands with the right breadcrumb/module selected. */
  function moduleForModel(model) {
    for (var i = 0; i < state.modules.length; i++) {
      var name = state.modules[i].technicalName, prof = PR.get(name);
      if (prof && prof.models.indexOf(model) > -1) return name;
    }
    return null;
  }
  /* Switch to Records, scoped to `model`, pre-filtered to the exact bar/segment/point clicked. */
  function drillInto(spec, row, customExtra, customText) {
    var base = spec.groupby ? spec.groupby.split(':')[0] : '', extra = customExtra || drillDomain(base, spec.groupby.indexOf(':') > -1, row);
    if (!extra) return;
    var mod = moduleForModel(spec.model), root = byId('view-odoo-live'), baseDomain = PR.tokens(spec.domain).concat(extra);
    root.classList.remove('olx-all');
    var apply = function () {
      C.fields(spec.model).then(function (fields) {
        state.fields = fields; state.activeModel = spec.model; populateControls();
        byId('odooLiveModelSelect').value = spec.model;
        state.filters = []; state.drill = baseDomain; state.drillMeta = { text: (spec.title || spec.model) + ' \u00B7 ' + (customText || row.fullLabel) };
        state.page = 0; renderChips(); state.dirty.records = true; showTab('records');
      }).catch(function (e) { showEmpty(safeError(e)); });
    };
    if (mod) {
      var m = state.modules.filter(function (x) { return x.technicalName === mod; })[0];
      byId('odooLiveCrumb').innerHTML = '<b>' + esc(m ? m.label : mod) + '</b><span>' + esc(mod) + '</span>';
      if (mod === state.activeModule && state.models.some(function (x) { return x.model === spec.model; })) { apply(); return; }
      state.activeModule = mod; byId('odooLiveModuleSelect').value = mod;
      byId('odooLiveModelSelect').disabled = true; byId('odooLiveModelSelect').innerHTML = '<option>Loading models…</option>';
      var seq = ++state.seq;
      resolveModels(mod).then(function (models) { if (seq !== state.seq) return; state.models = models; fillModelSelect(); apply(); }).catch(function (e) { showEmpty(safeError(e)); });
    } else {
      state.activeModule = spec.model;
      byId('odooLiveCrumb').innerHTML = '<b>' + esc(spec.title || spec.model) + '</b><span>' + esc(spec.model) + '</span>';
      apply();
    }
  }
  /* Detail strip under a line chart: latest vs previous, peak, low, average, total + 3-month trend overlay. */
  function lineStats(rows, isMoney, chart, host) {
    if (!host || rows.length < 2) { if (host) host.innerHTML = ''; return; }
    var f = function (v) { return isMoney ? F.money(v, Math.abs(v) >= 1e5) : F.num(v, v % 1 ? 1 : 0); };
    var vals = rows.map(function (r) { return r.value; }), last = rows[rows.length - 1], prev = rows[rows.length - 2];
    var hi = 0, lo = 0, sum = 0; vals.forEach(function (v, i) { sum += v; if (v > vals[hi]) hi = i; if (v < vals[lo]) lo = i; });
    var d = prev.value ? (last.value - prev.value) / Math.abs(prev.value) * 100 : null, flat = d != null && Math.abs(d) < 1;
    var partial = false; try { partial = last.dateBucket && String(last.fullLabel).toLowerCase() === new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }).toLowerCase(); } catch (e) {}
    function cell(label, val, sub, cls) { return '<div class="olx-st' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><b>' + esc(val) + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; }
    host.innerHTML = '<div class="olx-stats" role="group" aria-label="Chart summary">' +
      cell('Latest', f(last.value), (d == null ? '' : '<span class="olx-delta ' + (flat ? 'flat' : d >= 0 ? 'good' : 'bad') + '">' + (d >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(d).toFixed(1) + '%</span> ') + esc(last.label) + (partial ? ' \u00B7 in progress' : '')) +
      cell('Peak', f(vals[hi]), esc(rows[hi].label)) + cell('Low', f(vals[lo]), esc(rows[lo].label)) +
      cell('Average', f(sum / rows.length), 'per ' + (last.dateBucket ? 'month' : 'point')) + cell('Total', f(sum), rows.length + ' ' + (last.dateBucket ? 'months' : 'points')) +
      (rows.length >= 4 && chart ? '<button type="button" class="olx-st-tg" aria-pressed="false" title="Overlay a 3-month moving average to see the underlying direction">3-mo trend</button>' : '') + '</div>';
    var tg = host.querySelector('.olx-st-tg'); if (!tg || !chart) return;
    function setTrend(on) {
      var sets = chart.data.datasets;
      if (on) {
        sets.push({ label: '3-month trend', data: vals.map(function (v, i) { var a = vals.slice(Math.max(0, i - 2), i + 1); return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }),
          borderColor: F.PALETTE[1], backgroundColor: 'transparent', borderDash: [7, 5], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: false, tension: 0, cubicInterpolationMode: 'monotone', order: 1 });
      } else if (sets.length > 1) sets.length = 1;
      tg.setAttribute('aria-pressed', on ? 'true' : 'false'); tg.classList.toggle('is-on', on); chart.update();
    }
    tg.addEventListener('click', function () { setTrend(tg.getAttribute('aria-pressed') !== 'true'); });
    /* Very choppy series (average month-to-month swing > 35%): show the underlying direction by default. */
    var swing = 0, cnt = 0; for (var i = 1; i < vals.length; i++) if (vals[i - 1]) { swing += Math.abs(vals[i] - vals[i - 1]) / Math.abs(vals[i - 1]); cnt++; }
    if (rows.length >= 6 && cnt && swing / cnt > 0.35) setTrend(true);
  }
  function drawChartCard(id, spec) {
    var body = byId('olxb-' + id), leg = byId('olxl-' + id), sub = byId('olxs-' + id);
    if (!body) return Promise.resolve();
    return C.fields(spec.model).catch(function () { return {}; }).then(function (fields) {
      var meas = spec.measure || null, mf = meas ? fields[meas] : null, isMoney = !!(mf && mf.type === 'monetary');
      if (sub) sub.textContent = (meas ? 'Sum of ' + ((mf && mf.string) || meas) : 'Record count') + ' · by ' + ((fields[spec.groupby.split(':')[0]] || {}).string || spec.groupby.split(':')[0]) + (spec.groupby.indexOf(':') > -1 ? ' (monthly)' : '') + ' · click to drill in';
      return lim(function () { return C.readGroup(spec.model, { domain: PR.tokens(spec.domain), fields: meas ? [meas + ':sum'] : [], groupby: [spec.groupby] }); }).then(function (groups) {
        var rows = rowsFrom(groups, spec.groupby, meas, fields, spec);
        if (!rows.length || rows.every(function (r) { return !r.value; })) { body.innerHTML = '<div class="olx-empty-s">No data to chart yet.</div>'; if (leg) leg.innerHTML = ''; return; }
        body.innerHTML = '<canvas id="olxc-' + id + '"></canvas>';
        var onPick = function (idx) { var r = rows[idx]; if (r) drillInto(spec, r); };
        var inst = F.chart('olxc-' + id, chartConfig(spec, rows, isMoney, onPick));
        if (leg) {
          leg.innerHTML = spec.type === 'doughnut' ? legend(rows, isMoney, true) : '';
          if (spec.type === 'line') lineStats(rows, isMoney, inst, leg);
          if (spec.type === 'doughnut') leg.querySelectorAll('[data-i]').forEach(function (el) {
            var act = function () { var r = rows[+el.getAttribute('data-i')]; if (r) drillInto(spec, r); };
            el.addEventListener('click', act); el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
          });
        }
      });
    }).catch(function (e) { body.innerHTML = '<div class="olx-empty-s is-error" role="alert">Not available: ' + esc(safeError(e)) + '</div>'; if (leg) leg.innerHTML = ''; });
  }
  function fillKpi(i, spec) {
    var el = byId('olxk-' + i); if (!el) return;
    var run = spec.measure ? C.sum(spec.model, PR.tokens(spec.domain), spec.measure) : C.count(spec.model, PR.tokens(spec.domain)).then(function (n) { return { count: n, sum: 0 }; });
    run.then(function (r) {
      var main, sub = spec.sub || '';
      if (spec.kind === 'count') { main = F.num(r.count || 0); if (spec.measure) sub = F.money(r.sum, true) + ' · ' + sub; }
      else main = spec.kind === 'money' ? F.money(r.sum, r.sum >= 1e5) : F.num(r.sum, 1);
      el.querySelector('.olx-k-val').textContent = main; el.querySelector('.olx-k-sub').textContent = sub; el.classList.remove('is-loading');
    }).catch(function (e) { el.classList.remove('is-loading'); el.classList.add('is-error');     el.querySelector('.olx-k-val').textContent = 'n/a'; el.querySelector('.olx-k-sub').textContent = safeError(e); });
  }
  function loadInsights() {
    state.dirty.insights = false;
    var prof = profileFor(), started = Date.now();
    setStatus('connecting', 'Syncing…');
    byId('odooLiveKpis').innerHTML = prof.kpis.map(function (k, i) {
      return '<div class="olx-kpi is-loading" id="olxk-' + i + '"><p class="olx-k-label">' + esc(k.label) + '</p><p class="olx-k-val">…</p><p class="olx-k-sub">' + esc(k.sub || '') + '</p></div>';
    }).join('');
    byId('odooLiveCharts').innerHTML = prof.charts.map(function (c, i) {
      return '<div class="panel olx-chart"><div class="chart-header"><div><h3>' + esc(c.title) + '</h3><p class="chart-subtitle" id="olxs-c' + i + '">Loading…</p></div></div>' +
        '<div class="olx-chart-body" id="olxb-c' + i + '"><div class="olx-skel"></div></div><div class="olx-legend" id="olxl-c' + i + '"></div></div>';
    }).join('') || '<div class="olx-empty">Nothing to chart for this model — open Records to browse it.</div>';
    prof.kpis.forEach(function (k, i) { fillKpi(i, k); });
    Promise.all(prof.charts.map(function (c, i) { return drawChartCard('c' + i, c); })).then(function () {
      state.lastSynced = new Date(); setStatus('live', 'Live · ' + (Date.now() - started) + ' ms'); renderConn();
    });
  }

  /* -- Executive suite (directors / top management) ------------------------------------
     Role lenses (CEO, Commercial, CFO, COO, HR), period-over-period KPIs with sparklines,
     cost-aware colouring, cross-module financial position, concentration risk,
     "needs attention" alerts, a rule-based executive summary, scorecard CSV and print/PDF.
     Requests are queued (max 5 in flight) so a whole-company view never floods Odoo. -------- */
  var PERIODS = [[30, '30 days'], [90, '90 days'], [365, '12 months'], [-1, 'Year to date']];
  var LENSES = [
    ['company', 'Company \u00B7 CEO', null],
    ['commercial', 'Commercial', ['sale', 'crm']],
    ['finance', 'Finance \u00B7 CFO', ['account']],
    ['operations', 'Operations \u00B7 COO', ['purchase', 'stock', 'mrp', 'project']],
    ['people', 'People \u00B7 HR', ['hr']]
  ];
  var LENS_KEY = 'dashview_odoo_lens', PERIOD_KEY = 'dashview_odoo_period';
  var DERIVED = { ratio: 1, diff: 1, pct: 1 };
  state.lens = loadJSON(LENS_KEY, 'company'); state.period = loadJSON(PERIOD_KEY, 30); state.xseq = 0; state.reg = []; state.areg = [];
  if (!PERIODS.some(function (p) { return p[0] === state.period; })) state.period = 30;
  if (!LENSES.some(function (l) { return l[0] === state.lens; })) state.lens = 'company';

  var Q = { n: 0, q: [] };
  function pump() {
    while (Q.n < 5 && Q.q.length) {
      var t = Q.q.shift();
      if (t.x && t.gen !== state.xseq) continue;               /* stale render: drop silently */
      Q.n++;
      Promise.resolve().then(t.fn).then(t.res, t.rej).then(function () { Q.n--; pump(); });
    }
  }
  function lim(fn) { return new Promise(function (res, rej) { Q.q.push({ fn: fn, res: res, rej: rej, gen: state.xseq, x: state.tab === 'executive' }); pump(); }); }

  function periodDays() { if (state.period !== -1) return state.period; var n = new Date(); return Math.max(1, Math.ceil((n - new Date(n.getFullYear(), 0, 1)) / 864e5)); }
  function periodLabel() { return state.period === -1 ? 'year to date' : state.period === 365 ? '12 months' : state.period + ' days'; }
  function cmpLabel() { return state.period === -1 ? 'the previous equal period' : 'the previous ' + periodLabel(); }
  function hasApp(a) { return state.modules.some(function (m) { return PR.exec(m.technicalName) && PR.exec(m.technicalName) === PR.exec(a); }); }

  function execVal(k, from, to) {
    var d = PR.tokens(k.domain);
    if (k.date) d = d.concat([[k.date, '>=', PR.ago(from)]], to ? [[k.date, '<', PR.ago(to)]] : []);
    return lim(function () { return C.sum(k.model, d, k.measure || null); }).then(function (r) { return k.measure ? r.sum : r.count; });
  }
  function derive(k, a) {
    var x = a[k.of[0]], y = a[k.of[1]];
    if (x == null || y == null) return null;
    if (k.kind === 'ratio') return y ? x / y : 0;
    if (k.kind === 'pct') return y ? x / y * 100 : 0;
    return x - y;
  }
  function xFmt(k, v) {
    if (k.kind === 'pct') return v.toFixed(1) + '%';
    return (k.kind === 'money' || k.money) ? F.money(v, Math.abs(v) >= 1e5) : F.num(v, 0);
  }
  function xCard(id, k) {
    return '<div class="olx-kpi olx-xk is-loading" id="' + id + '"><p class="olx-k-label">' + esc(k.label) + '</p><p class="olx-k-val">\u2026</p><p class="olx-k-sub">' + esc(k.sub || '') + '</p>' +
      (k.date && !DERIVED[k.kind] ? '<div class="olx-spark"><canvas id="' + id + '-s"></canvas></div>' : '') + '</div>';
  }
  function drawSpark(cid, k) {
    return lim(function () { return C.readGroup(k.model, { domain: PR.tokens(k.domain), fields: k.measure ? [k.measure + ':sum'] : [], groupby: [k.date + ':month'] }); }).then(function (g) {
      var rows = rowsFrom(g, k.date + ':month', k.measure || null, {}, { last: 12 }); if (rows.length < 2 || !byId(cid)) return;
      F.chart(cid, { type: 'line', data: { labels: rows.map(function (r) { return r.label; }), datasets: [{ data: rows.map(function (r) { return r.value; }), borderColor: F.PALETTE[0], backgroundColor: F.PALETTE[0] + '22', fill: true, tension: 0, cubicInterpolationMode: 'monotone', borderWidth: 2, pointRadius: 0 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } } } });
    }).catch(function () {});
  }
  function fillXKpis(prefix, ks, days, title) {
    var gen = state.xseq, cur = [], prev = [];
    return Promise.all(ks.map(function (k, i) {
      if (DERIVED[k.kind]) return null;
      return Promise.all([execVal(k, days, 0), k.date ? execVal(k, days * 2, days) : Promise.resolve(null)])
        .then(function (r) { cur[i] = r[0]; prev[i] = r[1]; }).catch(function () {});
    })).then(function () {
      if (gen !== state.xseq) return;
      ks.forEach(function (k, i) { if (DERIVED[k.kind]) { cur[i] = derive(k, cur); prev[i] = derive(k, prev); } });
      ks.forEach(function (k, i) {
        var el = byId(prefix + i); if (!el) return; el.classList.remove('is-loading');
        if (cur[i] == null) { el.classList.add('is-error'); el.querySelector('.olx-k-val').textContent = 'n/a'; el.querySelector('.olx-k-sub').textContent = 'Not readable by this Odoo user'; return; }
        el.querySelector('.olx-k-val').textContent = xFmt(k, cur[i]);
        var sub = el.querySelector('.olx-k-sub'), p = prev[i];
        if (p != null && p !== 0 && (k.date || DERIVED[k.kind])) {
          var d = (cur[i] - p) / Math.abs(p) * 100, up = d >= 0, good = k.inverse ? !up : up;
          var flat = Math.abs(d) < 1; el.setAttribute('data-trend', flat ? 'flat' : good ? 'good' : 'bad');
          sub.innerHTML = '<span class="olx-delta ' + (flat ? 'flat' : good ? 'good' : 'bad') + '">' + (up ? '\u25B2 ' : '\u25BC ') + Math.abs(d).toFixed(1) + '%</span> vs ' + esc(cmpLabel()) +
            '<span class="olx-prev">Previous ' + esc(xFmt(k, p)) + ' \u00B7 ' + (cur[i] - p >= 0 ? '+' : '\u2212') + esc(xFmt(k, Math.abs(cur[i] - p))) + '</span>';
          el.title = k.label + ': ' + xFmt(k, cur[i]) + ' now, ' + xFmt(k, p) + ' previous period (' + (up ? '+' : '-') + Math.abs(d).toFixed(1) + '%)' + (k.inverse ? '. Lower is better.' : '.');
        } else if (k.date) sub.textContent = 'Last ' + periodLabel() + ' \u00B7 no earlier data to compare';
        state.reg.push({ id: prefix + i, section: title, k: k, cur: cur[i], prev: p == null ? null : p, parts: DERIVED[k.kind] ? (k.of || []).map(function (j) { return ks[j] && ks[j].label; }).filter(Boolean) : null });
        el.classList.add('is-clickable'); el.setAttribute('tabindex', '0'); el.setAttribute('role', 'button'); el.setAttribute('aria-label', k.label + ': ' + xFmt(k, cur[i]) + '. Open details');
        el.insertAdjacentHTML('beforeend', '<span class="olx-more" aria-hidden="true">Details \u203A</span>');
        if (k.date && !DERIVED[k.kind]) drawSpark(prefix + i + '-s', k);
      });
    });
  }
  function xAlerts(list, host) {
    var gen = state.xseq;
    if (!list.length) return Promise.resolve();
    host.innerHTML = list.map(function (a, i) { return '<div class="olx-alert tone-' + (a.tone || 'warn') + '" id="' + host.id + '-' + i + '"><b>\u2026</b><span>' + esc(a.label) + '</span><em></em></div>'; }).join('');
    return Promise.all(list.map(function (a, i) {
      return lim(function () { return C.sum(a.model, PR.tokens(a.domain), a.measure || null); }).then(function (r) {
        if (gen !== state.xseq) return;
        var el = byId(host.id + '-' + i); if (!el) return;
        el.querySelector('b').textContent = F.num(r.count || 0);
        el.querySelector('em').textContent = a.measure ? F.money(r.sum, true) : '';
        if (!r.count) el.classList.add('is-clear');
        state.areg.push({ label: a.label, count: r.count || 0, sum: a.measure ? r.sum : null, tone: a.tone });
      }).catch(function () { var el = byId(host.id + '-' + i); if (el) el.style.display = 'none'; });
    }));
  }
  /* Concentration risk: how much of revenue / spend sits with the top 5 partners (last 12 months). */
  function loadRisk(host) {
    var gen = state.xseq, defs = [];
    if (hasApp('sale')) defs.push({ label: 'Customer concentration', model: 'sale.order', date: 'date_order', domain: [['state', 'in', ['sale', 'done']]], noun: 'customers', what: 'confirmed revenue' });
    if (hasApp('purchase')) defs.push({ label: 'Vendor concentration', model: 'purchase.order', date: 'date_order', domain: [['state', 'in', ['purchase', 'done']]], noun: 'vendors', what: 'confirmed spend' });
    if (!defs.length) { host.closest('.olx-xattn').hidden = true; return Promise.resolve(); }
    host.innerHTML = defs.map(function (d, i) { return '<div class="olx-risk" id="olxr-' + i + '"><span>' + esc(d.label) + '</span><b>\u2026</b><em>Top 5 share, last 12 months</em></div>'; }).join('');
    return Promise.all(defs.map(function (d, i) {
      var dom = d.domain.concat([[d.date, '>=', PR.ago(365)]]);
      return lim(function () { return C.readGroup(d.model, { domain: dom, fields: ['amount_total:sum'], groupby: ['partner_id'] }); }).then(function (g) {
        if (gen !== state.xseq) return;
        var el = byId('olxr-' + i); if (!el) return;
        var rows = rowsFrom(g, 'partner_id', 'amount_total', {}, { limit: 100000 }), total = rows.reduce(function (s, r) { return s + r.value; }, 0);
        if (!total) { el.querySelector('b').textContent = '\u2013'; el.querySelector('em').textContent = 'No ' + d.what + ' in the last 12 months'; return; }
        var top5 = rows.slice(0, 5).reduce(function (s, r) { return s + r.value; }, 0), pct = top5 / total * 100, big = rows[0].value / total * 100;
        el.classList.add(pct >= 60 ? 'tone-bad' : pct >= 40 ? 'tone-warn' : 'tone-ok');
        el.querySelector('b').textContent = pct.toFixed(0) + '%';
        el.insertAdjacentHTML('beforeend', '<i class="olx-gauge" role="img" aria-label="Top 5 hold ' + pct.toFixed(0) + ' percent"><u style="width:' + Math.min(100, pct).toFixed(0) + '%"></u><s style="left:40%"></s><s style="left:60%"></s></i>');
        el.querySelector('em').textContent = 'Top 5 of ' + rows.length + ' ' + d.noun + ' \u00B7 largest: ' + rows[0].label + ' (' + big.toFixed(0) + '%)';
        state.areg.push({ label: d.label, count: 0, note: pct.toFixed(0) + '% of ' + d.what + ' sits with 5 ' + d.noun, tone: pct >= 60 ? 'bad' : pct >= 40 ? 'warn' : 'ok', risk: pct >= 40 });
      }).catch(function () { var el = byId('olxr-' + i); if (el) el.style.display = 'none'; });
    }));
  }
  /* Rule-based summary (no AI): biggest favourable / unfavourable movers + open alerts. */
  function kpiStatus(r) {
    if (DERIVED[r.k.kind] && r.prev == null) return 'na';
    if (r.cur == null || r.prev == null || r.prev === 0 || !(r.k.date || DERIVED[r.k.kind])) return 'na';
    var d = (r.cur - r.prev) / Math.abs(r.prev) * 100;
    if (Math.abs(d) < 1) return 'flat';
    return (r.k.inverse ? d < 0 : d > 0) ? 'good' : 'bad';
  }
  function renderHeadline() {
    var head = byId('olxHead'); if (!head) return;
    var n = { good: 0, bad: 0, flat: 0, na: 0 }, secs = {};
    state.reg.forEach(function (r) {
      var st = kpiStatus(r); n[st]++;
      var o = secs[r.section] || (secs[r.section] = { good: 0, bad: 0, flat: 0, na: 0 }); o[st]++;
    });
    var scored = n.good + n.bad + n.flat, unreadable = document.querySelectorAll('#odooLiveExec .olx-xk.is-error').length;
    var alerts = state.areg.filter(function (a) { return a.count > 0 || a.risk; }), urgent = alerts.filter(function (a) { return a.tone === 'bad'; }).length;
    var pct = scored ? Math.round(n.good / scored * 100) : null;
    var verdict = pct == null ? 'Not enough comparable data in this period to score performance.'
      : (pct >= 60 && urgent === 0 ? 'Performance is healthy: most KPIs are moving the right way'
        : pct >= 40 ? 'Performance is mixed: favourable and unfavourable movements are balanced'
          : 'Performance needs attention: most KPIs are moving the wrong way') + (urgent ? ', with ' + urgent + ' high-priority alert' + (urgent > 1 ? 's' : '') + ' open.' : '.');
    var tile = function (cls, val, label) { return '<div class="olx-ht ' + cls + '"><b>' + val + '</b><span>' + label + '</span></div>'; };
    head.innerHTML = '<div class="olx-hverdict"><strong>Overall</strong><span>' + esc(verdict) + '</span></div><div class="olx-htiles">' +
      tile('is-good', n.good, 'Improving') + tile('is-flat', n.flat, 'Stable') + tile('is-bad', n.bad, 'Declining') +
      tile(urgent ? 'is-bad' : alerts.length ? 'is-warn' : 'is-good', alerts.length, 'Open alerts') +
      tile('is-na', n.na + unreadable, 'Not comparable') + (pct == null ? '' : tile(pct >= 60 ? 'is-good' : pct >= 40 ? 'is-warn' : 'is-bad', pct + '%', 'KPIs favourable')) + '</div>';
    document.querySelectorAll('#odooLiveExec .olx-xtitle[data-title]').forEach(function (b) {
      var o = secs[b.getAttribute('data-title')], old = b.querySelector('.olx-sbadge'); if (old) old.remove();
      if (!o || !(o.good + o.bad + o.flat)) return;
      var tot = o.good + o.bad + o.flat, sp = document.createElement('i');
      sp.className = 'olx-sbadge ' + (o.good / tot >= .6 ? 'is-good' : o.good / tot >= .4 ? 'is-warn' : 'is-bad');
      sp.textContent = o.good + '/' + tot + ' favourable'; b.insertBefore(sp, b.querySelector('span'));
    });
  }
  function renderBasis() {
    var box = byId('olxBasis'); if (!box) return;
    var models = {}; state.reg.forEach(function (r) { if (r.k.model) models[r.k.model] = 1; });
    var cur = state.currency || ''; if (!cur && C.currency) C.currency().then(function (c) { if (c) { state.currency = c; renderBasis(); } }, function () {});
    var unreadable = document.querySelectorAll('#odooLiveExec .olx-xk.is-error').length;
    box.innerHTML = '<h4>Basis &amp; data notes</h4><ul>' +
      '<li><b>Period</b> ' + esc(periodLabel()) + ' compared with ' + esc(cmpLabel()) + '. A change under 1% is treated as stable.</li>' +
      '<li><b>Colour logic</b> Green = favourable, red = unfavourable. Cost-type metrics (spend, vendor bills, receivable) are coloured inversely: lower is better.</li>' +
      '<li><b>Source</b> Live Odoo read-only queries' + (Object.keys(models).length ? ' on ' + esc(Object.keys(models).join(', ')) : '') + (cur ? '. Amounts in ' + esc(cur) : '') + '. Nothing is estimated or back-filled.</li>' +
      (unreadable ? '<li><b>Coverage</b> ' + unreadable + ' KPI' + (unreadable > 1 ? 's' : '') + ' could not be read (module not installed or no access rights) and are excluded from the scoring above.</li>' : '') +
      '<li><b>Summary</b> is rule-based (no AI). Use Export scorecard for the full figures behind every number.</li></ul>';
  }
  function renderNarrative() {
    renderHeadline(); renderBasis();
    var box = byId('olxNarr'); if (!box) return;
    var moves = state.reg.filter(function (r) { return !DERIVED[r.k.kind] && r.k.date && r.prev > 0 && r.cur != null; }).map(function (r) {
      var d = (r.cur - r.prev) / r.prev * 100; return { r: r, d: d, good: r.k.inverse ? d < 0 : d > 0 };
    }).filter(function (m) { return Math.abs(m.d) >= 1; }).sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });
    var line = function (m) { return '<li><b>' + esc(m.r.section + ' \u00B7 ' + m.r.k.label) + '</b> ' + (m.d > 0 ? 'up ' : 'down ') + Math.abs(m.d).toFixed(1) + '% to ' + esc(xFmt(m.r.k, m.r.cur)) + '</li>'; };
    var good = moves.filter(function (m) { return m.good; }).slice(0, 3), bad = moves.filter(function (m) { return !m.good; }).slice(0, 3);
    var att = state.areg.filter(function (a) { return a.count > 0 || a.risk; }).sort(function (a, b) { return (b.tone === 'bad') - (a.tone === 'bad'); }).slice(0, 4);
    var col = function (t, cls, items, empty) { return '<div class="olx-ncol ' + cls + '"><h4>' + t + '</h4><ul>' + (items.length ? items.join('') : '<li class="olx-none">' + empty + '</li>') + '</ul></div>'; };
    box.querySelector('.olx-narr-body').innerHTML =
      col('Going well', 'is-good', good.map(line), 'No significant favourable movement') +
      col('Watch closely', 'is-watch', bad.map(line), 'No significant unfavourable movement') +
      col('Needs attention', 'is-att', att.map(function (a) { return '<li><b>' + esc(a.note ? a.label : a.label) + '</b> ' + (a.note ? esc(a.note) : F.num(a.count) + (a.sum != null ? ' \u00B7 ' + esc(F.money(a.sum, true)) : '')) + '</li>'; }), 'Nothing flagged right now');
  }
  /* -- KPI detail drawer: click any executive KPI for the numbers, definition, 12-month trend, drill-in -- */
  var kdOpener = null;
  function domText(d) {
    return d.map(function (t) { return t[0] + ' ' + t[1] + ' ' + (Array.isArray(t[2]) ? '(' + t[2].join(', ') + ')' : t[2]); }).join('  AND  ');
  }
  function closeKpiDetail() {
    var d = byId('olxKd'); if (d) d.remove();
    document.removeEventListener('keydown', kdKey);
    if (kdOpener && document.body.contains(kdOpener)) { try { kdOpener.focus(); } catch (e) {} } kdOpener = null;
  }
  function kdKey(e) {
    if (e.key === 'Escape') { closeKpiDetail(); return; }
    if (e.key !== 'Tab') return;
    var f = byId('olxKd') && byId('olxKd').querySelectorAll('button,[href],[tabindex]:not([tabindex="-1"])'); if (!f || !f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function openKpiDetail(id, opener) {
    var r = state.reg.filter(function (x) { return x.id === id; })[0]; if (!r) return;
    closeKpiDetail(); kdOpener = opener || null;
    var k = r.k, st = kpiStatus(r), SL = { good: 'Improving', bad: 'Declining', flat: 'Stable', na: 'Not comparable' };
    var ch = (r.prev != null && r.prev !== 0 && r.cur != null) ? (r.cur - r.prev) / Math.abs(r.prev) * 100 : null;
    var up = ch != null && ch >= 0, derived = !!DERIVED[k.kind];
    var cell = function (l, v, cls) { return '<div class="olx-kd-c' + (cls ? ' ' + cls : '') + '"><span>' + l + '</span><b>' + v + '</b></div>'; };
    var def = derived
      ? '<li><b>Calculated</b> ' + (k.kind === 'ratio' ? 'ratio' : k.kind === 'pct' ? 'percentage' : 'difference') + ' of ' + esc((r.parts || []).join(' and ') || 'other KPIs') + '</li>'
      : '<li><b>Source</b> <code>' + esc(k.model || '') + '</code></li>' +
        '<li><b>Measure</b> ' + (k.measure ? 'Sum of <code>' + esc(k.measure) + '</code>' : 'Record count') + '</li>' +
        '<li><b>Filter</b> <code>' + esc(domText(PR.tokens(k.domain)) || 'none') + '</code></li>' +
        (k.date ? '<li><b>Date field</b> <code>' + esc(k.date) + '</code> \u00B7 last ' + esc(periodLabel()) + ' vs ' + esc(cmpLabel()) + '</li>' : '<li><b>Timing</b> Point-in-time (no period comparison)</li>');
    var el = document.createElement('div'); el.id = 'olxKd'; el.className = 'olx-kd';
    el.innerHTML = '<div class="olx-kd-back" data-close="1"></div><aside class="olx-kd-panel" role="dialog" aria-modal="true" aria-labelledby="olxKdT">' +
      '<header><div><small>' + esc(r.section) + '</small><h3 id="olxKdT">' + esc(k.label) + '</h3></div><button type="button" class="olx-kd-x" data-close="1" aria-label="Close details">\u2715</button></header>' +
      '<div class="olx-kd-hero"><strong>' + esc(xFmt(k, r.cur)) + '</strong>' + (ch == null ? '' : '<span class="olx-delta ' + (Math.abs(ch) < 1 ? 'flat' : (k.inverse ? !up : up) ? 'good' : 'bad') + '">' + (up ? '\u25B2 ' : '\u25BC ') + Math.abs(ch).toFixed(1) + '%</span>') + '</div>' +
      '<div class="olx-kd-grid">' + cell('Previous period', r.prev == null ? '\u2013' : esc(xFmt(k, r.prev))) +
        cell('Change', r.prev == null ? '\u2013' : (r.cur - r.prev >= 0 ? '+' : '\u2212') + esc(xFmt(k, Math.abs(r.cur - r.prev)))) +
        cell('Status', SL[st], 'is-' + st) + cell('Better when', k.inverse ? 'Lower' : 'Higher') + '</div>' +
      (k.date && !derived ? '<h4>Last 12 months</h4><div class="olx-kd-chart" id="olxKdCh"><div class="olx-skel"></div></div><div id="olxKdTb"></div>' : '') +
      '<h4>How this is calculated</h4><ul class="olx-kd-def">' + def + '</ul>' +
      '<div class="olx-kd-act">' + (!derived && k.model ? '<button type="button" class="btn btn-primary btn-sm" id="olxKdExp">Explore breakdown \u2192</button><button type="button" class="btn btn-outline btn-sm" id="olxKdRec">View records \u2192</button>' : '') + '<button type="button" class="btn btn-outline btn-sm" data-close="1">Close</button></div></aside>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeKpiDetail(); });
    document.addEventListener('keydown', kdKey);
    var exp = byId('olxKdExp');
    if (exp) exp.addEventListener('click', function () {
      closeKpiDetail();
      if (window.DVDrill) window.DVDrill.open({ title: r.section + ' \u00B7 ' + k.label, model: k.model, domain: k.domain, measure: k.measure || null, date: k.date || null, kind: (k.kind === 'money' || k.money) ? 'money' : 'count', inverse: !!k.inverse }, opener);
    });
    var rec = byId('olxKdRec');
    if (rec) rec.addEventListener('click', function () {
      var extra = k.date ? [[k.date, '>=', PR.ago(periodDays())]] : [];
      closeKpiDetail();
      drillInto({ model: k.model, title: r.section + ' \u00B7 ' + k.label, domain: k.domain }, null, extra, k.date ? 'last ' + periodLabel() : 'all matching');
    });
    var close = el.querySelector('.olx-kd-x'); if (close) close.focus();
    if (!(k.date && !derived)) return;
    lim(function () { return C.readGroup(k.model, { domain: PR.tokens(k.domain), fields: k.measure ? [k.measure + ':sum'] : [], groupby: [k.date + ':month'] }); }).then(function (g) {
      var rows = rowsFrom(g, k.date + ':month', k.measure || null, {}, { last: 12 }), box = byId('olxKdCh'); if (!box) return;
      if (rows.length < 2) { box.innerHTML = '<div class="olx-empty-s">Not enough history to chart.</div>'; return; }
      var t = F.theme(), money = k.kind === 'money' || k.money, fv = function (v) { return money ? F.money(v, Math.abs(v) >= 1e5) : F.num(v, 0); };
      box.innerHTML = '<canvas id="olxKdCv"></canvas>';
      var avg = rows.reduce(function (s, x) { return s + x.value; }, 0) / rows.length;
      F.chart('olxKdCv', { type: 'bar', data: { labels: rows.map(function (x) { return x.label; }), datasets: [{ data: rows.map(function (x) { return x.value; }), borderColor: F.PALETTE[0], backgroundColor: F.PALETTE[0] + 'cc', borderRadius: 6, maxBarThickness: 30, order: 2 },
          { type: 'line', data: rows.map(function () { return avg; }), borderColor: t.text, borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, fill: false, order: 1 }] },
        options: { scales: { x: { grid: { display: false }, ticks: { color: t.text, maxRotation: 0, autoSkip: true } }, y: { beginAtZero: true, grid: { color: t.grid }, ticks: { color: t.text, callback: function (v) { return money ? F.money(v, true) : F.num(v, 0); } } } },
          plugins: { tooltip: { callbacks: { label: function (c) { return (c.datasetIndex ? ' 12-mo average ' : ' ') + fv(c.parsed.y); } } } } } });
      var last = rows.slice(-6).reverse();
      byId('olxKdTb').innerHTML = '<table class="olx-kd-tb"><thead><tr><th>Month</th><th>Value</th><th>vs prior month</th></tr></thead><tbody>' + last.map(function (x, i) {
        var prv = rows[rows.length - 1 - i - 1], d = prv && prv.value ? (x.value - prv.value) / Math.abs(prv.value) * 100 : null, good = d != null && (k.inverse ? d < 0 : d > 0);
        return '<tr><td>' + esc(x.label) + '</td><td>' + esc(fv(x.value)) + '</td><td>' + (d == null ? '\u2013' : '<span class="olx-delta ' + (Math.abs(d) < 1 ? 'flat' : good ? 'good' : 'bad') + '">' + (d >= 0 ? '\u25B2 ' : '\u25BC ') + Math.abs(d).toFixed(1) + '%</span>') + '</td></tr>';
      }).join('') + '</tbody></table><p class="olx-kd-note">Dashed line = 12-month average. Months with no activity are not shown by Odoo.</p>';
    }).catch(function () { var box = byId('olxKdCh'); if (box) box.innerHTML = '<div class="olx-empty-s is-error">Trend not available for this KPI.</div>'; });
  }
  (function () {
    var xb = byId('odooLiveExec'); if (!xb) return;
    var go = function (e) { var c = e.target.closest && e.target.closest('.olx-xk.is-clickable'); if (c && xb.contains(c)) openKpiDetail(c.id, c); };
    xb.addEventListener('click', go);
    xb.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('olx-xk')) { e.preventDefault(); go(e); } });
  })();
  /* "All 3 companies" / "Alpha, Beta" - which companies the numbers cover (empty on single-company databases). */
  function scopeLabel() {
    var list = C.companyList ? C.companyList() : [], ids = C.activeCompanyIds ? C.activeCompanyIds() : [];
    if (list.length < 2 || !ids.length) return '';
    if (ids.length >= list.length) return 'All ' + list.length + ' companies';
    return list.filter(function (c) { return ids.indexOf(c.id) > -1; }).map(function (c) { return c.name; }).join(', ');
  }
  function exportScorecard() {
    if (!state.reg.length) return;
    var rnd = function (v) { return v == null ? '' : Math.round(v * 100) / 100; };
    var rows = [['Section', 'KPI', 'Period', 'Current', 'Previous period', 'Change (abs)', 'Change %', 'Status']], sc = scopeLabel();
    if (sc) rows.unshift(['Companies', sc]);
    var SL = { good: 'Improving', bad: 'Declining', flat: 'Stable', na: 'Not comparable' };
    state.reg.forEach(function (r) { rows.push([r.section, r.k.label, periodLabel(), rnd(r.cur), rnd(r.prev), r.prev != null && r.cur != null ? rnd(r.cur - r.prev) : '', r.prev ? rnd((r.cur - r.prev) / Math.abs(r.prev) * 100) : '', SL[kpiStatus(r)]]); });
    state.areg.forEach(function (a) { rows.push(['Attention', a.label, 'as of now', a.count || '', a.sum != null ? rnd(a.sum) : '', '', '', a.note || (a.tone === 'bad' ? 'High priority' : 'Review')]); });
    F.download('executive-scorecard-' + (state.activeModule === '__all__' ? state.lens : state.activeModule) + '-' + new Date().toISOString().slice(0, 10) + '.csv', F.csv(rows));
    if (window.DVSec) window.DVSec.log('Exported executive scorecard', rows.length - 1 + ' rows');
  }
  function printReport() {
    var head = byId('olxPrintHead'), c = C.cfg(), host = ''; try { host = new URL(c.url).host; } catch (e) { host = c.url || ''; }
    var lens = state.activeModule === '__all__' ? (LENSES.filter(function (l) { return l[0] === state.lens; })[0] || LENSES[0])[1] : (byId('odooLiveCrumb').textContent || '');
    if (head) head.innerHTML = '<h1>Executive report \u2014 ' + esc(lens) + '</h1><p>' + esc(host) + ' \u00B7 ' + esc(c.db || '') + (scopeLabel() ? ' \u00B7 ' + esc(scopeLabel()) : '') + ' \u00B7 Period: ' + esc(periodLabel()) + ' vs ' + esc(cmpLabel()) + ' \u00B7 Generated ' + esc(new Date().toLocaleString()) + '</p>';
    document.body.classList.add('olx-print-exec');
    var done = function () { document.body.classList.remove('olx-print-exec'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function () { F.resizeCharts(byId('view-odoo-live')); window.print(); }, 150);
  }
  function chartCard(id, c, wide) {
    return '<div class="panel olx-chart' + (wide ? ' olx-wide' : '') + '"><div class="chart-header"><div><h3>' + esc(c.title) + '</h3><p class="chart-subtitle" id="olxs-' + id + '">Loading\u2026</p></div></div><div class="olx-chart-body" id="olxb-' + id + '"><div class="olx-skel"></div></div><div class="olx-legend" id="olxl-' + id + '"></div></div>';
  }
  function toolbar(title, sub, withLens) {
    return '<div class="olx-print-head" id="olxPrintHead"></div>' +
      '<div class="olx-xhead"><div><h2>' + esc(title) + '</h2><p>' + esc(sub) + ' \u00B7 <span id="olxAsOf">syncing\u2026</span></p></div>' +
      '<div class="olx-xtools"><div class="seg" id="odooLivePeriod" role="group" aria-label="Period">' + PERIODS.map(function (p) { return '<button type="button" data-days="' + p[0] + '"' + (state.period === p[0] ? ' class="active"' : '') + '>' + p[1] + '</button>'; }).join('') + '</div>' +
      '<button class="btn btn-outline btn-sm" id="olxRefresh" type="button" title="Re-read live Odoo data">\u21BB Refresh</button><button class="btn btn-outline btn-sm" id="olxExportScore" type="button">Export scorecard</button><button class="btn btn-primary btn-sm" id="olxPrint" type="button">Print / PDF</button></div></div>' +
      (withLens ? '<div class="seg olx-lens" id="olxLens" role="group" aria-label="Executive lens">' + LENSES.map(function (l) { return '<button type="button" data-lens="' + l[0] + '"' + (state.lens === l[0] ? ' class="active"' : '') + '>' + esc(l[1]) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="olx-headline" id="olxHead" aria-live="polite"></div><div class="panel olx-narr" id="olxNarr"><h3>Executive summary <small>auto-generated from live Odoo data \u00B7 rule-based</small></h3><div class="olx-narr-body"><div class="olx-skel"></div></div></div>';
  }
  function secHtml(a, o) {
    var X = PR.exec(a), h = '<section class="olx-xsec"><button type="button" class="olx-xtitle" data-mod="' + esc(a) + '" data-title="' + esc(X.title) + '">' + esc(X.title) + ' <span>Open module \u2192</span></button>';
    if (o.kpis) h += '<div class="olx-kpis olx-xkpis">' + X.kpis.map(function (k, i) { return xCard('xk-' + a + '-' + i, k); }).join('') + '</div>';
    if (o.charts) { var cs = (X.trend ? [X.trend] : []).concat(X.charts); h += '<div class="olx-charts olx-xcharts">' + cs.map(function (c, i) { return chartCard('x' + a + i, c, X.trend && i === 0); }).join('') + '</div>'; }
    return h + '</section>';
  }
  function fallbackExec() {
    var p = state.activeModel ? profileFor() : { title: state.activeModule, kpis: [], charts: [] };
    return { title: p.title, kpis: p.kpis, trend: null, charts: p.charts.slice(0, 3), alerts: [] };
  }
  function loadExecutive() {
    state.dirty.exec = false; state.xseq++; state.reg = []; state.areg = []; closeKpiDetail();
    var box = byId('odooLiveExec'), days = periodDays(), started = Date.now(), all = state.activeModule === '__all__', jobs = [], alerts = [], html;
    var att = '<div class="panel olx-xattn"><h3>Needs attention</h3><div class="olx-alerts" id="olxAlerts"></div></div>';
    setStatus('connecting', 'Syncing\u2026');
    if (all) {
      var lens = LENSES.filter(function (l) { return l[0] === state.lens; })[0] || LENSES[0], key = lens[0];
      var installed = PR.order.filter(hasApp), apps = lens[2] ? installed.filter(function (a) { return lens[2].indexOf(a) > -1; }) : installed;
      var fin = (key === 'company' || key === 'finance') && hasApp('account'), risk = key === 'company' || key === 'commercial' || key === 'operations';
      html = toolbar(lens[1] + ' \u2014 executive overview', 'Last ' + periodLabel() + ' vs ' + cmpLabel(), true);
      apps.forEach(function (a) { PR.exec(a).alerts.forEach(function (al) { alerts.push(Object.assign({}, al, { label: PR.exec(a).title + ' \u00B7 ' + al.label })); }); });
      html += att;
      if (risk) html += '<div class="panel olx-xattn" id="olxRiskBox"><h3>Concentration risk</h3><div class="olx-alerts" id="olxRisk"></div></div>';
      if (fin) html += '<section class="olx-xsec"><button type="button" class="olx-xtitle" data-mod="account" data-title="' + esc(PR.fin.title) + '">' + esc(PR.fin.title) + ' <span>Open Accounting \u2192</span></button><div class="olx-kpis olx-xkpis">' + PR.fin.kpis.map(function (k, i) { return xCard('xk-fin-' + i, k); }).join('') + '</div></section>';
      apps.forEach(function (a) {
        if (key === 'company' && a === 'account' && fin) return;
        html += secHtml(a, key === 'finance' ? { charts: true } : key === 'company' ? { kpis: true } : { kpis: true, charts: true });
      });
      if (!apps.length && !fin) html += '<div class="olx-empty">None of the apps for this lens are installed in this Odoo database.</div>';
      box.innerHTML = html;
      if (fin) jobs.push(fillXKpis('xk-fin-', PR.fin.kpis, days, PR.fin.title));
      apps.forEach(function (a) {
        var X = PR.exec(a);
        if (byId('xk-' + a + '-0')) jobs.push(fillXKpis('xk-' + a + '-', X.kpis, days, X.title));
        if (key !== 'company') (X.trend ? [X.trend] : []).concat(X.charts).forEach(function (c, i) { jobs.push(drawChartCard('x' + a + i, c)); });
      });
      if (risk) jobs.push(loadRisk(byId('olxRisk')));
      box.querySelectorAll('[data-mod]').forEach(function (b) { b.addEventListener('click', function () { selectModule(b.getAttribute('data-mod')); }); });
      box.querySelectorAll('#olxLens button').forEach(function (b) { b.addEventListener('click', function () { state.lens = b.getAttribute('data-lens'); saveJSON(LENS_KEY, state.lens); loadExecutive(); }); });
    } else {
      var X = PR.exec(state.activeModule) || fallbackExec(), charts = (X.trend ? [X.trend] : []).concat(X.charts);
      alerts = X.alerts.slice();
      box.innerHTML = toolbar(X.title + ' \u2014 executive summary', 'Last ' + periodLabel() + ' vs ' + cmpLabel(), false) +
        '<div class="olx-kpis olx-xkpis">' + X.kpis.map(function (k, i) { return xCard('xk-m-' + i, k); }).join('') + '</div>' + (alerts.length ? att : '') +
        '<div class="olx-charts olx-xcharts">' + charts.map(function (c, i) { return chartCard('x' + i, c, X.trend && i === 0); }).join('') + '</div>';
      jobs.push(fillXKpis('xk-m-', X.kpis, days, X.title));
      charts.forEach(function (c, i) { jobs.push(drawChartCard('x' + i, c)); });
    }
    if (alerts.length) jobs.push(xAlerts(alerts, byId('olxAlerts'))); else { var ab = byId('olxAlerts'); if (ab) ab.closest('.olx-xattn').hidden = true; }
    box.querySelectorAll('#odooLivePeriod button').forEach(function (b) { b.addEventListener('click', function () { state.period = +b.getAttribute('data-days'); saveJSON(PERIOD_KEY, state.period); loadExecutive(); }); });
    byId('olxRefresh').addEventListener('click', function () { loadExecutive(); }); byId('olxExportScore').addEventListener('click', exportScorecard); byId('olxPrint').addEventListener('click', printReport);
    box.insertAdjacentHTML('beforeend', '<div class="panel olx-basis" id="olxBasis"></div>');
    var gen = state.xseq;
    Promise.all(jobs).then(function () {
      if (gen !== state.xseq) return;
      state.lastSynced = new Date(); setStatus('live', 'Live \u00B7 ' + (Date.now() - started) + ' ms'); renderConn(); renderNarrative();
      if (byId('olxAsOf')) byId('olxAsOf').textContent = 'as of ' + state.lastSynced.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    });
  }
  function runBuilder() {
    var gb = byId('odooLiveGroupBy').value, meas = byId('odooLiveMeasure').value, type = byId('odooLiveChartType').value, box = byId('odooLiveBuilderBody');
    if (!gb) { box.innerHTML = '<div class="olx-empty-s">Pick a “Group by” field to build your own chart for ' + esc(state.activeModel) + '.</div>'; return; }
    box.innerHTML = '<div class="olx-chart-body" id="olxb-b"><div class="olx-skel"></div></div><div class="olx-legend" id="olxl-b"></div><p class="chart-subtitle" id="olxs-b"></p>';
    var spec = { model: state.activeModel, domain: [], groupby: gb, measure: meas === '__count' ? null : meas, type: gb.indexOf(':') > -1 && type === 'doughnut' ? 'bar' : type, limit: 12, last: 12 };
    drawChartCard('b', spec);
  }

  /* -- Records explorer ------------------------------------------------------- */
  function closePops() {
    [['odooLiveColumnsPop', 'odooLiveColumnsBtn'], ['odooLiveViewsPop', 'odooLiveViewsBtn']].forEach(function (pair) {
      if (byId(pair[0])) byId(pair[0]).hidden = true;
      if (byId(pair[1])) byId(pair[1]).setAttribute('aria-expanded', 'false');
    });
  }
  function eligible() { return Object.keys(state.fields).filter(function (k) { return DISPLAYABLE[state.fields[k].type]; }); }
  function defaultColumns() {
    var el = eligible(), out = PREFER.filter(function (n) { return el.indexOf(n) > -1; });
    el.filter(function (n) { return !NOISE.test(n) && out.indexOf(n) < 0; }).forEach(function (n) { if (out.length < 7) out.push(n); });
    return out.slice(0, 7);
  }
  function displayFields() {
    var pref = state.columnPrefs[state.activeModel];
    if (pref && pref.length) { var kept = pref.filter(function (f) { return eligible().indexOf(f) > -1; }); if (kept.length) return kept; }
    return defaultColumns();
  }
  function searchable() { return Object.keys(state.fields).filter(function (k) { var t = state.fields[k].type; return (t === 'char' || t === 'text') && !NOISE.test(k); }).slice(0, 4); }
  function buildDomain() {
    var parts = state.filters.map(function (f) { return [f.field, 'ilike', f.value]; });
    if (state.drill) parts = parts.concat(state.drill);
    var q = byId('odooLiveQuickSearch').value.trim(), sf = searchable();
    if (q && sf.length) parts = parts.concat(new Array(sf.length - 1).fill('|'), sf.map(function (f) { return [f, 'ilike', q]; }));
    return parts;
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.drill && !document.querySelector('.dvu,[role=dialog]:not([hidden])')) { state.drill = null; state.drillMeta = null; state.page = 0; renderChips(); loadRecords(); } });
  function renderChips() {
    var wrap = byId('odooLiveChips');
    var dm = state.drillMeta && state.drillMeta.text || 'filtered', dp = dm.split(' \u00B7 '), trail = ['Overview'].concat(dp).map(function (t, k, a) { return '<span class="olx-crumb' + (k === a.length - 1 ? ' is-cur' : '') + '">' + esc(t) + '</span>'; }).join('<i aria-hidden="true">\u203A</i>');
    var drillChip = state.drill ? '<span class="odoo-live-chip is-drill olx-trail" role="navigation" aria-label="Drill-in path">\u2316 ' + trail + '<button type="button" data-drill="1" aria-label="Clear chart drill-in" title="Clear drill-in (Esc)">\u00D7 Clear</button><button type="button" data-back="1" title="Back to charts">\u2190 Charts</button></span>' : '';
    wrap.innerHTML = drillChip + state.filters.map(function (f, i) { return '<span class="odoo-live-chip">' + esc(f.field) + ' contains “' + esc(f.value) + '”<button type="button" data-i="' + i + '" aria-label="Remove filter">×</button></span>'; }).join('');
    wrap.querySelectorAll('button[data-i]').forEach(function (b) { b.addEventListener('click', function () { state.filters.splice(+b.getAttribute('data-i'), 1); state.page = 0; renderChips(); loadRecords(); }); });
    var bk = wrap.querySelector('button[data-back]'); if (bk) bk.addEventListener('click', function () { state.drill = null; state.drillMeta = null; state.page = 0; renderChips(); showTab('insights'); });
    var dc = wrap.querySelector('button[data-drill]'); if (dc) dc.addEventListener('click', function () { state.drill = null; state.drillMeta = null; state.page = 0; renderChips(); loadRecords(); });
  }
  function cell(v, f) {
    if (v === false || v == null) return '<span class="olx-nil">–</span>';
    if (Array.isArray(v)) return esc(v[1]);
    var t = f && f.type;
    if (t === 'boolean') return v ? '✓' : '–';
    if (t === 'monetary') return '<span class="olx-num">' + esc(F.money(v)) + '</span>';
    if (t === 'float' || t === 'integer') return '<span class="olx-num">' + esc(F.num(v, t === 'float' ? 2 : 0)) + '</span>';
    if (t === 'datetime') return esc(F.when(v));
    if (t === 'selection') { var m = (f.selection || []).filter(function (x) { return x[0] === v; })[0]; return '<span class="olx-tag">' + esc(m ? m[1] : v) + '</span>'; }
    var s = String(v); return esc(s.length > 80 ? s.slice(0, 80) + '…' : s);
  }
  function failTable(e) {
    showLiveError(e);
    byId('odooLiveTable').querySelector('thead').innerHTML = '';
    byId('odooLiveTable').setAttribute('aria-busy', 'false');
    byId('odooLiveTable').querySelector('tbody').innerHTML = '<tr><td class="odoo-live-table-state is-error" role="alert">' + esc(safeError(e)) + '</td></tr>';
  }
  function loadRecords() {
    if (!state.activeModel || !renderBanner()) return;
    state.dirty.records = false;
    var cols = displayFields(), t0 = Date.now();
    byId('odooLiveTable').querySelector('thead').innerHTML = '';
    byId('odooLiveTable').querySelector('tbody').innerHTML = '<tr><td class="odoo-live-table-state">Fetching live records…</td></tr>';
    byId('odooLiveTable').setAttribute('aria-busy', 'true');
    setStatus('connecting', 'Syncing…');
    C.records(state.activeModel, { domain: buildDomain(), fields: cols, limit: PAGE_SIZE, offset: state.page * PAGE_SIZE, order: 'id desc' }).then(function (res) {
      state.total = res.total || 0; state.records = res.rows || []; state.columns = cols; state.lastSynced = new Date();
      byId('odooLiveTable').setAttribute('aria-busy', 'false');
      setStatus('live', 'Live · ' + (Date.now() - t0) + ' ms'); renderTable(); renderPagination(); renderConn();
    }).catch(failTable);
  }
  function renderTable() {
    var thead = byId('odooLiveTable').querySelector('thead'), tbody = byId('odooLiveTable').querySelector('tbody');
    byId('odooLiveTable').setAttribute('aria-busy', 'false');
    if (!state.records.length) { thead.innerHTML = ''; tbody.innerHTML = '<tr><td class="odoo-live-table-state">No matching records.</td></tr>'; return; }
    thead.innerHTML = '<tr>' + state.columns.map(function (c) { return '<th>' + esc((state.fields[c] && state.fields[c].string) || c) + '</th>'; }).join('') + '</tr>';
    tbody.innerHTML = state.records.map(function (r) { return '<tr>' + state.columns.map(function (c) { return '<td>' + cell(r[c], state.fields[c]) + '</td>'; }).join('') + '</tr>'; }).join('');
  }
  function renderPagination() {
    var from = state.total ? state.page * PAGE_SIZE + 1 : 0, to = Math.min(state.total, state.page * PAGE_SIZE + state.records.length);
    byId('odooLivePageInfo').textContent = state.total ? from + '–' + to + ' of ' + state.total.toLocaleString() : '0 of 0';
    byId('odooLivePrevBtn').disabled = state.page === 0; byId('odooLiveNextBtn').disabled = to >= state.total;
  }
  function exportCsv() {
    if (!state.records.length) return;
    var head = state.columns.map(function (c) { return (state.fields[c] && state.fields[c].string) || c; });
    var rows = state.records.map(function (r) { return state.columns.map(function (c) { var v = r[c]; return Array.isArray(v) ? v[1] : (v === false || v == null ? '' : v); }); });
    F.download(state.activeModel + '-' + new Date().toISOString().slice(0, 10) + '.csv', F.csv([head].concat(rows)));
    if (window.DVSec) window.DVSec.log('Exported Odoo records', state.activeModel + ' · ' + rows.length + ' rows');
  }

  /* -- Columns & saved views ---------------------------------------------------- */
  function renderColumnsPop() {
    var list = byId('odooLiveColumnsList'), active = state.columns.length ? state.columns : displayFields();
    var el = eligible().sort(function (a, b) { return (state.fields[a].string || a).localeCompare(state.fields[b].string || b); });
    list.innerHTML = el.map(function (f) { return '<label class="odoo-live-col-row"><input type="checkbox" data-col="' + esc(f) + '"' + (active.indexOf(f) > -1 ? ' checked' : '') + '/><span title="' + esc(f) + '">' + esc(state.fields[f].string || f) + '</span></label>'; }).join('') || '<div class="odoo-live-pop-empty">No fields.</div>';
    list.querySelectorAll('input').forEach(function (b) { b.addEventListener('change', function () {
      var chosen = [].slice.call(list.querySelectorAll('input:checked')).map(function (x) { return x.getAttribute('data-col'); });
      if (!chosen.length) return; state.columnPrefs[state.activeModel] = chosen; saveJSON(COLUMNS_KEY, state.columnPrefs); loadRecords();
    }); });
  }
  function renderViewsPop() {
    var list = byId('odooLiveViewsList');
    list.innerHTML = state.savedViews.length ? state.savedViews.map(function (v) {
      return '<div class="odoo-live-view-row"><button type="button" class="apply" data-id="' + esc(v.id) + '">' + esc(v.name) + '</button><span class="model-tag">' + esc(v.model) + '</span><button type="button" class="remove" data-rm="' + esc(v.id) + '" aria-label="Delete saved view">×</button></div>';
    }).join('') : '<div class="odoo-live-pop-empty">No saved views yet — set filters, then “Save current”.</div>';
    list.querySelectorAll('[data-id]').forEach(function (b) { b.addEventListener('click', function () { applyView(b.getAttribute('data-id')); }); });
    list.querySelectorAll('[data-rm]').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); state.savedViews = state.savedViews.filter(function (v) { return v.id !== b.getAttribute('data-rm'); }); saveJSON(VIEWS_KEY, state.savedViews); renderViewsPop(); }); });
  }
  function applyView(id) {
    var v = state.savedViews.filter(function (x) { return x.id === id; })[0]; if (!v) return; closePops();
    var go = function () { state.filters = (v.filters || []).slice(); state.page = 0; renderChips(); showTab('records'); loadRecords(); };
    if (state.activeModel === v.model) return go();
    state.activeModel = v.model; state.filters = []; state.drill = null; state.drillMeta = null; state.dirty = { insights: true, records: true, exec: true };
    if (!state.models.some(function (m) { return m.model === v.model; })) byId('odooLiveModelSelect').insertAdjacentHTML('beforeend', '<option value="' + esc(v.model) + '">' + esc(v.model) + '</option>');
    byId('odooLiveModelSelect').value = v.model;
    C.fields(v.model).then(function (f) { state.fields = f; populateControls(); go(); }).catch(failTable);
  }

  /* -- Bootstrap -------------------------------------------------------------- */
  function loadModules(force) {
    if (!renderBanner()) return;
    if (force) C.reset();
    byId('odooLiveConnectBanner').hidden = true;
    if (byId('odooLiveRetryBtn')) byId('odooLiveRetryBtn').hidden = true;
    byId('odooLiveModuleSelect').disabled = true;
    byId('odooLiveModuleSelect').innerHTML = '<option>Loading modules…</option>';
    setStatus('connecting', 'Syncing…');
    C.test().then(function (d) { var v = d.version && (d.version.server_version || d.version.server_serie); if (v) { state.version = v; renderConn(); } }).catch(function () {});
    C.modules().then(function (mods) {
      state.modules = mods; setStatus('live', 'Live'); fillModuleSelect(); renderConn();
      var keep = state.activeModule && (state.activeModule === '__all__' || mods.some(function (m) { return m.technicalName === state.activeModule; })) ? state.activeModule : '__all__';
      if (keep) selectModule(keep);
    }).catch(function (e) {
      setStatus('error', 'Connection error');
      byId('odooLiveModuleSelect').innerHTML = '<option value="">Could not load apps</option>';
      showLiveError(e);
    });
  }
  function refresh(force) {
    if (!renderBanner()) return;
    if (!state.modules.length || force === 'all') return loadModules(true);
    state.dirty = { insights: true, records: true, exec: true }; refreshTab();
  }
  function resetAndRefresh() { state.modules = []; state.models = []; state.activeModel = null; C.reset(); refresh(); }

  function init() {
    renderBanner();
    byId('odooLiveRefreshBtn').addEventListener('click', function () { var b = this; b.classList.add('is-spinning'); refresh(); setTimeout(function () { b.classList.remove('is-spinning'); }, 700); });
    if (byId('odooLiveRetryBtn')) byId('odooLiveRetryBtn').addEventListener('click', function () { this.disabled = true; refresh('all'); var b = this; setTimeout(function () { b.disabled = false; }, 1500); });
    byId('odooLiveModuleSelect').addEventListener('change', function () { if (this.value) selectModule(this.value); });
    byId('odooLiveModelSelect').addEventListener('change', function () { if (this.value) selectModel(this.value); });
    document.querySelectorAll('#odooLiveTabs button').forEach(function (b) {
      b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
      b.addEventListener('keydown', function (e) {
        var tabs = [].slice.call(document.querySelectorAll('#odooLiveTabs [role="tab"]')), i = tabs.indexOf(b), next = null;
        if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
        if (e.key === 'ArrowLeft') next = (i + tabs.length - 1) % tabs.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = tabs.length - 1;
        if (next !== null) { e.preventDefault(); tabs[next].focus(); tabs[next].click(); }
      });
    });
    ['odooLiveGroupBy', 'odooLiveMeasure', 'odooLiveChartType'].forEach(function (id) { byId(id).addEventListener('change', runBuilder); });
    byId('odooLiveAddFilterBtn').addEventListener('click', function () {
      var field = byId('odooLiveFilterField').value, value = byId('odooLiveFilterValue').value.trim(); if (!field || !value) return;
      state.filters.push({ field: field, value: value }); byId('odooLiveFilterValue').value = ''; state.page = 0; renderChips(); loadRecords();
    });
    byId('odooLiveFilterValue').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !byId('odooLiveAddFilterBtn').disabled) { e.preventDefault(); byId('odooLiveAddFilterBtn').click(); }
    });
    byId('odooLiveQuickSearch').addEventListener('input', debounce(function () { state.page = 0; loadRecords(); }, 400));
    byId('odooLiveColumnsBtn').addEventListener('click', function (e) { e.stopPropagation(); var p = byId('odooLiveColumnsPop'), was = p.hidden; closePops(); if (was && !this.disabled) { renderColumnsPop(); p.hidden = false; this.setAttribute('aria-expanded', 'true'); } });
    byId('odooLiveColumnsReset').addEventListener('click', function () { delete state.columnPrefs[state.activeModel]; saveJSON(COLUMNS_KEY, state.columnPrefs); renderColumnsPop(); loadRecords(); });
    byId('odooLiveViewsBtn').addEventListener('click', function (e) { e.stopPropagation(); var p = byId('odooLiveViewsPop'), was = p.hidden; closePops(); if (was && !this.disabled) { renderViewsPop(); p.hidden = false; this.setAttribute('aria-expanded', 'true'); } });
    byId('odooLiveViewSaveBtn').addEventListener('click', function () {
      if (!state.activeModel) return; var inp = byId('odooLiveViewName');
      var v = { id: 'v' + Date.now().toString(36), name: (inp.value.trim() || state.activeModel + ' view'), model: state.activeModel, filters: state.filters.slice() };
      state.savedViews.unshift(v); saveJSON(VIEWS_KEY, state.savedViews); inp.value = ''; renderViewsPop(); if (window.showToast) window.showToast('Saved view “' + v.name + '”.');
    });
    byId('odooLiveExportBtn').addEventListener('click', exportCsv);
    document.querySelectorAll('.odoo-live-pop').forEach(function (p) { p.addEventListener('click', function (e) { e.stopPropagation(); }); });
    document.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('.odoo-live-pop-wrap')) closePops(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePops(); });
    byId('odooLivePrevBtn').addEventListener('click', function () { if (state.page > 0) { state.page--; loadRecords(); } });
    byId('odooLiveNextBtn').addEventListener('click', function () { state.page++; loadRecords(); });

    var auto = byId('odooLiveAutoRefresh');
    function applyAuto() { clearInterval(state.timer); var ms = +auto.value; if (ms > 0) state.timer = setInterval(function () { if (byId('view-odoo-live').classList.contains('active') && !document.hidden) refresh(); }, ms); }
    auto.addEventListener('change', applyAuto); applyAuto();

    window.addEventListener('storage', function (e) { if (e.key === 'dashview_odoo_config' || e.key === 'dashview_odoo_connected') resetAndRefresh(); });
    ['dv:odoo-config-saved', 'dv:unlocked'].forEach(function (ev) { document.addEventListener(ev, resetAndRefresh); });
    document.addEventListener('dv:locked', function () { state.modules = []; renderBanner(); });
    document.addEventListener('dv:odoo-disconnected', function () { state.modules = []; state.models = []; state.activeModel = null; C.reset(); renderBanner(); });
    document.addEventListener('dv:session-changed', renderBanner);
    document.addEventListener('dv:theme', function () { state.dirty.insights = true; state.dirty.exec = true; if (byId('view-odoo-live').classList.contains('active')) refreshTab(); });
    /* Company scope changed (header chips): every tab re-reads Odoo for the chosen companies. */
    document.addEventListener('dv:company-scope', function () { state.page = 0; state.dirty = { insights: true, records: true, exec: true }; if (byId('view-odoo-live').classList.contains('active')) refreshTab(); });
    if (byId('view-odoo-live').classList.contains('active')) refresh();
    document.querySelectorAll('[data-view="odoo-live"]').forEach(function (l) { l.addEventListener('click', function () { setTimeout(function () { refresh(); F.resizeCharts(byId('view-odoo-live')); }, 0); }); });
  }
  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
