(function (params) {
  params || (params = {});
  const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/APPAREL.DAT`),
    inv = new InvFile(`INV/${NV ? 'NV' : 'F3'}/APPAREL.INV`, {
      idOrder: db.ids
    }),
    imgs = E.openFile(`DATA/${NV ? 'NV' : 'F3'}/APPAREL.IMG`, 'r');
  let active = player.getav('equippedApparel') || new Uint32Array(4);
  const scroller = Pip.createScroller({
    hasEquipStates: !0,
    itemCount: inv.count,
    scrollStart: params.scrollTo ? inv.indexOf(params.scrollTo) : 0,
    getItem: (n) => {
      const it = inv.get(n),
        item = db.getId(it.id),
        active = player.getav('equippedApparel') || new Uint32Array(4);
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
      null != item.es &&
        (active[item.es] === it.id
          ? ((active[item.es] = void 0),
            Pip.audioStart('/SOUND/FX/APP/U.WAV'),
            console.log('PIPSYNC:UNEQUIP:APPAREL:' + Pip.formatId(it.id)))
          : (() => {
              const prevId = active[item.es];
              active[item.es] = it.id;
              Pip.audioStart('/SOUND/FX/APP/E.WAV');
              if (prevId != null && prevId !== it.id) {
                console.log('PIPSYNC:UNEQUIP:APPAREL:' + Pip.formatId(prevId));
              }
              console.log('PIPSYNC:EQUIP:APPAREL:' + Pip.formatId(it.id));
            })(),
        player.setav('equippedApparel', active, !0),
        scroller.updateItemCount(inv.count),
        NV
          ? (function () {
              const newDT = active.reduce(function (dt, apparelId) {
                const item = db.getId(apparelId);
                return item.dt ? (dt += item.dt) : dt;
              }, 0);
              (player.setav('dt', newDT), Pip.renderHeader());
            })()
          : (function () {
              const newDR = active.reduce(function (dr, apparelId) {
                const item = db.getId(apparelId);
                return item.dr ? (dr += item.dr) : dr;
              }, 0);
              (player.setav('dr', newDR), Pip.renderHeader());
            })());
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
  (Pip.inv = inv), Pip.bindScrollerEvents(scroller, inv);
  return (
    (inv.onLoaded = (i) => {
      (scroller.updateItemCount(i.count), scroller.render());
    }),
    {
      id: 'APPAREL',
      remove: () => {
        (Pip.unbindScrollerEvents(), delete Pip.inv, scroller.remove(),
          player.sync(),
          inv.sync(),
          imgs.close(),
          db.close());
      }
    }
  );
});
