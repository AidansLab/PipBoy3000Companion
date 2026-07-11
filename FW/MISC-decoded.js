(function (params) {
  params || (params = {});
  const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/MISC.DAT`),
    inv = new InvFile(`INV/${NV ? 'NV' : 'F3'}/MISC.INV`, { idOrder: db.ids }),
    imgs = E.openFile(`DATA/${NV ? 'NV' : 'F3'}/MISC.IMG`, 'r');
  let apps = [];
  try {
    fs.readdirSync('APPINFO').forEach((f) => {
      if (f.toLowerCase().endsWith('.info'))
        try {
          let j = JSON.parse(fs.readFileSync('APPINFO/' + f));
          apps.push({ txt: j.name, exec: j.src, img: j.icon });
        } catch (e) {
          print(`Unable to load APPINFO/${f}: ${e}`);
        }
    });
  } catch {}
  let appn = apps.length;
  const scroller = Pip.createScroller({
    itemCount: appn + inv.count,
    scrollStart: params.scrollTo ? inv.indexOf(params.scrollTo) : 0,
    getItem: (n) => {
      if (n < appn) return apps[n];
      const it = inv.get(n - appn),
        item = db.getId(it.id);
      return (it.cnt > 1 && (item.txt = `${item.txt} (${it.cnt})`), item);
    },
    width: 185,
    render: (item) => {
      let img;
      (Pip.renderBlock(296, 192, 80, 'WG', item.wt || '--'),
        Pip.renderBlock(382, 192, 80, 'VAL', item.val || '--'));
      try {
        (item.il
          ? (imgs.seek(item.io), (img = imgs.read(item.il)))
          : item.img && (img = fs.readFileSync(item.img)),
          img && h.drawImage(img, 340, 114, { rotate: 0 }));
      } catch (e) {
        debug(`Error drawing image for Misc item: ${e}`);
      }
    },
    onClick: (n) => {
      const item = n < appn ? apps[n] : db.getId(inv.get(n - appn).id);
      // Launched via boot0's Pip.launchApp (not inline here) so the pending
      // callback doesn't keep this whole menu's closure (db/inv/imgs/apps/
      // scroller) reachable while the holotape's own script is evaluated -
      // see the comment on Pip.launchApp for why that matters.
      item.exec && Pip.launchApp(item.exec);
    },
    onLongClick: (n) => {
      const it = n < appn ? void 0 : inv.get(n - appn);
      if (cmode) {
        // App rows (holotapes) aren't inventory items - nothing to drop.
        if (n < appn) return;
        Pip.companionDropItem('MISC', inv, n - appn, it);
        return;
      }
      (Pip.playSound('TAB'),
        setTimeout(
          () =>
            Pip.changeMenu('ADDITEM.JS', {
              caller: 'MISC.JS',
              dbFile: `DATA/${NV ? 'NV' : 'F3'}/MISC.DAT`,
              invFile: `INV/${NV ? 'NV' : 'F3'}/MISC.INV`,
              scrollTo: it ? it.id : void 0
            }),
          0
        ));
    }
  });
  const itemCount = (c) => appn + (c !== void 0 ? c : inv.count);
  const onScroller = (action, arg) => {
    if (action === 'count') scroller.updateItemCount(itemCount(arg));
    else if (action === 'render') scroller.render(arg);
    else if (action === 'refresh') {
      scroller.updateItemCount(itemCount());
      scroller.render(arg);
    }
  };
  Pip.onExclusive('scroller', onScroller);
  Pip.inv = inv;
  return (
    (inv.onLoaded = (i) => {
      (scroller.updateItemCount(itemCount(i.count)), scroller.render());
    }),
    {
      id: 'MISC',
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
