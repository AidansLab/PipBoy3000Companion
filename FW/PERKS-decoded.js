(function () {
  const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/PERKS.DAT`),
    inv = new InvFile(`INV/${NV ? 'NV' : 'F3'}/PERKS.INV`, { idOrder: db.ids }),
    imgs = E.openFile(`DATA/${NV ? 'NV' : 'F3'}/PERKS.IMG`, 'r');
  let descScroll, active, editIndex, editItem, owned = !0;
  function itemCount(c) {
    return c !== void 0 ? c : inv.count;
  }
  function buildOwnedScroller(scrollToId) {
    Pip.removeListener('knob2', onKnob2);
    active && active.remove();
    return Pip.createScroller({
      width: 220,
      itemCount: inv.count,
      scrollStart: scrollToId
        ? inv.indexOf('number' == typeof scrollToId ? scrollToId.toString() : 0)
        : 0,
      getItem: (n) => {
        const it = inv.get(n),
          item = db.getId(it.id);
        return (it.cnt > 1 && (item.txt = `${item.txt} (${it.cnt})`), item);
      },
      render: (item) => {
        (descScroll && descScroll.remove(),
          (descScroll = Pip.renderTextOverflow(item.desc, 465, 198, 210, 80)),
          Pip.renderBlock(255, 193, 210, '', ''),
          imgs.seek(item.io),
          h.setFontAlign(-1, -1).setClipRect(255, 45, 460, 191));
        try {
          h.drawImage(imgs.read(item.il), 359, 114, { rotate: 0 });
        } catch (e) {
          debug(`Error drawing image for Perks item: ${e}`);
        }
        h.setClipRect(0, 0, 480, 320);
      },
      onLongClick: (n) => {
        if (cmode) return;
        (Pip.playSound('TAB'), h.clearRect(BR));
        const it = inv.get(n);
        owned = !1;
        active = buildEditScroller(it ? it.id : 0);
      }
    });
  }
  function buildEditScroller(scrollToId) {
    active && active.remove();
    descScroll && descScroll.remove();
    Pip.onExclusive('knob2', onKnob2);
    return Pip.createScroller({
      width: 220,
      itemCount: db.ids.length,
      scrollStart: scrollToId ? db.ids.indexOf(scrollToId) : 0,
      getItem: (n) => {
        const item = db.getId(db.ids[n]),
          it = editIndex == n ? editItem : inv.get(inv.indexOf(db.ids[n]));
        return ((item.rtxt = it ? it.cnt : '--'), item);
      },
      render: (item) => {
        (Pip.renderBlock(255, 193, 210, '', ''),
          h
            .setFontAlign(-1, -1)
            .drawString(
              'Adjust your perks by locating a\nperk in the list and turning the\ntop scroll wheel to adjust perk\nranks.',
              255,
              198
            )
            .clearRect(255, 45, 463, 50)
            .drawImage(icons.fadedown, 463, 47)
            .drawLine(255, 47, 462, 47)
            .drawString('ADD/REMOVE PERKS', 255, 51, !0),
          h.setFontAlign(-1, -1).setClipRect(255, 45, 460, 191),
          imgs.seek(item.io));
        try {
          h.drawImage(imgs.read(item.il), 359, 124, { rotate: 0 });
        } catch (e) {
          debug(`Error drawing image for Perks item: ${e}`);
        }
        h.setClipRect(0, 0, 480, 320);
      },
      onLongClick: (n) => {
        (inv.sync(),
          Pip.playSound('TAB'),
          h.clearRect(BR),
          (owned = !0),
          (active = buildOwnedScroller(db.ids[n])));
      }
    });
  }
  function onKnob2(dir) {
    const id = db.ids[active.selectedIndex],
      inx = inv.indexOf(id),
      item = db.getId(id);
    let it;
    if (inx < 0 && dir > 0) ((it = { id: id, cnt: 1, cnd: 100, fl: 0 }), inv.add(it));
    else {
      if (inx < 0) return;
      if (((it = inv.get(inx)), it)) {
        const next = E.clip(it.cnt + dir, 0, item.rks);
        if (0 === next) (inv.remove(inx), (it = void 0));
        else {
          if (it.cnt === next) return;
          ((it.cnt = next), inv.set(inx, it));
        }
      }
    }
    ((editIndex = active.selectedIndex),
      (editItem = it),
      active.render({ justItem: active.selectedIndex }),
      Pip.playSound('HIGHLIGHT'));
  }
  // Companion-driven rank sync (boot0.js addperk/removeperk patching Pip.inv
  // while this menu is open). Entering edit mode is blocked while cmode is
  // active (see buildOwnedScroller), so a sync event only ever needs to
  // refresh the owned-perks list.
  const onScroller = (action, arg) => {
    if (!owned) return;
    if (action === 'count') active.updateItemCount(itemCount(arg));
    else if (action === 'render') active.render(arg);
    else if (action === 'refresh') {
      active.updateItemCount(itemCount());
      active.render(arg);
    }
  };
  Pip.onExclusive('scroller', onScroller);
  Pip.inv = inv;
  return (
    (active = buildOwnedScroller()),
    (inv.onLoaded = (i) => {
      active && (active.updateItemCount(i.count), active.render());
    }),
    {
      id: 'PERKS',
      remove: () => {
        (active.remove(),
          descScroll && descScroll.remove(),
          Pip.removeListener('knob2', onKnob2),
          Pip.removeListener('scroller', onScroller),
          delete Pip.inv,
          imgs.close(),
          db.close(),
          inv.sync());
      }
    }
  );
});
