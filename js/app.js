/**
 * app.js — Entry point. Initialises all modules in dependency order.
 *
 * Load order (enforced by index.html <script> tags):
 *   catalog.js → state.js → grid.js → canvas.js → drag.js → labels.js → pip.js → ui.js → app.js
 */

/* global GRID, CANVAS, DRAG, LABELS, POPOVER, UI */

(function init() {
  // 1. Grid math (reads CSS --mm-scale)
  GRID.init();

  // 2. Canvas (subscribes to state:changed)
  CANVAS.init();

  // 3. Drag wiring
  DRAG.init();

  // 4. Labels (builds swatch buttons, subscribes to outside-click)
  LABELS.init();

  // 5. Popover
  POPOVER.init();

  // 6. UI (renders catalog, binds controls, subscribes to state:changed for info strip)
  UI.init();

  // 7. Initial render of both setups
  CANVAS.render(0);
  CANVAS.render(1);

  // 8. Attach SVG drop targets (catalog → canvas HTML5 drag)
  DRAG.attachSvgDropTargets();
})();
