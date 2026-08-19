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
  const DESKTOP_DEFAULTS = Object.freeze({
    enabled: false,
    width_mm: 1400,
    height_mm: 700,
    x_offset_mm: 0,
    reservedDepth_mm: 300 // Default reserved depth for screen stands
  });

  /** @type {{ setups: Array<{ id:string, name:string, grid:Array<Array<object|null>> }> }} */
  const ws = {
    setups: [
      {
        id: 'setup-0',
        name: 'Setup A',
        grid: _emptyGrid(),
        desktopConfig: _defaultDesktopConfig(),
        desktopEquipment: [],
        desktopMonitors: []
      },
      {
        id: 'setup-1',
        name: 'Setup B',
        grid: _emptyGrid(),
        desktopConfig: _defaultDesktopConfig(),
        desktopEquipment: [],
        desktopMonitors: []
      }
    ]
  };

  // Currently selected cell reference
  let _selected = null; // { setupIndex, row, col }
  let _selectedZone = null; // { setupIndex, row, col, zoneId }

  /* ---- Internal helpers ---- */

  function _emptyGrid() {
    // 2 rows × 4 cols, all null
    return [
      [null, null, null, null],
      [null, null, null, null]
    ];
  }

  function _defaultDesktopConfig() {
    return {
      enabled: DESKTOP_DEFAULTS.enabled,
      width_mm: DESKTOP_DEFAULTS.width_mm,
      height_mm: DESKTOP_DEFAULTS.height_mm,
      x_offset_mm: DESKTOP_DEFAULTS.x_offset_mm,
      reservedDepth_mm: DESKTOP_DEFAULTS.reservedDepth_mm
    };
  }

  function _normalizeDesktopOffset(value, fallback) {
    const next = Number(value);
    if (!Number.isFinite(next)) return fallback;
    return Math.max(-4000, Math.min(4000, Math.round(next)));
  }

  function _normalizeDesktopDimension(value, fallback) {
    const next = Number(value);
    if (!Number.isFinite(next)) return fallback;
    return Math.max(200, Math.min(4000, Math.round(next)));
  }

  function _normalizeReservedDepth(value, fallback) {
    const next = Number(value);
    if (!Number.isFinite(next)) return fallback;
    return Math.max(50, Math.min(1000, Math.round(next))); // Allow range 50-1000 mm
  }

  function _normalizeDesktopConfig(config) {
    const base = _defaultDesktopConfig();
    if (!config || typeof config !== 'object') return base;
    base.enabled = !!config.enabled;
    base.width_mm = _normalizeDesktopDimension(config.width_mm, base.width_mm);
    base.height_mm = _normalizeDesktopDimension(config.height_mm, base.height_mm);
    base.x_offset_mm = _normalizeDesktopOffset(config.x_offset_mm, base.x_offset_mm);
    base.reservedDepth_mm = _normalizeReservedDepth(config.reservedDepth_mm, base.reservedDepth_mm);
    return base;
  }

  function _normalizeDesktopConfigFromSetupData(data) {
    const raw = data && typeof data.desktopConfig === 'object' ? Object.assign({}, data.desktopConfig) : {};

    // Legacy setup files may store reserved depth at top-level.
    if (!Object.prototype.hasOwnProperty.call(raw, 'reservedDepth_mm') && data) {
      raw.reservedDepth_mm = data.reservedDepth_mm;
    }

    return _normalizeDesktopConfig(raw);
  }

  function _normalizeDesktopEquipmentItem(item) {
    if (!item || typeof item !== 'object') return null;
    if (typeof item.id !== 'string' || !item.id.trim()) return null;
    if (typeof item.equipmentId !== 'string' || !item.equipmentId.trim()) return null;

    const equipment = CATALOG.find(m => m.id === item.equipmentId && m.category === 'equipment');
    if (!equipment) return null;

    const x_mm = Number(item.x_mm);
    const y_mm = Number(item.y_mm);
    if (!Number.isFinite(x_mm) || !Number.isFinite(y_mm)) return null;

    return {
      id: item.id.trim(),
      equipmentId: item.equipmentId.trim(),
      x_mm,
      y_mm
    };
  }

  function _normalizeDesktopMonitorItem(item) {
    if (!item || typeof item !== 'object') return null;
    if (typeof item.id !== 'string' || !item.id.trim()) return null;
    if (typeof item.monitorId !== 'string' || !item.monitorId.trim()) return null;

    const monitor = CATALOG.find(m => m.id === item.monitorId && m.category !== 'equipment');
    if (!monitor) return null;

    const x_mm = Number(item.x_mm);
    const y_mm = Number(item.y_mm);
    if (!Number.isFinite(x_mm) || !Number.isFinite(y_mm)) return null;

    const orientation = item.orientation === 'portrait' ? 'portrait' : 'landscape';
    const selectedResolution = item.selectedResolution && typeof item.selectedResolution === 'object'
      ? item.selectedResolution
      : monitor.resolutions[0];
    const monitorTestMediaRef = _normalizeTestMediaRef(item.monitorTestMediaRef);
    const monitorTestMediaScalingMode = ['center', 'aspect', 'full'].includes(item.monitorTestMediaScalingMode)
      ? item.monitorTestMediaScalingMode
      : 'center';
    let labels = [];
    if (Array.isArray(item.labels) && item.labels.length) {
      const normalized = _normalizeDesktopMonitorLabel(item.labels[0]);
      if (normalized) labels = [normalized];
    } else {
      const migrated = _normalizeDesktopMonitorLabel(item.label);
      if (migrated) labels = [migrated];
    }

    return {
      id: item.id.trim(),
      monitorId: item.monitorId.trim(),
      selectedResolution,
      orientation,
      monitorTestMediaRef,
      monitorTestMediaScalingMode,
      labels,
      x_mm,
      y_mm
    };
  }

  function _emit(setupIndex) {
    document.dispatchEvent(new CustomEvent('state:changed', { detail: { setupIndex } }));
  }

  function _clearSelectedZoneIfMatches(setupIndex, row, col) {
    if (!_selectedZone) return;
    if (_selectedZone.setupIndex !== setupIndex) return;
    if (_selectedZone.row !== row || _selectedZone.col !== col) return;
    _selectedZone = null;
  }

  function _normalizeTestMediaRef(ref, zoneId) {
    if (!ref || typeof ref !== 'object') return null;
    if (typeof ref.assetId !== 'string' || !ref.assetId.trim()) return null;

    const next = {
      assetId: ref.assetId.trim(),
      placement: zoneId ? 'zone' : 'monitor'
    };
    if (zoneId) next.zoneId = zoneId;
    return next;
  }

  function _monitorResolutionForCell(cell) {
    const res = cell && cell.selectedResolution ? cell.selectedResolution : { width: 1920, height: 1080 };
    const isPortrait = cell && cell.orientation === 'portrait';
    return {
      width: Math.max(1, isPortrait ? res.height : res.width),
      height: Math.max(1, isPortrait ? res.width : res.height)
    };
  }

  function _normalizeWindowedApp(cell, app) {
    if (!app || typeof app !== 'object') return null;
    if (typeof app.assetId !== 'string' || !app.assetId.trim()) return null;

    const res = _monitorResolutionForCell(cell);
    const minW = Math.min(80, res.width);
    const minH = Math.min(80, res.height);

    const rawW = Number(app.w);
    const rawH = Number(app.h);
    const w = Math.max(minW, Math.min(res.width, Number.isFinite(rawW) ? Math.round(rawW) : Math.round(res.width * 0.5)));
    const h = Math.max(minH, Math.min(res.height, Number.isFinite(rawH) ? Math.round(rawH) : Math.round(res.height * 0.5)));

    const rawX = Number(app.x);
    const rawY = Number(app.y);
    const x = Math.max(0, Math.min(res.width - w, Number.isFinite(rawX) ? Math.round(rawX) : Math.round((res.width - w) * 0.5)));
    const y = Math.max(0, Math.min(res.height - h, Number.isFinite(rawY) ? Math.round(rawY) : Math.round((res.height - h) * 0.5)));

    return {
      id: (typeof app.id === 'string' && app.id.trim())
        ? app.id.trim()
        : ('wapp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
      assetId: app.assetId.trim(),
      x,
      y,
      w,
      h
    };
  }

  function _newLabelId() {
    return 'lbl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  }

  function _normalizeLabelText(value, maxLen) {
    return String(value || '').trim().slice(0, maxLen);
  }

  function _normalizeDesktopMonitorLabel(labelLike) {
    if (typeof labelLike === 'string') {
      const text = _normalizeLabelText(labelLike, 30);
      if (!text) return null;
      return {
        id: _newLabelId(),
        text,
        colorClass: 'label-color-sky',
        x: 10,
        y: 10
      };
    }

    if (!labelLike || typeof labelLike !== 'object') return null;

    const text = _normalizeLabelText(labelLike.text, 30);
    if (!text) return null;

    const nextX = Number(labelLike.x);
    const nextY = Number(labelLike.y);

    return {
      id: (typeof labelLike.id === 'string' && labelLike.id.trim())
        ? labelLike.id.trim()
        : _newLabelId(),
      text,
      colorClass: (typeof labelLike.colorClass === 'string' && labelLike.colorClass.trim())
        ? labelLike.colorClass.trim()
        : 'label-color-sky',
      x: Number.isFinite(nextX) ? nextX : 10,
      y: Number.isFinite(nextY) ? nextY : 10
    };
  }

  function _ensureDesktopMonitorLabelSlot(item) {
    if (!item || typeof item !== 'object') return null;
    if (!Array.isArray(item.labels)) item.labels = [];

    if (item.labels.length > 0) {
      const normalized = _normalizeDesktopMonitorLabel(item.labels[0]);
      if (!normalized) {
        item.labels = [];
        return null;
      }
      item.labels = [normalized];
      return normalized;
    }

    if (typeof item.label === 'string' && item.label.trim()) {
      const migrated = _normalizeDesktopMonitorLabel(item.label);
      if (migrated) {
        item.labels = [migrated];
        item.label = '';
        return migrated;
      }
    }

    return null;
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
      streamId: null,
      monitorTestMediaRef: null,
      monitorTestMediaScalingMode: 'center',
      windowedAppsEnabled: false,
      windowedApps: []
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
    _clearSelectedZoneIfMatches(setupIndex, row, col);
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
    _clearSelectedZoneIfMatches(fromSetup, fromRow, fromCol);
    _clearSelectedZoneIfMatches(toSetup, toRow, toCol);

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
        zone.testMediaRef = previousZones[idx]
          ? _normalizeTestMediaRef(previousZones[idx].testMediaRef, zone.id)
          : null;
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
      _clearSelectedZoneIfMatches(setupIndex, row, col);
    } else {
      _clearSelectedZoneIfMatches(setupIndex, row, col);
      _rebuildPipZones(setupIndex, row, col, count, false);
    }
    _emit(setupIndex);
  }

  function setMonitorTestMedia(setupIndex, row, col, assetId) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return;

    const next = (typeof assetId === 'string' && assetId.trim())
      ? { assetId: assetId.trim(), placement: 'monitor' }
      : null;

    const currentId = cell.monitorTestMediaRef && cell.monitorTestMediaRef.assetId
      ? cell.monitorTestMediaRef.assetId
      : null;
    const nextId = next ? next.assetId : null;
    if (currentId === nextId) return;

    cell.monitorTestMediaRef = next;
    _emit(setupIndex);
  }

  function clearMonitorTestMedia(setupIndex, row, col) {
    setMonitorTestMedia(setupIndex, row, col, null);
  }

  function toggleWindowedMode(setupIndex, row, col) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return;
    cell.windowedAppsEnabled = !cell.windowedAppsEnabled;
    _emit(setupIndex);
  }

  function addWindowedApp(setupIndex, row, col, assetId, x, y, w, h) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return null;

    const next = _normalizeWindowedApp(cell, {
      id: null,
      assetId,
      x,
      y,
      w,
      h
    });
    if (!next) return null;

    if (!Array.isArray(cell.windowedApps)) cell.windowedApps = [];
    cell.windowedApps.push(next);
    _emit(setupIndex);
    return next;
  }

  function moveWindowedApp(setupIndex, row, col, appId, x, y) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell || !appId) return false;
    if (!Array.isArray(cell.windowedApps)) cell.windowedApps = [];

    const idx = cell.windowedApps.findIndex(app => app.id === appId);
    if (idx < 0) return false;

    const app = cell.windowedApps[idx];
    const normalized = _normalizeWindowedApp(cell, {
      id: app.id,
      assetId: app.assetId,
      x,
      y,
      w: app.w,
      h: app.h
    });
    if (!normalized) return false;

    if (app.x === normalized.x && app.y === normalized.y) return true;
    app.x = normalized.x;
    app.y = normalized.y;
    _emit(setupIndex);
    return true;
  }

  function resizeWindowedApp(setupIndex, row, col, appId, w, h) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell || !appId) return false;
    if (!Array.isArray(cell.windowedApps)) cell.windowedApps = [];

    const idx = cell.windowedApps.findIndex(app => app.id === appId);
    if (idx < 0) return false;

    const app = cell.windowedApps[idx];
    const normalized = _normalizeWindowedApp(cell, {
      id: app.id,
      assetId: app.assetId,
      x: app.x,
      y: app.y,
      w,
      h
    });
    if (!normalized) return false;

    if (app.w === normalized.w && app.h === normalized.h && app.x === normalized.x && app.y === normalized.y) {
      return true;
    }
    app.w = normalized.w;
    app.h = normalized.h;
    // Keep app inside bounds if size changed.
    app.x = normalized.x;
    app.y = normalized.y;
    _emit(setupIndex);
    return true;
  }

  function removeWindowedApp(setupIndex, row, col, appId) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell || !appId) return false;
    if (!Array.isArray(cell.windowedApps)) cell.windowedApps = [];

    const prevLen = cell.windowedApps.length;
    cell.windowedApps = cell.windowedApps.filter(app => app.id !== appId);
    if (cell.windowedApps.length === prevLen) return false;
    _emit(setupIndex);
    return true;
  }

  function setMonitorTestMediaScalingMode(setupIndex, row, col, mode) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell) return;

    const valid = ['center', 'aspect', 'full'];
    const nextMode = valid.includes(mode) ? mode : 'center';
    if (cell.monitorTestMediaScalingMode === nextMode) return;

    cell.monitorTestMediaScalingMode = nextMode;
    _emit(setupIndex);
  }

  function setZoneTestMedia(setupIndex, row, col, zoneId, assetId) {
    _validate(setupIndex, row, col);
    const cell = ws.setups[setupIndex].grid[row][col];
    if (!cell || !zoneId) return;
    const zone = (cell.pipZones || []).find(z => z.id === zoneId);
    if (!zone) return;

    const next = (typeof assetId === 'string' && assetId.trim())
      ? { assetId: assetId.trim(), placement: 'zone', zoneId }
      : null;

    const currentId = zone.testMediaRef && zone.testMediaRef.assetId
      ? zone.testMediaRef.assetId
      : null;
    const nextId = next ? next.assetId : null;
    if (currentId === nextId) return;

    zone.testMediaRef = next;
    _emit(setupIndex);
  }

  function clearZoneTestMedia(setupIndex, row, col, zoneId) {
    setZoneTestMedia(setupIndex, row, col, zoneId, null);
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
    ws.setups[setupIndex].desktopMonitors = [];
    if (_selected && _selected.setupIndex === setupIndex) _selected = null;
    if (_selectedZone && _selectedZone.setupIndex === setupIndex) _selectedZone = null;
    _emit(setupIndex);
  }

  function setDesktopConfig(setupIndex, nextConfig) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const setup = ws.setups[setupIndex];
    const current = setup.desktopConfig || _defaultDesktopConfig();
    const merged = _normalizeDesktopConfig(Object.assign({}, current, nextConfig || {}));

    if (current.enabled === merged.enabled &&
        current.width_mm === merged.width_mm &&
        current.height_mm === merged.height_mm &&
        current.x_offset_mm === merged.x_offset_mm &&
        current.reservedDepth_mm === merged.reservedDepth_mm) {
      return;
    }

    setup.desktopConfig = merged;
    _emit(setupIndex);
  }

  function getDesktopConfig(setupIndex) {
    const setup = ws.setups[setupIndex];
    if (!setup) return _defaultDesktopConfig();
    if (!setup.desktopConfig) setup.desktopConfig = _defaultDesktopConfig();
    return setup.desktopConfig;
  }

  function getDesktopEquipment(setupIndex) {
    const setup = ws.setups[setupIndex];
    if (!setup) return [];
    if (!Array.isArray(setup.desktopEquipment)) setup.desktopEquipment = [];
    return setup.desktopEquipment;
  }

  function getDesktopMonitors(setupIndex) {
    const setup = ws.setups[setupIndex];
    if (!setup) return [];
    if (!Array.isArray(setup.desktopMonitors)) setup.desktopMonitors = [];
    return setup.desktopMonitors;
  }

  function addDesktopEquipment(setupIndex, equipmentId, x_mm, y_mm) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const equipment = CATALOG.find(m => m.id === equipmentId && m.category === 'equipment');
    if (!equipment) throw new Error('Unknown equipment id: ' + equipmentId);

    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopEquipment)) setup.desktopEquipment = [];

    const item = {
      id: 'deq-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      equipmentId,
      x_mm: Number.isFinite(x_mm) ? x_mm : 0,
      y_mm: Number.isFinite(y_mm) ? y_mm : 0,
      label: ''  // Equipment label (e.g., 'Main Keyboard', 'Backup Mouse')
    };

    setup.desktopEquipment.push(item);
    _emit(setupIndex);
    return item;
  }

  function setEquipmentLabel(setupIndex, itemId, labelText) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopEquipment)) setup.desktopEquipment = [];

    const item = setup.desktopEquipment.find(entry => entry.id === itemId);
    if (!item) return false;

    const nextLabel = String(labelText || '').slice(0, 30);
    if (item.label === nextLabel) return true;

    item.label = nextLabel;
    _emit(setupIndex);
    return true;
  }

  function moveDesktopEquipment(setupIndex, itemId, x_mm, y_mm) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopEquipment)) setup.desktopEquipment = [];

    const item = setup.desktopEquipment.find(entry => entry.id === itemId);
    if (!item) return false;

    const nextX = Number.isFinite(x_mm) ? x_mm : item.x_mm;
    const nextY = Number.isFinite(y_mm) ? y_mm : item.y_mm;

    if (item.x_mm === nextX && item.y_mm === nextY) return true;

    item.x_mm = nextX;
    item.y_mm = nextY;
    _emit(setupIndex);
    return true;
  }

  function removeDesktopEquipment(setupIndex, itemId) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopEquipment)) setup.desktopEquipment = [];

    const prevLen = setup.desktopEquipment.length;
    setup.desktopEquipment = setup.desktopEquipment.filter(entry => entry.id !== itemId);
    if (setup.desktopEquipment.length !== prevLen) {
      _emit(setupIndex);
      return true;
    }
    return false;
  }

  function addDesktopMonitor(setupIndex, monitorId, selectedResolution, orientation, x_mm, y_mm) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const monitor = CATALOG.find(m => m.id === monitorId && m.category !== 'equipment');
    if (!monitor) throw new Error('Unknown monitor id: ' + monitorId);

    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopMonitors)) setup.desktopMonitors = [];

    const item = {
      id: 'dmon-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      monitorId,
      selectedResolution: selectedResolution || monitor.resolutions[0],
      orientation: orientation === 'portrait' ? 'portrait' : 'landscape',
      monitorTestMediaRef: null,
      monitorTestMediaScalingMode: 'center',
      labels: [],
      x_mm: Number.isFinite(x_mm) ? x_mm : 0,
      y_mm: Number.isFinite(y_mm) ? y_mm : 0
    };

    setup.desktopMonitors.push(item);
    _emit(setupIndex);
    return item;
  }

  function moveDesktopMonitor(setupIndex, itemId, x_mm, y_mm) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopMonitors)) setup.desktopMonitors = [];

    const item = setup.desktopMonitors.find(entry => entry.id === itemId);
    if (!item) return false;

    const nextX = Number.isFinite(x_mm) ? x_mm : item.x_mm;
    const nextY = Number.isFinite(y_mm) ? y_mm : item.y_mm;

    if (item.x_mm === nextX && item.y_mm === nextY) return true;

    item.x_mm = nextX;
    item.y_mm = nextY;
    _emit(setupIndex);
    return true;
  }

  function setDesktopMonitorResolution(setupIndex, itemId, resolution) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopMonitors)) setup.desktopMonitors = [];

    const item = setup.desktopMonitors.find(entry => entry.id === itemId);
    if (!item || !resolution || typeof resolution !== 'object') return false;

    item.selectedResolution = resolution;
    _emit(setupIndex);
    return true;
  }

  function setDesktopMonitorOrientation(setupIndex, itemId, orientation) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopMonitors)) setup.desktopMonitors = [];

    const item = setup.desktopMonitors.find(entry => entry.id === itemId);
    if (!item) return false;

    const next = orientation === 'portrait' ? 'portrait' : 'landscape';
    if (item.orientation === next) return true;

    item.orientation = next;
    _emit(setupIndex);
    return true;
  }

  function setDesktopMonitorTestMedia(setupIndex, itemId, assetId) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopMonitors)) setup.desktopMonitors = [];

    const item = setup.desktopMonitors.find(entry => entry.id === itemId);
    if (!item) return false;

    const next = (typeof assetId === 'string' && assetId.trim())
      ? { assetId: assetId.trim(), placement: 'monitor' }
      : null;

    const currentId = item.monitorTestMediaRef && item.monitorTestMediaRef.assetId
      ? item.monitorTestMediaRef.assetId
      : null;
    const nextId = next ? next.assetId : null;
    if (currentId === nextId) return true;

    item.monitorTestMediaRef = next;
    _emit(setupIndex);
    return true;
  }

  function clearDesktopMonitorTestMedia(setupIndex, itemId) {
    return setDesktopMonitorTestMedia(setupIndex, itemId, null);
  }

  function setDesktopMonitorTestMediaScalingMode(setupIndex, itemId, mode) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopMonitors)) setup.desktopMonitors = [];

    const item = setup.desktopMonitors.find(entry => entry.id === itemId);
    if (!item) return false;

    const valid = ['center', 'aspect', 'full'];
    const nextMode = valid.includes(mode) ? mode : 'center';
    if (item.monitorTestMediaScalingMode === nextMode) return true;

    item.monitorTestMediaScalingMode = nextMode;
    _emit(setupIndex);
    return true;
  }

  function setDesktopMonitorLabel(setupIndex, itemId, labelText) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopMonitors)) setup.desktopMonitors = [];

    const item = setup.desktopMonitors.find(entry => entry.id === itemId);
    if (!item) return false;

    const existing = _ensureDesktopMonitorLabelSlot(item);
    const nextText = _normalizeLabelText(labelText, 30);

    if (!nextText) {
      if (!existing) return true;
      item.labels = [];
      _emit(setupIndex);
      return true;
    }

    if (existing && existing.text === nextText) return true;

    if (existing) {
      existing.text = nextText;
    } else {
      item.labels = [{
        id: _newLabelId(),
        text: nextText,
        colorClass: 'label-color-sky',
        x: 10,
        y: 10
      }];
    }

    _emit(setupIndex);
    return true;
  }

  function getDesktopMonitorLabel(setupIndex, itemId) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopMonitors)) setup.desktopMonitors = [];

    const item = setup.desktopMonitors.find(entry => entry.id === itemId);
    if (!item) return null;
    return _ensureDesktopMonitorLabelSlot(item);
  }

  function addDesktopMonitorLabel(setupIndex, itemId, text, colorClass, x, y) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopMonitors)) setup.desktopMonitors = [];

    const item = setup.desktopMonitors.find(entry => entry.id === itemId);
    if (!item) return null;

    const label = {
      id: _newLabelId(),
      text: _normalizeLabelText(text || 'Label', 30) || 'Label',
      colorClass: colorClass || 'label-color-sky',
      x: Number.isFinite(x) ? x : 10,
      y: Number.isFinite(y) ? y : 10
    };

    item.labels = [label];
    _emit(setupIndex);
    return label;
  }

  function updateDesktopMonitorLabel(setupIndex, itemId, labelId, changes) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopMonitors)) setup.desktopMonitors = [];

    const item = setup.desktopMonitors.find(entry => entry.id === itemId);
    if (!item) return false;

    const label = _ensureDesktopMonitorLabelSlot(item);
    if (!label || label.id !== labelId) return false;

    const next = Object.assign({}, label, changes || {});
    const normalized = _normalizeDesktopMonitorLabel(next);
    if (!normalized) return false;
    normalized.id = label.id;

    item.labels = [normalized];
    _emit(setupIndex);
    return true;
  }

  function removeDesktopMonitorLabel(setupIndex, itemId, labelId) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopMonitors)) setup.desktopMonitors = [];

    const item = setup.desktopMonitors.find(entry => entry.id === itemId);
    if (!item) return false;

    const label = _ensureDesktopMonitorLabelSlot(item);
    if (!label || label.id !== labelId) return false;

    item.labels = [];
    _emit(setupIndex);
    return true;
  }

  function removeDesktopMonitor(setupIndex, itemId) {
    if (setupIndex < 0 || setupIndex > 1) throw new RangeError('setupIndex must be 0 or 1');
    const setup = ws.setups[setupIndex];
    if (!Array.isArray(setup.desktopMonitors)) setup.desktopMonitors = [];

    const prevLen = setup.desktopMonitors.length;
    setup.desktopMonitors = setup.desktopMonitors.filter(entry => entry.id !== itemId);
    if (setup.desktopMonitors.length !== prevLen) {
      _emit(setupIndex);
      return true;
    }
    return false;
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
    _selectedZone = null;
    document.dispatchEvent(new CustomEvent('state:selection', { detail: _selected }));
  }

  function getSelected() { return _selected; }

  function setSelectedZone(setupIndex, row, col, zoneId) {
    _selectedZone = (setupIndex !== null && zoneId)
      ? { setupIndex, row, col, zoneId }
      : null;
  }

  function getSelectedZone() {
    return _selectedZone;
  }

  /** Get a cell value (read-only snapshot). */
  function getCell(setupIndex, row, col) {
    return ws.setups[setupIndex].grid[row][col];
  }

  /** Get full setup grid (read-only reference — do not mutate directly). */
  function getSetup(setupIndex) {
    return ws.setups[setupIndex];
  }

  /**
   * Export a setup as a plain JSON-serializable object (deep clone).
   * @param {number} setupIndex
   * @returns {{ id:string, name:string, grid:Array }}
   */
  function exportSetup(setupIndex) {
    const exported = JSON.parse(JSON.stringify(ws.setups[setupIndex]));
    exported.desktopConfig = _normalizeDesktopConfig(exported.desktopConfig);
    return exported;
  }

  /**
   * Replace a setup's name and grid with imported data.
   * Cells referencing unknown monitorIds are silently set to null.
   * @param {number} setupIndex
   * @param {{ name?:string, grid:Array }} data
   */
  function importSetup(setupIndex, data) {
    if (!data || !Array.isArray(data.grid)) return;

    // Normalise to 2 rows × 4 cols
    const newGrid = _emptyGrid();
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        const cell = data.grid[r] && data.grid[r][c];
        if (!cell || !cell.monitorId) continue;
        // Drop cells whose monitor is no longer in the catalog
        if (!CATALOG.some(m => m.id === cell.monitorId)) continue;
        const nextCell = JSON.parse(JSON.stringify(cell));
        nextCell.monitorTestMediaRef = _normalizeTestMediaRef(nextCell.monitorTestMediaRef);
        // Migrate legacy boolean auto-scale flag → mode enum
        if (!['center', 'aspect', 'full'].includes(nextCell.monitorTestMediaScalingMode)) {
          nextCell.monitorTestMediaScalingMode = nextCell.monitorTestMediaAutoScale ? 'full' : 'center';
        }
        delete nextCell.monitorTestMediaAutoScale;
        nextCell.windowedAppsEnabled = !!nextCell.windowedAppsEnabled;
        if (!Array.isArray(nextCell.windowedApps)) nextCell.windowedApps = [];
        nextCell.windowedApps = nextCell.windowedApps
          .map(app => _normalizeWindowedApp(nextCell, app))
          .filter(Boolean);
        if (Array.isArray(nextCell.pipZones)) {
          nextCell.pipZones.forEach(zone => {
            zone.testMediaRef = _normalizeTestMediaRef(zone.testMediaRef, zone.id);
          });
        }
        newGrid[r][c] = nextCell;
      }
    }

    ws.setups[setupIndex].grid = newGrid;
    ws.setups[setupIndex].desktopConfig = _normalizeDesktopConfigFromSetupData(data);
    ws.setups[setupIndex].desktopEquipment = Array.isArray(data.desktopEquipment)
      ? data.desktopEquipment.map(_normalizeDesktopEquipmentItem).filter(Boolean)
      : [];
    ws.setups[setupIndex].desktopMonitors = Array.isArray(data.desktopMonitors)
      ? data.desktopMonitors.map(_normalizeDesktopMonitorItem).filter(Boolean)
      : [];
    if (typeof data.name === 'string' && data.name.trim()) {
      ws.setups[setupIndex].name = data.name.trim();
    }

    // Clear selection if it was inside the replaced setup
    if (_selected && _selected.setupIndex === setupIndex) {
      _selected = null;
    }
    if (_selectedZone && _selectedZone.setupIndex === setupIndex) {
      _selectedZone = null;
    }

    _emit(setupIndex);
  }

  /**
   * Updates the reserved depth for a specific setup.
   * @param {number} setupIndex - The index of the setup to update.
   * @param {number} newDepth - The new reserved depth in mm.
   */
  function updateReservedDepth(setupIndex, newDepth) {
    if (setupIndex < 0 || setupIndex >= ws.setups.length) {
      console.error('Invalid setup index:', setupIndex);
      return;
    }

    const setup = ws.setups[setupIndex];
    setup.desktopConfig.reservedDepth_mm = _normalizeReservedDepth(newDepth, DESKTOP_DEFAULTS.reservedDepth_mm);

    // Emit state change event
    const event = new CustomEvent('state:changed', { detail: { setupIndex } });
    document.dispatchEvent(event);
  }

  return {
    placeMonitor, removeMonitor, moveMonitor,
    setResolution, setOrientation, setPipZones,
    setMonitorOffset, resetMonitorOffset,
    setDesktopConfig, getDesktopConfig,
    addDesktopEquipment, moveDesktopEquipment, removeDesktopEquipment, getDesktopEquipment, setEquipmentLabel,
    addDesktopMonitor, moveDesktopMonitor, setDesktopMonitorResolution, setDesktopMonitorOrientation,
    setDesktopMonitorTestMedia, clearDesktopMonitorTestMedia, setDesktopMonitorTestMediaScalingMode,
    setDesktopMonitorLabel,
    getDesktopMonitorLabel, addDesktopMonitorLabel, updateDesktopMonitorLabel, removeDesktopMonitorLabel,
    removeDesktopMonitor, getDesktopMonitors,
    setMonitorTestMedia, clearMonitorTestMedia, setMonitorTestMediaScalingMode,
    toggleWindowedMode,
    addWindowedApp, moveWindowedApp, resizeWindowedApp, removeWindowedApp,
    setZoneTestMedia, clearZoneTestMedia,
    addLabel, updateLabel, removeLabel,
    addZoneLabel, updateZoneLabel, removeZoneLabel,
    setStream, clearStreams,
    clearSetup, renameSetup,
    setSelected, getSelected, setSelectedZone, getSelectedZone,
    getCell, getSetup,
    exportSetup, importSetup,
    updateReservedDepth
  };
})();
