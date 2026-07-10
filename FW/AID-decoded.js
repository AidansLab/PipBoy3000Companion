(function (params) {
  params || (params = {});
  // Bleak Venom (vanilla FNV) shows its own in-game Yes/No confirmation on
  // use, which can be declined — using it from the Pip-Boy has no way to
  // know that answer, so the device would show it consumed regardless.
  // Blocked outright while connected; only reachable via the game's own
  // inventory menu, where the real dialog and its answer are unambiguous.
  const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/AID.DAT`),
    inv = new InvFile(`INV/${NV ? 'NV' : 'F3'}/AID.INV`, { idOrder: db.ids }),
    imgs = E.openFile(`DATA/${NV ? 'NV' : 'F3'}/AID.IMG`, 'r'),
    clampScrollerSelection = (count) => {
      if (count <= 0) return;
      const maxIdx = count - 1;
      if (scroller.selectedIndex > maxIdx) {
        scroller.selectedIndex = maxIdx;
        scroller.scrollIndex = Math.min(scroller.scrollIndex, maxIdx);
        scroller.scrollY = 0;
      }
    },
    scroller = Pip.createScroller({
      hasEquipStates: !0,
      itemCount: inv.count,
      scrollStart: params.scrollTo ? inv.indexOf(params.scrollTo) : 0,
      getItem: (n) => {
        const it = inv.get(n);
        if (!it) return { txt: '' };
        const item = db.getId(it.id);
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
        try {
          const img = imgs.read(item.il);
          h.drawImage(img, 340, 116, { rotate: 0 });
        } catch (e) {
          debug(`Error drawing image for Aid item: ${e}`);
        }
      },
      onClick: (n) => {
        const it = inv.get(n);
        if (!it) return;
        const item = db.getId(it.id);
        // When connected to the game, prevent consuming items that can have no
        // effect in their current state, mirroring the game's own block logic.
        if (cmode) {
          // Bleak Venom: in-game only — see the comment at the top of this file.
          if (it.id === 0x001613d0) return;
          // HP-restoring items (stimpaks, food…) are blocked when HP is full.
          const curHp = player.getav('hp');
          if (curHp !== undefined) {
            const info = player.getinfo();
            if (info.maxHP > 0 && curHp >= info.maxHP &&
                item.ef && item.ef.some(e => e.indexOf('HP') >= 0)) {
              return;
            }
          }
          // Limb-fixing items (Doctor's Bag) are blocked when no limb is
          // crippled (condition == 0).
          if (item.ef && item.ef.some(e => /cripple|limb/i.test(e))) {
            const limbAvs = [
              'leftattackcondition', 'rightattackcondition',
              'leftmobilitycondition', 'rightmobilitycondition',
              'perceptioncondition', 'endurancecondition'
            ];
            const anyCrippled = limbAvs.some(av => {
              const v = player.getav(av);
              return v !== undefined && v <= 0;
            });
            if (!anyCrippled) return;
          }
          // Weapon Repair Kits are blocked when nothing is equipped or the
          // equipped weapon is already at full condition (mirrors in-game use).
          const isWeaponRepairKit =
            (item.txt && /weapon repair kit/i.test(item.txt)) ||
            (item.ef && item.ef.some((e) =>
              /weapon/i.test(e) &&
              /cnd|condition|repair/i.test(e) &&
              !/limb|cripple/i.test(e)
            ));
          if (isWeaponRepairKit) {
            const eq = player.getav('equippedWeap');
            if (eq === undefined || !eq) return;
            const eqCnd = player.getav('equippedWeapCnd');
            if (eqCnd !== undefined && eqCnd >= 99) return;
          }
        }
        // Notify the companion app (if listening on USB) that this item was
        // consumed, so it can mirror the action in-game.
        console.log('PIPSYNC:USE:AID:' + Pip.formatId(it.id));
        if ((it.cnt--, it.cnt > 0 ? inv.set(n, it) : inv.remove(n), item.wt))
          try {
            const wt = parseFloat(item.wt);
            player.player.invWt[`INV/${NV ? 'NV' : 'F3'}/AID.INV`] -= wt;
          } catch (e) {}
        if (
          ((player.modified = !0),
          item.fx && Pip.audioStart(`SOUND/FX/AID/${item.fx}.WAV`),
          item.ef)
        ) {
          const hpRestore = /^HP \+(\d+)/;
          item.ef.forEach((e) => {
            const m = e.match(hpRestore);
            if (m) {
              debug(`AID: Used "${item.txt}" to restore ${e}`);
              try {
                player.heal(parseInt(m[1]));
              } catch (e2) {
                Pip.log(`heal failed for ${it.id}: ${e}: ${e2}`);
              }
            }
          });
        }
        (item.efd > 0 &&
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
        const it = inv.get(n);
        if (cmode) {
          Pip.companionDropItem('AID', inv, n, it);
          return;
        }
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
  const onScroller = (action, arg) => {
    if (action === 'count') scroller.updateItemCount(arg !== void 0 ? arg : inv.count);
    else if (action === 'render') scroller.render(arg);
    else if (action === 'refresh') {
      scroller.updateItemCount(inv.count);
      scroller.render(arg);
    }
  };
  Pip.onExclusive('scroller', onScroller);
  Pip.inv = inv;
  return (
    (inv.onLoaded = (i) => {
      (scroller.updateItemCount(i.count),
        i.count > 0 && (clampScrollerSelection(i.count), scroller.render()));
    }),
    {
      id: 'AID',
      remove: () => {
        (Pip.removeListener('scroller', onScroller),
          delete Pip.inv,
          scroller.remove(),
          inv.sync(),
          db.close(),
          imgs.close());
      }
    }
  );
});
