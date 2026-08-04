/* ============================================================
   NeuralKinetics — AI Studio
   Image Generator · Code Debugger · Report Studio
   All three run fully client-side. No backend, no API key.
   ============================================================ */
'use strict';

(function () {

  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
  function on(el, evt, fn) { if (el) el.addEventListener(evt, fn); }
  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function showToast(message) {
    if (typeof window.__nkToast === 'function') { window.__nkToast(message); return; }
    const stack = qs('#toastStack');
    if (!stack) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('leaving');
      setTimeout(() => toast.remove(), 320);
    }, 3200);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ============================================================
     Tiny deterministic PRNG — same prompt+style+seed always
     reproduces the same artwork. mulberry32.
  ============================================================ */
  function hashString(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seededRandom(promptText, styleKey, salt) {
    const seeder = hashString((promptText || 'nk') + '::' + styleKey + '::' + (salt || 0));
    return mulberry32(seeder());
  }

  /* ============================================================
     IMAGE GENERATOR
  ============================================================ */
  const PALETTES = [
    { name: 'Mono', colors: ['#ffffff', '#9ca3af', '#4b5563', '#111111'] },
    { name: 'Aurora', colors: ['#60a5fa', '#34d399', '#a78bfa', '#0ea5e9'] },
    { name: 'Sunset', colors: ['#fb7185', '#fbbf24', '#f472b6', '#f97316'] },
    { name: 'Forest', colors: ['#4ade80', '#22c55e', '#16a34a', '#84cc16'] },
    { name: 'Ember', colors: ['#f87171', '#fb923c', '#facc15', '#ef4444'] },
    { name: 'Ocean', colors: ['#22d3ee', '#0ea5e9', '#6366f1', '#38bdf8'] },
  ];
  let selectedPaletteIdx = 1;
  let studioImageSalt = 0;
  let currentSvgString = '';
  const galleryItems = []; // { svg, prompt }

  function initPaletteSwatches() {
    const wrap = qs('#studioPaletteSwatches');
    if (!wrap) return;
    wrap.innerHTML = PALETTES.map((p, i) =>
      '<span class="studio-swatch' + (i === selectedPaletteIdx ? ' selected' : '') + '" ' +
      'data-palette-idx="' + i + '" title="' + esc(p.name) + '" ' +
      'style="background:linear-gradient(135deg,' + p.colors.join(',') + ');"></span>'
    ).join('');
    qsa('.studio-swatch', wrap).forEach((sw) => {
      on(sw, 'click', () => {
        selectedPaletteIdx = parseInt(sw.getAttribute('data-palette-idx'), 10);
        qsa('.studio-swatch', wrap).forEach((s) => s.classList.remove('selected'));
        sw.classList.add('selected');
      });
    });
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function buildSvgGradientWaves(rand, colors, w, h) {
    const layers = 4 + Math.floor(rand() * 3);
    let paths = '';
    for (let i = 0; i < layers; i++) {
      const baseY = lerp(h * 0.15, h * 0.9, i / layers) + (rand() - 0.5) * h * 0.08;
      const amp = h * (0.04 + rand() * 0.08);
      const freq = 0.6 + rand() * 1.6;
      const phase = rand() * Math.PI * 2;
      let d = 'M 0 ' + (baseY + h) + ' ';
      const steps = 24;
      for (let s = 0; s <= steps; s++) {
        const x = (w / steps) * s;
        const y = baseY + Math.sin((s / steps) * Math.PI * 2 * freq + phase) * amp;
        d += 'L ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
      }
      d += 'L ' + w + ' ' + (baseY + h) + ' Z';
      const color = colors[i % colors.length];
      paths += '<path d="' + d + '" fill="' + color + '" opacity="' + (0.16 + rand() * 0.22).toFixed(2) + '"/>';
    }
    return paths;
  }

  function buildSvgGeometric(rand, colors, w, h) {
    const count = 10 + Math.floor(rand() * 10);
    let shapes = '';
    for (let i = 0; i < count; i++) {
      const cx = rand() * w, cy = rand() * h;
      const size = 16 + rand() * (w * 0.16);
      const color = colors[i % colors.length];
      const rot = (rand() * 360).toFixed(1);
      const opacity = (0.15 + rand() * 0.5).toFixed(2);
      const kind = Math.floor(rand() * 3);
      if (kind === 0) {
        shapes += '<rect x="' + (cx - size / 2).toFixed(1) + '" y="' + (cy - size / 2).toFixed(1) + '" width="' + size.toFixed(1) + '" height="' + size.toFixed(1) + '" fill="none" stroke="' + color + '" stroke-width="1.5" opacity="' + opacity + '" transform="rotate(' + rot + ' ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ')"/>';
      } else if (kind === 1) {
        shapes += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (size / 2).toFixed(1) + '" fill="' + color + '" opacity="' + (opacity * 0.6).toFixed(2) + '"/>';
      } else {
        const x2 = cx + size, y2 = cy + size * 0.4;
        shapes += '<line x1="' + cx.toFixed(1) + '" y1="' + cy.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="' + color + '" stroke-width="1.5" opacity="' + opacity + '"/>';
      }
    }
    return shapes;
  }

  function buildSvgParticles(rand, colors, w, h) {
    const count = 60 + Math.floor(rand() * 120);
    let dots = '';
    for (let i = 0; i < count; i++) {
      const cx = rand() * w, cy = rand() * h;
      const r = 0.8 + rand() * 3.2;
      const color = colors[i % colors.length];
      dots += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + color + '" opacity="' + (0.25 + rand() * 0.55).toFixed(2) + '"/>';
    }
    // connective lines between some near points for a "network" feel
    let lines = '';
    for (let i = 0; i < 26; i++) {
      const x1 = rand() * w, y1 = rand() * h;
      const x2 = x1 + (rand() - 0.5) * w * 0.3;
      const y2 = y1 + (rand() - 0.5) * h * 0.3;
      lines += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="' + colors[i % colors.length] + '" stroke-width="0.6" opacity="0.18"/>';
    }
    return lines + dots;
  }

  function buildSvgLines(rand, colors, w, h) {
    const count = 14 + Math.floor(rand() * 14);
    let out = '';
    for (let i = 0; i < count; i++) {
      const y0 = (h / count) * i + rand() * 8;
      let d = 'M 0 ' + y0.toFixed(1) + ' ';
      const steps = 10;
      for (let s = 1; s <= steps; s++) {
        const x = (w / steps) * s;
        const y = y0 + Math.sin(s * (0.6 + rand())) * (6 + rand() * 26);
        d += 'L ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' ';
      }
      out += '<path d="' + d + '" fill="none" stroke="' + colors[i % colors.length] + '" stroke-width="1" opacity="' + (0.25 + rand() * 0.4).toFixed(2) + '"/>';
    }
    return out;
  }

  function buildSvgBlobs(rand, colors, w, h) {
    const count = 5 + Math.floor(rand() * 4);
    let out = '';
    for (let i = 0; i < count; i++) {
      const cx = rand() * w, cy = rand() * h;
      const baseR = 40 + rand() * (Math.min(w, h) * 0.22);
      const points = 8;
      let d = '';
      const pts = [];
      for (let p = 0; p < points; p++) {
        const angle = (p / points) * Math.PI * 2;
        const r = baseR * (0.7 + rand() * 0.6);
        pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
      }
      d = 'M ' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1) + ' ';
      for (let p = 0; p < points; p++) {
        const cur = pts[p], next = pts[(p + 1) % points];
        const midX = (cur[0] + next[0]) / 2, midY = (cur[1] + next[1]) / 2;
        d += 'Q ' + cur[0].toFixed(1) + ' ' + cur[1].toFixed(1) + ' ' + midX.toFixed(1) + ' ' + midY.toFixed(1) + ' ';
      }
      d += 'Z';
      out += '<path d="' + d + '" fill="' + colors[i % colors.length] + '" opacity="' + (0.14 + rand() * 0.22).toFixed(2) + '"/>';
    }
    return out;
  }

  function generateArtwork(promptText, styleKey, palette) {
    const w = 700, h = 500;
    const rand = seededRandom(promptText, styleKey, studioImageSalt);
    const colors = palette.colors;
    let bgId = 'nkbg' + Math.floor(rand() * 100000);
    let content = '';
    if (styleKey === 'gradient') content = buildSvgGradientWaves(rand, colors, w, h);
    else if (styleKey === 'geometric') content = buildSvgGeometric(rand, colors, w, h);
    else if (styleKey === 'particles') content = buildSvgParticles(rand, colors, w, h);
    else if (styleKey === 'lines') content = buildSvgLines(rand, colors, w, h);
    else content = buildSvgBlobs(rand, colors, w, h);

    const bg1 = colors[0], bg2 = colors[colors.length - 1];
    const svg =
      '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><radialGradient id="' + bgId + '" cx="30%" cy="20%" r="90%">' +
      '<stop offset="0%" stop-color="' + bg1 + '" stop-opacity="0.22"/>' +
      '<stop offset="100%" stop-color="#050505" stop-opacity="1"/>' +
      '</radialGradient></defs>' +
      '<rect width="' + w + '" height="' + h + '" fill="#050505"/>' +
      '<rect width="' + w + '" height="' + h + '" fill="url(#' + bgId + ')"/>' +
      content +
      '</svg>';
    return svg;
  }

  function renderGalleryThumb(svg) {
    return '<div class="studio-gallery-thumb">' + svg + '</div>';
  }

  function refreshGallery() {
    const wrap = qs('#studioGallery');
    if (!wrap) return;
    wrap.innerHTML = galleryItems.slice(0, 6).map((it) => renderGalleryThumb(it.svg)).join('');
    qsa('.studio-gallery-thumb', wrap).forEach((el, i) => {
      on(el, 'click', () => setActiveArtwork(galleryItems[i].svg));
    });
  }

  function setActiveArtwork(svg) {
    currentSvgString = svg;
    const wrap = qs('#studioCanvasWrap');
    if (wrap) wrap.innerHTML = svg;
    const pngBtn = qs('#studioDownloadPng');
    const svgBtn = qs('#studioDownloadSvg');
    if (pngBtn) pngBtn.disabled = false;
    if (svgBtn) svgBtn.disabled = false;
  }

  function initImageGenerator() {
    initPaletteSwatches();
    const genBtn = qs('#studioGenerateImageBtn');
    const promptInput = qs('#studioImagePrompt');
    const styleSelect = qs('#studioImageStyle');

    on(genBtn, 'click', () => {
      const promptText = (promptInput && promptInput.value.trim()) || 'neural kinetics';
      const styleKey = styleSelect ? styleSelect.value : 'gradient';
      studioImageSalt += 1; // each click gives a fresh variation of the same prompt
      const palette = PALETTES[selectedPaletteIdx];
      const svg = generateArtwork(promptText, styleKey, palette);
      setActiveArtwork(svg);
      galleryItems.unshift({ svg, prompt: promptText });
      if (galleryItems.length > 12) galleryItems.length = 12;
      refreshGallery();
    });

    on(promptInput, 'keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); genBtn.click(); }
    });

    on(qs('#studioDownloadSvg'), 'click', () => {
      if (!currentSvgString) return;
      const blob = new Blob([currentSvgString], { type: 'image/svg+xml' });
      triggerDownload(blob, 'neuralkinetics-image.svg');
    });

    on(qs('#studioDownloadPng'), 'click', () => {
      if (!currentSvgString) return;
      const svgBlob = new Blob([currentSvgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1400; canvas.height = 1000;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (blob) triggerDownload(blob, 'neuralkinetics-image.png');
        }, 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); showToast('Could not rasterize image — try SVG download instead.'); };
      img.src = url;
    });
  }

  /* ============================================================
     CODE DEBUGGER — real syntax checking + static heuristics
  ============================================================ */
  function findLineOf(code, index) {
    return code.slice(0, index).split('\n').length;
  }

  function analyzeJavaScript(code) {
    const findings = [];
    try {
      // eslint-disable-next-line no-new-func
      new Function(code);
      findings.push({ level: 'success', text: 'No syntax errors — the code parses cleanly.' });
    } catch (err) {
      findings.push({ level: 'error', text: 'Syntax error: <code>' + esc(err.message) + '</code>' });
    }
    // Bracket / paren / brace balance with line tracking
    const pairs = { '(': ')', '[': ']', '{': '}' };
    const closers = { ')': '(', ']': '[', '}': '{' };
    const stack = [];
    let inStr = null, inLineComment = false, inBlockComment = false;
    for (let i = 0; i < code.length; i++) {
      const c = code[i], prev = code[i - 1];
      if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
      if (inBlockComment) { if (prev === '*' && c === '/') inBlockComment = false; continue; }
      if (inStr) { if (c === inStr && prev !== '\\') inStr = null; continue; }
      if (c === '/' && code[i + 1] === '/') { inLineComment = true; continue; }
      if (c === '/' && code[i + 1] === '*') { inBlockComment = true; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
      if (pairs[c]) stack.push({ c, i });
      else if (closers[c]) {
        if (!stack.length || stack[stack.length - 1].c !== closers[c]) {
          findings.push({ level: 'error', text: 'Unmatched <code>' + esc(c) + '</code> — no matching opener.', line: findLineOf(code, i) });
          stack.length = 0;
        } else stack.pop();
      }
    }
    stack.forEach((s) => {
      findings.push({ level: 'error', text: 'Unclosed <code>' + esc(s.c) + '</code> — never closed.', line: findLineOf(code, s.i) });
    });

    if (/==[^=]/.test(code.replace(/={3}/g, ''))) {
      findings.push({ level: 'warning', text: 'Uses <code>==</code> — consider <code>===</code> to avoid type-coercion surprises.' });
    }
    if (/\bvar\s+/.test(code)) {
      findings.push({ level: 'info', text: 'Uses <code>var</code> — <code>let</code>/<code>const</code> give clearer block scoping.' });
    }
    if (/console\.log/.test(code)) {
      findings.push({ level: 'info', text: 'Contains <code>console.log</code> — remember to strip debug logging before shipping.' });
    }
    const longLines = code.split('\n').filter((l) => l.length > 120).length;
    if (longLines) findings.push({ level: 'info', text: longLines + ' line(s) over 120 characters — consider wrapping for readability.' });
    if (/debugger;?/.test(code)) findings.push({ level: 'warning', text: 'Contains a <code>debugger</code> statement.' });
    return findings;
  }

  function analyzeJson(code) {
    const findings = [];
    try {
      JSON.parse(code);
      findings.push({ level: 'success', text: 'Valid JSON — parses without errors.' });
    } catch (err) {
      findings.push({ level: 'error', text: 'JSON parse error: <code>' + esc(err.message) + '</code>' });
    }
    if (/,\s*[}\]]/.test(code)) {
      findings.push({ level: 'warning', text: 'Possible trailing comma before a closing bracket — invalid in strict JSON.' });
    }
    return findings;
  }

  function analyzeHtml(code) {
    const findings = [];
    try {
      const doc = new DOMParser().parseFromString(code, 'text/html');
      const err = doc.querySelector('parsererror');
      if (err) findings.push({ level: 'error', text: 'Parser error while reading the markup.' });
      else findings.push({ level: 'success', text: 'Markup parsed without a fatal error.' });
    } catch (e) {
      findings.push({ level: 'error', text: 'Could not parse HTML: <code>' + esc(e.message) + '</code>' });
    }
    const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
    const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)[^>]*?(\/?)>/g;
    const openStack = [];
    let m;
    while ((m = tagRe.exec(code))) {
      const tag = m[1].toLowerCase();
      const selfClose = m[2] === '/' || voidTags.has(tag);
      const isClosing = m[0][1] === '/';
      if (selfClose && !isClosing) continue;
      if (!isClosing) openStack.push(tag);
      else {
        const idx = openStack.lastIndexOf(tag);
        if (idx === -1) {
          findings.push({ level: 'warning', text: 'Closing tag <code>&lt;/' + esc(tag) + '&gt;</code> has no matching opener.' });
        } else {
          openStack.length = idx;
        }
      }
    }
    if (openStack.length) {
      findings.push({ level: 'warning', text: 'Unclosed tag(s): ' + openStack.map((t) => '<code>&lt;' + esc(t) + '&gt;</code>').join(', ') });
    }
    if (!/<!doctype html>/i.test(code) && code.length > 40) {
      findings.push({ level: 'info', text: 'No <code>&lt;!DOCTYPE html&gt;</code> found — browsers may render in quirks mode.' });
    }
    return findings;
  }

  function analyzePython(code) {
    const findings = [];
    const lines = code.split('\n');
    let usesTabs = false, usesSpaces = false;
    const stack = { '(': 0, '[': 0, '{': 0 };
    const openers = { ')': '(', ']': '[', '}': '{' };
    lines.forEach((line, idx) => {
      const n = idx + 1;
      const indentMatch = line.match(/^[\t ]+/);
      if (indentMatch) {
        if (indentMatch[0].includes('\t')) usesTabs = true;
        if (indentMatch[0].includes(' ')) usesSpaces = true;
      }
      const trimmed = line.trim();
      if (/^(if|elif|else|for|while|def|class|try|except|finally|with)\b.*[^:#]\s*$/.test(trimmed) && trimmed.length && !trimmed.endsWith(':') && !trimmed.endsWith('\\')) {
        findings.push({ level: 'warning', text: 'Block statement may be missing a trailing <code>:</code>', line: n });
      }
      if (/\bprint\s+[^(]/.test(trimmed) && !/print\s*\(/.test(trimmed)) {
        findings.push({ level: 'warning', text: '<code>print</code> used without parentheses — Python 2 style.', line: n });
      }
      for (const ch of line) {
        if (stack[ch] !== undefined) stack[ch]++;
        if (openers[ch]) stack[openers[ch]]--;
      }
    });
    if (usesTabs && usesSpaces) {
      findings.push({ level: 'error', text: 'Mixed tabs and spaces for indentation — Python will raise a <code>TabError</code>.' });
    }
    Object.keys(stack).forEach((open) => {
      if (stack[open] > 0) findings.push({ level: 'error', text: 'Unclosed <code>' + esc(open) + '</code> somewhere in the file.' });
      else if (stack[open] < 0) findings.push({ level: 'error', text: 'Extra closing bracket without a matching <code>' + esc(open) + '</code>.' });
    });
    if (!findings.some((f) => f.level === 'error')) {
      findings.push({ level: 'success', text: 'No structural issues found by static checks (bracket balance, indentation, block colons).' });
    }
    findings.push({ level: 'info', text: "Python can't be fully parsed in-browser — this is a structural heuristic pass, not a real interpreter." });
    return findings;
  }

  const LEVEL_ICON = {
    error: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    warning: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
    info: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 16v-4M12 8h.01"/><circle cx="12" cy="12" r="9"/></svg>',
    success: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>',
  };

  function scoreFromFindings(findings) {
    let score = 100;
    findings.forEach((f) => {
      if (f.level === 'error') score -= 22;
      else if (f.level === 'warning') score -= 8;
      else if (f.level === 'info') score -= 2;
    });
    return Math.max(0, Math.min(100, score));
  }

  function renderDebugResults(findings) {
    const wrap = qs('#studioDebugResults');
    if (!wrap) return;
    const score = scoreFromFindings(findings);
    const color = score >= 80 ? '#4ade80' : score >= 50 ? '#fbbf24' : '#f87171';
    let html = '<div class="studio-debug-score-row">' +
      '<div><p class="studio-debug-score" style="color:' + color + ';">' + score + '</p><p class="studio-debug-score-label">Code Health Score</p></div>' +
      '<div style="flex:1;font-size:var(--text-sm);color:rgba(255,255,255,0.5);">' +
      findings.filter((f) => f.level === 'error').length + ' error(s) · ' +
      findings.filter((f) => f.level === 'warning').length + ' warning(s) · ' +
      findings.filter((f) => f.level === 'info' || f.level === 'success').length + ' note(s)</div></div>';
    html += findings.map((f) =>
      '<div class="studio-finding">' +
      '<span class="studio-finding-icon ' + f.level + '">' + LEVEL_ICON[f.level] + '</span>' +
      '<span class="studio-finding-text">' + f.text + (f.line ? ' <span class="studio-finding-line">— line ' + f.line + '</span>' : '') + '</span>' +
      '</div>'
    ).join('');
    wrap.innerHTML = html;
  }

  function initCodeDebugger() {
    const btn = qs('#studioAnalyzeBtn');
    on(btn, 'click', () => {
      const code = (qs('#studioDebugInput') || {}).value || '';
      const lang = (qs('#studioDebugLang') || {}).value || 'javascript';
      if (!code.trim()) {
        renderDebugResults([{ level: 'info', text: 'Paste some code above, then run analysis.' }]);
        return;
      }
      let findings;
      if (lang === 'json') findings = analyzeJson(code);
      else if (lang === 'html') findings = analyzeHtml(code);
      else if (lang === 'python') findings = analyzePython(code);
      else findings = analyzeJavaScript(code);
      renderDebugResults(findings);
    });
  }

  /* ============================================================
     REPORT STUDIO — real .docx / .pptx / .xlsx generation
  ============================================================ */
  const CDN_URLS = {
    docx: {
      url: 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js',
      integrity: 'sha384-4xaIisuLEy2lo2HkB2C4rEf7v8jbTb2kuogX6TkuEt9feTWKBSFSOzsqNNbV+sKh',
    },
    pptx: {
      url: 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
      integrity: 'sha384-Cck14aA9cifjYolcnjebXRfWGkz5ltHMBiG4px/j8GS+xQcb7OhNQWZYyWjQ+UwQ',
    },
    xlsx: {
      url: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
      integrity: 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw',
    },
  };
  const loadedLibs = {};
  function loadScript(lib) {
    const url = lib.url;
    if (loadedLibs[url]) return loadedLibs[url];
    loadedLibs[url] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      if (lib.integrity) {
        s.integrity = lib.integrity;
        s.crossOrigin = 'anonymous';
      }
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ' + url));
      document.head.appendChild(s);
    });
    return loadedLibs[url];
  }

  function parseCsv(text) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.map((l) => l.split(',').map((c) => c.trim()));
  }

  function getReportFormData() {
    const title = (qs('#studioReportTitle') || {}).value || 'Untitled Report';
    const author = (qs('#studioReportAuthor') || {}).value || 'NeuralKinetics User';
    const summary = (qs('#studioReportSummary') || {}).value || '';
    const pointsRaw = (qs('#studioReportPoints') || {}).value || '';
    const points = pointsRaw.split('\n').map((l) => l.trim()).filter(Boolean);
    const tableRaw = (qs('#studioReportTable') || {}).value || '';
    let table = tableRaw.trim() ? parseCsv(tableRaw) : [
      ['Quarter', 'Revenue', 'Users'],
      ['Q1', '120000', '4200'],
      ['Q2', '148000', '5100'],
      ['Q3', '183000', '6400'],
    ];
    return { title, author, summary, points, table };
  }

  function setExportStatus(msg) {
    const el = qs('#studioExportStatus');
    if (el) el.textContent = msg;
  }

  async function exportDocx() {
    const btn = qs('#studioExportDocx');
    btn.disabled = true;
    setExportStatus('Loading document engine…');
    try {
      await loadScript(CDN_URLS.docx);
      const { title, author, summary, points, table } = getReportFormData();
      const docx = window.docx;
      const children = [
        new docx.Paragraph({ text: title, heading: docx.HeadingLevel.TITLE }),
        new docx.Paragraph({ text: 'Prepared by ' + author + ' · ' + new Date().toLocaleDateString(), spacing: { after: 300 } }),
      ];
      if (summary) {
        children.push(new docx.Paragraph({ text: 'Executive Summary', heading: docx.HeadingLevel.HEADING_1 }));
        children.push(new docx.Paragraph({ text: summary, spacing: { after: 200 } }));
      }
      if (points.length) {
        children.push(new docx.Paragraph({ text: 'Key Points', heading: docx.HeadingLevel.HEADING_1 }));
        points.forEach((p) => children.push(new docx.Paragraph({ text: p, bullet: { level: 0 } })));
      }
      if (table.length > 1) {
        children.push(new docx.Paragraph({ text: 'Data', heading: docx.HeadingLevel.HEADING_1, spacing: { before: 300 } }));
        const rows = table.map((r, ri) => new docx.TableRow({
          children: r.map((cell) => new docx.TableCell({
            children: [new docx.Paragraph({ text: String(cell), bold: ri === 0 })],
            shading: ri === 0 ? { fill: 'E5E5E5' } : undefined,
          })),
        }));
        children.push(new docx.Table({ rows, width: { size: 100, type: docx.WidthType.PERCENTAGE } }));
      }
      const doc = new docx.Document({ sections: [{ children }] });
      const blob = await docx.Packer.toBlob(doc);
      triggerDownload(blob, (title || 'report').replace(/[^a-z0-9\-_]+/gi, '_') + '.docx');
      showToast('Word report downloaded');
    } catch (err) {
      showToast('Could not generate the Word document — check your connection.');
    } finally {
      btn.disabled = false;
      setExportStatus('Files are generated entirely in your browser and download immediately — nothing is uploaded anywhere.');
    }
  }

  async function exportPptx() {
    const btn = qs('#studioExportPptx');
    btn.disabled = true;
    setExportStatus('Loading presentation engine…');
    try {
      await loadScript(CDN_URLS.pptx);
      const { title, author, summary, points, table } = getReportFormData();
      const PptxGenJS = window.PptxGenJS;
      const pptx = new PptxGenJS();
      pptx.defineLayout({ name: 'NK', width: 10, height: 5.63 });
      pptx.layout = 'NK';

      const titleSlide = pptx.addSlide();
      titleSlide.background = { color: '0A0A0A' };
      titleSlide.addText(title, { x: 0.6, y: 2.0, w: 8.8, h: 1.2, fontSize: 34, bold: true, color: 'FFFFFF' });
      titleSlide.addText('Prepared by ' + author + '  ·  ' + new Date().toLocaleDateString(), { x: 0.6, y: 3.1, w: 8.8, h: 0.5, fontSize: 14, color: '9CA3AF' });

      if (summary) {
        const s = pptx.addSlide();
        s.background = { color: '0A0A0A' };
        s.addText('Executive Summary', { x: 0.6, y: 0.5, w: 8.8, h: 0.7, fontSize: 24, bold: true, color: 'FFFFFF' });
        s.addText(summary, { x: 0.6, y: 1.4, w: 8.8, h: 3.5, fontSize: 16, color: 'D1D5DB' });
      }

      if (points.length) {
        const s = pptx.addSlide();
        s.background = { color: '0A0A0A' };
        s.addText('Key Points', { x: 0.6, y: 0.5, w: 8.8, h: 0.7, fontSize: 24, bold: true, color: 'FFFFFF' });
        s.addText(points.map((p) => ({ text: p, options: { bullet: true, breakLine: true, color: 'E5E7EB', fontSize: 16 } })), { x: 0.6, y: 1.4, w: 8.8, h: 3.5 });
      }

      if (table.length > 1) {
        const header = table[0];
        const numericCol = header.length > 1 ? 1 : 0;
        const chartLabels = table.slice(1).map((r) => r[0]);
        const chartValues = table.slice(1).map((r) => parseFloat(r[numericCol]) || 0);
        const s = pptx.addSlide();
        s.background = { color: '0A0A0A' };
        s.addText(header[numericCol] + ' by ' + header[0], { x: 0.6, y: 0.4, w: 8.8, h: 0.6, fontSize: 22, bold: true, color: 'FFFFFF' });
        s.addChart(pptx.ChartType.bar, [{ name: header[numericCol], labels: chartLabels, values: chartValues }], {
          x: 0.6, y: 1.2, w: 8.8, h: 3.9,
          chartColors: ['60A5FA'], showLegend: false, catAxisLabelColor: 'FFFFFF', valAxisLabelColor: 'FFFFFF',
        });

        const tblSlide = pptx.addSlide();
        tblSlide.background = { color: '0A0A0A' };
        tblSlide.addText('Data Table', { x: 0.6, y: 0.4, w: 8.8, h: 0.6, fontSize: 22, bold: true, color: 'FFFFFF' });
        const rows = table.map((r, ri) => r.map((c) => ({ text: String(c), options: { bold: ri === 0, color: ri === 0 ? 'FFFFFF' : 'D1D5DB', fill: ri === 0 ? '1F2937' : '111111' } })));
        tblSlide.addTable(rows, { x: 0.6, y: 1.2, w: 8.8, fontSize: 12, border: { type: 'solid', color: '333333', pt: 0.5 } });
      }

      await pptx.writeFile({ fileName: (title || 'report').replace(/[^a-z0-9\-_]+/gi, '_') + '.pptx' });
      showToast('Slide deck downloaded');
    } catch (err) {
      showToast('Could not generate the slide deck — check your connection.');
    } finally {
      btn.disabled = false;
      setExportStatus('Files are generated entirely in your browser and download immediately — nothing is uploaded anywhere.');
    }
  }

  async function exportXlsx() {
    const btn = qs('#studioExportXlsx');
    btn.disabled = true;
    setExportStatus('Loading spreadsheet engine…');
    try {
      await loadScript(CDN_URLS.xlsx);
      const { title, author, summary, points, table } = getReportFormData();
      const XLSX = window.XLSX;
      const wb = XLSX.utils.book_new();

      const overviewRows = [
        ['Title', title],
        ['Author', author],
        ['Generated', new Date().toLocaleString()],
        [],
        ['Executive Summary'],
        [summary || '—'],
        [],
        ['Key Points'],
        ...points.map((p) => [p]),
      ];
      const wsOverview = XLSX.utils.aoa_to_sheet(overviewRows);
      wsOverview['!cols'] = [{ wch: 60 }];
      XLSX.utils.book_append_sheet(wb, wsOverview, 'Overview');

      const wsData = XLSX.utils.aoa_to_sheet(table);
      wsData['!cols'] = table[0].map(() => ({ wch: 18 }));
      XLSX.utils.book_append_sheet(wb, wsData, 'Data');

      XLSX.writeFile(wb, (title || 'report').replace(/[^a-z0-9\-_]+/gi, '_') + '.xlsx');
      showToast('Excel sheet downloaded');
    } catch (err) {
      showToast('Could not generate the spreadsheet — check your connection.');
    } finally {
      btn.disabled = false;
      setExportStatus('Files are generated entirely in your browser and download immediately — nothing is uploaded anywhere.');
    }
  }

  function initReportStudio() {
    on(qs('#studioExportDocx'), 'click', exportDocx);
    on(qs('#studioExportPptx'), 'click', exportPptx);
    on(qs('#studioExportXlsx'), 'click', exportXlsx);
  }

  /* ============================================================
     TAB SWITCHING
  ============================================================ */
  function initTabs() {
    const tabs = qsa('.studio-tab-btn');
    const panels = {
      image: qs('#studioPanelImage'),
      debug: qs('#studioPanelDebug'),
      report: qs('#studioPanelReport'),
    };
    tabs.forEach((btn) => {
      on(btn, 'click', () => {
        const key = btn.getAttribute('data-studio-tab');
        tabs.forEach((b) => { b.classList.toggle('active', b === btn); b.setAttribute('aria-selected', String(b === btn)); });
        Object.keys(panels).forEach((k) => { if (panels[k]) panels[k].classList.toggle('active', k === key); });
      });
    });
  }

  function init() {
    if (!qs('#studio')) return;
    initTabs();
    initImageGenerator();
    initCodeDebugger();
    initReportStudio();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
