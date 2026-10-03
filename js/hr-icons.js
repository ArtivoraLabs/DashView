/* ==========================================================================
   DashView People — icon registry
   Inline SVG paths kept in one place so markup stays readable and every icon
   inherits currentColor / sizing from its container.
   ========================================================================== */
(function (global) {
  'use strict';

  var P = {
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    bolt:    '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    chat:    '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>',
    pen:     '<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    link:    '<path d="M10 13a5 5 0 0 0 7.5.5l3-3A5 5 0 0 0 13.5 3.5L11.7 5.3"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3A5 5 0 0 0 10.5 20.5l1.8-1.8"/>',
    card:    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    shield:  '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    box:     '<path d="m21 8-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',

    users:   '<path d="M17 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    userAdd: '<path d="M15 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    folder:  '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',

    chevron: '<path d="m6 9 6 6 6-6"/>',
    check:   '<path d="m20 6-11 11-5-5"/>',
    dots:    '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
    plus:    '<path d="M12 5v14M5 12h14"/>',
    search:  '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    trash:   '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    download:'<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
    laptop:  '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 20h20"/>',
    grid:    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    list:    '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    star:    '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    wallet:  '<path d="M3 7a2 2 0 0 1 2-2h12v4"/><rect x="3" y="7" width="18" height="12" rx="2"/><circle cx="16.5" cy="13" r="1.2"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock:   '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };

  function svg(name, opts) {
    opts = opts || {};
    var body = P[name] || P.box;
    var fill = opts.fill || 'none';
    var stroke = opts.stroke || 'currentColor';
    var w = opts.width == null ? 1.7 : opts.width;
    return '<svg viewBox="0 0 24 24" fill="' + fill + '" stroke="' + stroke +
      '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body + '</svg>';
  }

  global.HRIcon = { svg: svg, has: function (n) { return !!P[n]; } };
})(window);
