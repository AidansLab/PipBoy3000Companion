(function (params) {
  params || (params = {});
  const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/AMMO.DAT`),
    inv = new InvFile(`INV/${NV ? 'NV' : 'F3'}/AMMO.INV`, { idOrder: db.ids }),
    imgs = E.openFile(`DATA/${NV ? 'NV' : 'F3'}/AMMO.IMG`, 'r'),
    scroller = Pip.createScroller({
      itemCount: inv.count,
      scrollStart: params.scrollTo ? inv.indexOf(params.scrollTo) : 0,
      getItem: (n) => {
        const it = inv.get(n),
          item = db.getId(it.id);
        return (it.cnt > 1 && (item.txt = `${item.txt} (${it.cnt})`), item);
      },
      width: 185,
      render: (item) => {
        (Pip.renderBlock(296, 192, 80, 'WG', item.wt || '--'),
          Pip.renderBlock(382, 192, 80, 'VAL', item.val || '--'),
          imgs.seek(item.io));
        const img = imgs.read(item.il);
        h.drawImage(img, 340, 114, { rotate: 0 });
      },
      onLongClick: (n) => {
        if (typeof cmode !== 'undefined' && cmode) return;
        const it = inv.get(n);
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
  (Pip.inv = inv), Pip.bindScrollerEvents(scroller, inv);
  return (
    (inv.onLoaded = (i) => {
      (scroller.updateItemCount(i.count), scroller.render());
    }),
    {
      id: 'AMMO',
      remove: () => {
        (Pip.unbindScrollerEvents(), delete Pip.inv, scroller.remove(), inv.sync(), imgs.close(), db.close());
      }
    }
  );
});
