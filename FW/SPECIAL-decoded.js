(function () {
  const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/SPECIAL.DAT`),
    imgs = E.openFile(`DATA/${NV ? 'NV' : 'F3'}/SPECIAL.IMG`, 'r'),
    avs = [
      'strength',
      'perception',
      'endurance',
      'charisma',
      'intelligence',
      'agility',
      'luck'
    ],
    scroller = Pip.createScroller({
      width: 145,
      itemCount: db.ids.length,
      getItem: (n) => {
        const dat = db.getId(db.ids[n]);
        return ((dat.rtxt = player.getav(avs[n]) || 1), dat);
      },
      render: (item) => {
        imgs.seek(item.io);
        const img = imgs.read(item.il);
        Pip.renderBlock(190, 193, 275, '', '');
        const txt = h
          .setFont('Monofonto14')
          .wrapString(item.desc, 260)
          .join('\n');
        h.setFontAlign(-1, -1)
          .setClipRect(190, 50, 460, 275)
          .drawString(txt, 190, 198)
          .drawImage(img, 340, 114, { rotate: 0 })
          .setClipRect(0, 0, 480, 320);
      }
    });
  let headerRenderTimer;
  function onKnob2(dir) {
    if (typeof cmode !== 'undefined' && cmode) return;
    const av = avs[scroller.selectedIndex],
      currentVal = player.getav(av),
      newVal = E.clip(currentVal + dir, 1, 10);
    currentVal != newVal &&
      (player.setav(av, newVal, !0),
      scroller.render(),
      headerRenderTimer && clearTimeout(headerRenderTimer),
      (headerRenderTimer = setTimeout(() => {
        ((headerRenderTimer = void 0), Pip.renderHeader());
      }, 500)),
      Pip.playSound('HIGHLIGHT'));
  }
  function onSpecialSync() {
    scroller.invalidateCache();
    scroller.render();
  }
  return (
    Pip.onExclusive('knob2', onKnob2),
    Pip.on('special', onSpecialSync),
    {
      id: 'SPECIAL',
      remove: () => {
        (scroller.remove(),
          Pip.removeListener('knob2', onKnob2),
          Pip.removeListener('special', onSpecialSync),
          player.sync(),
          imgs.close(),
          db.close());
      }
    }
  );
});
