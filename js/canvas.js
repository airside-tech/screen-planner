/**
 * canvas.js — SVG rendering of both layout canvases.
 *
 * Renders:
 *  - Empty cell placeholders (dashed rect)
 *  - Placed monitor cells (filled rect + bezel + text labels)
 *  - PiP sub-rect when pipEnabled
 *  - Dimension annotations (row heights, column widths)
 *  - Stream overlays (experimental)
 *
 * Call CANVAS.render(setupIndex) to fully redraw one setup.
 * Called automatically via 'state:changed' event.
 */

/* global CATALOG, STATE, GRID, LABELS, PIP, POPOVER, DRAG */

const CANVAS = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MANUAL_MIN = 0.5;
  const MANUAL_MAX = 3.0;
  const MANUAL_STEP = 0.1;

  const svgEls   = [null, null]; // SVG elements for setup 0 and 1
  const wrappers = [null, null]; // canvas-wrapper divs
  const manualZoom = [1, 1];
  let dropAreasVisible = true;
  const renderMetrics = [
    { intrinsicWidth: 0, intrinsicHeight: 0, zoom: 1, fitZoom: 1, manualZoom: 1, pad: 12 },
    { intrinsicWidth: 0, intrinsicHeight: 0, zoom: 1, fitZoom: 1, manualZoom: 1, pad: 12 }
  ];

  function init() {
    svgEls[0]   = document.getElementById('svgA');
    svgEls[1]   = document.getElementById('svgB');
    wrappers[0] = document.getElementById('canvasWrapperA');
    wrappers[1] = document.getElementById('canvasWrapperB');

    document.addEventListener('state:changed', e => {
      render(e.detail.setupIndex);
      LABELS.syncLabels(e.detail.setupIndex);
    });

    window.addEventListener('resize', _handleResize);
  }

  function _handleResize() {
    render(0);
    render(1);
    LABELS.syncLabels(0);
    LABELS.syncLabels(1);
  }

  /* ---- SVG helpers ---- */

  function el(tag, attrs, cls) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (cls)   e.setAttribute('class', cls);
    return e;
  }

  function text(str, x, y, cls, extraAttrs) {
    const t = el('text', { x, y, ...extraAttrs }, cls);
    t.textContent = str;
    return t;
  }

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

  function _displayResolution(cell) {
    if (!cell || !cell.selectedResolution) return '';
    const width = cell.orientation === 'portrait'
      ? cell.selectedResolution.height
      : cell.selectedResolution.width;
    const height = cell.orientation === 'portrait'
      ? cell.selectedResolution.width
      : cell.selectedResolution.height;
    return `${width}×${height}${_resolutionTierTag(width, height)}`;
  }

  function _monitorRectFromCellRect(rect, cell, monitor) {
    const physicalW = cell.orientation === 'portrait'
      ? monitor.physicalHeight_mm
      : monitor.physicalWidth_mm;
    const physicalH = cell.orientation === 'portrait'
      ? monitor.physicalWidth_mm
      : monitor.physicalHeight_mm;
    return {
      x: rect.x + (cell.offsetX || 0),
      y: rect.y + (cell.offsetY || 0),
      w: GRID.mmToDisplay(physicalW),
      h: GRID.mmToDisplay(physicalH)
    };
  }

  function getMonitorRect(setupIndex, row, col) {
    const cell = STATE.getCell(setupIndex, row, col);
    if (!cell) return null;
    const monitor = CATALOG.find(m => m.id === cell.monitorId);
    if (!monitor) return null;

    const { colWidths, rowHeights } = GRID.calcDimensions(setupIndex);
    const rect = GRID.cellRect(colWidths, rowHeights, row, col);
    return _monitorRectFromCellRect(rect, cell, monitor);
  }

  /* ---- Main render ---- */

  function render(setupIndex) {
    const svg = svgEls[setupIndex];
    const wrapper = wrappers[setupIndex];
    if (!svg) return;

    // Clear
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const { colWidths, rowHeights, colWidths_mm, rowHeights_mm } =
      GRID.calcDimensions(setupIndex);
    const { width, height } = GRID.svgSize(colWidths, rowHeights);

    const fit = _fitToWrapper(wrapper, width, height);
    const effectiveZoom = fit.zoom * manualZoom[setupIndex];
    renderMetrics[setupIndex] = {
      intrinsicWidth: width,
      intrinsicHeight: height,
      zoom: effectiveZoom,
      fitZoom: fit.zoom,
      manualZoom: manualZoom[setupIndex],
      pad: fit.pad
    };

    svg.setAttribute('width',  width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.width = Math.round(width * effectiveZoom) + 'px';
    svg.style.height = Math.round(height * effectiveZoom) + 'px';

    // Keep layouts anchored at top-left so label overlays share origin.
    svg.style.marginLeft = '0px';
    svg.style.marginTop = '0px';

    // Draw cells
    for (let r = 0; r < GRID.MAX_ROWS; r++) {
      for (let c = 0; c < GRID.MAX_COLS; c++) {
        const rect = GRID.cellRect(colWidths, rowHeights, r, c);
        const cell = STATE.getCell(setupIndex, r, c);
        if (cell) {
          _drawMonitor(svg, setupIndex, r, c, rect, cell);
        } else {
          _drawEmptyCell(svg, setupIndex, r, c, rect);
        }
      }
    }

    // Draw dimension annotations
    _drawAnnotations(svg, colWidths, rowHeights, colWidths_mm, rowHeights_mm);
  }

  function _fitToWrapper(wrapper, intrinsicWidth, intrinsicHeight) {
    const pad = wrapper ? (parseInt(getComputedStyle(wrapper).paddingLeft, 10) || 12) : 12;
    const availableWidth = wrapper ? Math.max(wrapper.clientWidth - pad * 2, 120) : intrinsicWidth;
    const availableHeight = wrapper ? Math.max(wrapper.clientHeight - pad * 2, 120) : intrinsicHeight;

    const zoomW = availableWidth / intrinsicWidth;
    const zoomH = availableHeight / intrinsicHeight;
    const zoom = Math.min(zoomW, zoomH);

    // Prevent tiny unreadable render while still fitting most common cases.
    return { zoom: Math.max(0.25, zoom), pad };
  }

  /* ---- Empty cell ---- */

  function _drawEmptyCell(svg, setupIndex, row, col, rect) {
    const g = el('g', {
      'data-setup': setupIndex,
      'data-row': row,
      'data-col': col,
      'data-role': 'empty-cell'
    });

    const r = el('rect', {
      x: rect.x, y: rect.y,
      width: rect.w, height: rect.h,
      rx: 4
    }, `cell-empty${dropAreasVisible ? '' : ' drop-area-hidden'}`);

    g.appendChild(r);

    // "+" hint text
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const hint = text('+', cx, cy + 4, 'dim-text');
    hint.setAttribute('font-size', '20');
    hint.setAttribute('opacity', '0.3');
    if (!dropAreasVisible) hint.classList.add('empty-cell-hint-hidden');
    g.appendChild(hint);

    svg.appendChild(g);
  }

  /* ---- Placed monitor ---- */

  function _drawMonitor(svg, setupIndex, row, col, rect, cell) {
    const monitor = CATALOG.find(m => m.id === cell.monitorId);
    if (!monitor) return;

    const monRect = _monitorRectFromCellRect(rect, cell, monitor);

    const selected = (() => {
      const sel = STATE.getSelected();
      return sel && sel.setupIndex === setupIndex && sel.row === row && sel.col === col;
    })();

    const g = el('g', {
      'data-setup': setupIndex,
      'data-row': row,
      'data-col': col,
      'data-role': 'monitor',
      'data-monitor-id': monitor.id
    });
    g.style.cursor = 'pointer';

    // Body (outer bezel)
    const BEZEL = 6;
    const body = el('rect', {
      x: monRect.x, y: monRect.y,
      width: monRect.w, height: monRect.h,
      rx: 4
    }, 'monitor-body' + (selected ? ' selected' : ''));
    g.appendChild(body);

    // Screen area (inner)
    const screen = el('rect', {
      x: monRect.x + BEZEL, y: monRect.y + BEZEL,
      width: Math.max(monRect.w - BEZEL * 2, 10),
      height: Math.max(monRect.h - BEZEL * 2 - 10, 10),
      rx: 2
    }, 'monitor-screen');
    g.appendChild(screen);

    // Size label
    const hasPip = !!(cell.pipZones && cell.pipZones.length && monitor.pipSupported);
    const pipPortrait = hasPip && cell.orientation === 'portrait';
    const cx = monRect.x + monRect.w / 2;
    const cy = monRect.y + monRect.h / 2;

    const pipScreenTop = monRect.y + BEZEL;
    const pipScreenBottom = monRect.y + monRect.h - BEZEL - 10;
    const infoBgW = Math.max(Math.min(monRect.w - BEZEL * 2 - 10, 190), 90);
    const infoBgH = 36;
    const infoBgX = monRect.x + BEZEL + 4;
    const infoBgY = pipPortrait
      ? (pipScreenBottom - infoBgH - 4)
      : (pipScreenTop + 4);

    const infoX = hasPip ? (infoBgX + 6) : cx;
    const sizeY = hasPip ? (infoBgY + 11) : (cy - 8);
    const resY = hasPip ? (sizeY + 12) : (cy + 8);
    const brandY = hasPip ? (resY + 11) : (cy + 21);
    const anchor = hasPip ? 'start' : 'middle';

    if (hasPip) {
      const infoBg = el('rect', {
        x: infoBgX,
        y: infoBgY,
        width: infoBgW,
        height: infoBgH,
        rx: 4
      }, 'monitor-info-backdrop');
      g.appendChild(infoBg);
    }

    const sizeLabel = text(`${monitor.size}"`, infoX, sizeY, 'monitor-label-size', {
      'text-anchor': anchor
    });
    g.appendChild(sizeLabel);

    // Resolution label
    const resText = _displayResolution(cell);
    const resLabel = text(resText, infoX, resY, 'monitor-label-res', {
      'text-anchor': anchor
    });
    g.appendChild(resLabel);

    // Brand label
    const brandLabel = text(monitor.brand, infoX, brandY, 'monitor-label-brand', {
      'text-anchor': anchor
    });
    g.appendChild(brandLabel);

    // Selected ring
    if (selected) {
      const ring = el('rect', {
        x: monRect.x - 3, y: monRect.y - 3,
        width: monRect.w + 6, height: monRect.h + 6,
        rx: 6
      }, 'monitor-selected-ring');
      g.appendChild(ring);
    }

    // Stream overlay
    if (cell.streamId) {
      const overlay = el('rect', {
        x: monRect.x + BEZEL, y: monRect.y + BEZEL,
        width: monRect.w - BEZEL * 2, height: monRect.h - BEZEL * 2 - 10,
        rx: 3
      }, 'stream-overlay');
      g.appendChild(overlay);
      const streamTxt = text(cell.streamId, cx, cy - 2, 'stream-overlay-text');
      g.appendChild(streamTxt);
    }

    // PiP zones
    if (hasPip) {
      PIP.renderZones(g, monRect, cell, monitor);
    }

    // Click → select
    g.addEventListener('click', e => {
      e.stopPropagation();
      STATE.setSelected(setupIndex, row, col);
      render(setupIndex); // re-render to show selection ring
      POPOVER.show(setupIndex, row, col, g, monRect);
    });

    // Draggable for canvas→canvas move
    g.setAttribute('draggable', 'false'); // drag is handled by DRAG module via mousedown
    DRAG.attachMonitorDrag(g, setupIndex, row, col);

    svg.appendChild(g);
  }

  /* ---- Dimension annotations ---- */

  function _drawAnnotations(svg, colWidths, rowHeights, colWidths_mm, rowHeights_mm) {
    const totalCols = GRID.MAX_COLS;
    const totalRows = GRID.MAX_ROWS;

    // Row height annotations (left side)
    for (let r = 0; r < totalRows; r++) {
      if (rowHeights_mm[r] === 0) continue;
      const rect0 = GRID.cellRect(colWidths, rowHeights, r, 0);
      const x = GRID.MARGIN_LEFT - 10;
      const y1 = rect0.y;
      const y2 = rect0.y + rect0.h;
      const midY = (y1 + y2) / 2;

      // Vertical line
      const line = el('line', { x1: x, y1, x2: x, y2 }, 'dim-line');
      svg.appendChild(line);
      // Top tick
      svg.appendChild(el('line', { x1: x - 4, y1, x2: x + 4, y2: y1 }, 'dim-line'));
      // Bottom tick
      svg.appendChild(el('line', { x1: x - 4, y1: y2, x2: x + 4, y2 }, 'dim-line'));

      const mm = Math.round(rowHeights_mm[r]);
      const cm = (mm / 10).toFixed(1);
      const t = text(`${mm}mm`, x - 6, midY, 'dim-text');
      t.setAttribute('text-anchor', 'end');
      t.setAttribute('dominant-baseline', 'middle');
      svg.appendChild(t);
      const t2 = text(`(${cm}cm)`, x - 6, midY + 13, 'dim-text');
      t2.setAttribute('text-anchor', 'end');
      t2.setAttribute('dominant-baseline', 'middle');
      svg.appendChild(t2);
    }

    // Column width annotations (bottom)
    const lastRowRect0 = GRID.cellRect(colWidths, rowHeights, totalRows - 1, 0);
    const annotY = lastRowRect0.y + lastRowRect0.h + GRID.CELL_GAP + 14;

    for (let c = 0; c < totalCols; c++) {
      if (colWidths_mm[c] === 0) continue;
      const rect0 = GRID.cellRect(colWidths, rowHeights, 0, c);
      const x1 = rect0.x;
      const x2 = rect0.x + rect0.w;
      const midX = (x1 + x2) / 2;

      svg.appendChild(el('line', { x1, y1: annotY, x2, y2: annotY }, 'dim-line'));
      svg.appendChild(el('line', { x1, y1: annotY - 4, x2: x1, y2: annotY + 4 }, 'dim-line'));
      svg.appendChild(el('line', { x1: x2, y1: annotY - 4, x2: x2, y2: annotY + 4 }, 'dim-line'));

      const mm = Math.round(colWidths_mm[c]);
      const cm = (mm / 10).toFixed(1);
      svg.appendChild(text(`${mm}mm (${cm}cm)`, midX, annotY + 14, 'dim-text'));
    }
  }

  /* ---- Drop highlight helpers (called by DRAG) ---- */

  function highlightCell(setupIndex, row, col, valid) {
    const svg = svgEls[setupIndex];
    if (!svg) return;
    const g = svg.querySelector(
      `[data-role="empty-cell"][data-setup="${setupIndex}"][data-row="${row}"][data-col="${col}"]`
    );
    if (!g) return;
    const r = g.querySelector('rect');
    if (!r) return;
    if (valid) {
      r.classList.add('drag-over');
      r.classList.remove('drag-invalid');
    } else {
      r.classList.add('drag-invalid');
      r.classList.remove('drag-over');
    }
  }

  function clearHighlights(setupIndex) {
    const svg = svgEls[setupIndex];
    if (!svg) return;
    svg.querySelectorAll('.cell-empty').forEach(r => {
      r.classList.remove('drag-over', 'drag-invalid');
    });
  }

  function getSvg(setupIndex) { return svgEls[setupIndex]; }
  function getWrapper(setupIndex) { return wrappers[setupIndex]; }
  function getRenderMetrics(setupIndex) { return renderMetrics[setupIndex]; }
  function getManualZoom(setupIndex) { return manualZoom[setupIndex]; }

  function openCellPopover(setupIndex, row, col) {
    const svg = svgEls[setupIndex];
    if (!svg || !STATE.getCell(setupIndex, row, col)) return;

    STATE.setSelected(setupIndex, row, col);
    render(setupIndex);

    const rect = getMonitorRect(setupIndex, row, col);
    const group = svg.querySelector(
      `[data-role="monitor"][data-setup="${setupIndex}"][data-row="${row}"][data-col="${col}"]`
    );
    if (group && rect) POPOVER.show(setupIndex, row, col, group, rect);
  }

  function _setManualZoom(setupIndex, value) {
    const clamped = Math.max(MANUAL_MIN, Math.min(MANUAL_MAX, value));
    manualZoom[setupIndex] = Math.round(clamped * 100) / 100;
    render(setupIndex);
    LABELS.syncLabels(setupIndex);
    return manualZoom[setupIndex];
  }

  function zoomIn(setupIndex) {
    return _setManualZoom(setupIndex, manualZoom[setupIndex] + MANUAL_STEP);
  }

  function zoomOut(setupIndex) {
    return _setManualZoom(setupIndex, manualZoom[setupIndex] - MANUAL_STEP);
  }

  function resetManualZoom(setupIndex) {
    return _setManualZoom(setupIndex, 1);
  }

  function setDropAreasVisible(visible) {
    const next = !!visible;
    if (dropAreasVisible === next) return dropAreasVisible;
    dropAreasVisible = next;
    render(0);
    render(1);
    LABELS.syncLabels(0);
    LABELS.syncLabels(1);
    return dropAreasVisible;
  }

  function isDropAreasVisible() {
    return dropAreasVisible;
  }

  return {
    init,
    render,
    highlightCell,
    clearHighlights,
    getSvg,
    getWrapper,
    getRenderMetrics,
    getManualZoom,
    getMonitorRect,
    openCellPopover,
    zoomIn,
    zoomOut,
    resetManualZoom,
    setDropAreasVisible,
    isDropAreasVisible
  };
})();
