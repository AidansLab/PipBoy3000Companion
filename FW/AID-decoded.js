(function (params) {
  params || (params = {});
  const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/AID.DAT`),
    inv = new InvFile(`INV/${NV ? 'NV' : 'F3'}/AID.INV`, { idOrder: db.ids }),
    imgs = E.openFile(`DATA/${NV ? 'NV' : 'F3'}/AID.IMG`, 'r'),
    scroller = Pip.createScroller({
      hasEquipStates: !0,
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
          Pip.renderBlock(382, 192, 80, 'VAL', item.val || '--'));
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
        (h.clearRect(210, 220, 460, 245),
          '' !== effectStr &&
            Pip.renderBlock(210, 220, 252, 'EFFECTS', effectStr),
          imgs.seek(item.io));
        const img = imgs.read(item.il);
        h.drawImage(img, 340, 116, { rotate: 0 });
      },
      onClick: (n) => {
        const it = inv.get(n),
          item = db.getId(it.id);
        // Notify the companion app (if listening on USB) that this item was
        // consumed, so it can mirror the action in-game.
        console.log('PIPSYNC:USE:AID:' + Pip.formatId(it.id));
        if ((it.cnt--, it.cnt > 0 ? inv.set(n, it) : inv.remove(n), item.wt))
          try {
            const wt = parseFloat(item.wt);
            player.player.invWt[`INV/${NV ? 'NV' : 'F3'}/AID.INV`] -= wt;
          } catch (e) {}
        ((player.modified = !0),
          item.fx && Pip.audioStart(`SOUND/FX/AID/${item.fx}.WAV`),
          item.efd > 0 &&
            (player.effects || (player.effects = {}),
            (player.effects[it.id] = {
              txt: item.eft || item.txt,
              ef: item.ef,
              d: item.efd
            }),
            debug(`EFFECTS: ${item.txt} added (${item.efd}s)`),
            setTimeout(
              function (N) {
                (delete player.effects[N],
                  debug(`EFFECTS: ${item.txt} expired`),
                  player.emit('effects'));
              },
              1000 * item.efd,
              it.id
            )),
          Pip.renderHeader());
      },
      onLongClick: (n) => {
        if (typeof cmode !== 'undefined' && cmode) return;
        const it = inv.get(n);
        (Pip.playSound('TAB'),
          setTimeout(
            () =>
              Pip.changeMenu('ADDITEM.JS', {
                caller: 'AID.JS',
                dbFile: `DATA/${NV ? 'NV' : 'F3'}/AID.DAT`,
                invFile: `INV/${NV ? 'NV' : 'F3'}/AID.INV`,
                scrollTo: it ? it.id : void 0
              }),
            0
          ));
      }
    });
  (Pip.inv = inv), (Pip.scroller = scroller);
  return (
    (inv.onLoaded = (i) => {
      (scroller.updateItemCount(i.count), scroller.render());
    }),
    {
      id: 'AID',
      remove: () => {
        (delete Pip.inv, delete Pip.scroller, scroller.remove(), inv.sync(), db.close(), imgs.close());
      }
    }
  );
});
