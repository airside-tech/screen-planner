/**
 * labels.js — Draggable DOM label overlays.
 *
 * Each monitor cell gets an absolutely-positioned <div class="label-container">
 * that is layered over the SVG cell position in the canvas-wrapper.
 *
 * Labels are <div class="screen-label"> children of that container.
 * Dragging is done via mouse events; labels are constrained to the cell bounds.
 *
 * Public API:
 *   LABELS.syncLabels(setupIndex) — rebuild label DOM for one setup
 *   LABELS.addLabel(setupIndex, row, col) — create a new label via edit tooltip
 */

/* global STATE, GRID, CANVAS */

const LABELS = (() => {
  const COLORS = [
    { cls: 'label-color-sky',    swatch: 'swatch-sky',    name: 'Sky'    },
    { cls: 'label-color-teal',   swatch: 'swatch-teal',   name: 'Teal'   },
    { cls: 'label-color-amber',  swatch: 'swatch-amber',  name: 'Amber'  },
    { cls: 'label-color-violet', swatch: 'swatch-violet', name: 'Violet' },
    { cls: 'label-color-rose',   swatch: 'swatch-rose',   name: 'Rose'   }
  ];

  let _editState = null; // { setupIndex, row, col, labelId, zoneId? }

  const tooltip   = () => document.getElementById('labelTooltip');
  const txtInput  = () => document.getElementById('labelTextInput');
  const colorsEl  = () => document.getElementById('labelColors');
  const okBtn     = () => document.getElementById('labelOkBtn');
  const cancelBtn = () => document.getElementById('labelCancelBtn');
  const removeLbl = () => document.getElementById('removeLabelBtn');

  function init() {
    // Populate color swatches
    const colEl = colorsEl();
    if (colEl) {
      COLORS.forEach(c => {
        const btn = document.createElement('button');
        btn.className = `label-color-swatch ${c.swatch}`;
        btn.title = c.name;
        btn.setAttribute('aria-label', c.name);
        btn.dataset.colorClass = c.cls;
        btn.addEventListener('click', () => _setActiveColor(c.cls));
        colEl.appendChild(btn);
      });
    }

    const inp = txtInput();
    if (inp) {
      inp.addEventListener('input', _previewDraft);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          _commitTooltip();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          _cancelTooltip();
        }
      });
    }

    const ok = okBtn();
    if (ok) ok.addEventListener('click', _commitTooltip);

    const cancel = cancelBtn();
    if (cancel) cancel.addEventListener('click', _cancelTooltip);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _editState) {
        e.preventDefault();
        _cancelTooltip();
      }
    });

    const rb = removeLbl();
    if (rb) {
      rb.addEventListener('click', _removeCurrentLabel);
    }

    document.addEventListener('click', e => {
      if (_editState &&
          !e.target.closest('.label-tooltip') &&
          !e.target.closest('.screen-label')) {
        _cancelTooltip();
      }
    });

    document.addEventListener('pip:addLabel', e => {
      const { setupIndex, row, col, zoneId } = e.detail;
      addZoneLabel(setupIndex, row, col, zoneId);
    });
  }

  /* ---- syncLabels: rebuild label DOM for a setup ---- */

  function syncLabels(setupIndex) {
    const wrapper = CANVAS.getWrapper(setupIndex);
    if (!wrapper) return;

    // Remove existing label containers for this setup
    wrapper.querySelectorAll(`.label-container[data-setup="${setupIndex}"]`)
      .forEach(c => c.remove());

    const { colWidths, rowHeights } = GRID.calcDimensions(setupIndex);
    const metrics = CANVAS.getRenderMetrics(setupIndex);
    const zoom = metrics ? metrics.zoom : 1;
    const pad = metrics ? metrics.pad : (parseInt(getComputedStyle(wrapper).paddingLeft, 10) || 12);

    for (let r = 0; r < GRID.MAX_ROWS; r++) {
      for (let c = 0; c < GRID.MAX_COLS; c++) {
        const cell = STATE.getCell(setupIndex, r, c);
        if (!cell) continue;

        const rect  = CANVAS.getMonitorRect(setupIndex, r, c);
        if (!rect) continue;
        // Pixel offset of this monitor within wrapper after fit-to-content zoom.
        const cellOffX = pad + rect.x * zoom;
        const cellOffY = pad + rect.y * zoom;

        if (cell.labels && cell.labels.length) {
          const container = document.createElement('div');
          container.className = 'label-container';
          container.dataset.setup = setupIndex;
          container.dataset.row   = r;
          container.dataset.col   = c;
          container.style.left   = cellOffX + 'px';
          container.style.top    = cellOffY + 'px';
          container.style.width  = Math.round(rect.w * zoom) + 'px';
          container.style.height = Math.round(rect.h * zoom) + 'px';
          container.style.position = 'absolute';
          container.style.pointerEvents = 'none';
          wrapper.appendChild(container);

          cell.labels.slice(0, 1).forEach(lbl => {
            _createLabelEl(container, lbl, setupIndex, r, c, rect.w, rect.h, zoom,
                           null /* no zoneId */);
          });
        }

        if (cell.pipZones && cell.pipZones.length) {
          cell.pipZones.forEach(zone => {
            if (!zone.labels || !zone.labels.length) return;

            const zoneOffX = pad + zone.x * zoom;
            const zoneOffY = pad + zone.y * zoom;

            const zc = document.createElement('div');
            zc.className = 'label-container zone-label-container';
            zc.dataset.setup  = setupIndex;
            zc.dataset.row    = r;
            zc.dataset.col    = c;
            zc.dataset.zoneId = zone.id;
            zc.style.left     = zoneOffX + 'px';
            zc.style.top      = zoneOffY + 'px';
            zc.style.width    = Math.round(zone.w * zoom) + 'px';
            zc.style.height   = Math.round(zone.h * zoom) + 'px';
            zc.style.position = 'absolute';
            zc.style.pointerEvents = 'none';
            wrapper.appendChild(zc);

            zone.labels.slice(0, 1).forEach(lbl => {
              _createLabelEl(zc, lbl, setupIndex, r, c, zone.w, zone.h, zoom, zone.id);
            });
          });
        }
      }
    }
  }

  function _createLabelEl(container, lbl, setupIndex, row, col, cellW, cellH, zoom, zoneId) {
    const div = document.createElement('div');
    div.id = lbl.id;
    div.className = `screen-label ${lbl.colorClass}`;
    div.textContent = lbl.text || 'Label';
    div.style.left = Math.round(lbl.x * zoom) + 'px';
    div.style.top  = Math.round(lbl.y * zoom) + 'px';
    div.style.pointerEvents = 'all';

    div.addEventListener('click', e => {
      if (div.dataset.suppressClick === 'true') {
        div.dataset.suppressClick = 'false';
        return;
      }
      e.stopPropagation();
      _openTooltip(setupIndex, row, col, lbl.id, div, lbl, zoneId);
    });

    _attachLabelDrag(div, setupIndex, row, col, lbl.id, cellW, cellH, zoom, zoneId);

    container.appendChild(div);
  }

  function _attachLabelDrag(div, setupIndex, row, col, labelId, cellW, cellH, zoom, zoneId) {
    let startX, startY, startLeft, startTop;
    let moved = false;

    div.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      startX    = e.clientX;
      startY    = e.clientY;
      startLeft = parseInt(div.style.left)  || 0;
      startTop  = parseInt(div.style.top)   || 0;
      moved = false;
      div.classList.add('dragging');

      const onMove = mv => {
        const newLeft = startLeft + (mv.clientX - startX);
        const newTop  = startTop  + (mv.clientY - startY);
        if (Math.abs(mv.clientX - startX) > 3 || Math.abs(mv.clientY - startY) > 3) {
          moved = true;
        }
        const scaledCellW = cellW * zoom;
        const scaledCellH = cellH * zoom;
        const clampedLeft = Math.max(0, Math.min(scaledCellW - div.offsetWidth,  newLeft));
        const clampedTop  = Math.max(0, Math.min(scaledCellH - div.offsetHeight, newTop));
        div.style.left = clampedLeft + 'px';
        div.style.top  = clampedTop  + 'px';
      };

      const onUp = mu => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        div.classList.remove('dragging');
        if (moved) div.dataset.suppressClick = 'true';
        const nx = parseInt(div.style.left, 10) / zoom;
        const ny = parseInt(div.style.top,  10) / zoom;
        if (zoneId) {
          STATE.updateZoneLabel(setupIndex, row, col, zoneId, labelId, { x: nx, y: ny });
        } else {
          STATE.updateLabel(setupIndex, row, col, labelId, { x: nx, y: ny });
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  /* ---- Tooltip ---- */

  function _openTooltip(setupIndex, row, col, labelId, labelEl, lbl, zoneId, isNew = false) {
    _editState = {
      setupIndex,
      row,
      col,
      labelId,
      zoneId: zoneId || null,
      isNew,
      originalText: lbl.text || 'Label',
      originalColor: lbl.colorClass || COLORS[0].cls
    };

    const inp = txtInput();
    if (inp) inp.value = lbl.text || '';

    _setActiveColor(lbl.colorClass, false);

    const tt = tooltip();
    if (!tt) return;
    tt.removeAttribute('hidden');
    const r = labelEl.getBoundingClientRect();
    tt.style.left = (r.right + 8) + 'px';
    tt.style.top  = r.top + 'px';

    // Check right overflow
    const ttW = tt.offsetWidth;
    if (r.right + 8 + ttW > window.innerWidth) {
      tt.style.left = (r.left - ttW - 8) + 'px';
    }
    if (inp) inp.focus();
  }

  function _closeTooltip() {
    const tt = tooltip();
    if (tt) tt.setAttribute('hidden', '');
    _editState = null;
  }

  function _setActiveColor(colorClass, persist = true) {
    const colEl = colorsEl();
    if (colEl) {
      colEl.querySelectorAll('.label-color-swatch').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.colorClass === colorClass);
      });
    }
    if (persist) {
      _previewDraft();
    }
  }

  function _previewDraft() {
    if (!_editState) return;
    const draft = _getDraft();
    _applyLabelPreview(_editState.labelId, draft.text, draft.colorClass);
  }

  function _getDraft() {
    const inp = txtInput();
    const active = colorsEl()
      ? colorsEl().querySelector('.label-color-swatch.active')
      : null;

    return {
      text: (inp && inp.value.trim()) || 'Label',
      colorClass: active ? active.dataset.colorClass : (_editState ? _editState.originalColor : COLORS[0].cls)
    };
  }

  function _applyLabelPreview(labelId, text, colorClass) {
    const lel = document.getElementById(labelId);
    if (!lel) return;
    lel.textContent = text || 'Label';
    COLORS.forEach(c => lel.classList.remove(c.cls));
    lel.classList.add(colorClass || COLORS[0].cls);
  }

  function _commitTooltip() {
    if (!_editState) return;
    const draft = _getDraft();
    if (_editState.zoneId) {
      STATE.updateZoneLabel(
        _editState.setupIndex, _editState.row, _editState.col,
        _editState.zoneId, _editState.labelId,
        { text: draft.text, colorClass: draft.colorClass }
      );
    } else {
      STATE.updateLabel(
        _editState.setupIndex, _editState.row, _editState.col,
        _editState.labelId,
        { text: draft.text, colorClass: draft.colorClass }
      );
    }
    _closeTooltip();
  }

  function _cancelTooltip() {
    if (!_editState) return;
    if (_editState.isNew) {
      _removeCurrentLabel();
      return;
    }

    _applyLabelPreview(_editState.labelId, _editState.originalText, _editState.originalColor);
    _closeTooltip();
  }

  function _removeCurrentLabel() {
    if (!_editState) return;
    if (_editState.zoneId) {
      STATE.removeZoneLabel(
        _editState.setupIndex, _editState.row, _editState.col,
        _editState.zoneId, _editState.labelId
      );
    } else {
      STATE.removeLabel(
        _editState.setupIndex, _editState.row, _editState.col, _editState.labelId
      );
    }
    _closeTooltip();
  }

  function _openExistingLabel(setupIndex, row, col, lbl, zoneId) {
    const open = () => {
      const el = document.getElementById(lbl.id);
      if (el) _openTooltip(setupIndex, row, col, lbl.id, el, lbl, zoneId);
    };
    setTimeout(open, 60);
  }

  /* ---- Public: add a new label to a screen cell (called from popover) ---- */

  function addLabel(setupIndex, row, col) {
    const cell = STATE.getCell(setupIndex, row, col);
    if (!cell) return;

    const existing = cell.labels && cell.labels[0];
    if (existing) {
      _openExistingLabel(setupIndex, row, col, existing, null);
      return;
    }

    const lbl = STATE.addLabel(setupIndex, row, col, 'Label', 'label-color-sky', 10, 10, 'screen');
    if (!lbl) return;

    setTimeout(() => {
      const el = document.getElementById(lbl.id);
      if (el) _openTooltip(setupIndex, row, col, lbl.id, el, lbl, null, true);
    }, 60);
  }

  /* ---- Public: add a new label inside a PiP zone ---- */

  function addZoneLabel(setupIndex, row, col, zoneId) {
    const cell = STATE.getCell(setupIndex, row, col);
    if (!cell) return;
    const zone = (cell.pipZones || []).find(z => z.id === zoneId);
    if (!zone) return;

    const existing = zone.labels && zone.labels[0];
    if (existing) {
      _openExistingLabel(setupIndex, row, col, existing, zoneId);
      return;
    }

    const lbl = STATE.addZoneLabel(setupIndex, row, col, zoneId, 'Label', 'label-color-sky', 10, 10);
    if (!lbl) return;

    setTimeout(() => {
      const el = document.getElementById(lbl.id);
      if (el) _openTooltip(setupIndex, row, col, lbl.id, el, lbl, zoneId, true);
    }, 60);
  }

  return { init, syncLabels, addLabel, addZoneLabel };
})();
