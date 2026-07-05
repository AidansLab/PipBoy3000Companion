(function () {
  let menu;
  debug(' - SETTINGS: Start of module');
  const settings = Pip.settings,
    alarm = settings.alarm;
  let writeTimeout,
    alarmFiles = [];
  function writeSettingsNow() {
    (debug('Writing to DEVICE.JSON'),
      fs.writeFileSync('SETTINGS/DEVICE.JSON', JSON.stringify(settings)));
  }
  function writeSetting(s, val) {
    const keys = s.split('.');
    let curr = settings;
    for (let i = 0; i < keys.length - 1; i++)
      (curr[keys[i]] || (curr[keys[i]] = {}), (curr = curr[keys[i]]));
    ((curr[keys[keys.length - 1]] = val),
      writeTimeout && clearTimeout(writeTimeout),
      (writeTimeout = setTimeout(() => {
        ((writeTimeout = void 0), writeSettingsNow());
      }, 5000)));
  }
  function showMenu(items) {
    process.memory();
    let options = items[''],
      menuItems = Object.keys(items);
    (options &&
      (menuItems.splice(menuItems.indexOf(''), 1),
      options.back &&
        ((items['< Back'] = options.back), menuItems.unshift('< Back'))),
      options instanceof Object || (options = {}),
      void 0 === options.selected && (options.selected = 0),
      (options.rowHeight = 24));
    const x2 = options.x2 || h.getWidth() - 30;
    let y = 50;
    options.title && (y += options.rowHeight + 2);
    const l = {
      draw: function () {
        (h.reset().setFont('Monofonto16').clearRect(BR),
          options.predraw && options.predraw(h),
          h.setFontAlign(0, -1),
          options.title &&
            (h.drawString(options.title, (25 + x2) / 2, y - options.rowHeight),
            h.drawLine(25, y - 2, x2, y - 2)));
        let rows =
            0 | Math.min((270 - y) / options.rowHeight, menuItems.length),
          idx = E.clip(
            options.selected - (rows >> 1),
            0,
            menuItems.length - rows
          ),
          iy = y;
        for (
          h.setColor(idx > 0 ? 3 : 0).fillPoly([50, 70, 70, 70, 60, 60]);
          rows--;
        ) {
          const name = menuItems[idx],
            item = items[name];
          if (
            (idx == options.selected &&
              !l.selectEdit &&
              Pip.shadeBox(25, iy, x2, iy + options.rowHeight - 1),
            h
              .setColor(3)
              .setFontAlign(-1, -1)
              .drawString(name, 40, iy + 3),
            'object' == typeof item)
          ) {
            let xo = x2 - 5,
              v = item.value;
            if (
              (item.format && (v = item.format(v)),
              'boolean' == typeof v && null == item.format)
            )
              (h.drawRect(xo - 17, iy + 5, xo - 5, iy + 17),
                v && h.fillRect(xo - 15, iy + 7, xo - 7, iy + 15));
            else {
              if (l.selectEdit && idx == options.selected) {
                const s = options.rowHeight > 10 ? 2 : 1;
                ((xo -= 12 * s + 1),
                  h
                    .setBgColor(3)
                    .clearRect(
                      xo - (h.stringWidth(v) + 4),
                      iy,
                      x2,
                      iy + options.rowHeight - 1
                    ),
                  h
                    .setColor(0)
                    .drawImage(
                      {
                        width: 12,
                        height: 5,
                        buffer: ' \x07\0\xF9\xF0\x0E\0@',
                        transparent: 0
                      },
                      xo,
                      iy + (options.rowHeight - 5 * s) / 2,
                      { scale: s }
                    ));
              }
              h.setFontAlign(1, -1)
                .drawString(v.toString(), xo - 2, iy + 3)
                .setBgColor(0);
            }
          }
          ((iy += options.rowHeight), idx++);
        }
        (h
          .setColor(idx < menuItems.length ? 3 : 0)
          .fillPoly([50, 268, 70, 268, 60, 278]),
          h.setColor(3).setBgColor(0).setFontAlign(-1, -1).flip());
      },
      select: function () {
        const item = items[menuItems[options.selected]];
        (!l.selectEdit && item.onSelect && item.onSelect(),
          l.selectEdit && item.onDone && item.onDone(),
          Pip.playSound('SELECT'),
          'function' == typeof item
            ? item()
            : 'object' == typeof item &&
              ('number' == typeof item.value
                ? (l.selectEdit = l.selectEdit ? void 0 : item)
                : ('boolean' == typeof item.value && (item.value = !item.value),
                  item.onchange && item.onchange(item.value)),
              l.removed || l.draw()));
      },
      move: function (dir) {
        if (l.selectEdit) {
          const item = l.selectEdit,
            prev = item.value;
          ((item.value -= (dir || 1) * (item.step || 1)),
            void 0 !== item.min &&
              item.value < item.min &&
              (item.value = item.wrap ? item.max : item.min),
            void 0 !== item.max &&
              item.value > item.max &&
              (item.value = item.wrap ? item.min : item.max),
            item.onchange &&
              item.value != prev &&
              (item.onchange(item.value, -dir), Pip.playSound('HIGHLIGHT')));
        } else {
          const prev = options.selected;
          (options.wrapSelection
            ? (options.selected =
                (dir + prev + menuItems.length) % menuItems.length)
            : (options.selected = E.clip(prev + dir, 0, menuItems.length - 1)),
            prev !== options.selected && Pip.playSound('SCROLL'));
        }
        l.draw();
      }
    };
    function onKnob1(dir) {
      dir ? l.move(dir) : l.select();
    }
    return (
      l.draw(),
      Pip.onExclusive('knob1', onKnob1),
      (l.remove = () => {
        ((l.removed = !0), Pip.removeListener('knob1', onKnob1));
      }),
      debug(' - SETTINGS menu created: ' + options.title),
      l
    );
  }
  function showMainMenu() {
    (menu && menu.remove(),
      (menu = showMenu({
        '': { title: 'Settings' },
        '> Date & Time': showDateTimeMenu,
        '> Alarm': showAlarmMenu,
        '> Display': showGraphicsMenu,
        '> Sound': showSoundMenu,
        '> Flashlight': showTorchMenu,
        '> User': showUserMenu,
        'Pip-Boy mode': {
          value: !!NV,
          //format: (v) => (v && !cmode ? 'New Vegas' : 'Fallout 3'),
          format: (v) => (cmode ? "Disallowed in companion mode." : v ? 'New Vegas' : 'Fallout 3'),
          onchange: (v) => {
            if (cmode) return;
            ((NV = v),
              writeSetting('nv', v),
              settings.theme || setRGB(void 0),
              Pip.audioStart('SOUND/FX/F' + (NV ? 'NV' : '3') + 'THEME.WAV'),
              Pip.renderHeader(),
              player.setav('equippedApparel', [0, 0, 0, 0], !0));
          }
        },
        'Start Demo Mode': () => setTimeout(Pip.demoMode, 500)
      })));
  }
  // ── Pre-sync backup/restore (companion feature) ──────────────────────────
  // Perks and Skills are now InvFile-backed (INV/{m}/PERKS.INV, SKILLS.INV —
  // same shape as the item categories), so they fold straight into the
  // generic presyncCats INV backup/restore loop below instead of needing
  // their own JSON read/write special case.
  const presyncCats = ['AID', 'AMMO', 'APPAREL', 'MISC', 'WEAPONS', 'PERKS', 'SKILLS'];
  function tryStat(path) {
    try {
      fs.statSync(path);
      return !0;
    } catch (e) {}
    return !1;
  }
  function tryRead(path) {
    try {
      const data = fs.readFileSync(path);
      if (data && data.length) return data;
    } catch (e) {}
    return '';
  }
  function ensureDir(dir) {
    const parts = dir.split('/');
    let p = '';
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      p = p ? p + '/' + parts[i] : parts[i];
      try {
        fs.statSync(p);
      } catch (e) {
        try {
          fs.mkdirSync(p);
        } catch (e2) {}
      }
    }
  }
  function hasPreSyncBackupFiles(mode) {
    if (tryStat('SETTINGS/PRESYNC/PLAYER.JSON')) return !0;
    const base = 'INV/PRESYNC/' + mode;
    for (let i = 0; i < presyncCats.length; i++) {
      if (tryStat(base + '/' + presyncCats[i] + '.INV')) return !0;
    }
    return !1;
  }
  function hasPreSyncBackup(mode) {
    if (!hasPreSyncBackupFiles(mode)) return !1;
    const manifestRaw = tryRead('INV/PRESYNC/MANIFEST.JSON');
    if (!manifestRaw) return !0;
    try {
      const m = JSON.parse(manifestRaw);
      if (m && m.v && m.v < 2) return !1;
      if (m && m.mode && m.mode !== mode) return !1;
    } catch (e) {
      return !1;
    }
    return !0;
  }
  function clearPreSyncBackup() {
    const tryUnlink = (p) => {
      try {
        fs.unlinkSync(p);
      } catch (e) {}
    };
    tryUnlink('SETTINGS/PRESYNC/PLAYER.JSON');
    ['F3', 'NV'].forEach((m) => {
      presyncCats.forEach((c) => tryUnlink('INV/PRESYNC/' + m + '/' + c + '.INV'));
    });
    tryUnlink('INV/PRESYNC/MANIFEST.JSON');
  }
  function readPresyncOrDefault(src, defaults) {
    const data = tryRead(src);
    if (data) return data;
    for (let i = 0; i < defaults.length; i++) {
      const fallback = tryRead(defaults[i]);
      if (fallback) return fallback;
    }
    return '';
  }
  function restorePreSyncData() {
    const mode = NV ? 'NV' : 'F3',
      srcDir = 'INV/PRESYNC/' + mode,
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
    if (cmode) return !1;
    try {
      ensureDir(dstDir);
      typeof Pip !== 'undefined' && Pip.inv && delete Pip.inv;
      const playerData = tryRead('SETTINGS/PRESYNC/PLAYER.JSON');
      if (playerData) {
        fs.writeFileSync('SETTINGS/PLAYER.JSON', playerData);
        const restored = JSON.parse(playerData);
        for (let k in restored) player.player[k] = restored[k];
        player.ephemeral = {};
        player.modified = !0;
        player.sync();
      }
      presyncCats.forEach((v) => {
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
    } catch (e) {
      return !1;
    }
  }
  function showUserMenu() {
    (menu && menu.remove(),
      (menu = showMenu({
        '': { title: 'User Settings', back: showMainMenu },
        Name: {
          value: player.getav('name') || '',
          onchange: () => {
            (menu && menu.remove(),
              (menu = Pip.createKeyboard(
                player.getav('name') || '',
                "Edit your name, then select 'Enter' when done",
                (name) => {
                  (player.setav('name', name.trim(), !0), showUserMenu());
                }
              )));
          }
        },
        Level: {
          value: player.getav('level') || 1,
          min: 1,
          max: NV ? 50 : 30,
          onchange: (v) => player.setlevel(v)
        },
        Karma: {
          value: player.getav('karma') || 0,
          min: -1000,
          max: 1000,
          step: 100,
          onchange: (v) => player.setav('karma', v, !0)
        },
        'Restore pre-sync data': function () {
          const mode = NV ? 'NV' : 'F3';
          (menu && menu.remove(),
            cmode
              ? (menu = showMenu({
                  '': { title: 'Cannot Restore', back: showUserMenu },
                  'Not allowed while in companion mode.': () => {}
                }))
              : hasPreSyncBackup(mode)
                ? (menu = showMenu({
                    '': { title: 'Restore pre-sync data?', back: showUserMenu },
                    Yes: function () {
                      restorePreSyncData()
                        ? showUserMenu()
                        : (menu = showMenu({
                            '': { title: 'Restore Failed', back: showUserMenu },
                            'Could not restore pre-sync data.': () => {}
                          }));
                    }
                  }))
                : (menu = showMenu({
                    '': { title: 'No Backup', back: showUserMenu },
                    'No pre-sync data backup found for this mode.': () => {}
                  })));
        },
        'Reset inventory': function () {
          (menu && menu.remove(),
            (menu = showMenu({
              '': { title: 'Reset Inventory?', back: showMainMenu },
              Yes: function () {
                (player.resetinventory(), showMainMenu());
              }
            })));
        }
      })));
  }
  function setJitter(v) {
    ((Pip.blitOptions.idleFilter = v
      ? [16843043, 17826083, 16843043, 16781603]
      : [307]),
      writeSetting('jitter', v));
  }
  function setAndStoreTheme(rgb) {
    (setRGB(rgb), writeSetting('theme', rgb));
  }
  function showCustomThemeMenu() {
    let rgb = settings.theme ? settings.theme : NV ? C.AMBER : C.GREEN;
    (menu && menu.remove(),
      (menu = showMenu({
        '': { title: 'Custom Color', back: showThemeMenu },
        Red: {
          value: (rgb >> 16) & 255,
          min: 8,
          max: 255,
          step: 8,
          onchange: (v) => {
            ((rgb = (v << 16) + (65535 & rgb)), setAndStoreTheme(rgb));
          }
        },
        Green: {
          value: (rgb >> 8) & 255,
          min: 8,
          max: 255,
          step: 8,
          onchange: (v) => {
            ((rgb = (v << 8) + (16711935 & rgb)), setAndStoreTheme(rgb));
          }
        },
        Blue: {
          value: 255 & rgb,
          min: 8,
          max: 255,
          step: 8,
          onchange: (v) => {
            ((rgb = v + (16776960 & rgb)), setAndStoreTheme(rgb));
          }
        }
      })));
  }
  function showThemeMenu() {
    (menu && menu.remove(),
      (menu = showMenu({
        '': { title: 'Display Color', back: showGraphicsMenu },
        'Mode Based (default)': () => setAndStoreTheme(void 0),
        Green: () => setAndStoreTheme(C.GREEN),
        Amber: () => setAndStoreTheme(C.AMBER),
        White: () => setAndStoreTheme(C.WHITE),
        Blue: () => setAndStoreTheme(C.BLUE),
        '> Custom color': showCustomThemeMenu
      })));
  }
  function showGraphicsMenu() {
    (menu && menu.remove(),
      (menu = showMenu({
        '': { title: 'Display Settings', back: showMainMenu },
        '> Color': showThemeMenu,
        Brightness: {
          value: Math.round(
            (Math.log(1024 * (settings.brightness || 1)) / Math.LN2) * 2
          ),
          min: 1,
          max: 20,
          step: 1,
          onchange: (v) => {
            const b = Math.pow(2, v / 2) / 1024;
            (writeSetting('brightness', b), Pip.setBrightness(b));
          }
        },
        'Display timeout': {
          value: settings.idleTimeout
            ? Math.round(settings.idleTimeout / 6e4)
            : 31,
          min: 1,
          max: 31,
          step: 1,
          format: (v) => (v < 31 ? v + ' min' : 'Never'),
          onchange: (v) => {
            writeSetting('idleTimeout', v < 31 ? 6e4 * v : 0);
          }
        },
        'Glitch on tap': {
          min: 0,
          max: 2,
          format: (v) => ['Off', 'Short', 'Persistent'][v],
          value: 0 | settings.glitchOnTap,
          onchange: (v) => {
            writeSetting('glitchOnTap', v);
          }
        },
        'Tap threshold': {
          value: Pip.accel.getThreshold(),
          min: 1,
          max: 40,
          step: 1,
          onchange: (v) => {
            (Pip.accel.setThreshold(v), writeSetting('tapThreshold', v));
          }
        },
        'CRT jitter': { value: !!settings.jitter, onchange: setJitter },
        'Vertical shift': {
          value: settings.vShift || 0,
          min: -10,
          max: 10,
          step: 1,
          onchange: (v) => {
            ((Pip.blitOptions.y = v), writeSetting('vShift', v));
          }
        },
        'Show debug info': {
          value: !!settings.debug,
          onchange: (v) => {
            (writeSetting('debug', v),
              Pip.renderDebugInfo(),
              Pip.renderHeader(),
              v
                ? Pip.startDebugInfoTimer()
                : (clearInterval(Pip.timers.debug), delete Pip.timers.debug));
          }
        }
      })));
  }
  function showSoundMenu() {
    (menu && menu.remove(),
      (menu = showMenu({
        '': { title: 'Sound Settings', back: showMainMenu },
        'Sound effects volume': {
          value: Math.round((settings.volume || 27) / 2.7),
          min: 1,
          max: 10,
          step: 1,
          onchange: (v) => {
            (writeSetting('volume', Math.round(2.7 * v)),
              Pip.setVol(settings.volume));
          }
        },
        'Mute speaker when headphones connected': {
          value: !!settings.muteOnHeadphones,
          onchange: (v) => {
            (writeSetting('muteOnHeadphones', v),
              Pip.headphonesPresent && SPEAKER_ENB.write(v));
          }
        }
      })));
  }
  function showTorchMenu() {
    (menu && menu.remove(),
      (menu = showMenu({
        '': { title: 'Flashlight Settings', back: showMainMenu },
        'Flashlight LED on': {
          value: !!Pip.torchOn,
          onchange: (v) => {
            Pip.setTorch(v);
          }
        },
        'Long press ITEMS button for:': {
          min: 0,
          max: 3,
          format: (v) => ['LED', 'Screen', 'LED + Screen', 'Morse code'][v],
          value: 0 | settings.torchMode,
          onchange: (v) => {
            writeSetting('torchMode', v);
          }
        },
        'Morse code message:': {
          value: settings.torchPattern || 'SOS',
          onchange: (v) => {
            (menu && menu.remove(),
              (menu = Pip.createKeyboard(
                v,
                "Enter a message, then select 'Enter' when done",
                (value) => {
                  (writeSetting('torchPattern', value.trim()), showTorchMenu());
                }
              )));
          }
        }
      })));
  }
  function showDateTimeMenu() {
    (menu && menu.remove(),
      (menu = showMenu({
        '': { title: 'Date & Time Settings', back: showMainMenu },
        'Set date & time': function () {
          (menu && menu.remove(),
            (menu = Pip.createDateTimePicker(
              Pip.getDateAndTime(),
              !0,
              'SET DATE & TIME',
              (d) => {
                (Pip.setDateAndTime(d), Pip.renderHeader(), showDateTimeMenu());
              }
            )));
        },
        Timezone: {
          value: settings.tz || 0,
          format: (v) =>
            'UTC' +
            (0 == v
              ? ''
              : (v > 0 ? ' +' : ' ') +
                v +
                (1 == v || -1 == v ? ' hr' : ' hrs')),
          min: -12,
          max: 14,
          step: 1,
          onchange: (v) => {
            (E.setTimeZone(v),
              writeSetting('tz', v),
              Pip.renderHeader(),
              Pip.configureAlarm());
          }
        },
        '24 hour clock': {
          value: !settings.hr12,
          onchange: (v) => {
            (writeSetting('hr12', !v), Pip.renderHeader());
          }
        },
        '4 digit year': {
          value: !!settings.year4,
          onchange: (v) => {
            (writeSetting('year4', v), Pip.renderHeader());
          }
        },
        'Time format': {
          value: (settings.timeFormat || 0) % 3,
          format: (v) =>
            ['HH:MM, DD.MM.YY', 'HH:MM, MM.DD.YY', 'YY-MM-DD HH:MM'][v],
          min: 0,
          max: 2,
          onchange: (v) => {
            (writeSetting('timeFormat', v), Pip.renderHeader());
          }
        }
      })));
  }
  function showAlarmMenu() {
    ((function () {
      try {
        alarmFiles = fs
          .readdirSync('SOUND/ALARM')
          .filter((f) => f.toUpperCase().endsWith('WAV') && !f.startsWith('.'))
          .sort()
          .reverse();
      } catch (e) {
        Pip.log(`No alarm sounds found: ${e}`);
      }
    })(),
      menu && menu.remove());
    let alarmSoundIndex = alarmFiles.indexOf(alarm.soundFile);
    alarmSoundIndex < 0 && (alarmSoundIndex = alarmFiles.length);
    let time = Pip.getDateAndTime();
    if ((time.setSeconds(0), alarm.time)) {
      let d = new Date(alarm.time);
      (time.setHours(d.getHours()), time.setMinutes(d.getMinutes()));
    } else (time.setHours(7), time.setMinutes(0));
    menu = showMenu({
      '': { title: 'Alarm Settings', back: showMainMenu },
      'Set alarm time': {
        value: `${time.getHours().toString().padStart(2, 0)}:${time.getMinutes().toString().padStart(2, 0)}`,
        onchange: function () {
          (menu && menu.remove(),
            (menu = Pip.createDateTimePicker(time, !1, 'SET ALARM', (d) => {
              (writeSetting('alarm.enabled', !0),
                writeSetting('alarm.time', d.getTime()),
                writeSetting('alarm.snoozeTime', void 0),
                Pip.configureAlarm(),
                Pip.renderHeader(),
                showAlarmMenu());
            })));
        }
      },
      'Alarm sound': {
        value: alarmSoundIndex,
        min: 0,
        max: alarmFiles.length,
        step: 1,
        format: (v) =>
          v >= alarmFiles.length
            ? 'FM ' + (Pip.radio.freq / 100).toFixed(1)
            : alarmFiles[v].slice(0, -4),
        onchange: (v) => {
          ((alarmSoundIndex = v),
            v < alarmFiles.length
              ? (Pip.audioStart('SOUND/ALARM/' + alarmFiles[v]),
                writeSetting('alarm.soundFile', alarmFiles[v]))
              : (Pip.audioStop(), writeSetting('alarm.soundFile', '')));
        },
        onSelect: () => {
          alarmSoundIndex < alarmFiles.length &&
            Pip.audioStart('SOUND/ALARM/' + alarmFiles[alarmSoundIndex]);
        },
        onDone: () => {
          Pip.audioStop();
        }
      },
      'Alarm on/off': {
        value: alarm.enabled,
        format: (v) => (v ? 'On' : 'Off'),
        onchange: (v) => {
          (writeSetting('alarm.enabled', v),
            writeSetting('alarm.snoozeTime', void 0),
            alarm.time || writeSetting('alarm.time', time.getTime()),
            Pip.configureAlarm(),
            Pip.renderHeader());
        }
      },
      'Repeat alarm each day?': {
        value: alarm.repeat,
        format: (v) => (v ? 'Yes' : 'No'),
        onchange: (v) => {
          (writeSetting('alarm.repeat', v),
            debug('Alarm repeats:', settings.alarm.repeat ? 'Yes' : 'No'));
        }
      },
      Snooze: {
        value: 0 | settings.alarm.snooze,
        format: (v) => (v ? v + ' min' : 'Off'),
        min: 0,
        max: 30,
        step: 1,
        onchange: (v) => {
          (writeSetting('alarm.snooze', v),
            debug('Alarm snooze:', settings.alarm.snooze));
        }
      }
    });
  }
  return (
    debug(' - SETTINGS: Before showing main menu'),
    showMainMenu(),
    debug(' - SETTINGS: After showing main menu'),
    {
      id: 'SETTINGS',
      remove: () => {
        (menu.remove(),
          player.sync(),
          writeTimeout &&
            (clearTimeout(writeTimeout),
            (writeTimeout = void 0),
            writeSettingsNow()));
      }
    }
  );
});
