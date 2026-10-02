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

  // Tale of Two Wastelands (FO3 inside FNV): FO3 items live in the NV
  // inventory files with their FO3 high byte + TTW_FLAG, and their data/images
  // come from DATA/F3. TTW_FLAG must stay below 0x80000000 - InvFile.get()
  // rebuilds ids with a signed `<< 24`. Pip.settings.ttw is set by the
  // companion (see Pip.setTTW) and persisted, so it also applies offline.
  const TTW_FLAG = 0x40000000;
  const isTTW = () => NV && Pip.settings.ttw;

  function openDat(path) {
    const f = E.openFile(path, 'r'),
      t = new Uint32Array(E.toArrayBuffer(f.read(8)));
    return { f: f, n: t[0], end: 8 + 4 * t[0], len: t[1] };
  }
  function readRec(d, i) {
    d.f.seek(d.end + i * d.len);
    try {
      return JSON.parse(d.f.read(d.len));
    } catch (e) {
      return { txt: '== ERROR ==' };
    }
  }

  // Lowercased item/perk name from a DAT record, for the TTW merge below.
  // Slices "txt" straight out of the record text (much cheaper than
  // JSON.parse per record) unless it contains an escape.
  function recName(d, i) {
    d.f.seek(d.end + i * d.len);
    const s = d.f.read(d.len),
      a = s.indexOf('"txt":"');
    if (a < 0) return '';
    const b = s.indexOf('"', a + 7);
    let t = s.slice(a + 7, b);
    if (t.indexOf('\\') >= 0 || s[b - 1] === '\\')
      try {
        t = JSON.parse(s).txt || '';
      } catch (e) {}
    return t.toLowerCase();
  }

  // Each category's DAT id list (also the menus' db.ids - see Pip.catData).
  // With TTW on (items + perks only - TTW leaves skills/SPECIAL as NV's) the
  // list holds both games' ids (FO3 ones flagged), MERGED by name so FO3
  // entries sort into place instead of trailing the NV ones - InvFile sorts by
  // idOrder position, so this is what orders every list. _catRec[i] is then
  // entry i's record index in its own DAT (NV or F3, per the flag).
  // Building the merge reads every record's name, so it's done once per
  // category and saved to DATA/TTW/<cat>.ORD ([nvCount, f3Count] header, ids,
  // record indexes); a DAT count change (firmware update) rebuilds it.
  // Only ONE list is cached (the companion syncs one category at a time), and
  // the open item menu's own list is reused rather than duplicated - caching
  // every category kept several KB (more with TTW) resident on every screen,
  // which ran Settings out of memory.
  // Keyed on game mode + TTW: SETTINGS' Pip-Boy mode toggle flips NV without
  // a reboot, and a stale list makes every lookup/sync use the wrong game's ids.
  let _catV, _catIds, _catRec, _catKey;
  function loadCat(v) {
    const d0 = openDat(`DATA/${NV ? 'NV' : 'F3'}/${v}.DAT`),
      d1 = isTTW() && (v === 'PERKS' || cats.indexOf(v) >= 0) ? openDat(`DATA/F3/${v}.DAT`) : null,
      n0 = d0.n;
    let ids, rec;
    if (!d1) ids = new Uint32Array(E.toArrayBuffer(d0.f.read(4 * n0)));
    else {
      const n1 = d1.n,
        n = n0 + n1,
        path = `DATA/TTW/${v}.ORD`,
        // statSync first: readFileSync throws (NO_PATH) when DATA/TTW doesn't exist yet.
        s = fs.statSync(path) && fs.readFileSync(path),
        ab = s && E.toArrayBuffer(s),
        hd = ab && ab.byteLength === 8 + 6 * n && new Uint32Array(ab, 0, 2);
      if (hd && hd[0] === n0 && hd[1] === n1) {
        ids = new Uint32Array(ab, 8, n);
        rec = new Uint16Array(ab, 8 + 4 * n, n);
      } else {
        const buf = new ArrayBuffer(8 + 6 * n),
          a0 = new Uint32Array(E.toArrayBuffer(d0.f.read(4 * n0))),
          a1 = new Uint32Array(E.toArrayBuffer(d1.f.read(4 * n1)));
        new Uint32Array(buf, 0, 2).set([n0, n1]);
        ids = new Uint32Array(buf, 8, n);
        rec = new Uint16Array(buf, 8 + 4 * n, n);
        // Both DATs are already name-sorted, so a streaming merge only ever
        // needs the current name from each side.
        let i = 0, j = 0, k = 0, na = n0 ? recName(d0, 0) : '', nb = n1 ? recName(d1, 0) : '';
        while (k < n) {
          if (j >= n1 || (i < n0 && na <= nb)) {
            (ids[k] = a0[i]), (rec[k++] = i++);
            i < n0 && (na = recName(d0, i));
          } else {
            (ids[k] = a1[j] + TTW_FLAG), (rec[k++] = j++);
            j < n1 && (nb = recName(d1, j));
          }
        }
        fs.statSync('DATA/TTW') || fs.mkdirSync('DATA/TTW');
        fs.writeFileSync(path, new Uint8Array(buf));
      }
      d1.f.close();
    }
    d0.f.close();
    (_catV = v), (_catIds = ids), (_catRec = rec);
  }
  function getCatIds(v) {
    const key = (NV ? 1 : 0) | (isTTW() ? 2 : 0);
    if (key !== _catKey) (_catV = _catIds = _catRec = void 0), (_catKey = key);
    if (_catV === v) return _catIds;
    // The open menu already holds this list (its idOrder) - don't load a copy.
    // (A mode/TTW change can't leave it stale: the mode toggle is only on
    // Settings, and Pip.setTTW rebuilds an open item menu.)
    if (Pip.CURRENT && Pip.CURRENT.id === v && Pip.inv && Pip.inv.idOrder)
      return Pip.inv.idOrder;
    return loadCat(v), _catIds;
  }

  // Called by the companion on every full sync. Only writes DEVICE.JSON when
  // the value actually changes (getCatIds drops its cache on its own). An
  // open item menu is rebuilt so it doesn't keep using its old-mode id list.
  Pip.setTTW = function (on) {
    on = !!on;
    if (!!Pip.settings.ttw === on) return;
    on ? (Pip.settings.ttw = 1) : delete Pip.settings.ttw;
    fs.writeFileSync('SETTINGS/DEVICE.JSON', JSON.stringify(Pip.settings));
    Pip.CURRENT && (Pip.CURRENT.id === 'PERKS' || cats.indexOf(Pip.CURRENT.id) >= 0) && Pip.changeMenu && Pip.changeMenu();
  };

  // Drop-in for `new DataFile(...)` in the item/perk menus (ids/getId/close
  // only). Shares getCatIds' cached list instead of loading a second copy,
  // and only opens DATA/F3 the first time a TTW entry is actually looked up.
  // FO3 records get TTW_FLAG added to `io` (so Pip.catImg reads DATA/F3's
  // .IMG) and to `ammo` (so it matches the flagged FO3 ammo ids).
  Pip.catData = function (v) {
    getCatIds(v);
    _catV === v || loadCat(v); // need _catRec too, not just the menu's ids
    const ids = _catIds,
      rec = _catRec,
      d0 = openDat(`DATA/${NV ? 'NV' : 'F3'}/${v}.DAT`);
    let d1;
    return {
      ids: ids,
      getId: function (id) {
        const i = ids.indexOf(id);
        if (i < 0) return { txt: '== MISSING ==' };
        if (!rec) return readRec(d0, i);
        if (id < TTW_FLAG) return readRec(d0, rec[i]);
        d1 || (d1 = openDat(`DATA/F3/${v}.DAT`));
        const r = readRec(d1, rec[i]);
        r.io !== void 0 && (r.io += TTW_FLAG);
        r.ammo && (r.ammo += TTW_FLAG);
        return r;
      },
      close: function () {
        d0.f.close();
        d1 && d1.f.close();
      }
    };
  };

  // Drop-in for the menus' .IMG file handle: offsets at/above TTW_FLAG (FO3
  // records, see Pip.catData) read from DATA/F3's .IMG, opened on first use.
  Pip.catImg = function (v) {
    const f0 = E.openFile(`DATA/${NV ? 'NV' : 'F3'}/${v}.IMG`, 'r');
    let f1, cur = f0;
    return {
      seek: function (o) {
        if (o >= TTW_FLAG) {
          cur = f1 || (f1 = E.openFile(`DATA/F3/${v}.IMG`, 'r'));
          o -= TTW_FLAG;
        } else cur = f0;
        cur.seek(o);
      },
      read: function (n) {
        return cur.read(n);
      },
      close: function () {
        f0.close();
        f1 && f1.close();
      }
    };
  };

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

  // Live player position + heading for the World Map screen, companion-
  // driven while WMAP is open. Kept here at boot0's top level, like
  // Pip.launchApp above, since WMAP.JS evals in its own scope.
  // x/y are already in the map's 0..2048 pixel space; heading is radians,
  // 0 = north, increasing clockwise. t = companion-side timestamp (ms) of
  // when the game reported this position, used by WMAP.JS to pace playback.
  Pip.companionSetMapPos = function (mapKey, x, y, heading, t) {
    // Packed into one object - Pip.emit only forwards up to 4 args total.
    const pos = { mapKey: mapKey, x: x, y: y, heading: heading, t: t };
    Pip._companionMapPos = pos;
    Pip.emit('companionMapPos', pos);
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

  // Menu JS loads read from the SD card, which is not re-entrant: if a sync
  // burst is mid-write (INV/DAM/REP flushes arrive over USB at any time), the
  // fs.readFileSync inside stock Pip.loadMenu can fail and the user gets the
  // "UNABLE TO LOAD AMMO.JS" screen for a menu that exists. Pre-flight the
  // read here, if it fails, retry the whole load once shortly after (the
  // write in progress is done within milliseconds).
  const _loadMenu = Pip.loadMenu;
  Pip.loadMenu = function (src, params) {
    let path;
    try {
      path = 'JS/' + (src || Pip.getMode(Pip.MODE).footer[Pip.MENUX].src);
    } catch (e) {
      return _loadMenu.call(this, src, params);
    }
    let ok = false;
    try {
      ok = !!require('fs').readFileSync(path);
    } catch (e) {}
    if (ok) return _loadMenu.call(this, src, params);
    debug(`Menu preflight read failed for ${path}, retrying once`);
    setTimeout(function () {
      _loadMenu.call(Pip, src, params);
    }, 250);
  };

  const _getinfo = Player.prototype.getinfo;
  Player.prototype.getinfo = function (refresh) {
    const p = _getinfo.call(this, refresh);
    if (cmode) {
      // maxHP must be applied before the hp fraction below is computed from
      // it - the game's actual effective max (includes any perk/trait/mod
      // bonus), overriding the stock (100 + 20*END + 5*(level-1)) formula
      // above, which only accounts for vanilla bonuses.
      const maxHP = this.getav('maxhp');
      if (void 0 !== maxHP) p.maxHP = maxHP;
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
      // TTW: re-sort on write so lists saved before the name-merged order
      // (FO3 entries trailing) get fixed. Cheap - sync() sorts in place.
      isTTW() && ((st.inv._requiresSort = !0), (st.inv._requiresSync = !0));
      debug(`Reconciled ${cat}: ${st.inv.count} kept, ${removed} removed`);
      if (st.onMenu) {
        refreshInvMenu(st.inv);
        if (st.capsChanged && cat === 'MISC' && Pip.MODE === 1 && Pip.renderHeader)
          Pip.renderHeader();
      } else st.inv.sync();
    } catch (e) {}
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

  // --- Per-item extras (game-calculated values that override the DAT) ---
  // WEAPONS_X.INV: weapon display damage (skill/condition-adjusted).
  // APPAREL_X.INV: armor DT (NV only - condition-adjusted, and correct under
  // TTW, where the DAT's DT is wrong or missing).
  // Both use InvFile's 8-byte rows keyed exactly like the inventory stacks
  // (id + cnd), with the value in cnt. One file per category so each menu only
  // loads its own, and an armor change never rewrites the weapon file.
  // Deliberately NO resident cache: menus read the raw file bytes while open
  // (Pip.xLoad - 8 bytes per entry, freed on close) instead of the old global
  // _damCache object, which cost ~32 bytes per entry on every screen.
  function xInvFile(cat) {
    const path = `INV/${NV ? 'NV' : 'F3'}/${cat}_X.INV`;
    if (!fs.statSync(path)) {
      try {
        fs.writeFileSync(path, '');
      } catch (e) {}
    }
    return new InvFile(path);
  }
  // One-time cleanup of the old weapon-damage-only files.
  try {
    ['NV', 'F3'].forEach((m) => {
      const p = `INV/${m}/${m}_DAM.INV`;
      fs.statSync(p) && fs.unlink(p);
    });
  } catch (e) {}

  // Menus: whole extras file as raw u32 pairs, or null if there's none.
  Pip.xLoad = function (cat) {
    try {
      const p = `INV/${NV ? 'NV' : 'F3'}/${cat}_X.INV`,
        s = fs.statSync(p) && fs.readFileSync(p);
      return s ? new Uint32Array(E.toArrayBuffer(s)) : null;
    } catch (e) {
      return null;
    }
  };
  // Menus: the extra value for (id, cnd), or undefined. Scans the raw rows
  // like findInvIdCnd (no per-row object allocation).
  Pip.xGet = function (u32, id, cnd) {
    if (!u32) return void 0;
    const want = cnd || 100;
    for (let i = 0; i < u32.length; i += 2)
      if (u32[i] === id && (((u32[i + 1] >> 16) & 255) || 100) === want) return u32[i + 1] & 65535;
    return void 0;
  };

  // Batch set: entries is [[id, cnd, value], ...]. One file open and one
  // flash write for the whole batch (e.g. a skill change touching every
  // carried weapon).
  Player.prototype.setx = function (cat, entries) {
    try {
      const inv = xInvFile(cat);
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e) continue;
        const wantCnd = e[1] || 100,
          inx = findInvIdCnd(inv, e[0], wantCnd);
        if (inx >= 0) {
          const it = inv.get(inx);
          it.cnt = e[2];
          inv.set(inx, it);
        } else inv.count < 256 && inv.add({ id: e[0], cnt: e[2], cnd: wantCnd });
      }
      inv.sync();
    } catch (e) {}
  };

  // Batch remove: entries is [[id, cnd], ...].
  Player.prototype.removex = function (cat, entries) {
    try {
      const inv = xInvFile(cat);
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e) continue;
        const inx = findInvIdCnd(inv, e[0], e[1] || 100);
        inx >= 0 && inv.remove(inx);
      }
      inv.sync();
    } catch (e) {}
  };

  // Full-sync reconciliation (mark-and-sweep, like setitemsbulk_begin/chunk/
  // end). Marks live in a side byte array instead of each row's fl, so rows
  // whose value didn't change are never touched and the file is only
  // rewritten if something actually changed. Without an idOrder, InvFile
  // appends new rows at the end, so existing indexes stay stable.
  let _xReconcile = null;

  Player.prototype.setxbulk_begin = function (cat) {
    try {
      _xReconcile = { cat: cat, inv: xInvFile(cat), seen: new Uint8Array(256) };
    } catch (e) {
      _xReconcile = null;
    }
  };

  Player.prototype.setxbulk_chunk = function (cat, entries) {
    const st = _xReconcile;
    if (!st || st.cat !== cat || !entries || !entries.length) return;
    try {
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e) continue;
        const wantCnd = e[1] || 100,
          inx = findInvIdCnd(st.inv, e[0], wantCnd);
        if (inx >= 0) {
          const it = st.inv.get(inx);
          it.cnt !== e[2] && ((it.cnt = e[2]), st.inv.set(inx, it));
          st.seen[inx] = 1;
        } else if (st.inv.count < 256) {
          st.inv.add({ id: e[0], cnt: e[2], cnd: wantCnd });
          st.seen[st.inv.count - 1] = 1;
        }
      }
    } catch (e) {}
  };

  Player.prototype.setxbulk_end = function (cat) {
    const st = _xReconcile;
    if (!st || st.cat !== cat) return;
    _xReconcile = null;
    try {
      for (let n = st.inv.count - 1; n >= 0; n--) st.seen[n] || st.inv.remove(n);
      st.inv.sync();
    } catch (e) {}
    this.refreshx(cat);
  };

  // Nudge the open menu for `cat` to re-read its extras file. Prefix match, so
  // a second file for the same menu (e.g. APPAREL_DR) refreshes it too.
  Player.prototype.refreshx = function (cat) {
    if (typeof Pip !== 'undefined' && Pip.CURRENT && Pip.CURRENT.id && cat.indexOf(Pip.CURRENT.id) === 0 && Pip.emit) {
      Pip.emit('scroller', 'xrefresh');
    }
  };

  Player.prototype.addperk = function (id, rank) {
    if ('number' != typeof id) throw new Error('perk should be a number');
    try {
      const m = NV ? 'NV' : 'F3',
        dbIds = getCatIds('PERKS');
      if (dbIds.indexOf(id) < 0) return;
      const db = Pip.catData('PERKS'),
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
      isTTW() && ((inv._requiresSort = !0), (inv._requiresSync = !0)); // see setitemsbulk_end
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
        db = Pip.catData('APPAREL');
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
      var dtTotal = 0, drTotal = 0;
      for (var i = 0; i < active.length; i++) {
        if (!active[i]) continue;
        var stat = db.getId(active[i]);
        stat && stat.dt && (dtTotal += stat.dt);
        stat && stat.dr && (drTotal += stat.dr);
      }
      db.close();
      // Connected in NV, the companion sends the game's own DT/DR totals
      // (armor condition + perks, and correct under TTW) - don't overwrite them.
      if (!(NV && cmode)) {
        NV && this.setav('dt', dtTotal);
        this.setav('dr', drTotal);
      }
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

  // --- DT/DR cycle (Tale of Two Wastelands only) ---
  // After the user rests on anything in ITEMS for DTDR_WAIT_MS, the header's DT
  // and the Apparel menu's DT block switch between DT and DR every
  // DTDR_FLIP_MS, both from this one timer so they always change together.
  // Any knob/button input (every one goes through Pip.kickIdleTimer) snaps
  // back to DT and restarts the wait, so scrolling never flickers.
  // DTDR_CYCLE = false turns the whole feature off (always DT, as before).
  const DTDR_CYCLE = true;
  const DTDR_WAIT_MS = 2500;
  const DTDR_FLIP_MS = 3000;
  Pip.dtdrShowDR = !1;
  let dtdrTimer;
  // Redraw the header + let the Apparel menu redraw its block. False when
  // not on an ITEMS screen (then the cycle stops until the next input).
  function dtdrDraw() {
    if (Pip.MODE !== 1 || !Pip.CURRENT || Pip.CURRENT.fullscreen || Pip.menuChanging) return !1;
    Pip.renderHeader();
    Pip.emit('dtdr', Pip.dtdrShowDR);
    h.flip();
    return !0;
  }
  function dtdrTick() {
    Pip.dtdrShowDR = !Pip.dtdrShowDR;
    if (dtdrDraw()) dtdrTimer = setTimeout(dtdrTick, DTDR_FLIP_MS);
    else (Pip.dtdrShowDR = !1), (dtdrTimer = void 0);
  }
  function dtdrRestart() {
    dtdrTimer && clearTimeout(dtdrTimer);
    dtdrTimer = void 0;
    if (Pip.dtdrShowDR) (Pip.dtdrShowDR = !1), dtdrDraw();
    // Mode isn't checked here - the button that switches to ITEMS fires this
    // before the mode changes; dtdrDraw checks it when the wait ends.
    isTTW() && (dtdrTimer = setTimeout(dtdrTick, DTDR_WAIT_MS));
  }
  // Installed at the very end of this file, outermost: the cmode no-sleep
  // kickIdleTimer override below returns early without calling what it
  // wraps, so wrapping inside it would never fire while connected.
  function patchDtdrCycle() {
    if (!DTDR_CYCLE) return !0;
    if (typeof Pip.kickIdleTimer !== 'function') return !1;
    const _kick = Pip.kickIdleTimer;
    Pip.kickIdleTimer = function () {
      dtdrRestart();
      return _kick.apply(this, arguments);
    };
    return !0;
  }

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
          // DT/DR cycle (see DTDR_CYCLE): show DR in DT's slot.
          if (isTTW() && Pip.dtdrShowDR) {
            for (let ri = 0; ri < rows.length; ri++) {
              if (rows[ri][0] === 'DT') {
                rows[ri] = ['DR', `${player.getav('dr') || 0}`.padStart(2, ' ')];
                break;
              }
            }
          }
          return rows;
        };
      }
      // DATA: stock looks the map name up in this mode's own MAPS.JSON, so a
      // TTW "F3/<key>" map (see WMAP.JS) would show the NV default name.
      if (mode === 2 && m && typeof m.header === 'function') {
        const _header = m.header;
        m.header = function () {
          const rows = _header.call(this),
            k = player.getav('map');
          if (k && k.indexOf('/') > 0) {
            const p = k.split('/');
            try {
              const e = JSON.parse(fs.readFile(`MAP/${p[0]}/MAPS.JSON`))[p[1]];
              e && e.name && rows[0] && (rows[0][1] = e.name);
            } catch (e) {}
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

  // DT/DR cycle input hook - must stay after the override above (see
  // patchDtdrCycle).
  if (!patchDtdrCycle()) {
    const dtdrPatchTimer = setInterval(function () {
      if (patchDtdrCycle()) clearInterval(dtdrPatchTimer);
    }, 50);
  }
})();
