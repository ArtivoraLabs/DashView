/* ==========================================================================
   ARTIVORALABS — Imported spreadsheet (Excel / CSV) panel
   --------------------------------------------------------------------------
   Lets a user import an .xlsx / .xls / .csv file (the kind of file that's
   typically exported from Excel or a Power BI report) and renders it as a
   searchable, exportable table right on the dashboard, using the exact same
   .panel / .dash-table classes as the rest of the page — so it always stays
   visually aligned with the surrounding cards, even as the dashboard is
   changed later.

   The parsed data is saved to localStorage, so it's still there after a
   reload. Parsing happens entirely in the browser (via SheetJS, loaded from
   a pinned CDN URL on first use) — no file ever leaves the browser.
   ========================================================================== */
'use strict';

(function () {
  const STORAGE_KEY = 'al_imported_sheet';
  const MAX_ROWS = 500; // keep the table (and localStorage) responsive

  const panel = qs('#importedPanel');
  const btn = qs('#importExcelBtn');
  const fileInput = qs('#importExcelInput');
  if (!panel || !btn || !fileInput) return; // this page doesn't have the import UI

  const meta = qs('#importedMeta');
  const search = qs('#importedSearch');
  const head = qs('#importedTableHead');
  const body = qs('#importedTableBody');
  const exportBtn = qs('#importedExportBtn');
  const clearBtn = qs('#importedClearBtn');

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* ── SheetJS, loaded on first import so pages that never use this
     feature never pay the download cost. Pinned version + SRI hash,
     same pattern as js/studio.js. ────────────────────────────────── */
  const XLSX_LIB = {
    url: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    integrity: 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw',
  };
  let xlsxPromise = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = XLSX_LIB.url;
      s.integrity = XLSX_LIB.integrity;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load the spreadsheet library — check your connection.'));
      document.head.appendChild(s);
    });
    return xlsxPromise;
  }

  /* ── Storage ──────────────────────────────────────────────────── */
  function loadSheet() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; }
    catch (e) { return null; }
  }
  function saveSheet(sheet) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sheet)); }
    catch (e) { showToast('Imported, but it was too large to save locally — it will not survive a reload.'); }
  }
  function clearSheet() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  }

  let currentSheet = null; // { fileName, importedAt, columns: [...], rows: [{...}] }

  /* ── Render ───────────────────────────────────────────────────── */
  function render() {
    if (!currentSheet || !currentSheet.columns.length) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';
    const when = new Date(currentSheet.importedAt);
    meta.textContent = currentSheet.rows.length + ' rows · ' + currentSheet.fileName + ' · imported ' + when.toLocaleString();

    head.innerHTML = currentSheet.columns.map((c) => '<th>' + esc(c) + '</th>').join('');

    const q = (search.value || '').trim().toLowerCase();
    const rows = q
      ? currentSheet.rows.filter((r) => currentSheet.columns.some((c) => String(r[c] == null ? '' : r[c]).toLowerCase().includes(q)))
      : currentSheet.rows;

    body.innerHTML = rows.length
      ? rows.map((r) => '<tr>' + currentSheet.columns.map((c) => '<td>' + esc(r[c] == null ? '' : r[c]) + '</td>').join('') + '</tr>').join('')
      : '<tr><td colspan="' + currentSheet.columns.length + '" class="table-empty">No rows match your search.</td></tr>';
  }

  /* ── Import ───────────────────────────────────────────────────── */
  async function handleFile(file) {
    if (!file) return;
    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Importing…';
    try {
      await loadXlsx();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const firstSheetName = wb.SheetNames[0];
      if (!firstSheetName) throw new Error('That file has no sheets.');
      const ws = wb.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!json.length) throw new Error('No rows found — check the sheet has a header row and at least one data row.');

      const columns = Object.keys(json[0]);
      const rows = json.slice(0, MAX_ROWS);
      currentSheet = {
        fileName: file.name,
        importedAt: new Date().toISOString(),
        columns,
        rows,
      };
      saveSheet(currentSheet);
      render();
      const truncated = json.length > MAX_ROWS ? (' (showing the first ' + MAX_ROWS + ' of ' + json.length + ')') : '';
      showToast('Imported ' + rows.length + ' rows from ' + file.name + truncated + '.');
      panel.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
    } catch (err) {
      showToast(err.message || 'Could not read that file — try exporting it as .xlsx or .csv.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalLabel;
    }
  }

  on(btn, 'click', () => fileInput.click());
  on(fileInput, 'change', () => {
    const file = fileInput.files && fileInput.files[0];
    handleFile(file);
    fileInput.value = ''; // allow re-importing the same file name later
  });
  on(search, 'input', render);
  on(clearBtn, 'click', () => {
    currentSheet = null;
    clearSheet();
    render();
    showToast('Imported data cleared.');
  });
  on(exportBtn, 'click', () => {
    if (!currentSheet || !currentSheet.rows.length) { showToast('Nothing to export yet.'); return; }
    const header = currentSheet.columns;
    const csv = [header].concat(currentSheet.rows.map((r) => header.map((c) => r[c])))
      .map((r) => r.map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (currentSheet.fileName || 'imported').replace(/\.[^.]+$/, '') + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  /* ── Restore on load ──────────────────────────────────────────── */
  currentSheet = loadSheet();
  render();
})();
