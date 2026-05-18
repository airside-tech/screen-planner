/**
 * desktop-collision.js — Desktop equipment placement checks.
 *
 * All coordinates are in millimeters relative to desktop top-left.
 */

/* global CATALOG, STATE */

const DESKTOP_COLLISION = (() => {
  function _getEquipmentSpec(equipmentId) {
    return CATALOG.find(item => item.id === equipmentId && item.category === 'equipment') || null;
  }

  function _getDesktopBoundsMM(setupIndex) {
    const config = STATE.getDesktopConfig(setupIndex);
    if (!config || !config.enabled) return null;
    return {
      x: 0,
      y: 0,
      w: Math.max(0, config.width_mm || 0),
      h: Math.max(0, config.height_mm || 0)
    };
  }

  function _rectForPlacement(equipmentId, x_mm, y_mm) {
    const spec = _getEquipmentSpec(equipmentId);
    if (!spec) return null;
    return {
      x: x_mm,
      y: y_mm,
      w: spec.physicalWidth_mm,
      h: spec.physicalHeight_mm
    };
  }

  function _rectForInstance(instance) {
    return _rectForPlacement(instance.equipmentId, instance.x_mm, instance.y_mm);
  }

  function _getMonitorSpec(monitorId) {
    return CATALOG.find(item => item.id === monitorId && item.category !== 'equipment') || null;
  }

  function _rectForMonitorPlacement(monitorId, orientation, x_mm, y_mm) {
    const spec = _getMonitorSpec(monitorId);
    if (!spec) return null;
    const isPortrait = orientation === 'portrait';
    return {
      x: x_mm,
      y: y_mm,
      w: isPortrait ? spec.physicalHeight_mm : spec.physicalWidth_mm,
      h: isPortrait ? spec.physicalWidth_mm : spec.physicalHeight_mm
    };
  }

  function _rectForDesktopMonitorInstance(instance) {
    return _rectForMonitorPlacement(instance.monitorId, instance.orientation, instance.x_mm, instance.y_mm);
  }

  function _isInsideDesktopRect(setupIndex, rect) {
    const desktop = _getDesktopBoundsMM(setupIndex);
    if (!desktop || !rect) return false;

    return rect.x >= desktop.x &&
      rect.y >= desktop.y &&
      rect.x + rect.w <= desktop.x + desktop.w &&
      rect.y + rect.h <= desktop.y + desktop.h;
  }

  function rectIntersect(a, b) {
    if (!a || !b) return false;
    return a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y;
  }

  function isInsideDesktop(setupIndex, equipmentId, x_mm, y_mm) {
    const rect = _rectForPlacement(equipmentId, x_mm, y_mm);
    return _isInsideDesktopRect(setupIndex, rect);
  }

  function canPlaceEquipment(setupIndex, equipmentId, x_mm, y_mm, excludeItemId) {
    if (!isInsideDesktop(setupIndex, equipmentId, x_mm, y_mm)) return false;

    const nextRect = _rectForPlacement(equipmentId, x_mm, y_mm);
    if (!nextRect) return false;

    const all = STATE.getDesktopEquipment(setupIndex);
    for (let i = 0; i < all.length; i++) {
      const item = all[i];
      if (excludeItemId && item.id === excludeItemId) continue;
      const rect = _rectForInstance(item);
      if (!rect) continue;
      if (rectIntersect(nextRect, rect)) return false;
    }

    return true;
  }

  function canPlaceDesktopMonitor(setupIndex, monitorId, orientation, x_mm, y_mm, excludeMonitorItemId) {
    const nextRect = _rectForMonitorPlacement(monitorId, orientation, x_mm, y_mm);
    if (!_isInsideDesktopRect(setupIndex, nextRect)) return false;

    const equipment = STATE.getDesktopEquipment(setupIndex);
    for (let i = 0; i < equipment.length; i++) {
      const equipmentRect = _rectForInstance(equipment[i]);
      if (!equipmentRect) continue;
      if (rectIntersect(nextRect, equipmentRect)) return false;
    }

    const monitors = STATE.getDesktopMonitors(setupIndex);
    for (let i = 0; i < monitors.length; i++) {
      const item = monitors[i];
      if (excludeMonitorItemId && item.id === excludeMonitorItemId) continue;
      const monitorRect = _rectForDesktopMonitorInstance(item);
      if (!monitorRect) continue;
      if (rectIntersect(nextRect, monitorRect)) return false;
    }

    return true;
  }

  function findNearestFreePosition(setupIndex, equipmentId, targetX_mm, targetY_mm, excludeItemId) {
    if (canPlaceEquipment(setupIndex, equipmentId, targetX_mm, targetY_mm, excludeItemId)) {
      return { x_mm: targetX_mm, y_mm: targetY_mm };
    }

    const step = 2;  // Finer granularity for better placement
    const maxRadius = 3000;  // Larger search radius

    // Spiral outward from target position
    for (let radius = step; radius <= maxRadius; radius += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        const dy = radius - Math.abs(dx);
        const candidates = dy === 0
          ? [{ x_mm: targetX_mm + dx, y_mm: targetY_mm }]
          : [
            { x_mm: targetX_mm + dx, y_mm: targetY_mm + dy },
            { x_mm: targetX_mm + dx, y_mm: targetY_mm - dy }
          ];

        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          if (canPlaceEquipment(setupIndex, equipmentId, candidate.x_mm, candidate.y_mm, excludeItemId)) {
            return candidate;
          }
        }
      }
    }

    // Fallback: try grid-based search across the desktop if spiral fails
    const desktop = _getDesktopBoundsMM(setupIndex);
    if (desktop) {
      const spec = _getEquipmentSpec(equipmentId);
      if (spec) {
        const padding = 10;
        const gridStep = 50;
        for (let x = padding; x + spec.physicalWidth_mm <= desktop.w - padding; x += gridStep) {
          for (let y = padding; y + spec.physicalHeight_mm <= desktop.h - padding; y += gridStep) {
            if (canPlaceEquipment(setupIndex, equipmentId, x, y, excludeItemId)) {
              return { x_mm: x, y_mm: y };
            }
          }
        }
      }
    }

    return null;
  }

  function findNearestFreeMonitorPosition(setupIndex, monitorId, orientation, targetX_mm, targetY_mm, excludeMonitorItemId) {
    if (canPlaceDesktopMonitor(setupIndex, monitorId, orientation, targetX_mm, targetY_mm, excludeMonitorItemId)) {
      return { x_mm: targetX_mm, y_mm: targetY_mm };
    }

    const step = 5;
    const maxRadius = 2000;

    for (let radius = step; radius <= maxRadius; radius += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        const dy = radius - Math.abs(dx);
        const candidates = dy === 0
          ? [{ x_mm: targetX_mm + dx, y_mm: targetY_mm }]
          : [
            { x_mm: targetX_mm + dx, y_mm: targetY_mm + dy },
            { x_mm: targetX_mm + dx, y_mm: targetY_mm - dy }
          ];

        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          if (canPlaceDesktopMonitor(setupIndex, monitorId, orientation, candidate.x_mm, candidate.y_mm, excludeMonitorItemId)) {
            return candidate;
          }
        }
      }
    }

    return null;
  }

  function getEquipmentAt(setupIndex, x_mm, y_mm) {
    const equipment = STATE.getDesktopEquipment(setupIndex);
    for (let i = 0; i < equipment.length; i++) {
      const item = equipment[i];
      const rect = _rectForInstance(item);
      if (rect && x_mm >= rect.x && x_mm < rect.x + rect.w &&
          y_mm >= rect.y && y_mm < rect.y + rect.h) {
        return item;
      }
    }
    return null;
  }

  return {
    rectIntersect,
    isInsideDesktop,
    canPlaceEquipment,
    canPlaceDesktopMonitor,
    findNearestFreePosition,
    findNearestFreeMonitorPosition,
    getEquipmentAt
  };
})();
