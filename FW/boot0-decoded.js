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
      const ap = this.getav('ap');
      if (void 0 !== ap) p.ap = ap;
      const maxAP = this.getav('maxap');
      if (void 0 !== maxAP) p.maxAP = maxAP;
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

  // Stock InvFile.add() clips every stack to 999; companion sync allows 9999 (stock ADDITEM UI).
  const INV_MAX_CNT = 9999;
  const CAPS_FORM_ID = 15;
  if (typeof InvFile !== 'undefined' && !InvFile._companionMaxCntPatched) {
    InvFile._companionMaxCntPatched = !0;
    InvFile.prototype.add = function (dat) {
      if (!('id' in dat)) throw new Error('Cannot add item without an ID');
      const newBuf = new ArrayBuffer(this.buf.byteLength + 8);
      E.mapInPlace(this.buf, newBuf);
      this.buf = newBuf;
      this.count++;
      this.set(this.count - 1, {
        id: dat.id,
        cnt: E.clip(dat.cnt, 1, INV_MAX_CNT),
        cnd: dat.cnd || 100,
        fl: dat.fl || 0,
      });
      this._requiresSort = !0;
    };
    const _invSet = InvFile.prototype.set;
    InvFile.prototype.set = function (i, dat) {
      if (dat && 'cnt' in dat) dat.cnt = E.clip(dat.cnt, 1, INV_MAX_CNT);
      return _invSet.call(this, i, dat);
    };
    // clearinv() rewrites the .INV files from scratch while an inventory menu may
    // still hold a now-stale InvFile in its closure. When that menu is later torn
    // down (changeMenu during full sync) its remove() calls inv.sync(), which
    // would write the stale pre-clear data back over the freshly synced items.
    // Flagging the orphaned instance and skipping its sync prevents that clobber.
    const _invSync = InvFile.prototype.sync;
    InvFile.prototype.sync = function () {
      if (this._invalidated) return;
      return _invSync.apply(this, arguments);
    };
  }

  // Items of the same form but different condition are distinct stacks, so adds
  // and removes must target the row matching BOTH form ID and condition instead
  // of the first form-ID match. Condition 0 is stored as 100 by InvFile.add
  // (cnd||100), so normalise both sides the same way when comparing.
  function findInvIdCnd(inv, id, cnd) {
    const want = cnd || 100;
    for (let i = 0; i < inv.count; i++) {
      const it = inv.get(i);
      if (it && it.id === id && (it.cnd || 100) === want) return i;
    }
    return -1;
  }

  Player.prototype.additemhealthpercent = function (id, cnt, cnd) {
    if (cnt <= 0) return;
    const wantCnd = cnd || 100;
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
        const inx = findInvIdCnd(inv, id, wantCnd);
        if (inx >= 0) {
          let it = inv.get(inx);
          ((it.cnt += cnt), inv.set(inx, it));
        } else inv.add({ id: id, cnt: cnt, cnd: wantCnd });
        if (onMenu) {
          Pip.emit('scroller', 'count', inv.count);
          if (v === 'MISC' && id === CAPS_FORM_ID && Pip.MODE === 1 && Pip.renderHeader)
            Pip.renderHeader();
        } else inv.sync();
        return !0;
      } catch (e) {}
    }
    return !1;
  };

  Player.prototype.removeitem = function (id, qty, cnd) {
    if (qty <= 0) return;
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
        const inx = cnd === undefined ? inv.indexOf(id) : findInvIdCnd(inv, id, cnd);
        if (inx >= 0) {
          let it = inv.get(inx);
          it.cnt -= qty;
          if (it.cnt > 0) inv.set(inx, it);
          else inv.remove(inx);
          if (onMenu) {
            Pip.emit('scroller', 'count', inv.count);
            if (v === 'MISC' && id === CAPS_FORM_ID && Pip.MODE === 1 && Pip.renderHeader)
              Pip.renderHeader();
          } else inv.sync();
          return !0;
        }
      } catch (e) {}
    }
    return !1;
  };

  Player.prototype.setitemcondition = function (id, cnd) {
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
          it.cnd = cnd;
          inv.set(inx, it);
          if (onMenu) {
            Pip.emit('scroller', 'refresh');
          } else inv.sync();
          return !0;
        }
      } catch (e) {}
    }
    return !1;
  };

  Player.prototype.safeaddperk = function (p) {
    try {
      const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/PERK.DAT`);
      if (db.ids.indexOf(p) >= 0) this.addperk(p);
      db.close();
    } catch (e) {}
  };

  Player.prototype.saferemoveperk = function (p) {
    try {
      const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/PERK.DAT`);
      if (db.ids.indexOf(p) >= 0) this.removeperk(p);
      db.close();
    } catch (e) {}
  };

  Player.prototype.refreshequip = function (v) {
    if (typeof Pip !== 'undefined' && Pip.CURRENT && (!v || Pip.CURRENT.id === v)) {
      if (Pip.refreshEquipState) Pip.refreshEquipState();
      else Pip.emit('scroller', 'refreshEquip');
    }
  };

  Player.prototype.syncskills = function (g) {
    try {
      var m = NV ? 'NV' : 'F3',
        db = new DataFile('DATA/' + m + '/SKILLS.DAT'),
        p = 'SETTINGS/' + m + '_SKILLS.JSON',
        u = loadJSONWithDefaults(p, 'SETTINGS/DEFAULT/' + m + '_SKILLS.JSON'),
        chg = !1,
        nm = function (s) {
          return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        },
        i, id, dat, k, lvl, dt;
      for (i = 0; i < db.ids.length; i++) {
        id = db.ids[i];
        dat = db.getId(id);
        dt = nm(dat.txt);
        for (k in g) {
          if (dt === nm(k)) {
            lvl = E.clip(Math.round(g[k]), 1, 100);
            if (u[Pip.formatId(id)] !== lvl) {
              u[Pip.formatId(id)] = lvl;
              chg = !0;
            }
            break;
          }
        }
      }
      db.close();
      if (chg) {
        require('fs').writeFileSync(p, JSON.stringify(u));
        if (typeof Pip !== 'undefined' && Pip.CURRENT && Pip.CURRENT.id === 'SKILLS' && Pip.emit) {
          Pip.emit('skills');
        }
      }
    } catch (e) {
      debug('skill sync', e);
    }
  };

  Player.prototype.syncfactions = function (d, visListChanged) {
    try {
      var rep = {}, vis = [], i, f, t;
      for (i = 0; i < d.length; i++) {
        f = d[i];
        if (!f.discovered) continue;
        t = E.clip(Math.round(f.tier), 0, 15);
        rep[f.name] = t;
        vis.push(f.name);
      }
      var fs = require('fs');
      fs.writeFileSync('SETTINGS/REP.JSON', JSON.stringify(rep));
      fs.writeFileSync('SETTINGS/REP_VISIBLE.JSON', JSON.stringify(vis));
      if (typeof Pip !== 'undefined' && Pip.CURRENT && Pip.CURRENT.id === 'GENERAL') {
        if (visListChanged && Pip.changeMenu) Pip.changeMenu();
        else if (Pip.emit) Pip.emit('factions');
      }
    } catch (e) {
      debug('faction sync', e);
    }
  };

  Player.prototype.settorch = function (on) {
    if (typeof Pip !== 'undefined' && Pip.setTorch) Pip.setTorch(on);
  };

  Player.prototype.renderheader = function (onlyItemsMode) {
    if (typeof Pip !== 'undefined' && Pip.renderHeader) {
      if (!onlyItemsMode || (Pip.CURRENT && Pip.MODE === 1)) {
        Pip.renderHeader();
      }
    }
  };

  Player.prototype.fullsyncrefresh = function () {
    if (typeof Pip !== 'undefined' && Pip.CURRENT) {
      if (Pip.CURRENT.id === 'SPECIAL' && Pip.emit) Pip.emit('special');
      else if (Pip.CURRENT.id === 'SKILLS' && Pip.emit) Pip.emit('skills');
      else if (Pip.MODE === 0 && Pip.CURRENT.id !== 'GENERAL' && Pip.changeMenu) Pip.changeMenu();
      else if (['WEAPONS', 'APPAREL', 'AID', 'MISC', 'AMMO'].indexOf(Pip.CURRENT.id) >= 0 && Pip.changeMenu) Pip.changeMenu();
    }
  };

  Player.prototype.clearinv = function () {
    if (typeof Pip !== 'undefined' && Pip.inv) {
      // Mark the open menu's InvFile as stale so its later remove()/sync() can't
      // write pre-clear data back over the items we're about to re-add.
      Pip.inv._invalidated = !0;
      delete Pip.inv;
    }
    var fs = require('fs'), m = NV ? 'NV' : 'F3';
    ['AID', 'AMMO', 'APPAREL', 'MISC', 'WEAPONS'].forEach(function (v) {
      try {
        fs.writeFileSync('INV/' + m + '/' + v + '.INV', '');
      } catch (e) {}
    });
  };

  Player.prototype.clearperks = function () {
    var fs = require('fs'), m = NV ? 'NV' : 'F3';
    try {
      fs.writeFileSync('SETTINGS/' + m + '_PERKS.JSON', '{}');
    } catch (e) {}
  };

  Player.prototype.equipapparel = function (ids, cnds) {
    try {
      var active = [0, 0, 0, 0],
        activeCnd = [0, 0, 0, 0],
        m = NV ? 'NV' : 'F3',
        db = new DataFile('DATA/' + m + '/APPAREL.DAT');
      ids.forEach(function (id, idx) {
        var it = db.getId(id);
        if (it && it.es != null) {
          active[it.es] = id;
          activeCnd[it.es] = cnds && cnds[idx] != null ? cnds[idx] : 100;
        }
      });
      db.close();
      this.setav('equippedApparel', active, !0);
      // Per-slot equipped condition lets APPAREL.JS flag only the worn condition
      // row when several conditions of one apparel form are carried at once.
      this.setav('equippedApparelCnd', activeCnd, !1);
      this.refreshequip();
    } catch (e) {}
  };

  Player.prototype.sortandrefreshinv = function (cats) {
    var m = NV ? 'NV' : 'F3';
    cats.forEach(function (v) {
      try {
        var d = new DataFile('DATA/' + m + '/' + v + '.DAT');
        var i = (typeof Pip !== 'undefined' && Pip.inv && Pip.CURRENT && Pip.CURRENT.id === v) ? Pip.inv : new InvFile('INV/' + m + '/' + v + '.INV', { idOrder: d.ids });
        if (i._requiresSort) i.sort(d.ids);
        if (typeof Pip !== 'undefined' && Pip.CURRENT && Pip.CURRENT.id === v) {
          Pip.emit('scroller', 'refresh');
        }
        d.close();
      } catch (e) {}
    });
  };

  Player.prototype.refreshspecial = function () {
    if (typeof Pip !== 'undefined' && Pip.CURRENT && Pip.CURRENT.id === 'SPECIAL' && Pip.emit) {
      Pip.emit('special');
    }
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
        if (!item) {
          return { txt: '', activ: !1 };
        }
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
    const clampScrollerIndices = function () {
      if (count <= 0) {
        scroller.selectedIndex = 0;
        scroller.scrollIndex = 0;
        return;
      }
      if (scroller.selectedIndex >= count) {
        scroller.selectedIndex = count - 1;
      }
      if (scroller.scrollIndex >= count) {
        scroller.scrollIndex = Math.max(0, count - 1);
      }
    };
    const _updateItemCount = scroller.updateItemCount;
    scroller.updateItemCount = function (c) {
      count = c;
      clampScrollerIndices();
      return _updateItemCount.call(this, c);
    };
    scroller.invalidateCache = function () {
      clampScrollerIndices();
      return _updateItemCount.call(this, count);
    };
    const _render = scroller.render;
    scroller.render = function (opt) {
      clampScrollerIndices();
      return _render.call(this, opt);
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

  // Companion header fixes: STATS AP from game sync; ITEMS caps from in-memory inv.
  function patchCompanionHeaders() {
    if (Pip._companionHeadersPatched || typeof Pip.getMode !== 'function')
      return !1;
    Pip._companionHeadersPatched = !0;
    const _getMode = Pip.getMode;
    Pip.getMode = function (mode) {
      const m = _getMode.apply(this, arguments);
      if (mode === 0 && m && typeof m.header === 'function') {
        const _header = m.header;
        m.header = function () {
          const rows = _header.call(this);
          if (typeof cmode !== 'undefined' && cmode) {
            const USER = player.getinfo();
            if (USER.ap !== undefined) {
              for (let ri = 0; ri < rows.length; ri++) {
                if (rows[ri][0] === 'AP') {
                  rows[ri][1] = `${USER.ap}/${USER.maxAP}`;
                  break;
                }
              }
            }
          }
          return rows;
        };
      }
      if (mode === 1 && m && typeof m.header === 'function') {
        const _header = m.header;
        m.header = function () {
          const rows = _header.call(this);
          if (Pip.inv && Pip.CURRENT && Pip.CURRENT.id === 'MISC') {
            let caps = 0;
            const capI = Pip.inv.indexOf(CAPS_FORM_ID);
            if (capI >= 0) {
              const capV = Pip.inv.get(capI);
              if (capV) caps = capV.cnt;
            }
            for (let ri = 0; ri < rows.length; ri++) {
              if (rows[ri][0] === 'Caps') {
                rows[ri][1] = String(caps).padStart(5, ' ');
                break;
              }
            }
          }
          return rows;
        };
      }
      return m;
    };
    return !0;
  }
  if (!patchCompanionHeaders()) {
    const headersPatchTimer = setInterval(function () {
      if (patchCompanionHeaders()) clearInterval(headersPatchTimer);
    }, 50);
  }

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
        if (nextOn === wasOn) {
          return;
        }
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
