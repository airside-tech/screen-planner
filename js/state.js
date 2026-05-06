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
      pipZones: [],
      labels: [],
      streamId: null
    };
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

    _emit(fromSetup);
    if (toSetup !== fromSetup) _emit(toSetup);
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
      // Compute geometry via GRID + PIP (both defined by the time this runs)
      const dims = GRID.calcDimensions(setupIndex);
      const rect = GRID.cellRect(dims.colWidths, dims.rowHeights, row, col);
      cell.pipZones = PIP.calcZonePreset(rect, count, monitor);
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
    zone.labels.push(label);
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
    cell.labels.push(label);
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
    setResolution, setPipZones,
    addLabel, updateLabel, removeLabel,
    addZoneLabel, updateZoneLabel, removeZoneLabel,
    setStream, clearStreams,
    clearSetup, renameSetup,
    setSelected, getSelected, getCell, getSetup
  };
})();
