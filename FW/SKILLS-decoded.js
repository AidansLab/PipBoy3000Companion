(function () {
  const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/SKILLS.DAT`),
    uSkil = loadJSONWithDefaults(
      `SETTINGS/${NV ? 'NV' : 'F3'}_SKILLS.JSON`,
      `SETTINGS/DEFAULT/${NV ? 'NV' : 'F3'}_SKILLS.JSON`
    ),
    sSkil = db.ids.filter((id) =>
      Object.keys(uSkil).includes(Pip.formatId(id))
    ),
    imgs = E.openFile(`DATA/${NV ? 'NV' : 'F3'}/SKILLS.IMG`, 'r');
  let txt,
    skillsChanged = !1,
    editMode = !1;
  const scroller = Pip.createScroller({
    width: 165,
    itemCount: sSkil.length,
    getItem: (n) => {
      const dat = db.getId(sSkil[n]);
      return ((dat.rtxt = uSkil[Pip.formatId(sSkil[n])]), dat);
    },
    render: (item) => {
      imgs.seek(item.io);
      const img = imgs.read(item.il);
      (Pip.renderBlock(220, 193, 245, '', ''),
        h
          .setFontAlign(-1, -1)
          .setClipRect(220, 50, 460, 190)
          .drawImage(img, 340, editMode ? 124 : 114, { rotate: 0 })
          .setClipRect(0, 0, 480, 320),
        txt && txt.remove(),
        editMode
          ? h
              .setFontAlign(-1, -1)
              .drawString(
                'Adjust your skill levels by locating a\nskill in the list and turning the top\nscroll wheel to adjust level.',
                220,
                198
              )
          : (txt = Pip.renderTextOverflow(item.desc, 465, 198, 245, 80)),
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
  function onSkillsSync() {
    Object.assign(
      uSkil,
      loadJSONWithDefaults(
        `SETTINGS/${NV ? 'NV' : 'F3'}_SKILLS.JSON`,
        `SETTINGS/DEFAULT/${NV ? 'NV' : 'F3'}_SKILLS.JSON`
      )
    );
    scroller.invalidateCache();
    scroller.render();
  }
  Pip.on('skills', onSkillsSync);
  function onKnob2(dir) {
    const id = Pip.formatId(sSkil[scroller.selectedIndex]),
      v = E.clip(uSkil[id] + dir, 1, 100);
    v !== uSkil[id] &&
      (Pip.playSound('HIGHLIGHT'),
      (uSkil[id] = v),
      (skillsChanged = !0),
      scroller.render({ listOnly: !0 }));
  }
  return {
    id: 'SKILLS',
    remove: () => {
      (Pip.removeListener('knob2', onKnob2),
        Pip.removeListener('skills', onSkillsSync),
        skillsChanged &&
          (debug('Writing to SKILLS.JSON'),
          fs.writeFileSync(
            `SETTINGS/${NV ? 'NV' : 'F3'}_SKILLS.JSON`,
            JSON.stringify(uSkil)
          )),
        scroller.remove(),
        txt && txt.remove(),
        imgs.close(),
        db.close());
    }
  };
});
