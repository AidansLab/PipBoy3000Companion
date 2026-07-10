(function (params) {
  params || (params = {});
  const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/APPAREL.DAT`),
    inv = new InvFile(`INV/${NV ? 'NV' : 'F3'}/APPAREL.INV`, {
      idOrder: db.ids
    }),
    imgs = E.openFile(`DATA/${NV ? 'NV' : 'F3'}/APPAREL.IMG`, 'r');
  function normalizeActive(raw) {
    if (!raw || typeof raw.length !== 'number') return [0, 0, 0, 0];
    return [raw[0] || 0, raw[1] || 0, raw[2] || 0, raw[3] || 0];
  }
  let active = normalizeActive(player.getav('equippedApparel'));
  const cndMode = () => cmode;
  const readActiveCnd = () =>
    cndMode() ? player.getav('equippedApparelCnd') || [] : [];
  let activeCnd = readActiveCnd();
  // Virtual rows: a worn item from a multi-count stack is split off in-game, so
  // show the equipped copy as its own 1-count row with the remaining (cnt-1)
  // directly below it. Only while connected (cmode); disconnected stays 1:1.
  // part: -1 normal, 0 worn single, 1 remainder.
  let virt = [];
  const buildVirt = () => {
    const out = [];
    const aware = cndMode();
    for (let i = 0; i < inv.count; i++) {
      const it = inv.get(i);
      out.push({ realN: i, part: -1 });
      if (aware && it && it.cnt > 1) {
        const di = db.getId(it.id),
          es = di && di.es;
        if (
          es != null &&
          active[es] === it.id &&
          (activeCnd[es] === undefined || activeCnd[es] === it.cnd)
        ) {
          out[out.length - 1].part = 0;
          out.push({ realN: i, part: 1 });
        }
      }
    }
    return out;
  };
  const vAt = (n) => virt[n] || { realN: n, part: -1 };
  const updateDtDr = () => {
    if (NV) {
      let newDT = 0;
      for (let i = 0; i < active.length; i++) {
        const item = db.getId(active[i]);
        item && item.dt && (newDT += item.dt);
      }
      player.setav('dt', newDT);
    } else {
      let newDR = 0;
      for (let i = 0; i < active.length; i++) {
        const item = db.getId(active[i]);
        item && item.dr && (newDR += item.dr);
      }
      player.setav('dr', newDR);
    }
    Pip.renderHeader();
  };
  virt = buildVirt();
  const scroller = Pip.createScroller({
    hasEquipStates: !0,
    itemCount: virt.length,
    scrollStart: params.scrollTo ? inv.indexOf(params.scrollTo) : 0,
    getItem: (n) => {
      const v = vAt(n),
        it = inv.get(v.realN),
        item = db.getId(it.id),
        slotMatch =
          active[item.es] == it.id &&
          (activeCnd[item.es] === undefined || activeCnd[item.es] === it.cnd);
      if (v.part === 0) item.activ = !0;
      else if (v.part !== 1 && slotMatch) item.activ = !0;
      item.cnd = it.cnd;
      const dispCnt = v.part === 0 ? 1 : v.part === 1 ? it.cnt - 1 : it.cnt;
      item.dispCnt = dispCnt;
      if (dispCnt > 1) item.txt = `${item.txt} (${dispCnt})`;
      return item;
    },
    width: 185,
    render: (item) => {
      (Pip.renderBlock(
        210,
        192,
        80,
        NV ? 'DT' : 'DR',
        (NV ? item.dt : item.dr) || '--'
      ),
        Pip.renderBlock(296, 192, 80, 'WG', item.wt || '--'),
        Pip.renderBlock(382, 192, 80, 'VAL', Math.round(item.val * Math.pow((item.cnd / 100), 1.5) * (item.dispCnt || 1)) || '--'),
        Pip.renderBlock(210, 220, 80, 'CND', ''),
        h
          .setColor(1)
          .fillRect(244, 228, 284, 237)
          .setColor(3)
          .fillRect(244, 228, 244 + ((item.cnd || 100) / 100) * 40, 237),
        NV &&
          h
            .setColor(0)
            .fillRect(266, 228, 267, 230)
            .fillRect(266, 235, 267, 237)
            .setColor(3));
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
        '' !== effectStr &&
          Pip.renderBlock(210, 248, 252, 'EFFECTS', effectStr),
        imgs.seek(item.io));
      try {
        const img = imgs.read(item.il);
        h.drawImage(img, 340, 114, { rotate: 0 });
      } catch (e) {
        debug(`Error drawing image for Apparel item: ${e}`);
      }
    },
    onClick: (n) => {
      const v = vAt(n),
        it = inv.get(v.realN),
        item = db.getId(it.id);
      if (null == item.es) return;
      const cndAware = cndMode();
      // The remainder row (part=1) shares the same (id, cnd) as the equipped
      // row but must never unequip — clicking it should equip that copy.
      const isUnequip =
        v.part !== 1 &&
        active[item.es] === it.id &&
        (!cndAware || activeCnd[item.es] === it.cnd);
      Pip.audioStart(isUnequip ? '/SOUND/FX/APP/U.WAV' : '/SOUND/FX/APP/E.WAV');
      if (isUnequip) {
        active[item.es] = void 0;
        activeCnd[item.es] = 0;
        setTimeout(function () {
          console.log('PIPSYNC:UNEQUIP:APPAREL:' + Pip.formatId(it.id));
        }, 0);
      } else {
        const prevId = active[item.es];
        active[item.es] = it.id;
        activeCnd[item.es] = it.cnd;
        setTimeout(function () {
          if (prevId != null && prevId !== it.id) {
            console.log('PIPSYNC:UNEQUIP:APPAREL:' + Pip.formatId(prevId));
          }
          console.log('PIPSYNC:EQUIP:APPAREL:' + Pip.formatId(it.id) + ':' + it.cnd);
        }, 0);
      }
      player.setav('equippedApparel', active, !0, !0);
      player.setav('equippedApparelCnd', activeCnd, !1);
      virt = buildVirt();
      scroller.updateItemCount(virt.length);
      updateDtDr();
    },
    onLongClick: (n) => {
      const realN = vAt(n).realN,
        it = inv.get(realN);
      if (cmode) {
        Pip.companionDropItem('APPAREL', inv, realN, it);
        return;
      }
      (Pip.playSound('TAB'),
        setTimeout(
          () =>
            Pip.changeMenu('ADDITEM.JS', {
              caller: 'APPAREL.JS',
              dbFile: `DATA/${NV ? 'NV' : 'F3'}/APPAREL.DAT`,
              invFile: `INV/${NV ? 'NV' : 'F3'}/APPAREL.INV`,
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
    else if (action === 'refresh') {
      virt = buildVirt();
      scroller.updateItemCount(virt.length);
      scroller.render(arg);
    } else if (action === 'refreshEquip') {
      active = normalizeActive(player.getav('equippedApparel'));
      activeCnd = readActiveCnd();
      virt = buildVirt();
      scroller.updateItemCount(virt.length);
      scroller.render({ listOnly: !1 });
      updateDtDr();
    }
  };
  Pip.onExclusive('scroller', onScroller);
  Pip.inv = inv;
  return (
    (inv.onLoaded = (i) => {
      (virt = buildVirt(), scroller.updateItemCount(virt.length), scroller.render());
    }),
    {
      id: 'APPAREL',
      remove: () => {
        (Pip.removeListener('scroller', onScroller),
          delete Pip.inv,
          scroller.remove(),
          player.sync(),
          inv.sync(),
          imgs.close(),
          db.close());
      }
    }
  );
});
