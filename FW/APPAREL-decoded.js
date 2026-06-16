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
  const scroller = Pip.createScroller({
    hasEquipStates: !0,
    itemCount: inv.count,
    scrollStart: params.scrollTo ? inv.indexOf(params.scrollTo) : 0,
    getItem: (n) => {
      const it = inv.get(n),
        item = db.getId(it.id);
      return (
        active[item.es] == it.id && (item.activ = !0),
        (item.cnd = it.cnd),
        it.cnt > 1 && (item.txt = `${item.txt} (${it.cnt})`),
        item
      );
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
        Pip.renderBlock(382, 192, 80, 'VAL', item.val || '--'),
        Pip.renderBlock(210, 220, 80, 'CND', ''),
        h.fillRect(244, 228, 244 + ((item.cnd || 100) / 100) * 40, 237),
        NV &&
          h
            .setColor(0)
            .fillRect(277, 228, 278, 230)
            .fillRect(277, 235, 278, 237)
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
      const img = imgs.read(item.il);
      h.drawImage(img, 340, 114, { rotate: 0 });
    },
    onClick: (n) => {
      const it = inv.get(n),
        item = db.getId(it.id);
      if (null == item.es) return;
      const isUnequip = active[item.es] === it.id;
      Pip.audioStart(isUnequip ? '/SOUND/FX/APP/U.WAV' : '/SOUND/FX/APP/E.WAV');
      if (isUnequip) {
        active[item.es] = void 0;
        setTimeout(function () {
          console.log('PIPSYNC:UNEQUIP:APPAREL:' + Pip.formatId(it.id));
        }, 0);
      } else {
        const prevId = active[item.es];
        active[item.es] = it.id;
        setTimeout(function () {
          if (prevId != null && prevId !== it.id) {
            console.log('PIPSYNC:UNEQUIP:APPAREL:' + Pip.formatId(prevId));
          }
          console.log('PIPSYNC:EQUIP:APPAREL:' + Pip.formatId(it.id));
        }, 0);
      }
      player.setav('equippedApparel', active, !0, !0);
      scroller.updateItemCount(inv.count);
      updateDtDr();
    },
    onLongClick: (n) => {
      if (typeof cmode !== 'undefined' && cmode) return;
      const it = inv.get(n);
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
    if (action === 'count') scroller.updateItemCount(arg !== void 0 ? arg : inv.count);
    else if (action === 'render') scroller.render(arg);
    else if (action === 'refresh') {
      scroller.updateItemCount(inv.count);
      scroller.render(arg);
    } else if (action === 'refreshEquip') {
      scroller.updateItemCount(inv.count);
      scroller.render({ listOnly: !1 });
      active = normalizeActive(player.getav('equippedApparel'));
      updateDtDr();
    }
  };
  Pip.onExclusive('scroller', onScroller);
  Pip.inv = inv;
  return (
    (inv.onLoaded = (i) => {
      (scroller.updateItemCount(i.count), scroller.render());
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
