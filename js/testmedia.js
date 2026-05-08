/**
 * testmedia.js — Isolated library for uploaded test images.
 *
 * Scope:
 *  - Accept PNG/JPG/WebP uploads
 *  - Persist library to localStorage
 *  - Export/import library JSON
 *  - Provide lookup by asset id for render modules
 */

const TEST_MEDIA = (() => {
  const STORAGE_KEY = 'screenplanner_test_media_library';
  const SOFT_STORAGE_LIMIT_BYTES = 4.5 * 1024 * 1024;
  const ACCEPT_MIME = ['image/png', 'image/jpeg', 'image/webp'];

  let _enabled = false;
  let _assets = [];

  function _emitChanged(detail) {
    document.dispatchEvent(new CustomEvent('testmedia:library-changed', {
      detail: detail || {}
    }));
  }

  function setEnabled(enabled) {
    _enabled = !!enabled;
  }

  function isEnabled() {
    return _enabled;
  }

  function init() {
    if (!_enabled) return;
    _load();
    _emitChanged({ reason: 'init' });
    _migrateMissingDimensions();
  }

  /**
   * Back-fill width/height for assets that were stored before the dimension
   * measurement step was added to addFromFile(). Runs asynchronously; once all
   * pending probes finish, saves the library and dispatches a state:changed
   * event so every canvas re-renders with the corrected scale values.
   */
  function _migrateMissingDimensions() {
    const toMigrate = _assets.filter(a => !(a.width > 0 && a.height > 0));
    if (!toMigrate.length) return;

    let remaining = toMigrate.length;

    function _done() {
      remaining--;
      if (remaining > 0) return;
      try { _save(); } catch (_) {}
      // Re-render both canvases so the corrected scale is shown immediately
      document.dispatchEvent(new CustomEvent('state:changed', { detail: { setupIndex: 0 } }));
      document.dispatchEvent(new CustomEvent('state:changed', { detail: { setupIndex: 1 } }));
    }

    toMigrate.forEach(asset => {
      const img = new Image();
      img.onload = () => {
        asset.width  = img.naturalWidth;
        asset.height = img.naturalHeight;
        _done();
      };
      img.onerror = () => _done();
      img.src = asset.dataUrl;
    });
  }

  function list() {
    return _assets.slice();
  }

  function getById(assetId) {
    if (!_enabled || !assetId) return null;
    return _assets.find(a => a.id === assetId) || null;
  }

  function estimateStorageBytes() {
    return JSON.stringify(_assets).length;
  }

  function _makeId() {
    return 'tm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  function _isSupportedFile(file) {
    if (!file) return false;
    if (ACCEPT_MIME.includes(file.type)) return true;
    const name = (file.name || '').toLowerCase();
    return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp');
  }

  function _save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_assets));
  }

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        _assets = [];
        return;
      }
      const parsed = JSON.parse(raw);
      _assets = Array.isArray(parsed) ? parsed.filter(_isValidAsset) : [];
    } catch (_) {
      _assets = [];
    }
  }

  function _isValidAsset(asset) {
    return !!(
      asset &&
      typeof asset.id === 'string' && asset.id &&
      typeof asset.name === 'string' &&
      typeof asset.mimeType === 'string' &&
      typeof asset.dataUrl === 'string' && asset.dataUrl
    );
  }

  function addFromFile(file) {
    return new Promise(resolve => {
      if (!_enabled) {
        resolve({ ok: false, error: 'Feature disabled.' });
        return;
      }
      if (!_isSupportedFile(file)) {
        resolve({ ok: false, error: 'Only PNG/JPG/WebP images are supported.' });
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        if (!dataUrl) {
          resolve({ ok: false, error: 'Could not read image file.' });
          return;
        }

        // Measure intrinsic pixel dimensions before saving
        const probe = new Image();
        probe.onload = () => {
          const asset = {
            id: _makeId(),
            name: file.name || 'test-image',
            mimeType: file.type || 'image/png',
            dataUrl,
            width: probe.naturalWidth,
            height: probe.naturalHeight,
            createdAt: Date.now()
          };

          _assets.push(asset);
          try {
            _save();
          } catch (_) {
            _assets = _assets.filter(a => a.id !== asset.id);
            resolve({ ok: false, error: 'Storage is full. Remove some test media and try again.' });
            return;
          }

          const warning = estimateStorageBytes() > SOFT_STORAGE_LIMIT_BYTES
            ? 'Library is getting large. Browser storage limits may be reached soon.'
            : null;

          _emitChanged({ reason: 'add', assetId: asset.id, warning });
          resolve({ ok: true, asset, warning });
        };
        probe.onerror = () => {
          resolve({ ok: false, error: 'Could not decode image dimensions.' });
        };
        probe.src = dataUrl;
      };

      reader.onerror = () => {
        resolve({ ok: false, error: 'Could not read image file.' });
      };

      reader.readAsDataURL(file);
    });
  }

  function remove(assetId) {
    if (!_enabled || !assetId) return false;
    const before = _assets.length;
    _assets = _assets.filter(a => a.id !== assetId);
    if (_assets.length === before) return false;

    try {
      _save();
    } catch (_) {
      return false;
    }
    _emitChanged({ reason: 'remove', assetId });
    return true;
  }

  return {
    setEnabled,
    isEnabled,
    init,
    list,
    getById,
    addFromFile,
    remove,
    estimateStorageBytes
  };
})();
