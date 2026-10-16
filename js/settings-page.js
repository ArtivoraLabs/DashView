/* settings-page.js — Settings page detailing (v2.23). Additive and defensive: every block checks that the
   element it needs exists, so the page works exactly as before if any part is missing.
   search + "/" shortcut, gliding section indicator, per-row Saved chip, swatch labels,
   storage meter, platform-aware keycaps, section flash, scroll entrance. */
(function () {
  'use strict';
  var d = document, de = d.documentElement;
  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || d).querySelectorAll(s)); }
  function reduced() { return de.hasAttribute('data-reduce-motion') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

  function init() {
    var main = $('main'), bar = $('.bar'), side = $('.side'), sections = $$('.wrap section[id]');

    /* top bar gains depth once scrolled */
    if (bar) {
      var t = false;
      addEventListener('scroll', function () {
        if (t) return; t = true;
        requestAnimationFrame(function () { t = false; bar.classList.toggle('sp-stuck', (window.pageYOffset || de.scrollTop) > 6); });
      }, { passive: true });
    }

    /* ── search ── */
    if (main && !$('#setFind')) {
      var wrap = d.createElement('div'); wrap.className = 'sp-find'; wrap.setAttribute('role', 'search');
      wrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
        '<input id="setFind" type="search" placeholder="Search settings" autocomplete="off" spellcheck="false" aria-label="Search settings">' +
        '<kbd aria-hidden="true">/</kbd><button type="button" class="sp-clear" aria-label="Clear search" tabindex="-1">✕</button>';
      main.insertBefore(wrap, main.firstChild);
      var empty = d.createElement('div'); empty.className = 'sp-empty'; empty.hidden = true; empty.setAttribute('role', 'status');
      empty.innerHTML = '<b>No settings found</b><span></span>';
      main.insertBefore(empty, wrap.nextSibling);
      var inp = $('#setFind'), clr = $('.sp-clear', wrap), raf = 0;

      var index = sections.map(function (s) {
        var title = ($('h2', s) || {}).textContent || '';
        return { s: s, title: title.toLowerCase(), rows: $$('.row', s).map(function (r) { return { r: r, text: r.textContent.toLowerCase().replace(/\s+/g, ' ') }; }), intro: ($('.section-intro', s) || {}).textContent || '' };
      });
      function unmark() { $$('mark.sp-hit').forEach(function (m) { var p = m.parentNode; p.replaceChild(d.createTextNode(m.textContent), m); p.normalize(); }); }
      function mark(row, q) {
        $$('.txt b, .txt span', row).forEach(function (el) {
          if (el.children.length) return;
          var i = el.textContent.toLowerCase().indexOf(q); if (i < 0) return;
          var tx = el.textContent, m = d.createElement('mark'); m.className = 'sp-hit'; m.textContent = tx.substr(i, q.length);
          el.textContent = ''; el.appendChild(d.createTextNode(tx.slice(0, i))); el.appendChild(m); el.appendChild(d.createTextNode(tx.slice(i + q.length)));
        });
      }
      function run() {
        raf = 0;
        var q = inp.value.trim().toLowerCase(), any = false;
        unmark();
        index.forEach(function (e) {
          var titleHit = q && e.title.indexOf(q) >= 0, n = 0;
          e.rows.forEach(function (x) {
            var hit = !q || titleHit || x.text.indexOf(q) >= 0;
            x.r.classList.toggle('nomatch', !hit);
            if (hit) { n++; if (q && !titleHit) mark(x.r, q); }
          });
          var show = !q || titleHit || n > 0;
          e.s.classList.toggle('nomatch', !show);
          var a = side && $('a[href="#' + e.s.id + '"]', side); if (a) a.classList.toggle('hide', !show);
          if (show) any = true;
        });
        empty.hidden = any || !q;
        if (!any && q) $('span', empty).textContent = 'Nothing matches “' + inp.value.trim() + '”. Try a shorter word, like theme, export or cursor.';
        setTimeout(placeInd, 30);
      }
      inp.addEventListener('input', function () { if (!raf) raf = requestAnimationFrame(run); });
      clr.addEventListener('click', function () { inp.value = ''; run(); inp.focus(); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (inp.value) { inp.value = ''; run(); } else inp.blur(); } });
      d.addEventListener('keydown', function (e) {
        if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
        var tg = e.target, tag = tg && tg.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (tg && tg.isContentEditable)) return;
        e.preventDefault(); inp.focus(); inp.select();
        try { window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); } catch (x) {}
      });
    }

    /* ── gliding sidebar indicator + keep the active chip visible on phones ── */
    var ind = null;
    function placeInd() {
      if (!ind || !side) return;
      var a = $('a.on', side);
      if (!a || a.classList.contains('hide') || matchMedia('(max-width:760px)').matches) { if (side.classList.contains('has-ind')) side.classList.remove('has-ind'); return; }
      var sr = side.getBoundingClientRect(), r = a.getBoundingClientRect();
      ind.style.height = (r.height - 14) + 'px';
      ind.style.transform = 'translateY(' + (r.top - sr.top + 7) + 'px)';
      if (!side.classList.contains('has-ind')) side.classList.add('has-ind');
    }
    if (side) {
      ind = d.createElement('i'); ind.className = 'sp-ind'; ind.setAttribute('aria-hidden', 'true'); side.appendChild(ind);
      var lastOn = null;
      new MutationObserver(function () {
        var a = $('a.on', side);
        if (a === lastOn) return; lastOn = a;
        placeInd();
        if (a && matchMedia('(max-width:760px)').matches && a.scrollIntoView) { try { a.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced() ? 'auto' : 'smooth' }); } catch (x) {} }
      }).observe(side, { subtree: true, attributes: true, attributeFilter: ['class'] });
      addEventListener('resize', placeInd, { passive: true });
      setTimeout(placeInd, 400);
    }

    /* ── smooth section jumps with a brief ring on the card you land on ── */
    function flash(id) {
      var s = id && d.getElementById(id); if (!s || !s.classList) return;
      s.classList.remove('sp-flash'); void s.offsetWidth; s.classList.add('sp-flash');
      setTimeout(function () { s.classList.remove('sp-flash'); }, 1400);
    }
    d.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]'); if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey) return;
      var id = a.getAttribute('href').slice(1), s = id && d.getElementById(id); if (!s) return;
      e.preventDefault();
      var y = s.getBoundingClientRect().top + (window.pageYOffset || de.scrollTop) - 92;
      try { window.scrollTo({ top: y, behavior: reduced() ? 'auto' : 'smooth' }); } catch (x) { window.scrollTo(0, y); }
      try { history.replaceState(null, '', '#' + id); } catch (x) {}
      setTimeout(function () { flash(id); }, reduced() ? 0 : 350);
    });
    if (location.hash.length > 1) setTimeout(function () { flash(location.hash.slice(1)); }, 500);

    /* ── a small "Saved" chip next to the control you just changed ── */
    d.addEventListener('change', function (e) {
      var row = e.target.closest && e.target.closest('.row'); if (!row || row.closest('.sp-find')) return;
      if (e.target.type && e.target.type !== 'radio' && e.target.type !== 'checkbox') return;
      var chip = $('.sp-saved', row);
      if (!chip) { chip = d.createElement('span'); chip.className = 'sp-saved'; chip.setAttribute('aria-hidden', 'true'); chip.innerHTML = CHECK + 'Saved'; row.appendChild(chip); }
      chip.classList.remove('on'); void chip.offsetWidth; chip.classList.add('on');
    });

    /* ── accent swatches: hover / long-press label ── */
    $$('.sw').forEach(function (l) { var n = $('.vh', l); if (n && !l.title) l.title = n.textContent; });

    /* ── platform-aware keycaps ── */
    if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
      $$('#shortcuts kbd').forEach(function (k) {
        var m = { Ctrl: '⌘', Shift: '⇧', Alt: '⌥' }[k.textContent.trim()]; if (m) k.textContent = m;
      });
    }
    var keymap = { Control: 'Ctrl', Meta: 'Ctrl', Shift: 'Shift', Escape: 'Esc' };
    addEventListener('keydown', function (e) {
      var nm = keymap[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);
      $$('#shortcuts kbd').forEach(function (k) {
        var tx = k.textContent.trim(), ok = tx === nm || (tx === '⌘' && e.key === 'Meta') || (tx === '⇧' && e.key === 'Shift');
        if (ok) { k.classList.add('sp-pressed'); }
      });
    });
    addEventListener('keyup', function () { $$('kbd.sp-pressed').forEach(function (k) { k.classList.remove('sp-pressed'); }); });
    addEventListener('blur', function () { $$('kbd.sp-pressed').forEach(function (k) { k.classList.remove('sp-pressed'); }); });

    /* ── storage meter under "Stored on this device" ── */
    var pu = $('#privUsage');
    if (pu && navigator.storage && navigator.storage.estimate && !$('.sp-meter')) {
      var meter = d.createElement('div'); meter.className = 'sp-meter'; meter.setAttribute('role', 'img'); meter.innerHTML = '<i></i>';
      var note = d.createElement('div'); note.className = 'sp-meter-note';
      pu.parentNode.appendChild(meter); pu.parentNode.appendChild(note);
      var upd = function () {
        navigator.storage.estimate().then(function (r) {
          if (!r || !r.quota) return;
          var p = Math.min(1, r.usage / r.quota);
          meter.firstChild.style.setProperty('--p', Math.max(p, .015).toFixed(3));
          var mb = function (b) { return b > 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.max(0.1, b / 1048576).toFixed(1) + ' MB'; };
          note.textContent = mb(r.usage) + ' of about ' + mb(r.quota) + ' available to DashView in this browser';
          meter.setAttribute('aria-label', note.textContent);
        }).catch(function () {});
      };
      new MutationObserver(function () { setTimeout(upd, 60); }).observe(pu, { childList: true, characterData: true, subtree: true });
      upd();
    }

    /* ── cards below the fold glide in as you reach them ── */
    if (!reduced() && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) {
        en.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } });
      }, { rootMargin: '0px 0px -8% 0px', threshold: .06 });
      sections.forEach(function (s) {
        if (s.getBoundingClientRect().top < innerHeight) return;   // already on screen: never hide it
        var c = $('.card', s); if (!c) return;
        c.classList.add('sp-rv'); io.observe(c);
      });
      // a deep link or search must never leave a card invisible
      addEventListener('hashchange', function () { $$('.sp-rv').forEach(function (c) { c.classList.add('in'); }); });
      var inp2 = $('#setFind'); if (inp2) inp2.addEventListener('input', function () { $$('.sp-rv').forEach(function (c) { c.classList.add('in'); }); });
      setTimeout(function () { if (location.hash) $$('.sp-rv').forEach(function (c) { c.classList.add('in'); }); }, 0);
    }
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init); else init();
})();
