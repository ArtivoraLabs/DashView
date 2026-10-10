/* DashView 8K quality: render Chart.js canvases at >= 2x device pixels so charts stay
   sharp on 4K / 8K screens (and when a hi-DPI page is zoomed). Capped at 4x for memory. */
(function () {
  var tries = 0, t;
  function apply() {
    var C = window.Chart;
    if (!C || !C.defaults) return false;
    C.defaults.devicePixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 2), 4);
    return true;
  }
  if (apply()) return;
  t = setInterval(function () { if (apply() || ++tries > 100) clearInterval(t); }, 100);
})();
