/**
 * Companion boot patch - stored in Espruino Storage as .boot0
 *
 * Runs before FW.JS on the SD card and patches stock Pip-OS once Player/Pip exist.
 * Menu scripts (JS/*.JS) are deployed separately; stock FW.JS is left untouched.
 */
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
          if (typeof Pip !== 'undefined') {
            if (_cmode && Pip.timers && Pip.timers.idle) {
              clearTimeout(Pip.timers.idle);
              Pip.timers.idle = void 0;
            }
            if (Pip.CURRENT && Pip.emit) {
              Pip.emit('scroller', 'refreshEquip');
            }
          }
        }
      });
    } catch (e) {}
  })();

  // Shared across all inventory methods - hoisted here to avoid re-allocating
  // the array on every additemhealthpercent/removeitem/setformstacks call.
  const cats = ['AID', 'AMMO', 'APPAREL', 'MISC', 'WEAPONS'];

  // DAT catalogs are static game data, so read each category's id list from
  // flash once and reuse it instead of reopening the DataFile on every
  // add/remove/setformstacks call.
  const _catIdsCache = {};
  function getCatIds(v) {
    let ids = _catIdsCache[v];
    if (!ids) {
      const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/${v}.DAT`);
      ids = db.ids;
      db.close();
      _catIdsCache[v] = ids;
    }
    return ids;
  }

  function refreshInvMenu(inv) {
    if (inv.count === 0 && Pip.changeMenu) Pip.changeMenu();
    else Pip.emit('scroller', 'refresh');
  }

  // Long-press-to-drop in cmode (AID/AMMO/APPAREL/MISC/WEAPONS onLongClick).
  // Mirrors the in-game Pip-Boy's own drop behavior: a stack of 5 or fewer
  // drops one at a time per press (same as the quantity prompt it'd show for
  // a small stack); a stack larger than 5 drops in full in one press.
  // Hung off Pip (not a bare top-level function) so the menu scripts - each
  // eval'd in their own separate scope, not nested inside this closure - can
  // reach it, the same way they already reach Pip.launchApp.
  Pip.companionDropItem = function (category, inv, index, it) {
    if (!it) return;
    const dropCount = it.cnt > 5 ? it.cnt : 1;
    Pip.playSound('TAB');
    console.log(`PIPSYNC:DROP:${category}:${Pip.formatId(it.id)}:${dropCount}`);
    if (it.cnt > dropCount) {
      it.cnt -= dropCount;
      inv.set(index, it);
    } else {
      inv.remove(index);
    }
    // Stock's scroller dispatcher only auto-renders after onClick, not
    // onLongClick (see the "e.onLongClick && i && e.onLongClick(...)" branch
    // in FW.JS with no following render call) - without this the row's count
    // stays stale on screen despite the InvFile already being updated.
    refreshInvMenu(inv);
  };

  // Normalizer for skill name matching in syncskills - hoisted so it isn't
  // re-created on every syncskills call.
  const nm = function (s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  };

  // Launches a holotape/app (MISC.JS's item.exec entries). Deliberately kept
  // here, at boot0's own top level, instead of inline in MISC.js's onClick.
  Pip.launchApp = function (execPath) {
    debug(`Launch Holotape ${execPath}`);
    setTimeout(function () {
      // Route through this top-level helper rather than calling it 
      // from MISC's onClick like stock does: a timer callback created 
      // inside the menu's onClick closes over the whole menu working set 
      // (db/inv/imgs/apps/scroller) and keeps it reachable while the 
      // holotape parses, which is the OOM this helper exists to avoid. 
      // Here the callback closes over only execPath.
      if (typeof Pip.loadHolotape === 'function') {
        Pip.loadHolotape(execPath);
        return;
      }
    }, 10);
  };

  // STATUS (STATS > Status) has CND / RAD / CLK / ENG tabs. Knob2 on CND edits
  // limb condition - block that in cmode so game sync stays authoritative. CLK
  // uses knob2 for global brightness (manual § CLK) and must keep working.
  let companionStatusTab = 0;
  function companionResetStatusTab() {
    companionStatusTab = 0;
  }
  function companionStatusKnob2Blocked() {
    return (
      cmode &&
      Pip.CURRENT &&
      Pip.CURRENT.id === 'STATUS' &&
      companionStatusTab === 0
    );
  }

  const _emit = Pip.emit;
  Pip.emit = function (event, a, b, c) {
    if (Pip.CURRENT && Pip.CURRENT.id === 'STATUS') {
      if (event === 'knob1' && a) {
        companionStatusTab = E.clip(companionStatusTab + a, 0, 3);
      }
    } else if (event === 'mode') {
      companionResetStatusTab();
    }
    if (event === 'knob2' && companionStatusKnob2Blocked()) {
      return;
    }
    return _emit.apply(this, arguments);
  };

  const _changeMenu = Pip.changeMenu;
  Pip.changeMenu = function () {
    companionResetStatusTab();
    return _changeMenu.apply(this, arguments);
  };

  const _getinfo = Player.prototype.getinfo;
  Player.prototype.getinfo = function (refresh) {
    const p = _getinfo.call(this, refresh);
    if (cmode) {
      const hp = this.getav('hp');
      if (void 0 !== hp) p.hp = E.clip(hp, 0, p.maxHP) / p.maxHP;
      // Carry weight is copied straight from the game (see sync-engine
      // _diffWeight).
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
      const prev = this.player[key];
      let changed;
      if (key === 'equippedapparel' && v && typeof v.length === 'number') {
        v = [v[0] || 0, v[1] || 0, v[2] || 0, v[3] || 0];
        changed = !prev || prev[0] !== v[0] || prev[1] !== v[1] || prev[2] !== v[2] || prev[3] !== v[3];
      } else {
        changed = prev !== v;
      }
      if (changed) this.modified = !0;
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

  if (typeof DataFile !== 'undefined' && !DataFile.prototype._companionIdIndexPatched) {
    DataFile.prototype._companionIdIndexPatched = !0;
    DataFile.prototype.getId = function (id) {
      const idx = this.ids.indexOf(id);
      if (idx < 0) return { txt: '== MISSING ==' };
      this.file.seek(this.end + idx * this.len);
      const raw = this.file.read(this.len);
      try {
        return JSON.parse(raw);
      } catch (e) {
        return (debug('failed to parse data', e, raw), { txt: '== ERROR ==', desc: e });
      }
    };
  }

  const CAPS_FORM_ID = 15;
  if (typeof InvFile !== 'undefined' && !InvFile._companionMaxCntPatched) {
    InvFile._companionMaxCntPatched = !0;
    // Grows the buffer for multi-condition stacks (stock sizes it for one row
    // per id) and sorts by idOrder, then by cnd descending within an id, to
    // match in-game ordering (highest condition first).
    InvFile.prototype.add = function (dat) {
      if (!('id' in dat)) throw new Error('Cannot add item without an ID');
      if ((this.count + 1) * 8 > this.buf.byteLength) {
        const newBuf = new ArrayBuffer(this.buf.byteLength + 8);
        E.mapInPlace(this.buf, newBuf);
        this.buf = newBuf;
      }
      const newCnd = dat.cnd || 100;
      let insertAt = this.count;
      if (this.idOrder) {
        const ids = new Uint32Array(this.buf),
          cnds = new Uint8Array(this.buf),
          targetRank = this.idOrder.indexOf(dat.id);
        for (let o = 0; o < this.count; o++) {
          const rank = this.idOrder.indexOf(ids[2 * o]);
          if (rank > targetRank || (rank === targetRank && cnds[8 * o + 6] < newCnd)) {
            insertAt = o;
            break;
          }
        }
      }
      new Float64Array(this.buf).set(
        new Float64Array(this.buf, 8 * insertAt),
        insertAt + 1
      );
      this.count++;
      this.set(insertAt, {
        id: dat.id,
        cnt: E.clip(dat.cnt, 1, 9999),
        cnd: newCnd,
        fl: dat.fl || 0,
      });
      this._requiresSync = !0;
    };
    // set() (unlike add()) doesn't clip cnt, so a direct inv.set after cnt+=n
    // (additemhealthpercent's existing-stack branch) could write past 9999.
    const INV_MAX_CNT = 9999;
    const _invSet = InvFile.prototype.set;
    InvFile.prototype.set = function (i, dat) {
      if (dat && 'cnt' in dat) dat.cnt = E.clip(dat.cnt, 1, INV_MAX_CNT);
      return _invSet.call(this, i, dat);
    };
  }

  // Items of the same form but different condition are distinct stacks, so adds
  // and removes must target the row matching BOTH form ID and condition instead
  // of the first form-ID match. Condition 0 is stored as 100 by InvFile.add
  // (cnd||100), so normalise both sides the same way when comparing.
  function findInvIdCnd(inv, id, cnd) {
    const want = cnd || 100;
    if (!inv.buf || !inv.count) return -1;
    // Scan the raw 8-byte rows directly (id = first u32, cnd = byte 6) instead
    // of inv.get(i), which allocates an object + Uint8Array per row - that GC
    // churn adds up during sync bursts over large inventories.
    const u32 = new Uint32Array(inv.buf);
    for (let i = 0; i < inv.count; i++) {
      if (
        u32[2 * i] === id &&
        (((u32[2 * i + 1] >> 16) & 255) || 100) === want
      )
        return i;
    }
    return -1;
  }

  Player.prototype.additemhealthpercent = function (id, cnt, cnd, cat) {
    if (cnt <= 0) return;
    const wantCnd = cnd || 100;
    const scanCats = cat ? [cat] : cats;
    for (let ci = 0; ci < scanCats.length; ci++) {
      const v = scanCats[ci];
      try {
        const dbIds = getCatIds(v),
          i = dbIds.indexOf(id);
        if (i < 0) continue;
        const onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === v;
        const inv = onMenu
          ? Pip.inv
          : new InvFile(`INV/${NV ? 'NV' : 'F3'}/${v}.INV`, { idOrder: dbIds });
        const inx = findInvIdCnd(inv, id, wantCnd);
        if (inx >= 0) {
          let it = inv.get(inx);
          ((it.cnt += cnt), inv.set(inx, it));
        } else inv.add({ id: id, cnt: cnt, cnd: wantCnd });
        if (onMenu) {
          Pip.emit('scroller', 'refresh');
          if (v === 'MISC' && id === CAPS_FORM_ID && Pip.MODE === 1 && Pip.renderHeader)
            Pip.renderHeader();
        } else inv.sync();
        return !0;
      } catch (e) {}
    }
    return !1;
  };

  Player.prototype.removeitem = function (id, qty, cnd, cat) {
    if (qty <= 0) return;
    // cat is an optional single-category hint from the companion (see
    // additemhealthpercent). Without it we scan all five categories.
    const scanCats = cat ? [cat] : cats;
    for (let ci = 0; ci < scanCats.length; ci++) {
      const v = scanCats[ci];
      try {
        const dbIds = getCatIds(v),
          i = dbIds.indexOf(id);
        if (i < 0) continue;
        const onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === v;
        const inv = onMenu
          ? Pip.inv
          : new InvFile(`INV/${NV ? 'NV' : 'F3'}/${v}.INV`, { idOrder: dbIds });
        const inx = cnd === undefined ? inv.indexOf(id) : findInvIdCnd(inv, id, cnd);
        if (inx >= 0) {
          let it = inv.get(inx);
          it.cnt -= qty;
          if (it.cnt > 0) inv.set(inx, it);
          else inv.remove(inx);
          if (onMenu) {
            refreshInvMenu(inv);
            if (v === 'MISC' && id === CAPS_FORM_ID && Pip.MODE === 1 && Pip.renderHeader)
              Pip.renderHeader();
          } else inv.sync();
          return !0;
        }
      } catch (e) {}
    }
    return !1;
  };

  // Batched forms of additemhealthpercent/removeitem.
  Player.prototype.additemsbulk = function (cat, entries) {
    if (!entries || !entries.length) return;
    try {
      const dbIds = getCatIds(cat),
        onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === cat,
        inv = onMenu
          ? Pip.inv
          : new InvFile(`INV/${NV ? 'NV' : 'F3'}/${cat}.INV`, { idOrder: dbIds });
      let capsChanged = !1;
      for (let n = 0; n < entries.length; n++) {
        const e = entries[n],
          id = e[0],
          cnt = e[1];
        if (cnt <= 0 || dbIds.indexOf(id) < 0) continue;
        const wantCnd = e[2] || 100,
          inx = findInvIdCnd(inv, id, wantCnd);
        if (inx >= 0) {
          let it = inv.get(inx);
          ((it.cnt += cnt), inv.set(inx, it));
        } else inv.add({ id: id, cnt: cnt, cnd: wantCnd });
        if (id === CAPS_FORM_ID) capsChanged = !0;
      }
      if (onMenu) {
        Pip.emit('scroller', 'refresh');
        if (capsChanged && cat === 'MISC' && Pip.MODE === 1 && Pip.renderHeader)
          Pip.renderHeader();
      } else inv.sync();
    } catch (e) {}
  };

  Player.prototype.removeitemsbulk = function (cat, entries) {
    if (!entries || !entries.length) return;
    try {
      const dbIds = getCatIds(cat),
        onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === cat,
        inv = onMenu
          ? Pip.inv
          : new InvFile(`INV/${NV ? 'NV' : 'F3'}/${cat}.INV`, { idOrder: dbIds });
      const savedOnLoaded = inv.onLoaded;
      if (onMenu) inv.onLoaded = void 0;
      let capsChanged = !1;
      for (let n = 0; n < entries.length; n++) {
        const e = entries[n],
          id = e[0],
          qty = e[1],
          cnd = e[2];
        if (qty <= 0 || dbIds.indexOf(id) < 0) continue;
        const inx = cnd === undefined ? inv.indexOf(id) : findInvIdCnd(inv, id, cnd);
        if (inx < 0) continue;
        let it = inv.get(inx);
        it.cnt -= qty;
        if (it.cnt > 0) inv.set(inx, it);
        else inv.remove(inx);
        if (id === CAPS_FORM_ID) capsChanged = !0;
      }
      if (onMenu) inv.onLoaded = savedOnLoaded;
      if (onMenu) {
        refreshInvMenu(inv);
        if (capsChanged && cat === 'MISC' && Pip.MODE === 1 && Pip.renderHeader)
          Pip.renderHeader();
      } else inv.sync();
    } catch (e) {}
  };

  // Full-sync inventory reconciliation for one category, mark-and-sweep style
  // (same idea as setperksbulk).
  let _itemsReconcile = null;

  Player.prototype.setitemsbulk_begin = function (cat) {
    try {
      const dbIds = getCatIds(cat),
        onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === cat,
        inv = onMenu
          ? Pip.inv
          : new InvFile(`INV/${NV ? 'NV' : 'F3'}/${cat}.INV`, { idOrder: dbIds });
      const savedOnLoaded = inv.onLoaded;
      if (onMenu) inv.onLoaded = void 0;
      _itemsReconcile = {
        cat: cat,
        inv: inv,
        dbIds: dbIds,
        onMenu: onMenu,
        savedOnLoaded: savedOnLoaded,
        capsChanged: !1,
      };
    } catch (e) {
      _itemsReconcile = null;
    }
  };

  Player.prototype.setitemsbulk_chunk = function (cat, entries) {
    const st = _itemsReconcile;
    if (!st || st.cat !== cat || !entries || !entries.length) return;
    try {
      for (let n = 0; n < entries.length; n++) {
        const e = entries[n],
          id = e[0],
          cnt = e[1];
        if (cnt <= 0 || st.dbIds.indexOf(id) < 0) continue;
        const wantCnd = e[2] || 100,
          inx = findInvIdCnd(st.inv, id, wantCnd);
        if (inx >= 0) {
          let it = st.inv.get(inx);
          it.cnt = cnt;
          it.fl = 1;
          st.inv.set(inx, it);
        } else st.inv.add({ id: id, cnt: cnt, cnd: wantCnd, fl: 1 });
        if (id === CAPS_FORM_ID) st.capsChanged = !0;
      }
    } catch (e) {}
  };

  Player.prototype.setitemsbulk_end = function (cat) {
    const st = _itemsReconcile;
    if (!st || st.cat !== cat) return;
    _itemsReconcile = null;
    try {
      let removed = 0;
      for (let n = st.inv.count - 1; n >= 0; n--) {
        const it = st.inv.get(n);
        if (!it || !it.fl) {
          st.inv.remove(n);
          removed++;
        } else {
          it.fl = 0;
          st.inv.set(n, it);
        }
      }
      if (st.onMenu) st.inv.onLoaded = st.savedOnLoaded;
      debug(`Reconciled ${cat}: ${st.inv.count} kept, ${removed} removed`);
      if (st.onMenu) {
        refreshInvMenu(st.inv);
        if (st.capsChanged && cat === 'MISC' && Pip.MODE === 1 && Pip.renderHeader)
          Pip.renderHeader();
      } else st.inv.sync();
    } catch (e) {}
  };

  Player.prototype.setitemcondition = function (id, cnd) {
    for (let ci = 0; ci < cats.length; ci++) {
      const v = cats[ci];
      try {
        const dbIds = getCatIds(v),
          i = dbIds.indexOf(id);
        if (i < 0) continue;
        const onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === v;
        const inv = onMenu
          ? Pip.inv
          : new InvFile(`INV/${NV ? 'NV' : 'F3'}/${v}.INV`, { idOrder: dbIds });
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

  // Authoritatively rebuild every row of `id` from `stacks` ([{cnt,cnd},...]).
  // Used when an item's per-condition distribution changes (degrade/repair): a
  // single atomic replace instead of add+remove, so a lost remove can't leave a
  // duplicate condition row, and any pre-existing orphan of this form is cleared.
  Player.prototype.setformstacks = function (id, stacks) {
    for (let ci = 0; ci < cats.length; ci++) {
      const v = cats[ci];
      try {
        const dbIds = getCatIds(v),
          i = dbIds.indexOf(id);
        if (i < 0) continue;
        const onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === v;
        const inv = onMenu
          ? Pip.inv
          : new InvFile(`INV/${NV ? 'NV' : 'F3'}/${v}.INV`, { idOrder: dbIds });
        // Suppress per-row onLoaded renders while removing this id's old rows -
        // see removeitemsbulk for why.
        const savedOnLoaded = inv.onLoaded;
        if (onMenu) inv.onLoaded = void 0;
        for (let n = inv.count - 1; n >= 0; n--) {
          const it = inv.get(n);
          if (it && it.id === id) inv.remove(n);
        }
        if (onMenu) inv.onLoaded = savedOnLoaded;
        (stacks || []).forEach(function (s) {
          if (s && s.cnt > 0) inv.add({ id: id, cnt: s.cnt, cnd: s.cnd || 100 });
        });
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

  // --- Weapon DAM (display damage) sync ---
  // The companion computes the game's dynamic weapon damage (base x skill x
  // condition) and mirrors it here one (formId, condition) entry at a time, in a
  // side InvFile keyed exactly like the inventory stacks.
  global._damCache = null;

  function damInvFile() {
    var m = NV ? 'NV' : 'F3',
      path = 'INV/' + m + '/' + m + '_DAM.INV';
    if (!require('fs').statSync(path)) {
      try {
        require('fs').writeFileSync(path, '');
      } catch (e) {}
    }
    return new InvFile(path);
  }

  // Apply one (id, cnd, dam) entry to an already-open DAM InvFile and mirror
  // the single affected key into _damCache.
  function _applyDamEntry(inv, id, cnd, dam) {
    var wantCnd = cnd || 100,
      inx = findInvIdCnd(inv, id, wantCnd);
    if (inx >= 0) {
      var it = inv.get(inx);
      it.cnt = dam;
      inv.set(inx, it);
    } else {
      inv.add({ id: id, cnt: dam, cnd: wantCnd });
    }
    if (_damCache) _damCache[id + ':' + wantCnd] = dam;
  }

  Player.prototype.setdam = function (id, cnd, dam) {
    try {
      var inv = damInvFile();
      _applyDamEntry(inv, id, cnd, dam);
      inv.sync();
    } catch (e) {}
  };

  // Batch form: entries is [[id, cnd, dam], ...]. One file open and one flash
  // write for the whole batch e.g a skill change touching every carried weapon
  // costs one sync() instead of one per weapon.
  Player.prototype.setdams = function (entries) {
    try {
      var inv = damInvFile();
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e) _applyDamEntry(inv, e[0], e[1], e[2]);
      }
      inv.sync();
    } catch (e) {}
  };

  Player.prototype.removedam = function (id, cnd) {
    try {
      var inv = damInvFile(),
        wantCnd = cnd || 100,
        inx = findInvIdCnd(inv, id, wantCnd);
      if (inx >= 0) {
        inv.remove(inx);
        inv.sync();
        if (_damCache) delete _damCache[id + ':' + wantCnd];
      }
    } catch (e) {}
  };

  // Batch form: entries is [[id, cnd], ...]. One file open and one flash
  // write for the whole batch instead of one per removed weapon stack.
  Player.prototype.removedams = function (entries) {
    try {
      var inv = damInvFile();
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e) continue;
        var wantCnd = e[1] || 100,
          inx = findInvIdCnd(inv, e[0], wantCnd);
        if (inx >= 0) {
          inv.remove(inx);
          if (_damCache) delete _damCache[e[0] + ':' + wantCnd];
        }
      }
      inv.sync();
    } catch (e) {}
  };

  // Full-sync DAM reconciliation, same mark-and-sweep pattern as
  // setitemsbulk_begin/chunk/end above - replaces the old cleardam()+setdams()
  // pair, which truncated *_DAM.INV and rewrote it at full size on every full
  // sync even when no carried weapon's damage had actually changed.
  let _damReconcile = null;

  Player.prototype.setdamsbulk_begin = function () {
    try {
      _damReconcile = { inv: damInvFile() };
    } catch (e) {
      _damReconcile = null;
    }
  };

  Player.prototype.setdamsbulk_chunk = function (entries) {
    const st = _damReconcile;
    if (!st || !entries || !entries.length) return;
    try {
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e) continue;
        const wantCnd = e[1] || 100,
          inx = findInvIdCnd(st.inv, e[0], wantCnd);
        if (inx >= 0) {
          let it = st.inv.get(inx);
          it.cnt = e[2];
          it.fl = 1;
          st.inv.set(inx, it);
        } else st.inv.add({ id: e[0], cnt: e[2], cnd: wantCnd, fl: 1 });
      }
    } catch (e) {}
  };

  Player.prototype.setdamsbulk_end = function () {
    const st = _damReconcile;
    if (!st) return;
    _damReconcile = null;
    try {
      for (let n = st.inv.count - 1; n >= 0; n--) {
        const it = st.inv.get(n);
        if (!it || !it.fl) {
          st.inv.remove(n);
        } else {
          it.fl = 0;
          st.inv.set(n, it);
        }
      }
      st.inv.sync();
      if (_damCache) {
        _damCache = {};
        for (let n = 0; n < st.inv.count; n++) {
          const it = st.inv.get(n);
          _damCache[it.id + ':' + (it.cnd || 100)] = it.cnt;
        }
      }
    } catch (e) {}
  };

  // Nudge the open WEAPONS menu to re-read the DAM file after a batch of
  // setdam/removedam writes (e.g. a skill change with no inventory change).
  Player.prototype.refreshweapondam = function () {
    if (typeof Pip !== 'undefined' && Pip.CURRENT && Pip.CURRENT.id === 'WEAPONS' && Pip.emit) {
      Pip.emit('scroller', 'damrefresh');
    }
  };

  Player.prototype.addperk = function (id, rank) {
    if ('number' != typeof id) throw new Error('perk should be a number');
    try {
      const m = NV ? 'NV' : 'F3',
        dbIds = getCatIds('PERKS');
      if (dbIds.indexOf(id) < 0) return;
      const db = new DataFile(`DATA/${m}/PERKS.DAT`),
        perkDef = db.getId(id);
      db.close();
      const wantRank = E.clip(
        rank === undefined ? 1 : Math.round(rank),
        1,
        perkDef.rks || 1
      );
      const onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === 'PERKS';
      const inv = onMenu
        ? Pip.inv
        : new InvFile(`INV/${m}/PERKS.INV`, { idOrder: dbIds });
      const inx = inv.indexOf(id);
      if (inx >= 0) {
        let it = inv.get(inx);
        it.cnt = wantRank;
        inv.set(inx, it);
      } else inv.add({ id: id, cnt: wantRank, cnd: 100, fl: 0 });
      if (onMenu) Pip.emit('scroller', 'refresh');
      else inv.sync();
      debug(`Added perk ${perkDef.txt}`);
    } catch (e) {}
  };

  Player.prototype.removeperk = function (id) {
    if ('number' != typeof id) throw new Error('perk should be a number');
    try {
      const m = NV ? 'NV' : 'F3',
        ids = getCatIds('PERKS');
      const onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === 'PERKS';
      const inv = onMenu
        ? Pip.inv
        : new InvFile(`INV/${m}/PERKS.INV`, { idOrder: ids });
      const inx = inv.indexOf(id);
      if (inx >= 0) {
        inv.remove(inx);
        if (onMenu) Pip.emit('scroller', 'refresh');
        else inv.sync();
      }
    } catch (e) {}
  };

  // Batched forms of addperk/removeperk.
  Player.prototype.addperksbulk = function (ids) {
    if (!ids || !ids.length) return;
    try {
      const m = NV ? 'NV' : 'F3',
        dbIds = getCatIds('PERKS');
      const onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === 'PERKS',
        inv = onMenu
          ? Pip.inv
          : new InvFile(`INV/${m}/PERKS.INV`, { idOrder: dbIds });
      let added = 0;
      for (let n = 0; n < ids.length; n++) {
        const id = ids[n];
        if (dbIds.indexOf(id) < 0) continue;
        const inx = inv.indexOf(id);
        if (inx >= 0) {
          let it = inv.get(inx);
          it.cnt = 1;
          inv.set(inx, it);
        } else inv.add({ id: id, cnt: 1, cnd: 100, fl: 0 });
        added++;
      }
      debug(`Added ${added} perk(s)`);
      if (onMenu) Pip.emit('scroller', 'refresh');
      else inv.sync();
    } catch (e) {}
  };

  Player.prototype.removeperksbulk = function (ids) {
    if (!ids || !ids.length) return;
    try {
      const m = NV ? 'NV' : 'F3',
        dbIds = getCatIds('PERKS');
      const onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === 'PERKS',
        inv = onMenu
          ? Pip.inv
          : new InvFile(`INV/${m}/PERKS.INV`, { idOrder: dbIds });
      let changed = !1;
      for (let n = 0; n < ids.length; n++) {
        const id = ids[n];
        if (dbIds.indexOf(id) < 0) continue;
        const inx = inv.indexOf(id);
        if (inx >= 0) {
          (inv.remove(inx), (changed = !0));
        }
      }
      if (changed) {
        if (onMenu) Pip.emit('scroller', 'refresh');
        else inv.sync();
      }
    } catch (e) {}
  };

  // Full-sync perk reconciliation: ids is the complete desired perk set.
  Player.prototype.setperksbulk = function (ids) {
    try {
      const m = NV ? 'NV' : 'F3',
        dbIds = getCatIds('PERKS');
      const want = {};
      for (let n = 0; n < ids.length; n++) {
        if (dbIds.indexOf(ids[n]) >= 0) want[ids[n]] = !0;
      }
      const onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === 'PERKS',
        inv = onMenu
          ? Pip.inv
          : new InvFile(`INV/${m}/PERKS.INV`, { idOrder: dbIds });
      const savedOnLoaded = inv.onLoaded;
      if (onMenu) inv.onLoaded = void 0;
      let removed = 0;
      for (let n = inv.count - 1; n >= 0; n--) {
        const it = inv.get(n);
        if (!it || !want[it.id]) {
          inv.remove(n);
          removed++;
        } else delete want[it.id];
      }
      if (onMenu) inv.onLoaded = savedOnLoaded;
      let added = 0;
      for (const id in want) {
        inv.add({ id: Number(id), cnt: 1, cnd: 100, fl: 0 });
        added++;
      }
      debug(`Reconciled perks: +${added} -${removed}`);
      if (onMenu) Pip.emit('scroller', 'refresh');
      else inv.sync();
    } catch (e) {}
  };

  Player.prototype.safeaddperk = function (p) {
    try {
      if (getCatIds('PERKS').indexOf(p) >= 0) this.addperk(p);
    } catch (e) {}
  };

  Player.prototype.saferemoveperk = function (p) {
    try {
      if (getCatIds('PERKS').indexOf(p) >= 0) this.removeperk(p);
    } catch (e) {}
  };

  Player.prototype.refreshequip = function (v) {
    if (typeof Pip !== 'undefined' && Pip.CURRENT && (!v || Pip.CURRENT.id === v)) {
      if (Pip.refreshEquipState) Pip.refreshEquipState();
      else Pip.emit('scroller', 'refreshEquip');
    }
  };

  // Normalized skill name -> formId, built once from SKILLS.DAT and reused.
  let _skillNameMap = null;
  function getSkillNameMap() {
    if (_skillNameMap) return _skillNameMap;
    const m = NV ? 'NV' : 'F3',
      ids = getCatIds('SKILLS'),
      db = new DataFile(`DATA/${m}/SKILLS.DAT`),
      map = {};
    for (let i = 0; i < ids.length; i++) {
      map[nm(db.getId(ids[i]).txt)] = ids[i];
    }
    db.close();
    _skillNameMap = map;
    return map;
  }

  Player.prototype.syncskills = function (g) {
    try {
      var m = NV ? 'NV' : 'F3',
        nameMap = getSkillNameMap(),
        onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === 'SKILLS',
        inv = onMenu
          ? Pip.inv
          : new InvFile('INV/' + m + '/SKILLS.INV', { idOrder: getCatIds('SKILLS') }),
        chg = !1,
        gn = {},
        id, k, lvl, dt, inx, it;
      for (k in g) gn[nm(k)] = g[k];
      for (dt in nameMap) {
        if (!gn.hasOwnProperty(dt)) continue;
        id = nameMap[dt];
        lvl = E.clip(Math.round(gn[dt]), 1, 100);
        inx = inv.indexOf(id);
        if (inx >= 0) {
          it = inv.get(inx);
          if (it.cnt === lvl) continue;
          it.cnt = lvl;
          inv.set(inx, it);
        } else inv.add({ id: id, cnt: lvl, cnd: 100, fl: 0 });
        chg = !0;
      }
      if (chg) {
        if (onMenu) Pip.emit('scroller', 'refresh');
        else inv.sync();
      }
    } catch (e) {
      debug('skill sync', e);
    }
  };

  // Last-written JSON strings, so a snapshot that didn't actually change
  // faction data (common on repeated full syncs) skips both flash writes.
  let _lastRepJson = null, _lastVisJson = null;
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
      var repJson = JSON.stringify(rep),
        visJson = JSON.stringify(vis),
        repChanged = repJson !== _lastRepJson,
        visChanged = visJson !== _lastVisJson,
        fs = require('fs');
      if (repChanged) {
        fs.writeFileSync('SETTINGS/REP.JSON', repJson);
        _lastRepJson = repJson;
      }
      if (visChanged) {
        fs.writeFileSync('SETTINGS/REP_VISIBLE.JSON', visJson);
        _lastVisJson = visJson;
      }
      if ((repChanged || visChanged) && typeof Pip !== 'undefined' && Pip.CURRENT && Pip.CURRENT.id === 'GENERAL') {
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
      else if (Pip.MODE === 0 && Pip.CURRENT.id !== 'GENERAL' && Pip.changeMenu) Pip.changeMenu();
      else if (['WEAPONS', 'APPAREL', 'AID', 'MISC', 'AMMO'].indexOf(Pip.CURRENT.id) >= 0 && Pip.changeMenu) Pip.changeMenu();
    }
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
      this.setav('equippedApparel', active, !0);
      this.setav('equippedApparelCnd', activeCnd, !1);
      // DT/DR must be computed here, not left to APPAREL.JS's onClick/
      // updateDtDr: those only run while the APPAREL menu is the one
      // currently open, but this function is what every game-driven sync
      // (initial full sync AND every later equip change) calls regardless of
      // which menu - or none - is on screen. Left to the menu alone, DT/DR
      // stayed stuck at 0 after the first sync until the player happened to
      // equip/unequip something from the Pip-Boy itself.
      var total = 0;
      for (var i = 0; i < active.length; i++) {
        if (!active[i]) continue;
        var stat = db.getId(active[i]);
        stat = NV ? stat && stat.dt : stat && stat.dr;
        stat && (total += stat);
      }
      db.close();
      this.setav(NV ? 'dt' : 'dr', total);
      this.refreshequip();
      Pip.renderHeader && Pip.renderHeader();
    } catch (e) {}
  };

  Player.prototype.sortandrefreshinv = function (cats) {
    cats.forEach(function (v) {
      try {
        if (typeof Pip !== 'undefined' && Pip.CURRENT && Pip.CURRENT.id === v) {
          Pip.emit('scroller', 'refresh');
        }
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
          // XP is NOT gated on cmode: once the game has pushed a real XP it
          // persists in PLAYER.JSON, and the stock header otherwise replaces
          // it with a decorative date-based fake (xpNext * dayOfMonth/32 -
          // see stock FW's STATS header), which would make the value visibly
          // "revert" the moment the companion disconnects. AP stays
          // cmode-gated: it's ephemeral game state, meaningless offline.
          const hasXp = player.getav('xp') !== undefined;
          if (cmode || hasXp) {
            const USER = player.getinfo();
            if (cmode && USER.ap !== undefined) {
              for (let ri = 0; ri < rows.length; ri++) {
                if (rows[ri][0] === 'AP') {
                  rows[ri][1] = `${USER.ap}/${USER.maxAP}`;
                  break;
                }
              }
            }
            if (hasXp) {
              for (let ri = 0; ri < rows.length; ri++) {
                if (rows[ri][0] === 'XP') {
                  rows[ri][1] = USER.xpNext
                    ? `${USER.xp}/${USER.xpNext}`
                    : 'MAX';
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

  // In companion mode (cmode), long-press ITEMS toggles the torch LED only, never
  // the full-screen TORCH overlay (torchMode Screen / LED+Screen).
  if (typeof Pip.setTorch === 'function') {
    const _setTorch = Pip.setTorch;
    Pip.setTorch = function (on) {
      const explicit = void 0 !== on;
      const wasOn = !!Pip.torchOn;
      if (cmode) {
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

  // Override kickIdleTimer to prevent the device from entering sleep mode
  // while Companion Mode (cmode) is active. Sleeping clears button watches,
  // which broke Pip-Boy to game flashlight sync after 5 minutes of inactivity.
  if (typeof Pip.kickIdleTimer === 'function') {
    const _kickIdleTimer = Pip.kickIdleTimer;
    Pip.kickIdleTimer = function () {
      if (cmode) {
        if (Pip.timers && Pip.timers.idle) {
          clearTimeout(Pip.timers.idle);
          Pip.timers.idle = void 0;
        }
        return;
      }
      return _kickIdleTimer.apply(this, arguments);
    };
  }
})();
