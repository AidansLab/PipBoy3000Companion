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
  let active = player.getav('equippedWeap');
  const scroller = Pip.createScroller({
    hasEquipStates: !0,
    itemCount: inv.count,
    scrollStart: params.scrollTo ? inv.indexOf(params.scrollTo) : 0,
    getItem: (n) => {
      const it = inv.get(n),
        item = db.getId(it.id),
        equipped = player.getav('equippedWeap');
      if (
        (it.id === equipped && (item.activ = !0),
        (item.cnd = it.cnd),
        it.cnt > 1 && (item.txt = `${item.txt} (${it.cnt})`),
        item.ammo)
      ) {
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
        Pip.renderBlock(382, 192, 80, 'VAL', item.val || '--'),
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
      const it = inv.get(n),
        item = db.getId(it.id);
      (active === it.id
        ? ((active = void 0),
          item.fxu && Pip.audioStart(`SOUND/FX/WPN/${item.fxu}.WAV`),
          console.log('PIPSYNC:UNEQUIP:WEAPONS:' + Pip.formatId(it.id)))
        : (() => {
            const prevId = active;
            active = it.id;
            item.fxe && Pip.audioStart(`SOUND/FX/WPN/${item.fxe}.WAV`);
            if (prevId != null && prevId !== it.id) {
              console.log('PIPSYNC:UNEQUIP:WEAPONS:' + Pip.formatId(prevId));
            }
            console.log('PIPSYNC:EQUIP:WEAPONS:' + Pip.formatId(it.id));
          })(),
        player.setav('equippedWeap', active, !0),
        scroller.updateItemCount(inv.count));
    },
    onLongClick: (n) => {
      if (typeof cmode !== 'undefined' && cmode) return;
      const it = inv.get(n);
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
  (Pip.inv = inv), Pip.bindScrollerEvents(scroller, inv);
  return {
    id: 'WEAPONS',
    remove: () => {
      (delete Pip.inv, delete Pip.scroller, scroller.remove(), inv.sync(), db.close(), ammoDb.close(), imgs.close());
    }
  };
});
