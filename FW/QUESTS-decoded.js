/**
 * QUESTS.JS - DATA > Quests
 *
 * Replaces the stock 516-byte screen, which browsed the whole catalog with no
 * player state: it listed all 168 quests and drew every objective with the
 * filled marker, so nothing ever looked incomplete.
 *
 * Text is never sent from the companion. DATA/<mode>/QUESTS.DAT already holds
 * every quest name and objective string; INV/<mode>/QUESTS.STA (written by the
 * boot0 quest methods) supplies only ids, flags and two 64-bit objective
 * bitmasks. This screen joins the two.
 *
 * Display rules, matching the in-game Pip-Boy:
 *   - only quests the player has actually started are listed
 *   - completed quests sort below active ones and are drawn dimmed
 *   - only objectives the game has displayed are shown
 *   - \x81 (filled box) for a completed objective, \x80 (hollow) otherwise -
 *     identical glyph widths, so toggling one never reflows the wrapped text
 *
 * With no synced state (QUESTS.STA absent or empty) it falls back to the stock
 * behaviour of browsing the whole catalog, so an unsynced device is no worse
 * off than before.
 */
(function () {
  const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/QUESTS.DAT`);

  const QF_COMPLETE = 2;

  // Synced quest rows, already ordered by boot0 (running first, completed
  // last). Empty when the companion has never synced this device.
  let rows = [];
  try {
    rows = player.getquests() || [];
  } catch (e) {
    rows = [];
  }
  const synced = rows.length > 0;

  let activeId = player.getav('quest') || 0;
  let descScroll, scroller;

  const count = () => (synced ? rows.length : db.ids.length);
  const idAt = (n) => (synced ? rows[n].id : db.ids[n]);

  /** Objective n of a 64-bit lo/hi mask pair. */
  function bit(lo, hi, n) {
    return n < 32 ? (lo >>> n) & 1 : n < 64 ? (hi >>> (n - 32)) & 1 : 0;
  }

  /**
   * Objective pane text. Each line carries its own state marker, which is why
   * the marks go inside the string handed to renderTextOverflow rather than
   * being drawn separately: the pane wraps and scrolls as one block.
   */
  function objectiveText(item, row) {
    const obj = item.obj || [];
    if (!obj.length) return '';
    let out = '';
    for (let i = 0; i < obj.length; i++) {
      // Unsynced: show everything filled, exactly as stock did.
      if (row && !bit(row.dl, row.dh, i)) continue;
      const done = row ? bit(row.nl, row.nh, i) : 1;
      out += (out ? '\n\n' : '') + (done ? '\x81' : '\x80') + ' ' + obj[i];
    }
    return out;
  }

  scroller = Pip.createScroller({
    width: 220,
    hasEquipStates: !0,
    itemCount: count(),
    getItem: (n) => {
      const id = idAt(n);
      const item = db.getId(id);
      item.activ = id === activeId;
      if (synced) {
        const r = rows[n];
        // boot0 turns item.dim into a \x01 sentinel and recolours the row to
        // the dim palette entry - the same path AMMO uses for unusable rounds.
        if (r.flags & QF_COMPLETE) item.dim = !0;
        item.r = r;
      }
      return item;
    },
    render: (item) => {
      descScroll && descScroll.remove();
      descScroll = void 0;
      const txt = objectiveText(item, item.r);
      if (!txt) return;
      descScroll = Pip.renderTextOverflow(txt, 464, 91, 220, 175);
      descScroll.render();
    },
    onClick: (n) => {
      const id = idAt(n);
      if (!id) return;
      activeId = id;
      player.setav('quest', id, !0, !0);
      // Mirror to the game when the companion is attached. app-core turns this
      // into a QUEST command on the pipe, and the plugin sets the player's
      // active quest; the echo it produces is suppressed engine-side.
      if (cmode) console.log('PIPSYNC:QUEST:' + Pip.formatId(id));
      scroller.updateItemCount(count());
      Pip.audioStart('SOUND/FX/PREVNEXT.WAV');
    }
  });

  return {
    id: 'QUESTS',
    remove: () => {
      scroller.remove();
      descScroll && descScroll.remove();
      db.close();
    }
  };
});
