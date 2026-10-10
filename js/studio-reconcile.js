/* ==========================================================================
   DashView — Data Studio · Odoo reconciliation ENGINE   (window.DVReconcile)
   --------------------------------------------------------------------------
   Pure logic, no DOM, no network: it takes the rows of an imported file plus
   the records already fetched from Odoo and says, document by document and line
   by line, what matches, what differs, what is missing and WHY.
   js/studio-reconcile-ui.js does the fetching and the screen.
   Also loadable under Node (module.exports) so it is unit-tested.
   ========================================================================== */
(function (root) {
  'use strict';

  /* ── Presets: which Odoo model a file is compared with ───────────────────── */
  var SALE_STATES = { draft: 'Quotation', sent: 'Quotation Sent', sale: 'Sales Order', done: 'Locked', cancel: 'Cancelled' };
  var MOVE_STATES = { draft: 'Draft', posted: 'Posted', cancel: 'Cancelled' };
  var PURCHASE_STATES = { draft: 'RFQ', sent: 'RFQ Sent', 'to approve': 'To Approve', purchase: 'Purchase Order', done: 'Locked', cancel: 'Cancelled' };
  var PICK_STATES = { draft: 'Draft', waiting: 'Waiting', confirmed: 'Waiting', assigned: 'Ready', done: 'Done', cancel: 'Cancelled' };

  var PRESETS = {
    sale: {
      id: 'sale', label: 'Sales orders', model: 'sale.order', keyOptions: [['name', 'Order number']], keyDefault: 'name',
      domain: [], dateField: 'date_order', stateField: 'state', currencyField: 'currency_id',
      fields: [
        { f: 'partner_id', label: 'Customer', kind: 'text', syn: ['customer', 'client', 'partner', 'buyer', 'party'] },
        { f: 'date_order', label: 'Order date', kind: 'date', syn: ['date', 'order date', 'ordered'] },
        { f: 'state', label: 'Status', kind: 'state', labels: SALE_STATES, syn: ['status', 'state', 'stage'] },
        { f: 'amount_untaxed', label: 'Untaxed amount', kind: 'number', syn: ['untaxed', 'subtotal', 'net', 'before tax', 'excl'] },
        { f: 'amount_tax', label: 'Tax', kind: 'number', syn: ['tax', 'vat', 'gst'] },
        { f: 'amount_total', label: 'Total', kind: 'number', syn: ['total', 'amount', 'grand', 'value', 'gross', 'incl'] }
      ],
      lines: {
        model: 'sale.order.line', parent: 'order_id', domain: [['display_type', '=', false]], docFieldsOptional: true,
        fields: [
          { f: 'product_id', label: 'Product', kind: 'product', syn: ['product', 'item', 'sku', 'code', 'description', 'article', 'material'] },
          { f: 'product_uom_qty', label: 'Quantity', kind: 'number', role: 'qty', syn: ['qty', 'quantity', 'units', 'ordered', 'pcs'] },
          { f: 'price_unit', label: 'Unit price', kind: 'number', role: 'price', syn: ['unit price', 'price', 'rate', 'unit cost'] },
          { f: 'discount', label: 'Discount %', kind: 'number', role: 'discount', syn: ['discount', 'disc'] },
          { f: 'price_subtotal', label: 'Line subtotal', kind: 'number', role: 'subtotal', syn: ['subtotal', 'line total', 'amount', 'net', 'total'] }
        ],
        extraRead: ['name', 'price_total', 'qty_delivered', 'qty_invoiced']
      }
    },
    invoice: {
      id: 'invoice', label: 'Customer invoices / credit notes', model: 'account.move', keyOptions: [['name', 'Invoice number'], ['ref', 'Reference'], ['payment_reference', 'Payment reference']], keyDefault: 'name',
      domain: [['move_type', 'in', ['out_invoice', 'out_refund']]], dateField: 'invoice_date', stateField: 'state', currencyField: 'currency_id',
      fields: [
        { f: 'partner_id', label: 'Customer', kind: 'text', syn: ['customer', 'client', 'partner', 'party'] },
        { f: 'invoice_date', label: 'Invoice date', kind: 'date', syn: ['invoice date', 'date', 'billing date'] },
        { f: 'invoice_date_due', label: 'Due date', kind: 'date', syn: ['due'] },
        { f: 'state', label: 'Status', kind: 'state', labels: MOVE_STATES, syn: ['status', 'state'] },
        { f: 'payment_state', label: 'Payment status', kind: 'state', labels: { not_paid: 'Not Paid', in_payment: 'In Payment', paid: 'Paid', partial: 'Partially Paid', reversed: 'Reversed', invoicing_legacy: 'Invoicing App Legacy' }, syn: ['payment status', 'paid', 'payment'] },
        { f: 'amount_untaxed', label: 'Untaxed amount', kind: 'number', syn: ['untaxed', 'subtotal', 'net', 'before tax', 'excl'] },
        { f: 'amount_tax', label: 'Tax', kind: 'number', syn: ['tax', 'vat', 'gst'] },
        { f: 'amount_total', label: 'Total', kind: 'number', syn: ['total', 'amount', 'grand', 'gross', 'incl'] },
        { f: 'amount_residual', label: 'Amount due', kind: 'number', syn: ['due', 'balance', 'outstanding', 'residual', 'open'] }
      ],
      lines: invoiceLines('Quantity')
    },
    bill: {
      id: 'bill', label: 'Vendor bills / refunds', model: 'account.move', keyOptions: [['ref', 'Vendor reference'], ['name', 'Bill number (Odoo)'], ['payment_reference', 'Payment reference']], keyDefault: 'ref',
      domain: [['move_type', 'in', ['in_invoice', 'in_refund']]], dateField: 'invoice_date', stateField: 'state', currencyField: 'currency_id',
      fields: [
        { f: 'partner_id', label: 'Vendor', kind: 'text', syn: ['vendor', 'supplier', 'partner', 'party'] },
        { f: 'invoice_date', label: 'Bill date', kind: 'date', syn: ['bill date', 'invoice date', 'date'] },
        { f: 'invoice_date_due', label: 'Due date', kind: 'date', syn: ['due'] },
        { f: 'state', label: 'Status', kind: 'state', labels: MOVE_STATES, syn: ['status', 'state'] },
        { f: 'payment_state', label: 'Payment status', kind: 'state', labels: { not_paid: 'Not Paid', in_payment: 'In Payment', paid: 'Paid', partial: 'Partially Paid', reversed: 'Reversed' }, syn: ['payment status', 'paid', 'payment'] },
        { f: 'amount_untaxed', label: 'Untaxed amount', kind: 'number', syn: ['untaxed', 'subtotal', 'net', 'before tax'] },
        { f: 'amount_tax', label: 'Tax', kind: 'number', syn: ['tax', 'vat', 'gst'] },
        { f: 'amount_total', label: 'Total', kind: 'number', syn: ['total', 'amount', 'grand', 'gross'] },
        { f: 'amount_residual', label: 'Amount due', kind: 'number', syn: ['due', 'balance', 'outstanding', 'residual'] }
      ],
      lines: invoiceLines('Quantity')
    },
    purchase: {
      id: 'purchase', label: 'Purchase orders', model: 'purchase.order', keyOptions: [['name', 'PO number'], ['partner_ref', 'Vendor reference']], keyDefault: 'name',
      domain: [], dateField: 'date_order', stateField: 'state', currencyField: 'currency_id',
      fields: [
        { f: 'partner_id', label: 'Vendor', kind: 'text', syn: ['vendor', 'supplier', 'partner', 'party'] },
        { f: 'date_order', label: 'Order date', kind: 'date', syn: ['date', 'order date'] },
        { f: 'state', label: 'Status', kind: 'state', labels: PURCHASE_STATES, syn: ['status', 'state'] },
        { f: 'amount_untaxed', label: 'Untaxed amount', kind: 'number', syn: ['untaxed', 'subtotal', 'net'] },
        { f: 'amount_tax', label: 'Tax', kind: 'number', syn: ['tax', 'vat', 'gst'] },
        { f: 'amount_total', label: 'Total', kind: 'number', syn: ['total', 'amount', 'grand', 'gross'] }
      ],
      lines: {
        model: 'purchase.order.line', parent: 'order_id', domain: [['display_type', '=', false]],
        fields: [
          { f: 'product_id', label: 'Product', kind: 'product', syn: ['product', 'item', 'sku', 'code', 'description', 'material'] },
          { f: 'product_qty', label: 'Quantity', kind: 'number', role: 'qty', syn: ['qty', 'quantity', 'units', 'ordered', 'pcs'] },
          { f: 'price_unit', label: 'Unit price', kind: 'number', role: 'price', syn: ['unit price', 'price', 'rate', 'unit cost'] },
          { f: 'price_subtotal', label: 'Line subtotal', kind: 'number', role: 'subtotal', syn: ['subtotal', 'line total', 'amount', 'net', 'total'] }
        ],
        extraRead: ['name', 'price_total', 'qty_received', 'qty_invoiced']
      }
    },
    picking: {
      id: 'picking', label: 'Deliveries / receipts / transfers', model: 'stock.picking', keyOptions: [['name', 'Reference'], ['origin', 'Source document']], keyDefault: 'name',
      domain: [], dateField: 'scheduled_date', stateField: 'state', currencyField: null,
      fields: [
        { f: 'partner_id', label: 'Partner', kind: 'text', syn: ['customer', 'vendor', 'partner', 'contact'] },
        { f: 'scheduled_date', label: 'Scheduled date', kind: 'date', syn: ['date', 'scheduled'] },
        { f: 'date_done', label: 'Done date', kind: 'date', syn: ['done', 'effective', 'delivered'] },
        { f: 'state', label: 'Status', kind: 'state', labels: PICK_STATES, syn: ['status', 'state'] },
        { f: 'origin', label: 'Source document', kind: 'text', syn: ['origin', 'source', 'sale order', 'po'] }
      ],
      lines: {
        model: 'stock.move', parent: 'picking_id', domain: [],
        fields: [
          { f: 'product_id', label: 'Product', kind: 'product', syn: ['product', 'item', 'sku', 'code', 'description'] },
          { f: 'product_uom_qty', label: 'Demand qty', kind: 'number', role: 'qty', syn: ['demand', 'qty', 'quantity', 'ordered', 'units'] },
          { f: 'quantity', altF: ['quantity_done'], label: 'Done qty', kind: 'number', role: 'done', syn: ['done', 'delivered', 'received', 'shipped'] }
        ],
        extraRead: ['name', 'state']
      }
    },
    custom: {
      id: 'custom', label: 'Other Odoo model (header only)', model: '', keyOptions: [['name', 'name']], keyDefault: 'name', domain: [], dateField: null, stateField: null, currencyField: null, fields: [], custom: true, lines: null
    }
  };
  function invoiceLines() {
    return {
      model: 'account.move.line', parent: 'move_id',
      domain: [], /* product lines are picked client-side (works on Odoo 14 … 18) */
      fields: [
        { f: 'product_id', label: 'Product', kind: 'product', syn: ['product', 'item', 'sku', 'code', 'description', 'material'] },
        { f: 'quantity', label: 'Quantity', kind: 'number', role: 'qty', syn: ['qty', 'quantity', 'units', 'pcs'] },
        { f: 'price_unit', label: 'Unit price', kind: 'number', role: 'price', syn: ['unit price', 'price', 'rate', 'unit cost'] },
        { f: 'discount', label: 'Discount %', kind: 'number', role: 'discount', syn: ['discount', 'disc'] },
        { f: 'price_subtotal', label: 'Line subtotal', kind: 'number', role: 'subtotal', syn: ['subtotal', 'line total', 'amount', 'net', 'total'] }
      ],
      extraRead: ['name', 'price_total', 'display_type', 'tax_line_id', 'exclude_from_invoice_tab', 'account_id'],
      clientFilter: 'invoiceLine'
    };
  }

  /* ── Normalisers ─────────────────────────────────────────────────────────── */
  function isBlank(v) { return v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v)); }
  function normText(v) {
    if (isBlank(v)) return '';
    return String(v).normalize ? String(v).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase() : String(v).replace(/\s+/g, ' ').trim().toLowerCase();
  }
  /* A document key: trimmed, case-insensitive, no inner double spaces. 1001, "1001" and "1001.0" are the same key. */
  function normKey(v) {
    if (isBlank(v)) return '';
    if (typeof v === 'number') return String(Math.round(v) === v ? v : v).toLowerCase();
    var s = String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
    return s.toLowerCase();
  }
  function num(v) {
    if (isBlank(v)) return null;
    if (typeof v === 'number') return v;
    var s = String(v).trim(), neg = /^\(.*\)$/.test(s) || /-\s*$/.test(s);
    s = s.replace(/[^0-9.,\-]/g, '');
    var ld = s.lastIndexOf('.'), lc = s.lastIndexOf(',');
    if (ld > -1 && lc > -1) { if (lc > ld) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, ''); }   /* the later separator is the decimal one */
    else if (lc > -1) { if (/,\d{1,2}$/.test(s) && s.indexOf(',') === lc) s = s.replace(',', '.'); else s = s.replace(/,/g, ''); }
    else if (ld > -1 && s.indexOf('.') !== ld) s = s.replace(/\./g, '');                                   /* 1.234.567 */
    var n = parseFloat(s); if (isNaN(n)) return null;
    return neg && n > 0 ? -n : n;
  }
  function round2(n) { return Math.round((n + (n >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayUTC(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function dayLocal(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  /* File cell → set of acceptable calendar days (a date typed as 03/05/2025 is local midnight, 2025-03-05 is UTC midnight). */
  function fileDays(v) {
    if (isBlank(v)) return [];
    var ms = typeof v === 'number' ? v : (v instanceof Date ? v.getTime() : Date.parse(String(v)));
    if (isNaN(ms)) { var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v)); return m ? [m[1]] : []; }
    var a = dayUTC(ms), b = dayLocal(ms); return a === b ? [a] : [a, b];
  }
  /* Odoo date ("2025-03-05") or datetime ("2025-03-05 21:30:00", UTC) → acceptable days. A UTC datetime late in the evening
     is the NEXT day in Karachi / Dubai etc., so both the UTC day and the viewer's local day are accepted. */
  function odooDays(v) {
    if (isBlank(v) || v === false) return [];
    var s = String(v), m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/.exec(s);
    if (!m) return [];
    if (!m[2]) return [m[1]];
    var ms = Date.parse(m[1] + 'T' + (m[2].length === 5 ? m[2] + ':00' : m[2]) + 'Z');
    if (isNaN(ms)) return [m[1]];
    var a = dayUTC(ms), b = dayLocal(ms); return a === b ? [a] : [a, b];
  }
  function m2oName(v) { return Array.isArray(v) ? String(v[1] == null ? '' : v[1]) : (isBlank(v) || v === false ? '' : String(v)); }
  function m2oId(v) { return Array.isArray(v) ? v[0] : null; }
  /* "[CODE-1] Aria Chair" → { code: 'code-1', name: 'aria chair', full: '[code-1] aria chair' } */
  function productParts(v) {
    var s = m2oName(v).replace(/\s+/g, ' ').trim(), m = /^\[([^\]]+)\]\s*(.*)$/.exec(s);
    return m ? { code: normText(m[1]), name: normText(m[2]), full: normText(s) } : { code: '', name: normText(s), full: normText(s) };
  }

  /* ── Value comparison ────────────────────────────────────────────────────── */
  function show(kind, v) {
    if (isBlank(v) || v === false) return '';
    if (kind === 'number') { var n = num(v); return n === null ? String(v) : String(round2(n)); }
    if (kind === 'date') { var d = fileDays(v); return d.length ? d[0] : String(v); }
    return String(v);
  }
  /* returns { ok, file, odoo, diff } — file/odoo are display strings, diff is numeric for numbers */
  function compare(spec, fileVal, odooVal, opts) {
    opts = opts || {}; var tol = opts.tol == null ? 0.01 : opts.tol, kind = spec.kind;
    if (kind === 'number') {
      var a = num(fileVal), b = num(odooVal === false ? null : odooVal);
      if (a === null && b === null) return { ok: true, file: '', odoo: '', diff: 0 };
      if (a === null || b === null) { var nn = (a === null ? 0 : a) - (b === null ? 0 : b); return { ok: Math.abs(nn) <= tol, file: a === null ? '' : String(round2(a)), odoo: b === null ? '' : String(round2(b)), diff: round2(nn), missing: true }; }
      var d = round2(a - b);
      return { ok: Math.abs(a - b) <= tol + 1e-9, file: String(round2(a)), odoo: String(round2(b)), diff: d };
    }
    if (kind === 'date') {
      var fd = fileDays(fileVal), od = odooDays(odooVal);
      if (!fd.length && !od.length) return { ok: true, file: '', odoo: '' };
      var okd = fd.some(function (x) { return od.indexOf(x) > -1; });
      if (!okd && opts.dateTolDays && fd.length && od.length) {
        var gap = Math.abs(Date.parse(fd[0] + 'T00:00:00Z') - Date.parse(od[0] + 'T00:00:00Z')) / 86400000;
        if (gap <= opts.dateTolDays) okd = true;
      }
      var gapDays = fd.length && od.length ? Math.round((Date.parse(fd[0] + 'T00:00:00Z') - Date.parse(od[0] + 'T00:00:00Z')) / 86400000) : null;
      return { ok: okd, file: fd[0] || '', odoo: od[0] || '', diff: gapDays };
    }
    if (kind === 'state') {
      var fs = normText(fileVal), os = isBlank(odooVal) || odooVal === false ? '' : String(odooVal), lab = normText((spec.labels || {})[os] || (spec.selection && spec.selection[os]) || '');
      var oc = normText(os);
      var okS = fs === oc || (lab && fs === lab) || (!fs && !oc);
      if (!okS && lab && fs && (lab.indexOf(fs) > -1 || fs.indexOf(lab) > -1) && Math.min(fs.length, lab.length) >= 4) okS = true;
      return { ok: okS, file: isBlank(fileVal) ? '' : String(fileVal), odoo: (spec.labels && spec.labels[os]) || (spec.selection && spec.selection[os]) || os };
    }
    /* text, many2one, product */
    var ft = normText(fileVal), ot = normText(m2oName(odooVal));
    var oks = ft === ot;
    if (!oks && kind !== 'number') {
      /* "ACME Ltd." vs "ACME Ltd" or "[code] name": ignore punctuation and an Odoo [code] prefix */
      var strip = function (x) { return x.replace(/^\[[^\]]*\]\s*/, '').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim(); };
      oks = strip(ft) === strip(ot) && strip(ft) !== '';
    }
    return { ok: oks, file: isBlank(fileVal) ? '' : String(fileVal), odoo: m2oName(odooVal) };
  }

  /* ── Auto-mapping of file columns ────────────────────────────────────────── */
  function guessColumn(columns, spec, used) {
    var best = null, bestScore = 0;
    columns.forEach(function (c) {
      if (used && used[c]) return;
      var n = normText(c), score = 0;
      (spec.syn || []).forEach(function (s, i) {
        if (n === s) score = Math.max(score, 100 - i);
        else if (n.indexOf(s) > -1) score = Math.max(score, 60 - i * 2);
      });
      if (normText(spec.label) === n) score = Math.max(score, 110);
      if (score > bestScore) { bestScore = score; best = c; }
    });
    return bestScore >= 30 ? best : null;
  }
  function guessKeyColumn(columns, dataset) {
    var names = ['order number', 'order no', 'order id', 'order ref', 'order', 'invoice number', 'invoice no', 'invoice', 'bill', 'reference', 'ref', 'number', 'document', 'po number', 'po', 'so', 'doc no', 'voucher', 'id'];
    var best = null, bs = 0;
    columns.forEach(function (c) {
      var n = normText(c), s = 0;
      names.forEach(function (w, i) { if (n === w) s = Math.max(s, 100 - i); else if (n.indexOf(w) > -1) s = Math.max(s, 50 - i); });
      if (s > bs) { bs = s; best = c; }
    });
    return best;
  }

  /* ── Lines: pairing ──────────────────────────────────────────────────────── */
  function keepInvoiceLine(l) {
    var dt = l.display_type;
    if (dt === 'line_section' || dt === 'line_note' || dt === 'tax' || dt === 'payment_term' || dt === 'rounding' || dt === 'cogs' || dt === 'epd') return false;
    if (l.tax_line_id) return false;
    if (l.exclude_from_invoice_tab === true) return false;
    if (dt === 'product') return true;
    return true;
  }

  /* pair file lines with Odoo lines of ONE document. returns [{f: fileLine|null, o: odooLine|null}] */
  function pairLines(fLines, oLines, cfg) {
    var pairs = [], usedO = {}, usedF = {};
    var hasProduct = !!cfg.hasProduct;
    function fKeys(fl) { if (!hasProduct || isBlank(fl.product)) return []; var s = normText(fl.product), p = productParts(fl.product); return uniq([s, p.code, p.name, p.full].filter(Boolean)); }
    function oKeys(ol) { var p = ol.parts; return uniq([p.code, p.name, p.full].filter(Boolean)); }
    function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
    function qtyOf(x) { return x.qty == null ? null : x.qty; }
    function closeness(fl, ol) {
      var s = 0;
      if (fl.qty != null && ol.qty != null) s += Math.abs(fl.qty - ol.qty) <= cfg.tol ? 0 : 1;
      if (fl.price != null && ol.price != null) s += Math.abs(fl.price - ol.price) <= cfg.tol ? 0 : 1;
      if (fl.subtotal != null && ol.subtotal != null) s += Math.abs(fl.subtotal - ol.subtotal) <= cfg.tol ? 0 : 1;
      return s;
    }
    if (!hasProduct) { /* by position */
      var n = Math.max(fLines.length, oLines.length);
      for (var i = 0; i < n; i++) pairs.push({ f: fLines[i] || null, o: oLines[i] || null, how: 'position' });
      return pairs;
    }
    /* pass 1: same product key, best closeness first */
    function pass(match, how) {
      fLines.forEach(function (fl, fi) {
        if (usedF[fi]) return;
        var fk = fKeys(fl), best = -1, bs = 99;
        oLines.forEach(function (ol, oi) {
          if (usedO[oi]) return;
          if (!match(fk, ol, fl)) return;
          var c = closeness(fl, ol);
          if (c < bs) { bs = c; best = oi; }
        });
        if (best > -1) { usedF[fi] = true; usedO[best] = true; pairs.push({ f: fl, o: oLines[best], how: how }); }
      });
    }
    /* exact-quantity-and-price pairs first, so duplicated products pair sensibly */
    fLines.forEach(function (fl, fi) {
      var fk = fKeys(fl); if (!fk.length) return;
      for (var oi = 0; oi < oLines.length; oi++) {
        if (usedO[oi] || usedF[fi]) continue;
        var ol = oLines[oi], ok = oKeys(ol).some(function (k) { return fk.indexOf(k) > -1; });
        if (ok && closeness(fl, ol) === 0) { usedF[fi] = true; usedO[oi] = true; pairs.push({ f: fl, o: ol, how: 'product' }); }
      }
    });
    pass(function (fk, ol) { return oKeys(ol).some(function (k) { return fk.indexOf(k) > -1; }); }, 'product');
    pass(function (fk, ol) { /* partial: one name contains the other */
      return fk.some(function (k) { return k.length >= 4 && oKeys(ol).some(function (o) { return o.length >= 4 && (o.indexOf(k) > -1 || k.indexOf(o) > -1); }); });
    }, 'similar product');
    fLines.forEach(function (fl, fi) { if (!usedF[fi]) pairs.push({ f: fl, o: null, how: 'none' }); });
    oLines.forEach(function (ol, oi) { if (!usedO[oi]) pairs.push({ f: null, o: ol, how: 'none' }); });
    return pairs;
  }

  /* ── The reconciliation ──────────────────────────────────────────────────── */
  /*
    input = {
      preset,                       // one of PRESETS (or a custom preset object)
      rows,                         // file rows: array of {column: value}
      mode: 'document' | 'line',
      keyColumn, keyField,          // file key column ↔ Odoo key field
      headerMap: { odooField: fileColumn },
      lineMap:   { odooField: fileColumn },     // line mode only
      tol, dateTolDays,
      odoo: { docs: [odoo records], lines: [odoo lines], extraDocs: [odoo records not in the file] },
      selections: { field: {code: label} }     // from fields_get, optional
    }
  */
  function reconcile(input) {
    var P = input.preset, tol = input.tol == null ? 0.01 : Number(input.tol), mode = input.mode === 'line' ? 'line' : 'document';
    var rows = input.rows || [], keyCol = input.keyColumn, keyField = input.keyField || P.keyDefault;
    var hmap = input.headerMap || {}, lmap = input.lineMap || {};
    var headerSpecs = P.fields.filter(function (s) { return hmap[s.f]; }).map(function (s) {
      var sp = Object.assign({}, s); if (input.selections && input.selections[s.f]) sp.selection = input.selections[s.f]; return sp;
    });
    var lineSpecs = P.lines ? P.lines.fields.filter(function (s) { return lmap[s.f]; }) : [];
    var out = { docs: [], lines: [], missingInFile: [], notes: [], summary: {}, mode: mode, headerSpecs: headerSpecs, lineSpecs: lineSpecs, tol: tol, keyField: keyField };

    /* 1 · group the file by document key */
    var groups = {}, order = [], blankKeyRows = [];
    rows.forEach(function (r, i) {
      var raw = r[keyCol], k = normKey(raw);
      if (!k) { blankKeyRows.push(i + 2); return; }
      var g = groups[k]; if (!g) { g = groups[k] = { key: k, label: String(raw).trim(), rows: [], rowNos: [] }; order.push(k); }
      g.rows.push(r); g.rowNos.push(i + 2);          /* +2: row 1 is the header, so this matches the spreadsheet row number */
    });
    out.blankKeyRows = blankKeyRows;

    /* 2 · index Odoo records */
    var odooByKey = {}, dupOdoo = {};
    (input.odoo.docs || []).forEach(function (d) {
      var k = normKey(d[keyField]);
      if (!k) return;
      if (odooByKey[k]) { (dupOdoo[k] = dupOdoo[k] || [odooByKey[k]]).push(d); } else odooByKey[k] = d;
      /* an all-digit number keeps its meaning without leading zeros ("000123" in Odoo, 123 in a spreadsheet that dropped the zeros) */
      if (/^0+\d+$/.test(k)) { var z = k.replace(/^0+/, ''); if (!odooByKey[z]) odooByKey[z] = d; }
    });
    var linesByDoc = {};
    (input.odoo.lines || []).forEach(function (l) {
      var pid = m2oId(l[P.lines && P.lines.parent]); if (pid == null) return;
      if (P.lines.clientFilter === 'invoiceLine' && !keepInvoiceLine(l)) return;
      (linesByDoc[pid] = linesByDoc[pid] || []).push(l);
    });

    /* 3 · header aggregation rule for line-mode files: a column that is constant inside each document is a header value (take it once);
           a varying one is a per-line amount (sum it). */
    var agg = {};
    if (mode === 'line') {
      headerSpecs.forEach(function (sp) {
        if (sp.kind !== 'number') { agg[sp.f] = 'first'; return; }
        var multi = 0, constant = 0;
        order.forEach(function (k) {
          var g = groups[k]; if (g.rows.length < 2) return; multi++;
          var vals = g.rows.map(function (r) { return num(r[hmap[sp.f]]); }), same = vals.every(function (v) { return v !== null && Math.abs(v - vals[0]) <= 1e-9; });
          if (same) constant++;
        });
        agg[sp.f] = (multi === 0 || constant / multi >= 0.6) ? 'first' : 'sum';
      });
      var sums = headerSpecs.filter(function (s) { return agg[s.f] === 'sum'; });
      if (sums.length) out.notes.push('Line-level file: "' + sums.map(function (s) { return s.label; }).join('", "') + '" changes between the lines of one document, so it was added up per document before comparing.');
    }

    /* 4 · document + line comparison */
    var cnt = { docs: order.length, matched: 0, exact: 0, withDiffs: 0, missingOdoo: 0, dupFile: 0, fileTotal: 0, odooTotal: 0, totalSpec: null,
      lineFile: 0, lineOdoo: 0, linePairs: 0, lineExact: 0, lineDiff: 0, lineMissingOdoo: 0, lineExtraOdoo: 0, docsWithLineIssues: 0 };
    var totalSpec = headerSpecs.filter(function (s) { return s.f === 'amount_total'; })[0] || headerSpecs.filter(function (s) { return s.kind === 'number'; })[0] || null;
    if (totalSpec) cnt.totalSpec = totalSpec;
    var dupFileKeys = 0;

    order.forEach(function (k) {
      var g = groups[k], od = odooByKey[k];
      var doc = { key: g.label, nkey: k, fileRows: g.rowNos, fileRowCount: g.rows.length, status: 'match', fields: [], reasons: [], lines: [], odoo: null, odooDup: dupOdoo[k] ? dupOdoo[k].length : 0 };
      /* file value for each header field */
      var fileVals = {};
      headerSpecs.forEach(function (sp) {
        var col = hmap[sp.f], vals = g.rows.map(function (r) { return r[col]; });
        if (mode === 'line') {
          if (agg[sp.f] === 'sum') { var t = 0, any = false; vals.forEach(function (v) { var n = num(v); if (n !== null) { t += n; any = true; } }); fileVals[sp.f] = any ? t : null; }
          else {
            var nb = vals.filter(function (v) { return !isBlank(v); }); fileVals[sp.f] = nb.length ? nb[0] : '';
            var distinct = {}; nb.forEach(function (v) { distinct[sp.kind === 'number' ? String(round2(num(v))) : normText(v)] = 1; });
            if (Object.keys(distinct).length > 1) doc.reasons.push('The file itself disagrees: "' + sp.label + '" has ' + Object.keys(distinct).length + ' different values on the lines of this document (' + Object.keys(distinct).slice(0, 3).join(', ') + ').');
          }
        } else fileVals[sp.f] = vals[0];
      });
      if (mode === 'document' && g.rows.length > 1) {
        doc.status = 'duplicate_file'; dupFileKeys++;
        var sameAll = headerSpecs.every(function (sp) { var a = g.rows.map(function (r) { return show(sp.kind, r[hmap[sp.f]]); }); return a.every(function (x) { return x === a[0]; }); });
        doc.reasons.push('This key appears ' + g.rows.length + ' times in the file (rows ' + g.rowNos.join(', ') + ')' + (sameAll ? ' with identical values - a pure duplicate that inflates totals.' : ' with DIFFERENT values - the file contradicts itself.'));
      }
      if (!od) {
        if (doc.status !== 'duplicate_file') doc.status = 'missing_odoo';
        else doc.status = 'duplicate_file';
        doc.missingOdoo = true; cnt.missingOdoo++;
        doc.fields = headerSpecs.map(function (sp) { return { f: sp.f, label: sp.label, kind: sp.kind, file: show(sp.kind, fileVals[sp.f]), odoo: '', ok: false, diff: null, missingOdoo: true }; });
        doc.reasons.push('No Odoo ' + P.label.toLowerCase() + ' record has ' + keyField + ' = "' + g.label + '". It may have been deleted, cancelled under another number, belong to another company, or the number is mistyped in the file.');
        if (totalSpec) {
          var fv = num(fileVals[totalSpec.f]); if (fv !== null) cnt.fileTotal += fv; cnt.missingOdooTotal = round2((cnt.missingOdooTotal || 0) + (fv || 0));
          if (mode === 'document' && g.rows.length > 1) g.rows.slice(1).forEach(function (r) { var x = num(r[hmap[totalSpec.f]]); if (x !== null) cnt.fileTotal += x; });
        }
        /* still list the file's lines so nothing is hidden */
        if (mode === 'line') g.rows.forEach(function (r, ri) { out.lines.push(lineRow(doc, g.rowNos[ri], fileLineOf(r, lineSpecs, lmap), null, 'missing_odoo', [])); cnt.lineFile++; cnt.lineMissingOdoo++; });
        out.docs.push(doc); return;
      }
      doc.odoo = { id: od.id, name: od[keyField], rec: od }; cnt.matched++;
      if (doc.odooDup) doc.reasons.push('Odoo has ' + doc.odooDup + ' records with this ' + keyField + ' (different companies?). The first was used.');
      /* header compare */
      var hdrBad = 0;
      headerSpecs.forEach(function (sp) {
        var c = compare(sp, fileVals[sp.f], od[sp.f], { tol: tol, dateTolDays: input.dateTolDays });
        doc.fields.push({ f: sp.f, label: sp.label, kind: sp.kind, file: c.file, odoo: c.odoo, ok: c.ok, diff: c.diff == null ? null : c.diff });
        if (!c.ok) hdrBad++;
      });
      if (totalSpec) {
        var tf = num(fileVals[totalSpec.f]), to = num(od[totalSpec.f]); if (tf !== null) cnt.fileTotal += tf; if (to !== null) cnt.odooTotal += to;
        if (mode === 'document' && g.rows.length > 1) g.rows.slice(1).forEach(function (r) { var x = num(r[hmap[totalSpec.f]]); if (x !== null) { cnt.fileTotal += x; cnt.dupExtra = round2((cnt.dupExtra || 0) + x); } });
      }

      /* line compare */
      var lineIssues = 0, headerDiffFromLines = null;
      if (P.lines && lineSpecs.length) {
        var fl = [], oRows = linesByDoc[od.id] || [];
        if (mode === 'line') g.rows.forEach(function (r, ri) { var L = fileLineOf(r, lineSpecs, lmap); L.rowNo = g.rowNos[ri]; fl.push(L); });
        else if (rows.length) { /* document-level file with no lines: nothing to compare */ }
        if (mode === 'line') {
          var ol = oRows.map(function (l) { return odooLineOf(l, P, input); });
          var hasProduct = !!lmap.product_id;
          var pairs = pairLines(fl, ol, { tol: tol, hasProduct: hasProduct });
          var sumF = 0, sumO = 0, sumFq = 0, sumOq = 0;
          pairs.forEach(function (p) {
            var issues = [], status = 'match';
            if (p.f) { cnt.lineFile++; if (p.f.subtotal != null) sumF += p.f.subtotal; else if (p.f.qty != null && p.f.price != null) sumF += p.f.qty * p.f.price * (1 - (p.f.discount || 0) / 100); }
            if (p.o) { cnt.lineOdoo++; if (p.o.subtotal != null) sumO += p.o.subtotal; }
            if (p.f && !p.o) { status = 'missing_odoo'; cnt.lineMissingOdoo++; issues.push('Line is in the file but not in Odoo'); }
            else if (!p.f && p.o) { status = 'extra_odoo'; cnt.lineExtraOdoo++; issues.push('Line is in Odoo but not in the file'); }
            else {
              cnt.linePairs++;
              lineSpecs.forEach(function (sp) {
                if (sp.kind === 'product') { if (p.how === 'similar product') issues.push('Product matched by similar name only'); return; }
                var fv = p.f.vals[sp.f], ov = p.o.rec[sp.f];
                if (ov === undefined && sp.altF) sp.altF.forEach(function (a) { if (ov === undefined) ov = p.o.rec[a]; });
                var c = compare(sp, fv, ov, { tol: tol });
                p.f.cmp = p.f.cmp || {}; p.f.cmp[sp.f] = c;
                if (!c.ok) { issues.push(sp.label + ': file ' + (c.file || '(blank)') + ' vs Odoo ' + (c.odoo || '(blank)') + (c.diff != null ? ' (' + (c.diff > 0 ? '+' : '') + c.diff + ')' : '')); status = 'differs'; }
              });
              if (status === 'match' && p.how === 'position') issues.push('Paired by position (no product column mapped)');
              if (status === 'differs') cnt.lineDiff++; else cnt.lineExact++;
            }
            if (status !== 'match') lineIssues++;
            out.lines.push(lineRow(doc, p.f ? p.f.rowNo : null, p.f, p.o, status, issues));
            doc.lines.push(out.lines[out.lines.length - 1]);
          });
          doc.lineSumFile = round2(sumF); doc.lineSumOdoo = round2(sumO);
          headerDiffFromLines = round2(sumF - sumO);
        }
      }
      doc.lineIssues = lineIssues;
      if (lineIssues) cnt.docsWithLineIssues++;

      /* why is it different? */
      if (hdrBad || lineIssues) {
        var bad = doc.fields.filter(function (f) { return !f.ok; });
        if (doc.status === 'match') doc.status = 'mismatch';
        if (headerDiffFromLines !== null && totalSpec) {
          var amt = doc.fields.filter(function (f) { return (f.f === 'amount_untaxed' || f.f === 'amount_total') && !f.ok && f.diff != null; })[0];
          if (amt) {
            var lineDiff = amt.f === 'amount_untaxed' ? headerDiffFromLines : null;
            if (lineDiff !== null) {
              if (Math.abs(lineDiff - amt.diff) <= Math.max(tol, 0.02)) doc.reasons.push(amt.label + ' differs by ' + fmt(amt.diff) + ' and the line items explain all of it (lines differ by ' + fmt(lineDiff) + '). Look at the highlighted lines below.');
              else if (Math.abs(lineDiff) > tol) doc.reasons.push(amt.label + ' differs by ' + fmt(amt.diff) + ' but the line items only explain ' + fmt(lineDiff) + '. The remaining ' + fmt(round2(amt.diff - lineDiff)) + ' is not in the lines - check taxes, discounts, rounding or a header-only edit in Odoo.');
              else doc.reasons.push(amt.label + ' differs by ' + fmt(amt.diff) + ' while every line matches. The difference is not in the lines - check a header discount, rounding or a manual edit in Odoo.');
            } else doc.reasons.push(amt.label + ' differs by ' + fmt(amt.diff) + '.' + (lineDiff === null && headerDiffFromLines ? '' : ''));
          }
        }
        bad.forEach(function (f) {
          if (f.f === 'amount_tax' && f.diff != null) doc.reasons.push('Tax differs by ' + fmt(f.diff) + ' - a different tax rate / tax-inclusive price on one side.');
          if (f.kind === 'date' && f.diff != null && f.diff !== 0) doc.reasons.push(f.label + ' is ' + Math.abs(f.diff) + ' day' + (Math.abs(f.diff) === 1 ? '' : 's') + (f.diff > 0 ? ' later' : ' earlier') + ' in the file than in Odoo.');
          if (f.kind === 'state') doc.reasons.push('Status in the file is "' + (f.file || '(blank)') + '" but Odoo says "' + (f.odoo || '(blank)') + '".');
          if (f.kind === 'text') doc.reasons.push(f.label + ' is "' + (f.file || '(blank)') + '" in the file and "' + (f.odoo || '(blank)') + '" in Odoo.');
        });
        var missL = doc.lines.filter(function (l) { return l.status === 'missing_odoo'; }).length, extraL = doc.lines.filter(function (l) { return l.status === 'extra_odoo'; }).length;
        if (missL) doc.reasons.push(missL + ' line' + (missL > 1 ? 's' : '') + ' in the file ' + (missL > 1 ? 'are' : 'is') + ' not in Odoo.');
        if (extraL) doc.reasons.push(extraL + ' line' + (extraL > 1 ? 's' : '') + ' in Odoo ' + (extraL > 1 ? 'are' : 'is') + ' not in the file.');
        cnt.withDiffs++;
      } else if (doc.status === 'match') cnt.exact++;
      out.docs.push(doc);
    });
    cnt.dupFile = dupFileKeys;

    /* 5 · Odoo records the file does not have */
    var fileKeySet = {}; order.forEach(function (k) { fileKeySet[k] = 1; });
    var missTotal = 0;
    (input.odoo.extraDocs || []).forEach(function (d) {
      var k = normKey(d[keyField]); if (!k || fileKeySet[k]) return;
      fileKeySet[k] = 1;
      var rec = { key: String(d[keyField]), id: d.id, rec: d, fields: P.fields.filter(function (s) { return hmap[s.f]; }).map(function (s) { return { f: s.f, label: s.label, kind: s.kind, odoo: show(s.kind, s.kind === 'text' ? m2oName(d[s.f]) : d[s.f]) }; }) };
      if (totalSpec) { var v = num(d[totalSpec.f]); if (v !== null) { missTotal += v; rec.total = v; } }
      out.missingInFile.push(rec);
    });
    cnt.missingFile = out.missingInFile.length; cnt.missingFileTotal = round2(missTotal);

    /* 6 · summary */
    var S = out.summary;
    S.fileRows = rows.length; S.fileDocs = order.length; S.blankKeyRows = blankKeyRows.length;
    S.matchedDocs = cnt.matched; S.exact = cnt.exact; S.withDiffs = cnt.withDiffs; S.missingInOdoo = cnt.missingOdoo; S.duplicateKeys = cnt.dupFile;
    S.missingInFile = cnt.missingFile; S.missingInFileTotal = cnt.missingFileTotal;
    S.accuracy = order.length ? Math.round((cnt.exact / order.length) * 1000) / 10 : 0;
    S.totalLabel = totalSpec ? totalSpec.label : null;
    S.fileTotal = round2(cnt.fileTotal); S.duplicateExtraTotal = cnt.dupExtra || 0; S.missingInOdooTotal = cnt.missingOdooTotal || 0; S.odooTotal = round2(cnt.odooTotal); S.totalDiff = round2(cnt.fileTotal - cnt.odooTotal);
    S.lines = { file: cnt.lineFile, odoo: cnt.lineOdoo, paired: cnt.linePairs, exact: cnt.lineExact, differ: cnt.lineDiff, missingInOdoo: cnt.lineMissingOdoo, extraInOdoo: cnt.lineExtraOdoo, docsWithLineIssues: cnt.docsWithLineIssues };
    S.lineAccuracy = (cnt.lineFile + cnt.lineExtraOdoo) ? Math.round((cnt.lineExact / (cnt.lineFile + cnt.lineExtraOdoo)) * 1000) / 10 : null;
    /* totals on the matched documents only - the fair comparison */
    var mf = 0, mo = 0;
    if (totalSpec) out.docs.forEach(function (d) { if (!d.odoo) return; var fld = d.fields.filter(function (f) { return f.f === totalSpec.f; })[0]; if (fld) { mf += num(fld.file) || 0; mo += num(fld.odoo) || 0; } });
    S.matchedFileTotal = round2(mf); S.matchedOdooTotal = round2(mo); S.matchedTotalDiff = round2(mf - mo);
    /* which columns cause the most trouble */
    var byField = {};
    out.docs.forEach(function (d) { d.fields.forEach(function (f) { if (!f.ok && !f.missingOdoo) { var b = byField[f.f] = byField[f.f] || { label: f.label, count: 0, sumDiff: 0 }; b.count++; if (f.diff != null && f.kind === 'number') b.sumDiff += f.diff; } }); });
    S.byField = Object.keys(byField).map(function (k) { var b = byField[k]; b.sumDiff = round2(b.sumDiff); return b; }).sort(function (a, b) { return b.count - a.count; });
    if (blankKeyRows.length) out.notes.push(blankKeyRows.length + ' file row' + (blankKeyRows.length > 1 ? 's have' : ' has') + ' no value in the key column and ' + (blankKeyRows.length > 1 ? 'were' : 'was') + ' skipped (rows ' + blankKeyRows.slice(0, 12).join(', ') + (blankKeyRows.length > 12 ? ', …' : '') + ').');
    return out;
  }
  function fmt(n) { return (n > 0 ? '+' : '') + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }

  function fileLineOf(r, specs, lmap) {
    var L = { vals: {}, rowNo: null, product: null, qty: null, price: null, discount: null, subtotal: null };
    specs.forEach(function (sp) {
      var v = r[lmap[sp.f]]; L.vals[sp.f] = v;
      if (sp.kind === 'product') L.product = v;
      else if (sp.role === 'qty' || sp.role === 'done') { if (sp.role === 'qty' || L.qty == null) L.qty = num(v); }
      else if (sp.role === 'price') L.price = num(v);
      else if (sp.role === 'discount') L.discount = num(v);
      else if (sp.role === 'subtotal') L.subtotal = num(v);
    });
    return L;
  }
  function odooLineOf(l, P, input) {
    var L = { rec: l, parts: productParts(l.product_id), qty: null, price: null, discount: null, subtotal: null };
    P.lines.fields.forEach(function (sp) {
      var v = l[sp.f]; if (v === undefined && sp.altF) sp.altF.forEach(function (a) { if (v === undefined) v = l[a]; });
      if (sp.role === 'qty') L.qty = num(v); else if (sp.role === 'price') L.price = num(v); else if (sp.role === 'discount') L.discount = num(v); else if (sp.role === 'subtotal') L.subtotal = num(v);
    });
    if (!L.parts.name && !L.parts.code && l.name) L.parts = productParts(String(l.name).split('\n')[0]);
    return L;
  }
  function lineRow(doc, rowNo, f, o, status, issues) {
    return { docKey: doc.key, rowNo: rowNo, status: status, issues: issues, file: f, odoo: o,
      product: f && !isBlank(f.product) ? String(f.product) : (o ? m2oName(o.rec.product_id) || String(o.rec.name || '') : ''), odooId: o && o.rec ? o.rec.id : null };
  }

  /* ── Report tables (what Export writes) ──────────────────────────────────── */
  var STATUS_LABEL = { match: 'Matched', mismatch: 'Differences', missing_odoo: 'Missing in Odoo', duplicate_file: 'Duplicate in file', missing_file: 'Missing in file',
    differs: 'Line differs', extra_odoo: 'Extra in Odoo' };
  function reportTables(res, ctx) {
    ctx = ctx || {};
    var S = res.summary, T = {};
    T.summary = { name: 'Summary', columns: ['Measure', 'Value'], rows: [
      ['Compared with Odoo', ctx.presetLabel || ''], ['File', ctx.fileName || ''], ['Generated', new Date().toISOString().slice(0, 16).replace('T', ' ')],
      ['Row level in file', res.mode === 'line' ? 'One row per line item' : 'One row per document'], ['Amount tolerance', res.tol],
      ['File rows', S.fileRows], ['Documents in file', S.fileDocs], ['Matched exactly', S.exact], ['Matched with differences', S.withDiffs],
      ['Not found in Odoo', S.missingInOdoo], ['Duplicate keys in file', S.duplicateKeys], ['In Odoo but missing from file', S.missingInFile],
      ['Document accuracy %', S.accuracy],
      [(S.totalLabel || 'Total') + ' - file (all rows)', S.fileTotal], [(S.totalLabel || 'Total') + ' - Odoo (matched documents)', S.odooTotal],
      [(S.totalLabel || 'Total') + ' - of documents not found in Odoo', S.missingInOdooTotal], [(S.totalLabel || 'Total') + ' - extra duplicate rows in file', S.duplicateExtraTotal],
      [(S.totalLabel || 'Total') + ' - difference on matched documents', S.matchedTotalDiff], [(S.totalLabel || 'Total') + ' of Odoo records missing from file', S.missingInFileTotal],
      ['Line items in file', S.lines.file], ['Line items in Odoo (matched documents)', S.lines.odoo], ['Lines identical', S.lines.exact], ['Lines with differences', S.lines.differ],
      ['Lines missing in Odoo', S.lines.missingInOdoo], ['Lines only in Odoo', S.lines.extraInOdoo]
    ].concat(res.notes.map(function (n) { return ['Note', n]; })) };
    var hs = res.headerSpecs;
    T.documents = { name: 'Documents', columns: ['Document', 'File row(s)', 'Status', 'Odoo ID', 'Where the problem is'].concat([].concat.apply([], hs.map(function (s) { return [s.label + ' (file)', s.label + ' (Odoo)', s.label + ' diff']; }))),
      rows: res.docs.map(function (d) {
        var r = [d.key, d.fileRows.join(', '), STATUS_LABEL[d.status] || d.status, d.odoo ? d.odoo.id : '', d.reasons.join(' | ')];
        hs.forEach(function (s) { var f = d.fields.filter(function (x) { return x.f === s.f; })[0] || {}; r.push(f.file == null ? '' : f.file, f.odoo == null ? '' : f.odoo, f.diff == null ? '' : f.diff); });
        return r;
      }) };
    var diffRows = [];
    res.docs.forEach(function (d) { d.fields.forEach(function (f) { if (!f.ok) diffRows.push([d.key, STATUS_LABEL[d.status] || d.status, f.label, f.file, f.odoo, f.diff == null ? '' : f.diff]); }); });
    T.differences = { name: 'Field differences', columns: ['Document', 'Status', 'Field', 'File', 'Odoo', 'Difference'], rows: diffRows };
    if (res.lineSpecs && res.lineSpecs.length) {
      var ls = res.lineSpecs.filter(function (s) { return s.kind !== 'product'; });
      T.lines = { name: 'Line items', columns: ['Document', 'File row', 'Product', 'Status', 'What differs'].concat([].concat.apply([], ls.map(function (s) { return [s.label + ' (file)', s.label + ' (Odoo)']; }))),
        rows: res.lines.map(function (l) {
          var r = [l.docKey, l.rowNo == null ? '' : l.rowNo, l.product, STATUS_LABEL[l.status] || l.status, l.issues.join(' | ')];
          ls.forEach(function (s) {
            var fv = l.file ? show(s.kind, l.file.vals[s.f]) : '', ov = '';
            if (l.odoo) { var x = l.odoo.rec[s.f]; if (x === undefined && s.altF) s.altF.forEach(function (a) { if (x === undefined) x = l.odoo.rec[a]; }); ov = show(s.kind, x); }
            r.push(fv, ov);
          });
          return r;
        }) };
    }
    T.missing = { name: 'In Odoo, not in file', columns: ['Document', 'Odoo ID'].concat(hs.map(function (s) { return s.label; })),
      rows: res.missingInFile.map(function (m) { return [m.key, m.id].concat(hs.map(function (s) { var f = m.fields.filter(function (x) { return x.f === s.f; })[0]; return f ? f.odoo : ''; })); }) };
    return T;
  }

  var api = { PRESETS: PRESETS, reconcile: reconcile, compare: compare, normKey: normKey, normText: normText, num: num, productParts: productParts, guessColumn: guessColumn, guessKeyColumn: guessKeyColumn,
    pairLines: pairLines, reportTables: reportTables, STATUS_LABEL: STATUS_LABEL, odooDays: odooDays, fileDays: fileDays, keepInvoiceLine: keepInvoiceLine, m2oName: m2oName, m2oId: m2oId, show: show };
  root.DVReconcile = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
