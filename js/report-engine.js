/* ==========================================================================
   ARTIVORALABS — DashView Report Engine
   --------------------------------------------------------------------------
   A professional, print/board-ready export layer for Data Studio, built on
   top of two industry-standard, MIT-licensed libraries that are lazily
   loaded from CDN only the moment someone actually exports (matching the
   "no network calls until you ask for one" spirit of the rest of this repo):

     • ExcelJS   — real styled workbooks: header theming, number formats,
                   frozen panes, autofilter, totals row, embedded chart
                   images. (SheetJS, used elsewhere for reading files, has
                   no styling support in its free build.)
     • jsPDF +
       jsPDF-AutoTable — a genuine multi-page report: cover page, executive
                   summary of KPI tiles, a chart gallery, paginated data /
                   pivot tables with repeating headers, and a running
                   header/footer with page numbers.

   Odoo AI dashboards use the same PDF stack via composeAIDashboardPdf /
   generateAIDashboardPdf, with vector charts, exact returned-value tables,
   the model's evidence narrative, and explicit source/method/limitations.

   This file is deliberately framework-free and side-effect-free at parse
   time: it exposes a small `DVReportEngine` API and does nothing until
   called. The "compose*" functions take the library constructor as an
   argument and are pure builders (no DOM, no globals besides the library
   itself), which is what makes them unit-testable under Node — the exact
   pattern js/studio-core.js already uses for Studio.
   ========================================================================== */
'use strict';

var DVReportEngine = (function () {

  /* ======================================================================
     0. Brand tokens — mirrors css/base.css's Data Studio palette
        (--signal / --beacon / --ink) so exported reports look like they
        came from the same product, not a generic spreadsheet.
     ====================================================================== */
  var BRAND = {
    name: 'DashView',
    accentHex: 'e8a33d',      // --signal
    accentDarkHex: 'd98f27',  // --beacon
    inkHex: '1c2321',
    mutedHex: '6b7570',
    bandHex: 'f6f1e7',
    borderHex: 'e3dccb',
  };
  var ARGB = {
    accent: 'FF' + BRAND.accentHex.toUpperCase(),
    accentDark: 'FF' + BRAND.accentDarkHex.toUpperCase(),
    ink: 'FF' + BRAND.inkHex.toUpperCase(),
    white: 'FFFFFFFF',
    band: 'FF' + BRAND.bandHex.toUpperCase(),
    border: 'FF' + BRAND.borderHex.toUpperCase(),
  };
  var RGB = { accent: [232, 163, 61], accentDark: [217, 143, 39], ink: [28, 35, 33], muted: [107, 117, 112], band: [246, 241, 231], border: [227, 220, 203], white: [255, 255, 255] };

  var MAX_PDF_ROWS = 1500; // keep the PDF a sane, printable length; full data always lives in the Excel export

  /* ======================================================================
     1. Small pure helpers
     ====================================================================== */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function stamp(d) {
    d = d ? (d instanceof Date ? d : new Date(d)) : new Date();
    if (isNaN(d.getTime())) return 'Date unavailable';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var h = d.getHours(), ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12; if (h === 0) h = 12;
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' · ' + h + ':' + pad2(d.getMinutes()) + ' ' + ampm;
  }
  function sanitizeFilename(s) {
    return String(s || 'Report').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim().slice(0, 120) || 'Report';
  }
  function buildReportFilename(title, extension, generatedAt) {
    var date = generatedAt instanceof Date ? generatedAt : new Date(generatedAt || Date.now());
    if (isNaN(date.getTime())) date = new Date();
    return sanitizeFilename(title) + ' - ' + date.toISOString().slice(0, 10) + '.' + String(extension || '').replace(/^\./, '').toLowerCase();
  }
  function normalizeReportPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Report data is missing or invalid.');
    var out = Object.assign({}, payload);
    if (out.title != null && typeof out.title !== 'string') throw new TypeError('Report title must be text.');
    if (out.workbookName != null && typeof out.workbookName !== 'string') throw new TypeError('Workbook name must be text.');
    out.title = String(out.title || out.workbookName || 'Business report').trim().slice(0, 120) || 'Business report';
    out.workbookName = String(out.workbookName || out.title).trim() || out.title;
    out.generatedAt = out.generatedAt == null ? new Date() : (out.generatedAt instanceof Date ? out.generatedAt : new Date(out.generatedAt));
    if (isNaN(out.generatedAt.getTime())) throw new TypeError('Report generation date is invalid.');
    out.rows = out.rows == null ? [] : out.rows;
    out.fields = out.fields == null ? [] : out.fields;
    if (!Array.isArray(out.rows)) throw new TypeError('Report rows must be an array.');
    if (!Array.isArray(out.fields)) throw new TypeError('Report fields must be an array.');
    if (out.includeData !== false && !out.fields.length) throw new TypeError('Add at least one field before exporting the report.');
    var seen = Object.create(null);
    out.fields = out.fields.map(function (field) {
      if (!field || typeof field.name !== 'string' || !field.name.trim()) throw new TypeError('Every report field must have a name.');
      var name = field.name.trim(), key = name.toLowerCase();
      if (seen[key]) throw new TypeError('Report fields must have unique names: ' + name + '.');
      seen[key] = true;
      return Object.assign({}, field, { name: name, type: field.type || 'text' });
    });
    out.rows.forEach(function (row, index) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('Report row ' + (index + 1) + ' is invalid.');
    });
    if (out.filtersSummary == null) out.filtersSummary = [];
    if (typeof out.filtersSummary === 'string') out.filtersSummary = [out.filtersSummary];
    if (!Array.isArray(out.filtersSummary)) throw new TypeError('Report filters must be an array of text values.');
    out.filtersSummary = out.filtersSummary.map(function (filter) { return String(filter == null ? '' : filter).trim(); }).filter(Boolean);
    if (out.companyName == null) {
      var companyFilter = out.filtersSummary.filter(function (f) { return /^company\s*:/i.test(f); })[0];
      out.companyName = companyFilter ? companyFilter.replace(/^company\s*:\s*/i, '') : (out.company || out.workspaceName || 'Not specified');
    }
    out.companyName = String(out.companyName || 'Not specified').trim();
    if (out.reportingPeriod == null) {
      var periodFilter = out.filtersSummary.filter(function (f) { return /^(period|date range|reporting period)\s*:/i.test(f); })[0];
      out.reportingPeriod = periodFilter ? periodFilter.replace(/^[^:]+:\s*/, '') : String(out.dateRange || out.period || ('As of ' + out.generatedAt.toLocaleDateString()));
    }
    out.reportingPeriod = String(out.reportingPeriod || 'Not specified').trim();
    out.sourceFileName = String(out.sourceFileName || out.source || 'Not specified');
    out.filteredRows = out.filteredRows == null ? out.rows.length : Number(out.filteredRows);
    out.totalRows = out.totalRows == null ? out.filteredRows : Number(out.totalRows);
    if (!Number.isSafeInteger(out.filteredRows) || out.filteredRows < 0 || !Number.isSafeInteger(out.totalRows) || out.totalRows < out.filteredRows) throw new TypeError('Report row counts are invalid.');
    return out;
  }
  function isNumericType(type) { return type === 'number' || type === 'currency' || type === 'percent'; }

  function numFmtForType(type) {
    switch (type) {
      case 'currency': return '$#,##0.00;[Red]-$#,##0.00';
      case 'percent': return '0.0"%"';       // values are already on a 0-100 scale in this app, not 0-1 — a literal suffix avoids Excel's automatic ×100
      case 'number': return '#,##0.##';
      case 'date': return 'mmm d, yyyy';
      default: return null;
    }
  }
  /** Converts one raw typed cell (as stored in state.dataset.typedRows) into the value ExcelJS should write. */
  function excelValue(raw, type) {
    if (raw === null || raw === undefined || raw === '') return null;
    if (type === 'date') { var d = new Date(raw); return isNaN(d.getTime()) ? null : d; }
    if (type === 'boolean') return raw ? 'Yes' : 'No';
    if (isNumericType(type)) { var n = Number(raw); return isNaN(n) ? null : n; }
    return String(raw);
  }
  function colLetter(n) { // 1-based
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  /* ======================================================================
     2. Excel report — ExcelJS
     ====================================================================== */
  function styleHeaderRow(row, argbFill, argbText) {
    row.eachCell(function (cell) {
      cell.font = { bold: true, color: { argb: argbText || ARGB.white }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argbFill } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = { bottom: { style: 'thin', color: { argb: ARGB.border } } };
    });
    row.height = 22;
  }
  function zebraFill(row, isEven) {
    if (!isEven) return;
    row.eachCell({ includeEmpty: true }, function (cell) {
      if (!cell.fill || !cell.fill.fgColor) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.band } };
    });
  }
  function autoWidth(header, sample) {
    var longest = String(header || '').length;
    for (var i = 0; i < sample.length; i++) { var len = String(sample[i] == null ? '' : sample[i]).length; if (len > longest) longest = len; }
    return Math.max(10, Math.min(42, longest + 3));
  }

  function buildSummarySheet(wb, payload) {
    var ws = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 22 }, { width: 46 }, { width: 4 }, { width: 22 }, { width: 22 }];
    ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.headerFooter = { oddFooter: '&L' + BRAND.name + '&RPage &P of &N' };

    ws.mergeCells('A1:E1');
    var title = ws.getCell('A1');
    title.value = payload.title || payload.workbookName || 'Report';
    title.font = { bold: true, size: 20, color: { argb: ARGB.ink } };
    ws.getRow(1).height = 32;

    ws.mergeCells('A2:E2');
    var sub = ws.getCell('A2');
    sub.value = 'Business intelligence report · generated with ' + BRAND.name;
    sub.font = { italic: true, size: 11, color: { argb: 'FF' + BRAND.mutedHex.toUpperCase() } };

    ws.mergeCells('A3:E3');
    ws.getRow(3).height = 4;
    ws.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB.accent } };

    var r = 5;
    var meta = [
      ['Company / workspace', payload.companyName],
      ['Reporting period', payload.reportingPeriod],
      ['Source file', payload.sourceFileName],
      ['Generated', stamp(payload.generatedAt)],
      ['Rows included', payload.filteredRows.toLocaleString() + (payload.totalRows !== payload.filteredRows ? ' of ' + payload.totalRows.toLocaleString() + ' total (filters applied)' : '')],
      ['Filters applied', payload.filtersSummary.length ? payload.filtersSummary.join('\n') : 'None'],
    ];
    meta.forEach(function (m) {
      ws.getCell('A' + r).value = m[0];
      ws.getCell('A' + r).font = { bold: true, color: { argb: 'FF' + BRAND.mutedHex.toUpperCase() }, size: 10 };
      ws.getCell('A' + r).alignment = { vertical: 'top' };
      ws.getCell('B' + r).value = m[1];
      ws.getCell('B' + r).font = { size: 11, color: { argb: ARGB.ink } };
      ws.getCell('B' + r).alignment = { wrapText: true, vertical: 'top' };
      var lines = String(m[1]).split('\n').reduce(function (count, line) { return count + Math.max(1, Math.ceil(line.length / 46)); }, 0);
      ws.getRow(r).height = Math.max(16, lines * 14);
      r++;
    });


    r += 1;

    if (payload.includeKpis && payload.kpis && payload.kpis.length) {
      ws.mergeCells('A' + r + ':B' + r);
      ws.getCell('A' + r).value = 'Key metrics';
      ws.getCell('A' + r).font = { bold: true, size: 13, color: { argb: ARGB.ink } };
      r += 1;
      var headerRow = ws.getRow(r);
      headerRow.getCell(1).value = 'Metric'; headerRow.getCell(2).value = 'Value';
      styleHeaderRow(headerRow, ARGB.accent);
      r += 1;
      payload.kpis.forEach(function (k, i) {
        var row = ws.getRow(r);
        row.getCell(1).value = k.label;
        row.getCell(2).value = k.value;
        row.getCell(2).font = { bold: true };
        zebraFill(row, i % 2 === 1);
        r += 1;
      });
    }
    return ws;
  }

  function buildDataSheet(wb, payload) {
    var fields = payload.fields || [];
    var ws = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1, showGridLines: true }] });
    ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.55, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.pageSetup.printTitlesRow = '1:1';
    ws.headerFooter = { oddHeader: '&L' + sanitizeFilename(payload.title), oddFooter: '&L' + BRAND.name + '&RPage &P of &N' };
    var headerRow = ws.getRow(1);
    fields.forEach(function (f, i) { headerRow.getCell(i + 1).value = f.name; });
    styleHeaderRow(headerRow, ARGB.accent);

    var rows = payload.rows || [];
    rows.forEach(function (r, ri) {
      var row = ws.getRow(ri + 2);
      fields.forEach(function (f, ci) {
        var cell = row.getCell(ci + 1);
        cell.value = excelValue(r[f.name], f.type);
        var fmt = numFmtForType(f.type);
        if (fmt) cell.numFmt = fmt;
        if (isNumericType(f.type)) cell.alignment = { horizontal: 'right' };
      });
      zebraFill(row, ri % 2 === 1);
    });

    // Totals row — SUM() formulas for every numeric-type column, so the sheet stays live if someone edits it.
    var lastDataRow = rows.length + 1;
    if (rows.length) {
      var totalsRow = ws.getRow(lastDataRow + 1);
      fields.forEach(function (f, i) {
        var col = colLetter(i + 1);
        var cell = totalsRow.getCell(i + 1);
        if (i === 0) { cell.value = 'Total (' + rows.length.toLocaleString() + ' rows)'; cell.font = { bold: true, italic: true }; }
        else if (isNumericType(f.type)) {
          cell.value = { formula: 'SUM(' + col + '2:' + col + lastDataRow + ')' };
          var fmt = numFmtForType(f.type); if (fmt) cell.numFmt = fmt;
          cell.font = { bold: true };
          cell.alignment = { horizontal: 'right' };
        }
      });
      totalsRow.eachCell({ includeEmpty: true }, function (cell) { cell.border = { top: { style: 'medium', color: { argb: ARGB.accentDark } } }; });
    }

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, fields.length) } };
    ws.columns.forEach(function (col, i) {
      var f = fields[i]; if (!f) return;
      var sample = rows.slice(0, 200).map(function (r) { return f.type === 'date' ? '0000-00-00' : r[f.name]; });
      col.width = autoWidth(f.name, sample);
    });
    return ws;
  }

  function buildPivotSheet(wb, payload) {
    var pivot = payload.pivot;
    if (!pivot || !pivot.columns || !pivot.columns.length) return null;
    var ws = wb.addWorksheet('Pivot', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.55, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.pageSetup.printTitlesRow = '1:1';
    ws.headerFooter = { oddHeader: '&L' + sanitizeFilename(payload.title), oddFooter: '&L' + BRAND.name + '&RPage &P of &N' };
    var headerRow = ws.getRow(1);
    pivot.columns.forEach(function (c, i) { headerRow.getCell(i + 1).value = c; });
    styleHeaderRow(headerRow, ARGB.accentDark);

    (pivot.rows || []).forEach(function (r, ri) {
      var row = ws.getRow(ri + 2);
      var isGrandTotal = String(r[pivot.columns[0]]).toLowerCase().indexOf('grand total') === 0;
      pivot.columns.forEach(function (c, ci) {
        var cell = row.getCell(ci + 1);
        var v = r[c];
        cell.value = (v === '' || v === undefined) ? null : v;
        if (typeof v === 'number') { cell.numFmt = '#,##0.##'; cell.alignment = { horizontal: 'right' }; }
      });
      if (isGrandTotal) row.eachCell({ includeEmpty: true }, function (cell) { cell.font = { bold: true }; cell.border = { top: { style: 'medium', color: { argb: ARGB.accentDark } } }; });
      else zebraFill(row, ri % 2 === 1);
    });
    ws.columns.forEach(function (col, i) { col.width = autoWidth(pivot.columns[i], (pivot.rows || []).slice(0, 100).map(function (r) { return r[pivot.columns[i]]; })); });
    return ws;
  }

  function buildChartsSheet(wb, payload) {
    var charts = payload.charts;
    if (!charts || !charts.length) return null;
    var ws = wb.addWorksheet('Charts', { views: [{ showGridLines: false }] });
    ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.55, bottom: 0.5, header: 0.2, footer: 0.2 } };
    ws.headerFooter = { oddHeader: '&L' + sanitizeFilename(payload.title), oddFooter: '&L' + BRAND.name + '&RPage &P of &N' };
    ws.getColumn(1).width = 4;
    var row = 1;
    charts.forEach(function (c) {
      ws.getCell('B' + row).value = c.title || 'Chart';
      ws.getCell('B' + row).font = { bold: true, size: 12, color: { argb: ARGB.ink } };
      row += 1;
      if (c.subtitle) { ws.getCell('B' + row).value = c.subtitle; ws.getCell('B' + row).font = { italic: true, size: 10, color: { argb: 'FF' + BRAND.mutedHex.toUpperCase() } }; row += 1; }
      try {
        if (c.image) {
          var base64 = String(c.image).replace(/^data:image\/\w+;base64,/, '');
          var imgId = wb.addImage({ base64: base64, extension: 'png' });
          var w = 560, h = 300;
          ws.addImage(imgId, { tl: { col: 1, row: row - 1 }, ext: { width: w, height: h } });
          row += Math.ceil(h / 20) + 2;
        }
      } catch (e) { /* a single bad image never sinks the whole export */ if (typeof console !== 'undefined') console.warn('DVReportEngine: could not embed chart image', e); }
    });
    return ws;
  }

  /** Pure builder: pass the ExcelJS constructor (window.ExcelJS in the browser, require('exceljs') under Node for tests). Returns the built Workbook — caller decides how to serialize/download it. */
  function composeWorkbook(ExcelJSLib, payload) {
    payload = normalizeReportPayload(payload);
    if (!ExcelJSLib || typeof ExcelJSLib.Workbook !== 'function') throw new TypeError('Excel workbook library is unavailable.');
    var wb = new ExcelJSLib.Workbook();
    wb.creator = BRAND.name;
    wb.created = payload.generatedAt || new Date();
    wb.title = payload.title || payload.workbookName;

    buildSummarySheet(wb, payload);
    if (payload.includeData !== false) buildDataSheet(wb, payload);
    if (payload.includePivot) buildPivotSheet(wb, payload);
    if (payload.includeCharts) buildChartsSheet(wb, payload);
    return wb;
  }

  /* ======================================================================
     3. PDF report — jsPDF + jsPDF-AutoTable
     ====================================================================== */
  var PAGE = { w: 595.28, h: 841.89, margin: 42 }; // A4 in points

  function pdfSetInk(doc) { doc.setTextColor(RGB.ink[0], RGB.ink[1], RGB.ink[2]); }
  function pdfSetMuted(doc) { doc.setTextColor(RGB.muted[0], RGB.muted[1], RGB.muted[2]); }

  function buildCoverPage(doc, payload) {
    doc.setFillColor(RGB.accent[0], RGB.accent[1], RGB.accent[2]);
    doc.rect(0, 0, PAGE.w, 10, 'F');

    doc.setFont('helvetica', 'bold'); doc.setFontSize(25); pdfSetInk(doc);
    var titleLines = doc.splitTextToSize(payload.title, PAGE.w - PAGE.margin * 2);
    doc.text(titleLines, PAGE.margin, 185);
    var afterTitleY = 185 + titleLines.length * 29;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12.5); pdfSetMuted(doc);
    doc.text('Business report · generated with ' + BRAND.name, PAGE.margin, afterTitleY + 8);
    doc.setDrawColor(RGB.border[0], RGB.border[1], RGB.border[2]);
    doc.setLineWidth(0.75);
    doc.line(PAGE.margin, afterTitleY + 28, PAGE.w - PAGE.margin, afterTitleY + 28);

    var metaY = afterTitleY + 54;
    /* Data Studio payloads carry company / period / file / row counts; AI dashboard payloads carry a source and
       currency instead. Only print what the payload actually has, never the word "undefined". */
    var hasRows = isFinite(Number(payload.filteredRows)) && payload.filteredRows !== null && payload.filteredRows !== undefined;
    var meta = [];
    if (payload.companyName) meta.push(['Company / workspace', payload.companyName]);
    if (payload.reportingPeriod) meta.push(['Reporting period', payload.reportingPeriod]);
    if (payload.sourceFileName) meta.push(['Source file', payload.sourceFileName]);
    else if (payload.source) meta.push(['Source', payload.source]);
    if (payload.currency) meta.push(['Currency', payload.currency]);
    meta.push(['Generated', stamp(payload.generatedAt)]);
    if (hasRows) {
      var filteredN = Number(payload.filteredRows), totalN = isFinite(Number(payload.totalRows)) ? Number(payload.totalRows) : filteredN;
      meta.push(['Rows included', filteredN.toLocaleString() + (totalN !== filteredN ? ' of ' + totalN.toLocaleString() + ' total · filters applied' : '')]);
    }
    meta.forEach(function (m) {
      var valueLines = doc.splitTextToSize(String(m[1]), PAGE.w - PAGE.margin * 2 - 142);
      var valueHeight = Math.max(19, valueLines.length * 13 + 5);
      if (metaY + valueHeight > PAGE.h - PAGE.margin * 2) { doc.addPage(); sectionHeading(doc, 'Report context (continued)', 60); metaY = 102; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); pdfSetMuted(doc);
      doc.text(m[0].toUpperCase(), PAGE.margin, metaY);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); pdfSetInk(doc);
      doc.text(valueLines, PAGE.margin + 136, metaY);
      metaY += valueHeight;
    });

    var filtersList = Array.isArray(payload.filtersSummary) ? payload.filtersSummary : [];
    var filters = filtersList.length ? filtersList.join('  ·  ') : (hasRows ? 'None' : '');
    var filterLines = doc.splitTextToSize(filters, PAGE.w - PAGE.margin * 2 - 142);
    var filterOffset = 0;
    while (filterOffset < filterLines.length) {
      if (metaY + 24 > PAGE.h - PAGE.margin * 2) { doc.addPage(); sectionHeading(doc, 'Report filters (continued)', 60); metaY = 102; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); pdfSetMuted(doc);
      doc.text(filterOffset === 0 ? 'FILTERS APPLIED' : 'FILTERS CONTINUED', PAGE.margin, metaY);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); pdfSetInk(doc);
      var room = Math.max(1, Math.floor((PAGE.h - PAGE.margin - metaY - 12) / 13));
      var chunk = filterLines.slice(filterOffset, filterOffset + room);
      doc.text(chunk, PAGE.margin + 136, metaY);
      metaY += chunk.length * 13 + 8;
      filterOffset += chunk.length;
    }
    doc.setFontSize(9.5); pdfSetMuted(doc);
    doc.text('Generated with ' + BRAND.name, PAGE.margin, PAGE.h - PAGE.margin);
    return doc;
  }

  function sectionHeading(doc, text, y) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); pdfSetInk(doc);
    doc.text(text, PAGE.margin, y);
    doc.setDrawColor(RGB.accent[0], RGB.accent[1], RGB.accent[2]);
    doc.setLineWidth(1.5);
    doc.line(PAGE.margin, y + 6, PAGE.margin + 28, y + 6);
    return y + 30;
  }

  function buildKpiSection(doc, payload) {
    doc.addPage();
    var y = sectionHeading(doc, 'Executive summary', 60);
    var kpis = payload.kpis || [];
    var cols = 3, gap = 14;
    var boxW = (PAGE.w - PAGE.margin * 2 - gap * (cols - 1)) / cols;
    var boxH = 64;
    kpis.forEach(function (k, i) {
      var col = i % cols, row = Math.floor(i / cols);
      if (row > 0 && row % 6 === 0 && col === 0) { doc.addPage(); y = sectionHeading(doc, 'Executive summary (continued)', 60); }
      var localRow = row % 6;
      var x = PAGE.margin + col * (boxW + gap);
      var by = y + localRow * (boxH + gap);
      doc.setDrawColor(RGB.border[0], RGB.border[1], RGB.border[2]);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, by, boxW, boxH, 4, 4, 'FD');
      doc.setFillColor(RGB.accent[0], RGB.accent[1], RGB.accent[2]);
      doc.roundedRect(x, by, 4, boxH, 2, 2, 'F');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); pdfSetMuted(doc);
      var labelLines = doc.splitTextToSize(String(k.label || ''), boxW - 18);
      doc.text(labelLines.slice(0, 2), x + 12, by + 18);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(17); pdfSetInk(doc);
      doc.text(String(k.value), x + 12, by + 46);
    });
    return doc;
  }

  /* AI-generated narrative (payload.insightsText) explaining the "why" behind
     the numbers, plus a full dashboard screenshot (payload.snapshot =
     { image, width, height }) — both optional; the section is skipped when
     neither is supplied. */
  function buildInsightsSection(doc, payload) {
    var text = payload.insightsText && String(payload.insightsText).trim();
    var snap = payload.snapshot && payload.snapshot.image;
    if (!text && !snap) return doc;
    if (text) {
      doc.addPage();
      var y = sectionHeading(doc, 'AI insights', 60);
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9); pdfSetMuted(doc);
      doc.text('Generated from the figures on this report \u2014 review before acting on it.', PAGE.margin, y);
      y += 16;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); pdfSetInk(doc);
      var paras = text.split(/\n{2,}/);
      paras.forEach(function (p) {
        var lines = doc.splitTextToSize(p.trim(), PAGE.w - PAGE.margin * 2);
        var offset = 0;
        while (offset < lines.length) {
          var room = Math.floor((PAGE.h - PAGE.margin - y - 10) / 13);
          if (room < 1) { doc.addPage(); y = sectionHeading(doc, 'AI insights (continued)', 60); room = Math.floor((PAGE.h - PAGE.margin - y - 10) / 13); }
          var chunk = lines.slice(offset, offset + room);
          doc.text(chunk, PAGE.margin, y);
          y += chunk.length * 13 + 10;
          offset += chunk.length;
        }
      });
    }
    if (snap) {
      doc.addPage();
      var sy = sectionHeading(doc, 'Dashboard snapshot', 60);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); pdfSetMuted(doc);
      doc.text('Captured at the moment this report was generated.', PAGE.margin, sy); sy += 12;
      var maxW = PAGE.w - PAGE.margin * 2, maxH = PAGE.h - sy - PAGE.margin;
      var ratio = (payload.snapshot.width && payload.snapshot.height) ? payload.snapshot.width / payload.snapshot.height : 16 / 9;
      var w = maxW, h = w / ratio;
      if (h > maxH) { h = maxH; w = h * ratio; }
      try { doc.addImage(snap, 'PNG', PAGE.margin, sy, w, h, undefined, 'FAST'); }
      catch (e) { doc.setFont('helvetica', 'italic'); doc.setFontSize(10); pdfSetMuted(doc); doc.text('Snapshot could not be embedded.', PAGE.margin, sy + 20); }
    }
    return doc;
  }

  function buildAIDashboardCharts(doc, payload) {
    (payload.metrics || []).forEach(function (metric) {
      doc.addPage();
      var y = sectionHeading(doc, metric.title || 'Metric', 60);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); pdfSetMuted(doc);
      doc.text('Source: ' + String(metric.model || 'Odoo') + ' · ' + String(metric.measure || ''), PAGE.margin, y);
      y += 24;
      var rows = (metric.rows || []).slice(0, 24), left = PAGE.margin + 130;
      var chartW = PAGE.w - PAGE.margin * 2 - 150, rowH = Math.min(30, Math.max(18, (PAGE.h - y - PAGE.margin - 30) / Math.max(rows.length, 1)));
      var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(Number(r.value) || 0); })) || 1;
      if (metric.chartType === 'line' && rows.length > 1) {
        var values = rows.map(function (r) { return Number(r.value) || 0; });
        var low = Math.min.apply(null, values), high = Math.max.apply(null, values), span = high - low || 1;
        var step = Math.ceil(rows.length / 6), maxIndex = values.indexOf(high);
        var points = rows.map(function (r, i) {
          return { x: left + i * chartW / (rows.length - 1), y: y + 12 + (1 - (values[i] - low) / span) * 48 };
        });
        doc.setDrawColor(RGB.border[0], RGB.border[1], RGB.border[2]);
        doc.line(left, y + 68, left + chartW, y + 68);
        points.forEach(function (point, i) {
          if (i) { doc.setDrawColor(RGB.accent[0], RGB.accent[1], RGB.accent[2]); doc.setLineWidth(2); doc.line(points[i - 1].x, points[i - 1].y, point.x, point.y); }
          if (doc.circle) { doc.setFillColor(RGB.accent[0], RGB.accent[1], RGB.accent[2]); doc.circle(point.x, point.y, 2.5, 'F'); }
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); pdfSetInk(doc);
          if (i === maxIndex || i === rows.length - 1) doc.text(String(rows[i].value), point.x, point.y - 5, { align: 'center' });
          if (i % step === 0 || i === rows.length - 1) doc.text(doc.splitTextToSize(String(rows[i].label || ''), 70).slice(0, 1), point.x, y + 82, { align: 'center' });
        });
      } else {
        rows.forEach(function (r, i) {
          var ry = y + i * rowH;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); pdfSetInk(doc);
          doc.text(doc.splitTextToSize(String(r.label || ''), 122).slice(0, 1), PAGE.margin, ry + 10);
          doc.setFillColor(RGB.band[0], RGB.band[1], RGB.band[2]);
          doc.rect(left, ry + 2, chartW, 10, 'F');
          doc.setFillColor(RGB.accent[0], RGB.accent[1], RGB.accent[2]);
          doc.rect(left, ry + 2, Math.max(1, chartW * Math.abs(Number(r.value) || 0) / max), 10, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); pdfSetInk(doc);
          doc.text(String(r.value), left + chartW + 8, ry + 10);
        });
      }
    });
  }

  function buildAIDashboardDetails(doc, payload) {
    doc.addPage();
    var y = sectionHeading(doc, 'Source, method & limitations', 60);
    function newDetailsPage() {
      doc.addPage();
      y = sectionHeading(doc, 'Source, method & limitations (continued)', 60);
    }
    function detailBlock(label, content) {
      doc.setFont('helvetica', 'normal'); pdfSetInk(doc);
      var lines = doc.splitTextToSize(String(content), PAGE.w - PAGE.margin * 2 - 105);
      if (y + Math.max(18, lines.length * 13 + 6) > PAGE.h - PAGE.margin) newDetailsPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); pdfSetMuted(doc);
      doc.text(label.toUpperCase(), PAGE.margin, y);
      doc.setFont('helvetica', 'normal'); pdfSetInk(doc);
      doc.text(lines, PAGE.margin + 105, y);
      y += Math.max(18, lines.length * 13 + 6);
    }
    var parts = [
      ['Source', payload.source || 'Live Odoo query results'],
      ['Generated', stamp(payload.generatedAt)],
      ['Method', (payload.methods || []).join('\n') || 'Read-only Odoo query results']
    ];
    parts.forEach(function (part) { detailBlock(part[0], part[1]); });
    var limitations = payload.limitations || [];
    if (limitations.length) detailBlock('Limitations', limitations.join('\n'));
    return doc;
  }

  function composeAIDashboardPdf(jsPDFCtor, payload) {
    payload = payload || {};
    var doc = new jsPDFCtor({ unit: 'pt', format: 'a4', compress: true });
    buildCoverPage(doc, payload);
    if (payload.kpis && payload.kpis.length) {
      buildKpiSection(doc, { kpis: payload.kpis.map(function (k) { return { label: k.label, value: k.value }; }) });
    }
    if (payload.insightsText) buildInsightsSection(doc, { insightsText: payload.insightsText });
    buildAIDashboardCharts(doc, payload);
    (payload.metrics || []).forEach(function (metric) {
      tableSection(doc, 'Evidence: ' + (metric.title || metric.model || 'Metric'),
        ['Group', 'Value', 'Records'], (metric.rows || []).slice(0, MAX_PDF_ROWS).map(function (row) {
          return [String(row.label || ''), String(row.value), row.count == null ? '—' : String(row.count)];
        }));
    });
    buildAIDashboardDetails(doc, payload);
    addHeaderFooter(doc, payload);
    return doc;
  }

  function buildChartsSection(doc, payload) {
    var charts = (payload.charts || []).filter(function (c) { return c && c.image; });
    if (!charts.length) return doc;
    charts.forEach(function (c, i) {
      doc.addPage();
      var y = sectionHeading(doc, i === 0 ? 'Charts' : 'Charts (continued)', 60);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); pdfSetInk(doc);
      doc.text(String(c.title || 'Chart'), PAGE.margin, y + 8);
      var imgY = y + 24;
      var maxW = PAGE.w - PAGE.margin * 2;
      var maxH = PAGE.h - imgY - PAGE.margin - 20;
      var ratio = (c.width && c.height) ? c.width / c.height : 16 / 9;
      var w = maxW, h = w / ratio;
      if (h > maxH) { h = maxH; w = h * ratio; }
      try { doc.addImage(c.image, 'PNG', PAGE.margin, imgY, w, h, undefined, 'FAST'); }
      catch (e) { doc.setFont('helvetica', 'italic'); doc.setFontSize(10); pdfSetMuted(doc); doc.text('Chart image could not be embedded.', PAGE.margin, imgY + 20); }
    });
    return doc;
  }

  function tableSection(doc, heading, columns, rows, opts) {
    opts = opts || {};
    doc.addPage();
    var y = sectionHeading(doc, heading, 60);
    var truncatedNote = opts.truncatedFrom ? ('Showing first ' + rows.length.toLocaleString() + ' of ' + opts.truncatedFrom.toLocaleString() + ' rows — the Excel export includes every row.') : null;
    if (truncatedNote) { doc.setFont('helvetica', 'italic'); doc.setFontSize(9); pdfSetMuted(doc); doc.text(truncatedNote, PAGE.margin, y + 2); y += 14; }
    doc.autoTable({
      startY: y + 6,
      head: [columns],
      body: rows,
      margin: { left: PAGE.margin, right: PAGE.margin, top: PAGE.margin + 20 },
      styles: { fontSize: columns.length > 7 ? 7.5 : 8, cellPadding: columns.length > 7 ? 3 : 4, textColor: RGB.ink, lineColor: RGB.border, lineWidth: 0.5, overflow: 'linebreak', valign: 'middle' },
      showHead: 'everyPage', rowPageBreak: 'avoid',
      horizontalPageBreak: columns.length > 6, horizontalPageBreakRepeat: columns.length > 6 ? [0] : [],
      headStyles: { fillColor: RGB.accent, textColor: RGB.white, fontStyle: 'bold', halign: 'left' },
      alternateRowStyles: { fillColor: RGB.band },
      theme: 'grid',
      didParseCell: function (data) {
        if (data.section === 'body' && data.row.raw && String(data.row.raw[0]).toLowerCase().indexOf('grand total') === 0) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [255, 255, 255]; }
      },
    });
    return doc;
  }

  function buildDataTableSection(doc, payload) {
    var fields = payload.fields || [];
    var allRows = payload.rows || [];
    var truncated = allRows.length > MAX_PDF_ROWS;
    var rows = (truncated ? allRows.slice(0, MAX_PDF_ROWS) : allRows).map(function (r) {
      return fields.map(function (f) {
        try { return payload.formatCell ? payload.formatCell(r[f.name], f.type) : String(r[f.name] == null ? '' : r[f.name]); }
        catch (e) { return String(r[f.name] == null ? '' : r[f.name]); }
      });
    });
    if (!rows.length) rows = [fields.map(function (_, i) { return i === 0 ? 'No records match the selected filters.' : ''; })];
    tableSection(doc, 'Data', fields.map(function (f) { return f.name; }), rows, { truncatedFrom: truncated ? allRows.length : null });
    return doc;
  }

  function buildPivotSection(doc, payload) {
    var pivot = payload.pivot;
    if (!pivot || !pivot.columns || !pivot.columns.length) return doc;
    var rows = (pivot.rows || []).map(function (r) { return pivot.columns.map(function (c) { var v = r[c]; return v === undefined ? '' : String(v); }); });
    if (!rows.length) rows = [pivot.columns.map(function (_, i) { return i === 0 ? 'No pivot results available.' : ''; })];
    tableSection(doc, 'Pivot table', pivot.columns, rows);
    return doc;
  }

  function addHeaderFooter(doc, payload) {
    var total = doc.internal.getNumberOfPages();
    for (var i = 2; i <= total; i++) { // page 1 is the cover — leave it clean
      doc.setPage(i);
      doc.setDrawColor(RGB.border[0], RGB.border[1], RGB.border[2]);
      doc.setLineWidth(0.5);
      doc.line(PAGE.margin, 30, PAGE.w - PAGE.margin, 30);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); pdfSetMuted(doc);
      doc.text(String(payload.title || payload.workbookName || BRAND.name), PAGE.margin, 22);
      doc.text('Page ' + i + ' of ' + total, PAGE.w - PAGE.margin, 22, { align: 'right' });
      doc.text(BRAND.name + ' · ' + String(payload.companyName || 'Not specified') + ' · ' + stamp(payload.generatedAt), PAGE.margin, PAGE.h - 20);
      doc.text('Confidential · for internal use', PAGE.w - PAGE.margin, PAGE.h - 20, { align: 'right' });
    }
  }


  function buildContentsPage(doc, payload) {
    var items = [['Key metrics', payload.includeKpis && payload.kpis && payload.kpis.length ? payload.kpis.length + ' indicators' : null], ['Insights', payload.insightsText || (payload.snapshot && payload.snapshot.image) ? 'Highlights and observations' : null],
      ['Charts', payload.includeCharts ? 'Visual breakdown' : null], ['Data table', payload.includeData !== false ? ((payload.rows && payload.rows.length) || '') + ' records' + ((payload.rows && payload.rows.length > MAX_PDF_ROWS) ? ' (first ' + MAX_PDF_ROWS + '; full data in Excel)' : '') : null], ['Pivot summary', payload.includePivot ? 'Grouped totals' : null]].filter(function (x) { return x[1]; });
    doc.addPage(); var y = sectionHeading(doc, 'Report contents', 70) || 110;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    items.forEach(function (it, i) { pdfSetInk(doc); doc.text((i + 1) + '.  ' + it[0], PAGE.margin, y); pdfSetMuted(doc); doc.text(String(it[1]), PAGE.w - PAGE.margin, y, { align: 'right' }); doc.setDrawColor(RGB.border[0], RGB.border[1], RGB.border[2]); doc.line(PAGE.margin, y + 7, PAGE.w - PAGE.margin, y + 7); y += 28; });
    pdfSetMuted(doc); doc.setFontSize(9); doc.text('Generated ' + stamp(payload.generatedAt) + '. Figures reflect the data at generation time and may change as source records are updated.', PAGE.margin, y + 14, { maxWidth: PAGE.w - PAGE.margin * 2 });
  }

  /** Pure builder: pass the jsPDF constructor (window.jspdf.jsPDF in the browser; require('jspdf').jsPDF under Node, after requiring 'jspdf-autotable' once to patch the prototype). Returns the built doc — caller decides how to save/output it. */
  function composePdfDocument(jsPDFCtor, payload) {
    payload = normalizeReportPayload(payload);
    if (typeof jsPDFCtor !== 'function') throw new TypeError('PDF report library is unavailable.');
    var doc = new jsPDFCtor({ unit: 'pt', format: 'a4', compress: true });
    buildCoverPage(doc, payload);
    if (payload.includeContents !== false) buildContentsPage(doc, payload);
    if (payload.includeKpis && payload.kpis && payload.kpis.length) buildKpiSection(doc, payload);
    buildInsightsSection(doc, payload);
    if (payload.includeCharts) buildChartsSection(doc, payload);
    if (payload.includeData !== false) buildDataTableSection(doc, payload);
    if (payload.includePivot) buildPivotSection(doc, payload);
    addHeaderFooter(doc, payload);
    return doc;
  }

  /* ======================================================================
     4. Browser wiring — lazy CDN loads + download triggers.
        Everything above this line is pure and Node-testable; everything
        below touches `document`/`window` and only runs in a browser tab.
     ====================================================================== */
  var libState = { excel: { loaded: false, loading: null }, pdf: { loaded: false, loading: null } };

  function loadScript(src, integrity) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Could not load ' + src + ' from the CDN.')); };
      document.head.appendChild(s);
    });
  }
  function loadExcelLib() {
    if (libState.excel.loaded) return Promise.resolve();
    if (libState.excel.loading) return libState.excel.loading;
    libState.excel.loading = loadScript('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js', 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz')
      .then(function () { libState.excel.loaded = true; })
      .catch(function (err) { libState.excel.loading = null; throw err; });
    return libState.excel.loading;
  }
  function loadPdfLib() {
    if (libState.pdf.loaded) return Promise.resolve();
    if (libState.pdf.loading) return libState.pdf.loading;
    libState.pdf.loading = loadScript('https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js', 'sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3')
      .then(function () { return loadScript('https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.8/dist/jspdf.plugin.autotable.min.js', 'sha384-5jk55M0XWoAw7LyhlXJe19ErOr3doBAPzxw9vahPFbvolqWa2yDk4fhHa2zuYeOa'); })
      .then(function () {
        // jsPDF-AutoTable v5's UMD build exposes a bare `applyPlugin` global rather than
        // self-attaching to jsPDF the way v3 did — wire it up once, idempotently.
        if (typeof window.applyPlugin === 'function' && window.jspdf && window.jspdf.jsPDF) window.applyPlugin(window.jspdf.jsPDF);
        libState.pdf.loaded = true;
      }).catch(function (err) { libState.pdf.loading = null; throw err; });
    return libState.pdf.loading;
  }

  function triggerDownload(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /** Loads ExcelJS, composes the workbook, and downloads it. Returns a Promise. */
  function generateExcelReport(payload) {
    return Promise.resolve().then(function () {
      var report = normalizeReportPayload(payload);
      return loadExcelLib().then(function () {
        var wb = composeWorkbook(window.ExcelJS, report);
        return wb.xlsx.writeBuffer();
      }).then(function (buf) {
        triggerDownload(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), buildReportFilename(report.title, 'xlsx', report.generatedAt));
      });
    });
  }
  /** Loads jsPDF + AutoTable, composes the report, and downloads it. Returns a Promise. */
  function generatePdfReport(payload) {
    return Promise.resolve().then(function () {
      var report = normalizeReportPayload(payload);
      return loadPdfLib().then(function () {
        var doc = composePdfDocument(window.jspdf.jsPDF, report);
        doc.save(buildReportFilename(report.title, 'pdf', report.generatedAt));
      });
    });
  }
  function generateAIDashboardPdf(payload) {
    return loadPdfLib().then(function () {
      var doc = composeAIDashboardPdf(window.jspdf.jsPDF, payload);
      doc.save(buildReportFilename(payload.title || 'Odoo dashboard', 'pdf', payload.generatedAt));
    });
  }

  return {
    BRAND: BRAND,
    // pure / testable
    composeWorkbook: composeWorkbook,
    composePdfDocument: composePdfDocument,
    composeAIDashboardPdf: composeAIDashboardPdf,
    numFmtForType: numFmtForType,
    excelValue: excelValue,
    normalizeReportPayload: normalizeReportPayload,
    buildReportFilename: buildReportFilename,
    sanitizeFilename: sanitizeFilename,
    // browser entry points
    loadExcelLib: loadExcelLib,
    loadPdfLib: loadPdfLib,
    generateExcelReport: generateExcelReport,
    generatePdfReport: generatePdfReport,
    generateAIDashboardPdf: generateAIDashboardPdf,
  };
})();

/* global module */
if (typeof window !== 'undefined') window.DVReportEngine = DVReportEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = DVReportEngine;
