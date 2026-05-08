/**
 * app.js — Entry point. Initialises all modules in dependency order.
 *
 * Load order (enforced by index.html <script> tags):
 *   catalog.js → state.js → grid.js → canvas.js → drag.js → labels.js → pip.js → ui.js → app.js
 */

/* global GRID, CANVAS, DRAG, LABELS, POPOVER, UI, STATE, TEST_MEDIA */

const FEATURES = {
  testMedia: true
};

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

  // 6. Feature modules
  if (typeof TEST_MEDIA !== 'undefined' && TEST_MEDIA.setEnabled) {
    TEST_MEDIA.setEnabled(!!FEATURES.testMedia);
    if (TEST_MEDIA.isEnabled()) {
      TEST_MEDIA.init();
    }
  }

  // 7. UI (renders catalog, binds controls, subscribes to state:changed for info strip)
  UI.init();

  // 8. Restore previously saved setups from localStorage
  _loadSetupsFromStorage();

  // 9. Initial render of both setups
  CANVAS.render(0);
  CANVAS.render(1);

  // 10. Attach SVG drop targets (catalog → canvas HTML5 drag)
  DRAG.attachSvgDropTargets();

  // 11. Auto-save setups to localStorage on every change
  document.addEventListener('state:changed', e => {
    const idx = e.detail.setupIndex;
    try {
      localStorage.setItem(
        'screenplanner_setup_' + idx,
        JSON.stringify(STATE.exportSetup(idx))
      );
    } catch (_) { /* storage unavailable */ }
  });
})();

function _loadSetupsFromStorage() {
  [0, 1].forEach(idx => {
    try {
      const raw = localStorage.getItem('screenplanner_setup_' + idx);
      if (!raw) return;
      const data = JSON.parse(raw);
      STATE.importSetup(idx, data);
      // Sync the editable title span with the restored name
      const suffix = idx === 0 ? 'A' : 'B';
      const titleEl = document.getElementById('title' + suffix);
      const setup = STATE.getSetup(idx);
      if (titleEl && setup && setup.name) titleEl.textContent = setup.name;
    } catch (_) { /* ignore corrupt data */ }
  });
}
