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

/* global CATALOG, STATE, GRID, LABELS, PIP, POPOVER, DRAG, TEST_MEDIA */

const CANVAS = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MONITOR_BEZEL = 6;
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
    const monitor = CATALOG.find(m => m.id === cell.monitorId);
    const width = cell.orientation === 'portrait'
      ? cell.selectedResolution.height
      : cell.selectedResolution.width;
    const height = cell.orientation === 'portrait'
      ? cell.selectedResolution.width
      : cell.selectedResolution.height;
    let aspect = '';
    if (monitor && monitor.aspectRatio) {
      aspect = `, ${monitor.aspectRatio}`;
    }
    return `${width}×${height}${_resolutionTierTag(width, height)}${aspect}`;
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

  function getScreenRect(setupIndex, row, col) {
    const monRect = getMonitorRect(setupIndex, row, col);
    if (!monRect) return null;
    return {
      x: monRect.x + MONITOR_BEZEL,
      y: monRect.y + MONITOR_BEZEL,
      w: Math.max(monRect.w - MONITOR_BEZEL * 2, 10),
      h: Math.max(monRect.h - MONITOR_BEZEL * 2 - 10, 10)
    };
  }

  function getDesktopRect(setupIndex) {
    const { colWidths, rowHeights } = GRID.calcDimensions(setupIndex);
    return GRID.desktopRect(setupIndex, colWidths, rowHeights);
  }

  function getDesktopMonitorRect(setupIndex, itemId) {
    const desktopRect = getDesktopRect(setupIndex);
    if (!desktopRect) return null;

    const item = STATE.getDesktopMonitors(setupIndex).find(entry => entry.id === itemId);
    if (!item) return null;

    const monitor = CATALOG.find(entry => entry.id === item.monitorId && entry.category !== 'equipment');
    if (!monitor) return null;

    const isPortrait = item.orientation === 'portrait';
    return {
      x: desktopRect.x + GRID.mmToDisplay(item.x_mm),
      y: desktopRect.y + GRID.mmToDisplay(item.y_mm),
      w: GRID.mmToDisplay(isPortrait ? monitor.physicalHeight_mm : monitor.physicalWidth_mm),
      h: GRID.mmToDisplay(isPortrait ? monitor.physicalWidth_mm : monitor.physicalHeight_mm)
    };
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
    const { width, height } = GRID.svgSize(colWidths, rowHeights, setupIndex);

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

    // Draw desktop background first so monitors are never hidden behind it.
    _drawDesktopBackground(svg, setupIndex, colWidths, rowHeights);

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

    _drawDesktopOverlay(svg, setupIndex, colWidths, rowHeights);
  }

  function _drawDesktopBackground(svg, setupIndex, colWidths, rowHeights) {
    const desktopRect = GRID.desktopRect(setupIndex, colWidths, rowHeights);
    if (!desktopRect) return;

    const setup = STATE.getSetup(setupIndex);
    const desktopGroup = el('g', {
      'data-setup': setupIndex,
      'data-role': 'desktop'
    });

    const surface = el('rect', {
      x: desktopRect.x,
      y: desktopRect.y,
      width: desktopRect.w,
      height: desktopRect.h,
      rx: 10,
      'data-setup': setupIndex,
      'data-role': 'desktop-surface'
    }, 'desktop-surface');
    if (DRAG.attachDesktopSurfaceDrag) {
      DRAG.attachDesktopSurfaceDrag(surface, setupIndex);
    }
    desktopGroup.appendChild(surface);

    const reservedDepthPx = Math.min(
      GRID.mmToDisplay(setup.desktopConfig.reservedDepth_mm),
      Math.max(desktopRect.h - 12, 0)
    );
    if (reservedDepthPx > 8) {
      const reservedZone = el('rect', {
        x: desktopRect.x + 6,
        y: desktopRect.y + 6,
        width: Math.max(desktopRect.w - 12, 10),
        height: reservedDepthPx,
        rx: 6
      }, 'desktop-stands-reserved-zone');
      desktopGroup.appendChild(reservedZone);

      const reservedLabel = text(
        `Reserved for screen stands (~${setup.desktopConfig.reservedDepth_mm} mm)`,
        desktopRect.x + desktopRect.w / 2,
        desktopRect.y + 24,
        'desktop-stands-reserved-label',
        { 'text-anchor': 'middle' }
      );
      desktopGroup.appendChild(reservedLabel);
    }

    const title = text('Desktop Surface', desktopRect.x + 10, desktopRect.y + 18, 'desktop-label', {
      'text-anchor': 'start'
    });
    desktopGroup.appendChild(title);

    const sizeText = text(
      `${setup.desktopConfig.width_mm}×${setup.desktopConfig.height_mm} mm`,
      desktopRect.x + desktopRect.w - 10,
      desktopRect.y + 18,
      'desktop-label',
      { 'text-anchor': 'end' }
    );
    desktopGroup.appendChild(sizeText);

    svg.appendChild(desktopGroup);
  }

  function _drawDesktopOverlay(svg, setupIndex, colWidths, rowHeights) {
    const desktopRect = GRID.desktopRect(setupIndex, colWidths, rowHeights);
    if (!desktopRect) return;

    const overlay = el('g', {
      'data-setup': setupIndex,
      'data-role': 'desktop-overlay'
    });

    const equipment = STATE.getDesktopEquipment(setupIndex);
    equipment.forEach(item => _drawDesktopEquipment(overlay, setupIndex, desktopRect, item));

    const desktopMonitors = STATE.getDesktopMonitors(setupIndex);
    desktopMonitors.forEach(item => _drawDesktopMonitor(overlay, setupIndex, desktopRect, item));

    svg.appendChild(overlay);
  }

  function _drawDesktopEquipment(parentGroup, setupIndex, desktopRect, item) {
    const equipment = CATALOG.find(entry => entry.id === item.equipmentId && entry.category === 'equipment');
    if (!equipment) return;

    const x = desktopRect.x + GRID.mmToDisplay(item.x_mm);
    const y = desktopRect.y + GRID.mmToDisplay(item.y_mm);
    const w = GRID.mmToDisplay(equipment.physicalWidth_mm);
    const h = GRID.mmToDisplay(equipment.physicalHeight_mm);

    const g = el('g', {
      'data-setup': setupIndex,
      'data-role': 'desktop-equipment',
      'data-equipment-instance-id': item.id,
      'data-equipment-id': item.equipmentId
    });
    g.style.cursor = 'grab';

    const body = el('rect', {
      x,
      y,
      width: w,
      height: h,
      rx: equipment.type === 'mouse' ? Math.max(8, Math.round(Math.min(w, h) * 0.3)) : 6
    }, 'desktop-equipment-body');
    g.appendChild(body);

    // Render custom label if present, otherwise show model name
    if (item.label && item.label.trim()) {
      // Show custom label as primary
      const customLabel = text(item.label, x + w / 2, y + h / 2 - 2, 'desktop-equipment-label-custom', {
        'text-anchor': 'middle',
        'font-weight': 'bold'
      });
      g.appendChild(customLabel);

      // Show model name as secondary, smaller
      const modelLabel = text(equipment.modelName, x + w / 2, y + h / 2 + 10, 'desktop-equipment-label-model', {
        'text-anchor': 'middle',
        'font-size': '0.8em',
        'opacity': '0.7'
      });
      g.appendChild(modelLabel);
    } else {
      // Show only model name if no custom label
      const label = text(equipment.modelName, x + w / 2, y + h / 2 + 4, 'desktop-equipment-label', {
        'text-anchor': 'middle'
      });
      g.appendChild(label);
    }

    if (DRAG.attachDesktopEquipmentDrag) {
      DRAG.attachDesktopEquipmentDrag(g, setupIndex, item.id);
    }
    parentGroup.appendChild(g);
  }

  function _drawDesktopMonitor(parentGroup, setupIndex, desktopRect, item) {
    const monitor = CATALOG.find(entry => entry.id === item.monitorId && entry.category !== 'equipment');
    if (!monitor) return;

    const isPortrait = item.orientation === 'portrait';
    const x = desktopRect.x + GRID.mmToDisplay(item.x_mm);
    const y = desktopRect.y + GRID.mmToDisplay(item.y_mm);
    const w = GRID.mmToDisplay(isPortrait ? monitor.physicalHeight_mm : monitor.physicalWidth_mm);
    const h = GRID.mmToDisplay(isPortrait ? monitor.physicalWidth_mm : monitor.physicalHeight_mm);

    const g = el('g', {
      'data-setup': setupIndex,
      'data-role': 'desktop-monitor',
      'data-desktop-monitor-instance-id': item.id,
      'data-monitor-id': item.monitorId
    });
    g.style.cursor = 'grab';

    const BEZEL = 6;
    const body = el('rect', {
      x,
      y,
      width: w,
      height: h,
      rx: 4
    }, 'monitor-body desktop-monitor-body');
    g.appendChild(body);

    const screen = el('rect', {
      x: x + BEZEL,
      y: y + BEZEL,
      width: Math.max(w - BEZEL * 2, 10),
      height: Math.max(h - BEZEL * 2 - 10, 10),
      rx: 2
    }, 'monitor-screen');
    g.appendChild(screen);

    const screenRect = {
      x: x + BEZEL,
      y: y + BEZEL,
      w: Math.max(w - BEZEL * 2, 10),
      h: Math.max(h - BEZEL * 2 - 10, 10)
    };
    _drawDesktopMonitorTestMedia(g, setupIndex, item, screenRect);

    const sizeLabel = text(`${monitor.size}"`, x + w / 2, y + h / 2 - 14, 'monitor-label-size', {
      'text-anchor': 'middle'
    });
    g.appendChild(sizeLabel);

    const resText = item.selectedResolution
      ? `${isPortrait ? item.selectedResolution.height : item.selectedResolution.width}×${isPortrait ? item.selectedResolution.width : item.selectedResolution.height}${monitor.aspectRatio ? `, ${monitor.aspectRatio}` : ''}`
      : '';
    const resLabel = text(resText, x + w / 2, y + h / 2 + 14, 'monitor-label-res', {
      'text-anchor': 'middle'
    });
    g.appendChild(resLabel);

    const brandLabel = text(monitor.brand, x + w / 2, y + h / 2 + 30, 'monitor-label-brand', {
      'text-anchor': 'middle'
    });
    g.appendChild(brandLabel);

    g.addEventListener('click', e => {
      e.stopPropagation();
      if (typeof POPOVER !== 'undefined' && POPOVER.showDesktopMonitor) {
        POPOVER.showDesktopMonitor(setupIndex, item.id, g.getBoundingClientRect());
      }
    });

    if (DRAG.attachDesktopMonitorDrag) {
      DRAG.attachDesktopMonitorDrag(g, setupIndex, item.id);
    }

    parentGroup.appendChild(g);
  }

  function _drawDesktopMonitorTestMedia(group, setupIndex, desktopItem, screenRect) {
    if (!(typeof TEST_MEDIA !== 'undefined' && TEST_MEDIA.isEnabled && TEST_MEDIA.isEnabled())) {
      return;
    }

    const ref = desktopItem.monitorTestMediaRef;
    if (!ref || !ref.assetId) return;

    const cx = screenRect.x + screenRect.w / 2;
    const cy = screenRect.y + screenRect.h / 2;
    const asset = TEST_MEDIA.getById ? TEST_MEDIA.getById(ref.assetId) : null;
    if (!asset || !asset.dataUrl) {
      const missing = text('Missing test media', cx, cy, 'test-media-missing');
      group.appendChild(missing);
      return;
    }

    const res = desktopItem.selectedResolution || { width: 1920, height: 1080 };
    const isPortrait = desktopItem.orientation === 'portrait';
    const resW = isPortrait ? res.height : res.width;
    const resH = isPortrait ? res.width : res.height;
    const hasSize = asset.width > 0 && asset.height > 0;
    const scaleX = hasSize ? asset.width / resW : 1;
    const scaleY = hasSize ? asset.height / resH : 1;
    const scalingMode = desktopItem.monitorTestMediaScalingMode || 'center';

    let finalScaleX;
    let finalScaleY;
    if (scalingMode === 'full') {
      finalScaleX = scaleX;
      finalScaleY = scaleY;
    } else if (scalingMode === 'aspect') {
      const fitScale = Math.min(scaleX, scaleY);
      finalScaleX = fitScale;
      finalScaleY = fitScale;
    } else {
      finalScaleX = scaleX;
      finalScaleY = scaleY;
    }

    const imgW = Math.max(1, screenRect.w * finalScaleX);
    const imgH = Math.max(1, screenRect.h * finalScaleY);
    const imgX = screenRect.x + (screenRect.w - imgW) / 2;
    const imgY = screenRect.y + (screenRect.h - imgH) / 2;

    const bg = el('rect', {
      x: screenRect.x,
      y: screenRect.y,
      width: screenRect.w,
      height: screenRect.h,
      fill: 'rgba(0,0,0,0.55)'
    }, 'test-media-letterbox');
    group.appendChild(bg);

    const clipId = `tm-clip-desktop-${setupIndex}-${desktopItem.id}`;
    const clipPath = el('clipPath', { id: clipId });
    clipPath.appendChild(el('rect', {
      x: screenRect.x,
      y: screenRect.y,
      width: screenRect.w,
      height: screenRect.h
    }));
    group.appendChild(clipPath);

    const img = el('image', {
      x: imgX,
      y: imgY,
      width: imgW,
      height: imgH,
      href: asset.dataUrl,
      preserveAspectRatio: scalingMode === 'full' ? 'none' : 'xMidYMid meet',
      'clip-path': `url(#${clipId})`
    }, 'test-media-overlay-image');
    group.appendChild(img);

    const label = text(asset.name || 'Test media', cx, screenRect.y + 12, 'test-media-overlay-label');
    group.appendChild(label);
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
    const rootStyles = getComputedStyle(document.documentElement);
    const fontScale = parseFloat(rootStyles.getPropertyValue('--font-scale')) || 0.7;
    const scaledHintSize = Math.max(8, Math.round(20 * fontScale));
    hint.setAttribute('font-size', String(scaledHintSize));
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
    const body = el('rect', {
      x: monRect.x, y: monRect.y,
      width: monRect.w, height: monRect.h,
      rx: 4
    }, 'monitor-body' + (selected ? ' selected' : ''));
    g.appendChild(body);

    // Screen area (inner)
    const screen = el('rect', {
      x: monRect.x + MONITOR_BEZEL, y: monRect.y + MONITOR_BEZEL,
      width: Math.max(monRect.w - MONITOR_BEZEL * 2, 10),
      height: Math.max(monRect.h - MONITOR_BEZEL * 2 - 10, 10),
      rx: 2
    }, 'monitor-screen');
    g.appendChild(screen);

    const screenRect = {
      x: monRect.x + MONITOR_BEZEL,
      y: monRect.y + MONITOR_BEZEL,
      w: Math.max(monRect.w - MONITOR_BEZEL * 2, 10),
      h: Math.max(monRect.h - MONITOR_BEZEL * 2 - 10, 10)
    };

    if (cell.windowedAppsEnabled) {
      _drawWindowedApps(g, setupIndex, row, col, cell, screenRect);
    } else {
      _drawTestMediaOverlays(g, setupIndex, row, col, cell, screenRect);
    }

    // Size label
    const hasPip = !!(cell.pipZones && cell.pipZones.length && monitor.pipSupported);
    const pipPortrait = hasPip && cell.orientation === 'portrait';
    const cx = monRect.x + monRect.w / 2;
    const cy = monRect.y + monRect.h / 2;

    const pipScreenTop = monRect.y + MONITOR_BEZEL;
    const pipScreenBottom = monRect.y + monRect.h - MONITOR_BEZEL - 10;
    const infoBgW = Math.max(Math.min(monRect.w - MONITOR_BEZEL * 2 - 10, 190), 90);
    const infoBgH = 36;
    const infoBgX = monRect.x + MONITOR_BEZEL + 4;
    const infoBgY = pipPortrait
      ? (pipScreenBottom - infoBgH - 4)
      : (pipScreenTop + 4);

    const infoX = hasPip ? (infoBgX + 6) : cx;
    const sizeY = hasPip ? (infoBgY + 10) : (cy - 12);
    const resY = hasPip ? (sizeY + 18) : (cy + 12);
    const brandY = hasPip ? (resY + 15) : (cy + 28);
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
        x: monRect.x + MONITOR_BEZEL, y: monRect.y + MONITOR_BEZEL,
        width: monRect.w - MONITOR_BEZEL * 2, height: monRect.h - MONITOR_BEZEL * 2 - 10,
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
    if (cell.windowedAppsEnabled && DRAG.attachWindowedAppInteraction) {
      DRAG.attachWindowedAppInteraction(g, setupIndex, row, col);
    }

    svg.appendChild(g);
  }

  function _drawWindowedApps(group, setupIndex, row, col, cell, screenRect) {
    if (!(typeof TEST_MEDIA !== 'undefined' && TEST_MEDIA.isEnabled && TEST_MEDIA.isEnabled())) {
      return;
    }
    if (!Array.isArray(cell.windowedApps) || !cell.windowedApps.length) return;

    const res = cell.selectedResolution || { width: 1920, height: 1080 };
    const isPortrait = cell.orientation === 'portrait';
    const resW = Math.max(1, isPortrait ? res.height : res.width);
    const resH = Math.max(1, isPortrait ? res.width : res.height);
    const scaleX = screenRect.w / resW;
    const scaleY = screenRect.h / resH;

    const clipId = `wapp-clip-${setupIndex}-${row}-${col}`;
    const clipPath = el('clipPath', { id: clipId });
    clipPath.appendChild(el('rect', {
      x: screenRect.x,
      y: screenRect.y,
      width: screenRect.w,
      height: screenRect.h
    }));
    group.appendChild(clipPath);

    const layer = el('g', {
      'data-role': 'windowed-apps-layer',
      'clip-path': `url(#${clipId})`
    });

    cell.windowedApps.forEach(app => {
      const asset = TEST_MEDIA.getById ? TEST_MEDIA.getById(app.assetId) : null;
      if (!asset || !asset.dataUrl) return;

      const svgX = screenRect.x + app.x * scaleX;
      const svgY = screenRect.y + app.y * scaleY;
      const svgW = Math.max(6, app.w * scaleX);
      const svgH = Math.max(6, app.h * scaleY);

      const img = el('image', {
        x: svgX,
        y: svgY,
        width: svgW,
        height: svgH,
        href: asset.dataUrl,
        preserveAspectRatio: 'none',
        'data-role': 'windowed-app',
        'data-app-id': app.id
      }, 'windowed-app-image');
      layer.appendChild(img);

      const border = el('rect', {
        x: svgX,
        y: svgY,
        width: svgW,
        height: svgH,
        'data-role': 'windowed-app',
        'data-app-id': app.id
      }, 'windowed-app-border');
      layer.appendChild(border);

      const closeX = svgX + svgW - 15;
      const closeY = svgY + 1;
      const closeBtn = el('rect', {
        x: closeX,
        y: closeY,
        width: 14,
        height: 14,
        rx: 2,
        'data-role': 'windowed-app-close',
        'data-app-id': app.id
      }, 'windowed-app-close');
      layer.appendChild(closeBtn);

      const closeTxt = text('×', closeX + 7, closeY + 8, 'windowed-app-close-text', {
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'data-role': 'windowed-app-close',
        'data-app-id': app.id
      });
      layer.appendChild(closeTxt);

      const resize = el('rect', {
        x: svgX + svgW - 8,
        y: svgY + svgH - 8,
        width: 8,
        height: 8,
        'data-role': 'windowed-app-resize',
        'data-app-id': app.id
      }, 'windowed-app-resize-handle');
      layer.appendChild(resize);
    });

    group.appendChild(layer);
  }

  function _drawTestMediaOverlays(group, setupIndex, row, col, cell, screenRect) {
    if (!(typeof TEST_MEDIA !== 'undefined' && TEST_MEDIA.isEnabled && TEST_MEDIA.isEnabled())) {
      return;
    }

    const cx = screenRect.x + screenRect.w / 2;
    const cy = screenRect.y + screenRect.h / 2;

    const monitorRef = cell.monitorTestMediaRef;
    if (monitorRef && monitorRef.assetId) {
      const asset = TEST_MEDIA.getById(monitorRef.assetId);
      if (asset && asset.dataUrl) {
        // Effective monitor resolution accounting for portrait rotation
        const res = cell.selectedResolution || { width: 1920, height: 1080 };
        const isPortrait = cell.orientation === 'portrait';
        const resW = isPortrait ? res.height : res.width;
        const resH = isPortrait ? res.width  : res.height;

        // Fraction of the monitor's pixel grid that the test image covers.
        // Fall back to filling the screen when dimensions are not stored (legacy assets).
        const hasSize = asset.width > 0 && asset.height > 0;
        const scaleX = hasSize ? asset.width  / resW : 1;
        const scaleY = hasSize ? asset.height / resH : 1;
        const scalingMode = cell.monitorTestMediaScalingMode || 'center';

        // center  — no scaling, 1:1 relative coverage, borders visible
        // aspect  — scale uniformly to fit, preserve aspect ratio (may letterbox/pillarbox)
        // full    — stretch to fill the entire screen area, matching "Full panel" GPU scaling
        let finalScaleX, finalScaleY;
        if (scalingMode === 'full') {
          finalScaleX = scaleX;
          finalScaleY = scaleY;
        } else if (scalingMode === 'aspect') {
          const fitScale = Math.min(scaleX, scaleY);
          finalScaleX = fitScale;
          finalScaleY = fitScale;
        } else {
          // center: show at true 1:1 pixel coverage relative to the selected resolution
          finalScaleX = scaleX;
          finalScaleY = scaleY;
        }

        const imgW = Math.max(1, screenRect.w * finalScaleX);
        const imgH = Math.max(1, screenRect.h * finalScaleY);
        const imgX = screenRect.x + (screenRect.w - imgW) / 2;
        const imgY = screenRect.y + (screenRect.h - imgH) / 2;

        // Dark letterbox / pillarbox background so bars are clearly visible
        const bg = el('rect', {
          x: screenRect.x, y: screenRect.y,
          width: screenRect.w, height: screenRect.h,
          fill: 'rgba(0,0,0,0.55)'
        }, 'test-media-letterbox');
        group.appendChild(bg);

        // Clip image to screen bounds (handles overscan when scale > 1)
        const clipId = `tm-clip-${setupIndex}-${row}-${col}`;
        const clipPath = el('clipPath', { id: clipId });
        clipPath.appendChild(el('rect', {
          x: screenRect.x, y: screenRect.y,
          width: screenRect.w, height: screenRect.h
        }));
        group.appendChild(clipPath);

        const img = el('image', {
          x: imgX, y: imgY,
          width: imgW, height: imgH,
          href: asset.dataUrl,
          preserveAspectRatio: scalingMode === 'full' ? 'none' : 'xMidYMid meet',
          'clip-path': `url(#${clipId})`
        }, 'test-media-overlay-image');
        group.appendChild(img);

        const label = text(asset.name || 'Test media', cx, screenRect.y + 12, 'test-media-overlay-label');
        group.appendChild(label);
      } else {
        const missing = text('Missing test media', cx, cy, 'test-media-missing');
        group.appendChild(missing);
      }
    }

    (cell.pipZones || []).forEach((zone, zIdx) => {
      if (!zone.testMediaRef || !zone.testMediaRef.assetId) return;
      const asset = TEST_MEDIA.getById(zone.testMediaRef.assetId);
      if (asset && asset.dataUrl) {
        // The zone covers a proportional slice of the monitor's resolution.
        // Compute that slice so we can scale the test image the same way as on
        // the full monitor surface.
        const res = cell.selectedResolution || { width: 1920, height: 1080 };
        const isPortrait = cell.orientation === 'portrait';
        const resW = isPortrait ? res.height : res.width;
        const resH = isPortrait ? res.width  : res.height;
        const zoneResW = resW * (zone.w / screenRect.w);
        const zoneResH = resH * (zone.h / screenRect.h);

        const hasSize = asset.width > 0 && asset.height > 0;
        const scaleX = hasSize ? asset.width  / zoneResW : 1;
        const scaleY = hasSize ? asset.height / zoneResH : 1;
        const scalingMode = cell.monitorTestMediaScalingMode || 'center';

        let finalScaleX, finalScaleY;
        if (scalingMode === 'full') {
          finalScaleX = scaleX;
          finalScaleY = scaleY;
        } else if (scalingMode === 'aspect') {
          const fitScale = Math.min(scaleX, scaleY);
          finalScaleX = fitScale;
          finalScaleY = fitScale;
        } else {
          finalScaleX = scaleX;
          finalScaleY = scaleY;
        }

        const imgW = Math.max(1, zone.w * finalScaleX);
        const imgH = Math.max(1, zone.h * finalScaleY);
        const imgX = zone.x + (zone.w - imgW) / 2;
        const imgY = zone.y + (zone.h - imgH) / 2;

        // Dark letterbox bars within the zone
        const zoneBg = el('rect', {
          x: zone.x, y: zone.y,
          width: Math.max(zone.w, 4), height: Math.max(zone.h, 4),
          fill: 'rgba(0,0,0,0.55)'
        }, 'test-media-letterbox');
        group.appendChild(zoneBg);

        const zoneClipId = `tm-clip-${setupIndex}-${row}-${col}-z${zIdx}`;
        const zoneClip = el('clipPath', { id: zoneClipId });
        zoneClip.appendChild(el('rect', {
          x: zone.x, y: zone.y,
          width: Math.max(zone.w, 4), height: Math.max(zone.h, 4)
        }));
        group.appendChild(zoneClip);

        const img = el('image', {
          x: imgX, y: imgY,
          width: imgW, height: imgH,
          href: asset.dataUrl,
          preserveAspectRatio: scalingMode === 'full' ? 'none' : 'xMidYMid meet',
          'clip-path': `url(#${zoneClipId})`
        }, 'test-media-overlay-image');
        group.appendChild(img);
      } else {
        const zx = zone.x + zone.w / 2;
        const zy = zone.y + zone.h / 2;
        const missing = text('Missing zone media', zx, zy, 'test-media-missing');
        group.appendChild(missing);
      }
    });
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

  function openCellPopover(setupIndex, row, col, zoneId) {
    const svg = svgEls[setupIndex];
    if (!svg || !STATE.getCell(setupIndex, row, col)) return;

    STATE.setSelected(setupIndex, row, col);
    if (zoneId && STATE.setSelectedZone) {
      STATE.setSelectedZone(setupIndex, row, col, zoneId);
    }
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
    getScreenRect,
    getDesktopRect,
    getDesktopMonitorRect,
    openCellPopover,
    zoomIn,
    zoomOut,
    resetManualZoom,
    setDropAreasVisible,
    isDropAreasVisible
  };
})();
