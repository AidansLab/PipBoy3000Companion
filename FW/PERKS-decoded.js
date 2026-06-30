(function () {
  const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/PERK.DAT`),
    imgs = E.openFile(`DATA/${NV ? 'NV' : 'F3'}/PERK.IMG`, 'r');
  let txt,
    scroller,
    modified = !1,
    userPerks = loadJSONWithDefaults(
      `SETTINGS/${NV ? 'NV' : 'F3'}_PERKS.JSON`,
      `SETTINGS/DEFAUlT/${NV ? 'NV' : 'F3'}_PERKS.JSON`
    );
  function sortedPerks() {
    return Object.keys(userPerks)
      .filter(function (k) {
        return userPerks[k];
      })
      .sort(function (a, b) {
        return db.ids.indexOf(a) - db.ids.indexOf(b);
      })
      .reduce(function (o, k) {
        return ((o[k] = userPerks[k]), o);
      }, {});
  }
  function renderPerk(item, yOffset) {
    imgs.seek(item.io);
    const img = imgs.read(item.il);
    (txt && txt.remove(),
      (txt = Pip.renderTextOverflow(item.desc, 465, 198, 210, 80)),
      Pip.renderBlock(255, 193, 210, '', ''),
      h
        .setFontAlign(-1, -1)
        .setClipRect(255, 45, 460, 191)
        .drawImage(img, 359, 110 + (yOffset || 0), { rotate: 0 })
        .setClipRect(0, 0, 480, 320));
  }
  function createPerkScroller(scrollToID) {
    return (
      scroller && scroller.remove(),
      Pip.createScroller({
        width: 220,
        itemCount: Object.keys(userPerks).length,
        scrollStart: scrollToID
          ? Object.keys(userPerks).indexOf(
              'number' == typeof scrollToID ? scrollToID.toString() : 0
            )
          : 0,
        getItem: (n) => db.getId(Object.keys(userPerks)[n]),
        render: renderPerk,
        onLongClick: (n) => {
          if (cmode) return;
          (Pip.playSound('TAB'),
            h.clearRect(BR),
            (scroller = (function (scrollToID) {
              scroller && scroller.remove();
              return Pip.createScroller({
                width: 220,
                hasEquipStates: !0,
                itemCount: db.ids.length,
                scrollStart: scrollToID ? db.ids.indexOf(scrollToID) : 0,
                getItem: (n) => {
                  const perk = db.getId(db.ids[n]);
                  return ((perk.activ = void 0 !== userPerks[db.ids[n]]), perk);
                },
                render: (n) => {
                  (renderPerk(n, 10),
                    h
                      .clearRect(255, 45, 463, 50)
                      .drawImage(icons.fadedown, 463, 47)
                      .drawLine(255, 47, 462, 47),
                    h
                      .setFontAlign(-1, -1)
                      .drawString('ADD/REMOVE PERKS', 255, 51, !0));
                },
                onClick: (n) => {
                  (Pip.playSound('HIGHLIGHT'),
                    userPerks[db.ids[n]]
                      ? delete userPerks[db.ids[n]]
                      : (userPerks[db.ids[n]] = !0),
                    (modified = !0));
                },
                onLongClick: (n) => {
                  (Pip.playSound('TAB'),
                    h.clearRect(BR),
                    (userPerks = sortedPerks()),
                    (scroller = createPerkScroller(db.ids[n])));
                }
              });
            })(Object.keys(userPerks)[n])));
        }
      })
    );
  }
  return (
    (scroller = createPerkScroller()),
    {
      id: 'PERKS',
      remove: () => {
        (void (
          modified &&
          fs.writeFile(
            `SETTINGS/${NV ? 'NV' : 'F3'}_PERKS.JSON`,
            JSON.stringify(sortedPerks())
          )
        ),
          scroller.remove(),
          txt && txt.remove(),
          imgs.close(),
          db.close());
      }
    }
  );
});
