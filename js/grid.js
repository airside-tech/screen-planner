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

  let _mmScale = 0.8;

  function init() {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--mm-scale').trim();
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && parsed > 0) _mmScale = parsed;
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
        if (mon.physicalWidth_mm  > colWidths_mm[c])  colWidths_mm[c]  = mon.physicalWidth_mm;
        if (mon.physicalHeight_mm > rowHeights_mm[r]) rowHeights_mm[r] = mon.physicalHeight_mm;
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

  /**
   * Total SVG canvas size needed.
   */
  function svgSize(colWidths, rowHeights) {
    const totalW = colWidths.reduce((a, b) => a + b, 0) + CELL_GAP * (MAX_COLS - 1);
    const totalH = rowHeights.reduce((a, b) => a + b, 0) + CELL_GAP * (MAX_ROWS - 1);
    return {
      width:  MARGIN_LEFT + totalW + MARGIN_RIGHT,
      height: MARGIN_TOP  + totalH + MARGIN_BOTTOM
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
   * Compute total physical width of a setup (all occupied columns) in mm.
   * Returns 0 if nothing is placed.
   */
  function totalWidth_mm(setupIndex) {
    const { colWidths_mm } = calcDimensions(setupIndex);
    return colWidths_mm.filter(w => w > 0).reduce((a, b) => a + b, 0);
  }

  /**
   * Compute max total physical height in mm (tallest row combination).
   */
  function totalHeight_mm(setupIndex) {
    const { rowHeights_mm } = calcDimensions(setupIndex);
    return rowHeights_mm.filter(h => h > 0).reduce((a, b) => a + b, 0);
  }

  function mmToDisplay(mm) { return mm * _mmScale; }

  return {
    MAX_ROWS, MAX_COLS, CELL_GAP,
    MARGIN_TOP, MARGIN_LEFT, MARGIN_BOTTOM, MARGIN_RIGHT,
    EMPTY_CELL_W, EMPTY_CELL_H,
    init, calcDimensions, cellRect, svgSize,
    occupiedCount, canPlace,
    totalWidth_mm, totalHeight_mm,
    mmToDisplay
  };
})();
