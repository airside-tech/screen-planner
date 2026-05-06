/**
 * ui.js — Sidebar rendering, popover management, info strip updates.
 *
 * Also exposes POPOVER global used by canvas.js.
 */

/* global CATALOG, STATE, GRID, CANVAS, DRAG, LABELS */

/* ================================================================
   POPOVER
   ================================================================ */
const POPOVER = (() => {
  let _current = null; // { setupIndex, row, col }

  const el   = id => document.getElementById(id);
  const popEl = () => el('monitorPopover');

  function _resolutionTierTag(width, height) {
    const longEdge = Math.max(width || 0, height || 0);
    const shortEdge = Math.min(width || 0, height || 0);

    if ((longEdge === 8192 && shortEdge === 4320) || (longEdge === 7680 && shortEdge === 4320)) {
      return ' (8K)';
    }
    if ((longEdge === 4096 && shortEdge === 2160) || (longEdge === 3840 && shortEdge === 2160)) {
      return ' (4K)';
    }
    if ((longEdge === 2560 && shortEdge === 1440) || (longEdge === 2048 && shortEdge === 1080)) {
      return ' (2K)';
    }
    return '';
  }

  function _formatResolution(resolution, orientation) {
    const width = orientation === 'portrait' ? resolution.height : resolution.width;
    const height = orientation === 'portrait' ? resolution.width : resolution.height;
    return `${width}×${height}${_resolutionTierTag(width, height)} (${resolution.refresh}Hz)`;
  }

  function _syncPopoverFields() {
    if (!_current) return null;

    const cell = STATE.getCell(_current.setupIndex, _current.row, _current.col);
    const monitor = cell ? CATALOG.find(m => m.id === cell.monitorId) : null;
    if (!monitor) return null;

    el('popoverTitle').textContent = `${monitor.size}" ${monitor.brand} — ${monitor.modelName}`;

    const resPicker = el('resolutionPicker');
    if (resPicker) {
      resPicker.innerHTML = '';
      monitor.resolutions.forEach((res, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = _formatResolution(res, cell.orientation || 'landscape');
        if (cell.selectedResolution && res.label === cell.selectedResolution.label) {
          opt.selected = true;
        }
        resPicker.appendChild(opt);
      });
    }

    const orientationPicker = el('orientationPicker');
    if (orientationPicker) orientationPicker.value = cell.orientation || 'landscape';

    const selector = el('pipZoneSelector');
    if (selector) {
      const currentCount = cell.pipZones ? cell.pipZones.length : 0;
      const canPip = monitor.pipSupported;
      selector.querySelectorAll('.btn-pip-zone').forEach(btn => {
        const count = parseInt(btn.dataset.count, 10);
        btn.disabled = !canPip && count !== 0;
        btn.classList.toggle('active', count === currentCount);
      });
    }

    return { cell, monitor };
  }

  function show(setupIndex, row, col, monitorGroupEl, rect) {
    _current = { setupIndex, row, col };
    const data = _syncPopoverFields();
    if (!data) return;

    // Position popover near the clicked monitor
    const svg = CANVAS.getSvg(setupIndex);
    const svgR = svg ? svg.getBoundingClientRect() : { left: 0, top: 0 };
    const scale = svg ? (svg.clientWidth / (svg.viewBox.baseVal.width || svg.clientWidth)) : 1;

    let px = svgR.left + rect.x * scale + rect.w * scale + 8;
    let py = svgR.top  + rect.y * scale;

    // Clamp to viewport
    const pop = popEl();
    pop.removeAttribute('hidden');
    pop.style.left = px + 'px';
    pop.style.top  = py + 'px';

    // After render, shift left if overflow
    requestAnimationFrame(() => {
      const pr = pop.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) {
        pop.style.left = (px - rect.w * scale - pr.width - 16) + 'px';
      }
      if (pr.bottom > window.innerHeight - 8) {
        pop.style.top = (window.innerHeight - pr.height - 8) + 'px';
      }
    });
  }

  function hide() {
    popEl().setAttribute('hidden', '');
    _current = null;
    STATE.setSelected(null, null, null);
  }

  function getCurrent() { return _current; }

  function init() {
    el('popoverClose').addEventListener('click', hide);

    el('resolutionPicker').addEventListener('change', e => {
      if (!_current) return;
      const cell = STATE.getCell(_current.setupIndex, _current.row, _current.col);
      if (!cell) return;
      const monitor = CATALOG.find(m => m.id === cell.monitorId);
      if (!monitor) return;
      const idx = parseInt(e.target.value, 10);
      STATE.setResolution(_current.setupIndex, _current.row, _current.col, monitor.resolutions[idx]);
    });

    el('orientationPicker').addEventListener('change', e => {
      if (!_current) return;
      STATE.setOrientation(_current.setupIndex, _current.row, _current.col, e.target.value);
      CANVAS.openCellPopover(_current.setupIndex, _current.row, _current.col);
    });

    // PiP zone selector buttons
    const selector = el('pipZoneSelector');
    if (selector) {
      selector.addEventListener('click', e => {
        const btn = e.target.closest('.btn-pip-zone');
        if (!btn || !_current) return;
        const count = parseInt(btn.dataset.count, 10);
        STATE.setPipZones(_current.setupIndex, _current.row, _current.col, count);
        // Update active state immediately
        selector.querySelectorAll('.btn-pip-zone').forEach(b => {
          b.classList.toggle('active', parseInt(b.dataset.count, 10) === count);
        });
      });
    }

    el('addLabelBtn').addEventListener('click', () => {
      if (!_current) return;
      const current = { ..._current };
      hide();
      LABELS.addLabel(current.setupIndex, current.row, current.col);
    });

    el('removeMonitorBtn').addEventListener('click', () => {
      if (!_current) return;
      STATE.removeMonitor(_current.setupIndex, _current.row, _current.col);
      hide();
    });

    // Close when clicking outside popover
    document.addEventListener('click', e => {
      if (_current &&
          !e.target.closest('.popover') &&
          !e.target.closest('[data-role="monitor"]')) {
        hide();
      }
    });
  }

  return { init, show, hide, getCurrent };
})();

/* ================================================================
   UI — Catalog rendering, setup controls, info strip
   ================================================================ */
const UI = (() => {
  const setupVisible = [true, false];

  function _resolutionTierTag(width, height) {
    const longEdge = Math.max(width || 0, height || 0);
    const shortEdge = Math.min(width || 0, height || 0);

    if ((longEdge === 8192 && shortEdge === 4320) || (longEdge === 7680 && shortEdge === 4320)) {
      return ' (8K)';
    }
    if ((longEdge === 4096 && shortEdge === 2160) || (longEdge === 3840 && shortEdge === 2160)) {
      return ' (4K)';
    }
    if ((longEdge === 2560 && shortEdge === 1440) || (longEdge === 2048 && shortEdge === 1080)) {
      return ' (2K)';
    }
    return '';
  }

  function init() {
    _renderCatalog(null);
    _bindSidebarToggle();
    _bindClearButtons();
    _bindTitleEdits();
    _bindFilterSelect();
    _bindZoomControls();
    _bindWheelZoom();
    _bindSetupVisibilityControls();
    _bindDropAreasToggle();
    _bindVideoPanel();
    _bindKeyboard();
    _bindAddMonitorBtn();
    _updateInfoStrip(0);
    _updateInfoStrip(1);
    _updateZoomReadout(0);
    _updateZoomReadout(1);
    _applySetupVisibility();
    _syncDropAreasToggle();

    document.addEventListener('state:changed', e => {
      _updateInfoStrip(e.detail.setupIndex);
      _updateZoomReadout(e.detail.setupIndex);
      // Re-attach SVG drop targets after each re-render
      DRAG.attachSvgDropTargets();
    });
  }

  function _bindDropAreasToggle() {
    const btn = document.getElementById('toggleDropAreas');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = !CANVAS.isDropAreasVisible();
      CANVAS.setDropAreasVisible(next);
      DRAG.attachSvgDropTargets();
      _syncDropAreasToggle();
    });
  }

  function _syncDropAreasToggle() {
    const btn = document.getElementById('toggleDropAreas');
    if (!btn) return;
    const visible = CANVAS.isDropAreasVisible();
    btn.textContent = visible ? 'Hide Drop Areas' : 'Show Drop Areas';
    btn.classList.toggle('showing-hidden', !visible);
  }

  /* ---- Catalog ---- */

  function _renderCatalog(filterSize) {
    const list = document.getElementById('catalogList');
    if (!list) return;
    list.innerHTML = '';

    const monitors = filterSize
      ? CATALOG.filter(m => m.size === filterSize)
      : catalogGetAll();

    monitors.forEach(mon => {
      const card = document.createElement('div');
      card.className = 'catalog-card';
      card.setAttribute('role', 'listitem');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `${mon.size}" ${mon.brand} ${mon.modelName}`);
      card.dataset.monitorId = mon.id;

      // Icon
      const icon = document.createElement('div');
      icon.className = 'card-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = `${mon.size}"`;
      card.appendChild(icon);

      // Info
      const info = document.createElement('div');
      info.className = 'card-info';

      const model = document.createElement('div');
      model.className = 'card-model';
      model.textContent = mon.modelName;
      info.appendChild(model);

      const meta = document.createElement('div');
      meta.className = 'card-meta';
      const maxRes = mon.resolutions[0];
      meta.textContent = `${mon.panelType} · ${maxRes.width}×${maxRes.height}${_resolutionTierTag(maxRes.width, maxRes.height)}`;
      info.appendChild(meta);

      card.appendChild(info);

      // PiP badge
      if (mon.pipSupported) {
        const badge = document.createElement('span');
        badge.className = 'card-pip-badge';
        badge.textContent = 'PiP';
        badge.title = 'Picture-in-Picture supported';
        card.appendChild(badge);
      }

      // Custom badge + delete button for non-built-in entries
      if (!mon.builtIn) {
        const customBadge = document.createElement('span');
        customBadge.className = 'card-custom-badge';
        customBadge.textContent = 'Custom';
        card.appendChild(customBadge);

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-delete-custom';
        delBtn.title = 'Delete custom monitor';
        delBtn.setAttribute('aria-label', 'Delete custom monitor');
        delBtn.textContent = '×';
        delBtn.addEventListener('click', e => {
          e.stopPropagation();
          catalogRemoveCustom(mon.id);
          _renderCatalog(filterSize);
          DRAG.attachSvgDropTargets();
        });
        card.appendChild(delBtn);
      }

      DRAG.attachCatalogDrag(card, mon.id);

      // Keyboard: Enter/Space to place in first available cell
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _placeInFirstEmpty(mon.id);
        }
      });

      list.appendChild(card);
    });
  }

  function _placeInFirstEmpty(monitorId) {
    for (let si = 0; si <= 1; si++) {
      for (let r = 0; r < GRID.MAX_ROWS; r++) {
        for (let c = 0; c < GRID.MAX_COLS; c++) {
          if (GRID.canPlace(si, r, c)) {
            STATE.placeMonitor(si, r, c, monitorId);
            CANVAS.openCellPopover(si, r, c);
            return;
          }
        }
      }
    }
    // All full — show toast
    _showToast('Grid full — maximum 2 rows × 4 columns reached.');
  }

  function _showToast(message) {
    const toast = document.getElementById('gridToast');
    if (!toast) return;
    toast.textContent = message;
    toast.removeAttribute('hidden');
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.setAttribute('hidden', ''), 320);
    }, 2500);
  }

  /* ---- Sidebar toggle ---- */

  function _bindSidebarToggle() {
    const btn = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    if (!btn || !sidebar) return;
    btn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      // Update video panel left offset
      const vp = document.getElementById('videoPanel');
      if (vp) {
        vp.style.left = sidebar.classList.contains('collapsed') ? '0' :
          getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width').trim();
      }
    });
  }

  /* ---- Clear buttons ---- */

  function _bindClearButtons() {
    document.getElementById('clearA').addEventListener('click', () => {
      if (confirm('Clear all monitors from Setup A?')) STATE.clearSetup(0);
    });
    document.getElementById('clearB').addEventListener('click', () => {
      if (confirm('Clear all monitors from Setup B?')) STATE.clearSetup(1);
    });
  }

  /* ---- Setup title edits ---- */

  function _bindTitleEdits() {
    ['titleA', 'titleB'].forEach((id, si) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('blur', () => STATE.renameSetup(si, el.textContent.trim() || `Setup ${si === 0 ? 'A' : 'B'}`));
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      });
    });
  }

  /* ---- Filter select ---- */

  function _bindFilterSelect() {
    const sel = document.getElementById('sizeFilter');
    if (!sel) return;
    sel.addEventListener('change', () => {
      const v = sel.value;
      _renderCatalog(v === 'all' ? null : parseInt(v, 10));
      DRAG.attachSvgDropTargets(); // cards re-created; re-attach
    });
  }

  /* ---- Manual zoom controls ---- */

  function _bindZoomControls() {
    _bindZoomForSetup(0, 'A');
    _bindZoomForSetup(1, 'B');
  }

  function _bindZoomForSetup(setupIndex, suffix) {
    const outBtn = document.getElementById('zoomOut' + suffix);
    const inBtn  = document.getElementById('zoomIn' + suffix);
    const fitBtn = document.getElementById('zoomFit' + suffix);
    if (!outBtn || !inBtn || !fitBtn) return;

    outBtn.addEventListener('click', () => {
      CANVAS.zoomOut(setupIndex);
      _updateZoomReadout(setupIndex);
      DRAG.attachSvgDropTargets();
    });

    inBtn.addEventListener('click', () => {
      CANVAS.zoomIn(setupIndex);
      _updateZoomReadout(setupIndex);
      DRAG.attachSvgDropTargets();
    });

    fitBtn.addEventListener('click', () => {
      CANVAS.resetManualZoom(setupIndex);
      _updateZoomReadout(setupIndex);
      DRAG.attachSvgDropTargets();
    });
  }

  function _updateZoomReadout(setupIndex) {
    const suffix = setupIndex === 0 ? 'A' : 'B';
    const el = document.getElementById('zoomValue' + suffix);
    if (!el) return;
    const z = CANVAS.getManualZoom(setupIndex);
    el.textContent = Math.round(z * 100) + '%';
  }

  function _bindWheelZoom() {
    _bindWheelForSetup(0, 'canvasWrapperA');
    _bindWheelForSetup(1, 'canvasWrapperB');
  }

  function _bindWheelForSetup(setupIndex, wrapperId) {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;

    wrapper.addEventListener('wheel', e => {
      // Keep regular scrolling behavior unless Ctrl/Cmd is held.
      if (!e.ctrlKey && !e.metaKey) return;

      e.preventDefault();

      const magnitude = Math.max(1, Math.min(4, Math.ceil(Math.abs(e.deltaY) / 120)));
      for (let i = 0; i < magnitude; i++) {
        if (e.deltaY < 0) {
          CANVAS.zoomIn(setupIndex);
        } else if (e.deltaY > 0) {
          CANVAS.zoomOut(setupIndex);
        }
      }

      _updateZoomReadout(setupIndex);
      DRAG.attachSvgDropTargets();
    }, { passive: false });
  }

  /* ---- Setup show/hide ---- */

  function _bindSetupVisibilityControls() {
    const toggleA = document.getElementById('toggleSetupA');
    const toggleB = document.getElementById('toggleSetupB');
    const hideA = document.getElementById('hideA');
    const hideB = document.getElementById('hideB');

    if (toggleA) toggleA.addEventListener('click', () => _toggleSetup(0));
    if (toggleB) toggleB.addEventListener('click', () => _toggleSetup(1));
    if (hideA) hideA.addEventListener('click', () => _toggleSetup(0));
    if (hideB) hideB.addEventListener('click', () => _toggleSetup(1));
  }

  function _toggleSetup(setupIndex) {
    const visibleCount = setupVisible.filter(Boolean).length;
    if (setupVisible[setupIndex] && visibleCount <= 1) {
      _showToast('At least one setup must stay visible.');
      return;
    }

    setupVisible[setupIndex] = !setupVisible[setupIndex];
    _applySetupVisibility();

    // Re-fit visible setups after layout changes.
    requestAnimationFrame(() => {
      if (setupVisible[0]) {
        CANVAS.render(0);
        LABELS.syncLabels(0);
      }
      if (setupVisible[1]) {
        CANVAS.render(1);
        LABELS.syncLabels(1);
      }
      DRAG.attachSvgDropTargets();
    });
  }

  function _applySetupVisibility() {
    const setupA = document.getElementById('setupA');
    const setupB = document.getElementById('setupB');
    const divider = document.querySelector('.setup-divider');
    const toggleA = document.getElementById('toggleSetupA');
    const toggleB = document.getElementById('toggleSetupB');

    setupA.classList.toggle('hidden-setup', !setupVisible[0]);
    setupB.classList.toggle('hidden-setup', !setupVisible[1]);
    if (divider) {
      divider.classList.toggle('hidden-divider', !(setupVisible[0] && setupVisible[1]));
    }

    if (toggleA) {
      toggleA.textContent = setupVisible[0] ? 'Hide A' : 'Show A';
      toggleA.classList.toggle('showing-hidden', !setupVisible[0]);
    }
    if (toggleB) {
      toggleB.textContent = setupVisible[1] ? 'Hide B' : 'Show B';
      toggleB.classList.toggle('showing-hidden', !setupVisible[1]);
    }
  }

  /* ---- Info strip ---- */

  function _updateInfoStrip(setupIndex) {
    const suffix = setupIndex === 0 ? 'A' : 'B';
    const wEl = document.getElementById('width'  + suffix);
    const hEl = document.getElementById('height' + suffix);
    if (!wEl || !hEl) return;

    const w = GRID.totalWidth_mm(setupIndex);
    const h = GRID.totalHeight_mm(setupIndex);

    wEl.textContent = w > 0 ? `Width: ${w}mm (${(w/10).toFixed(1)}cm)` : 'Width: —';
    hEl.textContent = h > 0 ? `Height: ${h}mm (${(h/10).toFixed(1)}cm)` : 'Height: —';
  }

  /* ---- Add custom monitor dialog ---- */

  function _bindAddMonitorBtn() {
    const btn = document.getElementById('addMonitorBtn');
    const dialog = document.getElementById('monitorFormDialog');
    if (!btn || !dialog) return;

    btn.addEventListener('click', () => _openMonitorForm());

    document.getElementById('monitorFormClose').addEventListener('click', () => dialog.close());
    document.getElementById('monitorFormCancel').addEventListener('click', () => dialog.close());

    // "Add Resolution" row
    document.getElementById('mfAddResBtn').addEventListener('click', () => _addResolutionRow());

    document.getElementById('monitorFormSave').addEventListener('click', () => {
      const errEl = document.getElementById('mfError');
      errEl.textContent = '';

      const brand  = document.getElementById('mfBrand').value.trim();
      const model  = document.getElementById('mfModel').value.trim();
      const size   = parseFloat(document.getElementById('mfSize').value);
      const wMm    = parseInt(document.getElementById('mfWidth').value, 10);
      const hMm    = parseInt(document.getElementById('mfHeight').value, 10);
      const panel  = document.getElementById('mfPanel').value;
      const pip    = document.getElementById('mfPip').checked;

      if (!brand || !model) { errEl.textContent = 'Brand and model name are required.'; return; }
      if (isNaN(size) || size < 10) { errEl.textContent = 'Enter a valid screen size.'; return; }
      if (isNaN(wMm) || wMm < 100) { errEl.textContent = 'Enter a valid physical width (mm).'; return; }
      if (isNaN(hMm) || hMm < 50)  { errEl.textContent = 'Enter a valid physical height (mm).'; return; }

      // Collect resolutions from dynamic rows
      const resRows = document.querySelectorAll('#mfResolutionList .mf-res-row');
      const resolutions = [];
      let resErr = false;
      resRows.forEach(row => {
        const w  = parseInt(row.querySelector('.mf-res-w').value, 10);
        const h  = parseInt(row.querySelector('.mf-res-h').value, 10);
        const hz = parseInt(row.querySelector('.mf-res-hz').value, 10) || 60;
        if (isNaN(w) || isNaN(h) || w < 1 || h < 1) { resErr = true; return; }
        resolutions.push({ label: `${w}\u00d7${h} (${hz}Hz)`, width: w, height: h, refresh: hz });
      });
      if (resErr) { errEl.textContent = 'Check resolution rows \u2014 width and height are required.'; return; }
      if (!resolutions.length) { errEl.textContent = 'Add at least one resolution.'; return; }

      // Derive aspect ratio from physical dimensions
      const gcd = (a, b) => b ? gcd(b, a % b) : a;
      const aspectW = Math.round(wMm);
      const aspectH = Math.round(hMm);
      const g = gcd(aspectW, aspectH);
      const aspectRatio = `${aspectW / g}:${aspectH / g}`;

      const spec = {
        size: Math.round(size * 10) / 10,
        brand,
        modelName: `${brand} ${model}`,
        panelType: panel,
        physicalWidth_mm: wMm,
        physicalHeight_mm: hMm,
        aspectRatio,
        pipSupported: pip,
        resolutions
      };

      catalogAddCustom(spec);
      const currentFilter = document.getElementById('sizeFilter');
      const filterVal = currentFilter ? currentFilter.value : 'all';
      _renderCatalog(filterVal === 'all' ? null : parseInt(filterVal, 10));
      DRAG.attachSvgDropTargets();
      dialog.close();
    });
  }

  function _openMonitorForm() {
    const dialog = document.getElementById('monitorFormDialog');
    // Reset form
    document.getElementById('mfBrand').value  = '';
    document.getElementById('mfModel').value  = '';
    document.getElementById('mfSize').value   = '';
    document.getElementById('mfWidth').value  = '';
    document.getElementById('mfHeight').value = '';
    document.getElementById('mfPanel').value  = 'IPS';
    document.getElementById('mfPip').checked  = false;
    document.getElementById('mfError').textContent = '';
    const resList = document.getElementById('mfResolutionList');
    resList.innerHTML = '';
    _addResolutionRow(); // start with one empty row
    dialog.showModal();
  }

  function _addResolutionRow(w, h, hz) {
    const list = document.getElementById('mfResolutionList');
    const row = document.createElement('div');
    row.className = 'mf-res-row';
    row.innerHTML = `
      <input class="mf-input mf-res-w" type="number" placeholder="1920" min="1" max="20000" value="${w || ''}" />
      <span class="mf-res-sep">\u00d7</span>
      <input class="mf-input mf-res-h" type="number" placeholder="1080" min="1" max="20000" value="${h || ''}" />
      <span class="mf-res-sep">@</span>
      <input class="mf-input mf-res-hz" type="number" placeholder="60" min="1" max="500" value="${hz || ''}" />
      <span class="mf-res-sep mf-res-hz-label">Hz</span>
      <button type="button" class="mf-res-remove" aria-label="Remove resolution">\u00d7</button>
    `;
    row.querySelector('.mf-res-remove').addEventListener('click', () => row.remove());
    list.appendChild(row);
  }

  /* ---- Video composition panel ---- */

  function _bindVideoPanel() {
    document.getElementById('testComposition').addEventListener('click', () => {
      const raw = document.getElementById('compositionInput').value.trim();
      const errEl = document.getElementById('videoError');
      errEl.setAttribute('hidden', '');
      STATE.clearStreams();

      if (!raw) return;

      let data;
      try {
        data = JSON.parse(raw);
      } catch (ex) {
        errEl.textContent = 'Invalid JSON: ' + ex.message;
        errEl.removeAttribute('hidden');
        return;
      }

      const streams = data.streams || data;
      if (!Array.isArray(streams)) {
        errEl.textContent = 'Expected a JSON object with a "streams" array.';
        errEl.removeAttribute('hidden');
        return;
      }

      streams.forEach(s => {
        try {
          const si = parseInt(s.setup, 10);
          const r  = parseInt(s.row,   10);
          const c  = parseInt(s.col,   10);
          if (!isNaN(si) && !isNaN(r) && !isNaN(c)) {
            STATE.setStream(si, r, c, String(s.id || 'stream'));
          }
        } catch (_) { /* skip invalid entries */ }
      });
    });

    document.getElementById('clearComposition').addEventListener('click', () => {
      document.getElementById('compositionInput').value = '';
      document.getElementById('videoError').setAttribute('hidden', '');
      STATE.clearStreams();
    });
  }

  /* ---- Keyboard shortcuts ---- */

  function _bindKeyboard() {
    document.addEventListener('keydown', e => {
      // Delete/Backspace on selected monitor
      if ((e.key === 'Delete' || e.key === 'Backspace') &&
          !e.target.matches('input, textarea, [contenteditable]')) {
        const sel = STATE.getSelected();
        if (sel) {
          STATE.removeMonitor(sel.setupIndex, sel.row, sel.col);
          POPOVER.hide();
        }
      }

      // Escape closes popover/tooltip
      if (e.key === 'Escape') {
        POPOVER.hide();
        const tt = document.getElementById('labelTooltip');
        if (tt) tt.setAttribute('hidden', '');
      }
    });
  }

  return { init };
})();
