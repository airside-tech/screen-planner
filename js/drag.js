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

/* global CATALOG, STATE, GRID, CANVAS */

const DRAG = (() => {
  // ---- State ----
  let _activeSource = null; // { type:'catalog'|'monitor', monitorId?, setupIndex?, row?, col? }
  let _ghost = null;        // ghost div

  // ---- Init ----
  function init() {
    // Deselect on canvas background click
    document.addEventListener('click', e => {
      if (!e.target.closest('[data-role="monitor"]') &&
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
  function attachCatalogDrag(cardEl, monitorId) {
    cardEl.setAttribute('draggable', 'true');

    cardEl.addEventListener('dragstart', e => {
      _activeSource = { type: 'catalog', monitorId };
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', monitorId);
      cardEl.classList.add('dragging');
      _highlightAllEmpty();
    });

    cardEl.addEventListener('dragend', () => {
      cardEl.classList.remove('dragging');
      _clearAllHighlights();
      _activeSource = null;
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
          setupIndex: parseInt(node.dataset.setup, 10)
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

    if (isEmpty) {
      e.dataTransfer.dropEffect = 'copy';
      CANVAS.highlightCell(setupIndex, hit.row, hit.col, true);
    } else if (isMonitor && _activeSource.type === 'monitor') {
      // can drop on occupied cell → swap
      e.dataTransfer.dropEffect = 'move';
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
        if (!placed) _showGridFullToast();
      }
    } else if (_activeSource && _activeSource.type === 'monitor') {
      STATE.moveMonitor(
        _activeSource.setupIndex, _activeSource.row, _activeSource.col,
        setupIndex, hit.row, hit.col
      );
    }

    _activeSource = null;
  }

  /* ================================================================
     MONITOR → CANVAS  (SVG mousedown drag)
     ================================================================ */

  function attachMonitorDrag(groupEl, setupIndex, row, col) {
    let _dragging = false;
    let _startX, _startY;
    const DRAG_THRESHOLD = 6; // px

    groupEl.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      _startX = e.clientX;
      _startY = e.clientY;
      _dragging = false;

      const onMouseMove = mv => {
        const dx = Math.abs(mv.clientX - _startX);
        const dy = Math.abs(mv.clientY - _startY);
        if (!_dragging && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
          _dragging = true;
          _activeSource = { type: 'monitor', setupIndex, row, col };
          _createGhost(mv, setupIndex, row, col);
          _highlightAllEmpty();
          // Enable HTML5 dragover on SVGs by setting draggable
          _makeSvgsDraggable(true);
        }
        if (_dragging && _ghost) {
          _ghost.style.left = mv.clientX + 12 + 'px';
          _ghost.style.top  = mv.clientY + 12 + 'px';
        }
      };

      const onMouseUp = mu => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup',   onMouseUp);

        if (_dragging) {
          _makeSvgsDraggable(false);
          _removeGhost();
          _clearAllHighlights();

          // Find drop target
          const el = document.elementFromPoint(mu.clientX, mu.clientY);
          const hit = _findCellFromElement(el);
          if (hit) {
            STATE.moveMonitor(setupIndex, row, col, hit.setupIndex, hit.row, hit.col);
          }
          _activeSource = null;
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

  function _makeSvgsDraggable(on) {
    for (let si = 0; si <= 1; si++) {
      const svg = CANVAS.getSvg(si);
      if (svg) svg.style.pointerEvents = on ? 'all' : '';
    }
  }

  /* ---- Ghost element ---- */

  function _createGhost(e, setupIndex, row, col) {
    const cell = STATE.getCell(setupIndex, row, col);
    const mon = cell ? CATALOG.find(m => m.id === cell.monitorId) : null;
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
    _ghost.textContent = mon ? `${mon.size}" ${mon.brand}` : 'Monitor';
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
    const toast = document.getElementById('gridToast');
    if (!toast) return;
    toast.removeAttribute('hidden');
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.setAttribute('hidden', ''), 320);
    }, 2500);
  }

  return { init, attachCatalogDrag, attachSvgDropTargets, attachMonitorDrag };
})();
