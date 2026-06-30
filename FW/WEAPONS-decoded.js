(function (params) {
  params || (params = {});
  const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/WEAPONS.DAT`),
    ammoDb = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/AMMO.DAT`),
    inv = new InvFile(`INV/${NV ? 'NV' : 'F3'}/WEAPONS.INV`, {
      idOrder: db.ids
    }),
    ammoInv = new InvFile(`INV/${NV ? 'NV' : 'F3'}/AMMO.INV`),
    ammoIds = ammoInv.ids(),
    imgs = E.openFile(`DATA/${NV ? 'NV' : 'F3'}/WEAPONS.IMG`, 'r');
  // Dynamic DAM: the companion mirrors the game's skill/condition-adjusted weapon
  // damage into a side *_DAM.INV (damage stored in each entry's cnt), keyed by
  // (formId, condition). Load it into a lookup so getItem can override the static
  // DAT damage; reloaded on sync events that may change it. Falls back to DAT.
  const damFile = `INV/${NV ? 'NV' : 'F3'}/${NV ? 'NV' : 'F3'}_DAM.INV`;
  const loadDamMap = () => {
    // Fast path: boot0 keeps global._damCache in sync after every setdam/
    // removedam/cleardam write. _damCache is declared via global._damCache (not
    // var) so this IIFE and WEAPONS.JS share the exact same reference.
    if (typeof _damCache !== 'undefined' && _damCache !== null) return _damCache;
    // First load (boot before any setdam call, or after a failed clear): read
    // from flash once and prime the shared cache so future damrefresh events hit
    // the fast path.
    const m = {};
    try {
      const di = new InvFile(damFile);
      for (let i = 0; i < di.count; i++) {
        const e = di.get(i);
        if (e) m[e.id + ':' + (e.cnd || 100)] = e.cnt;
      }
    } catch (e) {}
    // Write back to the global so setdam/removedam/cleardam and future calls to
    // loadDamMap all converge on the same object.
    global._damCache = m;
    return m;
  };
  let damMap = loadDamMap();
  let active = player.getav('equippedWeap');
  let activeCnd = player.getav('equippedWeapCnd');
  const cndMode = () => cmode;
  // Virtual rows: when a multi-count stack of the equipped (id + condition) is
  // worn, the game has split one copy off the stack. Mirror that by listing the
  // equipped item as its own 1-count row with the remaining (cnt-1) directly
  // below it. Thrown weapons (grenades/spears) ready the whole stack, so they
  // are flagged whole and never split. Disconnected (no cmode) keeps stock 1:1
  // rows. part: -1 normal, 0 worn single, 1 remainder.
  //
  // virtEquipPending: set while waiting for the game to confirm equippedWeapWhole
  // after a device-initiated equip. Suppresses the split during that window so
  // thrown weapons never flash a spurious split row. Cleared by refreshEquip.
  let virtEquipPending = false;
  let virt = [];
  const buildVirt = () => {
    const out = [];
    const aware = cndMode();
    const eq = aware ? player.getav('equippedWeap') : void 0;
    const eqCnd = aware ? player.getav('equippedWeapCnd') : void 0;
    const whole = aware ? player.getav('equippedWeapWhole') : void 0;
    for (let i = 0; i < inv.count; i++) {
      const it = inv.get(i);
      out.push({ realN: i, part: -1 });
      if (
        it &&
        !virtEquipPending &&
        !whole &&
        eq &&
        it.id === eq &&
        (eqCnd === undefined || it.cnd === eqCnd) &&
        it.cnt > 1
      ) {
        out[out.length - 1].part = 0;
        out.push({ realN: i, part: 1 });
      }
    }
    return out;
  };
  const vAt = (n) => virt[n] || { realN: n, part: -1 };
  virt = buildVirt();
  const scroller = Pip.createScroller({
    hasEquipStates: !0,
    itemCount: virt.length,
    scrollStart: params.scrollTo ? inv.indexOf(params.scrollTo) : 0,
    getItem: (n) => {
      const v = vAt(n),
        it = inv.get(v.realN),
        item = db.getId(it.id),
        equipped = player.getav('equippedWeap'),
        equippedCnd = cndMode() ? player.getav('equippedWeapCnd') : void 0,
        matches =
          it.id === equipped &&
          (equippedCnd === undefined || it.cnd === equippedCnd);
      if (v.part === 0) item.activ = !0;
      else if (v.part !== 1 && matches) item.activ = !0;
      item.cnd = it.cnd;
      const dyn = damMap[it.id + ':' + (it.cnd || 100)];
      if (dyn != null) item.dam = dyn;
      const dispCnt = v.part === 0 ? 1 : v.part === 1 ? it.cnt - 1 : it.cnt;
      item.dispCnt = dispCnt;
      if (dispCnt > 1) item.txt = `${item.txt} (${dispCnt})`;
      if (item.ammo) {
        const ammo = ammoDb.getId(item.ammo),
          i = ammoIds.indexOf(item.ammo),
          am = ammoInv.get(i),
          ac = E.clip((am ? am.cnt : 0) - item.cl, 0, am ? am.cnt : 0);
        item.ammo = `${ammo.stxt ? ammo.stxt : ammo.txt} (${(am ? am.cnt : 0) - ac}/${ac})`;
      }
      return item;
    },
    width: 185,
    render: (item) => {
      if (!item) return;
      imgs.seek(item.io);
      const img = imgs.read(item.il);
      (h.drawImage(img, 340, 114, { rotate: 0 }),
        Pip.renderBlock(210, 192, 80, 'DAM', item.dam || '--'),
        Pip.renderBlock(296, 192, 80, 'WG', item.wt || '--'),
        Pip.renderBlock(382, 192, 80, 'VAL', Math.round(item.val * Math.pow((item.cnd / 100), 1.5) * (item.dispCnt || 1)) || '--'),
        NV && Pip.renderBlock(382, 164, 80, 'STR', item.str || '--'),
        Pip.renderBlock(210, 220, 80, 'CND', ''),
        h.fillRect(244, 228, 244 + ((item.cnd || 100) / 100) * 40, 237),
        NV &&
          h
            .setColor(0)
            .fillRect(277, 228, 278, 230)
            .fillRect(277, 235, 278, 237)
            .setColor(3),
        (item.ammo || NV) &&
          Pip.renderBlock(296, 220, 166, (item.ammo || '--') + ' ', ''));
      let effectStr = '';
      if (item.ef && item.ef.length) {
        let effectUnwrapped = item.ef
            .sort((a, b) => a.length - b.length)
            .map((s) => s.replaceAll(' ', '@'))
            .join(', '),
          firstWrap = h.wrapString(effectUnwrapped, 200);
        effectStr = (
          firstWrap[0] +
          '\n' +
          effectUnwrapped.substr(firstWrap[0].length)
        ).replaceAll('@', ' ');
      }
      (h.clearRect(210, 248, 460, 293),
        NV && item.ef && Pip.renderBlock(210, 248, 253, 'EFFECTS', effectStr));
    },
    onClick: (n) => {
      const v = vAt(n),
        it = inv.get(v.realN),
        item = db.getId(it.id),
        cndAware = cndMode(),
        // The remainder row (part=1) shares the same (id, cnd) as the equipped
        // row but must never unequip — clicking it should equip that copy.
        isActive =
          v.part !== 1 && active === it.id && (!cndAware || activeCnd === it.cnd);
      if (isActive) {
        active = void 0;
        activeCnd = void 0;
        virtEquipPending = false;
        item.fxu && Pip.audioStart(`SOUND/FX/WPN/${item.fxu}.WAV`);
        console.log('PIPSYNC:UNEQUIP:WEAPONS:' + Pip.formatId(it.id));
      } else {
        const prevId = active;
        const prevCnd = activeCnd;
        active = it.id;
        activeCnd = it.cnd;
        // Suppress the split until the game confirms equippedWeapWhole, but
        // only when switching to a genuinely different weapon. If the same
        // (id, cnd) is already equipped (remainder-row click), equippedWeapWhole
        // cannot have changed — no flash is possible and no suppression needed.
        // Setting the flag in that case would leave it stuck (the snapshot never
        // changes, so refreshEquip is never sent and the split never returns).
        virtEquipPending = prevId !== it.id ||
          (cndAware && prevCnd !== it.cnd);
        item.fxe && Pip.audioStart(`SOUND/FX/WPN/${item.fxe}.WAV`);
        if (prevId != null && prevId !== it.id) {
          console.log('PIPSYNC:UNEQUIP:WEAPONS:' + Pip.formatId(prevId));
        }
        console.log('PIPSYNC:EQUIP:WEAPONS:' + Pip.formatId(it.id) + ':' + it.cnd);
      }
      player.setav('equippedWeap', active, !0, !0);
      player.setav('equippedWeapCnd', activeCnd, !1);
      virt = buildVirt();
      scroller.updateItemCount(virt.length);
    },
    onLongClick: (n) => {
      if (cmode) return;
      const it = inv.get(vAt(n).realN);
      (Pip.playSound('TAB'),
        setTimeout(
          () =>
            Pip.changeMenu('ADDITEM.JS', {
              caller: 'WEAPONS.JS',
              dbFile: `DATA/${NV ? 'NV' : 'F3'}/WEAPONS.DAT`,
              invFile: `INV/${NV ? 'NV' : 'F3'}/WEAPONS.INV`,
              scrollTo: it ? it.id : void 0
            }),
          0
        ));
    }
  });
  const onScroller = (action, arg) => {
    if (action === 'count') {
      const prevLen = virt.length;
      virt = buildVirt();
      scroller.updateItemCount(virt.length);
      if (virt.length !== prevLen) scroller.render({ listOnly: !0 });
    } else if (action === 'render') scroller.render(arg);
    else if (action === 'damrefresh') {
      // DAM values changed (degradation/skill) — re-read and repaint the rows.
      damMap = loadDamMap();
      scroller.render({ listOnly: !1 });
    } else if (action === 'refresh') {
      virt = buildVirt();
      scroller.updateItemCount(virt.length);
      // List-only: a sort/reorder doesn't change the detail panel content, and
      // the full-render (image read + drawImage) here was the second-largest
      // contributor to the post-condition-change freeze.
      scroller.render({ listOnly: !0 });
    } else if (action === 'refreshEquip') {
      virtEquipPending = false;
      active = player.getav('equippedWeap');
      activeCnd = cndMode() ? player.getav('equippedWeapCnd') : void 0;
      virt = buildVirt();
      scroller.updateItemCount(virt.length);
      scroller.render({ listOnly: !1 });
    }
  };
  Pip.onExclusive('scroller', onScroller);
  Pip.inv = inv;
  return {
    id: 'WEAPONS',
    remove: () => {
      (Pip.removeListener('scroller', onScroller),
        delete Pip.inv,
        scroller.remove(),
        inv.sync(),
        db.close(),
        ammoDb.close(),
        imgs.close());
    }
  };
});
