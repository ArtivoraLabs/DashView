/* ==========================================================================
   DashView — Company context for the AI Assistant
   --------------------------------------------------------------------------
   Builds a short, factual briefing out of data already sitting in this
   browser: the dashboard's tracked projects / GitHub connection, plus live
   Odoo records when Odoo is connected (Settings → Odoo). This text is
   folded into the AI's system prompt so questions like "how many open sales
   orders do we have?" or "what's in our product catalog?" get answered from
   real data instead of guessed — as long as "Include company context" is
   left on in Settings → AI Assistant.

   Reporting depth is deliberately symmetric across every business area —
   Sales, CRM/Pipeline, Purchasing, Inventory, Accounting/Finance,
   HR/Workforce and Projects each get their own row samples, their own
   ranked read_group breakdowns, and their own data-quality checks below,
   and the instructions at the bottom of build() apply the exact same
   "KPIs → table → chart → insights → next step" structure to whichever
   area(s) the question is about, not just Sales.

   Nothing here is fetched or sent anywhere except to the AI provider you
   configure, as part of the request you're already sending it.

   Exposes window.DVAICompanyContext.build({ force }) → Promise<string>
   ========================================================================== */
(function () {
  'use strict';

  var CACHE_MS = 2 * 60 * 1000;
  var cache = { text: '', at: 0 };

  function dashboardContext() {
    var parts = [];
    try {
      var gh = JSON.parse(localStorage.getItem('al_github_connection') || 'null');
      if (gh && gh.login) parts.push('GitHub account/org connected to the dashboard: "' + gh.login + '".');
    } catch (e) {}
    try {
      var own = JSON.parse(localStorage.getItem('al_own_projects') || '[]');
      if (own.length) {
        var list = own.slice(0, 8).map(function (p) {
          var stats = p.stats || {};
          return '- "' + p.title + '" (#' + p.number + ', ' + (stats.open || 0) + ' open / ' + (stats.closed || 0) + ' closed, ' + (stats.pct || 0) + '% complete)';
        }).join('\n');
        parts.push('Tracked projects on the dashboard:\n' + list);
      }
    } catch (e) {}
    return parts.join('\n\n');
  }

  // Pulls the first number out of a formatted field like "$12,430.00" or
  // "PKR 4,200" so small totals/averages can be computed client-side —
  // more reliable than asking the model to add up formatted strings itself.
  function parseNumber(v) {
    if (v == null || v === '—') return null;
    var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? null : n;
  }

  function fmtMoney(n) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function summarizeRows(label, res, sumField) {
    if (!res || !res.rows || !res.rows.length) return label + ': none found.';
    var fields = res.fields || [];
    var total = res.total != null ? res.total : res.rows.length;

    var aggLine = '';
    if (sumField) {
      var idx = fields.indexOf(sumField);
      if (idx > -1) {
        var sum = 0, counted = 0;
        res.rows.forEach(function (row) {
          var n = parseNumber(row[idx]);
          if (n != null) { sum += n; counted++; }
        });
        if (counted) aggLine = '  Computed from the ' + counted + ' shown: sum of ' + sumField + ' = ' + fmtMoney(sum) + ', average = ' + fmtMoney(sum / counted) + '.\n';
      }
    }

    var lines = res.rows.slice(0, 8).map(function (row) {
      return '  - ' + fields.map(function (f, i) { return f + ': ' + row[i]; }).join(', ');
    });
    var totalNote = total > res.rows.length ? ' (' + total + ' total, showing ' + res.rows.length + ')' : ' (' + total + ' total)';
    return label + totalNote + ':\n' + aggLine + lines.join('\n');
  }

  var SUM_FIELD = {
    'sale.order': 'Total', 'crm.lead': 'Expected Revenue',
    'account.move': 'Total', 'purchase.order': 'Total'
  };

  function isoDate(daysAgo) {
    var d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
  }

  // Row-level samples — good for "show me / list" style questions. Covers
  // sales, purchasing, inventory, accounting, CRM, HR and projects so
  // "fetch every kind of data" questions have something real to draw on.
  // Modules the Odoo instance doesn't have installed just come back empty
  // (caught below) — harmless.
  var fetchers = [
    { model: 'sale.order', label: 'Recent sales orders' },
    { model: 'product.template', label: 'Products' },
    { model: 'res.partner', label: 'Customers' },
    { model: 'crm.lead', label: 'CRM leads' },
    { model: 'account.move', label: 'Recent invoices / bills' },
    { model: 'purchase.order', label: 'Recent purchase orders' },
    { model: 'stock.picking', label: 'Recent inventory transfers' },
    { model: 'hr.employee', label: 'Employees' },
    { model: 'project.task', label: 'Project tasks' },
    { model: 'hr.expense', label: 'Recent expenses' }
  ];

  // Aggregate breakdowns via read_group — good for reporting/"X-wise"
  // questions (totals by stage, by salesperson, top performers) without
  // dumping raw rows. Each entry -> one read_group call, summarized as text.
  // orderby + limit let us pull ranked "Top N" breakdowns directly from
  // Odoo instead of sorting client-side; domain (optional) filters the
  // group the same way it does for issueFetchers below.
  //
  // Grouped by business area on purpose, and kept even across areas: every
  // module that has a "Top 5 X" style table also has a plain "by stage/
  // status" table, matching the original Sales breakdown one-for-one.
  var aggregates = [
    // ── Sales ────────────────────────────────────────────────────────────
    { model: 'sale.order', label: 'Sales orders by stage', groupby: ['state'], fields: ['amount_total:sum'] },
    { model: 'sale.order', label: 'Sales by salesperson', groupby: ['user_id'], fields: ['amount_total:sum'], orderby: 'amount_total desc' },
    { model: 'sale.order', label: 'Top 5 customers by revenue', groupby: ['partner_id'], fields: ['amount_total:sum'], orderby: 'amount_total desc', limit: 5 },
    { model: 'sale.order.line', label: 'Top 5 products by revenue', groupby: ['product_id'], fields: ['price_subtotal:sum'], orderby: 'price_subtotal desc', limit: 5 },

    // ── CRM / Pipeline ───────────────────────────────────────────────────
    { model: 'crm.lead', label: 'CRM leads by stage', groupby: ['stage_id'], fields: ['expected_revenue:sum'] },
    { model: 'crm.lead', label: 'Top 5 salespeople by pipeline value', groupby: ['user_id'], fields: ['expected_revenue:sum'], orderby: 'expected_revenue desc', limit: 5 },

    // ── Purchasing ───────────────────────────────────────────────────────
    { model: 'purchase.order', label: 'Purchase orders by stage', groupby: ['state'], fields: ['amount_total:sum'] },
    { model: 'purchase.order', label: 'Top 5 vendors by spend', groupby: ['partner_id'], fields: ['amount_total:sum'], orderby: 'amount_total desc', limit: 5, domain: [['state', '!=', 'cancel']] },

    // ── Inventory ────────────────────────────────────────────────────────
    { model: 'stock.picking', label: 'Inventory transfers by status', groupby: ['state'], fields: [] },
    { model: 'stock.quant', label: 'Top 5 products by stock on hand', groupby: ['product_id'], fields: ['quantity:sum'], orderby: 'quantity desc', limit: 5 },

    // ── Accounting / Finance ─────────────────────────────────────────────
    {
      model: 'account.move', label: 'Revenue by month (posted customer invoices, last 12 months)',
      groupby: ['invoice_date:month'], fields: ['amount_total:sum'], orderby: 'invoice_date:month asc',
      domain: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['invoice_date', '>=', isoDate(365)]]
    },
    {
      model: 'account.move', label: 'Top 5 customers by outstanding balance (AR)',
      groupby: ['partner_id'], fields: ['amount_residual:sum'], orderby: 'amount_residual desc', limit: 5,
      domain: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['payment_state', 'not in', ['paid', 'in_payment', 'reversed']]]
    },

    // ── HR / Workforce ───────────────────────────────────────────────────
    { model: 'hr.employee', label: 'Headcount by department', groupby: ['department_id'], fields: [] },
    { model: 'hr.expense', label: 'Expenses by category', groupby: ['product_id'], fields: ['total_amount:sum'], orderby: 'total_amount desc' },

    // ── Projects ─────────────────────────────────────────────────────────
    { model: 'project.task', label: 'Tasks by stage', groupby: ['stage_id'], fields: [] },
    { model: 'project.task', label: 'Tasks by project', groupby: ['project_id'], fields: [] }
  ];

  // Targeted, filtered queries that surface data-quality problems and
  // process glitches directly from Odoo — not guessed, not computed from
  // truncated sample rows. Each becomes its own "⚠️" block in the context
  // so the AI can point at real broken/stuck records with IDs and names.
  // Covers every area with row-level data above, not just Sales/Accounting,
  // so an HR or Projects question can get a real "Issues Found" section too.
  var issueFetchers = [
    {
      model: 'account.move', label: '⚠️ Overdue unpaid invoices',
      domain: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'],
               ['payment_state', 'not in', ['paid', 'in_payment', 'reversed']],
               ['invoice_date_due', '<', isoDate(0)]]
    },
    {
      model: 'sale.order', label: '⚠️ Sales orders stuck in Draft/Quotation 14+ days',
      domain: [['state', 'in', ['draft', 'sent']], ['create_date', '<', isoDate(14)]]
    },
    {
      model: 'purchase.order', label: '⚠️ Purchase orders stuck in Draft 14+ days',
      domain: [['state', '=', 'draft'], ['create_date', '<', isoDate(14)]]
    },
    {
      model: 'crm.lead', label: '⚠️ CRM leads stalled 30+ days with no progress',
      domain: [['active', '=', true], ['probability', '<', 100], ['create_date', '<', isoDate(30)]]
    },
    {
      model: 'stock.quant', label: '⚠️ Products with negative stock (data error)',
      domain: [['quantity', '<', 0]]
    },
    {
      model: 'hr.expense', label: '⚠️ Expense reports pending approval/posting 14+ days',
      domain: [['state', 'not in', ['done', 'refused']], ['create_date', '<', isoDate(14)]]
    },
    {
      model: 'project.task', label: '⚠️ Open tasks past their deadline',
      domain: [['date_deadline', '<', isoDate(0)], ['stage_id.fold', '=', false]]
    }
  ];

  function fmtGroupVal(v) {
    if (v == null || v === false) return '—';
    return Array.isArray(v) ? (v[1] || v[0]) : String(v);
  }

  function summarizeGroups(label, groupField, res) {
    if (!res || !res.groups || !res.groups.length) return '';
    var lines = res.groups.slice(0, 12).map(function (g) {
      var key = fmtGroupVal(g[groupField]);
      var count = g.__count != null ? g.__count : '';
      var extra = Object.keys(g).filter(function (k) {
        return k !== groupField && k !== '__count' && k !== '__domain';
      }).map(function (k) { return k + '=' + g[k]; }).join(', ');
      return '  - ' + key + (count !== '' ? ' (' + count + ' records' + (extra ? ', ' + extra : '') + ')' : (extra ? ' — ' + extra : ''));
    });
    return label + ':\n' + lines.join('\n');
  }

  // Settings → AI Assistant → "Data it can read" writes dashview_ai_scope
  // (js/settings-pro.js). Maps each Odoo model to the scope category it
  // belongs to, so unticking e.g. Payroll actually removes those queries
  // instead of just hiding the checkbox.
  var MODEL_SCOPE = {
    'sale.order': 'sales', 'sale.order.line': 'sales', 'account.move': 'sales',
    'product.template': 'products', 'stock.picking': 'products', 'stock.quant': 'products', 'purchase.order': 'products',
    'res.partner': 'crm', 'crm.lead': 'crm',
    'hr.employee': 'hr', 'hr.expense': 'payroll',
    'project.task': 'projects'
  };
  var SCOPE_DEFAULTS = { sales: true, products: true, crm: true, payroll: false, projects: true, hr: false };
  function readScope() {
    try {
      var stored = JSON.parse(localStorage.getItem('dashview_ai_scope'));
      return Object.assign({}, SCOPE_DEFAULTS, stored && typeof stored === 'object' ? stored : {});
    } catch (e) { return Object.assign({}, SCOPE_DEFAULTS); }
  }
  function inScope(model, scope) {
    var cat = MODEL_SCOPE[model];
    return !cat || scope[cat] !== false; // unmapped models are always included
  }

  function odooContext() {
    if (!window.DVOdoo || !window.DVOdoo.isConnected()) return Promise.resolve('');
    var unavailable = []; // areas whose query failed (module not installed / no access rights) — told to the AI instead of hidden
    function miss(label) { return function () { unavailable.push(label.replace('⚠️ ', '')); return ''; }; }
    var scope = readScope();
    var scopedFetchers = fetchers.filter(function (f) { return inScope(f.model, scope); });
    var scopedAggregates = aggregates.filter(function (a) { return inScope(a.model, scope); });
    var scopedIssueFetchers = issueFetchers.filter(function (f) { return inScope(f.model, scope); });

    var rowJobs = scopedFetchers.map(function (f) {
      return window.DVOdoo.fetchModel(f.model, { limit: 15 })
        .then(function (r) { return summarizeRows(f.label, r, SUM_FIELD[f.model]); })
        .catch(miss(f.label));
    });

    var aggJobs = (window.DVOdoo.fetchReadGroup ? scopedAggregates : []).map(function (a) {
      return window.DVOdoo.fetchReadGroup(a.model, {
        groupby: a.groupby, fields: a.fields.concat(['__count']),
        orderby: a.orderby, limit: a.limit, domain: a.domain || []
      })
        .then(function (r) { return summarizeGroups(a.label, a.groupby[0], r); })
        .catch(miss(a.label));
    });

    // Issue-detection queries run last and are labelled separately so they
    // land in their own "flagged" section below, distinct from normal data.
    var issueJobs = scopedIssueFetchers.map(function (f) {
      return window.DVOdoo.fetchModel(f.model, { limit: 10, domain: f.domain })
        .then(function (r) {
          if (!r || !r.rows || !r.rows.length) return f.label + ': none found — looks clean.';
          return summarizeRows(f.label, r, SUM_FIELD[f.model]);
        })
        .catch(miss(f.label)); // model/module not installed, no access right, or field not present on this DB
    });

    return Promise.all([Promise.all(rowJobs.concat(aggJobs)), Promise.all(issueJobs)])
      .then(function (results) {
        var body = results[0].filter(Boolean).join('\n\n');
        var issuesBody = results[1].filter(Boolean).join('\n\n');
        if (!body && !issuesBody) return '';
        var cfg = window.DVOdoo.getConfig();
        var out = 'Live data from the connected Odoo instance (' + (cfg.url || 'Odoo') + '):\n\n' + body;
        out += '\n\nConnection: live query OK (' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC).';
        if (unavailable.length) {
          out += '\nNOT available from this Odoo right now (module not installed or the API user has no access): ' + unavailable.join('; ') + '. Say so plainly if asked about these — never guess numbers for them.';
        }
        if (issuesBody) {
          out += '\n\n--- Automated data-quality / process checks (filtered queries, not raw samples) ---\n\n' + issuesBody;
        }
        return out;
      });
  }

  function build(opts) {
    opts = opts || {};
    if (!opts.force && cache.text && (Date.now() - cache.at) < CACHE_MS) {
      return Promise.resolve(cache.text);
    }
    return odooContext().then(function (odoo) {
      var parts = [dashboardContext(), odoo].filter(Boolean);
      if (!parts.length) { cache = { text: '', at: Date.now() }; return ''; }
      var instructions = odoo
        ? 'You are a business analyst presenting to company leadership — answer like a dashboard, not a chat reply. ' +
          'The context above can span several business areas — Sales, CRM/Pipeline, Purchasing, Inventory, Accounting/Finance, HR/Workforce and Projects. ' +
          'Give EVERY area the exact same reporting depth and polish described below — never let Sales get a richer, more detailed answer than CRM, Inventory, HR, Purchasing, Accounting or Projects just because more examples below happen to mention sales. Match the quality to whichever area(s) the question is actually about. Rules:\n' +
          '1. Open with 2-4 headline KPI cards using this exact fenced format (it renders as KPI cards): ```kpi then one line per card as \"Label: value | change\" (change optional, start with + or -), then ```. Use only numbers present in the context.\n' +
          '2. Include the ranked breakdown table(s) that fit the question, as real Markdown tables (header row, |---|---| separator row, data rows), ranked, with columns like Rank | Name | Value | (a relevant 4th column when useful, e.g. Orders/Count). Pick from whichever of these match the data available above and the question asked — do not force a table that has no data behind it:\n' +
          '   - Sales / revenue / customers / products → Top 5 Customers and/or Top 5 Products by revenue\n' +
          '   - CRM / pipeline / leads → CRM leads by stage and/or Top 5 salespeople by pipeline value\n' +
          '   - Purchasing / vendors / spend → Top 5 vendors by spend and/or Purchase orders by stage\n' +
          '   - Inventory / stock / warehouse → Top 5 products by stock on hand and/or Inventory transfers by status\n' +
          '   - Accounting / finance / invoices → Revenue by month and/or Top 5 customers by outstanding balance (AR)\n' +
          '   - HR / workforce / payroll → Headcount by department and/or Expenses by category\n' +
          '   - Projects / tasks → Tasks by stage and/or Tasks by project\n' +
          '   Never invent ranks or numbers that are not in the context — use exactly what is given, and if there are fewer rows than a table asks for, show what is available.\n' +
          '3. Immediately below the main table, turn its top rows into a real visualization using this exact fenced format (it renders as a bar chart, not as code) — pick whichever single breakdown from step 2 is most decision-relevant to the question:\n' +
          '```chart\n' +
          'Short chart title\n' +
          'Label one: 12345\n' +
          'Label two: 9876\n' +
          '```\n' +
          '   One "Label: number" per line, plain numbers only (no currency symbols, commas or %), up to 8 rows, ordered largest to smallest, using only real figures already in the context above. Skip the chart only if fewer than 2 real data points exist for that breakdown — never fabricate rows to fill it.\n' +
          '4. Follow the table/chart with a short "Insights" section (2-4 bullet points) calling out what is notable for that specific area — a top or at-risk customer/vendor/employee, a stage where things are stuck, a concentration risk, a trend.\n' +
          '5. End with a "Recommended next step / strategy" section (1-3 bullet points) — a concrete, prioritized action for this period, not generic advice.\n' +
          '6. If the question spans multiple areas at once (e.g. "give me a full company report", "how is the business doing", "summarize everything") produce one subsection per relevant area, each following steps 1-5 in full under a bold heading naming the area (e.g. "**Sales**", "**Inventory**") — every area gets the complete treatment, not an abbreviated one.\n' +
          '7. Use the exact figures given in the context above — never invent numbers — and say plainly if something was not in the sample/range shown.\n' +
          '8. For non-analytical questions (a lookup, a yes/no, a how-to), skip this structure and just answer directly and concisely.\n' +
          '9. If the user asks about mistakes, errors, glitches, problems or "what\'s wrong", OR if the "Automated data-quality / process checks" block above lists anything other than "none found", always add a "⚠️ Issues Found" section covering every area that has a flagged item, not just Sales — one entry per problem, each with exactly three parts: **Issue** (what and how many, naming real records/customers/products/employees from the data — never vague), **Why it matters** (the business impact in one line), **Fix** (a specific, actionable step — who should do what). If every checked area came back "none found", say plainly "No data-quality issues detected in the areas checked" instead of inventing one — do not pad the answer with a fake issue.'
        : 'Background only — mention specifics from it only if the question calls for them.';
      var text = 'Company / workspace context:\n\n' + parts.join('\n\n') + '\n\n' + instructions;
      cache = { text: text, at: Date.now() };
      return text;
    });
  }

  window.DVAICompanyContext = { build: build };
})();
