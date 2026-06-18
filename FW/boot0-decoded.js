/**
 * Companion boot patch — stored in Espruino Storage as .boot0
 *
 * Runs before FW.JS on the SD card and patches stock Pip-OS once Player/Pip exist.
 * Menu scripts (JS/*.JS) are deployed separately; stock FW.JS is left untouched.
 */
global.cmode = !1;

(function pipCompanionBoot0() {
  if (
    typeof Pip === 'undefined' ||
    typeof Player === 'undefined' ||
    typeof h === 'undefined' ||
    typeof Pip.createScroller !== 'function'
  ) {
    setTimeout(pipCompanionBoot0, 50);
    return;
  }
  if (Pip._companionBoot0) return;
  Pip._companionBoot0 = !0;

  // Make `cmode` an accessor so that ANY path which clears it repaints the open
  // menu. The stock firmware clears cmode itself on USB unplug (checkChargeStatus)
  // and the companion clears it over serial on disconnect — without this, a menu
  // like AMMO keeps its companion-only styling (dimmed rows / equip squares)
  // cached until the next tab switch, because nothing invalidates the scroller's
  // row cache. Repainting on the true→false transition fixes that everywhere.
  (function () {
    let _cmode = !!global.cmode;
    try {
      Object.defineProperty(global, 'cmode', {
        configurable: !0,
        get: function () {
          return _cmode;
        },
        set: function (v) {
          v = !!v;
          if (_cmode === v) return;
          _cmode = v;
          if (typeof Pip !== 'undefined' && Pip.CURRENT && Pip.emit) {
            Pip.emit('scroller', 'refreshEquip');
          }
        }
      });
    } catch (e) {}
  })();

  const _emit = Pip.emit;
  Pip.emit = function (event, a, b, c) {
    if (
      event === 'knob2' &&
      typeof cmode !== 'undefined' &&
      cmode &&
      Pip.CURRENT &&
      Pip.CURRENT.id === 'STATUS'
    ) {
      return;
    }
    return _emit.apply(this, arguments);
  };

  const _getinfo = Player.prototype.getinfo;
  Player.prototype.getinfo = function (refresh) {
    const p = _getinfo.call(this, refresh);
    if (typeof cmode !== 'undefined' && cmode) {
      const hp = this.getav('hp');
      if (void 0 !== hp) p.hp = E.clip(hp, 0, p.maxHP) / p.maxHP;
      // Carry weight is copied straight from the game (see sync-engine
      // _diffWeight). The game counts every carried item — including modded
      // items the Pip-Boy has no weight data for — so prefer it over the
      // locally summed inventory weight whenever the companion is connected.
      const wg = this.getav('wg');
      if (void 0 !== wg) p.wg = wg;
      const maxWg = this.getav('maxwg');
      if (void 0 !== maxWg) p.maxWg = maxWg;
    }
    return p;
  };

  Player.prototype.setav = function (av, v, persist, skipRefresh) {
    if ('string' != typeof av) throw new Error('av should be string');
    const key = av.toLowerCase();
    if (persist) {
      delete this.ephemeral[key];
      if (key === 'equippedapparel' && v && typeof v.length === 'number') {
        v = [v[0] || 0, v[1] || 0, v[2] || 0, v[3] || 0];
      }
      this.modified = this.player[key] !== v;
      this.player[key] = v;
    } else {
      this.ephemeral[key] = v;
    }
    if (
      persist &&
      !skipRefresh &&
      (key === 'equippedweap' || key === 'equippedapparel') &&
      Pip.refreshEquipState
    ) {
      Pip.refreshEquipState();
    }
  };

  Player.prototype.additemhealthpercent = function (id, cnt, cnd) {
    if (cnt <= 0) return;
    // A form ID belongs to exactly one category, so stop opening DataFiles as
    // soon as we find the match (saves up to 4 file opens per added item).
    const cats = ['AID', 'AMMO', 'APPAREL', 'MISC', 'WEAPONS'];
    for (let ci = 0; ci < cats.length; ci++) {
      const v = cats[ci];
      try {
        const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/${v}.DAT`),
          i = db.ids.indexOf(id);
        if ((db.close(), i < 0)) continue;
        const onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === v;
        const inv = onMenu
          ? Pip.inv
          : new InvFile(`INV/${NV ? 'NV' : 'F3'}/${v}.INV`, { idOrder: db.ids });
        const inx = inv.indexOf(id);
        if (inx >= 0) {
          let it = inv.get(inx);
          ((it.cnt += cnt), inv.set(inx, it));
        } else inv.add({ id: id, cnt: cnt, cnd: cnd });
        if (onMenu) Pip.emit('scroller', 'count', inv.count);
        else inv.sync();
        return !0;
      } catch (e) {}
    }
    return !1;
  };

  Pip.refreshEquipState = function () {
    if (!Pip.CURRENT) return;
    Pip.emit('scroller', 'refreshEquip');
  };

  // Dimmed list rows. A scroller item may set item.dim to be drawn
  // de-emphasised (e.g. ammo the equipped weapon can't use). The stock
  // scroller only caches txt/activ/rtxt, so we smuggle the flag through the row
  // text with a leading sentinel char and recolour that row at draw time. This
  // keeps the device's real scroller untouched (only its text colour changes).
  const DIM_SENTINEL = '\x01';
  const _createScroller = Pip.createScroller;
  // Patch returned scrollers so sync handlers can flush stale row caches.
  Pip.createScroller = function (options) {
    if (options && typeof options.getItem === 'function') {
      const _getItem = options.getItem;
      options.getItem = function (n) {
        const item = _getItem(n);
        if (
          item &&
          item.dim &&
          typeof item.txt === 'string' &&
          item.txt.charCodeAt(0) !== 1
        ) {
          item.txt = DIM_SENTINEL + item.txt;
        }
        return item;
      };
    }
    const scroller = _createScroller.call(this, options);
    let count = (options && options.itemCount) || 0;
    const _updateItemCount = scroller.updateItemCount;
    scroller.updateItemCount = function (c) {
      count = c;
      return _updateItemCount.call(this, c);
    };
    scroller.invalidateCache = function () {
      return _updateItemCount.call(this, count);
    };
    return scroller;
  };

  const _drawString = h.drawString;
  h.drawString = function (str, x, y, solid) {
    if (typeof str === 'string' && str.charCodeAt(0) === 1) {
      // Palette index 1 is a dim green; 3 is the normal bright text colour.
      const prev = this.getColor ? this.getColor() : 3;
      this.setColor(1);
      const r = _drawString.call(this, str.substr(1), x, y, solid);
      this.setColor(prev);
      return r;
    }
    return _drawString.apply(this, arguments);
  };

  // Clearing cmode is enough to repaint the open menu (see the accessor above).
  function companionClearCmodeOnUsbDisconnect() {
    if (typeof VUSB_PRESENT === 'undefined') return;
    setWatch(
      function () {
        cmode = !1;
      },
      VUSB_PRESENT,
      { edge: 'falling', repeat: !0, debounce: 100 }
    );
  }

  const _setWatches = Pip.setWatches;
  Pip.setWatches = function () {
    _setWatches.apply(this, arguments);
    companionClearCmodeOnUsbDisconnect();
  };

  const _checkChargeStatus = Pip.checkChargeStatus;
  Pip.checkChargeStatus = function (force) {
    if (typeof VUSB_PRESENT !== 'undefined' && !VUSB_PRESENT.read()) cmode = !1;
    return _checkChargeStatus.apply(this, arguments);
  };

  companionClearCmodeOnUsbDisconnect();

  // In companion mode (cmode), long-press ITEMS toggles the torch LED only — never
  // the full-screen TORCH overlay (torchMode Screen / LED+Screen). User-initiated
  // toggles (no explicit on/off arg) emit PIPSYNC:TORCH so the game flashlight
  // mirrors the device. Sync-driven setTorch(on) passes an explicit arg and does
  // not emit PIPSYNC (avoids game↔device feedback loops).
  if (typeof Pip.setTorch === 'function') {
    const _setTorch = Pip.setTorch;
    Pip.setTorch = function (on) {
      const explicit = void 0 !== on;
      const wasOn = !!Pip.torchOn;
      if (typeof cmode !== 'undefined' && cmode) {
        const nextOn = explicit ? !!on : !wasOn;
        if (Pip.CURRENT && Pip.CURRENT.id === 'TORCH') {
          if (Pip.CURRENT.turnOff) Pip.CURRENT.turnOff();
          else if (Pip.changeMenu) Pip.changeMenu();
        }
        Pip.torchOn = nextOn;
        Pip.audioStart(`SOUND/FX/LIGHT_${nextOn ? 'ON' : 'OFF'}.WAV`);
        Pip.fadeTo({ pin: LED_TORCH, target: nextOn ? 1 : 0 });
        Pip.drawIcons();
        if (!explicit && nextOn !== wasOn) {
          console.log('PIPSYNC:TORCH:' + (nextOn ? 'ON' : 'OFF'));
        }
        return;
      }
      return _setTorch.apply(this, arguments);
    };
  }
})();
