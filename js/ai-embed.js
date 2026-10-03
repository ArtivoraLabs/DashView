/* ==========================================================================
   DashView — AI Assistant, embedded SPA view (item #10)
   --------------------------------------------------------------------------
   Drives #view-ai inside dashboard.html with the local rules engine for
   general help and the guarded live Odoo agent for company-data questions.
   Kept intentionally small: a single active thread, not full multi-
   conversation management (that richer experience still lives at ai.html,
   linked from the footnote in this view for anyone who wants it).
   ========================================================================== */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var messagesEl = document.getElementById('aiEmbedMessages');
    var emptyEl = document.getElementById('aiEmbedEmpty');
    var inputEl = document.getElementById('aiEmbedInput');
    var sendBtn = document.getElementById('aiEmbedSendBtn');
    var newChatBtn = document.getElementById('aiEmbedNewChatBtn');
    var exportBtn = document.getElementById('aiEmbedExportBtn');
    if (!messagesEl || !inputEl) return; // view-ai isn't on this page

    var view = document.getElementById('view-ai');
    var viewDescription = view && view.querySelector('.ov-head p');
    var emptyDescription = emptyEl && emptyEl.querySelector('p');
    var footnote = view && view.querySelector('.ai-embed-footnote');
    if (viewDescription) viewDescription.textContent = 'General assistance runs locally. Company analytics require a connected Odoo account and your configured hosted AI provider.';
    if (emptyDescription) emptyDescription.textContent = 'General chat stays in this tab. Live Odoo analytics use your configured AI provider; query results are sent from this browser to that provider only when you ask for company data.';
    if (footnote && footnote.firstChild) footnote.firstChild.nodeValue = 'DashView AI · local general help · hosted provider for live Odoo analytics · ';

    var sessionSeed = 's' + Date.now();
    var thread = []; // { role: 'user'|'ai', content, tag, time }
    var thinkingRow = null;
    var dashboardIds = 0;
    var dashboardPayloads = Object.create(null);
    var agentLoading = null;

    function esc(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    // Turns one ```chart fenced block into a horizontal bar chart. Expected
    // shape (see js/ai-company-context.js's reporting instructions):
    //   ```chart
    //   Optional title
    //   Label one: 12345
    //   Label two: 9876
    //   ```
    // Returns an HTML string, or null if fewer than 2 lines parse as
    // "label <: or |> number", in which case the caller leaves the block
    // untouched so it still renders as plain code instead of vanishing.
    // NOTE: this runs on text esc() has already escaped once (see below) —
    // do not esc() the label/value again here, or entities double-escape.
    function renderChartBlock(raw) {
      var lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      var rowRe = /^(.+?)\s*[:|]\s*[$€£₹]?\s*([+-]?[\d,]*\.?\d+)\s*%?$/;
      var PALETTE = ['#e8a33d', '#5b8fae', '#c76b3c', '#7aa874', '#a78bc4', '#d4b95e', '#5fb3b3', '#b0798a'];

      // Optional first line "type: bar | line | donut" (default bar).
      var kind = 'bar';
      if (lines.length && /^type\s*:\s*(bar|line|donut)$/i.test(lines[0])) {
        kind = lines.shift().split(':')[1].trim().toLowerCase();
      }
      var title = '';
      if (lines.length && !rowRe.test(lines[0])) title = lines.shift();

      var rows = lines.map(function (l) {
        var m = l.match(rowRe);
        if (!m) return null;
        return { label: m[1].trim(), value: parseFloat(m[2].replace(/,/g, '')) };
      }).filter(function (r) { return r && isFinite(r.value); }).slice(0, kind === 'line' ? 24 : 8);

      if (rows.length < 2) return null;

      function fmt(v) {
        var rounded = Math.round(v);
        return (Math.abs(v - rounded) < 0.005 ? rounded : v).toLocaleString();
      }
      var titleHtml = title ? '<div class="ai-chart-title">' + (title) + '</div>' : '';
      var vals = rows.map(function (r) { return r.value; });

      if (kind === 'line') {
        var W = 560, H = 190, L = 10, R = 14, T = 22, B = 26;
        var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
        var span = (mx - mn) || 1;
        var n = rows.length;
        var pts = rows.map(function (r, i) {
          return { x: L + i * (W - L - R) / (n - 1), y: T + (1 - (r.value - mn) / span) * (H - T - B) };
        });
        var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
        var area = d + ' L' + pts[n - 1].x.toFixed(1) + ' ' + (H - B) + ' L' + pts[0].x.toFixed(1) + ' ' + (H - B) + ' Z';
        var step = Math.ceil(n / 6);
        var xl = rows.map(function (r, i) {
          if (i % step && i !== n - 1) return '';
          return '<text x="' + pts[i].x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle')) + '">' + (r.label) + '</text>';
        }).join('');
        var iMax = vals.indexOf(mx), iLast = n - 1;
        var tags = [iMax].concat(iLast !== iMax ? [iLast] : []).map(function (i) {
          return '<text class="ai-chart-pt" x="' + Math.min(Math.max(pts[i].x, 30), W - 30).toFixed(1) + '" y="' + (pts[i].y - 8).toFixed(1) + '" text-anchor="middle">' + (fmt(rows[i].value)) + '</text>';
        }).join('');
        var dots = pts.map(function (p) { return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3"/>'; }).join('');
        return '<div class="ai-chart">' + titleHtml +
          '<svg class="ai-chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + (title || 'Line chart') + '">' +
          '<line class="ai-chart-axis" x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '"/>' +
          '<path class="ai-chart-area" d="' + area + '"/><path class="ai-chart-line" d="' + d + '"/>' + dots + xl + tags + '</svg></div>';
      }

      if (kind === 'donut') {
        var total = vals.reduce(function (a, v) { return a + Math.abs(v); }, 0) || 1;
        var acc = 0;
        var stops = rows.map(function (r, i) {
          var from = acc / total * 100; acc += Math.abs(r.value); var to = acc / total * 100;
          return PALETTE[i % PALETTE.length] + ' ' + from.toFixed(2) + '% ' + to.toFixed(2) + '%';
        }).join(', ');
        var legend = rows.map(function (r, i) {
          return '<div class="ai-donut-item"><span class="ai-donut-dot" style="background:' + PALETTE[i % PALETTE.length] + '"></span>' +
            '<span class="ai-donut-label">' + (r.label) + '</span>' +
            '<span class="ai-chart-value">' + (fmt(r.value)) + ' · ' + (Math.abs(r.value) / total * 100).toFixed(1) + '%</span></div>';
        }).join('');
        return '<div class="ai-chart">' + titleHtml + '<div class="ai-donut-wrap"><div class="ai-donut" style="background:conic-gradient(' + stops + ')"><span></span></div>' +
          '<div class="ai-donut-legend">' + legend + '</div></div></div>';
      }

      var max = Math.max.apply(null, vals.map(Math.abs)) || 1;
      var barsHtml = rows.map(function (r) {
        var pct = Math.max((Math.abs(r.value) / max) * 100, 3);
        return '<div class="ai-chart-row">' +
          '<span class="ai-chart-label">' + (r.label) + '</span>' +
          '<span class="ai-chart-bar-track"><span class="ai-chart-bar-fill" style="width:' + pct.toFixed(1) + '%"></span></span>' +
          '<span class="ai-chart-value">' + (fmt(r.value)) + '</span></div>';
      }).join('');
      return '<div class="ai-chart">' + titleHtml + barsHtml + '</div>';
    }

    // ```kpi block: one card per line, "Label: value | change" (change optional, e.g. "+12.4% vs last month").
    function renderKpiBlock(raw) {
      var cards = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).slice(0, 6).map(function (l) {
        var i = l.indexOf(':');
        if (i < 1) return null;
        var parts = l.slice(i + 1).split('|').map(function (s) { return s.trim(); });
        if (!parts[0]) return null;
        var delta = parts[1] || '';
        var cls = /^[+▲↑]/.test(delta) ? ' up' : (/^[-−▼↓]/.test(delta) ? ' down' : '');
        return '<div class="ai-kpi"><div class="ai-kpi-label">' + (l.slice(0, i).trim()) + '</div>' +
          '<div class="ai-kpi-value">' + (parts[0]) + '</div>' +
          (delta ? '<div class="ai-kpi-delta' + cls + '">' + (delta) + '</div>' : '') + '</div>';
      }).filter(Boolean);
      return cards.length ? '<div class="ai-kpi-grid">' + cards.join('') + '</div>' : null;
    }

    // Same shape as ai.html's renderer, kept in sync deliberately — anything
    // that goes through DashViewAI.respond() should look the same wherever
    // it's rendered.
    function renderDashboard(payload, narrative) {
      if (!payload || payload.version !== 1 || !Array.isArray(payload.metrics) || !payload.metrics.length) return null;
      var id = 'embed-dashboard-' + (++dashboardIds);
      var insightsText = String(narrative || '').replace(/\n\n\*Live Odoo ·[^*]*\*/g, '').replace(/```[\s\S]*?```/g, '').replace(/^\s*#{1,6}\s*/gm, '').replace(/[*_`]/g, '').replace(/\|/g, ' · ').replace(/\n{3,}/g, '\n\n').slice(0, 12000).trim();
      dashboardPayloads[id] = Object.assign({}, payload, { insightsText: insightsText });
      var known = Object.keys(dashboardPayloads);
      if (known.length > 20) delete dashboardPayloads[known[0]];
      var date = new Date(payload.generatedAt);
      var generated = isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
      var metrics = payload.metrics.map(function (metric) {
        var rows = (metric.rows || []).filter(function (r) { return r && isFinite(Number(r.value)); }).slice(0, 24);
        if (!rows.length) return '';
        var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(Number(r.value)); })) || 1;
        var bars = rows.map(function (r) {
          return '<div class="ai-dashboard-bar-row"><span class="ai-dashboard-bar-label">' + esc(r.label || '') + '</span><span class="ai-dashboard-bar-track"><span class="ai-dashboard-bar-fill" style="width:' + Math.max(3, Math.abs(Number(r.value)) / max * 100).toFixed(1) + '%"></span></span><strong>' + esc(r.value) + '</strong></div>';
        }).join('');
        var tableRows = rows.map(function (r) {
          return '<tr><th scope="row">' + esc(r.label || '') + '</th><td>' + esc(r.value) + '</td><td>' + (r.count == null ? '—' : esc(r.count)) + '</td></tr>';
        }).join('');
        var visual = '<div class="ai-dashboard-bars" role="img" aria-label="' + esc(metric.title || 'Metric') + ' bar chart; exact values are listed in the table below">' + bars + '</div>';
        if (metric.chartType === 'line' && rows.length > 1) {
          var low = Math.min.apply(null, rows.map(function (r) { return Number(r.value); }));
          var high = Math.max.apply(null, rows.map(function (r) { return Number(r.value); }));
          var span = high - low || 1;
          var points = rows.map(function (r, i) { return { x: 28 + i * 504 / (rows.length - 1), y: 104 - (Number(r.value) - low) / span * 66 }; });
          var path = points.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
          var step = Math.ceil(rows.length / 6), maxIndex = rows.reduce(function (best, r, i, all) { return Number(r.value) > Number(all[best].value) ? i : best; }, 0);
          var marks = points.map(function (p, i) {
            return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3"/>' +
              (i % step === 0 || i === rows.length - 1 ? '<text x="' + p.x.toFixed(1) + '" y="128" text-anchor="middle">' + esc(String(rows[i].label).slice(0, 14)) + '</text>' : '') +
              (i === maxIndex || i === rows.length - 1 ? '<text x="' + p.x.toFixed(1) + '" y="' + Math.max(16, p.y - 8).toFixed(1) + '" text-anchor="middle">' + esc(String(rows[i].value)) + '</text>' : '');
          }).join('');
          visual = '<svg class="ai-dashboard-line" viewBox="0 0 560 140" role="img" aria-label="' + esc(metric.title || 'Metric') + ' line chart; exact values are listed in the table below"><line x1="20" y1="110" x2="540" y2="110"/><path d="' + path + '"/>' + marks + '</svg>';
        }
        return '<section class="ai-dashboard-metric"><h3>' + esc(metric.title || metric.model || 'Odoo metric') + '</h3>' +
          visual +
          '<table class="ai-dashboard-table"><caption>' + esc(metric.title || 'Metric') + ' — exact returned Odoo values</caption><thead><tr><th scope="col">Group</th><th scope="col">' + esc(metric.measure || 'Value') + '</th><th scope="col">Records</th></tr></thead><tbody>' + tableRows + '</tbody></table></section>';
      }).join('');
      var kpis = (payload.kpis || []).filter(function (k) { return k && isFinite(Number(k.value)); }).map(function (k) {
        return '<div class="ai-kpi"><div class="ai-kpi-label">' + esc(k.label || '') + '</div><div class="ai-kpi-value">' + esc(k.value) + '</div><div class="ai-kpi-delta">' + esc(k.queryId || 'Odoo result') + '</div></div>';
      }).join('');
      var methods = (payload.methods || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
      var limits = (payload.limitations || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
      return '<section class="ai-dashboard-artifact" aria-label="Odoo data dashboard" data-ai-dashboard-id="' + id + '">' +
        '<header class="ai-dashboard-head"><div><h2>' + esc(payload.title || 'Odoo dashboard') + '</h2><div class="ai-dashboard-meta">Generated ' + esc(generated) + ' · ' + esc(payload.source || 'Live Odoo query results') + (payload.currency ? ' · Currency: ' + esc(payload.currency) : '') + '</div></div>' +
        '<div class="ai-dashboard-actions"><button type="button" data-ai-dashboard-export>Export board-ready PDF</button><button type="button" data-ai-dashboard-print>Print / Save as PDF</button></div></header>' +
        (kpis ? '<div class="ai-kpi-grid">' + kpis + '</div>' : '') + metrics +
        '<div class="ai-dashboard-notes">' + (insightsText ? '<h3>Executive read-out</h3><div class="ai-dashboard-readout">' + esc(insightsText) + '</div>' : '') + '<h3>Method and sources</h3><ul>' + (methods || '<li>Read-only Odoo query results</li>') + '</ul><h3>Limitations</h3><ul>' + (limits || '<li>Only returned data is represented; no missing values are estimated.</li>') + '</ul></div></section>';
    }

    function renderMarkdown(text, liveOdoo) {
      text = String(text == null ? '' : text);
      if (liveOdoo) text = text.replace(/```(?:kpi|chart|dashboard)\s*\r?\n[\s\S]*?```/gi, '');
      return esc(text)
        .replace(/```kpi\n?([\s\S]*?)```/g, function (match, body) { return renderKpiBlock(body) || match; })
        .replace(/```chart\n?([\s\S]*?)```/g, function (match, body) { return renderChartBlock(body) || match; })
        .replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, code) { return '<pre><code>' + code.trim() + '</code></pre>'; })
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
        .replace(/^---$/gm, '<hr/>')
        .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, function (m) { return '<ul>' + m + '</ul>'; })
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br/>');
    }
    // esc() already ran inside renderMarkdown, so plain user text just needs esc().

    function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

    function appendMessage(role, content, tag, dashboard, liveOdoo) {
      if (emptyEl && emptyEl.parentNode) emptyEl.remove();
      var row = document.createElement('div');
      row.className = 'ai-embed-msg ' + role;
      var tagHtml = (role === 'ai' && tag) ? '<span class="ai-embed-tag">' + esc(tag) + '</span>' : '';
      var bodyHtml = role === 'ai'
        ? renderMarkdown(content, liveOdoo) + (dashboard ? renderDashboard(dashboard, content) : '')
        : '<p>' + esc(content) + '</p>';
      row.innerHTML =
        '<div class="ai-embed-avatar ' + role + '">' + (role === 'ai'
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M7 13l3-5 2 3 2-4 3 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          : 'You') + '</div>' +
        '<div class="ai-embed-bubble">' + tagHtml + '<div class="ai-embed-content">' + bodyHtml + '</div>' +
        '<div class="ai-embed-time">' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</div></div>';
      messagesEl.appendChild(row);
      scrollToBottom();
      return row;
    }

    function showThinking() {
      thinkingRow = document.createElement('div');
      thinkingRow.className = 'ai-embed-msg ai ai-embed-thinking';
      thinkingRow.innerHTML =
        '<div class="ai-embed-avatar ai"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M7 13l3-5 2 3 2-4 3 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
        '<div class="ai-embed-bubble"><div class="ai-embed-dots"><span></span><span></span><span></span></div></div>';
      messagesEl.appendChild(thinkingRow);
      scrollToBottom();
    }
    function clearThinking() {
      if (thinkingRow && thinkingRow.parentNode) thinkingRow.parentNode.removeChild(thinkingRow);
      thinkingRow = null;
    }

    function loadOdooAgent() {
      if (window.DVOdooAgent) return Promise.resolve(window.DVOdooAgent);
      if (agentLoading) return agentLoading;
      agentLoading = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = 'js/ai-odoo-agent.js';
        script.onload = function () {
          if (window.DVOdooAgent) resolve(window.DVOdooAgent);
          else reject(new Error('Odoo query agent did not initialize.'));
        };
        script.onerror = function () { reject(new Error('Could not load the Odoo query agent.')); };
        document.head.appendChild(script);
      });
      return agentLoading;
    }

    function limitConversationHistory(messages) {
      var hasCurrentPrompt = messages.length && messages[messages.length - 1].role === 'user';
      var history = hasCurrentPrompt ? messages.slice(0, -1) : messages.slice();
      var selected = [], remaining = 24000;
      for (var i = history.length - 1; i >= 0 && selected.length < 24 && remaining > 0; i--) {
        var content = String(history[i].content == null ? '' : history[i].content);
        if (!content.length) continue;
        if (content.length > remaining) content = content.slice(0, Math.max(0, remaining - 1)) + '…';
        selected.push({ role: history[i].role, content: content });
        remaining -= Math.min(content.length, remaining);
      }
      selected.reverse();
      if (hasCurrentPrompt) selected.push(messages[messages.length - 1]);
      return selected;
    }

    function answerDataQuestion(question) {
      var O = window.DVOdoo, C = window.DVAIConfig, cfg = C && C.get ? C.get() : null;
      var live = !!(O && O.isConnected && O.isConnected());
      var hosted = !!(C && C.isConfigured && C.isConfigured() && cfg && cfg.provider !== 'dashview');
      if (!live || !hosted) {
        var reason = !live
          ? 'Odoo is not connected in this workspace.'
          : 'No hosted AI provider is configured for the live Odoo query path.';
        return Promise.resolve('**Live company data is unavailable.** ' + reason + ' I will not invent business metrics. Configure an AI provider in Settings → AI Assistant, connect Odoo in Settings → Odoo, then ask again.');
      }
      return loadOdooAgent().then(function (agent) {
        var history = limitConversationHistory(thread.map(function (m) { return { role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }; }));
        return agent.askDetailed(question, history, { systemPrompt: cfg.systemPrompt || '' });
      });
    }

    /* Clickable next questions under the latest AI answer */
    function addFollowups(list) {
      if (!list || !list.length) return;
      var bubble = messagesEl.lastElementChild && messagesEl.lastElementChild.querySelector('.ai-embed-bubble');
      if (!bubble) return;
      var box = document.createElement('div'); box.className = 'ai-embed-followups'; box.setAttribute('aria-label', 'Suggested follow-up questions');
      list.forEach(function (q) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = q; b.title = 'Ask: ' + q;
        b.addEventListener('click', function () { box.remove(); send(q); });
        box.appendChild(b);
      });
      bubble.appendChild(box);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function send(text) {
      text = (text || inputEl.value || '').trim();
      if (!text || !window.DashViewAI) return;
      thread.push({ role: 'user', content: text });
      appendMessage('user', text);
      inputEl.value = '';
      inputEl.style.height = 'auto';
      sendBtn.disabled = true;
      showThinking();
      var businessDataQuestion = /\b(odoo|sales?|revenue|invoices?|orders?|customers?|clients?|vendors?|suppliers?|purchases?|stock|inventory|leads?|pipeline|employees?|expenses?|tasks?|receivables?|payables?|profit|bikri|udhaar|khareed|maal)\b/i.test(text) ||
        (/\b(dashboards?|board report)\b/i.test(text) && /\b(focused|board-ready|executive|company|business|data|metric|analytics|odoo|sales?|revenue)\b/i.test(text));
      if (businessDataQuestion) {
        answerDataQuestion(text).then(function (result) {
          clearThinking();
          var answer = typeof result === 'string' ? result : result.content;
          var dashboard = result && result.dashboard || null;
          var liveOdoo = !!(result && result.liveOdoo);
          var tag = dashboard ? 'Odoo dashboard' : (/\*\*Live company data is unavailable\./.test(answer) ? 'Live Odoo unavailable' : 'Live Odoo');
          thread.push({ role: 'ai', content: answer, tag: tag, dashboard: dashboard, liveOdoo: liveOdoo });
          appendMessage('ai', answer, tag, dashboard, liveOdoo);
          addFollowups(result && result.followups);
        }).catch(function (e) {
          clearThinking();
          var answer = 'I could not retrieve live Odoo data (' + (e && e.message ? e.message : 'connection error') + '). No metrics were generated; check Settings → Odoo and the AI provider, then retry.';
          thread.push({ role: 'ai', content: answer, tag: 'Live Odoo unavailable' });
          appendMessage('ai', answer, 'Live Odoo unavailable');
        }).then(function () {
          sendBtn.disabled = !inputEl.value.trim();
        });
        return;
      }
      // Small delay mirrors the full-page assistant's pacing so a reply
      // doesn't feel like it's just a synchronous string lookup.
      setTimeout(function () {
        var result;
        try { result = window.DashViewAI.respond(text, { seed: sessionSeed }); }
        catch (e) { result = { content: 'Something went wrong reading that — try rephrasing?', tag: null }; }
        clearThinking();
        thread.push({ role: 'ai', content: result.content, tag: result.tag });
        appendMessage('ai', result.content, result.tag);
      }, 350 + Math.min(600, text.length * 4));
    }

    inputEl.addEventListener('input', function () {
      sendBtn.disabled = !inputEl.value.trim();
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(160, inputEl.scrollHeight) + 'px';
    });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) send(); }
    });
    sendBtn.addEventListener('click', function () { send(); });

    function printDashboard() {
      document.body.classList.add('ai-dashboard-printing');
      var cleanupTimer;
      var cleanup = function () {
        document.body.classList.remove('ai-dashboard-printing');
        if (cleanupTimer) clearTimeout(cleanupTimer);
      };
      window.addEventListener('afterprint', cleanup, { once: true });
      cleanupTimer = setTimeout(cleanup, 30000);
      window.print();
    }
    document.addEventListener('click', function (event) {
      var exportBtn = event.target.closest && event.target.closest('[data-ai-dashboard-export]');
      var printBtn = event.target.closest && event.target.closest('[data-ai-dashboard-print]');
      if (!exportBtn && !printBtn) return;
      var section = event.target.closest('.ai-dashboard-artifact');
      if (!section) return;
      if (printBtn) {
        if (window.showToast) window.showToast('In the print dialog, choose “Save as PDF”. This browser fallback does not download a PDF automatically.');
        printDashboard();
        return;
      }
      var payload = dashboardPayloads[section.getAttribute('data-ai-dashboard-id')];
      if (payload && window.DVReportEngine && typeof window.DVReportEngine.generateAIDashboardPdf === 'function') {
        window.DVReportEngine.generateAIDashboardPdf(payload).then(function () {
          if (window.showToast) window.showToast('Board-ready dashboard PDF exported.');
        }).catch(function () {
          if (window.showToast) window.showToast('PDF library unavailable; opening print dialog. Choose “Save as PDF”.');
          printDashboard();
        });
      } else {
        if (window.showToast) window.showToast('PDF export tooling unavailable; opening print dialog. Choose “Save as PDF”.');
        printDashboard();
      }
    });

    document.querySelectorAll('.ai-embed-suggest-card').forEach(function (card) {
      card.addEventListener('click', function () { send(card.dataset.prompt); });
    });

    if (newChatBtn) newChatBtn.addEventListener('click', function () {
      thread = [];
      messagesEl.innerHTML = '';
      if (emptyEl) messagesEl.appendChild(emptyEl);
      inputEl.value = '';
      sendBtn.disabled = true;
      if (window.showToast) window.showToast('Started a new chat.');
    });

    if (exportBtn) exportBtn.addEventListener('click', function () {
      if (!thread.length) { if (window.showToast) window.showToast('Nothing to export yet.'); return; }
      var text = thread.map(function (m) { return (m.role === 'user' ? 'You' : 'DashView AI') + ':\n' + m.content; }).join('\n\n');
      var blob = new Blob([text], { type: 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'dashview-ai-chat.txt';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (window.showToast) window.showToast('Chat exported.');
    });
  });
})();
