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

    console.log('--- ALL BASIC CHECKS COMPLETED ---');
} catch (err) {
    console.error('TEST FAILED:');
    console.error(err);
    process.exit(1);
}
