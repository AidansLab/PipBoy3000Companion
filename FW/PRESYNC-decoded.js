(function () {
  const cats = ['AID', 'AMMO', 'APPAREL', 'MISC', 'WEAPONS'];

  function tryStat(path) {
    try {
      fs.statSync(path);
      return !0;
    } catch (e) {}
    return !1;
  }

  function hasPreSyncBackup(mode) {
    try {
      const m = JSON.parse(fs.readFileSync('INV/PRESYNC/MANIFEST.JSON'));
      if (m && m.v >= 2 && m.mode === mode) return !0;
    } catch (e) {}
    if (tryStat('SETTINGS/PRESYNC/PLAYER.JSON')) return !0;
    if (tryStat('SETTINGS/PRESYNC/' + mode + '_PERKS.JSON')) return !0;
    if (tryStat('SETTINGS/PRESYNC/' + mode + '_SKILLS.JSON')) return !0;
    const base = 'INV/PRESYNC/' + mode;
    for (let i = 0; i < cats.length; i++) {
      if (tryStat(base + '/' + cats[i] + '.INV')) return !0;
    }
    return !1;
  }

  function clearPreSyncBackup() {
    const settingsFiles = [
      'PLAYER.JSON',
      'F3_PERKS.JSON',
      'F3_SKILLS.JSON',
      'NV_PERKS.JSON',
      'NV_SKILLS.JSON'
    ];
    const tryUnlink = (p) => {
      try {
        fs.unlinkSync(p);
      } catch (e) {}
    };
    settingsFiles.forEach((f) => tryUnlink('SETTINGS/PRESYNC/' + f));
    ['F3', 'NV'].forEach((m) => {
      cats.forEach((c) => tryUnlink('INV/PRESYNC/' + m + '/' + c + '.INV'));
    });
    tryUnlink('INV/PRESYNC/MANIFEST.JSON');
  }

  function readPresyncOrDefault(src, defaults) {
    if (tryStat(src)) {
      try {
        const data = fs.readFileSync(src);
        if (data && data.length) return data;
      } catch (e) {}
    }
    for (let i = 0; i < defaults.length; i++) {
      if (!tryStat(defaults[i])) continue;
      try {
        const data = fs.readFileSync(defaults[i]);
        if (data && data.length) return data;
      } catch (e) {}
    }
    return '';
  }

  function restore(mode) {
    const srcDir = 'INV/PRESYNC/' + mode,
      dstDir = 'INV/' + mode,
      refreshIds = [
        'WEAPONS',
        'APPAREL',
        'AID',
        'MISC',
        'AMMO',
        'SPECIAL',
        'SKILLS',
        'PERKS'
      ];
    if (!hasPreSyncBackup(mode)) return !1;
    if (typeof cmode !== 'undefined' && cmode) return !1;
    try {
      fs.statSync(dstDir);
    } catch (e) {
      try {
        fs.mkdirSync(dstDir);
      } catch (e2) {}
    }
    typeof Pip !== 'undefined' && Pip.inv && delete Pip.inv;
    if (tryStat('SETTINGS/PRESYNC/PLAYER.JSON')) {
      let playerData = fs.readFileSync('SETTINGS/PRESYNC/PLAYER.JSON');
      if (playerData && playerData.length) {
        fs.writeFileSync('SETTINGS/PLAYER.JSON', playerData);
        const restored = JSON.parse(playerData);
        playerData = '';
        for (let k in restored) player.player[k] = restored[k];
        player.ephemeral = {};
        player.modified = !0;
        player.sync();
      }
    }
    [mode + '_PERKS.JSON', mode + '_SKILLS.JSON'].forEach((v) => {
      const src = 'SETTINGS/PRESYNC/' + v;
      if (!tryStat(src)) return;
      let data = fs.readFileSync(src);
      if (data && data.length > 2) fs.writeFileSync('SETTINGS/' + v, data);
      data = '';
    });
    cats.forEach((v) => {
      const live = dstDir + '/' + v + '.INV',
        def = 'INV/DEFAULT/' + mode + '/' + v + '.INV';
      const data = readPresyncOrDefault(srcDir + '/' + v + '.INV', [def]);
      fs.writeFileSync(live, data || '');
    });
    player.calculateInvWeight && player.calculateInvWeight();
    Pip.renderHeader && Pip.renderHeader();
    clearPreSyncBackup();
    console.log('PIPSYNC:RESTORE:PRESYNC');
    Pip.CURRENT &&
      refreshIds.indexOf(Pip.CURRENT.id) >= 0 &&
      Pip.changeMenu &&
      Pip.changeMenu();
    return !0;
  }

  return { hasPreSyncBackup: hasPreSyncBackup, restore: restore };
})();
