/**
 * pip.js — Multi-zone PiP (Picture-in-Picture / Screen Splitter) rendering.
 *
 * Replaces the old single-PiP model with a fixed-preset zone array.
 * Zones are laid out by calcZonePreset() and rendered as SVG <g> groups.
 * Each zone carries an add-label affordance (+) that fires a 'pip:addLabel' event.
 *
 * Public API:
 *   PIP.calcZonePreset(monRect, count, monitor, orientation) — returns PipZone[]
 *   PIP.renderZones(parentG, monRect, cell, monitor) — draws zone groups into parentG
 */

/* global STATE, CANVAS */

const PIP = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const BEZEL = 6;   // px inset from monitor body edge to screen area
  const STAND = 10;  // px height of monitor stand at bottom
  const GAP   = 4;   // px gap between adjacent zones
  const AFFORD = 14; // px size of the + add-label affordance button

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

  function _el(tag, attrs, cls) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (cls)   e.setAttribute('class', cls);
    return e;
  }

  function _txt(tag, attrs, cls, content) {
    const e = _el(tag, attrs, cls);
    if (content !== undefined) e.textContent = content;
    return e;
  }

  /**
   * Compute zone preset geometry inside a monitor cell rect.
   * Returns an array of { id, x, y, w, h, labels: [] } in SVG intrinsic coords.
   * @param {{ x, y, w, h }} monRect  — full cell rect from GRID.cellRect
   * @param {2|3|4} count
  * @param {'landscape'|'portrait'} orientation
  * @returns {Array}
   */
  function calcZonePreset(monRect, count, monitor, orientation) {
    // Screen area = monRect inset by BEZEL on all sides minus STAND at bottom
    const sx = monRect.x + BEZEL;
    const sy = monRect.y + BEZEL;
    const sw = monRect.w - BEZEL * 2;
    const sh = monRect.h - BEZEL * 2 - STAND;

    const half_w   = Math.floor((sw - GAP) / 2);
    const right_x  = sx + half_w + GAP;
    const half_h   = Math.floor((sh - GAP) / 2);
    const bottom_y = sy + half_h + GAP;

    const zones = [];
    const id = () => 'zone-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

    const portrait = orientation === 'portrait';

    if (count === 2) {
      if (portrait) {
        // Top | Bottom
        zones.push({ id: id(), x: sx, y: sy,       w: sw, h: half_h,          labels: [] });
        zones.push({ id: id(), x: sx, y: bottom_y, w: sw, h: sh - half_h - GAP, labels: [] });
      } else {
        // Left | Right
        zones.push({ id: id(), x: sx,      y: sy, w: half_w,            h: sh, labels: [] });
        zones.push({ id: id(), x: right_x, y: sy, w: sw - half_w - GAP, h: sh, labels: [] });
      }

    } else if (count === 3) {
      if (portrait) {
        // Top (full width) | Bottom-left / Bottom-right
        zones.push({ id: id(), x: sx,      y: sy,       w: sw,              h: half_h,          labels: [] });
        zones.push({ id: id(), x: sx,      y: bottom_y, w: half_w,          h: sh - half_h - GAP, labels: [] });
        zones.push({ id: id(), x: right_x, y: bottom_y, w: sw - half_w - GAP, h: sh - half_h - GAP, labels: [] });
      } else {
        // Left (full height) | Right-top / Right-bottom
        zones.push({ id: id(), x: sx,      y: sy,       w: half_w,            h: sh,              labels: [] });
        zones.push({ id: id(), x: right_x, y: sy,       w: sw - half_w - GAP, h: half_h,          labels: [] });
        zones.push({ id: id(), x: right_x, y: bottom_y, w: sw - half_w - GAP, h: sh - half_h - GAP, labels: [] });
      }

    } else if (count === 4) {
      // 2×2 grid
      zones.push({ id: id(), x: sx,      y: sy,       w: half_w,          h: half_h,              labels: [] });
      zones.push({ id: id(), x: right_x, y: sy,       w: sw - half_w - GAP, h: half_h,            labels: [] });
      zones.push({ id: id(), x: sx,      y: bottom_y, w: half_w,          h: sh - half_h - GAP,   labels: [] });
      zones.push({ id: id(), x: right_x, y: bottom_y, w: sw - half_w - GAP, h: sh - half_h - GAP, labels: [] });
    }

    return zones;
  }

  /**
   * Render all PiP zones into parentG.
   * Reads cell.pipZones (array set by STATE.setPipZones).
   */
  function renderZones(parentG, monRect, cell, monitor) {
    if (!cell.pipZones || !cell.pipZones.length) return;

    const sourceW = cell.selectedResolution
      ? (cell.orientation === 'portrait' ? cell.selectedResolution.height : cell.selectedResolution.width)
      : 0;
    const sourceH = cell.selectedResolution
      ? (cell.orientation === 'portrait' ? cell.selectedResolution.width : cell.selectedResolution.height)
      : 0;
    const screenW = Math.max(monRect.w - BEZEL * 2, 1);
    const screenH = Math.max(monRect.h - BEZEL * 2 - STAND, 1);

    // Find setupIndex/row/col from the parent monitor <g>
    const si  = parseInt(parentG.dataset.setup, 10);
    const row = parseInt(parentG.dataset.row, 10);
    const col = parseInt(parentG.dataset.col, 10);

    cell.pipZones.forEach((zone, idx) => {
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'pip-zone');
      g.setAttribute('data-zone-id', zone.id);
      g.setAttribute('data-role', 'pip-zone');
      g.setAttribute('data-setup', String(si));
      g.setAttribute('data-row', String(row));
      g.setAttribute('data-col', String(col));

      // Zone body (semi-transparent tinted rect)
      const body = _el('rect', {
        x: zone.x, y: zone.y,
        width: Math.max(zone.w, 4), height: Math.max(zone.h, 4),
        rx: 3
      }, 'pip-zone-body');
      body.style.pointerEvents = 'all';
      body.addEventListener('click', e => {
        e.stopPropagation();
        if (typeof CANVAS !== 'undefined' && CANVAS.openCellPopover) {
          CANVAS.openCellPopover(si, row, col, zone.id);
        }
      });
      g.appendChild(body);

      // Zone number — centered
      const cx = zone.x + zone.w / 2;
      const cy = zone.y + zone.h / 2;
      g.appendChild(_txt('text', {
        x: cx, y: cy,
        'dominant-baseline': 'middle',
        'text-anchor': 'middle'
      }, 'pip-zone-index', String(idx + 1)));

      if (sourceW > 0 && sourceH > 0 && zone.w >= 76 && zone.h >= 34) {
        const zoneMaxW = Math.max(1, Math.round(sourceW * (zone.w / screenW)));
        const zoneMaxH = Math.max(1, Math.round(sourceH * (zone.h / screenH)));
        const tier = _resolutionTierTag(zoneMaxW, zoneMaxH);
        g.appendChild(_txt('text', {
          x: cx,
          y: zone.y + zone.h - 10,
          'dominant-baseline': 'middle',
          'text-anchor': 'middle'
        }, 'pip-zone-maxres', `${zoneMaxW}×${zoneMaxH}${tier}`));
      }

      // Add-label affordance (+) in top-right corner
      if (zone.w >= AFFORD + 8 && zone.h >= AFFORD + 8) {
        const bx = zone.x + zone.w - AFFORD - 4;
        const by = zone.y + 4;

        const aff = document.createElementNS(SVG_NS, 'g');
        aff.setAttribute('class', 'pip-zone-add-label');
        aff.style.cursor = 'pointer';

        aff.appendChild(_el('rect', {
          x: bx, y: by,
          width: AFFORD, height: AFFORD,
          rx: 2
        }, 'pip-zone-add-label-bg'));

        aff.appendChild(_txt('text', {
          x: bx + AFFORD / 2, y: by + AFFORD / 2,
          'dominant-baseline': 'middle',
          'text-anchor': 'middle'
        }, 'pip-zone-add-label-text', '+'));

        aff.addEventListener('click', e => {
          e.stopPropagation();
          document.dispatchEvent(new CustomEvent('pip:addLabel', {
            detail: { setupIndex: si, row, col, zoneId: zone.id }
          }));
        });

        g.appendChild(aff);
      }

      parentG.appendChild(g);
    });
  }

  return { calcZonePreset, renderZones };
})();
