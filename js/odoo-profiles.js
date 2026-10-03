/* ==========================================================================
   DashView — Odoo module profiles (window.DVOdooProfiles)
   What "good visualisation for this module" means, per Odoo app:
   the primary models to offer in the dropdown, 3–4 headline KPIs and 2–4
   charts. Anything without a profile gets a generic one built from the
   selected model's own fields, so every module still gets a useful view.
   Date tokens in domains: $now, $d30, $d365 (resolved at run time).
   ========================================================================== */
(function () {
  'use strict';

  var CONF = [['state', 'in', ['sale', 'done']]];
  var P = {
    sale: {
      title: 'Sales', models: ['sale.order', 'sale.order.line', 'res.partner', 'product.template'],
      kpis: [
        { label: 'Confirmed revenue', model: 'sale.order', domain: CONF, measure: 'amount_total', kind: 'money', sub: 'All confirmed orders' },
        { label: 'Revenue (30 days)', model: 'sale.order', domain: CONF.concat([['date_order', '>=', '$d30']]), measure: 'amount_total', kind: 'money', sub: 'Confirmed in the last 30 days' },
        { label: 'Open quotations', model: 'sale.order', domain: [['state', 'in', ['draft', 'sent']]], measure: 'amount_total', kind: 'count', sub: 'Waiting to be confirmed' },
        { label: 'Orders (30 days)', model: 'sale.order', domain: CONF.concat([['date_order', '>=', '$d30']]), kind: 'count', sub: 'Confirmed in the last 30 days' }
      ],
      charts: [
        { title: 'Revenue by month', model: 'sale.order', domain: CONF, groupby: 'date_order:month', measure: 'amount_total', type: 'bar', last: 12 },
        { title: 'Orders by stage', model: 'sale.order', groupby: 'state', type: 'doughnut' },
        { title: 'Top salespeople by revenue', model: 'sale.order', domain: CONF, groupby: 'user_id', measure: 'amount_total', type: 'hbar', limit: 8 },
        { title: 'Top customers by revenue', model: 'sale.order', domain: CONF, groupby: 'partner_id', measure: 'amount_total', type: 'hbar', limit: 8 },
        { title: 'Top products by revenue', model: 'sale.order.line', groupby: 'product_id', measure: 'price_subtotal', type: 'hbar', limit: 8 },
        { title: 'Revenue by sales team', model: 'sale.order', domain: CONF, groupby: 'team_id', measure: 'amount_total', type: 'doughnut' }
      ]
    },
    crm: {
      title: 'CRM', models: ['crm.lead', 'crm.team', 'crm.stage'],
      kpis: [
        { label: 'Open pipeline', model: 'crm.lead', domain: [['type', '=', 'opportunity'], ['probability', '<', 100]], measure: 'expected_revenue', kind: 'money', sub: 'Expected revenue, open opportunities' },
        { label: 'Won (all time)', model: 'crm.lead', domain: [['probability', '=', 100]], measure: 'expected_revenue', kind: 'money', sub: 'Closed-won revenue' },
        { label: 'New leads (30 days)', model: 'crm.lead', domain: [['create_date', '>=', '$d30']], kind: 'count', sub: 'Created in the last 30 days' }
      ],
      charts: [
        { title: 'Pipeline by stage', model: 'crm.lead', domain: [['type', '=', 'opportunity']], groupby: 'stage_id', measure: 'expected_revenue', type: 'bar' },
        { title: 'Leads by source', model: 'crm.lead', groupby: 'source_id', type: 'doughnut' },
        { title: 'Pipeline by salesperson', model: 'crm.lead', domain: [['type', '=', 'opportunity'], ['probability', '<', 100]], groupby: 'user_id', measure: 'expected_revenue', type: 'hbar', limit: 8 },
        { title: 'New leads per month', model: 'crm.lead', groupby: 'create_date:month', type: 'line', last: 12 }
      ]
    },
    account: {
      title: 'Accounting', models: ['account.move', 'account.move.line', 'account.payment', 'account.journal'],
      kpis: [
        { label: 'Invoiced (posted)', model: 'account.move', domain: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']], measure: 'amount_total', kind: 'money', sub: 'Customer invoices' },
        { label: 'Receivable outstanding', model: 'account.move', domain: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']]], measure: 'amount_residual', kind: 'money', sub: 'Unpaid customer invoices' },
        { label: 'Vendor bills (posted)', model: 'account.move', domain: [['move_type', '=', 'in_invoice'], ['state', '=', 'posted']], measure: 'amount_total', kind: 'money', sub: 'Supplier bills' }
      ],
      charts: [
        { title: 'Invoiced by month', model: 'account.move', domain: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']], groupby: 'invoice_date:month', measure: 'amount_total', type: 'bar', last: 12 },
        { title: 'Invoices by payment status', model: 'account.move', domain: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']], groupby: 'payment_state', type: 'doughnut' },
        { title: 'Entries by type', model: 'account.move', groupby: 'move_type', type: 'hbar' }
      ]
    },
    purchase: {
      title: 'Purchase', models: ['purchase.order', 'purchase.order.line', 'res.partner'],
      kpis: [
        { label: 'Confirmed spend', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']]], measure: 'amount_total', kind: 'money', sub: 'Confirmed purchase orders' },
        { label: 'Spend (30 days)', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']], ['date_order', '>=', '$d30']], measure: 'amount_total', kind: 'money', sub: 'Confirmed in the last 30 days' },
        { label: 'RFQs open', model: 'purchase.order', domain: [['state', 'in', ['draft', 'sent']]], kind: 'count', sub: 'Requests for quotation' },
        { label: 'Orders (30 days)', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']], ['date_order', '>=', '$d30']], kind: 'count', sub: 'Confirmed in the last 30 days' }
      ],
      charts: [
        { title: 'Spend by month', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']]], groupby: 'date_order:month', measure: 'amount_total', type: 'bar', last: 12 },
        { title: 'Orders by status', model: 'purchase.order', groupby: 'state', type: 'doughnut' },
        { title: 'Top vendors by spend', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']]], groupby: 'partner_id', measure: 'amount_total', type: 'hbar', limit: 8 },
        { title: 'Top products purchased', model: 'purchase.order.line', groupby: 'product_id', measure: 'price_subtotal', type: 'hbar', limit: 8 },
        { title: 'Orders placed per month', model: 'purchase.order', groupby: 'date_order:month', type: 'line', last: 12 }
      ]
    },
    stock: {
      title: 'Inventory', models: ['stock.picking', 'stock.move', 'stock.quant', 'stock.warehouse', 'product.product'],
      kpis: [
        { label: 'Units on hand', model: 'stock.quant', measure: 'quantity', kind: 'num', sub: 'Total stock across all locations' },
        { label: 'Ready to process', model: 'stock.picking', domain: [['state', '=', 'assigned']], kind: 'count', sub: 'Transfers ready' },
        { label: 'Waiting', model: 'stock.picking', domain: [['state', 'in', ['confirmed', 'waiting']]], kind: 'count', sub: 'Waiting on stock/another operation' },
        { label: 'Late', model: 'stock.picking', domain: [['state', 'not in', ['done', 'cancel']], ['scheduled_date', '<', '$now']], kind: 'count', sub: 'Past scheduled date' }
      ],
      charts: [
        { title: 'Transfers by status', model: 'stock.picking', groupby: 'state', type: 'doughnut' },
        { title: 'Transfers by type', model: 'stock.picking', groupby: 'picking_type_id', type: 'hbar', limit: 8 },
        { title: 'Transfers per month', model: 'stock.picking', groupby: 'scheduled_date:month', type: 'line', last: 12 },
        { title: 'Stock on hand by location', model: 'stock.quant', groupby: 'location_id', measure: 'quantity', type: 'hbar', limit: 8 },
        { title: 'Stock on hand by product', model: 'stock.quant', groupby: 'product_id', measure: 'quantity', type: 'hbar', limit: 8 },
        { title: 'Quantity moved per month', model: 'stock.move', groupby: 'date:month', measure: 'product_uom_qty', type: 'line', last: 12 }
      ]
    },
    hr: {
      title: 'Employees', models: ['hr.employee', 'hr.department', 'hr.job'],
      kpis: [
        { label: 'Employees', model: 'hr.employee', kind: 'count', sub: 'Active employees' },
        { label: 'Hired (365 days)', model: 'hr.employee', domain: [['create_date', '>=', '$d365']], kind: 'count', sub: 'Added in the last year' }
      ],
      charts: [
        { title: 'Headcount by department', model: 'hr.employee', groupby: 'department_id', type: 'hbar', limit: 10 },
        { title: 'Employees by job', model: 'hr.employee', groupby: 'job_id', type: 'doughnut' },
        { title: 'Employees by company', model: 'hr.employee', groupby: 'company_id', type: 'hbar', limit: 8 }
      ]
    },
    hr_holidays: {
      title: 'Time Off', models: ['hr.leave', 'hr.leave.allocation', 'hr.leave.type'],
      kpis: [
        { label: 'To approve', model: 'hr.leave', domain: [['state', 'in', ['confirm', 'validate1']]], kind: 'count', sub: 'Waiting for a decision' },
        { label: 'Approved', model: 'hr.leave', domain: [['state', '=', 'validate']], kind: 'count', sub: 'Approved requests' }
      ],
      charts: [
        { title: 'Requests by status', model: 'hr.leave', groupby: 'state', type: 'doughnut' },
        { title: 'Requests by type', model: 'hr.leave', groupby: 'holiday_status_id', type: 'hbar', limit: 8 },
        { title: 'Requests by department', model: 'hr.leave', groupby: 'department_id', type: 'hbar', limit: 8 }
      ]
    },
    hr_expense: {
      title: 'Expenses', models: ['hr.expense', 'hr.expense.sheet'],
      kpis: [{ label: 'Total expenses', model: 'hr.expense', measure: 'total_amount', kind: 'money', sub: 'All expense lines' }],
      charts: [
        { title: 'Expenses by status', model: 'hr.expense', groupby: 'state', measure: 'total_amount', type: 'doughnut' },
        { title: 'Expenses by employee', model: 'hr.expense', groupby: 'employee_id', measure: 'total_amount', type: 'hbar', limit: 8 },
        { title: 'Expenses by month', model: 'hr.expense', groupby: 'date:month', measure: 'total_amount', type: 'bar', last: 12 }
      ]
    },
    project: {
      title: 'Project', models: ['project.task', 'project.project', 'account.analytic.line'],
      kpis: [
        { label: 'Projects', model: 'project.project', kind: 'count', sub: 'Active projects' },
        { label: 'Open tasks', model: 'project.task', kind: 'count', sub: 'Tasks in progress' }
      ],
      charts: [
        { title: 'Tasks by stage', model: 'project.task', groupby: 'stage_id', type: 'bar' },
        { title: 'Tasks by project', model: 'project.task', groupby: 'project_id', type: 'hbar', limit: 8 },
        { title: 'Tasks created per month', model: 'project.task', groupby: 'create_date:month', type: 'line', last: 12 }
      ]
    },
    mrp: {
      title: 'Manufacturing', models: ['mrp.production', 'mrp.bom', 'mrp.workorder', 'mrp.workcenter'],
      kpis: [
        { label: 'In progress', model: 'mrp.production', domain: [['state', '=', 'progress']], kind: 'count', sub: 'Manufacturing orders' },
        { label: 'Confirmed', model: 'mrp.production', domain: [['state', '=', 'confirmed']], kind: 'count', sub: 'Waiting to start' }
      ],
      charts: [
        { title: 'Orders by status', model: 'mrp.production', groupby: 'state', type: 'doughnut' },
        { title: 'Orders by product', model: 'mrp.production', groupby: 'product_id', type: 'hbar', limit: 8 },
        { title: 'Orders per month', model: 'mrp.production', groupby: 'date_start:month', type: 'line', last: 12 }
      ]
    },
    point_of_sale: {
      title: 'Point of Sale', models: ['pos.order', 'pos.session', 'pos.config', 'pos.payment'],
      kpis: [{ label: 'POS revenue', model: 'pos.order', domain: [['state', 'in', ['paid', 'done', 'invoiced']]], measure: 'amount_total', kind: 'money', sub: 'Paid orders' }],
      charts: [
        { title: 'POS revenue by month', model: 'pos.order', domain: [['state', 'in', ['paid', 'done', 'invoiced']]], groupby: 'date_order:month', measure: 'amount_total', type: 'bar', last: 12 },
        { title: 'Orders by status', model: 'pos.order', groupby: 'state', type: 'doughnut' },
        { title: 'Revenue by cashier', model: 'pos.order', groupby: 'user_id', measure: 'amount_total', type: 'hbar', limit: 8 }
      ]
    },
    contacts: {
      title: 'Contacts', models: ['res.partner', 'res.partner.category', 'res.country'],
      kpis: [
        { label: 'Contacts', model: 'res.partner', kind: 'count', sub: 'All active contacts' },
        { label: 'Customers', model: 'res.partner', domain: [['customer_rank', '>', 0]], kind: 'count', sub: 'With at least one sale' },
        { label: 'Vendors', model: 'res.partner', domain: [['supplier_rank', '>', 0]], kind: 'count', sub: 'With at least one purchase' }
      ],
      charts: [
        { title: 'Contacts by country', model: 'res.partner', groupby: 'country_id', type: 'hbar', limit: 10 },
        { title: 'New contacts per month', model: 'res.partner', groupby: 'create_date:month', type: 'line', last: 12 }
      ]
    },
    helpdesk: {
      title: 'Helpdesk', models: ['helpdesk.ticket', 'helpdesk.team'],
      kpis: [{ label: 'Tickets', model: 'helpdesk.ticket', kind: 'count', sub: 'All tickets' }],
      charts: [
        { title: 'Tickets by stage', model: 'helpdesk.ticket', groupby: 'stage_id', type: 'bar' },
        { title: 'Tickets by priority', model: 'helpdesk.ticket', groupby: 'priority', type: 'doughnut' },
        { title: 'Tickets by team', model: 'helpdesk.ticket', groupby: 'team_id', type: 'hbar', limit: 8 }
      ]
    },
    fleet: {
      title: 'Fleet', models: ['fleet.vehicle', 'fleet.vehicle.log.services', 'fleet.vehicle.log.contract'],
      kpis: [{ label: 'Vehicles', model: 'fleet.vehicle', kind: 'count', sub: 'In the fleet' }],
      charts: [
        { title: 'Vehicles by status', model: 'fleet.vehicle', groupby: 'state_id', type: 'doughnut' },
        { title: 'Vehicles by driver', model: 'fleet.vehicle', groupby: 'driver_id', type: 'hbar', limit: 8 }
      ]
    }
  };
  var ALIAS = { sale_management: 'sale', website_sale: 'sale', sale_stock: 'sale', sale_crm: 'crm', account_accountant: 'account', l10n_generic_coa: 'account', purchase_stock: 'purchase', hr_recruitment: 'hr', hr_contract: 'hr', hr_attendance: 'hr', base: 'contacts', hr_timesheet: 'project', point_of_sale_restaurant: 'point_of_sale' };


  /* Executive (top-management) specs: headline KPIs with period-over-period change,
     a wide trend, mix/concentration charts and "needs attention" alerts. */
  var UNPAID = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']]];
  var X = {
    sale: { title: 'Sales',
      kpis: [
        { label: 'Revenue', model: 'sale.order', domain: CONF, date: 'date_order', measure: 'amount_total', kind: 'money' },
        { label: 'Confirmed orders', model: 'sale.order', domain: CONF, date: 'date_order', kind: 'count' },
        { label: 'Average order value', kind: 'ratio', of: [0, 1], money: true },
        { label: 'New quotations', model: 'sale.order', domain: [['state', 'in', ['draft', 'sent']]], date: 'create_date', kind: 'count' }],
      trend: { title: 'Revenue — last 12 months', model: 'sale.order', domain: CONF, groupby: 'date_order:month', measure: 'amount_total', type: 'bar', last: 12 },
      charts: [P.sale.charts[2], P.sale.charts[3]],
      alerts: [{ label: 'Open quotations', model: 'sale.order', domain: [['state', 'in', ['draft', 'sent']]], measure: 'amount_total', tone: 'warn' }] },
    crm: { title: 'CRM',
      kpis: [
        { label: 'Won revenue', model: 'crm.lead', domain: [['probability', '=', 100]], date: 'date_closed', measure: 'expected_revenue', kind: 'money' },
        { label: 'New leads', model: 'crm.lead', date: 'create_date', kind: 'count' },
        { label: 'Open pipeline', model: 'crm.lead', domain: [['type', '=', 'opportunity'], ['probability', '<', 100]], measure: 'expected_revenue', kind: 'money', sub: 'Expected revenue right now' }],
      trend: { title: 'Won revenue — last 12 months', model: 'crm.lead', domain: [['probability', '=', 100]], groupby: 'date_closed:month', measure: 'expected_revenue', type: 'bar', last: 12 },
      charts: [P.crm.charts[0], P.crm.charts[2]], alerts: [] },
    account: { title: 'Finance',
      kpis: [
        { label: 'Invoiced', model: 'account.move', domain: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']], date: 'invoice_date', measure: 'amount_total', kind: 'money' },
        { label: 'Vendor bills', model: 'account.move', domain: [['move_type', '=', 'in_invoice'], ['state', '=', 'posted']], date: 'invoice_date', measure: 'amount_total', kind: 'money', inverse: true },
        { label: 'Receivable outstanding', model: 'account.move', domain: UNPAID, measure: 'amount_residual', kind: 'money', inverse: true, sub: 'Unpaid customer invoices' }],
      trend: { title: 'Invoiced — last 12 months', model: 'account.move', domain: [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']], groupby: 'invoice_date:month', measure: 'amount_total', type: 'bar', last: 12 },
      charts: [P.account.charts[1], P.account.charts[2]],
      alerts: [{ label: 'Overdue invoices', model: 'account.move', domain: UNPAID.concat([['invoice_date_due', '<', '$now']]), measure: 'amount_residual', tone: 'bad' }] },
    purchase: { title: 'Purchase',
      kpis: [
        { label: 'Spend', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']]], date: 'date_order', measure: 'amount_total', kind: 'money', inverse: true },
        { label: 'Purchase orders', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']]], date: 'date_order', kind: 'count' },
        { label: 'Average order value', kind: 'ratio', of: [0, 1], money: true }],
      trend: { title: 'Spend — last 12 months', model: 'purchase.order', domain: [['state', 'in', ['purchase', 'done']]], groupby: 'date_order:month', measure: 'amount_total', type: 'bar', last: 12 },
      charts: [P.purchase.charts[2], P.purchase.charts[3]],
      alerts: [{ label: 'Open RFQs', model: 'purchase.order', domain: [['state', 'in', ['draft', 'sent']]], measure: 'amount_total', tone: 'warn' }] },
    stock: { title: 'Inventory',
      kpis: [
        { label: 'Units on hand', model: 'stock.quant', measure: 'quantity', kind: 'num', sub: 'Across all locations' },
        { label: 'Transfers completed', model: 'stock.picking', domain: [['state', '=', 'done']], date: 'date_done', kind: 'count' }],
      trend: { title: 'Transfers — last 12 months', model: 'stock.picking', groupby: 'scheduled_date:month', type: 'line', last: 12 },
      charts: [P.stock.charts[3], P.stock.charts[0]],
      alerts: [
        { label: 'Late transfers', model: 'stock.picking', domain: [['state', 'not in', ['done', 'cancel']], ['scheduled_date', '<', '$now']], tone: 'bad' },
        { label: 'Waiting on stock', model: 'stock.picking', domain: [['state', 'in', ['confirmed', 'waiting']]], tone: 'warn' }] },
    hr: { title: 'People',
      kpis: [
        { label: 'Headcount', model: 'hr.employee', kind: 'count', sub: 'Active employees' },
        { label: 'New hires', model: 'hr.employee', date: 'create_date', kind: 'count' }],
      trend: { title: 'New hires — last 12 months', model: 'hr.employee', groupby: 'create_date:month', type: 'bar', last: 12 },
      charts: [P.hr.charts[0], P.hr.charts[1]], alerts: [] },
    project: { title: 'Projects',
      kpis: [
        { label: 'Open tasks', model: 'project.task', kind: 'count', sub: 'Tasks in progress' },
        { label: 'Tasks created', model: 'project.task', date: 'create_date', kind: 'count' }],
      trend: { title: 'Tasks created — last 12 months', model: 'project.task', groupby: 'create_date:month', type: 'line', last: 12 },
      charts: [P.project.charts[0], P.project.charts[1]], alerts: [] },
    mrp: { title: 'Manufacturing',
      kpis: [
        { label: 'In progress', model: 'mrp.production', domain: [['state', '=', 'progress']], kind: 'count', sub: 'Manufacturing orders' },
        { label: 'Orders started', model: 'mrp.production', date: 'date_start', kind: 'count' }],
      trend: { title: 'Orders started — last 12 months', model: 'mrp.production', groupby: 'date_start:month', type: 'line', last: 12 },
      charts: [P.mrp.charts[0], P.mrp.charts[1]],
      alerts: [{ label: 'Confirmed, not started', model: 'mrp.production', domain: [['state', '=', 'confirmed']], tone: 'warn' }] }
  };

  /* Cross-module financial position for CFO / CEO (needs the Accounting app). */
  var INV = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']];
  var FIN = { title: 'Financial position', kpis: [
    { label: 'Invoiced (revenue)', model: 'account.move', domain: INV, date: 'invoice_date', measure: 'amount_total', kind: 'money' },
    { label: 'Vendor bills (cost)', model: 'account.move', domain: [['move_type', '=', 'in_invoice'], ['state', '=', 'posted']], date: 'invoice_date', measure: 'amount_total', kind: 'money', inverse: true },
    { label: 'Net trading position', kind: 'diff', of: [0, 1], money: true, sub: 'Invoiced minus vendor bills' },
    { label: 'Receivable outstanding', model: 'account.move', domain: UNPAID, measure: 'amount_residual', kind: 'money', inverse: true, sub: 'Unpaid customer invoices' },
    { label: 'Overdue receivable', model: 'account.move', domain: UNPAID.concat([['invoice_date_due', '<', '$now']]), measure: 'amount_residual', kind: 'money', inverse: true, sub: 'Past due date' },
    { label: 'Overdue share', kind: 'pct', of: [4, 3], inverse: true, sub: 'Overdue as % of receivable' }] };
  var XORDER = ['sale', 'crm', 'account', 'purchase', 'stock', 'mrp', 'hr', 'project'];
  function exec(mod) { return X[mod] || X[ALIAS[mod]] || null; }
  function ago(d) { return new Date(Date.now() - d * 864e5).toISOString().slice(0, 19).replace('T', ' '); }

  function get(mod) { return P[mod] || P[ALIAS[mod]] || null; }

  function tokens(domain) {
    var now = Date.now(), f = function (d) { return new Date(now - d * 864e5).toISOString().slice(0, 19).replace('T', ' '); };
    var map = { $now: f(0), $d30: f(30), $d365: f(365) };
    return (domain || []).map(function (t) { return Array.isArray(t) ? [t[0], t[1], typeof t[2] === 'string' && map[t[2]] ? map[t[2]] : t[2]] : t; });
  }

  /* Generic profile from a model's own fields. */
  function build(model, fields) {
    var has = function (n) { return !!fields[n]; };
    var pick = function (list, skip) { for (var i = 0; i < list.length; i++) if (has(list[i]) && list[i] !== skip) return list[i]; return null; };
    var money = pick(['amount_total', 'amount_untaxed', 'price_total', 'expected_revenue', 'total_amount', 'amount', 'list_price', 'standard_price']);
    var kpis = [{ label: 'Total records', model: model, kind: 'count', sub: 'All records you can access' }];
    if (has('create_date')) kpis.push({ label: 'Created (30 days)', model: model, domain: [['create_date', '>=', '$d30']], kind: 'count', sub: 'New in the last 30 days' });
    if (money) kpis.push({ label: 'Sum of ' + (fields[money].string || money), model: model, measure: money, kind: fields[money].type === 'monetary' ? 'money' : 'num', sub: 'Across all records' });
    var status = pick(['state', 'stage_id', 'status', 'type', 'move_type', 'priority']) || Object.keys(fields).filter(function (k) { return fields[k].type === 'selection'; })[0] || null;
    var who = pick(['user_id', 'partner_id', 'team_id', 'department_id', 'categ_id', 'company_id', 'stage_id'], status);
    var charts = [];
    if (status) charts.push({ title: (fields[status].string || status) + ' split', model: model, groupby: status, type: 'doughnut' });
    if (who) charts.push({ title: 'By ' + (fields[who].string || who), model: model, groupby: who, measure: money, type: 'hbar', limit: 8 });
    if (has('create_date')) charts.push({ title: 'Created per month', model: model, groupby: 'create_date:month', type: 'line', last: 12 });
    return { title: model, generic: true, models: [model], kpis: kpis, charts: charts };
  }

  window.DVOdooProfiles = { fin: FIN, exec: exec, order: XORDER, ago: ago, get: get, build: build, tokens: tokens, has: function (m) { return !!get(m); } };
})();
