(function () {
  console.log('PIPSYNC:WMAP:OPEN');
  let e,
    t = !0,
    o = player.getav('locz') || 0,
    n = player.getav('map') || 'WMAP';
  const l = JSON.parse(fs.readFile(`MAP/${NV ? 'NV' : 'F3'}/MAPS.JSON`)),
    i = Object.keys(l),
    a = { x: 16, y: BR.y, w: 450, h: BR.h };
  // TTW: the Capital Wasteland and FO3 DLC maps are listed too, as "F3/<key>"
  // (read from MAP/F3 - see mapPath).
  if (NV && Pip.settings.ttw)
    try {
      Object.keys(JSON.parse(fs.readFile('MAP/F3/MAPS.JSON'))).forEach((k) => i.push('F3/' + k));
    } catch (e) {}
  // A saved key from a list this mode/TTW state doesn't have (e.g. TTW since
  // turned off) - fall back rather than open an undefined map.
  i.indexOf(n) < 0 && (n = 'WMAP');
  let c,
    r,
    s = i.indexOf(n),
    p = player.getav('locx') || 1024,
    d = player.getav('locy') || 1024;
  // Live player marker, driven by Pip.companionSetMapPos (boot0-decoded.js).
  // Stored in full-res (zoom 0) 0..2048 space; markerAtZoom() rescales it per zoom.
  // Each frame draws where the player was INTERP_DELAY_MS ago (in companion
  // time, from each update's `t` stamp), interpolated between the two
  // updates either side of that moment. Frames take a variable 110-160ms,
  // so this keeps on-screen speed proportional to real elapsed time rather
  // than to how updates happened to line up with frames. Must stay a bit
  // above the update spacing (~100-117ms) or the marker stalls waiting for
  // the next update; lower = less lag, higher = fewer stalls.
  const INTERP_DELAY_MS = 120;
  // A gap longer than this (e.g. starting to walk after standing still)
  // gets a synthetic "was still here" sample NOMINAL_INTERVAL_MS before the
  // new one, so the move plays out over one normal interval instead of
  // being smeared across the whole idle gap.
  const GAP_RESET_MS = 250, NOMINAL_INTERVAL_MS = 100;
  const MAX_SAMPLES = 8;
  // Device-vs-companion clock offset is the minimum observed (arrival - t),
  // since blocking renders only ever make updates arrive late. Relaxed
  // upward slowly so crystal drift between the two clocks can't build up.
  const OFFSET_RELAX_PER_MS = 0.001;
  // Camera always stays exactly centered on the marker - required, no
  // deadzone - so all motion is background panning, not arrow movement.
  const CAMERA_BLIT_ALIGN = 1;
  // Arrow shape (heading=0 = north/up), measured off a screenshot of the
  // real in-game arrow. ARROW_SCALE is the one knob for overall size.
  const ARROW_SCALE = 2.2;
  const ARROW_OUTER = [0, -7, 6, 5, 0, 3.5, -6, 5].map((v) => v * ARROW_SCALE);
  const ARROW_INNER = [0, -5, 4, 4, 0, 2.5, -4, 4].map((v) => v * ARROW_SCALE);
  // marker/markerHeading = what's currently drawn; samples = received
  // updates {x,y,h,t}, oldest first, trimmed as render time passes them.
  let marker, markerAnimTimer, markerHeading = 0;
  let samples = [], clockOffset = 0, lastOffsetUpdate = 0;
  // markerAtZoom/centerCameraOn write into these shared objects instead of
  // allocating every call - each result is read immediately by its caller.
  const MZ = { x: 0, y: 0 }, CAM = { x: 0, y: 0 }, ROTATED = new Array(8);
  function markerAtZoom() {
    if (!marker) return null;
    (MZ.x = marker.x / (1 << o)), (MZ.y = marker.y / (1 << o));
    return MZ;
  }
  // Floors the viewport to whole pixels so the arrow's sx/sy always matches
  // the background. Floors rather than rounds, so any residual drift is one-directional instead of flip-flopping.
  function centerCameraOn(mz) {
    const maxPX = (2048 >> o) - a.w,
      maxPY = (2048 >> o) - a.h;
    (CAM.x = Math.max(0, Math.min(CAMERA_BLIT_ALIGN * Math.floor((mz.x - a.w / 2) / CAMERA_BLIT_ALIGN), maxPX))),
      (CAM.y = Math.max(0, Math.min(CAMERA_BLIT_ALIGN * Math.floor((mz.y - a.h / 2) / CAMERA_BLIT_ALIGN), maxPY)));
    return CAM;
  }
  // Rotates a flat [x,y,...] poly by `heading` radians about the origin,
  // then offsets to (sx,sy), writing into the shared ROTATED array (read
  // immediately by fillPoly, so reuse across the two arrow layers is safe).
  // See sync-engine.js for the heading convention.
  function rotatePoly(points, heading, sx, sy) {
    const cosT = Math.cos(heading), sinT = Math.sin(heading);
    for (let i = 0; i < points.length; i += 2) {
      const lx = points[i], ly = points[i + 1];
      (ROTATED[i] = sx + lx * cosT - ly * sinT), (ROTATED[i + 1] = sy + lx * sinT + ly * cosT);
    }
    return ROTATED;
  }
  // Pip.blitOptions.noScanEffect measurably (if slightly) reduces per-flip
  // cost - confirmed by the user manually toggling it live via the IDE.
  // idleFilter is deliberately left untouched here: an earlier attempt that
  // also set idleFilter=[0] caused a visible brightness flash on every
  // update and had no measurable benefit of its own on top of
  // noScanEffect alone. Only written on an actual cmode change, not every
  // frame, and forced back off on screen close so it never leaks into
  // other screens' normal look.
  let scanEffectOn = false;
  function syncScanEffect() {
    const want = !!cmode;
    if (want !== scanEffectOn) {
      Pip.blitOptions.noScanEffect = want ? 1 : 0;
      scanEffectOn = want;
    }
  }
  //
  // blitFile snaps the source X to a 4px grid (one byte of 2bpp), but reads
  // source Y at exact row precision (both confirmed on-device via getPixel).
  // v() blits at the aligned X then h.scroll()s the remainder into place.
  const BLIT_SRC_ALIGN = 4;
  // Fast path for frames where the camera hasn't moved (e.g. turning on the
  // spot): rather than redrawing the whole map (~150ms), re-blit only the
  // patch under the old+new arrow into PATCH off-screen, then drawImage it
  // onto h at the exact pixel (~20ms + flip). Erasing via a fresh re-blit
  // (not by skipping the redraw) is what avoids the ghost-arrow trail an
  // earlier "skip redraw when the camera is still" attempt left behind.
  // Set false to always do full redraws.
  const FAST_ARROW_FRAMES = true;
  const PATCH_W = 56, // 48 + slack for the 4px-aligned blit start
    PATCH_H = 48,
    PATCH = Graphics.createArrayBuffer(PATCH_W, PATCH_H, 2, { msb: true }),
    // Explicit identity palette - without one, drawImage treats 2bpp as
    // greyscale and draws nothing onto h (confirmed on-device).
    PATCH_IMG = { width: PATCH_W, height: PATCH_H, bpp: 2, buffer: PATCH.buffer, palette: new Uint16Array([0, 1, 2, 3]) },
    // Force a full redraw after this many patch-only frames, so anything
    // else that drew over the map can't linger indefinitely.
    MAX_FAST_FRAMES = 30,
    ARROW_BOX_MARGIN = 2;
  // bgValid: the viewport holds exactly what a full redraw at (lastPX,lastPY)
  // produced, plus the arrow somewhere inside arrowX0..arrowY1.
  let bgValid = false, lastPX, lastPY, fastFrames = 0,
    arrowDrawn = false, arrowX0, arrowY0, arrowX1, arrowY1;
  function drawArrow(sx, sy) {
    h.setColor(0)
      .fillPoly(rotatePoly(ARROW_OUTER, markerHeading, sx, sy))
      .setColor(3)
      .fillPoly(rotatePoly(ARROW_INNER, markerHeading, sx, sy));
  }
  function v() {
    syncScanEffect();
    const srcW = 2048 >> o;
    // Keep the camera inside this map at this zoom. A saved locx/locy from a
    // larger zoom (or another map) otherwise puts alignedPX past srcW, giving
    // blitFile a zero/negative width ("Width too large") on open.
    (p = Math.max(0, Math.min(p, srcW - a.w))), (d = Math.max(0, Math.min(d, srcW - a.h)));
    const px = 0 | p,
      py = 0 | d,
      mz = markerAtZoom();
    let sx, sy, showArrow = false, bx0, by0, bx1, by1;
    if (mz) {
      (sx = a.x + (mz.x - p)), (sy = a.y + (mz.y - d));
      showArrow = sx >= a.x && sx < a.x + a.w && sy >= a.y && sy < a.y + a.h;
    }
    if (showArrow) {
      // Screen-space bounding box of the arrow (outer outline contains the inner).
      const pts = rotatePoly(ARROW_OUTER, markerHeading, sx, sy);
      (bx0 = bx1 = pts[0]), (by0 = by1 = pts[1]);
      for (let k = 2; k < pts.length; k += 2) {
        (bx0 = Math.min(bx0, pts[k])), (bx1 = Math.max(bx1, pts[k]));
        (by0 = Math.min(by0, pts[k + 1])), (by1 = Math.max(by1, pts[k + 1]));
      }
      (bx0 = Math.floor(bx0) - ARROW_BOX_MARGIN), (by0 = Math.floor(by0) - ARROW_BOX_MARGIN);
      (bx1 = Math.ceil(bx1) + ARROW_BOX_MARGIN), (by1 = Math.ceil(by1) + ARROW_BOX_MARGIN);
    }
    if (
      FAST_ARROW_FRAMES && !r && bgValid && px === lastPX && py === lastPY &&
      fastFrames < MAX_FAST_FRAMES && (arrowDrawn || showArrow)
    ) {
      // Region to restore = old arrow box + new arrow box, inside the viewport.
      let ux0 = arrowDrawn ? arrowX0 : bx0, uy0 = arrowDrawn ? arrowY0 : by0,
        ux1 = arrowDrawn ? arrowX1 : bx1, uy1 = arrowDrawn ? arrowY1 : by1;
      if (arrowDrawn && showArrow)
        (ux0 = Math.min(ux0, bx0)), (uy0 = Math.min(uy0, by0)), (ux1 = Math.max(ux1, bx1)), (uy1 = Math.max(uy1, by1));
      (ux0 = Math.max(ux0, a.x)), (uy0 = Math.max(uy0, a.y));
      (ux1 = Math.min(ux1, a.x + a.w - 1)), (uy1 = Math.min(uy1, a.y + a.h - 1));
      const srcX = BLIT_SRC_ALIGN * Math.floor((px + ux0 - a.x) / BLIT_SRC_ALIGN),
        dstX = a.x + srcX - px, // screen x of PATCH column 0 (0-3px left of ux0)
        hgt = uy1 - uy0 + 1;
      if (ux1 - dstX < PATCH_W && hgt <= PATCH_H) {
        Pip.blitFile(PATCH, e, {
          width: Math.min(PATCH_W, srcW - srcX),
          height: hgt,
          dstx: 0,
          dsty: 0,
          x: srcX,
          y: py + uy0 - a.y,
          srcWidth: srcW,
          srcHeight: srcW
        });
        h.setClipRect(ux0, uy0, ux1, uy1);
        h.drawImage(PATCH_IMG, dstX, uy0);
        h.setClipRect(a.x, a.y, a.x + a.w - 1, a.y + a.h - 1);
        showArrow && drawArrow(sx, sy);
        h.setClipRect(0, 0, 479, 319);
        (arrowDrawn = showArrow), (arrowX0 = bx0), (arrowY0 = by0), (arrowX1 = bx1), (arrowY1 = by1);
        fastFrames++;
        h.flip();
        return;
      }
    }
    const alignedPX = BLIT_SRC_ALIGN * Math.floor(px / BLIT_SRC_ALIGN),
      remX = px - alignedPX,
      // Overscan into the blank margin right of the viewport (nothing else
      // draws past a.x+a.w) so X can be scrolled into place with no compromise.
      // Only needed when there's actually a scroll to cover - skip the extra
      // BLIT_SRC_ALIGN columns on the (roughly 1-in-4) frames already aligned.
      overscanW = remX ? Math.min(a.w + BLIT_SRC_ALIGN, srcW - alignedPX) : Math.min(a.w, srcW - alignedPX);
    h.setClipRect(a.x, a.y, a.x + overscanW - 1, a.y + a.h - 1);
    Pip.blitFile(h, e, {
      width: overscanW,
      height: a.h,
      dstx: a.x,
      dsty: a.y,
      x: alignedPX,
      y: py,
      srcWidth: srcW,
      srcHeight: srcW
    });
    // h.scroll costs ~53ms regardless of distance/direction, so skip it
    // whenever X is already aligned.
    if (remX) h.scroll(-remX, 0);
    h.setClipRect(a.x, a.y, a.x + a.w - 1, a.y + a.h - 1);
    showArrow && drawArrow(sx, sy);
    h.setClipRect(0, 0, 479, 319);
    r && r.draw();
    // The menu overlay draws over the map, so the next frame after it must be full.
    (bgValid = !r), (lastPX = px), (lastPY = py), (fastFrames = 0);
    (arrowDrawn = showArrow), (arrowX0 = bx0), (arrowY0 = by0), (arrowX1 = bx1), (arrowY1 = by1);
    h.flip();
  }
  function u() {
    c ||
      (c = setTimeout(function () {
        ((c = void 0), v());
      }, 50));
  }
  function f(e) {
    // While connected, re-derive the viewport from the live marker instead
    // of the old center - avoids compounding drift from zoom-out clamping.
    if (cmode && marker) {
      (MZ.x = marker.x / (1 << e)), (MZ.y = marker.y / (1 << e));
      o = e; // centerCameraOn() reads the (new) zoom level via the closure over `o`
      const c = centerCameraOn(MZ);
      (p = c.x), (d = c.y);
    } else {
      const t = (p + a.w / 2) * (1 << o),
        n = (d + a.h / 2) * (1 << o);
      (o = e),
        (p = Math.max(0, Math.min(t / (1 << e) - a.w / 2, (2048 >> e) - a.w))),
        (d = Math.max(0, Math.min(n / (1 << e) - a.h / 2, (2048 >> e) - a.h)));
    }
    (player.setav('locx', p),
      player.setav('locy', d),
      player.setav('locz', e));
  }
  function m(t, l) {
    const i = 1 << o,
      // "F3/<key>" (TTW) reads from that folder instead of this mode's own.
      sl = t.indexOf('/'),
      dir = sl > 0 ? t.slice(0, sl) : NV ? 'NV' : 'F3',
      k = sl > 0 ? t.slice(sl + 1) : t;
    let a = `MAP/${dir}/${k}${i > 1 ? '_' + i : ''}${l ? '_ICON' : ''}.MAP`;
    (fs.statSync(a) ||
      (a = `MAP/${dir}/WMAP${l ? '_ICON' : ''}.MAP`),
      e && e.close(),
      (e = E.openFile(a, 'r')),
      (bgValid = !1), // new file/zoom/icons - the fast path's background is stale
      v(),
      (n = t),
      player.setav('map', t),
      Pip.renderHeader());
  }
  function g(e, l) {
    0 == e &&
      (l
        ? (Pip.playSound('SELECT'),
          (r = (function (e) {
            let t = e[''],
              o = Object.keys(e);
            (t && o.splice(o.indexOf(''), 1),
              t instanceof Object || (t = {}),
              void 0 === t.selected && (t.selected = 0),
              (t.rowHeight = 24));
            const n = {
              draw: function () {
                t.predraw && t.predraw(h);
                let l = 22,
                  i = 60;
                (h.clearRect(l, i, 142, i + 24 * o.length + 31),
                  h
                    .setFontAlign(-1, -1)
                    .setFont('Monofonto16')
                    .drawString(t.title, 31, i + 4)
                    .setColor(2)
                    .fillRect(l, i + 23, 142, i + 23)
                    .drawRect(l, i, 142, i + 24 * o.length + 31),
                  (i += 30));
                let a = 0 | Math.min((280 - i) / t.rowHeight, o.length),
                  c = E.clip(t.selected - (a >> 1), 0, o.length - a),
                  r = i;
                for (; a--;) {
                  const l = o[c],
                    i = e[l];
                  if (
                    (c == t.selected &&
                      !n.selectEdit &&
                      Pip.shadeBox(26, r - 2, 138, r + t.rowHeight - 3),
                    h
                      .setFont('Monofonto14')
                      .setColor(3)
                      .drawString(l, 31, r + 3),
                    'object' == typeof i)
                  ) {
                    let e = 134,
                      o = i.value;
                    (i.format && (o = i.format(o)),
                      'boolean' == typeof o && null == i.format
                        ? (h.drawRect(e - 12, r + 3, e, r + 15),
                          o && h.fillRect(e - 10, r + 5, e - 2, r + 13))
                        : (n.selectEdit &&
                            c == t.selected &&
                            ((e -= 9),
                            h
                              .setBgColor(3)
                              .clearRect(
                                e - (h.stringWidth(o) + 2),
                                r,
                                139,
                                r + t.rowHeight - 5
                              ),
                            h
                              .setColor(0)
                              .drawImage(
                                {
                                  width: 5,
                                  height: 8,
                                  buffer: '#\xBE\0}\xC4',
                                  transparent: 0
                                },
                                e + 2,
                                r + 2,
                                { scale: 2 }
                              )),
                          h
                            .setFontAlign(1, -1)
                            .drawString(o.toString(), e, r + 4)
                            .setBgColor(0)
                            .setFontAlign(-1, -1)));
                  }
                  ((r += t.rowHeight), c++);
                }
              },
              select: function () {
                const l = e[o[t.selected]];
                (Pip.playSound('SELECT'),
                  'function' == typeof l
                    ? l(n)
                    : 'object' == typeof l &&
                      ('number' == typeof l.value
                        ? (n.selectEdit = n.selectEdit ? void 0 : l)
                        : ('boolean' == typeof l.value && (l.value = !l.value),
                          l.onchange && l.onchange(l.value)),
                      n.draw()));
              },
              move: function (e) {
                if (n.selectEdit) {
                  const t = n.selectEdit,
                    o = t.value;
                  ((t.value -= (e || 1) * (t.step || 1)),
                    void 0 !== t.min &&
                      t.value < t.min &&
                      (t.value = t.wrap ? t.max : t.min),
                    void 0 !== t.max &&
                      t.value > t.max &&
                      (t.value = t.wrap ? t.min : t.max),
                    t.onchange &&
                      t.value != o &&
                      (t.onchange(t.value, -e), Pip.playSound('HIGHLIGHT')));
                } else {
                  const n = t.selected;
                  (t.wrapSelection
                    ? (t.selected = (e + n + o.length) % o.length)
                    : (t.selected = E.clip(n + e, 0, o.length - 1)),
                    n !== t.selected && Pip.playSound('SCROLL'));
                }
                n.draw();
              },
              remove: function () {
                (Pip.removeListener('knob1', l),
                  Pip.onExclusive('knob1', g),
                  (r = void 0),
                  v());
              }
            };
            function l(e, t) {
              e ? n.move(e) : t ? n.remove() : n.select();
            }
            return (
              n.draw(),
              Pip.removeListener('knob1', g),
              Pip.onExclusive('knob1', l),
              n
            );
          })({
            '': { title: 'Map Options', wrapSelection: !0 },
            'Show Icons': {
              value: t,
              onchange: (e) => {
                ((t = e), m(n, t));
              }
            },
            'Zoom Level': {
              value: o,
              min: 0,
              max: 2,
              step: 1,
              format: (e) => e + 1,
              onchange: (e) => {
                (f(e), m(n, t));
              }
            },
            'Map #': {
              value: s + 1,
              min: 1,
              max: i.length,
              step: 1,
              wrap: !0,
              onchange: (e) => {
                ((s = e - 1), m(i[s], t));
              }
            },
            Done: function (e) {
              e.remove();
            }
          })))
        : (Pip.playSound('HIGHLIGHT'), f((o + 1) % 3), void m(i[s], t)));
    // Manual panning is disabled while connected - the camera follows the
    // live marker instead (see stepMarkerAnim).
    if (cmode) return;
    const c = d;
    ((d += 16 * e),
      d < 0 && (d = 0),
      d > (2048 >> o) - a.h && (d = (2048 >> o) - a.h),
      c != d && u(),
      player.setav('locy', d));
  }
  function y(e) {
    if (cmode) return;
    const t = p;
    ((p += 16 * e),
      p < 0 && (p = 0),
      p > (2048 >> o) - a.w && (p = (2048 >> o) - a.w),
      t != p && u(),
      player.setav('locx', p));
  }
  // Draws the marker at render time (now - INTERP_DELAY_MS, companion clock)
  // and keeps rendering back-to-back while there's a newer sample to move
  // toward. Stops once render time passes the newest sample (holds there).
  function stepMarkerAnim() {
    markerAnimTimer = void 0;
    if (!samples.length) return;
    const renderT = getTime() * 1000 - clockOffset - INTERP_DELAY_MS,
      newestH = samples[samples.length - 1].h;
    while (samples.length > 1 && samples[1].t <= renderT) samples.shift();
    const s0 = samples[0], s1 = samples[1];
    if (renderT < s0.t && newestH === markerHeading) {
      // Not due yet - wait instead of redrawing an unchanged frame.
      markerAnimTimer = setTimeout(stepMarkerAnim, s0.t - renderT);
      return;
    }
    const to = s1 || s0,
      frac = s1 && renderT > s0.t ? (renderT - s0.t) / (s1.t - s0.t) : 0;
    marker = { x: s0.x + (to.x - s0.x) * frac, y: s0.y + (to.y - s0.y) * frac };
    // Heading skips the playback delay and always shows the newest value -
    // frames are slower than updates, so delaying it only added lag, not smoothness.
    markerHeading = newestH;
    if (cmode) {
      // Not persisted to player.setav here (hot path) - remove() does it once.
      const c = centerCameraOn(markerAtZoom());
      (p = c.x), (d = c.y);
    }
    v();
    // setTimeout 0 (not a direct loop) so queued serial updates get processed between frames.
    if (s1 || renderT < s0.t) markerAnimTimer = setTimeout(stepMarkerAnim, 0);
  }
  // Fed by Pip.companionSetMapPos via boot0-decoded.js's emit. Packed into
  // one object since Pip.emit caps out at 4 args.
  function onCompanionMapPos(pos) {
    const now = getTime() * 1000,
      mapKey = pos.mapKey,
      // Older companion builds send no timestamp - fall back to arrival time.
      sample = { x: pos.x, y: pos.y, h: pos.heading || 0, t: pos.t !== void 0 ? pos.t : now },
      last = samples[samples.length - 1],
      sampleOffset = now - sample.t;
    if (mapKey !== n || !last || !(sample.t > last.t)) {
      // New map, first update, or the companion's clock restarted: snap
      // straight to this position rather than interpolating from stale state.
      if (mapKey !== n && i.indexOf(mapKey) < 0) return; // Unknown map key.
      markerAnimTimer && clearTimeout(markerAnimTimer);
      markerAnimTimer = void 0;
      samples = [sample];
      clockOffset = sampleOffset;
      lastOffsetUpdate = now;
      marker = { x: sample.x, y: sample.y };
      markerHeading = sample.h;
      if (cmode) {
        const c = centerCameraOn(markerAtZoom());
        (p = c.x), (d = c.y);
      }
      if (mapKey !== n) {
        s = i.indexOf(mapKey);
        m(mapKey, t);
      } else v();
      return;
    }
    clockOffset = Math.min(clockOffset + (now - lastOffsetUpdate) * OFFSET_RELAX_PER_MS, sampleOffset);
    lastOffsetUpdate = now;
    if (sample.t - last.t > GAP_RESET_MS)
      samples.push({ x: last.x, y: last.y, h: last.h, t: sample.t - NOMINAL_INTERVAL_MS });
    samples.push(sample);
    if (samples.length > MAX_SAMPLES) samples.shift();
    markerAnimTimer || (markerAnimTimer = setTimeout(stepMarkerAnim, 0));
  }
  return (
    m(n, t),
    v(),
    Pip.onExclusive('knob1', g),
    Pip.onExclusive('knob2', y),
    Pip.on('companionMapPos', onCompanionMapPos),
    {
      id: 'WMAP',
      remove: () => {
        console.log('PIPSYNC:WMAP:CLOSE');
        if (scanEffectOn) {
          Pip.blitOptions.noScanEffect = 0;
          scanEffectOn = false;
        }
        (player.setav('locx', p),
          player.setav('locy', d),
          player.sync(),
          c && clearTimeout(c),
          markerAnimTimer && clearTimeout(markerAnimTimer),
          r && r.remove(),
          Pip.removeListener('knob1', g),
          Pip.removeListener('knob2', y),
          Pip.removeListener('companionMapPos', onCompanionMapPos),
          e && e.close());
      }
    }
  );
});
