/**
 * state.js — Application state and mutation helpers.
 *
 * WorkspaceState:
 *   setups: Layout[2]   — two independent layout grids
 *
 * Layout:
 *   id: string
 *   name: string
 *   grid: GridCell[row][col]  (max 2 rows × 4 cols; null = empty)
 *
 * GridCell:
 *   monitorId: string       — catalog id
 *   selectedResolution: object  — one of monitor.resolutions[i]
 *   orientation: 'landscape'|'portrait'
 *   offsetX: number         — intrinsic SVG px offset from cell origin (manual alignment)
 *   offsetY: number         — intrinsic SVG px offset from cell origin (manual alignment)
 *   pipZones: PipZone[]     — empty = PiP off; 2/3/4 zones = active
 *   labels: Label[]         — screen-level labels
 *   streamId: string|null   — experimental video composition
 *
 * PipZone:
 *   id: string
 *   x: number   — SVG intrinsic coords
 *   y: number
 *   w: number
 *   h: number
 *   labels: Label[]  — zone-level labels (same Label shape, no placement field)
 *
 * Label:
 *   id: string
 *   text: string
 *   colorClass: string      — CSS class name e.g. 'label-color-sky'
 *   x: number               — px from monitor cell left (scaled coords)
 *   y: number               — px from monitor cell top
 *   placement: 'screen'|'pip'
 *
 * Events emitted on document:
 *   'state:changed' — fires after every mutation; detail: { setupIndex }
 */

/* global CATALOG */

const STATE = (() => {
  /** @type {{ setups: Array<{ id:string, name:string, grid:Array<Array<object|null>> }> }} */
  const ws = {
    setups: [
      { id: 'setup-0', name: 'Setup A', grid: _emptyGrid() },
      { id: 'setup-1', name: 'Setup B', grid: _emptyGrid() }
    ]
  };

  // Currently selected cell reference
  let _selected = null; // { setupIndex, row, col }

  /* ---- Internal helpers ---- */

  function _emptyGrid() {
    // 2 rows × 4 cols, all null
    return [
      [null, null, null, null],
      [null, null, null, null]
    ];
  }

  function _emit(setupIndex) {
    document.dispatchEvent(new CustomEvent('state:changed', { detail: { setupIndex } }));
  }

  function _validate(setupIndex, row, col) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    if (row < 0 || row > 1)              throw new RangeError('row must be 0 or 1');
    if (col < 0 || col > 3)              throw new RangeError('col must be 0–3');
  }

  /* ---- Public API ---- */

  /**
   * Place a monitor in a cell. Returns false if cell already occupied.
   */
  function placeMonitor(setupIndex, row, col, monitorId) {
    _validate(setupIndex, row, col);
    const monitor = CATALOG.find(m => m.id === monitorId);
    if (!monitor) throw new Error('Unknown monitor id: ' + monitorId);

    const cell = ws.setups[setupIndex].grid[row][col];
    if (cell !== null) return false; // occupied

    ws.setups[setupIndex].grid[row][col] = {
      monitorId,
      selectedResolution: monitor.resolutions[0],
      orientation: 'landscape',
      offsetX: 0,
      offsetY: 0,
      pipZones: [],
      labels: [],
      streamId: null
    };
    _reflowActivePipZones(setupIndex, null, true);
    _emit(setupIndex);
    return true;
  }

  /**
   * Remove a monitor from a cell. No-op if empty.
   */
  function removeMonitor(setupIndex, row, col) {
    _validate(setupIndex, row, col);
    if (ws.setups[setupIndex].grid[row][col] === null) return;
    ws.setups[setupIndex].grid[row][col] = null;
    if (_selected &&
        _selected.setupIndex === setupIndex &&
        _selected.row === row &&
        _selected.col === col) {
      _selected = null;
    }
    _reflowActivePipZones(setupIndex, null, true);
    _emit(setupIndex);
  }

  /**
   * Move a monitor from one cell to another (same or different setup).
   * Swaps if destination is occupied.
   */
  function moveMonitor(fromSetup, fromRow, fromCol, toSetup, toRow, toCol) {
    if (fromSetup === toSetup && fromRow === toRow && fromCol === toCol) return;
    _validate(fromSetup, fromRow, fromCol);
    _validate(toSetup, toRow, toCol);

    const src = ws.setups[fromSetup].grid[fromRow][fromCol];
    if (!src) return; // nothing to move

    const dst = ws.setups[toSetup].grid[toRow][toCol];
    ws.setups[toSetup].grid[toRow][toCol] = src;
    ws.setups[fromSetup].grid[fromRow][fromCol] = dst; // null or swap

    _reflowActivePipZones(fromSetup, null, true);
    _emit(fromSetup);
    if (toSetup !== fromSetup) {
      _reflowActivePipZones(toSetup, null, true);
      _emit(toSetup);
    }
  }

  /**
   * Update selected resolution for a placed monitor.
   */
  function setResolution(setupIndex, row, col, resolution) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return;
    cell.selectedResolution = resolution;
    _emit(setupIndex);
  }

  function setMonitorOffset(setupIndex, row, col, offsetX, offsetY) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return;

    const nextX = Number.isFinite(offsetX) ? offsetX : 0;
    const nextY = Number.isFinite(offsetY) ? offsetY : 0;
    if (cell.offsetX === nextX && cell.offsetY === nextY) return;

    cell.offsetX = nextX;
    cell.offsetY = nextY;

    if (cell.pipZones && cell.pipZones.length) {
      _rebuildPipZones(setupIndex, row, col, undefined, true);
    }
    _emit(setupIndex);
  }

  function resetMonitorOffset(setupIndex, row, col) {
    setMonitorOffset(setupIndex, row, col, 0, 0);
  }

  function _rebuildPipZones(setupIndex, row, col, count, preserveLabels, orientationOverride) {
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return;

    const zoneCount = count !== undefined ? count : ((cell.pipZones || []).length);
    if (!zoneCount) {
      cell.pipZones = [];
      return;
    }

    const monitor = CATALOG.find(m => m.id === cell.monitorId);
    if (!monitor || !monitor.pipSupported) return;

    const dims = GRID.calcDimensions(setupIndex);
    const cellRect = GRID.cellRect(dims.colWidths, dims.rowHeights, row, col);
    const physicalW = cell.orientation === 'portrait'
      ? monitor.physicalHeight_mm
      : monitor.physicalWidth_mm;
    const physicalH = cell.orientation === 'portrait'
      ? monitor.physicalWidth_mm
      : monitor.physicalHeight_mm;
    const rect = {
      x: cellRect.x + (cell.offsetX || 0),
      y: cellRect.y + (cell.offsetY || 0),
      w: GRID.mmToDisplay(physicalW),
      h: GRID.mmToDisplay(physicalH)
    };
    const previousZones = cell.pipZones || [];
    const nextZones = PIP.calcZonePreset(
      rect,
      zoneCount,
      monitor,
      orientationOverride || cell.orientation || 'landscape'
    );

    if (preserveLabels) {
      nextZones.forEach((zone, idx) => {
        zone.labels = previousZones[idx] && previousZones[idx].labels
          ? previousZones[idx].labels.slice(0, 1)
          : [];
      });
    }

    cell.pipZones = nextZones;
  }

  function _inferPipOrientation(cell) {
    if (!cell || !cell.pipZones || cell.pipZones.length < 2) {
      return cell && cell.orientation ? cell.orientation : 'landscape';
    }

    const zones = cell.pipZones;

    if (zones.length === 2) {
      const z0cX = zones[0].x + zones[0].w / 2;
      const z0cY = zones[0].y + zones[0].h / 2;
      const z1cX = zones[1].x + zones[1].w / 2;
      const z1cY = zones[1].y + zones[1].h / 2;
      return Math.abs(z1cY - z0cY) > Math.abs(z1cX - z0cX)
        ? 'portrait'
        : 'landscape';
    }

    if (zones.length === 3) {
      const z0 = zones[0];
      const z1 = zones[1];
      const z2 = zones[2];
      const stackedBottom = Math.abs(z1.y - z2.y) <= 2 && z0.y < z1.y;
      return (z0.w > z0.h && stackedBottom) ? 'portrait' : 'landscape';
    }

    return cell.orientation || 'landscape';
  }

  function _reflowActivePipZones(setupIndex, excludeCell, preserveTopology) {
    const setup = ws.setups[setupIndex];
    if (!setup) return;

    for (let r = 0; r < setup.grid.length; r++) {
      for (let c = 0; c < setup.grid[r].length; c++) {
        const cell = setup.grid[r][c];
        if (!cell || !cell.pipZones || !cell.pipZones.length) continue;
        if (excludeCell && excludeCell.row === r && excludeCell.col === c) continue;
        const orientationOverride = preserveTopology ? _inferPipOrientation(cell) : undefined;
        _rebuildPipZones(setupIndex, r, c, cell.pipZones.length, true, orientationOverride);
      }
    }
  }

  function setOrientation(setupIndex, row, col, orientation) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return;

    const nextOrientation = orientation === 'portrait' ? 'portrait' : 'landscape';
    if (cell.orientation === nextOrientation) return;

    cell.orientation = nextOrientation;
    _rebuildPipZones(setupIndex, row, col, undefined, true);
    _reflowActivePipZones(setupIndex, { row, col }, true);
    _emit(setupIndex);
  }

  /**
   * Set PiP zones on a cell. count ∈ {0,2,3,4}. 0 clears all zones.
   * Geometry is computed by PIP.calcZonePreset (lazy dep — evaluated at call time).
   */
  function setPipZones(setupIndex, row, col, count) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return;
    const monitor = CATALOG.find(m => m.id === cell.monitorId);
    if (!monitor || !monitor.pipSupported) return;
    if (count === 0) {
      cell.pipZones = [];
    } else {
      _rebuildPipZones(setupIndex, row, col, count, false);
    }
    _emit(setupIndex);
  }

  /**
   * Add a label to a specific PiP zone. Returns the new label object.
   */
  function addZoneLabel(setupIndex, row, col, zoneId, text, colorClass, x, y) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return null;
    const zone = (cell.pipZones || []).find(z => z.id === zoneId);
    if (!zone) return null;
    const label = {
      id: 'lbl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      text: text || 'Label',
      colorClass: colorClass || 'label-color-sky',
      x: x || 10,
      y: y || 10
    };
    zone.labels = [label];
    _emit(setupIndex);
    return label;
  }

  /**
   * Update an existing zone label.
   */
  function updateZoneLabel(setupIndex, row, col, zoneId, labelId, changes) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return;
    const zone = (cell.pipZones || []).find(z => z.id === zoneId);
    if (!zone) return;
    const lbl = zone.labels.find(l => l.id === labelId);
    if (!lbl) return;
    Object.assign(lbl, changes);
    _emit(setupIndex);
  }

  /**
   * Remove a zone label by id.
   */
  function removeZoneLabel(setupIndex, row, col, zoneId, labelId) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return;
    const zone = (cell.pipZones || []).find(z => z.id === zoneId);
    if (!zone) return;
    zone.labels = zone.labels.filter(l => l.id !== labelId);
    _emit(setupIndex);
  }

  /**
   * Add a label to a cell. Returns the new label object.
   */
  function addLabel(setupIndex, row, col, text, colorClass, x, y, placement) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return null;
    const label = {
      id: 'lbl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      text: text || 'Label',
      colorClass: colorClass || 'label-color-sky',
      x: x || 10,
      y: y || 10,
      placement: placement || 'screen'
    };
    cell.labels = [label];
    _emit(setupIndex);
    return label;
  }

  /**
   * Update an existing label's properties.
   */
  function updateLabel(setupIndex, row, col, labelId, changes) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return;
    const lbl = cell.labels.find(l => l.id === labelId);
    if (!lbl) return;
    Object.assign(lbl, changes);
    _emit(setupIndex);
  }

  /**
   * Remove a label by id.
   */
  function removeLabel(setupIndex, row, col, labelId) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return;
    cell.labels = cell.labels.filter(l => l.id !== labelId);
    _emit(setupIndex);
  }

  /**
   * Set stream assignment (experimental).
   */
  function setStream(setupIndex, row, col, streamId) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return;
    cell.streamId = streamId;
    _emit(setupIndex);
  }

  /**
   * Clear all stream assignments across all setups.
   */
  function clearStreams() {
    ws.setups.forEach((setup, si) => {
      setup.grid.forEach(rowArr => {
        rowArr.forEach(cell => { if (cell) cell.streamId = null; });
      });
      _emit(si);
    });
  }

  /**
   * Clear all monitors (and labels) from a setup.
   */
  function clearSetup(setupIndex) {
    ws.setups[setupIndex].grid = _emptyGrid();
    if (_selected && _selected.setupIndex === setupIndex) _selected = null;
    _emit(setupIndex);
  }

  /**
   * Rename a setup.
   */
  function renameSetup(setupIndex, name) {
    ws.setups[setupIndex].name = name;
    // no re-render needed for just a name change
  }

  /* ---- Selection ---- */

  function setSelected(setupIndex, row, col) {
    _selected = (setupIndex !== null) ? { setupIndex, row, col } : null;
    document.dispatchEvent(new CustomEvent('state:selection', { detail: _selected }));
  }

  function getSelected() { return _selected; }

  /** Get a cell value (read-only snapshot). */
  function getCell(setupIndex, row, col) {
    return ws.setups[setupIndex].grid[row][col];
  }

  /** Get full setup grid (read-only reference — do not mutate directly). */
  function getSetup(setupIndex) {
    return ws.setups[setupIndex];
  }

  return {
    placeMonitor, removeMonitor, moveMonitor,
    setResolution, setOrientation, setPipZones,
    setMonitorOffset, resetMonitorOffset,
    addLabel, updateLabel, removeLabel,
    addZoneLabel, updateZoneLabel, removeZoneLabel,
    setStream, clearStreams,
    clearSetup, renameSetup,
    setSelected, getSelected, getCell, getSetup
  };
})();
