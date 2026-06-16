/**
 * Companion boot patch — stored in Espruino Storage as .boot0
 *
 * Runs before FW.JS on the SD card and patches stock Pip-OS once Player/Pip exist.
 * Menu scripts (JS/*.JS) are deployed separately; stock FW.JS is left untouched.
 */
global.cmode = !1;

(function pipCompanionBoot0() {
  if (typeof Pip === 'undefined' || typeof Player === 'undefined') {
    setTimeout(pipCompanionBoot0, 50);
    return;
  }
  if (Pip._companionBoot0) return;
  Pip._companionBoot0 = !0;

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
    if ((typeof cmode !== 'undefined' && cmode) && void 0 !== this.getav('hp')) {
      p.hp = E.clip(this.getav('hp'), 0, p.maxHP) / p.maxHP;
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
    let success = !1;
    return (
      ['AID', 'AMMO', 'APPAREL', 'MISC', 'WEAPONS'].forEach((v) => {
        try {
          const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/${v}.DAT`),
            i = db.ids.indexOf(id);
          if ((db.close(), i < 0)) return;
          const inv =
              Pip.inv && Pip.CURRENT && Pip.CURRENT.id === v
                ? Pip.inv
                : new InvFile(`INV/${NV ? 'NV' : 'F3'}/${v}.INV`, {
                    idOrder: db.ids,
                  }),
            inx = inv.indexOf(id);
          if (inx >= 0) {
            let it = inv.get(inx);
            ((it.cnt += cnt), inv.set(inx, it));
          } else inv.add({ id: id, cnt: cnt, cnd: cnd });
          success = !0;
          const onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === v;
          if (!onMenu) inv.sync();
          if (onMenu) Pip.emit('scroller', 'count', inv.count);
        } catch (e) {}
      }),
      success
    );
  };

  Pip.refreshEquipState = function () {
    if (!Pip.CURRENT) return;
    Pip.emit('scroller', 'refreshEquip');
  };

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
})();
