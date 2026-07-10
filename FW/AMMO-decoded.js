(function (params) {
  params || (params = {});
  const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/AMMO.DAT`),
    inv = new InvFile(`INV/${NV ? 'NV' : 'F3'}/AMMO.INV`, { idOrder: db.ids }),
    imgs = E.openFile(`DATA/${NV ? 'NV' : 'F3'}/AMMO.IMG`, 'r');
  // Ammo selection (companion mode only): the game tells us which ammo the
  // equipped weapon can use (ammoUsable) and which is loaded right now
  // (ammoActive). We mark the active one, dim the ones the weapon can't use,
  // and only let usable ammo be selected.
  const isCmode = () => cmode;
  let active = player.getav('ammoActive'),
    usable = player.getav('ammoUsable') || [];
  const getEquippedWeap = () => player.getav('equippedweap') || 0;
  // Match in-game: no weapon, grenade, or melee → all ammo greyed out. Only a
  // gun with a non-empty ammoUsable list allows selecting matching ammo types.
  const isUsable = (id) => {
    if (!isCmode()) return !0;
    const eq = getEquippedWeap();
    if (!eq || !usable.length) return !1;
    return usable.indexOf(id) >= 0;
  };
  const shouldDimAmmo = (id) => isCmode() && !isUsable(id);
  const scroller = Pip.createScroller({
    hasEquipStates: !0,
    itemCount: inv.count,
    scrollStart: params.scrollTo ? inv.indexOf(params.scrollTo) : 0,
    getItem: (n) => {
      const it = inv.get(n),
        item = db.getId(it.id);
      (it.cnt > 1 && (item.txt = `${item.txt} (${it.cnt})`),
        isCmode() &&
          (active != null && it.id === active && (item.activ = !0),
          shouldDimAmmo(it.id) && (item.dim = !0)));
      return item;
    },
    width: 185,
    render: (item) => {
      (Pip.renderBlock(296, 192, 80, 'WG', item.wt || '--'),
        Pip.renderBlock(382, 192, 80, 'VAL', item.val || '--'),
        imgs.seek(item.io));
      try {
        const img = imgs.read(item.il);
        h.drawImage(img, 340, 114, { rotate: 0 });
      } catch (e) {
        debug(`Error drawing image for Ammo item: ${e}`);
      }
    },
    onClick: (n) => {
      if (!isCmode()) return;
      const it = inv.get(n);
      if (!it) return;
      if (it.id === active) return;
      if (!isUsable(it.id)) {
        Pip.playSound('SCROLL');
        return;
      }
      ((active = it.id),
        player.setav('ammoActive', it.id, !1),
        Pip.playSound('TAB'),
        // Clear the scroller's row cache so the previously-active row's filled
        // box is redrawn empty immediately. Without this only the selected row's
        // cache is refreshed, leaving the old ammo showing a square until the
        // game snapshot round-trips (~500ms later).
        scroller.updateItemCount(inv.count),
        console.log('PIPSYNC:EQUIP:AMMO:' + Pip.formatId(it.id)));
    },
    onLongClick: (n) => {
      const it = inv.get(n);
      if (isCmode()) {
        Pip.companionDropItem('AMMO', inv, n, it);
        return;
      }
      (Pip.playSound('TAB'),
        setTimeout(
          () =>
            Pip.changeMenu('ADDITEM.JS', {
              caller: 'AMMO.JS',
              dbFile: `DATA/${NV ? 'NV' : 'F3'}/AMMO.DAT`,
              invFile: `INV/${NV ? 'NV' : 'F3'}/AMMO.INV`,
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
      active = player.getav('ammoActive');
      usable = player.getav('ammoUsable') || [];
      scroller.updateItemCount(inv.count);
      scroller.render({ listOnly: !1 });
    }
  };
  Pip.onExclusive('scroller', onScroller);
  Pip.inv = inv;
  return (
    (inv.onLoaded = (i) => {
      (scroller.updateItemCount(i.count), scroller.render());
    }),
    {
      id: 'AMMO',
      remove: () => {
        (Pip.removeListener('scroller', onScroller),
          delete Pip.inv,
          scroller.remove(),
          inv.sync(),
          imgs.close(),
          db.close());
      }
    }
  );
});
