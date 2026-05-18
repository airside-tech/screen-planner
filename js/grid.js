/**
 * grid.js — Grid constraint logic and dimension calculations.
 *
 * Display scaling:
 *   Physical mm → display px using --mm-scale CSS variable (default 0.8 px/mm).
 *   Scale is read once at init and cached.
 *
 * Grid layout:
 *   Cells are drawn in a fixed 2×4 grid. Empty cells get dashed-border placeholders.
 *   Cell display width = physicalWidth_mm × mmScale   (or a minimum fallback)
 *   Cell display height = physicalHeight_mm × mmScale (or a minimum fallback)
 *   Per-column width = max physicalWidth_mm among monitors in that column × mmScale
 *   Per-row height   = max physicalHeight_mm among monitors in that row × mmScale
 */

/* global CATALOG, STATE */

const GRID = (() => {
  const MAX_ROWS = 2;
  const MAX_COLS = 4;

  // Fallback cell dimensions when no monitor is placed (display px)
  const EMPTY_CELL_W = 120;
  const EMPTY_CELL_H = 80;

  // Padding between cells (display px)
  const CELL_GAP = 10;

  // Margins around the whole grid for dimension annotations
  const MARGIN_TOP    = 10;
  const MARGIN_LEFT   = 60;  // space for row-height annotations on the left
  const MARGIN_BOTTOM = 50;  // space for col-width annotations below
  const MARGIN_RIGHT  = 10;
  const DESKTOP_GAP = 24;

  let _mmScale = 0.8;

  function init() {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--mm-scale').trim();
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && parsed > 0) _mmScale = parsed;
  }

  function _physicalSizeForCell(cell, monitor) {
    if (cell && cell.orientation === 'portrait') {
      return {
        width_mm: monitor.physicalHeight_mm,
        height_mm: monitor.physicalWidth_mm
      };
    }

    return {
      width_mm: monitor.physicalWidth_mm,
      height_mm: monitor.physicalHeight_mm
    };
  }

  /**
   * Compute column widths and row heights for a given setup grid.
   * Returns { colWidths: number[], rowHeights: number[], colWidths_mm: number[], rowHeights_mm: number[] }
   */
  function calcDimensions(setupIndex) {
    const grid = STATE.getSetup(setupIndex).grid;

    const colWidths_mm  = new Array(MAX_COLS).fill(0);
    const rowHeights_mm = new Array(MAX_ROWS).fill(0);

    for (let r = 0; r < MAX_ROWS; r++) {
      for (let c = 0; c < MAX_COLS; c++) {
        const cell = grid[r][c];
        if (!cell) continue;
        const mon = CATALOG.find(m => m.id === cell.monitorId);
        if (!mon) continue;
        const physicalSize = _physicalSizeForCell(cell, mon);
        if (physicalSize.width_mm  > colWidths_mm[c])  colWidths_mm[c]  = physicalSize.width_mm;
        if (physicalSize.height_mm > rowHeights_mm[r]) rowHeights_mm[r] = physicalSize.height_mm;
      }
    }

    const colWidths  = colWidths_mm.map(w  => w  > 0 ? w  * _mmScale : EMPTY_CELL_W);
    const rowHeights = rowHeights_mm.map(h => h  > 0 ? h  * _mmScale : EMPTY_CELL_H);

    return { colWidths, rowHeights, colWidths_mm, rowHeights_mm };
  }

  /**
   * Compute (x, y, w, h) for a cell in display coordinates.
   * @param {number[]} colWidths
   * @param {number[]} rowHeights
   * @param {number} row
   * @param {number} col
   * @returns {{ x: number, y: number, w: number, h: number }}
   */
  function cellRect(colWidths, rowHeights, row, col) {
    let x = MARGIN_LEFT;
    for (let c = 0; c < col; c++) x += colWidths[c] + CELL_GAP;

    let y = MARGIN_TOP;
    for (let r = 0; r < row; r++) y += rowHeights[r] + CELL_GAP;

    return { x, y, w: colWidths[col], h: rowHeights[row] };
  }

  function _gridSize(colWidths, rowHeights) {
    const totalW = colWidths.reduce((a, b) => a + b, 0) + CELL_GAP * (MAX_COLS - 1);
    const totalH = rowHeights.reduce((a, b) => a + b, 0) + CELL_GAP * (MAX_ROWS - 1);
    return { totalW, totalH };
  }

  function desktopRect(setupIndex, colWidths, rowHeights) {
    const setup = STATE.getSetup(setupIndex);
    if (!setup || !setup.desktopConfig || !setup.desktopConfig.enabled) return null;

    const { totalW, totalH } = _gridSize(colWidths, rowHeights);
    const desktopW = mmToDisplay(setup.desktopConfig.width_mm || 0);
    const desktopH = mmToDisplay(setup.desktopConfig.height_mm || 0);
    if (desktopW <= 0 || desktopH <= 0) return null;

    const anchorX = MARGIN_LEFT;
    const baseX = desktopW <= totalW
      ? anchorX + (totalW - desktopW) / 2
      : anchorX;
    const requestedOffsetPx = mmToDisplay(setup.desktopConfig.x_offset_mm || 0);
    const minX = MARGIN_LEFT;
    const maxX = MARGIN_LEFT + Math.max(0, totalW - desktopW);
    const x = Math.max(minX, Math.min(maxX, baseX + requestedOffsetPx));
    const y = MARGIN_TOP + totalH + MARGIN_BOTTOM + DESKTOP_GAP;
    return { x, y, w: desktopW, h: desktopH };
  }

  /**
   * Total SVG canvas size needed.
   */
  function svgSize(colWidths, rowHeights, setupIndex) {
    const { totalW, totalH } = _gridSize(colWidths, rowHeights);
    const desktop = Number.isInteger(setupIndex)
      ? desktopRect(setupIndex, colWidths, rowHeights)
      : null;
    const contentW = Math.max(totalW, desktop ? desktop.w : 0);
    const contentH = totalH + (desktop ? (MARGIN_BOTTOM + DESKTOP_GAP + desktop.h) : 0);
    return {
      width:  MARGIN_LEFT + contentW + MARGIN_RIGHT,
      height: MARGIN_TOP  + contentH + MARGIN_BOTTOM
    };
  }

  /**
   * Count occupied cells in a setup.
   */
  function occupiedCount(setupIndex) {
    const grid = STATE.getSetup(setupIndex).grid;
    let count = 0;
    grid.forEach(row => row.forEach(c => { if (c) count++; }));
    return count;
  }

  /**
   * Check whether a cell position is valid and empty.
   */
  function canPlace(setupIndex, row, col) {
    if (row < 0 || row >= MAX_ROWS) return false;
    if (col < 0 || col >= MAX_COLS) return false;
    return STATE.getCell(setupIndex, row, col) === null;
  }

    /**
     * Compute total physical width of a setup in mm.
     * Uses the bounding box of all placed monitors (including manual offsetX)
     * so empty drop areas are excluded and position adjustments are reflected.
     * Returns 0 if nothing is placed.
     */
    function totalWidth_mm(setupIndex) {
      const grid = STATE.getSetup(setupIndex).grid;
      const dims = calcDimensions(setupIndex);
      let minLeft = Infinity, maxRight = -Infinity;
      for (let r = 0; r < MAX_ROWS; r++) {
        for (let c = 0; c < MAX_COLS; c++) {
          const cell = grid[r][c];
          if (!cell) continue;
          const mon = CATALOG.find(m => m.id === cell.monitorId);
          if (!mon) continue;
          const phys = _physicalSizeForCell(cell, mon);
          const rect = cellRect(dims.colWidths, dims.rowHeights, r, c);
          const left  = rect.x + (cell.offsetX || 0);
          const right = left + phys.width_mm * _mmScale;
          if (left  < minLeft)  minLeft  = left;
          if (right > maxRight) maxRight = right;
        }
      }
      if (!isFinite(minLeft)) return 0;
      return (maxRight - minLeft) / _mmScale;
    }

    /**
     * Compute total physical height of a setup in mm.
     * Uses the bounding box of all placed monitors (including manual offsetY)
     * so empty drop areas are excluded and position adjustments are reflected.
     * Returns 0 if nothing is placed.
     */
    function totalHeight_mm(setupIndex) {
      const grid = STATE.getSetup(setupIndex).grid;
      const dims = calcDimensions(setupIndex);
      let minTop = Infinity, maxBottom = -Infinity;
      for (let r = 0; r < MAX_ROWS; r++) {
        for (let c = 0; c < MAX_COLS; c++) {
          const cell = grid[r][c];
          if (!cell) continue;
          const mon = CATALOG.find(m => m.id === cell.monitorId);
          if (!mon) continue;
          const phys = _physicalSizeForCell(cell, mon);
          const rect = cellRect(dims.colWidths, dims.rowHeights, r, c);
          const top    = rect.y + (cell.offsetY || 0);
          const bottom = top + phys.height_mm * _mmScale;
          if (top    < minTop)    minTop    = top;
          if (bottom > maxBottom) maxBottom = bottom;
        }
      }
      if (!isFinite(minTop)) return 0;
      return (maxBottom - minTop) / _mmScale;
    }

  function mmToDisplay(mm) { return mm * _mmScale; }

  return {
    MAX_ROWS, MAX_COLS, CELL_GAP,
    MARGIN_TOP, MARGIN_LEFT, MARGIN_BOTTOM, MARGIN_RIGHT,
    DESKTOP_GAP,
    EMPTY_CELL_W, EMPTY_CELL_H,
    init, calcDimensions, cellRect, desktopRect, svgSize,
    occupiedCount, canPlace,
    totalWidth_mm, totalHeight_mm,
    mmToDisplay
  };
})();
