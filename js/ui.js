/**
 * ui.js — Sidebar rendering, popover management, info strip updates.
 *
 * Also exposes POPOVER global used by canvas.js.
 */

/* global CATALOG, STATE, GRID, CANVAS, DRAG, LABELS, TEST_MEDIA, catalogGetAll, catalogAddCustom, catalogRemoveCustom, catalogExport, catalogImportCustom */

/* ================================================================
   POPOVER
   ================================================================ */
const POPOVER = (() => {
  let _current = null; // { type:'grid', setupIndex, row, col } | { type:'desktop-monitor', setupIndex, itemId } | { type:'equipment', setupIndex, itemId }

  const el   = id => document.getElementById(id);
  const popEl = () => el('monitorPopover');

  function _isDesktopMonitorCurrent() {
    return !!(_current && _current.type === 'desktop-monitor');
  }

  function _isEquipmentCurrent() {
    return !!(_current && _current.type === 'equipment');
  }

  function _getDesktopMonitorCurrent() {
    if (!_isDesktopMonitorCurrent()) return null;
    const item = STATE.getDesktopMonitors(_current.setupIndex)
      .find(entry => entry.id === _current.itemId);
    if (!item) return null;
    const monitor = CATALOG.find(m => m.id === item.monitorId && m.category !== 'equipment');
    if (!monitor) return null;
    return { item, monitor };
  }

  function _getEquipmentCurrent() {
    if (!_isEquipmentCurrent()) return null;
    const item = STATE.getDesktopEquipment(_current.setupIndex)
      .find(entry => entry.id === _current.itemId);
    if (!item) return null;
    const equipment = CATALOG.find(e => e.id === item.equipmentId && e.category === 'equipment');
    if (!equipment) return null;
    return { item, equipment };
  }

  function _resolutionTierTag(width, height) {
    const longEdge = Math.max(width || 0, height || 0);
    const shortEdge = Math.min(width || 0, height || 0);

    if ((longEdge === 8192 && shortEdge === 4320) || (longEdge === 7680 && shortEdge === 4320)) {
      return ' (8K)';
    }
    if ((longEdge === 4096 && shortEdge === 2160) || (longEdge === 3840 && shortEdge === 2160)) {
      return ' (4K)';
    }
    if ((longEdge === 2560 && shortEdge === 1440) || (longEdge === 2048 && shortEdge === 1080)) {
      return ' (2K)';
    }
    return '';
  }

  function _formatResolution(resolution, orientation) {
    const width = orientation === 'portrait' ? resolution.height : resolution.width;
    const height = orientation === 'portrait' ? resolution.width : resolution.height;
    return `${width}×${height}${_resolutionTierTag(width, height)} (${resolution.refresh}Hz)`;
  }

  function _syncPopoverFields() {
    if (!_current) return null;

    const isDesktopMonitor = _isDesktopMonitorCurrent();
    const isEquipment = _isEquipmentCurrent();
    const selector = el('pipZoneSelector');
    const pipRow = selector ? selector.closest('.popover-row') : null;
    const testMediaRow = el('popoverTestMediaRow');
    const autoScaleRow = el('popoverAutoScaleRow');
    const statusEl = el('testMediaStatus');
    const removeBtn = el('removeMonitorBtn');
    const windowedAppsBtn = el('windowedAppsBtn');
    const resolutionPickerControl = el('resolutionPicker');
    const orientationPickerControl = el('orientationPicker');
    const addLabelBtn = el('addLabelBtn');
    const resolutionLabel = document.querySelector('label[for="resolutionPicker"]');
    const orientationLabel = document.querySelector('label[for="orientationPicker"]');

    // Hide monitor-only controls for equipment items.
    if (resolutionPickerControl) resolutionPickerControl.hidden = isEquipment;
    if (orientationPickerControl) orientationPickerControl.hidden = isEquipment;
    if (resolutionLabel) resolutionLabel.hidden = isEquipment;
    if (orientationLabel) orientationLabel.hidden = isEquipment;
    if (pipRow) pipRow.hidden = isDesktopMonitor || isEquipment;
    if (windowedAppsBtn) {
      windowedAppsBtn.hidden = isDesktopMonitor || isEquipment;
      windowedAppsBtn.classList.remove('active');
    }
    if (addLabelBtn) {
      addLabelBtn.hidden = false;
      addLabelBtn.textContent = isEquipment ? 'Edit Label' : 'Add Label';
    }
    if (removeBtn) {
      if (isEquipment) {
        removeBtn.textContent = 'Remove Equipment';
      } else {
        removeBtn.textContent = isDesktopMonitor ? 'Remove Desktop Monitor' : 'Remove Monitor';
      }
    }

    if (isEquipment) {
      if (testMediaRow) testMediaRow.hidden = true;
      if (autoScaleRow) autoScaleRow.hidden = true;
      if (statusEl) statusEl.hidden = true;

      const equipmentData = _getEquipmentCurrent();
      if (!equipmentData) return null;
      const { item, equipment } = equipmentData;

      el('popoverTitle').textContent = equipment.modelName;

      return { item, equipment, isEquipment: true };
    }

    if (isDesktopMonitor) {
      const desktopData = _getDesktopMonitorCurrent();
      if (!desktopData) return null;
      const { item, monitor } = desktopData;
      const testMediaEnabled = typeof TEST_MEDIA !== 'undefined' && TEST_MEDIA.isEnabled && TEST_MEDIA.isEnabled();

      el('popoverTitle').textContent = `${monitor.size}" ${monitor.brand} — ${monitor.modelName}`;

      const resPicker = el('resolutionPicker');
      if (resPicker) {
        resPicker.innerHTML = '';
        monitor.resolutions.forEach((res, i) => {
          const opt = document.createElement('option');
          opt.value = i;
          opt.textContent = _formatResolution(res, item.orientation || 'landscape');

          const matchesLabel = item.selectedResolution && res.label && item.selectedResolution.label
            ? res.label === item.selectedResolution.label
            : false;
          const matchesDims = item.selectedResolution &&
            res.width === item.selectedResolution.width &&
            res.height === item.selectedResolution.height &&
            res.refresh === item.selectedResolution.refresh;
          if (matchesLabel || matchesDims) {
            opt.selected = true;
          }
          resPicker.appendChild(opt);
        });
      }

      const orientationPicker = el('orientationPicker');
      if (orientationPicker) orientationPicker.value = item.orientation || 'landscape';

      const clearMonitorBtn = el('clearMonitorMediaBtn');
      const clearZoneBtn = el('clearZoneMediaBtn');
      if (testMediaRow) testMediaRow.hidden = !testMediaEnabled;
      if (statusEl) statusEl.hidden = !testMediaEnabled;
      if (clearZoneBtn) clearZoneBtn.disabled = true;

      if (testMediaEnabled && statusEl) {
        const monitorAssetId = item.monitorTestMediaRef && item.monitorTestMediaRef.assetId
          ? item.monitorTestMediaRef.assetId
          : null;
        const monitorAsset = monitorAssetId && TEST_MEDIA.getById ? TEST_MEDIA.getById(monitorAssetId) : null;
        statusEl.textContent = `Monitor: ${monitorAsset ? monitorAsset.name : (monitorAssetId ? 'Missing asset' : 'No test media')}`;

        if (autoScaleRow) {
          const hasMonitorAsset = !!monitorAssetId;
          autoScaleRow.hidden = !hasMonitorAsset;
          if (hasMonitorAsset) {
            const mode = item.monitorTestMediaScalingMode || 'center';
            el('testMediaScaleCenter').classList.toggle('active', mode === 'center');
            el('testMediaScaleAspect').classList.toggle('active', mode === 'aspect');
            el('testMediaScaleFull').classList.toggle('active', mode === 'full');
          }
        }
      } else if (autoScaleRow) {
        autoScaleRow.hidden = true;
      }

      if (clearMonitorBtn) {
        clearMonitorBtn.disabled = !testMediaEnabled || !(item.monitorTestMediaRef && item.monitorTestMediaRef.assetId);
      }

      return { item, monitor, isDesktopMonitor: true };
    }

    const cell = STATE.getCell(_current.setupIndex, _current.row, _current.col);
    const monitor = cell ? CATALOG.find(m => m.id === cell.monitorId) : null;
    if (!monitor) return null;

    if (windowedAppsBtn) {
      const canWindowedApps = Number(monitor.size) >= 32;
      windowedAppsBtn.hidden = !canWindowedApps;
      windowedAppsBtn.classList.toggle('active', !!(canWindowedApps && cell.windowedAppsEnabled));
    }

    el('popoverTitle').textContent = `${monitor.size}" ${monitor.brand} — ${monitor.modelName}`;

    const resPicker = el('resolutionPicker');
    if (resPicker) {
      resPicker.innerHTML = '';
      monitor.resolutions.forEach((res, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = _formatResolution(res, cell.orientation || 'landscape');
        if (cell.selectedResolution && res.label === cell.selectedResolution.label) {
          opt.selected = true;
        }
        resPicker.appendChild(opt);
      });
    }

    const orientationPicker = el('orientationPicker');
    if (orientationPicker) orientationPicker.value = cell.orientation || 'landscape';

    if (selector) {
      const currentCount = cell.pipZones ? cell.pipZones.length : 0;
      const canPip = monitor.pipSupported;
      selector.querySelectorAll('.btn-pip-zone').forEach(btn => {
        const count = parseInt(btn.dataset.count, 10);
        btn.disabled = !canPip && count !== 0;
        btn.classList.toggle('active', count === currentCount);
      });
    }

    const clearMonitorBtn = el('clearMonitorMediaBtn');
    const clearZoneBtn = el('clearZoneMediaBtn');
    const testMediaEnabled = typeof TEST_MEDIA !== 'undefined' && TEST_MEDIA.isEnabled && TEST_MEDIA.isEnabled();
    const selectedZone = STATE.getSelectedZone ? STATE.getSelectedZone() : null;
    const zoneMatch = selectedZone &&
      selectedZone.setupIndex === _current.setupIndex &&
      selectedZone.row === _current.row &&
      selectedZone.col === _current.col;
    const zone = zoneMatch
      ? (cell.pipZones || []).find(z => z.id === selectedZone.zoneId)
      : null;

    if (testMediaRow) {
      testMediaRow.hidden = !testMediaEnabled;
    }
    if (autoScaleRow) {
      autoScaleRow.hidden = !testMediaEnabled;
    }
    if (statusEl) {
      statusEl.hidden = !testMediaEnabled;
    }

    if (testMediaEnabled && statusEl) {
      const monitorAssetId = cell.monitorTestMediaRef && cell.monitorTestMediaRef.assetId
        ? cell.monitorTestMediaRef.assetId
        : null;
      const monitorAsset = monitorAssetId && TEST_MEDIA.getById ? TEST_MEDIA.getById(monitorAssetId) : null;
      const zoneAssetId = zone && zone.testMediaRef && zone.testMediaRef.assetId
        ? zone.testMediaRef.assetId
        : null;
      const zoneAsset = zoneAssetId && TEST_MEDIA.getById ? TEST_MEDIA.getById(zoneAssetId) : null;

      if (zone) {
        const zoneLabel = `Zone ${Math.max(1, (cell.pipZones || []).findIndex(z => z.id === zone.id) + 1)}`;
        statusEl.textContent = `${zoneLabel}: ${zoneAsset ? zoneAsset.name : (zoneAssetId ? 'Missing asset' : 'No test media')}`;
      } else {
        statusEl.textContent = `Monitor: ${monitorAsset ? monitorAsset.name : (monitorAssetId ? 'Missing asset' : 'No test media')}`;
      }

      if (autoScaleRow) {
        const hasMonitorAsset = !!monitorAssetId;
        autoScaleRow.hidden = !hasMonitorAsset;
        if (hasMonitorAsset) {
          const mode = cell.monitorTestMediaScalingMode || 'center';
          el('testMediaScaleCenter').classList.toggle('active', mode === 'center');
          el('testMediaScaleAspect').classList.toggle('active', mode === 'aspect');
          el('testMediaScaleFull').classList.toggle('active', mode === 'full');
        }
      }
    }

    if (clearMonitorBtn) {
      clearMonitorBtn.disabled = !testMediaEnabled || !(cell.monitorTestMediaRef && cell.monitorTestMediaRef.assetId);
    }
    if (clearZoneBtn) {
      clearZoneBtn.disabled = !testMediaEnabled || !(zone && zone.testMediaRef && zone.testMediaRef.assetId);
    }

    if (!testMediaEnabled && autoScaleRow) {
      autoScaleRow.hidden = true;
    }

    return { cell, monitor };
  }

  function show(setupIndex, row, col, monitorGroupEl, rect) {
    _current = { type: 'grid', setupIndex, row, col };
    const data = _syncPopoverFields();
    if (!data) return;

    // Position popover near the clicked monitor
    const svg = CANVAS.getSvg(setupIndex);
    const svgR = svg ? svg.getBoundingClientRect() : { left: 0, top: 0 };
    const scale = svg ? (svg.clientWidth / (svg.viewBox.baseVal.width || svg.clientWidth)) : 1;

    let px = svgR.left + rect.x * scale + rect.w * scale + 8;
    let py = svgR.top  + rect.y * scale;

    // Clamp to viewport
    const pop = popEl();
    pop.removeAttribute('hidden');
    pop.style.left = px + 'px';
    pop.style.top  = py + 'px';

    // After render, shift left if overflow
    requestAnimationFrame(() => {
      const pr = pop.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) {
        pop.style.left = (px - rect.w * scale - pr.width - 16) + 'px';
      }
      if (pr.bottom > window.innerHeight - 8) {
        pop.style.top = (window.innerHeight - pr.height - 8) + 'px';
      }
    });
  }

  function showDesktopMonitor(setupIndex, itemId, anchorClientRect) {
    _current = { type: 'desktop-monitor', setupIndex, itemId };
    const data = _syncPopoverFields();
    if (!data) return;

    const pop = popEl();
    const rect = anchorClientRect || { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, right: window.innerWidth / 2 };
    const width = Number.isFinite(rect.width) ? rect.width : 0;
    let px = (Number.isFinite(rect.right) ? rect.right : (rect.left || 0)) + 8;
    let py = Number.isFinite(rect.top) ? rect.top : 0;

    pop.removeAttribute('hidden');
    pop.style.left = px + 'px';
    pop.style.top = py + 'px';

    requestAnimationFrame(() => {
      const pr = pop.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) {
        pop.style.left = (px - width - pr.width - 16) + 'px';
      }
      if (pr.bottom > window.innerHeight - 8) {
        pop.style.top = (window.innerHeight - pr.height - 8) + 'px';
      }
    });
  }

  function hide() {
    popEl().setAttribute('hidden', '');
    _current = null;
    STATE.setSelected(null, null, null);
  }

  function getCurrent() { return _current; }

  function init() {
    el('popoverClose').addEventListener('click', hide);

    el('resolutionPicker').addEventListener('change', e => {
      if (!_current) return;
      if (_isDesktopMonitorCurrent()) {
        const desktopData = _getDesktopMonitorCurrent();
        if (!desktopData) return;
        const idx = parseInt(e.target.value, 10);
        STATE.setDesktopMonitorResolution(_current.setupIndex, _current.itemId, desktopData.monitor.resolutions[idx]);
        _syncPopoverFields();
        return;
      }
      const cell = STATE.getCell(_current.setupIndex, _current.row, _current.col);
      if (!cell) return;
      const monitor = CATALOG.find(m => m.id === cell.monitorId);
      if (!monitor) return;
      const idx = parseInt(e.target.value, 10);
      STATE.setResolution(_current.setupIndex, _current.row, _current.col, monitor.resolutions[idx]);
    });

    el('orientationPicker').addEventListener('change', e => {
      if (!_current) return;
      if (_isDesktopMonitorCurrent()) {
        STATE.setDesktopMonitorOrientation(_current.setupIndex, _current.itemId, e.target.value);
        _syncPopoverFields();
        return;
      }
      STATE.setOrientation(_current.setupIndex, _current.row, _current.col, e.target.value);
      CANVAS.openCellPopover(_current.setupIndex, _current.row, _current.col);
    });

    // PiP zone selector buttons
    const selector = el('pipZoneSelector');
    if (selector) {
      selector.addEventListener('click', e => {
        const btn = e.target.closest('.btn-pip-zone');
        if (!btn || !_current) return;
        if (_isDesktopMonitorCurrent()) return;
        const count = parseInt(btn.dataset.count, 10);
        STATE.setPipZones(_current.setupIndex, _current.row, _current.col, count);
        // Update active state immediately
        selector.querySelectorAll('.btn-pip-zone').forEach(b => {
          b.classList.toggle('active', parseInt(b.dataset.count, 10) === count);
        });
      });
    }

    el('addLabelBtn').addEventListener('click', () => {
      if (!_current) return;
      if (_isEquipmentCurrent()) {
        // For equipment, show label editor
        const equipmentData = _getEquipmentCurrent();
        if (!equipmentData) return;
        const labelText = prompt('Enter label for this equipment (max 30 characters):', equipmentData.item.label || '');
        if (labelText !== null) {
          STATE.setEquipmentLabel(_current.setupIndex, _current.itemId, labelText);
          _syncPopoverFields();
        }
      } else if (_isDesktopMonitorCurrent()) {
        const current = { ..._current };
        hide();
        if (LABELS.addDesktopMonitorLabel) {
          LABELS.addDesktopMonitorLabel(current.setupIndex, current.itemId);
        }
      } else {
        const current = { ..._current };
        hide();
        LABELS.addLabel(current.setupIndex, current.row, current.col);
      }
    });

    el('removeMonitorBtn').addEventListener('click', () => {
      if (!_current) return;
      if (_isEquipmentCurrent()) {
        STATE.removeDesktopEquipment(_current.setupIndex, _current.itemId);
      } else if (_isDesktopMonitorCurrent()) {
        STATE.removeDesktopMonitor(_current.setupIndex, _current.itemId);
      } else {
        STATE.removeMonitor(_current.setupIndex, _current.row, _current.col);
      }
      hide();
    });

    el('windowedAppsBtn').addEventListener('click', () => {
      if (!_current || _isDesktopMonitorCurrent() || _isEquipmentCurrent()) return;
      const cell = STATE.getCell(_current.setupIndex, _current.row, _current.col);
      if (!cell) return;
      const monitor = CATALOG.find(m => m.id === cell.monitorId);
      if (!monitor || Number(monitor.size) < 32) return;
      if (STATE.toggleWindowedMode) {
        STATE.toggleWindowedMode(_current.setupIndex, _current.row, _current.col);
        _syncPopoverFields();
      }
    });

    const clearMonitorBtn = el('clearMonitorMediaBtn');
    if (clearMonitorBtn) {
      clearMonitorBtn.addEventListener('click', () => {
        if (!_current || !STATE.clearMonitorTestMedia) return;
        if (_isDesktopMonitorCurrent()) {
          if (STATE.clearDesktopMonitorTestMedia) {
            STATE.clearDesktopMonitorTestMedia(_current.setupIndex, _current.itemId);
          }
        } else {
          STATE.clearMonitorTestMedia(_current.setupIndex, _current.row, _current.col);
        }
        _syncPopoverFields();
      });
    }

    const clearZoneBtn = el('clearZoneMediaBtn');
    if (clearZoneBtn) {
      clearZoneBtn.addEventListener('click', () => {
        if (!_current || !STATE.clearZoneTestMedia || !STATE.getSelectedZone) return;
        if (_isDesktopMonitorCurrent()) return;
        const selectedZone = STATE.getSelectedZone();
        if (!selectedZone) return;
        if (selectedZone.setupIndex !== _current.setupIndex ||
            selectedZone.row !== _current.row ||
            selectedZone.col !== _current.col) {
          return;
        }
        STATE.clearZoneTestMedia(_current.setupIndex, _current.row, _current.col, selectedZone.zoneId);
        _syncPopoverFields();
      });
    }

    document.querySelectorAll('.btn-testmedia-scale').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!_current) return;
        if (_isDesktopMonitorCurrent()) {
          if (STATE.setDesktopMonitorTestMediaScalingMode) {
            STATE.setDesktopMonitorTestMediaScalingMode(
              _current.setupIndex,
              _current.itemId,
              btn.dataset.scalingMode
            );
          }
        } else {
          if (!STATE.setMonitorTestMediaScalingMode) return;
          STATE.setMonitorTestMediaScalingMode(
            _current.setupIndex,
            _current.row,
            _current.col,
            btn.dataset.scalingMode
          );
        }
        _syncPopoverFields();
      });
    });

    // Close when clicking outside popover
    document.addEventListener('click', e => {
      if (_current &&
          !e.target.closest('.popover') &&
          !e.target.closest('[data-role="monitor"]') &&
          !e.target.closest('[data-role="desktop-monitor"]') &&
          !e.target.closest('[data-role="desktop-equipment"]')) {
        hide();
      }
    });
  }

  function openEquipmentPopover(setupIndex, itemId, clientX, clientY) {
    _current = { type: 'equipment', setupIndex, itemId };
    const data = _syncPopoverFields();
    if (!data) return;

    const pop = popEl();
    let px = clientX + 12;
    let py = clientY + 12;

    pop.removeAttribute('hidden');
    pop.style.left = px + 'px';
    pop.style.top = py + 'px';

    requestAnimationFrame(() => {
      const pr = pop.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) {
        pop.style.left = (clientX - pr.width - 12) + 'px';
      }
      if (pr.bottom > window.innerHeight - 8) {
        pop.style.top = (window.innerHeight - pr.height - 8) + 'px';
      }
    });
  }

  return { init, show, showDesktopMonitor, openEquipmentPopover, hide, getCurrent };
})();

/* ================================================================
   UI — Catalog rendering, setup controls, info strip
   ================================================================ */
const UI = (() => {
  const setupVisible = [true, false];

  function _resolutionTierTag(width, height) {
    const longEdge = Math.max(width || 0, height || 0);
    const shortEdge = Math.min(width || 0, height || 0);

    if ((longEdge === 8192 && shortEdge === 4320) || (longEdge === 7680 && shortEdge === 4320)) {
      return ' (8K)';
    }
    if ((longEdge === 4096 && shortEdge === 2160) || (longEdge === 3840 && shortEdge === 2160)) {
      return ' (4K)';
    }
    if ((longEdge === 2560 && shortEdge === 1440) || (longEdge === 2048 && shortEdge === 1080)) {
      return ' (2K)';
    }
    return '';
  }

  function init() {
    _renderCatalog(null);
    _renderEquipmentCatalog();
    _bindSidebarToggle();
    _bindClearButtons();
    _bindTitleEdits();
    _bindDesktopControls();
    _bindFilterSelect();
    _bindZoomControls();
    _bindWheelZoom();
    _bindSetupVisibilityControls();
    _bindDropAreasToggle();
    _bindVideoPanel();
    _bindKeyboard();
    _bindAddMonitorBtn();
    _bindSaveLoadSetups();
    _bindCatalogIO();
    _bindTestMediaLibrary();
    _updateInfoStrip(0);
    _updateInfoStrip(1);
    _syncDesktopControls(0);
    _syncDesktopControls(1);
    _updateZoomReadout(0);
    _updateZoomReadout(1);
    _applySetupVisibility();
    _syncDropAreasToggle();

    document.addEventListener('state:changed', e => {
      _updateInfoStrip(e.detail.setupIndex);
      _syncDesktopControls(e.detail.setupIndex);
      _updateZoomReadout(e.detail.setupIndex);
      // Re-attach SVG drop targets after each re-render
      DRAG.attachSvgDropTargets();
    });
  }

  function _bindDropAreasToggle() {
    const btn = document.getElementById('toggleDropAreas');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = !CANVAS.isDropAreasVisible();
      CANVAS.setDropAreasVisible(next);
      DRAG.attachSvgDropTargets();
      _syncDropAreasToggle();
    });
  }

  function _syncDropAreasToggle() {
    const btn = document.getElementById('toggleDropAreas');
    if (!btn) return;
    const visible = CANVAS.isDropAreasVisible();
    btn.textContent = visible ? 'Hide Drop Areas' : 'Show Drop Areas';
    btn.classList.toggle('showing-hidden', !visible);
  }

  /* ---- Catalog ---- */

  function _renderCatalog(filterSize) {
    const list = document.getElementById('catalogList');
    if (!list) return;
    list.innerHTML = '';

    const monitors = (filterSize
      ? CATALOG.filter(m => m.size === filterSize)
      : catalogGetAll())
      .filter(m => m.category !== 'equipment');

    monitors.forEach(mon => {
      const card = document.createElement('div');
      card.className = 'catalog-card';
      card.setAttribute('role', 'listitem');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `${mon.size}" ${mon.brand} ${mon.modelName}`);
      card.dataset.monitorId = mon.id;

      // Icon
      const icon = document.createElement('div');
      icon.className = 'card-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = `${mon.size}"`;
      card.appendChild(icon);

      // Info
      const info = document.createElement('div');
      info.className = 'card-info';

      const model = document.createElement('div');
      model.className = 'card-model';
      model.textContent = mon.modelName;
      info.appendChild(model);

      const meta = document.createElement('div');
      meta.className = 'card-meta';
      const maxRes = mon.resolutions[0];
      meta.textContent = `${mon.panelType} · ${maxRes.width}×${maxRes.height}${_resolutionTierTag(maxRes.width, maxRes.height)}`;
      info.appendChild(meta);

      card.appendChild(info);

      // PiP badge
      if (mon.pipSupported) {
        const badge = document.createElement('span');
        badge.className = 'card-pip-badge';
        badge.textContent = 'PiP';
        badge.title = 'Picture-in-Picture supported';
        card.appendChild(badge);
      }

      // Custom badge + edit/delete buttons for non-built-in entries
      if (!mon.builtIn) {
        const customBadge = document.createElement('span');
        customBadge.className = 'card-custom-badge';
        customBadge.textContent = 'Custom';
        card.appendChild(customBadge);

        const editBtn = document.createElement('button');
        editBtn.className = 'btn-edit-custom';
        editBtn.title = 'Edit custom monitor';
        editBtn.setAttribute('aria-label', 'Edit custom monitor');
        editBtn.textContent = '✎';
        editBtn.addEventListener('click', e => {
          e.stopPropagation();
          _openMonitorForm(mon.id);
        });
        card.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-delete-custom';
        delBtn.title = 'Delete custom monitor';
        delBtn.setAttribute('aria-label', 'Delete custom monitor');
        delBtn.textContent = '×';
        delBtn.addEventListener('click', e => {
          e.stopPropagation();
          catalogRemoveCustom(mon.id);
          _renderCatalog(filterSize);
          DRAG.attachSvgDropTargets();
        });
        card.appendChild(delBtn);
      }

      DRAG.attachCatalogDrag(card, mon.id, 'monitor');

      // Keyboard: Enter/Space to place in first available cell
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _placeInFirstEmpty(mon.id);
        }
      });

      list.appendChild(card);
    });
  }

  function _renderEquipmentCatalog() {
    const list = document.getElementById('equipmentList');
    if (!list) return;
    list.innerHTML = '';

    const equipment = CATALOG.filter(item => item.category === 'equipment');
    equipment.forEach(item => {
      const card = document.createElement('div');
      card.className = 'catalog-card equipment-card';
      card.setAttribute('role', 'listitem');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `${item.brand} ${item.modelName}`);

      const icon = document.createElement('div');
      icon.className = 'card-icon equipment-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = item.type === 'mouse' ? 'Mouse' : 'Desk';
      card.appendChild(icon);

      const info = document.createElement('div');
      info.className = 'card-info';

      const model = document.createElement('div');
      model.className = 'card-model';
      model.textContent = item.modelName;
      info.appendChild(model);

      const meta = document.createElement('div');
      meta.className = 'card-meta';
      meta.textContent = `${item.physicalWidth_mm}×${item.physicalHeight_mm} mm`;
      info.appendChild(meta);

      card.appendChild(info);
      DRAG.attachCatalogDrag(card, item.id, 'equipment');
      list.appendChild(card);
    });
  }

  function _placeInFirstEmpty(monitorId) {
    for (let si = 0; si <= 1; si++) {
      for (let r = 0; r < GRID.MAX_ROWS; r++) {
        for (let c = 0; c < GRID.MAX_COLS; c++) {
          if (GRID.canPlace(si, r, c)) {
            STATE.placeMonitor(si, r, c, monitorId);
            CANVAS.openCellPopover(si, r, c);
            return;
          }
        }
      }
    }
    // All full — show toast
    _showToast('Grid full — maximum 2 rows × 4 columns reached.');
  }

  function _showToast(message) {
    const toast = document.getElementById('gridToast');
    if (!toast) return;
    toast.textContent = message;
    toast.removeAttribute('hidden');
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.setAttribute('hidden', ''), 320);
    }, 2500);
  }

  /* ---- Sidebar toggle ---- */

  function _bindSidebarToggle() {
    const btn = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    if (!btn || !sidebar) return;
    btn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      // Update video panel left offset
      const vp = document.getElementById('videoPanel');
      if (vp) {
        vp.style.left = sidebar.classList.contains('collapsed') ? '0' :
          getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width').trim();
      }
    });
  }

  /* ---- Clear buttons ---- */

  function _bindClearButtons() {
    document.getElementById('clearA').addEventListener('click', () => {
      if (confirm('Clear all monitors from Setup A?')) STATE.clearSetup(0);
    });
    document.getElementById('clearB').addEventListener('click', () => {
      if (confirm('Clear all monitors from Setup B?')) STATE.clearSetup(1);
    });
  }

  /* ---- Setup title edits ---- */

  function _bindTitleEdits() {
    ['titleA', 'titleB'].forEach((id, si) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('blur', () => STATE.renameSetup(si, el.textContent.trim() || `Setup ${si === 0 ? 'A' : 'B'}`));
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      });
    });
  }

  function _bindDesktopControls() {
    ['A', 'B'].forEach((suffix, setupIndex) => {
      const enabled = document.getElementById('desktopEnabled' + suffix);
      const width = document.getElementById('desktopWidth' + suffix);
      const height = document.getElementById('desktopHeight' + suffix);
      if (!enabled || !width || !height) return;

      enabled.addEventListener('change', () => {
        STATE.setDesktopConfig(setupIndex, { enabled: enabled.checked });
      });

      const onSizeChange = () => {
        STATE.setDesktopConfig(setupIndex, {
          width_mm: parseInt(width.value, 10),
          height_mm: parseInt(height.value, 10)
        });
      };

      width.addEventListener('change', onSizeChange);
      height.addEventListener('change', onSizeChange);
    });
  }

  function _syncDesktopControls(setupIndex) {
    const suffix = setupIndex === 0 ? 'A' : 'B';
    const enabled = document.getElementById('desktopEnabled' + suffix);
    const width = document.getElementById('desktopWidth' + suffix);
    const height = document.getElementById('desktopHeight' + suffix);
    const reservedDepth = document.getElementById('desktopReservedDepth' + suffix);
    if (!enabled || !width || !height) return;

    const config = STATE.getDesktopConfig(setupIndex);
    enabled.checked = !!config.enabled;
    width.value = String(config.width_mm);
    height.value = String(config.height_mm);
    if (reservedDepth) reservedDepth.value = String(config.reservedDepth_mm);
    width.disabled = !config.enabled;
    height.disabled = !config.enabled;
  }

  /* ---- Filter select ---- */

  function _bindFilterSelect() {
    const sel = document.getElementById('sizeFilter');
    if (!sel) return;
    sel.addEventListener('change', () => {
      const v = sel.value;
      _renderCatalog(v === 'all' ? null : parseInt(v, 10));
      DRAG.attachSvgDropTargets(); // cards re-created; re-attach
    });
  }

  /* ---- Manual zoom controls ---- */

  function _bindZoomControls() {
    _bindZoomForSetup(0, 'A');
    _bindZoomForSetup(1, 'B');
  }

  function _bindZoomForSetup(setupIndex, suffix) {
    const outBtn = document.getElementById('zoomOut' + suffix);
    const inBtn  = document.getElementById('zoomIn' + suffix);
    const fitBtn = document.getElementById('zoomFit' + suffix);
    if (!outBtn || !inBtn || !fitBtn) return;

    outBtn.addEventListener('click', () => {
      CANVAS.zoomOut(setupIndex);
      _updateZoomReadout(setupIndex);
      DRAG.attachSvgDropTargets();
    });

    inBtn.addEventListener('click', () => {
      CANVAS.zoomIn(setupIndex);
      _updateZoomReadout(setupIndex);
      DRAG.attachSvgDropTargets();
    });

    fitBtn.addEventListener('click', () => {
      CANVAS.resetManualZoom(setupIndex);
      _updateZoomReadout(setupIndex);
      DRAG.attachSvgDropTargets();
    });
  }

  function _updateZoomReadout(setupIndex) {
    const suffix = setupIndex === 0 ? 'A' : 'B';
    const el = document.getElementById('zoomValue' + suffix);
    if (!el) return;
    const z = CANVAS.getManualZoom(setupIndex);
    el.textContent = Math.round(z * 100) + '%';
  }

  function _bindWheelZoom() {
    _bindWheelForSetup(0, 'canvasWrapperA');
    _bindWheelForSetup(1, 'canvasWrapperB');
  }

  function _bindWheelForSetup(setupIndex, wrapperId) {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;

    wrapper.addEventListener('wheel', e => {
      // Keep regular scrolling behavior unless Ctrl/Cmd is held.
      if (!e.ctrlKey && !e.metaKey) return;

      e.preventDefault();

      const magnitude = Math.max(1, Math.min(4, Math.ceil(Math.abs(e.deltaY) / 120)));
      for (let i = 0; i < magnitude; i++) {
        if (e.deltaY < 0) {
          CANVAS.zoomIn(setupIndex);
        } else if (e.deltaY > 0) {
          CANVAS.zoomOut(setupIndex);
        }
      }

      _updateZoomReadout(setupIndex);
      DRAG.attachSvgDropTargets();
    }, { passive: false });
  }

  /* ---- Setup show/hide ---- */

  function _bindSetupVisibilityControls() {
    const toggleA = document.getElementById('toggleSetupA');
    const toggleB = document.getElementById('toggleSetupB');
    const hideA = document.getElementById('hideA');
    const hideB = document.getElementById('hideB');

    if (toggleA) toggleA.addEventListener('click', () => _toggleSetup(0));
    if (toggleB) toggleB.addEventListener('click', () => _toggleSetup(1));
    if (hideA) hideA.addEventListener('click', () => _toggleSetup(0));
    if (hideB) hideB.addEventListener('click', () => _toggleSetup(1));
  }

  function _toggleSetup(setupIndex) {
    const visibleCount = setupVisible.filter(Boolean).length;
    if (setupVisible[setupIndex] && visibleCount <= 1) {
      _showToast('At least one setup must stay visible.');
      return;
    }

    setupVisible[setupIndex] = !setupVisible[setupIndex];
    _applySetupVisibility();

    // Re-fit visible setups after layout changes.
    requestAnimationFrame(() => {
      if (setupVisible[0]) {
        CANVAS.render(0);
        LABELS.syncLabels(0);
      }
      if (setupVisible[1]) {
        CANVAS.render(1);
        LABELS.syncLabels(1);
      }
      DRAG.attachSvgDropTargets();
    });
  }

  function _applySetupVisibility() {
    const setupA = document.getElementById('setupA');
    const setupB = document.getElementById('setupB');
    const divider = document.querySelector('.setup-divider');
    const toggleA = document.getElementById('toggleSetupA');
    const toggleB = document.getElementById('toggleSetupB');

    setupA.classList.toggle('hidden-setup', !setupVisible[0]);
    setupB.classList.toggle('hidden-setup', !setupVisible[1]);
    if (divider) {
      divider.classList.toggle('hidden-divider', !(setupVisible[0] && setupVisible[1]));
    }

    if (toggleA) {
      toggleA.textContent = setupVisible[0] ? 'Hide A' : 'Show A';
      toggleA.classList.toggle('showing-hidden', !setupVisible[0]);
    }
    if (toggleB) {
      toggleB.textContent = setupVisible[1] ? 'Hide B' : 'Show B';
      toggleB.classList.toggle('showing-hidden', !setupVisible[1]);
    }
  }

  /* ---- Info strip ---- */

  function _updateInfoStrip(setupIndex) {
    const suffix = setupIndex === 0 ? 'A' : 'B';
    const wEl = document.getElementById('width'  + suffix);
    const hEl = document.getElementById('height' + suffix);
    if (!wEl || !hEl) return;

    const w = GRID.totalWidth_mm(setupIndex);
    const h = GRID.totalHeight_mm(setupIndex);

    wEl.textContent = w > 0 ? `Width: ${Math.round(w)}mm (${(w/10).toFixed(1)}cm)` : 'Width: —';
    hEl.textContent = h > 0 ? `Height: ${Math.round(h)}mm (${(h/10).toFixed(1)}cm)` : 'Height: —';
  }

  /* ---- Add custom monitor dialog ---- */

  function _bindAddMonitorBtn() {
    const btn = document.getElementById('addMonitorBtn');
    const dialog = document.getElementById('monitorFormDialog');
    if (!btn || !dialog) return;

    btn.addEventListener('click', () => _openMonitorForm());

    document.getElementById('monitorFormClose').addEventListener('click', () => { _editingMonitorId = null; dialog.close(); });
    document.getElementById('monitorFormCancel').addEventListener('click', () => { _editingMonitorId = null; dialog.close(); });

    // "Add Resolution" row
    document.getElementById('mfAddResBtn').addEventListener('click', () => _addResolutionRow());

    document.getElementById('monitorFormSave').addEventListener('click', () => {
      const errEl = document.getElementById('mfError');
      errEl.textContent = '';

      const brand  = document.getElementById('mfBrand').value.trim();
      const model  = document.getElementById('mfModel').value.trim();
      const size   = parseFloat(document.getElementById('mfSize').value);
      const wMm    = parseInt(document.getElementById('mfWidth').value, 10);
      const hMm    = parseInt(document.getElementById('mfHeight').value, 10);
      const panel  = document.getElementById('mfPanel').value;
      const pip    = document.getElementById('mfPip').checked;

      if (!brand || !model) { errEl.textContent = 'Brand and model name are required.'; return; }
      if (isNaN(size) || size < 10) { errEl.textContent = 'Enter a valid screen size.'; return; }
      if (isNaN(wMm) || wMm < 100) { errEl.textContent = 'Enter a valid physical width (mm).'; return; }
      if (isNaN(hMm) || hMm < 50)  { errEl.textContent = 'Enter a valid physical height (mm).'; return; }

      // Collect resolutions from dynamic rows
      const resRows = document.querySelectorAll('#mfResolutionList .mf-res-row');
      const resolutions = [];
      let resErr = false;
      resRows.forEach(row => {
        const w  = parseInt(row.querySelector('.mf-res-w').value, 10);
        const h  = parseInt(row.querySelector('.mf-res-h').value, 10);
        const hz = parseInt(row.querySelector('.mf-res-hz').value, 10) || 60;
        if (isNaN(w) || isNaN(h) || w < 1 || h < 1) { resErr = true; return; }
        resolutions.push({ label: `${w}\u00d7${h} (${hz}Hz)`, width: w, height: h, refresh: hz });
      });
      if (resErr) { errEl.textContent = 'Check resolution rows \u2014 width and height are required.'; return; }
      if (!resolutions.length) { errEl.textContent = 'Add at least one resolution.'; return; }

      // Derive aspect ratio from physical dimensions
      const gcd = (a, b) => b ? gcd(b, a % b) : a;
      const aspectW = Math.round(wMm);
      const aspectH = Math.round(hMm);
      const g = gcd(aspectW, aspectH);
      const aspectRatio = `${aspectW / g}:${aspectH / g}`;

      const spec = {
        size: Math.round(size * 10) / 10,
        brand,
        modelName: `${brand} ${model}`,
        panelType: panel,
        physicalWidth_mm: wMm,
        physicalHeight_mm: hMm,
        aspectRatio,
        pipSupported: pip,
        resolutions
      };

      const currentFilter = document.getElementById('sizeFilter');
      const filterVal = currentFilter ? currentFilter.value : 'all';

      if (_editingMonitorId) {
        // Edit mode — update in-place and normalise placed cells
        catalogUpdateCustom(_editingMonitorId, spec);
        // Normalise any placed cell whose current selectedResolution is no longer valid
        for (let si = 0; si <= 1; si++) {
          for (let r = 0; r < GRID.MAX_ROWS; r++) {
            for (let c = 0; c < GRID.MAX_COLS; c++) {
              const cell = STATE.getCell(si, r, c);
              if (!cell || cell.monitorId !== _editingMonitorId) continue;
              const still = spec.resolutions.find(res =>
                res.width === cell.selectedResolution.width &&
                res.height === cell.selectedResolution.height &&
                res.refresh === cell.selectedResolution.refresh
              );
              if (!still) {
                STATE.setResolution(si, r, c, spec.resolutions[0]);
              }
            }
          }
        }
        _editingMonitorId = null;
      } else {
        // Create mode
        catalogAddCustom(spec);
      }

      _renderCatalog(filterVal === 'all' ? null : parseInt(filterVal, 10));
      DRAG.attachSvgDropTargets();
      // Re-render both canvases so any placed instances reflect the changes
      CANVAS.render(0);
      CANVAS.render(1);
      dialog.close();
    });
  }

  // Edit-mode state — null means create mode
  let _editingMonitorId = null;

  function _openMonitorForm(editMonitorId) {
    const dialog = document.getElementById('monitorFormDialog');
    _editingMonitorId = editMonitorId || null;

    const isEdit = !!_editingMonitorId;
    const existing = isEdit ? catalogGetById(_editingMonitorId) : null;

    // Title and primary action label reflect the mode
    const titleEl = document.getElementById('mfFormTitle');
    const saveBtn = document.getElementById('monitorFormSave');
    if (titleEl) titleEl.textContent = isEdit ? 'Edit Monitor' : 'Add Monitor';
    if (saveBtn) saveBtn.textContent  = isEdit ? 'Update Monitor' : 'Save Monitor';

    // Prefill from existing or reset to blank
    document.getElementById('mfBrand').value  = existing ? existing.brand : '';
    // Model field holds only the part after the brand name
    document.getElementById('mfModel').value  = existing
      ? (existing.modelName.startsWith(existing.brand + ' ')
          ? existing.modelName.slice(existing.brand.length + 1)
          : existing.modelName)
      : '';
    document.getElementById('mfSize').value   = existing ? existing.size : '';
    document.getElementById('mfWidth').value  = existing ? existing.physicalWidth_mm  : '';
    document.getElementById('mfHeight').value = existing ? existing.physicalHeight_mm : '';
    document.getElementById('mfPanel').value  = existing ? existing.panelType : 'IPS';
    document.getElementById('mfPip').checked  = existing ? !!existing.pipSupported : false;
    document.getElementById('mfError').textContent = '';

    // Resolution rows — seed from existing or start with one blank
    const resList = document.getElementById('mfResolutionList');
    resList.innerHTML = '';
    if (existing && existing.resolutions && existing.resolutions.length) {
      existing.resolutions.forEach(r => _addResolutionRow(r.width, r.height, r.refresh));
    } else {
      _addResolutionRow();
    }

    dialog.showModal();
  }

  function _addResolutionRow(w, h, hz) {
    const list = document.getElementById('mfResolutionList');
    const row = document.createElement('div');
    row.className = 'mf-res-row';
    row.innerHTML = `
      <input class="mf-input mf-res-w" type="number" placeholder="1920" min="1" max="20000" value="${w || ''}" />
      <span class="mf-res-sep">\u00d7</span>
      <input class="mf-input mf-res-h" type="number" placeholder="1080" min="1" max="20000" value="${h || ''}" />
      <span class="mf-res-sep">@</span>
      <input class="mf-input mf-res-hz" type="number" placeholder="60" min="1" max="500" value="${hz || ''}" />
      <span class="mf-res-sep mf-res-hz-label">Hz</span>
      <button type="button" class="mf-res-remove" aria-label="Remove resolution">\u00d7</button>
    `;
    row.querySelector('.mf-res-remove').addEventListener('click', () => row.remove());
    list.appendChild(row);
  }

  /* ---- Video composition panel ---- */

  function _bindVideoPanel() {
    document.getElementById('testComposition').addEventListener('click', () => {
      const raw = document.getElementById('compositionInput').value.trim();
      const errEl = document.getElementById('videoError');
      errEl.setAttribute('hidden', '');
      STATE.clearStreams();

      if (!raw) return;

      let data;
      try {
        data = JSON.parse(raw);
      } catch (ex) {
        errEl.textContent = 'Invalid JSON: ' + ex.message;
        errEl.removeAttribute('hidden');
        return;
      }

      const streams = data.streams || data;
      if (!Array.isArray(streams)) {
        errEl.textContent = 'Expected a JSON object with a "streams" array.';
        errEl.removeAttribute('hidden');
        return;
      }

      streams.forEach(s => {
        try {
          const si = parseInt(s.setup, 10);
          const r  = parseInt(s.row,   10);
          const c  = parseInt(s.col,   10);
          if (!isNaN(si) && !isNaN(r) && !isNaN(c)) {
            STATE.setStream(si, r, c, String(s.id || 'stream'));
          }
        } catch (_) { /* skip invalid entries */ }
      });
    });

    document.getElementById('clearComposition').addEventListener('click', () => {
      document.getElementById('compositionInput').value = '';
      document.getElementById('videoError').setAttribute('hidden', '');
      STATE.clearStreams();
    });
  }

  /* ---- Keyboard shortcuts ---- */

  function _bindKeyboard() {
    document.addEventListener('keydown', e => {
      // Delete/Backspace on selected monitor
      if ((e.key === 'Delete' || e.key === 'Backspace') &&
          !e.target.matches('input, textarea, [contenteditable]')) {
        const sel = STATE.getSelected();
        if (sel) {
          STATE.removeMonitor(sel.setupIndex, sel.row, sel.col);
          POPOVER.hide();
        }
      }

      // Escape closes popover/tooltip
      if (e.key === 'Escape') {
        POPOVER.hide();
        const tt = document.getElementById('labelTooltip');
        if (tt) tt.setAttribute('hidden', '');
      }
    });
  }

  /* ---- Save / Load setups ---- */

  /**
   * Save a JSON-serialisable object to a file.
   * Uses the File System Access API (showSaveFilePicker) when available so the
   * user can choose the save location. Falls back to an anchor-download for
   * browsers that do not support the API (e.g. Firefox).
   */
  async function _saveJSON(suggestedName, obj) {
    const json = JSON.stringify(obj, null, 2);
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // user cancelled — do nothing
        // Any other error falls through to the anchor-download fallback
      }
    }
    // Fallback: trigger a browser download to the default Downloads folder
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(url);
  }

  function _bindSaveLoadSetups() {
    _bindSaveLoadForSetup(0, 'A');
    _bindSaveLoadForSetup(1, 'B');
  }

  function _bindSaveLoadForSetup(setupIndex, suffix) {
    const saveBtn  = document.getElementById('saveSetup' + suffix);
    const loadBtn  = document.getElementById('loadSetup' + suffix);
    const fileInput = document.getElementById('loadSetup' + suffix + 'Input');
    if (!saveBtn || !loadBtn || !fileInput) return;

    saveBtn.addEventListener('click', () => {
      const data = STATE.exportSetup(setupIndex);
      _saveJSON('screenplanner-setup-' + suffix.toLowerCase() + '.json', {
        version: 1,
        type: 'setup',
        data
      });
    });

    loadBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (!parsed || parsed.type !== 'setup' || !parsed.data) {
            _showToast('Invalid setup file.');
            return;
          }
          STATE.importSetup(setupIndex, parsed.data);
          // Sync the editable title element
          const titleEl = document.getElementById('title' + suffix);
          const setup = STATE.getSetup(setupIndex);
          if (titleEl && setup && setup.name) titleEl.textContent = setup.name;
          CANVAS.render(setupIndex);
          LABELS.syncLabels(setupIndex);
          DRAG.attachSvgDropTargets();
        } catch (_) {
          _showToast('Could not read setup file — invalid JSON.');
        }
        fileInput.value = '';
      };
      reader.readAsText(file);
    });
  }

  /* ---- Catalog export / import ---- */

  function _bindCatalogIO() {
    const exportBtn = document.getElementById('exportCatalogBtn');
    const importBtn = document.getElementById('importCatalogBtn');
    const fileInput = document.getElementById('importCatalogInput');
    if (!exportBtn || !importBtn || !fileInput) return;

    exportBtn.addEventListener('click', () => {
      _saveJSON('screenplanner-catalog.json', {
        version: 1,
        type: 'catalog',
        entries: catalogExport()
      });
    });

    importBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (!parsed || parsed.type !== 'catalog' || !Array.isArray(parsed.entries)) {
            _showToast('Invalid catalog file.');
            return;
          }
          const added = catalogImportCustom(parsed.entries);
          const currentFilter = document.getElementById('sizeFilter');
          const filterVal = currentFilter ? currentFilter.value : 'all';
          _renderCatalog(filterVal === 'all' ? null : parseInt(filterVal, 10));
          DRAG.attachSvgDropTargets();
          _showToast(added > 0 ? `Added ${added} monitor(s) to catalog.` : 'No new monitors to import.');
        } catch (_) {
          _showToast('Could not read catalog file — invalid JSON.');
        }
        fileInput.value = '';
      };
      reader.readAsText(file);
    });
  }

  /* ---- Test media library ---- */

  function _isTestMediaEnabled() {
    return typeof TEST_MEDIA !== 'undefined' && TEST_MEDIA.isEnabled && TEST_MEDIA.isEnabled();
  }

  function _bindTestMediaLibrary() {
    const section = document.getElementById('testMediaSection');
    if (!section) return;

    if (!_isTestMediaEnabled()) {
      section.setAttribute('hidden', '');
      return;
    }

    section.removeAttribute('hidden');
    _renderTestMediaLibrary();

    const uploadBtn = document.getElementById('uploadTestMediaBtn');
    const uploadInput = document.getElementById('uploadTestMediaInput');

    if (uploadBtn && uploadInput) {
      uploadBtn.addEventListener('click', () => uploadInput.click());
      uploadInput.addEventListener('change', async () => {
        const file = uploadInput.files && uploadInput.files[0];
        if (!file) return;
        const result = await TEST_MEDIA.addFromFile(file);
        if (!result.ok) {
          _showToast(result.error || 'Could not add test media.');
        } else {
          _showToast(result.warning || 'Test media added. Drag it onto a monitor or PiP zone.');
        }
        uploadInput.value = '';
      });
    }

    document.addEventListener('testmedia:library-changed', () => {
      _renderTestMediaLibrary();
      CANVAS.render(0);
      CANVAS.render(1);
      LABELS.syncLabels(0);
      LABELS.syncLabels(1);
    });
  }

  function _renderTestMediaLibrary() {
    const list = document.getElementById('testMediaList');
    if (!list || !_isTestMediaEnabled()) return;

    list.innerHTML = '';
    const assets = TEST_MEDIA.list();

    if (!assets.length) {
      const empty = document.createElement('div');
      empty.className = 'testmedia-empty';
      empty.textContent = 'No test media yet. Upload a PNG, JPG, or WebP image.';
      list.appendChild(empty);
      return;
    }

    assets.forEach(asset => {
      const card = document.createElement('div');
      card.className = 'testmedia-card';
      card.setAttribute('role', 'listitem');
      card.setAttribute('aria-label', asset.name || 'Test media');

      const img = document.createElement('img');
      img.className = 'testmedia-thumb';
      img.src = asset.dataUrl;
      img.alt = '';

      const name = document.createElement('span');
      name.className = 'testmedia-name';
      name.textContent = asset.name || asset.id;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-testmedia-remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove test media';
      removeBtn.setAttribute('aria-label', 'Remove test media');
      removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        TEST_MEDIA.remove(asset.id);
      });

      card.appendChild(img);
      card.appendChild(name);
      card.appendChild(removeBtn);

      DRAG.attachTestMediaDrag(card, asset.id);
      list.appendChild(card);
    });
  }

  // Bind reserved depth input to state update
  function _bindReservedDepthInput(setupIndex) {
    const inputId = setupIndex === 0 ? 'desktopReservedDepthA' : 'desktopReservedDepthB';
    const input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener('input', () => {
      const newDepth = parseInt(input.value, 10);
      if (Number.isFinite(newDepth)) {
        STATE.updateReservedDepth(setupIndex, newDepth);
      }
    });
  }

  // Call binding function for both setups
  _bindReservedDepthInput(0);
  _bindReservedDepthInput(1);

  return { init };
})();
