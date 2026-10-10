/* ==========================================================================
   DashView Data Studio — field profiler  (window.StudioProfile)
   --------------------------------------------------------------------------
   profileField(field, rows)  pure statistics for one column:
       completeness · distinct · quartiles / IQR outliers / std-dev · histogram
       (numbers) · timeline + weekday mix (dates) · top values, length,
       casing and whitespace checks (text) · plain-language quality flags
   open(ctx)                  a side drawer that renders the profile and can
       act on it (sort, use as slicer, filter to a value, show outliers / blanks).
   The statistics are pure so they can be unit-tested without a browser.
   ========================================================================== */
(function (root) {
  'use strict';
  var NUM = { number: 1, currency: 1, percent: 1 };

  function isBlank(v) { return v === undefined || v === null || (typeof v === 'string' && v.trim() === ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function r(n, d) { var p = Math.pow(10, d == null ? 2 : d); return Math.round(n * p) / p; }

  /* -- numbers -------------------------------------------------------------- */
  function numericProfile(values) {
    var n = values.length, sorted = values.slice().sort(function (a, b) { return a - b; });
    var sum = 0, i; for (i = 0; i < n; i++) sum += sorted[i];
    var mean = sum / n, varSum = 0; for (i = 0; i < n; i++) varSum += Math.pow(sorted[i] - mean, 2);
    var std = n > 1 ? Math.sqrt(varSum / (n - 1)) : 0;
    var q1 = quantile(sorted, 0.25), med = quantile(sorted, 0.5), q3 = quantile(sorted, 0.75), iqr = q3 - q1;
    var lowFence = q1 - 1.5 * iqr, highFence = q3 + 1.5 * iqr, low = 0, high = 0, zeros = 0, negatives = 0;
    for (i = 0; i < n; i++) {
      if (sorted[i] < lowFence) low++; else if (sorted[i] > highFence) high++;
      if (sorted[i] === 0) zeros++; if (sorted[i] < 0) negatives++;
    }
    var integers = true; for (i = 0; i < n; i++) if (!Number.isInteger(sorted[i])) { integers = false; break; }
    var min = sorted[0], max = sorted[n - 1], bins = Math.max(5, Math.min(16, Math.ceil(Math.log(n) / Math.LN2) + 1)), hist = [];
    if (min === max) hist = [{ from: min, to: max, count: n }];
    else {
      var w = (max - min) / bins; for (i = 0; i < bins; i++) hist.push({ from: min + i * w, to: min + (i + 1) * w, count: 0 });
      for (i = 0; i < n; i++) hist[Math.min(bins - 1, Math.floor((sorted[i] - min) / w))].count++;
    }
    return { min: min, max: max, sum: sum, mean: mean, median: med, q1: q1, q3: q3, iqr: iqr, std: std, lowFence: lowFence, highFence: highFence,
      outliersLow: low, outliersHigh: high, outliers: low + high, zeros: zeros, negatives: negatives, integers: integers, histogram: hist };
  }

  /* -- dates ---------------------------------------------------------------- */
  function startOfWeek(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }
  function bucketKey(ms, g) {
    var d = new Date(ms);
    if (g === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (g === 'week') return startOfWeek(ms);
    if (g === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    return new Date(d.getFullYear(), 0, 1).getTime();
  }
  function nextBucket(ms, g) {
    var d = new Date(ms);
    if (g === 'day') d.setDate(d.getDate() + 1); else if (g === 'week') d.setDate(d.getDate() + 7);
    else if (g === 'month') d.setMonth(d.getMonth() + 1); else d.setFullYear(d.getFullYear() + 1);
    return d.getTime();
  }
  function dateProfile(values) {
    var min = Infinity, max = -Infinity, i, weekdays = [0, 0, 0, 0, 0, 0, 0], future = 0, now = Date.now();
    for (i = 0; i < values.length; i++) {
      var v = values[i]; if (v < min) min = v; if (v > max) max = v;
      weekdays[(new Date(v).getDay() + 6) % 7]++; if (v > now) future++;
    }
    var spanDays = Math.round((max - min) / 864e5), g = spanDays <= 40 ? 'day' : spanDays <= 200 ? 'week' : spanDays <= 1200 ? 'month' : 'year';
    var map = {}; values.forEach(function (v) { var k = bucketKey(v, g); map[k] = (map[k] || 0) + 1; });
    var buckets = [], cur = bucketKey(min, g), guard = 0;
    while (cur <= max && guard++ < 400) { buckets.push({ from: cur, count: map[cur] || 0 }); cur = nextBucket(cur, g); }
    return { min: min, max: max, spanDays: spanDays, granularity: g, histogram: buckets, weekdays: weekdays, future: future };
  }

  /* -- text ----------------------------------------------------------------- */
  function textProfile(values) {
    var counts = new Map(), lower = new Map(), minLen = Infinity, maxLen = 0, totalLen = 0, padded = 0, i, s;
    for (i = 0; i < values.length; i++) {
      s = String(values[i]);
      counts.set(s, (counts.get(s) || 0) + 1);
      if (s !== s.trim()) padded++;
      var lk = s.trim().toLowerCase(); if (!lower.has(lk)) lower.set(lk, new Set()); lower.get(lk).add(s.trim());
      var len = s.length; totalLen += len; if (len < minLen) minLen = len; if (len > maxLen) maxLen = len;
    }
    var top = Array.from(counts.entries()).sort(function (a, b) { return b[1] - a[1] || String(a[0]).localeCompare(String(b[0])); }).slice(0, 10)
      .map(function (e) { return { value: e[0], count: e[1], pct: e[1] / values.length }; });
    var caseGroups = 0; lower.forEach(function (set) { if (set.size > 1) caseGroups++; });
    return { top: top, distinct: counts.size, minLen: values.length ? minLen : 0, maxLen: maxLen, avgLen: values.length ? totalLen / values.length : 0, padded: padded, caseGroups: caseGroups };
  }

  /* -- the whole profile ---------------------------------------------------- */
  function profileField(field, rows) {
    var name = field.name, type = field.type, total = rows.length, vals = [], i, v;
    for (i = 0; i < total; i++) { v = rows[i][name]; if (!isBlank(v)) vals.push(v); }
    var filled = vals.length, missing = total - filled;
    var kind = NUM[type] ? 'numeric' : type === 'date' ? 'date' : type === 'boolean' ? 'boolean' : 'text';
    var p = { name: name, type: type, kind: kind, total: total, filled: filled, missing: missing, missingPct: total ? missing / total : 0, distinct: 0, uniquePct: 0, flags: [] };
    if (kind === 'numeric') {
      var nums = vals.filter(function (x) { return typeof x === 'number' && isFinite(x); });
      p.filled = filled = nums.length; p.missing = missing = total - filled; p.missingPct = total ? missing / total : 0;
      p.distinct = new Set(nums).size;
      if (nums.length) p.numeric = numericProfile(nums);
    } else if (kind === 'date') {
      var ds = vals.filter(function (x) { return typeof x === 'number' && isFinite(x); });
      p.filled = filled = ds.length; p.missing = missing = total - filled; p.missingPct = total ? missing / total : 0;
      p.distinct = new Set(ds).size;
      if (ds.length) p.date = dateProfile(ds);
    } else if (kind === 'boolean') {
      var yes = vals.filter(function (x) { return x === true || x === 'true' || x === 1; }).length;
      p.distinct = new Set(vals.map(String)).size; p.bool = { yes: yes, no: filled - yes };
    } else {
      p.text = textProfile(vals); p.distinct = p.text.distinct;
    }
    p.uniquePct = filled ? p.distinct / filled : 0;
    /* plain-language quality flags */
    var f = p.flags;
    if (!total) f.push({ level: 'info', text: 'There are no rows to profile with the current filters.' });
    else if (!filled) f.push({ level: 'error', text: 'Every value is blank in these rows.' });
    else {
      if (missing) f.push({ level: p.missingPct > 0.3 ? 'warn' : 'info', text: missing.toLocaleString() + ' blank value' + (missing === 1 ? '' : 's') + ' (' + r(p.missingPct * 100, 1) + '%).' });
      if (p.distinct === 1 && filled > 1) f.push({ level: 'warn', text: 'Every filled value is identical — this column carries no information.' });
      var idLike = /(^|\b|_)(id|code|ref|reference|number|no|sku|key)(\b|_|$)/i.test(name);
      /* a measure such as revenue is unique per row simply because it has decimals — only text and whole-number codes look like identifiers */
      var idShape = kind === 'text' || (kind === 'numeric' && type === 'number' && p.numeric && p.numeric.integers);
      if (p.distinct === filled && filled >= 20 && idShape) f.push({ level: 'info', text: 'Unique in every row — behaves like an identifier, not a category or measure.' });
      else if (idLike && p.distinct < filled && idShape) f.push({ level: 'warn', text: (filled - p.distinct).toLocaleString() + ' repeated value' + (filled - p.distinct === 1 ? '' : 's') + ' in a column that looks like an identifier.' });
      if (p.numeric) {
        if (p.numeric.outliers) f.push({ level: 'info', text: p.numeric.outliers.toLocaleString() + ' outlier' + (p.numeric.outliers === 1 ? '' : 's') + ' beyond 1.5 × IQR (' + p.numeric.outliersHigh + ' high, ' + p.numeric.outliersLow + ' low).' });
        if (p.numeric.negatives && type === 'currency') f.push({ level: 'info', text: p.numeric.negatives.toLocaleString() + ' negative amount' + (p.numeric.negatives === 1 ? '' : 's') + ' (refunds or credits?).' });
      }
      if (p.date && p.date.future) f.push({ level: 'info', text: p.date.future.toLocaleString() + ' date' + (p.date.future === 1 ? ' is' : 's are') + ' in the future.' });
      if (p.text && p.text.padded) f.push({ level: 'warn', text: p.text.padded.toLocaleString() + ' value' + (p.text.padded === 1 ? ' has' : 's have') + ' leading or trailing spaces.' });
      if (p.text && p.text.caseGroups) f.push({ level: 'warn', text: p.text.caseGroups + ' value group' + (p.text.caseGroups === 1 ? '' : 's') + ' differ only by capitalisation (for example "east" and "East").' });
      if (!f.length) f.push({ level: 'good', text: 'Complete and consistent — nothing unusual found.' });
    }
    return p;
  }

  /* -- rendering ------------------------------------------------------------ */
  function histSvg(bars, labelFn, titleFn) {
    var W = 420, H = 96, gap = 3, n = bars.length, bw = (W - gap * (n - 1)) / n, max = 1, i;
    for (i = 0; i < n; i++) if (bars[i].count > max) max = bars[i].count;
    var out = '<svg class="sp-hist" viewBox="0 0 ' + W + ' ' + (H + 18) + '" preserveAspectRatio="none" role="img" aria-label="Distribution chart">';
    bars.forEach(function (b, k) {
      var h = b.count ? Math.max(2, b.count / max * H) : 0, x = k * (bw + gap);
      out += '<rect x="' + x.toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2"><title>' + esc(titleFn(b)) + '</title></rect>';
    });
    out += '<text x="0" y="' + (H + 14) + '">' + esc(labelFn(bars[0], true)) + '</text><text x="' + W + '" y="' + (H + 14) + '" text-anchor="end">' + esc(labelFn(bars[n - 1], false)) + '</text></svg>';
    return out;
  }
  function stat(label, value, sub) { return '<div class="sp-stat"><span>' + esc(label) + '</span><b>' + esc(value) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>'; }
  function pct(x, d) { return r(x * 100, d == null ? 1 : d) + '%'; }

  function renderProfile(p, fmt) {
    fmt = fmt || function (v) { return String(v); };
    var h = '';
    h += '<div class="sp-grid">' + stat('Filled', pct(1 - p.missingPct), p.filled.toLocaleString() + ' of ' + p.total.toLocaleString()) +
      stat('Blank', p.missing.toLocaleString(), pct(p.missingPct)) + stat('Distinct', p.distinct.toLocaleString(), p.filled ? pct(p.uniquePct, 0) + ' of filled' : '') + '</div>';
    h += '<div class="sp-meter" title="Completeness"><i style="width:' + (100 - p.missingPct * 100).toFixed(1) + '%"></i></div>';
    if (p.numeric) {
      var n = p.numeric, f = function (v) { return fmt(v, { compact: true }); };
      h += '<h3>Distribution</h3>' + histSvg(n.histogram, function (b, first) { return f(first ? b.from : b.to); },
        function (b) { return f(b.from) + ' – ' + f(b.to) + ': ' + b.count.toLocaleString() + ' rows'; });
      h += '<div class="sp-grid sp-grid4">' + stat('Min', f(n.min)) + stat('Median', f(n.median)) + stat('Mean', f(n.mean)) + stat('Max', f(n.max)) +
        stat('Q1', f(n.q1)) + stat('Q3', f(n.q3)) + stat('Std dev', f(n.std)) + stat('Sum', f(n.sum)) + '</div>';
    }
    if (p.date) {
      var d = p.date, lab = function (ms) { return new Date(ms).toLocaleDateString(undefined, d.granularity === 'year' ? { year: 'numeric' } : d.granularity === 'month' ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short', year: '2-digit' }); };
      h += '<h3>Timeline (by ' + d.granularity + ')</h3>' + histSvg(d.histogram, function (b, first) { return lab(first ? b.from : b.from); }, function (b) { return lab(b.from) + ': ' + b.count.toLocaleString() + ' rows'; });
      h += '<div class="sp-grid sp-grid4">' + stat('Earliest', fmt(d.min)) + stat('Latest', fmt(d.max)) + stat('Span', d.spanDays.toLocaleString() + ' days') + stat('Future', d.future.toLocaleString()) + '</div>';
      var names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], wmax = Math.max.apply(null, d.weekdays.concat([1]));
      h += '<h3>Weekday mix</h3><div class="sp-week">' + d.weekdays.map(function (c, i) { return '<div title="' + names[i] + ': ' + c + '"><i style="height:' + (c / wmax * 100).toFixed(0) + '%"></i><span>' + names[i] + '</span></div>'; }).join('') + '</div>';
    }
    if (p.bool) h += '<h3>Values</h3><div class="sp-grid">' + stat('Yes', p.bool.yes.toLocaleString(), pct(p.filled ? p.bool.yes / p.filled : 0)) + stat('No', p.bool.no.toLocaleString(), pct(p.filled ? p.bool.no / p.filled : 0)) + '</div>';
    if (p.text) {
      h += '<h3>Top values</h3><div class="sp-top">' + p.text.top.map(function (t) {
        return '<button type="button" class="sp-toprow" data-sp-value="' + esc(t.value) + '" title="Filter the grid to “' + esc(t.value) + '”"><span class="lab">' + esc(t.value === '' ? '(empty)' : t.value) + '</span><span class="track"><i style="width:' + Math.max(2, t.pct * 100).toFixed(1) + '%"></i></span><span class="cnt">' + t.count.toLocaleString() + ' · ' + pct(t.pct, 1) + '</span></button>';
      }).join('') + '</div>' + (p.text.distinct > p.text.top.length ? '<p class="sp-note">+ ' + (p.text.distinct - p.text.top.length).toLocaleString() + ' more distinct values</p>' : '');
      h += '<div class="sp-grid sp-grid4">' + stat('Shortest', p.text.minLen + ' chars') + stat('Longest', p.text.maxLen + ' chars') + stat('Average', r(p.text.avgLen, 1) + ' chars') + stat('Padded', p.text.padded.toLocaleString()) + '</div>';
    }
    h += '<h3>Quality checks</h3><ul class="sp-flags">' + p.flags.map(function (x) { return '<li class="' + x.level + '"><i aria-hidden="true"></i>' + esc(x.text) + '</li>'; }).join('') + '</ul>';
    return h;
  }

  /* -- drawer --------------------------------------------------------------- */
  var el = null, ctx = null, lastFocus = null;
  function build() {
    if (el || typeof document === 'undefined') return;
    var scrim = document.createElement('div'); scrim.className = 'sp-scrim'; scrim.hidden = true;
    var d = document.createElement('aside'); d.className = 'sp-drawer'; d.hidden = true;
    d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'spTitle');
    d.innerHTML = '<header class="sp-head"><div class="sp-nav"><button type="button" class="sp-icon" data-sp="prev" aria-label="Previous column" title="Previous column">←</button>' +
      '<button type="button" class="sp-icon" data-sp="next" aria-label="Next column" title="Next column">→</button><span class="sp-pos" id="spPos"></span></div>' +
      '<button type="button" class="sp-icon" data-sp="close" aria-label="Close profile" title="Close (Esc)">✕</button></header>' +
      '<div class="sp-title"><h2 id="spTitle"></h2><p id="spType"></p></div>' +
      '<label class="sp-scope"><input type="checkbox" id="spScope" checked/> <span id="spScopeLab"></span></label>' +
      '<div class="sp-body" id="spBody"></div>' +
      '<footer class="sp-foot" id="spFoot"></footer>';
    document.body.appendChild(scrim); document.body.appendChild(d);
    el = { scrim: scrim, drawer: d };
    scrim.addEventListener('click', close);
    d.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sp]'), act = b && b.getAttribute('data-sp');
      if (act === 'close') return close();
      if (act === 'prev') return step(-1);
      if (act === 'next') return step(1);
      if (b && ctx && ctx.actions && ctx.actions[act]) { var keep = ctx.actions[act](ctx.field, current); if (keep !== 'stay') close(); return; }
      var tv = e.target.closest('[data-sp-value]');
      if (tv && ctx && ctx.actions && ctx.actions.filterValue) { ctx.actions.filterValue(ctx.field, tv.getAttribute('data-sp-value')); close(); }
    });
    d.querySelector('#spScope').addEventListener('change', function () { paint(); });
    document.addEventListener('keydown', function (e) {
      if (d.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight' && !/input/i.test(e.target.tagName)) { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft' && !/input/i.test(e.target.tagName)) { e.preventDefault(); step(-1); }
      else if (e.key === 'Tab') {
        var f = Array.prototype.slice.call(d.querySelectorAll('button:not(:disabled),input')).filter(function (n) { return n.offsetParent !== null; });
        if (!f.length) return; var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || !d.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }, true);
  }
  var current = null;
  function paint() {
    if (!ctx) return;
    var useFiltered = el.drawer.querySelector('#spScope').checked;
    var rows = ctx.getRows(!useFiltered);
    var field = ctx.field;
    current = profileField(field, rows);
    el.drawer.querySelector('#spTitle').textContent = field.name;
    el.drawer.querySelector('#spType').textContent = field.type.charAt(0).toUpperCase() + field.type.slice(1) + (field.isCalculated ? ' · calculated column' : field.isVirtual ? ' · derived column' : '') + ' · profiled on ' + rows.length.toLocaleString() + ' row' + (rows.length === 1 ? '' : 's');
    el.drawer.querySelector('#spScopeLab').textContent = ctx.filteredCount === ctx.totalCount ? 'No filters active — profiling all ' + ctx.totalCount.toLocaleString() + ' rows' : 'Respect filters (' + ctx.filteredCount.toLocaleString() + ' of ' + ctx.totalCount.toLocaleString() + ' rows)';
    el.drawer.querySelector('#spScope').disabled = ctx.filteredCount === ctx.totalCount;
    el.drawer.querySelector('#spBody').innerHTML = renderProfile(current, function (v, o) { return ctx.format(field, v, o); });
    var acts = '<button type="button" class="btn btn-outline btn-sm" data-sp="sortAsc">Sort A→Z / low→high</button><button type="button" class="btn btn-outline btn-sm" data-sp="sortDesc">Sort Z→A / high→low</button>';
    if (field.isCategorical || field.type === 'date') acts += '<button type="button" class="btn btn-outline btn-sm" data-sp="slicer">Use as slicer</button>';
    if (current.missing) acts += '<button type="button" class="btn btn-outline btn-sm" data-sp="blanks">Show blank rows</button>';
    if (current.numeric && current.numeric.outliers) acts += '<button type="button" class="btn btn-outline btn-sm" data-sp="outliers">Show outliers</button>';
    el.drawer.querySelector('#spFoot').innerHTML = acts;
    var idx = ctx.fields.findIndex(function (f) { return f.name === field.name; });
    el.drawer.querySelector('#spPos').textContent = (idx + 1) + ' of ' + ctx.fields.length;
    el.drawer.querySelector('[data-sp="prev"]').disabled = idx <= 0;
    el.drawer.querySelector('[data-sp="next"]').disabled = idx >= ctx.fields.length - 1;
  }
  function step(delta) {
    var idx = ctx.fields.findIndex(function (f) { return f.name === ctx.field.name; }), next = ctx.fields[idx + delta];
    if (next) { ctx.field = next; paint(); el.drawer.querySelector('#spBody').scrollTop = 0; }
  }
  function open(c) {
    build(); if (!el) return;
    ctx = c; lastFocus = document.activeElement;
    el.drawer.querySelector('#spScope').checked = true;
    paint();
    el.scrim.hidden = el.drawer.hidden = false;
    requestAnimationFrame(function () { el.scrim.classList.add('open'); el.drawer.classList.add('open'); });
    el.drawer.querySelector('[data-sp="close"]').focus();
  }
  function close() {
    if (!el || el.drawer.hidden) return;
    el.scrim.classList.remove('open'); el.drawer.classList.remove('open');
    var done = function () { el.scrim.hidden = el.drawer.hidden = true; };
    if (document.documentElement.hasAttribute('data-reduce-motion')) done(); else setTimeout(done, 260);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  root.StudioProfile = { profileField: profileField, renderProfile: renderProfile, quantile: quantile, open: open, close: close, isOpen: function () { return !!el && !el.drawer.hidden; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.StudioProfile;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
