(function () {
  const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/SKILLS.DAT`),
    inv = new InvFile(`INV/${NV ? 'NV' : 'F3'}/SKILLS.INV`, { idOrder: db.ids }),
    imgs = E.openFile(`DATA/${NV ? 'NV' : 'F3'}/SKILLS.IMG`, 'r');
  let descScroll, editIndex, editItem, editMode = !1;
  const scroller = Pip.createScroller({
    width: 165,
    itemCount: db.ids.length,
    getItem: (n) => {
      const item = db.getId(db.ids[n]),
        it = editIndex == n ? editItem : inv.get(inv.indexOf(db.ids[n]));
      return ((item.rtxt = it && it.cnt > 0 ? it.cnt : '--'), item);
    },
    render: (item) => {
      (imgs.seek(item.io),
        Pip.renderBlock(220, 193, 245, '', ''),
        h.setFontAlign(-1, -1).setClipRect(220, 50, 460, 190));
      try {
        h.drawImage(imgs.read(item.il), 340, editMode ? 124 : 114, { rotate: 0 });
      } catch (e) {
        debug(`Error drawing image for Skills item: ${e}`);
      }
      (h.setClipRect(0, 0, 480, 320),
        descScroll && descScroll.remove(),
        editMode
          ? h
              .setFontAlign(-1, -1)
              .drawString(
                'Adjust your skill levels by locating a\nskill in the list and turning the top\nscroll wheel to adjust level.',
                220,
                198
              )
          : (descScroll = Pip.renderTextOverflow(item.desc, 465, 198, 245, 80)),
        editMode &&
          (h
            .clearRect(220, 45, 463, 50)
            .drawImage(icons.fadedown, 463, 47)
            .drawLine(220, 47, 462, 47),
          h.setFontAlign(-1, -1).drawString('EDIT SKILLS', 220, 51, !0)));
    },
    onLongClick: () => {
      if (cmode) return;
      (Pip.playSound('TAB'),
        (editMode = !editMode),
        editMode
          ? Pip.onExclusive('knob2', onKnob2)
          : Pip.removeListener('knob2', onKnob2),
        scroller.render());
    },
    onClick: () => {
      editMode &&
        (Pip.playSound('TAB'),
        (editMode = !1),
        Pip.removeListener('knob2', onKnob2),
        scroller.render());
    }
  });
  function onKnob2(dir) {
    const id = db.ids[scroller.selectedIndex],
      inx = inv.indexOf(id);
    let it;
    if (inx < 0 && dir > 0) ((it = { id: id, cnt: 1 }), inv.add(it));
    else {
      if (inx < 0) return;
      if (((it = inv.get(inx)), it)) {
        const next = E.clip(it.cnt + dir, 0, 100);
        if (0 === next) (inv.remove(inx), (it = void 0));
        else {
          if (it.cnt === next) return;
          ((it.cnt = next), inv.set(inx, it));
        }
      }
    }
    ((editIndex = scroller.selectedIndex),
      (editItem = it),
      scroller.render({ justItem: scroller.selectedIndex }),
      Pip.playSound('HIGHLIGHT'));
  }
  // Companion-driven level sync (boot0.js syncskills patching Pip.inv while
  // this menu is open). itemCount never changes for SKILLS (always the full
  // DAT catalog), so a refresh only ever needs to re-render.
  const onScroller = (action, arg) => {
    if (action === 'render' || action === 'refresh') scroller.render(arg);
  };
  Pip.onExclusive('scroller', onScroller);
  Pip.inv = inv;
  return {
    id: 'SKILLS',
    remove: () => {
      (Pip.removeListener('knob2', onKnob2),
        Pip.removeListener('scroller', onScroller),
        delete Pip.inv,
        scroller.remove(),
        descScroll && descScroll.remove(),
        imgs.close(),
        db.close(),
        inv.sync());
    }
  };
});
