/**
 * catalog.js — Monitor catalog data
 * Sizes: 21", 24", 27", 32", 43", 49", 65"
 * Brands: Dell (≤32"), LG (43"+)
 * Physical dimensions are approximate real-world values in mm.
 */

/* global CATALOG */
// eslint-disable-next-line prefer-const
let CATALOG = [
  {
    id: 'dell-21-fhd',
    builtIn: true,
    size: 21,
    brand: 'Dell',
    modelName: 'Dell SE2122H',
    panelType: 'VA',
    physicalWidth_mm: 476,
    physicalHeight_mm: 268,
    aspectRatio: '16:9',
    pipSupported: false,
    resolutions: [
      { label: '1920×1080 (FHD, 75Hz)',  width: 1920, height: 1080, refresh: 75 }
    ]
  },
  {
    id: 'dell-24-fhd',
    builtIn: true,
    size: 24,
    brand: 'Dell',
    modelName: 'Dell S2421HN',
    panelType: 'IPS',
    physicalWidth_mm: 531,
    physicalHeight_mm: 299,
    aspectRatio: '16:9',
    pipSupported: false,
    resolutions: [
      { label: '1920×1080 (FHD, 75Hz)',  width: 1920, height: 1080, refresh: 75 },
      { label: '1920×1080 (FHD, 60Hz)',  width: 1920, height: 1080, refresh: 60 }
    ]
  },
  {
    id: 'dell-27-qhd',
    builtIn: true,
    size: 27,
    brand: 'Dell',
    modelName: 'Dell S2722QC',
    panelType: 'IPS',
    physicalWidth_mm: 614,
    physicalHeight_mm: 346,
    aspectRatio: '16:9',
    pipSupported: true,
    resolutions: [
      { label: '3840×2160 (4K, 60Hz)',   width: 3840, height: 2160, refresh: 60 },
      { label: '2560×1440 (QHD, 75Hz)',  width: 2560, height: 1440, refresh: 75 },
      { label: '1920×1080 (FHD, 75Hz)',  width: 1920, height: 1080, refresh: 75 }
    ]
  },
  {
    id: 'dell-32-4k',
    builtIn: true,
    size: 32,
    brand: 'Dell',
    modelName: 'Dell U3223QE',
    panelType: 'IPS',
    physicalWidth_mm: 709,
    physicalHeight_mm: 399,
    aspectRatio: '16:9',
    pipSupported: true,
    resolutions: [
      { label: '7680×4320 (8K, 60Hz)',   width: 7680, height: 4320, refresh: 60 },
      { label: '3840×2160 (4K, 60Hz)',   width: 3840, height: 2160, refresh: 60 },
      { label: '2560×1440 (QHD, 60Hz)',  width: 2560, height: 1440, refresh: 60 },
      { label: '1920×1080 (FHD, 60Hz)',  width: 1920, height: 1080, refresh: 60 }
    ]
  },
  {
    id: 'lg-43-4k',
    builtIn: true,
    size: 43,
    brand: 'LG',
    modelName: 'LG 43UN700-B',
    panelType: 'IPS',
    physicalWidth_mm: 962,
    physicalHeight_mm: 541,
    aspectRatio: '16:9',
    pipSupported: true,
    resolutions: [
      { label: '7680×4320 (8K, 60Hz)',   width: 7680, height: 4320, refresh: 60 },
      { label: '3840×2160 (4K, 60Hz)',   width: 3840, height: 2160, refresh: 60 },
      { label: '2560×1440 (QHD, 60Hz)',  width: 2560, height: 1440, refresh: 60 },
      { label: '1920×1080 (FHD, 60Hz)',  width: 1920, height: 1080, refresh: 60 }
    ]
  },
  {
    id: 'lg-49-uwqhd',
    builtIn: true,
    size: 49,
    brand: 'LG',
    modelName: 'LG 49WQ95C-W',
    panelType: 'IPS',
    physicalWidth_mm: 1193,
    physicalHeight_mm: 337,
    aspectRatio: '32:9',
    pipSupported: true,
    resolutions: [
      { label: '5120×1440 (DQHD, 144Hz)', width: 5120, height: 1440, refresh: 144 },
      { label: '3840×1080 (UWFHD, 144Hz)', width: 3840, height: 1080, refresh: 144 },
      { label: '2560×720 (60Hz)',           width: 2560, height:  720, refresh: 60  }
    ]
  },
  {
    id: 'lg-65-4k',
    builtIn: true,
    size: 65,
    brand: 'LG',
    modelName: 'LG 65UN7300PUF',
    panelType: 'IPS',
    physicalWidth_mm: 1449,
    physicalHeight_mm: 840,
    aspectRatio: '16:9',
    pipSupported: true,
    resolutions: [
      { label: '7680×4320 (8K, 60Hz)',   width: 7680, height: 4320, refresh: 60 },
      { label: '3840×2160 (4K, 60Hz)',   width: 3840, height: 2160, refresh: 60 },
      { label: '1920×1080 (FHD, 60Hz)',  width: 1920, height: 1080, refresh: 60 }
    ]
  }
];

/**
 * Get a monitor spec by id (searches all including custom).
 * @param {string} id
 * @returns {object|undefined}
 */
function catalogGetById(id) {
  return CATALOG.find(m => m.id === id);
}

/**
 * Get monitors filtered by size (inches). Pass null/undefined for all.
 * @param {number|null} size
 * @returns {object[]}
 */
function catalogFilter(size) {
  if (!size) return CATALOG.slice();
  return CATALOG.filter(m => m.size === size);
}

/**
 * Get all monitors (built-in + custom).
 * @returns {object[]}
 */
function catalogGetAll() {
  return CATALOG.slice();
}

// ---- Custom monitor persistence ----
const _STORAGE_KEY = 'screenplanner_custom_monitors';

function _saveCustom() {
  const custom = CATALOG.filter(m => !m.builtIn);
  try {
    localStorage.setItem(_STORAGE_KEY, JSON.stringify(custom));
  } catch (_) { /* storage unavailable */ }
}

function _loadCustom() {
  try {
    const raw = localStorage.getItem(_STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return;
    entries.forEach(m => {
      // Guard: never overwrite a built-in entry
      if (!m.id || CATALOG.some(e => e.id === m.id)) return;
      m.builtIn = false;
      CATALOG.push(m);
    });
  } catch (_) { /* ignore corrupt data */ }
}

/**
 * Add a custom monitor to the catalog and persist it.
 * @param {object} spec - Monitor spec (sans id/builtIn)
 * @returns {object} The created entry
 */
function catalogAddCustom(spec) {
  const slug = (spec.brand || 'custom').toLowerCase().replace(/\s+/g, '-');
  const id = 'custom-' + slug + '-' + Date.now();
  const entry = Object.assign({}, spec, { id, builtIn: false });
  CATALOG.push(entry);
  _saveCustom();
  return entry;
}

/**
 * Remove a custom monitor by id. Cannot remove built-in entries.
 * @param {string} id
 */
function catalogRemoveCustom(id) {
  const idx = CATALOG.findIndex(m => m.id === id && !m.builtIn);
  if (idx === -1) return;
  CATALOG.splice(idx, 1);
  _saveCustom();
}

// Load custom monitors saved in previous sessions
_loadCustom();
