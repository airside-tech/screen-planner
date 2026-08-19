const fs = require('fs');

// Mock browser globals
global.window = {};
global.document = {
    dispatchEvent: () => {}
};
global.getComputedStyle = () => ({
    getPropertyValue: () => '0.8'
});
global.CustomEvent = function CustomEvent(type, params) {
    this.type = type;
    this.detail = params && params.detail;
};
global.localStorage = {
    _store: {},
    getItem(key) {
        return Object.prototype.hasOwnProperty.call(this._store, key) ? this._store[key] : null;
    },
    setItem(key, value) {
        this._store[key] = String(value);
    },
    removeItem(key) {
        delete this._store[key];
    }
};

// Read and evaluate dependencies
const catalogCode = fs.readFileSync('js/catalog.js', 'utf8');
const CATALOG = new Function(`${catalogCode}\nreturn CATALOG;`)();
global.CATALOG = CATALOG;

const gridCode = fs.readFileSync('js/grid.js', 'utf8');
const GRID = new Function(`${gridCode}\nreturn GRID;`)();
global.GRID = GRID;

const stateCode = fs.readFileSync('js/state.js', 'utf8');
const STATE = new Function(`${stateCode}\nreturn STATE;`)();
global.STATE = STATE;

const testMediaCode = fs.readFileSync('js/testmedia.js', 'utf8');
const TEST_MEDIA = new Function(`${testMediaCode}\nreturn TEST_MEDIA;`)();
global.TEST_MEDIA = TEST_MEDIA;

// Basic regression test: Check GRID properties and a simple function
try {
    console.log('--- Screen Planner Regression Test ---');
    
    // Test 1: GRID Constants
    if (GRID.MAX_ROWS === 2 && GRID.MAX_COLS === 4) {
        console.log('PASS: GRID constants (MAX_ROWS, MAX_COLS)');
    } else {
        throw new Error('FAIL: GRID constants mismatch');
    }

    // Test 2: Catalog existence
    if (Array.isArray(CATALOG) && CATALOG.length > 0) {
        console.log('PASS: CATALOG models loaded');
    } else {
        throw new Error('FAIL: CATALOG not loaded correctly');
    }

    // Test 3: Math check
    // GRID.mmToDisplay depends on _mmScale which is set in init()
    // By default it's 0.8 in the comment, but let's see what happens if we init it.
    GRID.init(); 
    const val = GRID.mmToDisplay(100);
    if (val === 80) {
        console.log('PASS: mmToDisplay (100mm -> 80px) with default scale');
    } else {
        console.log('INFO: mmToDisplay result was ' + val + ' (Expected 80 if scale is 0.8)');
    }

    // Test 4: Reserved depth persists in setup export/import
    STATE.setDesktopConfig(0, { enabled: true, reservedDepth_mm: 420 });
    const exported = STATE.exportSetup(0);
    if (exported.desktopConfig && exported.desktopConfig.reservedDepth_mm === 420) {
        console.log('PASS: exportSetup includes desktop reserved depth');
    } else {
        throw new Error('FAIL: exportSetup missing/incorrect reserved depth');
    }

    // Test 5: Legacy import fallback for top-level reservedDepth_mm
    STATE.importSetup(1, {
        name: 'Legacy Setup',
        grid: [
            [null, null, null, null],
            [null, null, null, null]
        ],
        desktopConfig: { enabled: true, width_mm: 1500, height_mm: 800 },
        reservedDepth_mm: 360
    });
    const importedConfig = STATE.getDesktopConfig(1);
    if (importedConfig.reservedDepth_mm === 360) {
        console.log('PASS: importSetup restores reserved depth from legacy payload');
    } else {
        throw new Error('FAIL: importSetup did not restore legacy reserved depth');
    }

    // Test 6: Desktop monitor label object defaults and updates
    const monitor = CATALOG.find(m => m.category !== 'equipment');
    if (!monitor) {
        throw new Error('FAIL: no non-equipment monitor found in catalog');
    }
    const desktopMonitor = STATE.addDesktopMonitor(0, monitor.id);
    const addedDesktopLabel = STATE.addDesktopMonitorLabel(0, desktopMonitor.id, 'Desk Main', 'label-color-teal', 10, 10);
    if (!addedDesktopLabel || addedDesktopLabel.x !== 10 || addedDesktopLabel.y !== 10) {
        throw new Error('FAIL: addDesktopMonitorLabel did not default to upper-left placement');
    }

    const fetchedDesktopLabel = STATE.getDesktopMonitorLabel(0, desktopMonitor.id);
    if (!fetchedDesktopLabel || fetchedDesktopLabel.text !== 'Desk Main') {
        throw new Error('FAIL: getDesktopMonitorLabel did not return expected label');
    }

    const moved = STATE.updateDesktopMonitorLabel(0, desktopMonitor.id, fetchedDesktopLabel.id, { x: 22, y: 18, text: 'Desk A' });
    const updatedDesktopLabel = STATE.getDesktopMonitorLabel(0, desktopMonitor.id);
    if (!moved || !updatedDesktopLabel || updatedDesktopLabel.x !== 22 || updatedDesktopLabel.y !== 18 || updatedDesktopLabel.text !== 'Desk A') {
        throw new Error('FAIL: updateDesktopMonitorLabel did not persist changes');
    }
    console.log('PASS: desktop monitor label add/get/update flow');

    // Test 7: Legacy desktop monitor string label migration
    STATE.importSetup(1, {
        name: 'Legacy Desktop Label Setup',
        grid: [
            [null, null, null, null],
            [null, null, null, null]
        ],
        desktopMonitors: [{
            id: 'legacy-desktop-monitor',
            monitorId: monitor.id,
            selectedResolution: monitor.resolutions[0],
            orientation: 'landscape',
            x_mm: 0,
            y_mm: 0,
            label: 'Legacy Label'
        }]
    });
    const migratedLabel = STATE.getDesktopMonitorLabel(1, 'legacy-desktop-monitor');
    if (!migratedLabel || migratedLabel.text !== 'Legacy Label' || migratedLabel.x !== 10 || migratedLabel.y !== 10) {
        throw new Error('FAIL: legacy desktop monitor string label was not migrated');
    }
    console.log('PASS: legacy desktop monitor label migration');

    // Test 8: Legacy test media assets without optional metadata still load
    localStorage.setItem('screenplanner_test_media_library', JSON.stringify([{
        id: 'legacy-test-media',
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6d8AAAAASUVORK5CYII=',
        width: 1,
        height: 1
    }]));
    TEST_MEDIA.setEnabled(true);
    TEST_MEDIA.init();
    const legacyAsset = TEST_MEDIA.getById('legacy-test-media');
    if (!legacyAsset || legacyAsset.mimeType !== 'image/png' || legacyAsset.name !== 'Test media') {
        throw new Error('FAIL: legacy test media asset was not normalized on load');
    }
    console.log('PASS: legacy test media asset migration');

    console.log('--- ALL BASIC CHECKS COMPLETED ---');
} catch (err) {
    console.error('TEST FAILED:');
    console.error(err);
    process.exit(1);
}
