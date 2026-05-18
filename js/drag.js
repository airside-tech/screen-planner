/**
 * drag.js — Drag-and-drop handling.
 *
 * Two drag sources:
 *  1. Catalog cards (sidebar) → empty SVG cell  (HTML5 drag API, data-monitor-id)
 *  2. Monitor cells (SVG)     → any SVG cell     (mousedown + mousemove for SVG drag)
 *
 * Drop targets: SVG <g data-role="empty-cell"> and <g data-role="monitor">
 *
 * A fixed transparent overlay <div> follows the cursor during SVG drags
 * to provide visual ghost feedback, since SVG drag-image isn't configurable.
 */

/* global CATALOG, STATE, GRID, CANVAS, POPOVER, TEST_MEDIA, DESKTOP_COLLISION */

const DRAG = (() => {
  // ---- State ----
  let _activeSource = null; // { type:'catalog'|'equipment'|'monitor'|'desktop-monitor'|'test-media', monitorId?, equipmentId?, assetId?, setupIndex?, row?, col? }
  let _ghost = null;        // ghost div
  let _dropAreasPrefBeforeDrag = null;

  // ---- Init ----
  function init() {
    // Deselect on canvas background click
    document.addEventListener('click', e => {
      if (!e.target.closest('[data-role="monitor"]') &&
          !e.target.closest('[data-role="desktop-monitor"]') &&
          !e.target.closest('.popover') &&
          !e.target.closest('.label-tooltip') &&
          !e.target.closest('.screen-label')) {
        STATE.setSelected(null, null, null);
      }
    });
  }

  /* ================================================================
     CATALOG → CANVAS  (HTML5 drag API on catalog cards)
     ================================================================ */

  /**
   * Called by UI when rendering a catalog card.
   * @param {HTMLElement} cardEl
   * @param {string} monitorId
   */
  function attachCatalogDrag(cardEl, monitorId, sourceCategory) {
    const category = sourceCategory === 'equipment' ? 'equipment' : 'monitor';
    cardEl.setAttribute('draggable', 'true');

    cardEl.addEventListener('dragstart', e => {
      if (category === 'equipment') {
        _activeSource = { type: 'equipment', equipmentId: monitorId };
      } else {
        _activeSource = { type: 'catalog', monitorId };
      }
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', monitorId);
      cardEl.classList.add('dragging');
      _beginDragDropAreaSession();
      _highlightAllEmpty();
    });

    cardEl.addEventListener('dragend', () => {
      cardEl.classList.remove('dragging');
      _clearAllHighlights();
      _activeSource = null;
      _endDragDropAreaSession();
    });
  }

  /**
   * Called by UI when rendering a test-media card.
   * @param {HTMLElement} cardEl
   * @param {string} assetId
   */
  function attachTestMediaDrag(cardEl, assetId) {
    cardEl.setAttribute('draggable', 'true');

    cardEl.addEventListener('dragstart', e => {
      _activeSource = { type: 'test-media', assetId };
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', assetId);
      cardEl.classList.add('dragging');
      _beginDragDropAreaSession();
    });

    cardEl.addEventListener('dragend', () => {
      cardEl.classList.remove('dragging');
      _clearAllHighlights();
      _activeSource = null;
      _endDragDropAreaSession();
    });
  }

  /**
   * Wire SVG element as a drop target (both catalog and monitor drags).
   * Called once after SVG is present in DOM — we use event delegation on each SVG.
   */
  function attachSvgDropTargets() {
    for (let si = 0; si <= 1; si++) {
      const svg = CANVAS.getSvg(si);
      if (!svg) continue;

      // Re-attach via event delegation (survives re-renders)
      svg.removeEventListener('dragover',  svg._dragover);
      svg.removeEventListener('dragleave', svg._dragleave);
      svg.removeEventListener('drop',      svg._drop);

      svg._dragover = e => _onSvgDragOver(e, si);
      svg._dragleave = () => CANVAS.clearHighlights(si);
      svg._drop = e => _onSvgDrop(e, si);

      svg.addEventListener('dragover',  svg._dragover);
      svg.addEventListener('dragleave', svg._dragleave);
      svg.addEventListener('drop',      svg._drop);
    }
  }

  function _getCellFromEvent(e, setupIndex) {
    // Walk up from event target to find data-role
    let node = e.target;
    while (node && node.tagName !== 'svg') {
      if (node.dataset && node.dataset.role) {
        return {
          role: node.dataset.role,
          row: parseInt(node.dataset.row, 10),
          col: parseInt(node.dataset.col, 10),
          setupIndex: parseInt(node.dataset.setup, 10),
          zoneId: node.dataset.zoneId || null
        };
      }
      node = node.parentElement;
    }
    return null;
  }

  function _onSvgDragOver(e, setupIndex) {
    if (!_activeSource) return;
    e.preventDefault();

    const hit = _getCellFromEvent(e, setupIndex);
    if (!hit) return;

    const isEmpty = hit.role === 'empty-cell';
    const isMonitor = hit.role === 'monitor';
    const isPipZone = hit.role === 'pip-zone';
    const isDesktop = hit.role === 'desktop' || hit.role === 'desktop-equipment' ||
      hit.role === 'desktop-monitor' || hit.role === 'desktop-surface';

    if (isEmpty && _activeSource.type === 'catalog') {
      e.dataTransfer.dropEffect = 'copy';
      CANVAS.highlightCell(setupIndex, hit.row, hit.col, true);
    } else if (isDesktop && _activeSource.type === 'catalog') {
      e.dataTransfer.dropEffect = 'copy';
    } else if ((isMonitor || isPipZone) && _activeSource.type === 'monitor') {
      // can drop on occupied cell → swap
      e.dataTransfer.dropEffect = 'move';
    } else if ((isMonitor || isPipZone) && _activeSource.type === 'test-media') {
      e.dataTransfer.dropEffect = 'copy';
    } else if (isDesktop && _activeSource.type === 'equipment') {
      e.dataTransfer.dropEffect = 'copy';
    } else {
      e.dataTransfer.dropEffect = 'none';
    }
  }

  function _onSvgDrop(e, setupIndex) {
    e.preventDefault();
    CANVAS.clearHighlights(setupIndex);

    const hit = _getCellFromEvent(e, setupIndex);
    if (!hit) return;

    if (_activeSource && _activeSource.type === 'catalog') {
      if (hit.role === 'empty-cell') {
        const placed = STATE.placeMonitor(setupIndex, hit.row, hit.col, _activeSource.monitorId);
        if (!placed) {
          _showGridFullToast();
        } else {
          CANVAS.openCellPopover(setupIndex, hit.row, hit.col);
        }
      } else if (hit.role === 'desktop' || hit.role === 'desktop-equipment' || hit.role === 'desktop-surface' || hit.role === 'desktop-monitor') {
        const targetSetup = Number.isInteger(hit.setupIndex) ? hit.setupIndex : setupIndex;
        const candidate = _pointerToDesktopMonitorCoords(
          e.clientX,
          e.clientY,
          targetSetup,
          _activeSource.monitorId,
          'landscape'
        );
        if (!candidate) {
          _showToast('Enable desktop view for this setup before placing monitor on desktop.');
        } else {
          const snapped = DESKTOP_COLLISION.findNearestFreeMonitorPosition(
            targetSetup,
            _activeSource.monitorId,
            'landscape',
            candidate.x_mm,
            candidate.y_mm,
            null
          );
          if (!snapped) {
            _showToast('No free space available for this monitor on desktop.');
          } else {
            const monitor = CATALOG.find(m => m.id === _activeSource.monitorId && m.category !== 'equipment');
            STATE.addDesktopMonitor(
              targetSetup,
              _activeSource.monitorId,
              monitor ? monitor.resolutions[0] : null,
              'landscape',
              snapped.x_mm,
              snapped.y_mm
            );
          }
        }
      }
    } else if (_activeSource && _activeSource.type === 'monitor') {
      if (hit.role !== 'monitor' && hit.role !== 'pip-zone') {
        _activeSource = null;
        _endDragDropAreaSession();
        return;
      }
      STATE.moveMonitor(
        _activeSource.setupIndex, _activeSource.row, _activeSource.col,
        setupIndex, hit.row, hit.col
      );
    } else if (_activeSource && _activeSource.type === 'test-media') {
      if (!(typeof TEST_MEDIA !== 'undefined' && TEST_MEDIA.isEnabled && TEST_MEDIA.isEnabled())) {
        _showToast('Test media feature is disabled.');
      } else if (hit.role === 'empty-cell') {
        _showToast('Place a monitor first before dropping test media.');
      } else if (hit.role === 'pip-zone' && hit.zoneId) {
        STATE.setZoneTestMedia(setupIndex, hit.row, hit.col, hit.zoneId, _activeSource.assetId);
        CANVAS.openCellPopover(setupIndex, hit.row, hit.col, hit.zoneId);
      } else if (hit.role === 'monitor') {
        STATE.setMonitorTestMedia(setupIndex, hit.row, hit.col, _activeSource.assetId);
        CANVAS.openCellPopover(setupIndex, hit.row, hit.col);
      }
    } else if (_activeSource && _activeSource.type === 'equipment') {
      const isDesktopHit = hit.role === 'desktop' ||
        hit.role === 'desktop-equipment' ||
        hit.role === 'desktop-surface' ||
        hit.role === 'desktop-monitor';
      if (!isDesktopHit) {
        _activeSource = null;
        _endDragDropAreaSession();
        return;
      }

      const targetSetup = Number.isInteger(hit.setupIndex) ? hit.setupIndex : setupIndex;
      const candidate = _pointerToDesktopCoords(
        e.clientX,
        e.clientY,
        targetSetup,
        _activeSource.equipmentId
      );
      if (!candidate) {
        _showToast('Enable desktop view for this setup before placing equipment.');
      } else {
        const snapped = DESKTOP_COLLISION.findNearestFreePosition(
          targetSetup,
          _activeSource.equipmentId,
          candidate.x_mm,
          candidate.y_mm,
          null
        );

        if (!snapped) {
          _showToast('No free space available for this equipment.');
        } else {
          STATE.addDesktopEquipment(targetSetup, _activeSource.equipmentId, snapped.x_mm, snapped.y_mm);
        }
      }
    }

    _activeSource = null;
    _endDragDropAreaSession();
  }

  /* ================================================================
     MONITOR → CANVAS  (SVG mousedown drag)
     ================================================================ */

  function attachMonitorDrag(groupEl, setupIndex, row, col) {
    let _dragging = false;
    let _startX, _startY;
    let _startOffsetX = 0;
    let _startOffsetY = 0;
    let _dragPreviewDX = 0;
    let _dragPreviewDY = 0;
    const DRAG_THRESHOLD = 6; // px

    const _clearDragPreview = () => {
      _dragPreviewDX = 0;
      _dragPreviewDY = 0;
      groupEl.removeAttribute('transform');
      groupEl.style.pointerEvents = '';
    };

    groupEl.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      _startX = e.clientX;
      _startY = e.clientY;
      const startCell = STATE.getCell(setupIndex, row, col);
      _startOffsetX = startCell ? (startCell.offsetX || 0) : 0;
      _startOffsetY = startCell ? (startCell.offsetY || 0) : 0;
      _dragging = false;

      const onMouseMove = mv => {
        const dx = Math.abs(mv.clientX - _startX);
        const dy = Math.abs(mv.clientY - _startY);
        if (!_dragging && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
          _dragging = true;
          groupEl.classList.add('monitor-dragging');
          document.body.classList.add('is-dragging-monitor');
          const selection = window.getSelection ? window.getSelection() : null;
          if (selection && selection.removeAllRanges) selection.removeAllRanges();
          if (typeof POPOVER !== 'undefined' && POPOVER.getCurrent && POPOVER.getCurrent()) {
            POPOVER.hide();
          }
          groupEl.style.pointerEvents = 'none';
          _activeSource = { type: 'monitor', setupIndex, row, col };
          _createGhost(mv, setupIndex, row, col);
          // Enable HTML5 dragover on SVGs by setting draggable
          _makeSvgsDraggable(true);
        }
        if (_dragging && _ghost) {
          _ghost.style.left = mv.clientX + 12 + 'px';
          _ghost.style.top  = mv.clientY + 12 + 'px';

          const metrics = CANVAS.getRenderMetrics(setupIndex);
          const zoom = metrics ? metrics.zoom : 1;
          _dragPreviewDX = (mv.clientX - _startX) / Math.max(zoom, 0.0001);
          _dragPreviewDY = (mv.clientY - _startY) / Math.max(zoom, 0.0001);
          groupEl.setAttribute('transform', `translate(${_dragPreviewDX} ${_dragPreviewDY})`);
        }
      };

      const onMouseUp = mu => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup',   onMouseUp);

        if (_dragging) {
          groupEl.classList.remove('monitor-dragging');
          document.body.classList.remove('is-dragging-monitor');
          _makeSvgsDraggable(false);
          _removeGhost();
          _clearAllHighlights();
          const finalDX = _dragPreviewDX;
          const finalDY = _dragPreviewDY;
          _clearDragPreview();

          // Find drop target
          const el = document.elementFromPoint(mu.clientX, mu.clientY);
          const hit = _findCellFromElement(el);
          const desktopHit = _findDesktopFromElement(el);
          if (desktopHit) {
            const sourceCell = STATE.getCell(setupIndex, row, col);
            if (sourceCell) {
              const targetSetup = Number.isInteger(desktopHit.setupIndex) ? desktopHit.setupIndex : setupIndex;
              const candidate = _pointerToDesktopMonitorCoords(
                mu.clientX,
                mu.clientY,
                targetSetup,
                sourceCell.monitorId,
                sourceCell.orientation
              );
              if (!candidate) {
                _showToast('Enable desktop view for this setup before placing monitor on desktop.');
              } else {
                const snapped = DESKTOP_COLLISION.findNearestFreeMonitorPosition(
                  targetSetup,
                  sourceCell.monitorId,
                  sourceCell.orientation,
                  candidate.x_mm,
                  candidate.y_mm,
                  null
                );

                if (!snapped) {
                  _showToast('No free space available for this monitor on desktop.');
                } else {
                  STATE.addDesktopMonitor(
                    targetSetup,
                    sourceCell.monitorId,
                    sourceCell.selectedResolution,
                    sourceCell.orientation,
                    snapped.x_mm,
                    snapped.y_mm
                  );
                  STATE.removeMonitor(setupIndex, row, col);
                }
              }
            }
          } else if (hit && !(hit.setupIndex === setupIndex && hit.row === row && hit.col === col)) {
            STATE.moveMonitor(setupIndex, row, col, hit.setupIndex, hit.row, hit.col);
          } else {
            STATE.setMonitorOffset(
              setupIndex,
              row,
              col,
              _startOffsetX + finalDX,
              _startOffsetY + finalDY
            );
          }
          _activeSource = null;
        } else {
          document.body.classList.remove('is-dragging-monitor');
          _clearDragPreview();
        }
        _dragging = false;
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup',   onMouseUp);
    });
  }

  function _findCellFromElement(el) {
    let node = el;
    while (node) {
      if (node.dataset && (node.dataset.role === 'empty-cell' || node.dataset.role === 'monitor')) {
        return {
          role: node.dataset.role,
          setupIndex: parseInt(node.dataset.setup, 10),
          row: parseInt(node.dataset.row,   10),
          col: parseInt(node.dataset.col,   10)
        };
      }
      node = node.parentElement;
    }
    return null;
  }

  function _findDesktopFromElement(el) {
    let node = el;
    while (node) {
      if (node.dataset && (node.dataset.role === 'desktop' || node.dataset.role === 'desktop-equipment' ||
          node.dataset.role === 'desktop-surface' || node.dataset.role === 'desktop-monitor')) {
        return {
          setupIndex: parseInt(node.dataset.setup, 10)
        };
      }
      node = node.parentElement;
    }
    return null;
  }

  function _captureDesktopPointerOffset(clientX, clientY, setupIndex, itemX_mm, itemY_mm) {
    const desktopRect = CANVAS.getDesktopRect(setupIndex);
    const svg = CANVAS.getSvg(setupIndex);
    const metrics = CANVAS.getRenderMetrics(setupIndex);
    if (!desktopRect || !svg || !metrics) return null;

    const svgRect = svg.getBoundingClientRect();
    const zoom = Math.max(metrics.zoom || 1, 0.0001);
    const pxPerMm = GRID.mmToDisplay(1);
    const localX = (clientX - svgRect.left) / zoom;
    const localY = (clientY - svgRect.top) / zoom;

    return {
      x_mm: (localX - desktopRect.x) / pxPerMm - itemX_mm,
      y_mm: (localY - desktopRect.y) / pxPerMm - itemY_mm
    };
  }

  function _pointerToDesktopCoords(clientX, clientY, setupIndex, equipmentId, pointerOffset) {
    const desktopRect = CANVAS.getDesktopRect(setupIndex);
    if (!desktopRect) return null;

    const svg = CANVAS.getSvg(setupIndex);
    const metrics = CANVAS.getRenderMetrics(setupIndex);
    const equipment = CATALOG.find(item => item.id === equipmentId && item.category === 'equipment');
    if (!svg || !metrics || !equipment) return null;

    const svgRect = svg.getBoundingClientRect();
    const zoom = Math.max(metrics.zoom || 1, 0.0001);
    const pxPerMm = GRID.mmToDisplay(1);

    const localX = (clientX - svgRect.left) / zoom;
    const localY = (clientY - svgRect.top) / zoom;

    const offsetX = pointerOffset && Number.isFinite(pointerOffset.x_mm)
      ? pointerOffset.x_mm
      : equipment.physicalWidth_mm / 2;
    const offsetY = pointerOffset && Number.isFinite(pointerOffset.y_mm)
      ? pointerOffset.y_mm
      : equipment.physicalHeight_mm / 2;

    const x_mm = (localX - desktopRect.x) / pxPerMm - offsetX;
    const y_mm = (localY - desktopRect.y) / pxPerMm - offsetY;
    return { x_mm, y_mm };
  }

  function _pointerToDesktopMonitorCoords(clientX, clientY, setupIndex, monitorId, orientation, pointerOffset) {
    const desktopRect = CANVAS.getDesktopRect(setupIndex);
    if (!desktopRect) return null;

    const svg = CANVAS.getSvg(setupIndex);
    const metrics = CANVAS.getRenderMetrics(setupIndex);
    const monitor = CATALOG.find(item => item.id === monitorId && item.category !== 'equipment');
    if (!svg || !metrics || !monitor) return null;

    const svgRect = svg.getBoundingClientRect();
    const zoom = Math.max(metrics.zoom || 1, 0.0001);
    const pxPerMm = GRID.mmToDisplay(1);
    const localX = (clientX - svgRect.left) / zoom;
    const localY = (clientY - svgRect.top) / zoom;

    const isPortrait = orientation === 'portrait';
    const widthMM = isPortrait ? monitor.physicalHeight_mm : monitor.physicalWidth_mm;
    const heightMM = isPortrait ? monitor.physicalWidth_mm : monitor.physicalHeight_mm;
    const offsetX = pointerOffset && Number.isFinite(pointerOffset.x_mm)
      ? pointerOffset.x_mm
      : widthMM / 2;
    const offsetY = pointerOffset && Number.isFinite(pointerOffset.y_mm)
      ? pointerOffset.y_mm
      : heightMM / 2;

    const x_mm = (localX - desktopRect.x) / pxPerMm - offsetX;
    const y_mm = (localY - desktopRect.y) / pxPerMm - offsetY;
    return { x_mm, y_mm };
  }

  function attachDesktopEquipmentDrag(groupEl, setupIndex, equipmentInstanceId) {
    let _dragging = false;
    let _startX = 0;
    let _startY = 0;
    let _previewDX = 0;
    let _previewDY = 0;
    let _pointerOffset = null;
    const DRAG_THRESHOLD = 6;

    const _clearPreview = () => {
      _previewDX = 0;
      _previewDY = 0;
      groupEl.removeAttribute('transform');
      groupEl.style.pointerEvents = '';
    };

    groupEl.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      _startX = e.clientX;
      _startY = e.clientY;
      _dragging = false;
      _pointerOffset = null;

      const sourceItem = STATE.getDesktopEquipment(setupIndex).find(item => item.id === equipmentInstanceId);
      if (sourceItem) {
        _pointerOffset = _captureDesktopPointerOffset(
          e.clientX,
          e.clientY,
          setupIndex,
          sourceItem.x_mm,
          sourceItem.y_mm
        );
      }

      const onMouseMove = mv => {
        const dx = Math.abs(mv.clientX - _startX);
        const dy = Math.abs(mv.clientY - _startY);

        if (!_dragging && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
          _dragging = true;
          groupEl.classList.add('equipment-dragging');
          groupEl.style.pointerEvents = 'none';
          document.body.classList.add('is-dragging-monitor');
          _createGhost(mv, setupIndex, null, null, equipmentInstanceId);
          _makeSvgsDraggable(true);
        }

        if (_dragging && _ghost) {
          _ghost.style.left = mv.clientX + 12 + 'px';
          _ghost.style.top = mv.clientY + 12 + 'px';

          const metrics = CANVAS.getRenderMetrics(setupIndex);
          const zoom = metrics ? metrics.zoom : 1;
          _previewDX = (mv.clientX - _startX) / Math.max(zoom, 0.0001);
          _previewDY = (mv.clientY - _startY) / Math.max(zoom, 0.0001);
          groupEl.setAttribute('transform', `translate(${_previewDX} ${_previewDY})`);
        }
      };

      const onMouseUp = mu => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        if (_dragging) {
          groupEl.classList.remove('equipment-dragging');
          document.body.classList.remove('is-dragging-monitor');
          _makeSvgsDraggable(false);
          _removeGhost();
          _clearAllHighlights();
          _clearPreview();

          const sourceItem = STATE.getDesktopEquipment(setupIndex).find(item => item.id === equipmentInstanceId);
          if (sourceItem) {
            const equipmentId = sourceItem.equipmentId;
            const hitEl = document.elementFromPoint(mu.clientX, mu.clientY);
            const desktopHit = _findDesktopFromElement(hitEl) || { setupIndex };
            const targetSetup = Number.isInteger(desktopHit.setupIndex) ? desktopHit.setupIndex : setupIndex;
            const target = _pointerToDesktopCoords(mu.clientX, mu.clientY, targetSetup, equipmentId, _pointerOffset);

            if (!target) {
              _showToast('Enable desktop view for this setup before placing equipment.');
            } else {
              const exclusion = targetSetup === setupIndex ? equipmentInstanceId : null;
              const snapped = DESKTOP_COLLISION.findNearestFreePosition(
                targetSetup,
                equipmentId,
                target.x_mm,
                target.y_mm,
                exclusion
              );

              if (!snapped) {
                _showToast('No free space available for this equipment.');
              } else if (targetSetup === setupIndex) {
                STATE.moveDesktopEquipment(setupIndex, equipmentInstanceId, snapped.x_mm, snapped.y_mm);
              } else {
                const removed = STATE.removeDesktopEquipment(setupIndex, equipmentInstanceId);
                if (removed) {
                  STATE.addDesktopEquipment(targetSetup, equipmentId, snapped.x_mm, snapped.y_mm);
                }
              }
            }
          }
        } else {
          // Click without dragging - open popover
          document.body.classList.remove('is-dragging-monitor');
          _clearPreview();
          const sourceItem = STATE.getDesktopEquipment(setupIndex).find(item => item.id === equipmentInstanceId);
          if (sourceItem && typeof POPOVER !== 'undefined' && POPOVER.openEquipmentPopover) {
            POPOVER.openEquipmentPopover(setupIndex, equipmentInstanceId, mu.clientX, mu.clientY);
          }
        }
        _dragging = false;
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  function attachDesktopMonitorDrag(groupEl, setupIndex, monitorInstanceId) {
    let _dragging = false;
    let _startX = 0;
    let _startY = 0;
    let _previewDX = 0;
    let _previewDY = 0;
    let _pointerOffset = null;
    const DRAG_THRESHOLD = 6;

    const _clearPreview = () => {
      _previewDX = 0;
      _previewDY = 0;
      groupEl.removeAttribute('transform');
      groupEl.style.pointerEvents = '';
    };

    groupEl.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      _startX = e.clientX;
      _startY = e.clientY;
      _dragging = false;
      _pointerOffset = null;

      const sourceItem = STATE.getDesktopMonitors(setupIndex).find(item => item.id === monitorInstanceId);
      if (sourceItem) {
        _pointerOffset = _captureDesktopPointerOffset(
          e.clientX,
          e.clientY,
          setupIndex,
          sourceItem.x_mm,
          sourceItem.y_mm
        );
      }

      const onMouseMove = mv => {
        const dx = Math.abs(mv.clientX - _startX);
        const dy = Math.abs(mv.clientY - _startY);

        if (!_dragging && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
          _dragging = true;
          groupEl.classList.add('monitor-dragging');
          groupEl.style.pointerEvents = 'none';
          document.body.classList.add('is-dragging-monitor');
          _createGhost(mv, setupIndex, null, null, null, monitorInstanceId);
          _makeSvgsDraggable(true);
        }

        if (_dragging && _ghost) {
          _ghost.style.left = mv.clientX + 12 + 'px';
          _ghost.style.top = mv.clientY + 12 + 'px';

          const metrics = CANVAS.getRenderMetrics(setupIndex);
          const zoom = metrics ? metrics.zoom : 1;
          _previewDX = (mv.clientX - _startX) / Math.max(zoom, 0.0001);
          _previewDY = (mv.clientY - _startY) / Math.max(zoom, 0.0001);
          groupEl.setAttribute('transform', `translate(${_previewDX} ${_previewDY})`);
        }
      };

      const onMouseUp = mu => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        if (_dragging) {
          groupEl.classList.remove('monitor-dragging');
          document.body.classList.remove('is-dragging-monitor');
          _makeSvgsDraggable(false);
          _removeGhost();
          _clearAllHighlights();
          _clearPreview();

          const sourceItem = STATE.getDesktopMonitors(setupIndex).find(item => item.id === monitorInstanceId);
          if (sourceItem) {
            const hitEl = document.elementFromPoint(mu.clientX, mu.clientY);
            const hitCell = _findCellFromElement(hitEl);

            if (hitCell && hitCell.role === 'empty-cell') {
              const placed = STATE.placeMonitor(
                hitCell.setupIndex,
                hitCell.row,
                hitCell.col,
                sourceItem.monitorId
              );

              if (!placed) {
                _showToast('Drop on a free cell to move this desktop monitor back into the grid.');
              } else {
                STATE.setResolution(hitCell.setupIndex, hitCell.row, hitCell.col, sourceItem.selectedResolution);
                STATE.setOrientation(hitCell.setupIndex, hitCell.row, hitCell.col, sourceItem.orientation);
                STATE.removeDesktopMonitor(setupIndex, monitorInstanceId);
                CANVAS.openCellPopover(hitCell.setupIndex, hitCell.row, hitCell.col);
              }
              _dragging = false;
              return;
            }

            const desktopHit = _findDesktopFromElement(hitEl) || { setupIndex };
            const targetSetup = Number.isInteger(desktopHit.setupIndex) ? desktopHit.setupIndex : setupIndex;
            const target = _pointerToDesktopMonitorCoords(
              mu.clientX,
              mu.clientY,
              targetSetup,
              sourceItem.monitorId,
              sourceItem.orientation,
              _pointerOffset
            );

            if (!target) {
              _showToast('Enable desktop view for this setup before placing monitor on desktop.');
            } else {
              const exclusion = targetSetup === setupIndex ? monitorInstanceId : null;
              const snapped = DESKTOP_COLLISION.findNearestFreeMonitorPosition(
                targetSetup,
                sourceItem.monitorId,
                sourceItem.orientation,
                target.x_mm,
                target.y_mm,
                exclusion
              );

              if (!snapped) {
                _showToast('No free space available for this monitor on desktop.');
              } else if (targetSetup === setupIndex) {
                STATE.moveDesktopMonitor(setupIndex, monitorInstanceId, snapped.x_mm, snapped.y_mm);
              } else {
                const removed = STATE.removeDesktopMonitor(setupIndex, monitorInstanceId);
                if (removed) {
                  STATE.addDesktopMonitor(
                    targetSetup,
                    sourceItem.monitorId,
                    sourceItem.selectedResolution,
                    sourceItem.orientation,
                    snapped.x_mm,
                    snapped.y_mm
                  );
                }
              }
            }
          }
        } else {
          document.body.classList.remove('is-dragging-monitor');
          _clearPreview();
        }
        _dragging = false;
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  function attachDesktopSurfaceDrag(surfaceEl, setupIndex) {
    let dragging = false;
    let startX = 0;
    let startOffsetMM = 0;

    surfaceEl.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = false;
      startX = e.clientX;
      const desktop = STATE.getDesktopConfig(setupIndex);
      startOffsetMM = desktop && Number.isFinite(desktop.x_offset_mm) ? desktop.x_offset_mm : 0;

      const onMouseMove = mv => {
        const dx = mv.clientX - startX;
        if (!dragging && Math.abs(dx) > 4) dragging = true;
        if (!dragging) return;

        const metrics = CANVAS.getRenderMetrics(setupIndex);
        const zoom = metrics ? Math.max(metrics.zoom, 0.0001) : 1;
        const displayDx = dx / zoom;
        const mmDx = displayDx / Math.max(GRID.mmToDisplay(1), 0.0001);
        STATE.setDesktopConfig(setupIndex, { x_offset_mm: Math.round(startOffsetMM + mmDx) });
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        dragging = false;
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  function _makeSvgsDraggable(on) {
    for (let si = 0; si <= 1; si++) {
      const svg = CANVAS.getSvg(si);
      if (svg) svg.style.pointerEvents = on ? 'all' : '';
    }
  }

  /* ---- Ghost element ---- */

  function _createGhost(e, setupIndex, row, col, equipmentInstanceId, desktopMonitorInstanceId) {
    const cell = (Number.isInteger(row) && Number.isInteger(col))
      ? STATE.getCell(setupIndex, row, col)
      : null;
    const mon = cell ? CATALOG.find(m => m.id === cell.monitorId) : null;
    const equipmentItem = equipmentInstanceId
      ? STATE.getDesktopEquipment(setupIndex).find(item => item.id === equipmentInstanceId)
      : null;
    const equipmentSpec = equipmentItem
      ? CATALOG.find(item => item.id === equipmentItem.equipmentId && item.category === 'equipment')
      : null;
    const desktopMonItem = desktopMonitorInstanceId
      ? STATE.getDesktopMonitors(setupIndex).find(item => item.id === desktopMonitorInstanceId)
      : null;
    const desktopMonSpec = desktopMonItem
      ? CATALOG.find(item => item.id === desktopMonItem.monitorId && item.category !== 'equipment')
      : null;
    _ghost = document.createElement('div');
    _ghost.className = 'catalog-card';
    _ghost.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 9999;
      opacity: 0.8;
      left: ${e.clientX + 12}px;
      top:  ${e.clientY + 12}px;
      transition: none;
    `;
    _ghost.textContent = mon
      ? `${mon.size}" ${mon.brand}`
      : (desktopMonSpec ? `${desktopMonSpec.size}" ${desktopMonSpec.brand}` : (equipmentSpec ? equipmentSpec.modelName : 'Monitor'));
    document.body.appendChild(_ghost);
  }

  function _removeGhost() {
    if (_ghost) { _ghost.remove(); _ghost = null; }
  }

  /* ---- Highlight helpers ---- */

  function _highlightAllEmpty() {
    for (let si = 0; si <= 1; si++) {
      for (let r = 0; r < GRID.MAX_ROWS; r++) {
        for (let c = 0; c < GRID.MAX_COLS; c++) {
          if (GRID.canPlace(si, r, c)) CANVAS.highlightCell(si, r, c, true);
        }
      }
    }
  }

  function _clearAllHighlights() {
    CANVAS.clearHighlights(0);
    CANVAS.clearHighlights(1);
  }

  /* ---- Toast ---- */

  function _showGridFullToast() {
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

  function _beginDragDropAreaSession() {
    if (_dropAreasPrefBeforeDrag !== null) return;
    _dropAreasPrefBeforeDrag = CANVAS.isDropAreasVisible();
    if (!_dropAreasPrefBeforeDrag) {
      CANVAS.setDropAreasVisible(true);
      attachSvgDropTargets();
    }
  }

  function _endDragDropAreaSession() {
    if (_dropAreasPrefBeforeDrag === null) return;
    const shouldRestoreHidden = !_dropAreasPrefBeforeDrag;
    _dropAreasPrefBeforeDrag = null;
    if (shouldRestoreHidden) {
      CANVAS.setDropAreasVisible(false);
      attachSvgDropTargets();
    }
  }

  return {
    init,
    attachCatalogDrag,
    attachTestMediaDrag,
    attachSvgDropTargets,
    attachMonitorDrag,
    attachDesktopEquipmentDrag,
    attachDesktopMonitorDrag,
    attachDesktopSurfaceDrag
  };
})();
