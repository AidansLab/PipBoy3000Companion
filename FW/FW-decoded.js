E.setFlags({ pretokenise: 1, onErrorSave: 1 });
cmode = !1;
const EMU = process.env.BOARD.includes('LINUX');
(0,
  2000 == Date().getFullYear() &&
  setTime(new Date('2077-10-23T09:47').getTime() / 1000),
  (Number.prototype.twoDigit = function () {
    return this.toString().padStart(2, '0');
  }),
  (Number.prototype.toHex = function (n) {
    return this.toString(16)
      .padStart(n || 2, '0')
      .toUpperCase();
  }));
const fs = require('fs');
((Pip.log = function (txt, logFile) {
  (logFile || (logFile = 'log.txt'),
    (txt = `[${new Date().toISOString()}] ${txt}`),
    console.log(txt));
  const s = require('Storage');
  try {
    Pip.sleeping || Pip.battLevel < C.BAT_CRITICAL_LEVEL
      ? s.getFree() > 4096 &&
      s.open(logFile, 'a').write(`${txt} (sleeping = ${Pip.sleeping})\n`)
      : (fs.statSync('LOGS') || fs.mkdir('LOGS'),
        fs.appendFile('LOGS/' + logFile, txt + '\n'));
  } catch (e) {
    s.getFree() > 4096 &&
      s.open(logFile, 'a').write(`${txt}\nSD Write Fail Reason:${e}\n`);
  }
}),
  1,
  (Pip.resetByte = peek32(1073887348) >> 24),
  poke32(1073887348, 1 << 24),
  (Pip.doReset =
    (12 & Pip.resetByte && !(16 & Pip.resetByte)) ||
    (BTN_STATS.read() && BTN_DATA.read())),
  (Pip.settings = {}));
let NV = !1;
((Pip.torchOn = !1),
  (Pip.blitOptions = { anim: [], idleIndex: 0, idleFilter: [307] }),
  (Pip.CURRENT = { remove: () => { } }));
const C = {
  BAT_SMOOTHING: 0.1,
  BAT_FULL_LEVEL: 4.1,
  BAT_LOW_LEVEL: 3.5,
  BAT_CRITICAL_LEVEL: 3.35,
  LOW_BRIGHTNESS: 0.03,
  GREEN: 1244958,
  AMBER: 16750088,
  WHITE: 16777215,
  BLUE: 562943
};
((Pip.battLevel = 0),
  (Pip.battIcon = 0),
  (global.h = Graphics.createArrayBuffer(480, 320, 2, {
    msb: !0,
    buffer: E.toArrayBuffer(E.memoryArea(268462592, 38400))
  })),
  (h.flip = () => {
    if (!Pip.blitOptions.disable) {
      if (Pip.blitOptions.anim.length) {
        let anim = Pip.blitOptions.anim[0];
        (Object.assign(Pip.blitOptions, anim),
          void 0 !== anim.y &&
          (Pip.blitOptions.y = anim.y + Pip.settings.vShift),
          (anim.c && anim.c--) ||
          (Pip.blitOptions.anim.shift(),
            anim.cb && anim.cb(),
            Pip.blitOptions.anim.length ||
            ((Pip.blitOptions.y = Pip.settings.vShift),
              (Pip.blitOptions.ydiff = 1))),
          (Pip.blitOptions.idleIndex = 0));
      } else
        ((Pip.blitOptions.filter =
          Pip.blitOptions.idleFilter[Pip.blitOptions.idleIndex]),
          (Pip.blitOptions.idleIndex =
            (Pip.blitOptions.idleIndex + 1) %
            Pip.blitOptions.idleFilter.length));
      ((Pip.lastFlip = getTime()), Pip.blitScreen(h, Pip.blitOptions));
    }
  }));
const BR = { x: 0, y: 40, w: 480, h: 238 };
function loadJSONWithDefaults(path, defaults) {
  (defaults || (defaults = {}),
    'string' == typeof defaults &&
    (defaults = JSON.parse(fs.readFileSync(defaults))),
    'string' != typeof path ||
    fs.statSync(path) ||
    fs.writeFileSync(path, '{}'));
  const data = path ? JSON.parse(fs.readFileSync(path)) : {};
  for (let k in data) defaults[k] = data[k];
  return defaults;
}
function RGBtoHSV(r, g, b) {
  ((r /= 255), (g /= 255), (b /= 255));
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h,
    s,
    d = max - min;
  return (
    (s = 0 == max ? 0 : d / max),
    (h =
      max == min
        ? 0
        : max == r
          ? ((g - b) / d + (g < b ? 6 : 0)) / 6
          : max == g
            ? ((b - r) / d + 2) / 6
            : ((r - g) / d + 4) / 6),
    { h: h, s: s, v: max }
  );
}
function generatePalette(h, s, v) {
  const CLIP = (a) => (a > 255 ? 255 : a),
    palette = [
      new Uint16Array(16),
      new Uint16Array(16),
      new Uint16Array(16),
      new Uint16Array(16)
    ];
  v = E.clip(v, C.LOW_BRIGHTNESS, 1);
  for (let i = 0; i < 16; i++) {
    const b = (220 * i) >> 4,
      c = (255 * i) >> 4,
      sat = 1 - Math.max(0, (i - 8) / 50);
    ((palette[0][i] = E.HSBtoRGB(h, s * sat, ((24 + b) / 255) * v, 16)),
      (palette[1][i] = E.HSBtoRGB(
        h,
        s * sat,
        ((18 + ((3 * b) >> 2)) / 255) * v,
        16
      )),
      (palette[2][i] = E.HSBtoRGB(
        h,
        0.9 * s * sat,
        (CLIP(32 + c) / 255) * v,
        16
      )),
      (palette[3][i] = E.HSBtoRGB(
        h,
        0.9 * s * sat,
        (CLIP(16 + c) / 255) * v,
        16
      )));
  }
  return palette;
}
function setRGB(val) {
  val || (val = NV ? C.AMBER : C.GREEN);
  const hsv = RGBtoHSV((val >> 16) & 255, (val >> 8) & 255, 255 & val);
  let palette = generatePalette(hsv.h, hsv.s, hsv.v);
  Pip.setPalette(palette);
}
((Pip.errorBox = function (err) {
  LCD_BL.set();
  for (let i = 0; i < 480; i += 2) h.clearRect(i, 0, i, 379);
  (h
    .clearRect(75, 60, 405, 260)
    .setColor(3)
    .drawRect(75, 60, 405, 260)
    .drawLine(75, 238, 405, 238),
    h.setFontMonofonto18().setFontAlign(0, 0).drawString('ERROR', 240, 80),
    h
      .setFontMonofonto16()
      .setFontAlign(0, 0)
      .drawString(
        h
          .wrapString(err, 320)
          .filter((s) => !s.match(/^[ ^]*$/))
          .slice(0, 5)
          .join('\n')
          .trim(),
        240,
        148
      ),
    h
      .setFontMonofonto14()
      .setColor(2)
      .drawString(
        `ID: ${process.env.SERIAL}  V${VERSION}  ${process.env.VERSION}`,
        240,
        251,
        !0
      ),
    h.flip(),
    (Pip.settings && Pip.settings.noReboot) ||
    (h.setColor(3).drawString('Press POWER to reload', 240, 230).flip(),
      Pip.remove(),
      Pip.stopTimers(['alarm']),
      clearWatch(),
      setWatch(() => load(), BTN_POWER, { edge: -1, repeat: !1 }),
      setTimeout(load, 15000)));
}),
  process.on('uncaughtException', function (e) {
    try {
      let err = global.__FILE__ ? `(${global.__FILE__}) : ` : '';
      ((err += e.type ? `${e.type}: ${e.message}` : `Error ${E.toJS(e)}`),
        Pip.sleeping && (err += ' (sleeping: ' + Pip.sleeping + ')'),
        e && e.stack && (err += '\n' + e.stack.trim()),
        Pip.log(err),
        !0 !== Pip.sleeping && ((Pip.sleeping = !1), Pip.errorBox(err)));
    } catch (e2) {
      (console.log(
        'Error in uncaught exception handler: ' + e2.message + '\n' + e2.stack
      ),
        console.log('Original error: ' + e + '\n' + e.stack));
    }
  }),
  E.on('errorFlag', function (e) {
    if (!(e = e.filter((f) => 'FIFO_FULL' != f)).length) return;
    let err = `Error${e.length > 1 ? 's' : ''}: ${e.join(', ')}`;
    if (Pip.menuChanging)
      try {
        err += ` (while changing to ${Pip.getMode(Pip.MODE).footer[Pip.MENUX].txt} page)`;
      } catch { }
    (Pip.sleeping && (err += ' (sleeping: ' + Pip.sleeping + ')'),
      Pip.log(err),
      Pip.errorBox(err));
  }),
  (Pip.remove = () => {
    try {
      Pip.CURRENT.remove();
    } catch (e) {
      (Pip.log(
        'Error removing menu (' +
        (Pip.CURRENT && Pip.CURRENT.id) +
        '): ' +
        e.message +
        '\n' +
        e.stack,
        'errors.txt'
      ),
        load());
    }
    Pip.CURRENT = { remove: () => { } };
  }),
  (Pip.setWatches = () => {
    clearWatch();
    {
      pinMode(ENC1_B, 'input');
      let enc1time,
        enc2time,
        enc1fast,
        enc2fast,
        enc1b = null;
      function longPressHandler(d, e) {
        e.state
          ? ((d.longPress = setTimeout(
            () => {
              ((d.longPress = !0), d.long());
            },
            d.pin == BTN_POWER ? 2500 : 800
          )),
            Pip.kickIdleTimer())
          : ('number' == typeof d.longPress && clearTimeout(d.longPress),
            !0 !== d.longPress && d.short(),
            delete d.longPress);
      }
      (setWatch(
        (e) => {
          if (enc1b !== e.data) {
            if (((enc1b = e.data), e.state)) {
              (e.time - enc1time < 0.1 ? enc1fast++ : (enc1fast = 1),
                (enc1time = e.time));
              const step = E.clip(enc1fast >> 1, 1, 5);
              Pip.emit('knob1', e.state ^ e.data ? step : -step);
            }
            (E.kickWatchdog(), Pip.kickIdleTimer());
          }
        },
        ENC1_A,
        { data: ENC1_B, edge: 0, repeat: !0, debounce: 0 }
      ),
        pinMode(ENC2_B, 'input'),
        setWatch(
          (e) => {
            (e.time - enc2time < 0.1 ? enc2fast++ : (enc2fast = 1),
              (enc2time = e.time));
            const step = E.clip(enc2fast >> 2, 1, 5);
            if (!(cmode && Pip.CURRENT && Pip.CURRENT.id === 'STATUS')) {
              Pip.emit('knob2', e.state ^ e.data ? step : -step);
            }
            (E.kickWatchdog(),
              Pip.kickIdleTimer());
          },
          ENC2_A,
          { data: ENC2_B, edge: 1, repeat: !0, debounce: 0 }
        ),
        [
          {
            pin: BTN_STATS,
            name: 'STATS',
            short: () => Pip.emit('mode', 0),
            long: () => Pip.emit('longPress', 'STATS')
          },
          {
            pin: BTN_ITEMS,
            name: 'ITEMS',
            short: () => Pip.emit('mode', 1),
            long: () => Pip.emit('longPress', 'ITEMS')
          },
          {
            pin: BTN_DATA,
            name: 'DATA',
            short: () => Pip.emit('mode', 2),
            long: () => Pip.emit('longPress', 'DATA')
          },
          {
            pin: BTN_POWER,
            name: 'POWER',
            short: () => Pip.emit('powerButton'),
            long: () => Pip.emit('longPress', 'POWER')
          },
          {
            pin: ENC1_PRESS,
            name: 'knob1',
            short: () => Pip.emit('knob1', 0),
            long: () => Pip.emit('knob1', 0, 1)
          }
        ].forEach((d) =>
          setWatch(longPressHandler.bind(null, d), d.pin, {
            edge: 0,
            repeat: !0
          })
        ));
    }
  }));
class Player {
  constructor(filePath) {
    ((this.modified = !1),
      (this.filePath = filePath),
      (this.player = loadJSONWithDefaults(
        filePath,
        'SETTINGS/DEFAULT/PLAYER.JSON'
      )),
      (this.ephemeral = {}));
  }
  sync() {
    if (this.modified && !Pip.inDemoMode)
      return (
        (this.modified = !1),
        debug(`Writing to ${this.filePath}`),
        fs.writeFileSync(this.filePath, JSON.stringify(this.player))
      );
  }
  getinfo(refresh) {
    const p = this.player.clone();
    for (let k in this.ephemeral) p[k] = this.ephemeral[k];
    p.level = E.clip(p.level || 1, 1, NV ? 50 : 30);
    const xpLevels = NV
      ? [
        200, 550, 1050, 1700, 2500, 3450, 4550, 5800, 7200, 8750, 10450,
        12300, 14300, 16450, 18750, 21200, 23800, 26550, 29450, 32500, 35700,
        39050, 42550, 46200, 5e4, 53950, 58050, 62300, 66700, 71250, 75950,
        80800, 85800, 90950, 96250, 101700, 107300, 113050, 118950, 125e3,
        131200, 137550, 144050, 150700, 157500, 164450, 171550, 178800, 186200
      ]
      : [
        200, 350, 500, 650, 800, 950, 1100, 1250, 1400, 1550, 1700, 1850,
        2000, 2150, 2300, 2450, 2600, 2750, 2900, 3050, 3200, 3350, 3500,
        3650, 3800, 3950, 4100, 4250, 4400
      ];
    return (
      (p.xpNext = xpLevels[p.level - 1]),
      (p.maxHP =
        (NV ? 100 : 90) +
        20 * p.endurance +
        (NV ? 5 * (p.level - 1) : 10 * p.level)),
      (p.maxAP = 65 + p.agility * (NV ? 3 : 2)),
      (p.maxWg = 150 + 10 * p.strength),
      (p.hp =
        (typeof cmode !== 'undefined' && cmode) && void 0 !== p.hp
          ? E.clip(p.hp, 0, p.maxHP) / p.maxHP
          : [
            'perceptioncondition',
            'endurancecondition',
            'leftattackcondition',
            'rightattackcondition',
            'rightmobilitycondition',
            'leftmobilitycondition'
          ].reduce((v, av) => {
            const c = p[av];
            return (v += void 0 !== c ? c : 100);
          }, 0) / 600),
      (0 === Object.keys(p.invWt || {}).length || refresh) &&
      this.calculateInvWeight(),
      (p.wg = 0),
      Object.entries(p.invWt || {}).forEach((a) => {
        a[0].startsWith('INV/' + (NV ? 'NV' : 'F3')) &&
          (p.wg += Math.round(a[1]));
      }),
      p
    );
  }
  getav(av) {
    if ('string' != typeof av) throw new Error('av should be string');
    return this.ephemeral[av.toLowerCase()] ?? this.player[av.toLowerCase()];
  }
  setav(av, v, persist) {
    if ('string' != typeof av) throw new Error('av should be string');
    const key = av.toLowerCase();
    if (persist) {
      delete this.ephemeral[key];
      if (key === 'equippedapparel' && v && typeof v.length === 'number') {
        v = [v[0] || 0, v[1] || 0, v[2] || 0, v[3] || 0];
      }
      this.modified = this.player[key] !== v;
      this.player[key] = v;
    } else {
      this.ephemeral[key] = v;
    }
    if (
      persist &&
      (key === 'equippedweap' || key === 'equippedapparel') &&
      typeof Pip !== 'undefined' &&
      Pip.refreshEquipState
    ) {
      Pip.refreshEquipState();
    }
  }
  addperk(p) {
    if ('number' != typeof p) throw new Error('perk should be a number');
    const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/PERK.DAT`);
    if (!db.ids.includes(p)) throw new Error('did not find perk with given id');
    const filePath = `SETTINGS/${NV ? 'NV' : 'F3'}_PERKS.JSON`,
      perks = loadJSONWithDefaults(filePath);
    ((perks[Pip.formatId(p)] = 1),
      fs.writeFileSync(filePath, JSON.stringify(perks)),
      debug(`Added perk ${db.getId(p).txt}`));
  }
  removeperk(p) {
    if ('number' != typeof p) throw new Error('perk should be a number');
    const filePath = `SETTINGS/${NV ? 'NV' : 'F3'}_PERKS.JSON`,
      perks = loadJSONWithDefaults(filePath);
    (delete perks[Pip.formatId(p)],
      fs.writeFileSync(filePath, JSON.stringify(perks)));
  }
  advlevel() {
    player.setlevel((player.getav('level') || 1) + 1);
  }
  setlevel(l) {
    player.setav('level', l, !0);
  }
  additem(id, cnt) {
    player.additemhealthpercent(id, cnt, 100);
  }
  additemhealthpercent(id, cnt, cnd) {
    if (cnt <= 0) return;
    let success = !1;
    return (
      ['AID', 'AMMO', 'APPAREL', 'MISC', 'WEAPONS'].forEach((v) => {
        try {
          const db = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/${v}.DAT`),
            i = db.ids.indexOf(id);
          if ((db.close(), i < 0)) return;
          const inv = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === v ? Pip.inv : new InvFile(`INV/${NV ? 'NV' : 'F3'}/${v}.INV`, {
            idOrder: db.ids
          }),
            inx = inv.indexOf(id);
          if (inx >= 0) {
            let it = inv.get(inx);
            ((it.cnt += cnt), inv.set(inx, it));
          } else inv.add({ id: id, cnt: cnt, cnd: cnd });
          success = !0;
          const onMenu = Pip.inv && Pip.CURRENT && Pip.CURRENT.id === v;
          if (!onMenu) inv.sync();
          if (onMenu) Pip.emit('scroller', 'count', inv.count);
        } catch (e) { }
      }),
      success
    );
  }
  removeitem(id, cnt) { }
  equipitem(id) { }
  resetinventory() {
    const self = this;
    let pending = 0;
    ['AID', 'AMMO', 'APPAREL', 'MISC', 'WEAPONS'].forEach((v) => {
      ['F3', 'NV'].forEach((x) => {
        (pending++,
          E.openFile(`INV/DEFAULT/${x}/${v}.INV`, 'r').pipe(
            E.openFile(`INV/${x}/${v}.INV`, 'w'),
            {
              complete: () => {
                0 === --pending && self.calculateInvWeight();
              }
            }
          ));
      });
    });
  }
  calculateInvWeight() {
    Pip.log('Calculating inventory weights...');
    const t0 = getTime();
    (this.player.invWt || (this.player.invWt = {}),
      ['AID', 'AMMO', 'APPAREL', 'MISC', 'WEAPONS'].forEach((v) => {
        ['F3', 'NV'].forEach((x) => {
          fs.statSync('INV/' + x) || fs.mkdirSync('INV/' + x);
          try {
            let mass = 0;
            const db = new DataFile(`DATA/${x}/${v}.DAT`),
              inv = new InvFile(`INV/${x}/${v}.INV`);
            for (let i = 0; i < inv.count; i++) {
              const invItem = inv.get(i),
                item = db.getId(invItem.id);
              mass += ((item && item.wt) || 0) * invItem.cnt;
            }
            (db.close(),
              inv.sync(),
              (this.player.invWt[`INV/${x}/${v}.INV`] = mass));
          } catch (err) {
            Pip.log(` - ERROR calculating INV weights for ${x}/${v}: ${err}`);
          }
        });
      }),
      Pip.log(` - calculation took ${(getTime() - t0).toFixed(2)} seconds`),
      (this.modified = !0),
      this.sync());
  }
}
((Pip.setDateAndTime = (d) => {
  (debug(`Setting date/time to ${d}`),
    (Pip.settings.century = Math.floor(d.getFullYear() / 100)),
    d.setFullYear((d.getFullYear() % 100) + 2000),
    setTime(d.getTime() / 1000),
    debug('Writing date/time to file SETTINGS/DEVICE.JSON'),
    fs.writeFileSync('SETTINGS/DEVICE.JSON', JSON.stringify(Pip.settings)));
}),
  (Pip.getDateAndTime = () => {
    let d = new Date();
    return (
      d.setFullYear(100 * Pip.settings.century + (d.getFullYear() % 100)),
      d
    );
  }),
  (Pip.setTorch = (on) => {
    ((Pip.torchOn = void 0 === on ? !Pip.torchOn : !!on),
      debug(' - Switching torch ' + (Pip.torchOn ? 'ON' : 'OFF')),
      0 == Pip.settings.torchMode || void 0 !== on
        ? (Pip.audioStart(`SOUND/FX/LIGHT_${Pip.torchOn ? 'ON' : 'OFF'}.WAV`),
          Pip.fadeTo({ pin: LED_TORCH, target: Pip.torchOn ? 1 : 0 }))
        : 'TORCH' == Pip.CURRENT.id
          ? Pip.torchOn || Pip.CURRENT.turnOff()
          : Pip.torchOn && Pip.changeMenu('TORCH.JS'),
      Pip.drawIcons());
  }),
  Pip.on('longPress', (btn) => {
    function restart() {
      (debug('- Reloading JS files'),
        clearInterval(),
        (Pip.timers = {}),
        clearWatch(),
        load());
    }
    switch ((debug(`Long press on ${btn} button`), btn)) {
      case 'STATS':
        BTN_DATA.read() && restart();
        break;
      case 'ITEMS':
        BTN_POWER.read() ||
          (Pip.setTorch(),
            'SETTINGS' === Pip.CURRENT.id && setTimeout(Pip.changeMenu, 100));
        break;
      case 'DATA':
        BTN_STATS.read() && restart();
        break;
      case 'POWER':
        (function () {
          (debug('- Shutting down'),
            Pip.stopTimers(['alarm']),
            Pip.remove(),
            clearWatch());
          const txt = 'Pip-OS shutting down...';
          (h.clearRect(BR).setFontMonofonto16(),
            Pip.typeText(txt, 240 - h.stringWidth(txt) / 2, 150).then((pos) => {
              if (((Pip.wakeOnLongPress = !0), BTN_POWER.read())) {
                let c = 0;
                const cursor = setInterval(() => {
                  h.setColor(++c % 10 < 5 ? 3 : 0)
                    .fillRect(pos.x - 6, pos.y, pos.x, pos.y + 16)
                    .flip();
                }, 50);
                setWatch(
                  () => {
                    (clearInterval(cursor), Pip.goToSleep());
                  },
                  BTN_POWER,
                  { edge: -1 }
                );
              } else Pip.goToSleep();
            }));
        })();
    }
  }),
  (Pip.goToSleep = (immediate) => {
    function sleepNow() {
      (setWatch(
        () => {
          Pip.running
            ? Pip.startChargeStatusTimer()
            : (Pip.wake(), setTimeout(load, 100));
        },
        VUSB_PRESENT,
        { edge: 'rising', debounce: 100 }
      ),
        setWatch(() => Pip.emit('powerButton', !1), BTN_POWER, { repeat: !1 }),
        (Pip.sleeping = !0),
        (Pip.radioOn = !1),
        debug('Sleeping now'));
      try {
        Pip.sleep();
      } catch (e) {
        Pip.log(
          'Error entering sleep mode: ' + e.message + '\n' + e.stack,
          'errors.txt'
        );
      }
    }
    debug(`Pip.goToSleep(${typeof immediate})`);
    try {
      ((Pip.sleeping = 'GOING_TO_SLEEP'),
        Pip.remove(),
        Pip.cancelDemoMode && Pip.cancelDemoMode(),
        process.memory(!0),
        Pip.stopTimers(),
        clearWatch(),
        Pip.setTorch(0),
        'function' == typeof immediate
          ? immediate().then(() => {
            setTimeout(sleepNow, 100);
          })
          : immediate
            ? setTimeout(sleepNow, 50)
            : (Pip.audioStart('SOUND/FX/CRT_OFF.WAV'),
              Pip.offAnimation().then(() => {
                (Pip.ledsAllOff(), setTimeout(sleepNow, 500));
              })));
    } catch (e) {
      (Pip.log(
        'Error during goToSleep: ' + e.message + '\n' + e.stack,
        'errors.txt'
      ),
        setTimeout(sleepNow, 50));
    }
  }),
  (Pip.wakeUp = (showAnim, srcOverride) => {
    if (
      (g.clear(),
        Pip.checkChargeStatus(!0),
        Pip.checkHeadphoneState(!0),
        Pip.setVol(Pip.settings.volume),
        debug('Waking up from sleep'),
        debug(` - Battery: ${Pip.battLevel.toFixed(2)} V`),
        Pip.lowBatt)
    ) {
      debug(' - Battery too low to wake up');
      let cx = 240,
        cy = 160;
      (h
        .clear(1)
        .fillRect(cx - 60, cy - 20, cx + 60, cy - 18)
        .fillRect(cx - 60, cy + 18, cx + 60, cy + 20)
        .fillRect(cx - 60, cy - 18, cx - 58, cy + 18)
        .fillRect(cx + 58, cy - 18, cx + 60, cy + 18)
        .fillRect(cx + 60, cy - 6, cx + 68, cy + 6)
        .setColor(1)
        .fillRect(cx - 54, cy - 14, cx - 48, cy + 14)
        .flip(),
        LCD_BL.set(),
        setTimeout(Pip.goToSleep, 3000, !0));
    } else
      ((Pip.sleeping = 'WAKING_UP'),
        Pip.accel.init(),
        (Pip.blitOptions.anim = [
          { filter: 4096, y: -100, ydiff: 4 },
          { filter: 69632, y: 0 },
          { filter: 1118464, y: -40 },
          { filter: 286400785, y: -20, ydiff: 3 },
          { filter: 287449617, y: 0 },
          { filter: 304226849, y: -20 },
          { filter: 304296481, y: -10, ydiff: 2 },
          { filter: 304296481, y: 0 },
          { filter: 287453985, y: -8 },
          { filter: 287449889, y: -4 },
          { filter: 286401313, y: -2, ydiff: 1 },
          { filter: 286401313, y: -1 },
          { filter: 286335538, y: 0 },
          { filter: 286335538 },
          { filter: 286331442 },
          { filter: 17895986, c: 2 },
          { filter: 1118770, c: 2 },
          { filter: 70194, c: 3 },
          { filter: 4658, c: 3 },
          { filter: 307 }
        ]),
        (Pip.blitOptions.disable = !0),
        fs.readFileSync('VERSION'),
        showAnim ||
        (Pip.renderHeader(), Pip.renderFooter(), Pip.loadMenu(srcOverride)),
        setTimeout(function () {
          (delete Pip.blitOptions.disable,
            Pip.audioStart('SOUND/FX/CRT_ON2.WAV'));
        }, 0),
        showAnim
          ? (Pip.fadeTo([
            { pin: LCD_BL, target: 1 },
            { pin: LED_STATS, target: 1 },
            { pin: LED_ITEMS, target: 1 },
            { pin: LED_DATA, target: 1 }
          ]),
            Pip.bootAnimation().then(() => {
              (Pip.ledsRestore(), Pip.run());
            }))
          : (Pip.ledsRestore(),
            (Pip.settings.brightness || 0) < C.LOW_BRIGHTNESS &&
            Pip.setBrightness(1),
            (Pip.sleeping = !1),
            Pip.startTimers(),
            BTN_POWER.read()
              ? setWatch(Pip.setWatches, BTN_POWER, { edge: -1, repeat: !1 })
              : Pip.setWatches()));
  }),
  Pip.on('powerButton', () => {
    if ('string' == typeof Pip.sleeping)
      return (
        debug('Ignoring power button - Pip.sleeping=' + Pip.sleeping),
        void 0
      );
    if (Pip.sleeping) {
      if (!Pip.checkBatteryLevel(!0))
        return (
          setWatch(() => Pip.emit('powerButton', !1), BTN_POWER, {
            repeat: !1
          }),
          void 0
        );
      if (Pip.wakeOnLongPress) {
        let btnTimer;
        function returnToSleep() {
          (btnTimer && clearTimeout(btnTimer),
            debug(
              ' - Power button released before long press - returning to sleep.'
            ),
            Pip.fadeTo([
              { pin: LED_STATS, target: 0, stepFactor: 1.2 },
              { pin: LED_ITEMS, target: 0, stepFactor: 1.2 },
              { pin: LED_DATA, target: 0, stepFactor: 1.2 }
            ]),
            Pip.goToSleep(!0));
        }
        if (
          (debug(' - Waiting for long press to wake up.'),
            (Pip.sleeping = 'WAITING_FOR_LONG_PRESS'),
            Pip.wake(),
            Pip.fadeTo([
              { pin: LED_STATS, target: 0.5, stepFactor: 1.1 },
              { pin: LED_ITEMS, target: 0.5, stepFactor: 1.1 },
              { pin: LED_DATA, target: 0.5, stepFactor: 1.1 }
            ]),
            BTN_POWER.read())
        ) {
          let btnWatch = setWatch(returnToSleep, BTN_POWER, { edge: -1 });
          btnTimer = setTimeout(() => {
            (clearWatch(btnWatch), (Pip.wakeOnLongPress = !1), Pip.wakeUp(!0));
          }, 1200);
        } else returnToSleep();
      } else (Pip.wake(), Pip.wakeUp());
    } else Pip.goToSleep();
  }));
const icons = {
  fadeup: '\x01\x18\x04\x01\x11\x11!!""22233',
  fadedown: '\x01\x18\x0433###""\x12\x12\x11\x11\x10',
  alarm:
    '\r\x10\x02\0\b\0\0\x07\x80\0\x1F\xFD\0\x1F\xFF\xD0\x0F\xFF\xFC\x07\xFF\xFFB\xFF\xFF\xE0\xBF\xFF\xF8/\xFF\xFE\x0B\xFF\xFF\x82\xFF\xFF\xE1\xFF\xFF\xFD\xFF\xFF\xFF\xFF\xFF\xFF\xF1_\xBDP\0\xFC\0',
  snooze:
    '\x0F\x10\x02\0\x05j\xF0\0?\xFF\xC0\0\xBF\xBF\0\0\0\xF4\0\0\x0B\xC0P\0=\x03\xFF\x82\xF0\x06\xBF\x0F@\0\xF4\xBC\0\x0B\x83\xD0\0|/V\x83\xC0\xFF\xFF=\x03\xFF\xFA\xE0\x05\0\x0F\xFF@\0\x16\xBD\0\0',
  charging:
    '\n\x12\x02\x0F\xFF\x80\xFF\xF0\x1F\xFD\x02\xFF\xC0?\xF4\x03\xFE\0\x7F\xD5[\xFF\xFF\xFF\xFF\xCF\xFF\xF4\x11\xFE\0\x1F\xC0\x02\xF4\0>\0\x03\xC0\x004\0\x07\0\0@\0',
  torch:
    '\n\x12\x02\xFF\xFF\xFF\xFF\xFF\0\0\x0F\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xF3\xFF\xFC\x0F\xFF\0\xFF\xF0\x0F\xFF\0\xFF\xF0\x0F\xFF\0\xFF\xF0\x0F\xFF\0\xFF\xF0\x0F\xFF\0\xFF\xF0',
  emptyBattery:
    '\n\x12\x01\x1E\x07\x8F\xFF\xFF\xC0\xF0<\x0F\x03\xC0\xF0<\x0F\x03\xC0\xF7\xBD\xEF\x03\xFF\xFF\xF0',
  '!': '\x02\x12\x01\xFF\xFF\xFF\xF0\xF0'
};
((Pip.drawIcons = () => {
  let x0 = 22;
  (h.clearRect(x0, 22, x0 + 23, 40),
    h
      .setColor(Pip.lowBatt && (0 | getTime()) % 2 ? 1 : 2)
      .drawImage(icons.emptyBattery, x0, 22),
    Pip.lowBatt && h.drawImage(icons['!'], x0 + 12, 22),
    h.fillRect(x0 + 3, 36, x0 + 6, 36 - Pip.battIcon).setColor(3),
    Pip.torchOn
      ? h.drawImage(icons.torch, (x0 += 12), 22)
      : Pip.charging && h.drawImage(icons.charging, (x0 += 12), 22));
  let alarm = Pip.settings.alarm;
  if (alarm && alarm.enabled) {
    let snooze = void 0 !== alarm.snoozeTime,
      time = new Date(snooze ? alarm.snoozeTime : alarm.time),
      dt = Pip.currentDateTime(time);
    (h.drawImage(snooze ? icons.snooze : icons.alarm, (x0 += 12), 23),
      h.setFontCustom(
        '\0\0\0\0\0\0\0\0\x10\b\x04\0\0\0\b\x01\xDD\x01\x80\xC0]\xC0\0\0\0\0\0w\0\x01\xD1\x18\x8CE\xC0\0\0Db1\x17p\x01\xC0\x10\b\x04\x1D\xC0\x07\x04F#\x11\x07\0\x1D\xD1\x18\x8CD\x1C\0\0@ \x10\x07p\x01\xDD\x11\x88\xC4]\xC0\x07\x04F#\x11w\0\x05\0\0',
        32,
        '\x06\0\0\0\0\0\0\0\0\0\0\0\0\x06\x02\0\x06\x06\x06\x06\x06\x06\x06\x06\x06\x06\x02',
        9
      ),
      h.setFontAlign(-1, 0).drawString(dt[0], x0 + 20, 34));
  }
  return x0;
}),
  (Pip.timers = {}),
  (Pip.MODE = 0),
  (Pip.MENUX = 0),
  (Pip.getMode = function (mode) {
    switch (mode) {
      case 0:
        return {
          title: 'STATS',
          header: () => {
            const USER = player.getinfo();
            return [
              ['LVL', USER.level],
              ['HP', `${Math.round(USER.maxHP * USER.hp)}/${USER.maxHP}`],
              ['AP', `${USER.maxAP}/${USER.maxAP}`],
              [
                'XP',
                USER.xpNext
                  ? `${Math.floor(USER.xpNext * (new Date().getDate() / 32))}/${USER.xpNext}`
                  : 'MAX'
              ]
            ];
          },
          footer: [
            { txt: 'Status', src: 'STATUS.JS' },
            { txt: 'S.P.E.C.I.A.L.', src: 'SPECIAL.JS' },
            { txt: 'Skills', src: 'SKILLS.JS' },
            { txt: 'Perks', src: 'PERKS.JS' },
            { txt: 'General', src: 'GENERAL.JS' }
          ]
        };
      case 1:
        return {
          title: 'ITEMS',
          header: () => {
            const inv = new InvFile(`INV/${NV ? 'NV' : 'F3'}/MISC.INV`),
              USER = player.getinfo();
            let caps = 0;
            const capI = inv.indexOf(15);
            if (capI >= 0) {
              const capV = inv.get(capI);
              capV && (caps = capV.cnt);
            }
            return [
              ['Wg', `${USER.wg}/${USER.maxWg}`],
              [
                'HP',
                `${Math.round(USER.maxHP * USER.hp)}/${USER.maxHP}`.padStart(
                  7,
                  ' '
                )
              ],
              [
                NV ? 'DT' : 'DR',
                `${(NV ? USER.dt : USER.dr) || 0}`.padStart(2, ' ')
              ],
              ['Caps', String(caps).padStart(5, ' ')]
            ];
          },
          footer: [
            { txt: 'Weapons', src: 'WEAPONS.JS' },
            { txt: 'Apparel', src: 'APPAREL.JS' },
            { txt: 'Aid', src: 'AID.JS' },
            { txt: 'Misc', src: 'MISC.JS' },
            { txt: 'Ammo', src: 'AMMO.JS' }
          ]
        };
      case 2:
        return {
          title: 'DATA',
          header: () => {
            const mapMeta = JSON.parse(
              fs.readFile(`MAP/${NV ? 'NV' : 'F3'}/MAPS.JSON`)
            )[player.getav('map') || 'WMAP'] || { name: void 0 },
              dt = Pip.currentDateTime(),
              loc = mapMeta.name;
            return [
              ['', loc || (NV ? 'Mojave Wasteland' : 'The Capital Wasteland')],
              ['', dt[2]]
            ];
          },
          footer: [
            { txt: 'Settings', src: 'SETTINGS.JS' },
            { txt: 'World Map', src: 'WMAP.JS' },
            { txt: 'Quests', src: 'QUESTS.JS' },
            { txt: 'Notes', src: 'NOTES.JS' },
            { txt: 'Radio', src: 'RADIO.JS' }
          ]
        };
      default:
        throw new Error(`Unknown mode ${mode}`);
    }
  }),
  (Pip.formatId = (id) => id.toHex(8)),
  (Pip._fade = { timer: null, state: {}, waiters: [] }),
  (Pip._fade.state[LCD_BL.toString()] = { b: 1, t: null }),
  (Pip.fadeTo = (specs) => {
    Array.isArray(specs) || (specs = [specs]);
    for (let s of specs) {
      const pin = s.pin.toString();
      (Pip._fade.state[pin] || (Pip._fade.state[pin] = { b: 0, t: null }),
        (Pip._fade.state[pin].t = s.target),
        (Pip._fade.state[pin].sf = s.stepFactor || 1.46));
    }
    const p = new Promise((resolve) => (Pip._fade.resolve = resolve));
    if (null !== Pip._fade.timer) return p;
    const step = () => {
      let allDone = !0;
      for (let pin in Pip._fade.state) {
        const st = Pip._fade.state[pin];
        if (null === st.t) continue;
        allDone = !1;
        const target = st.t;
        let c = st.b || 0;
        c !== target
          ? (c < target
            ? (c < 0.01 && (c = 0.01),
              (c *= st.sf),
              c >= target && (c = target))
            : ((c /= st.sf), c <= Math.max(0.01, target) && (c = target)),
            (st.b = c),
            c % 1 ? analogWrite(pin, c, { freq: 200 }) : digitalWrite(pin, c))
          : (st.t = null);
      }
      if (allDone) {
        if (Pip._fade.resolve) {
          try {
            Pip._fade.resolve();
          } catch (e) {
            debug('Error resolving fade promise:', e);
          }
          Pip._fade.resolve = null;
        }
        null !== Pip._fade.timer &&
          (require('timer').remove(Pip._fade.timer), (Pip._fade.timer = null));
      }
      return allDone;
    };
    return (
      step() ||
      (Pip._fade.timer = require('timer').add({
        type: 'EXEC',
        fn: step,
        time: 30,
        interval: 30
      })),
      p
    );
  }),
  (Pip.ledsAllOff = () => {
    let targets = [];
    return (
      Object.keys(Pip._fade.state).forEach((pin) => {
        if (pin == LED_DOWNFIRE.toString()) return;
        const s = Pip._fade.state[pin];
        ((s.bs = s.b || 0), targets.push({ pin: pin, target: 0 }));
      }),
      Pip.fadeTo(targets)
    );
  }),
  (Pip.ledsRestore = () => {
    let targets = [];
    return (
      Object.keys(Pip._fade.state).forEach((pin) => {
        const s = Pip._fade.state[pin];
        targets.push({ pin: pin, target: s.bs || 0 });
      }),
      Pip.fadeTo(targets)
    );
  }),
  (Pip.playSound = (label) => {
    Pip.audioStartVar(Pip.audioBuiltin(label), { overlap: !0 });
  }),
  (Pip.I2CInit = (i2c) => {
    (0, i2c || (i2c = I2C1));
    const sclPin = i2c == I2C1 ? INT_SCL : EXT_SCL,
      sdaPin = i2c == I2C1 ? INT_SDA : EXT_SDA,
      freq = i2c == I2C1 ? 2e5 : 8e4;
    try {
      if (0 == sdaPin.read()) {
        Pip.log(
          `I2C SDA pin (${sdaPin}) is low - trying to unstick the bus with SCL pulses`
        );
        for (
          var i = 1;
          i <= 32 && (sclPin.write(0), sclPin.write(1), !sdaPin.read());
          i++
        );
        Pip.log(
          `I2C bus ${sdaPin.read() ? 'unstuck' : 'still stuck'} after ${i} pulses`
        );
      }
      i2c.setup({ scl: sclPin, sda: sdaPin, bitrate: freq });
    } catch (e) {
      Pip.log(`Failed to set up I2C: ${e.message}`);
    }
  }),
  (Pip.accel = {
    writeReg: function (reg, val) {
      try {
        I2C1.writeTo(this.addr, [reg, val]);
      } catch (e) {
        (Pip.log(
          `Failed to write accelerometer register ${reg.toHex()}: ${e.message}`
        ),
          Pip.I2CInit());
      }
    },
    init: function () {
      this.running = !1;
      try {
        (Pip.I2CInit(), (this.addr = 25));
        try {
          I2C1.readFrom(this.addr, 1);
        } catch {
          this.addr = 15;
        }
        ((this.isKXTJ3 = 15 === this.addr),
          this.isKXTJ3 ||
          1 == process.env.HWVERSION ||
          (Pip.log(
            'Hardware version mismatch detected - re-initialising codec as it might not be working'
          ),
            Pip.initDAC()));
        const WHO_AM_I = I2C1.readReg(this.addr, 15, 1);
        if (53 == WHO_AM_I)
          (debug('Initialising KXTJ3-1057 accelerometer'),
            this.writeReg(27, 0),
            this.writeReg(27, 2),
            this.writeReg(29, (248 & I2C1.readReg(this.addr, 29, 1)[0]) | 7),
            this.writeReg(30, 32),
            this.writeReg(41, 1),
            this.writeReg(42, 10),
            this.writeReg(106, Pip.settings.tapThreshold),
            this.writeReg(107, 0),
            this.writeReg(27, 130),
            (this.running = !0));
        else {
          if (17 != WHO_AM_I)
            throw new Error(
              `Unexpected WHO_AM_I response from accelerometer (${WHO_AM_I})`
            );
          (debug('Initialising SC7A20H accelerometer'),
            this.writeReg(32, 71),
            this.writeReg(33, 193),
            this.writeReg(34, 64),
            this.writeReg(35, 64),
            this.writeReg(36, 8),
            this.writeReg(37, 2),
            this.writeReg(50, 2 * Pip.settings.tapThreshold),
            this.writeReg(51, 0),
            this.writeReg(48, 2),
            (this.running = !0));
        }
      } catch (e) {
        (Pip.log(`Failed to initialise accelerometer: ${e.message}`),
          Pip.I2CInit());
      }
    },
    read: function () {
      if ((0, !this.running)) return [0, 0, 0];
      try {
        if (this.isKXTJ3) {
          const d = I2C1.readReg(this.addr, 7, 5);
          return [256 - d[2], d[0], d[4]].map((v) =>
            v > 127 ? (v - 256) / 64 : v / 64
          );
        }
        {
          const d = I2C1.readReg(this.addr, 168, 5);
          return [d[2], 256 - d[0], d[4]].map((v) =>
            v > 127 ? (v - 256) / 64 : v / 64
          );
        }
      } catch (e) {
        return (
          Pip.log(`Failed to read accelerometer data: ${e.message}`),
          Pip.I2CInit(),
          [0, 0, 0]
        );
      }
    },
    getThreshold: function () {
      try {
        return (
          I2C1.readReg(this.addr, this.isKXTJ3 ? 106 : 50, 1)[0] /
          (this.isKXTJ3 ? 1 : 2)
        );
      } catch (e) {
        return (
          Pip.log(`Failed to read accelerometer threshold: ${e.message}`),
          Pip.I2CInit(),
          0
        );
      }
    },
    setThreshold: function (v) {
      if (this.isKXTJ3) {
        const CTRL_REG1 = I2C1.readReg(this.addr, 27, 1)[0];
        (this.writeReg(27, -129 & CTRL_REG1),
          this.writeReg(106, v),
          this.writeReg(27, 128 | CTRL_REG1));
      } else this.writeReg(50, 2 * v);
    },
    releaseInt: function () {
      if (!Pip.sleeping)
        try {
          I2C1.readReg(this.addr, this.isKXTJ3 ? 26 : 49, 1);
        } catch (e) {
          (Pip.log(`Failed to release accelerometer interrupt: ${e.message}`),
            Pip.I2CInit());
        }
    }
  }));
class DataFile {
  constructor(datFile) {
    this.file = E.openFile(datFile, 'r');
    const head = new Uint32Array(E.toArrayBuffer(this.file.read(8)));
    if (0 === head[0]) throw new Error('number of records was zero');
    if (0 === head[1]) throw new Error('size of record was zero');
    ((this.end = 8 + 4 * head[0]),
      (this.len = head[1]),
      (this.ids = new Uint32Array(
        E.toArrayBuffer(this.file.read(4 * head[0]))
      )));
  }
  getId(id) {
    if (this.ids.indexOf(id) < 0) return { txt: '== MISSING ==' };
    this.file.seek(this.end + this.ids.indexOf(id) * this.len);
    const data = this.file.read(this.len);
    try {
      return JSON.parse(data);
    } catch (err) {
      return (
        debug('failed to parse data', err, data),
        { txt: '== ERROR ==', desc: err }
      );
    }
  }
  close() {
    this.file.close();
  }
}
class InvFile {
  constructor(path, options) {
    (options || (options = {}),
      (this.path = path),
      (this.onLoaded = options.onLoaded),
      (this.idOrder = options.idOrder),
      fs.statSync(path) ||
      E.openFile(path.replace('INV/', 'INV/DEFAULT/'), 'r').pipe(
        E.openFile(path, 'w')
      ),
      this.refreshItems());
  }
  refreshItems() {
    ((this.buf = E.toArrayBuffer(fs.readFileSync(this.path) ?? '')),
      (this.count = this.buf ? this.buf.length >> 3 : 0),
      this.onLoaded && this.onLoaded(this));
  }
  sort(da) {
    if (!this.buf) return;
    const r = new Float64Array(this.buf, 0, this.count),
      io = da.indexOf.bind(da);
    (r.sort(function (a, b) {
      const fa = new Float64Array(2),
        ia = new Uint32Array(fa.buffer);
      ((fa[0] = a), (fa[1] = b));
      const aIsNull = 0 === ia[0],
        bIsNull = 0 === ia[2];
      return aIsNull && !bIsNull
        ? 1
        : !aIsNull && bIsNull
          ? -1
          : aIsNull && bIsNull
            ? 0
            : io(ia[0]) - io(ia[2]);
    }),
      (this._requiresSort = !1));
  }
  sync() {
    this.buf &&
      this._requiresSync &&
      (this.idOrder && this._requiresSort && this.sort(this.idOrder),
        debug(`Writing to ${this.path}`),
        fs.writeFileSync(
          this.path,
          this.count > 0 ? new Uint8Array(this.buf, 0, 8 * this.count) : []
        ),
        (this._requiresSync = !1));
  }
  indexOf(id) {
    const u32 = new Uint32Array(this.buf);
    for (let x = 0; x < this.count; x++) if (u32[2 * x] === id) return x;
    return -1;
  }
  ids() {
    return new Array(this.count)
      .fill(0)
      .map((_, i) => new DataView(this.buf, 8 * i, 4).getUint32(0, !0));
  }
  get(i) {
    if (i < 0 || i >= this.count) return null;
    const offset = 8 * i,
      u8 = new Uint8Array(this.buf, offset, 8);
    return {
      id: u8[0] | (u8[1] << 8) | (u8[2] << 16) | (u8[3] << 24),
      cnt: u8[4] | (u8[5] << 8),
      cnd: u8[6],
      fl: u8[7]
    };
  }
  set(i, dat) {
    if (i < 0 || i >= this.count) return null;
    const dv = new DataView(this.buf, 8 * i, 8);
    ('id' in dat && dv.setUint32(0, dat.id, !0),
      'cnt' in dat && dv.setUint16(4, dat.cnt, !0),
      'cnd' in dat && dv.setUint8(6, dat.cnd),
      'fl' in dat && dv.setUint8(7, dat.fl),
      (this._requiresSync = !0));
  }
  add(dat) {
    if (!('id' in dat)) throw new Error('Cannot add item without an ID');
    const newBuf = new ArrayBuffer(this.buf.byteLength + 8);
    (E.mapInPlace(this.buf, newBuf),
      (this.buf = newBuf),
      this.count++,
      this.set(this.count - 1, {
        id: dat.id,
        cnt: E.clip(dat.cnt, 1, 999),
        cnd: dat.cnd || 100,
        fl: dat.fl || 0
      }),
      (this._requiresSort = !0));
  }
  remove(i) {
    const records = new Float64Array(this.buf, 0, this.count);
    if (i < 0 || i >= this.count) return null;
    for (let n = i; n < this.count - 1; n++) records[n] = records[n + 1];
    (this.count--,
      (this._requiresSync = !0),
      this.onLoaded && this.onLoaded(this));
  }
}
function debug(txt) {
  if (!Pip.settings.debug) return;
  const m = process.memory(!1),
    v_us = m.usage.toString().padEnd(5, ' '),
    v_fr =
      ((m.usage - 2135).toString().padEnd(5, ' '),
        m.free.toString().padEnd(5, ' ')),
    debugStr = `${txt}`.padEnd(50, ' ') + `usage: ${v_us} free: ${v_fr}`;
  if (VUSB_PRESENT.read()) console.log(debugStr);
  else {
    const s = require('Storage');
    s.getFree() > 4096 &&
      s
        .open('debug.txt', 'a')
        .write(
          `[${new Date().toISOString()}] ${debugStr} batt: ${Pip.battLevel.toFixed(2)} V\n`
        );
  }
}
if (
  ((Pip.shadeBox = (x1, y1, x2, y2) => {
    h.setColor(1);
    for (let yy = y1 + 1; yy <= y2 - 1; yy += 2) h.fillRect(x1, yy, x2, yy);
    h.setColor(3).drawRect(x1, y1, x2, y2);
  }),
    (Pip.drawGauge = (txt, val, min, max, opt) => {
      let x = 226;
      opt || (opt = {});
      const xo = Math.round(
        ((Math.max(min, Math.min(val, max)) - min) / (max - min)) * 210
      ),
        y = opt.y || 215,
        valText = val % 1 ? val.toFixed(2) : val;
      if (
        (h.setFont('Monofonto14').setColor(3),
          opt.update ||
          (h
            .fillRect(164, y, 464, y + 1)
            .drawImage(icons.fadedown, 463, y)
            .drawImage(icons.fadedown, 464, y)
            .fillPoly([x, y, x, y + 12, x - 12, y])
            .setFontAlign(-1, 0)
            .drawString(txt, 164, y + 15)
            .setFontAlign(0, 1)
            .drawString((max + min) / 2, x + 105, y)
            .drawString(max, x + 210, y),
            opt.showMin && h.drawString(min, x, y),
            opt.lTxt &&
            h
              .clearRect(20, y + 7, 101, y + 38)
              .fillRect(20, y, 158, y + 1)
              .drawImage(icons.fadedown, 157, y)
              .drawImage(icons.fadedown, 158, y)
              .setFontAlign(-1, -1)
              .drawString(opt.lTxt, 20, y + 7)),
          opt.lVal &&
          h
            .clearRect(104, y + 7, 147, y + 38)
            .setFontAlign(1, -1)
            .drawString(' ' + opt.lVal, 148, y + 7, !0),
          h
            .clearRect(x - 10, y + 15, x + 220, y + 47)
            .clearRect(x - 40, y + 20, x - 10, y + 47),
          h
            .fillRect(x + xo - 1, y + 25, x + xo + 1, y + 43)
            .fillPoly([x + xo, y + 15, x + xo - 9, y + 25, x + xo + 8, y + 25]),
          opt.showVal &&
          h.setFontAlign(1, 1).drawString(valText, x + xo - 7, y + 47),
          !opt.update)
      ) {
        for (let i = 1; i < 15; i++)
          ((x += 14), h.fillRect(x, y, x + 1, y + (i % 3 ? 5 : 10)));
        ((x += 14), h.fillPoly([x, y, x, y + 12, x + 12, y]));
      }
    }),
    (Pip.onExclusive = (eventName, callback) => {
      const callbacks = Pip['#on' + eventName];
      (Pip.removeAllListeners(eventName),
        Pip.on(eventName, callback),
        callbacks &&
        callbacks.length > 0 &&
        Pip.log(
          `Event ${eventName} not exclusive already ${callbacks.length} callbacks attached, they have been removed\n${callbacks.map((f) => f.toString()).join('\n')}`,
          'errors.txt'
        ));
    }),
    (Pip.createScroller = (options) => {
      const IMGUP =
        '\x10\b\x02\0\0\x80\0\0\x03\xE0\0\0\x0F\xF8\0\0\x7F\xBF\0\x01\xF8\x1F\x80\x06\xE0\x03\xE0\x1A@\0\xB8h\0\0\x1A',
        IMGDN =
          '\x10\b\x02T\0\0\x05*\0\0)\x0E\xC0\x01\xE8\x03\xF4\x0B\xD0\0\xBD?@\0/\xFD\0\0\x0B\xF0\0\0\x02\xC0\0',
        IMGS =
          '\x04@\x02TU\xA9i\xA9\xA9\xA9\xA9\xA9\xA9\xAD\xA9\xBD\xA9\xBD\xB9\xBD\xB9\xBD\xBD\xB9\xBD\xBD\xBD\xBD\xFD\xBD\xBD\xFD\xBD\xBD\xFD\xBD\xBD\xFD\xBD\xBD\xFD\xBD\xBD\xBD\xBD\xB9\xBD\xBD\xB9\xBD\xB9\xBD\xAD\xB9\xA9\xB9\xAD\xA9\xA9\xA9\xA9i\xA9i\x99dd';
      let contentsRenderTimeout,
        cache = [],
        setCacheItem = (i, item) => {
          let txt = h.setFont('Monofonto14').wrapString(item.txt, w - 40);
          return (cache[i] = {
            txt: txt,
            activ: item.activ,
            rtxt: item.rtxt,
            h: 10 + 14 * txt.length
          });
        },
        getCache = (i) => cache[i] || setCacheItem(i, o.getItem(i)),
        max = options.getItem ? options.itemCount : options.items.length,
        w = options.width || 180;
      let o = {
        scrollIndex: options.scrollStart
          ? E.clip(options.scrollStart, 0, options.itemCount)
          : 0,
        scrollY: 0,
        selectedIndex: options.scrollStart
          ? E.clip(options.scrollStart, 0, options.itemCount)
          : 0,
        updateItemCount: (c) => {
          ((max = c), (cache = []));
        },
        render: (opt) => {
          if (max <= 0) return;
          opt = opt || {};
          let selectedItem = o.getItem(o.selectedIndex);
          setCacheItem(o.selectedIndex, selectedItem);
          const x = 24;
          let y = 50 + o.scrollY,
            i = o.scrollIndex,
            imax = max,
            renderTop = 50,
            renderBtm = 266;
          if (void 0 !== opt.justItem) {
            for (; i < opt.justItem; i++) y += getCache(i).h;
            ((imax = opt.justItem + 1),
              (opt.listOnly = !0),
              (renderTop = y),
              (renderBtm = y + getCache(i).h));
          }
          for (
            h
              .clearRect(BR.x, renderTop, x + w, renderBtm)
              .setFont('Monofonto14')
              .setClipRect(BR.x, renderTop, x + w, renderBtm);
            i < imax;
            i++
          ) {
            const item = getCache(i);
            if (item) {
              if (y >= 266) break;
              (i == o.selectedIndex &&
                (Pip.shadeBox(x, y, x + w, y + item.h),
                  options.hasEquipStates && h.drawRect(30, y + 8, 38, y + 16)),
                item.activ &&
                options.hasEquipStates &&
                h.fillRect(30, y + 8, 38, y + 16),
                h
                  .setFontAlign(-1, 0)
                  .drawString(
                    item.txt.join('\n'),
                    46,
                    y + 7 * item.txt.length + 7
                  ),
                void 0 !== item.rtxt &&
                h.setFontAlign(1, 0).drawString(item.rtxt, x + w - 4, y + 14),
                h.setBgColor(0),
                (y += item.h));
            }
          }
          (max > 9 &&
            h
              .drawImage(IMGUP, 7, 50)
              .drawImage(IMGDN, 7, 259)
              .drawImage(IMGS, 14, 59 + (142 * o.selectedIndex) / max),
            h.setClipRect(0, 0, 479, 319),
            !opt.listOnly &&
            options.render &&
            (contentsRenderTimeout && clearTimeout(contentsRenderTimeout),
              (contentsRenderTimeout = setTimeout(function () {
                ((contentsRenderTimeout = void 0),
                  h.setBgColor(0).clearRect(x + w + 2, BR.y, 480, BR.y + BR.h),
                  options.render(selectedItem),
                  h.flip(),
                  (Pip.lastFlip = getTime()));
              }, 100))),
            Pip.blitOptions.anim.length ||
            ((Pip.blitOptions.y1 = renderTop),
              (Pip.blitOptions.y2 = renderBtm)),
            h.flip(),
            (Pip.lastFlip = getTime()),
            delete Pip.blitOptions.y1,
            delete Pip.blitOptions.y2);
        },
        remove: () => {
          (contentsRenderTimeout && clearTimeout(contentsRenderTimeout),
            Pip.removeListener('knob1', onKnob1));
        }
      };
      function onKnob1(dir, long) {
        if (0 === dir)
          return (
            options.onClick &&
            !long &&
            (options.onClick(o.selectedIndex),
              o.render({ listOnly: void 0 === options.render })),
            options.onLongClick && long && options.onLongClick(o.selectedIndex),
            void 0
          );
        const li = max - 1,
          newIndex = Math.max(0, Math.min(li, o.selectedIndex + dir));
        if (newIndex !== o.selectedIndex) {
          if (
            ((o.selectedIndex = newIndex),
              Pip.playSound('SCROLL'),
              o.selectedIndex <= o.scrollIndex)
          )
            ((o.scrollIndex = o.selectedIndex), (o.scrollY = 0));
          else {
            let ch,
              y = 1,
              sum = 0,
              lsi = o.scrollIndex;
            for (; y > 0;) {
              if (((y = -216), sum > 0 && o.scrollIndex === lsi + 1))
                ((sum -= getCache(lsi).h), (y += sum), (lsi = o.scrollIndex));
              else {
                sum = 0;
                for (let i = o.scrollIndex; i <= o.selectedIndex; i++) {
                  const iH = getCache(i).h;
                  ((sum += iH), (y += iH));
                }
                lsi = o.scrollIndex;
              }
              ((ch = getCache(o.selectedIndex).h),
                y >= ch
                  ? ((o.scrollY = 0), o.scrollIndex++)
                  : y > 0 && ((o.scrollY = -y), (y = 0)));
            }
          }
          if (cache.length > 18) {
            const newCache = [],
              keepS = o.scrollIndex,
              keepE = o.scrollIndex + 9;
            for (let i = keepS; i <= keepE; i++)
              cache[i] && (newCache[i] = cache[i]);
            cache = newCache;
          }
          o.render({ listOnly: void 0 === options.render });
        }
      }
      return (
        (o.getItem = options.getItem ? options.getItem : (i) => options.items[i]),
        o.render(),
        Pip.onExclusive('knob1', onKnob1),
        o
      );
    }),
    (Pip.refreshEquipState = () => {
      if (typeof Pip === 'undefined' || !Pip.CURRENT) return;
      Pip.emit('scroller', 'refreshEquip');
    }),
    (Pip.renderTextOverflow = (text, x, y, width, height) => {
      const IMGUP =
        '\x10\b\x02\0\0\x80\0\0\x03\xE0\0\0\x0F\xF8\0\0\x7F\xBF\0\x01\xF8\x1F\x80\x06\xE0\x03\xE0\x1A@\0\xB8h\0\0\x1A',
        IMGDN =
          '\x10\b\x02T\0\0\x05*\0\0)\x0E\xC0\x01\xE8\x03\xF4\x0B\xD0\0\xBD?@\0/\xFD\0\0\x0B\xF0\0\0\x02\xC0\0',
        txt = h.setFont('Monofonto14').wrapString(text, width - 15),
        textHeight = txt.length * h.getFontHeight(),
        mustScroll = textHeight > height;
      let offset = 0;
      const o = {
        render: () => {
          (h.clearRect(x - width, y, x + 5, y + height),
            mustScroll &&
            h
              .drawImage(IMGUP, x - 8, y)
              .drawImage(IMGDN, x - 8, y + height - 8)
              .fillRect(
                x - 1,
                y +
                10 +
                (textHeight - height
                  ? Math.min(1, Math.max(0, offset / (textHeight - height)))
                  : 0) *
                (height - 20 - (height / textHeight) * (height - 20)),
                x + 1,
                y +
                10 +
                (textHeight - height
                  ? Math.min(1, Math.max(0, offset / (textHeight - height)))
                  : 0) *
                (height - 20 - (height / textHeight) * (height - 20)) +
                (height / textHeight) * (height - 20)
              ),
            h
              .setClipRect(x - width, y, x, y + height)
              .setFontAlign(-1, -1)
              .drawString(txt.join('\n'), x - width, y - offset)
              .setClipRect(0, 0, 480, 320));
        },
        remove: () => {
          Pip.removeListener('knob2', onKnob2);
        }
      };
      function onKnob2(dir) {
        ((offset = Math.max(0, Math.min(textHeight - height, offset + 10 * dir))),
          o.render(),
          h.flip());
      }
      return (o.render(), mustScroll && Pip.onExclusive('knob2', onKnob2), o);
    }),
    (Pip.renderBlock = (x, y, w, t1, t2) => {
      (h
        .drawImage(icons.fadedown, x + w, y)
        .drawLine(x, y, x + w, y)
        .setFont('Monofonto14'),
        h.setFontAlign(-1, -1).drawString(t1, x + 4, y + 7),
        h.setFontAlign(1, -1).drawString(t2, x + w - 4, y + 7));
    }),
    (Pip.renderDebugInfo = () => {
      if ((h.clearRect(120, 0, 360, 17), Pip.settings.debug)) {
        let mem = process.memory(0);
        h.setFont('Fixedsys16')
          .setFontAlign(0, 0)
          .drawString(
            `Free mem:${mem.free}/${mem.total}, stack:${mem.stackFree}`,
            240,
            8
          )
          .setFont('Monofonto14');
      }
    }),
    (Pip.renderHeader = () => {
      const MODE = Pip.getMode(Pip.MODE),
        HEADER = MODE.header(),
        Y = 18;
      h.clearRect(15, 9, 465, 39).drawImage(icons.fadedown, 15, Y);
      const titleX = Math.max(34, Pip.drawIcons());
      h.drawLine(15, Y, titleX + 13, Y)
        .setFont('Monofonto18')
        .setFontAlign(-1, 0)
        .drawString(MODE.title, titleX + 23, Y);
      let titleWidth = h.stringWidth(MODE.title);
      h.setFont('Monofonto14');
      let x =
        465 -
        HEADER.reduce(
          (n, o) => h.stringWidth(o[0]) + 30 + h.stringWidth(o[1]) + n,
          0
        );
      (h.drawLine(titleX + titleWidth + 33, Y, x + 10, Y),
        HEADER.forEach((o, i) => {
          let lastx = x;
          (h.setFontAlign(-1, 0).drawString(o[0], x + 10, 32),
            (x += h.stringWidth(o[0]) + 30 + h.stringWidth(o[1])),
            h.setFontAlign(1, 0).drawString(o[1], x - 4, 32),
            h.drawImage(icons.fadedown, x, Y).drawLine(lastx + 10, Y, x, Y));
        }),
        Pip.settings.debug && Pip.renderDebugInfo(),
        Pip.timers.timeHeader && clearTimeout(Pip.timers.timeHeader),
        (Pip.timers.timeHeader = setTimeout(
          function () {
            ((Pip.timers.timeHeader = void 0),
              Pip.CURRENT.fullscreen || Pip.renderHeader());
          },
          6e4 - (Date.now() % 6e4)
        )));
    }),
    (Pip.renderFooter = () => {
      const FOOTER = Pip.getMode(Pip.MODE).footer,
        L = FOOTER.length,
        Y = 300;
      h.setFont('Monofonto14').setFontAlign(0, 0);
      let pad =
        (450 - FOOTER.reduce((n, foot) => h.stringWidth(foot.txt) + n, 0)) /
        (2 * L),
        x = 15;
      (h.clearRect(0, 286, 479, 314),
        FOOTER.forEach((foot, i) => {
          x += pad;
          let w = h.stringWidth(foot.txt);
          (i == Pip.MENUX && Pip.shadeBox(x - 8, 286, x + 8 + w, 311),
            h.drawLine(x - pad, Y, x - 8, Y).drawString(foot.txt, x + w / 2, 301),
            h.drawLine(x + w + 8, Y, x + w + pad, Y),
            h.setBgColor(0),
            (x += w + pad));
        }),
        h.drawImage(icons.fadeup, 15, 276).drawImage(icons.fadeup, 465, 276));
    }),
    (Pip.loadMenu = (srcOverride, params) => {
      let src = srcOverride || Pip.getMode(Pip.MODE).footer[Pip.MENUX].src;
      setTimeout(() => {
        Pip.CURRENT.id &&
          (Pip.log(
            `Pip.loadMenu:  menu ${Pip.CURRENT.id} already loaded when loading ${src}!`,
            'errors.txt'
          ),
            Pip.remove());
        try {
          const s = new Date();
          (h.clearRect(BR),
            (Pip.CURRENT = eval(fs.readFileSync('JS/' + src))(params)),
            debug(`${src} eval ${Math.round(new Date() - s)}ms`),
            (Pip.menuChanging = !1));
        } catch (e) {
          (print('FAILED TO LOAD', src, e, '\n', e.stack),
            (Pip.CURRENT = { remove: () => { } }),
            h
              .setFont('Monofonto14')
              .setFontAlign(0, 0)
              .drawString('UNABLE TO LOAD ' + src, 240, 160),
            (Pip.menuChanging = !1));
        }
      }, 0);
    }),
    (Pip.changeMenu = (srcOverride, params) => {
      if (Pip.menuChanging)
        return (debug('**** Menu change already in progress, ignoring'), void 0);
      ((Pip.menuChanging = !0),
        Pip.remove(),
        process.memory(!0),
        h.clear(),
        Pip.renderHeader(),
        Pip.renderFooter(),
        h.flip(),
        Pip.loadMenu(srcOverride, params));
    }),
    (Pip.currentDateTime = (time) => {
      let now = time;
      time || (now = Pip.getDateAndTime());
      let hr,
        year = now.getFullYear().toString().padStart(4, 0),
        month = (now.getMonth() + 1).twoDigit(),
        day = now.getDate().twoDigit();
      ((hr = Pip.settings.hr12
        ? ((now.getHours() + 11) % 12) + 1
        : now.getHours().toString().padStart(2, 0)),
        Pip.settings.year4 || (year = year.slice(2, 4)));
      let r = [`${hr}:${now.getMinutes().twoDigit()}`];
      switch (Pip.settings.timeFormat) {
        case 0:
          ((r[1] = `${day}.${month}.${year}`), (r[2] = r[0] + ', ' + r[1]));
          break;
        case 1:
          ((r[1] = `${month}.${day}.${year}`), (r[2] = r[0] + ', ' + r[1]));
          break;
        case 2:
          ((r[1] = `${year}-${month}-${day}`), (r[2] = r[1] + ' ' + r[0]));
      }
      return ((r[3] = now.getHours() < 12 ? 'AM' : 'PM'), r);
    }),
    (Pip.typeText = (txt, x, y, W, H, font) => {
      font || (font = 'Monofonto16');
      let clicks = [
        'W\0O\0I\0\xC9\xFF\xD2\xFE\xC7\xFEr\0A\x01m\xFF\xC2\xFD\x0F\xFF\xF7\0y\0\xB4\xFE&\xFE\xF7\0\xFC\x02o\x01H\xFF\x8D\xFE\xED\xFF\xDB\x01\xC4\0\x19\xFFW\xFEW\xFFy\x01\xA2\x01y\0\xCB\xFE4\xFE\x85\xFF\\\0\x04\0\xD6\xFF\xC0\xFE\x88\xFF\x95\x01B\x01\x15\0\xC4\xFE\x87\xFE\x8F\0\xE3\0Q\0\xC2\xFF\xFC\xFEC\x01\x8F\x01K\xFFo\xFFu\0\xAB\x01V\x01\xC8\xFE\xC9\xFF\xF5\0\xA4\0\x83\0\x10\xFE\x8D\xFD\x07\xFFg\xFFo\x01\x8D\xFF\xF0\xFD\xEB\xFF<\xFFH\x02-\x02q\xFE\xA7\0\x1E\xFD\xF6\xFD\xE7\x06\x99\x03\x1A\0=\xFB/\xF65\x06\x97\x0B/\xFD\xE2\xFBJ\xF9O\xFFy\f\x87\xFF\xA1\xF8$\0D\xFD\x83\x02\xFD\x03\x17\xFC2\x02\x96\xFF\x9B\xFAf\x02X\x02\xA1\xFF\xF2\x01\xA5\xFE\x17\xFE\x8A\xFFi\0\xC8\x03w\x02G\xFE:\xFD;\xFF)\x01\xD5\0\x07\xFF\x99\x01\x02\xFFy\xFC\xFC\x01a\x04]\x02\b\xFE\x13\xF5\xBE\xFDH\x0BX\x03\x90\xFE\xC2\xFB\xFD\xF5\x0B\x04\x8A\x0Bp\xFEz\xFF\xED\xF6\xC8\xF5\xFD\x114\r\xB2\xF7\xF6\xF9\x03\xF2\f\x01\x81\x1A\x14\xFF\b\xF6\x99\xFEY\xED\xDE\x07#\x17\x9A\xF7\xA0\xFF\xEE\xF3\xB7\xED\xBB\x1B\xC4\x0B\xF3\xEF\xF1\x01\xE2\xF0\x7F\0M\x19\xA7\xF6\xF4\x01u\x06\x19\xE8\x10\x03\xF7\f\xF2\xFEU\r\xF0\xF6\xE8\xEFE\n>\0\x97\0~\n\xF7\xF5\xBD\xF7L\x03\x84\xFF%\x0B\xE5\x04\x80\xF2\xA2\xF8W\xFE-\x03Y\x0F\x1F\x07\x95\xF5\xF6\xF0\xB9\xF9\x05\x0B\xB3\x13\'\x02\x8B\xF02\xF6\x89\x02\x9A\n\x7F\b]\xFBA\xF38\xFA\x02\x02w\t+\n\xB3\xFB8\xF4\x80\xFBv\x02k\t\x15\x06\n\xFC5\xFC\x1C\xFB[\xFC"\x07\xE6\x07+\xFEL\xF9D\xFA\x05\x04U\t\xE4\xFF\xA9\xFA\xA6\xFD\x16\xFES\x01\xA0\x03W\x02\xFF\xFF\x18\xF9\xB3\xF9 \x04\xBF\x07\xDF\x01\xCF\xFC\x0E\xFCT\0\xBA\x02i\0{\xFFB\xFE\n\xFE\xDE\x03\xE3\x04\x17\0z\xFB\x8D\xFA\xA9\x01\xAD\x069\x01z\xFBP\xFC"\x01\xDB\x04I\x01\x18\xFEG\xFE<\xFD\x95\xFE\xB0\x04\xF1\x05\xEF\xFFz\xF7\x80\xF7\xCA\x03\xF5\bR\x03O\xFD@\xFB\xD8\xFD\xF1\x017\x02\x9A\x02\x96\x011\xFB\x82\xFA\xBC\x01\xFD\x05\xCB\x04\xF5\xFDe\xF9\xCA\xFC8\x02\xF3\x04\xE7\x02\x7F\xFDg\xFA\xDA\xFDr\x02\xC4\x04\xBF\x03J\xFF\xC6\xFB\xFD\xFC\xE3\xFF\f\x02\xC6\x02I\xFF;\xFC.\xFE\xEF\x01-\x04\x90\x01\x81\xFCw\xFD1\x01\xA6\x01|\x01\x7F\0b\xFEL\xFE@\xFE(\0U\x02"\0z\xFE\x1D\0\xA8\x01\xC5\0\xC2\xFD%\xFD\x19\x01C\x02\x1F\0\x19\0V\x01\x92\0\xE7\xFD\xD1\xFEN\x02\xBD\x02\x7F\xFFL\xFC\xC1\xFE\xA9\x03y\x03^\xFF \xFDW\xFD\x83\0i\x02\x93\x007\0\xE2\xFE\xE2\xFC\x99\xFF!\x01K\x014\x02\x91\xFF\xA3\xFDY\xFE\xF5\xFFI\x03\xA0\x02\x13\xFE\xEA\xFCG\xFF\x14\x02\xAC\x01\xEC\xFD\xC5\xFD\x8C\0x\0 \0',
        't\0E\0\x90\xFF4\0}\xFF\xD3\xFF\xFC\0\xC8\xFF\xCE\xFF\xE4\xFFT\xFF \x01F\0\x9A\xFEy\0=\0B\0\xC1\0e\xFE\x9D\xFFD\x01\xC7\xFF\xBC\0\xE6\xFFH\xFE\x1C\0\xA5\0[\x01\xCD\0\xCF\xFD\x81\xFEo\0\xF1\x01\x92\x01\xD4\xFE\xBA\xFE\x8E\xFE\xD7\xFF]\x03\x86\0\x95\xFE!\xFF\x8F\xFD\xC1\x012\x03,\xFF\xA9\xFF\xFF\xFD\x7F\xFEb\x02\x1D\0\xC6\0W\x01\xAB\xFE\x8A\xFE\x8F\xFD\x10\x01\x9A\x041\0K\xFE.\xFD9\xFEG\x04`\x01\xDF\xFEy\0\xF8\xFB\x1D\0v\x04\x87\xFE\x9E\0\xD1\xFF5\xFC\f\x03\x92\0\x01\xFE\xAA\x03\x8A\xFDw\xFD{\x04\0\xFE\xE8\xFE\x80\x02\xE3\xFC\x8E\x02z\x02\x90\xFAW\x01\xB7\0\xC1\xFD]\x05\xD2\xFF\x03\xFC\x10\x01\xD4\xFCe\x01Q\x06\x9E\xFD)\xFE\x99\xFE\x13\xFC\x9D\x048\x05\xA4\xFE\xD6\xFD\xC4\xFA\xA8\xFD>\x06\x1A\x05\xFD\0v\xFC\xE7\xF7\x93\xFD\xDF\x06\x8F\x07\x1C\x019\xFA&\xF8\xB2\xFE\x99\x06\xCE\x06\x8B\x01V\xFA\xA3\xF7\x83\xFE)\x07\x97\x07a\x01\xB9\xF9b\xF7\xB6\xFE\xA2\x06\xA6\x07\x01\x02\x05\xFA\xD1\xF7P\xFE\x9D\x05=\x07\xA9\x02\xBD\xFA\t\xF8\x17\xFEN\x05\xF5\x061\x02\xF7\xFA*\xF9{\xFE$\x04\x12\x06\x8B\x02\xB3\xFB\xCC\xF9y\xFE\xBD\x03\x1C\x05\xB5\x01\x84\xFC\xFA\xFB\x18\xFF\xBF\x01\xFF\x02\x82\x01\xE5\xFE\xE4\xFD_\xFE\xF1\xFF=\x02\xD8\x01q\xFFz\xFE\xA7\xFEQ\0>\x01\x87\0&\0\xF1\xFF \xFF\x05\xFF\x18\0\xC2\0\x16\x01u\0M\xFF=\xFF;\xFFd\xFF\xBE\0\xEC\x01\x1B\x01B\xFF\x83\xFD\xD2\xFD\xA0\x01\xA8\x03.\x01\xE0\xFD\x97\xFC\xE4\xFE\xBD\x02I\x03r\0\xB2\xFD\xA5\xFC\x13\xFF\xDD\x02Q\x03\x9D\0|\xFD\xB5\xFC\\\xFF\xBD\x02\x84\x02N\0`\xFE\x8E\xFDe\xFFw\x01\x0E\x02\xF7\0\xEF\xFE\xB1\xFD\xF1\xFE<\x01\xEA\x01T\x01\x11\xFF\xAB\xFD\xF0\xFE\xDE\0\xE8\x01p\x01`\xFF\x95\xFD\xCB\xFE\x15\x01\x15\x02\xC7\0\x8B\xFE\x8F\xFE\xFB\xFF\x13\x01\xE9\0\xAE\xFF\x03\xFF\xC0\xFF\x9C\0~\0\xE3\xFFv\xFF\xCB\xFFe\0\x8F\0\xD5\xFF/\xFF\xBB\xFF\xB1\0\xE9\0\xEC\xFF\x04\xFFP\xFF9\0\xCB\0\x89\0\xDB\xFFR\xFF\xCD\xFF\x17\0\x11\0;\0\x1F\0\x15\0\xF2\xFF\xC6\xFF\xAF\xFF\xFA\xFFn\0|\0\xEE\xFFT\xFF\x8C\xFF=\0\xD8\0z\0u\xFF\x07\xFF\xBC\xFF\xDF\0\xED\0\xDB\xFF\t\xFFt\xFFn\0\xAA\0\x18\0\xB9\xFF\xB5\xFF\xDE\xFF',
        '\xC1\0\xD8\0*\0[\0]\x01+\x01E\x02\x0B\x02\xDB\0%\x01\x94\0=\x01\xF1\xFFH\xFE\xFF\xFEX\0\xF5\xFF\xBC\xFE\x16\xFE\xC4\xFF\xB2\xFE1\xFC\x9E\xFD\xFC\xFD\xFC\xFE(\x02D\xFD\xC7\xFE\xD5\x03\x95\x008\x04\xE8\xFE\xA7\xFA\xF8\b\xFC\x07\xCA\xFB*\xFF\b\xFC$\x05\x1B\f\xFB\xF5\xBE\xF7\n\x05J\xFF\xF1\x01\xC3\xFE\xFE\xF6\xCF\x03F\x04r\xFA\x8D\x02\xC6\x04\x8C\xF9\xF0\x006\xFFJ\xFB\'\x0EG\x02\x93\xECZ\x02\x05\x058\x05c\x0F\xCD\xED\xD1\xF7\xD0\x0EA\xF7I\x02\x15\x06\xC2\xF5\xB9\b\xBB\xF9\x1B\xEF7\r\x96\x06\x07\xFDC\0\xD8\xF4\x11\x04\xE1\x13\x1E\x03[\xF7\xDD\xF7{\xFDr\x07\x06\n%\xF9\xB8\xF7w\xFF\x19\xFB\x8F\x05b\n\xB8\xFC;\xFC\xE5\xF7\x89\xFBO\x0E\xDE\x07W\xFCR\xF6\x03\xF6\xD1\x05\x04\x0Ey\x03\f\xFB\xA3\xF7\xAB\xFD\x83\x066\x06\xD9\xFF\x17\xFA\x98\xFA\xFC\xFC\xC9\x02\xE7\x04+\0\xB0\xFA\xB5\xF6,\xFD\x97\t\xA9\n\xE5\x02x\xF8\xC9\xF6\xC4\x02@\fw\t\x1B\xFD\xDF\xF3T\xFB\xE6\x07\x84\n+\x02\x85\xF6"\xF7E\xFFD\x07`\x07\x99\xFF\x9C\xF7q\xF5\xC6\xFCz\x05p\b\xBA\0\xB4\xF6\xE7\xF6\t\x01\x18\n\xAF\b:\xFF\x04\xF8\x87\xFB\x9F\x04\xF5\t\xFF\x05L\xFCw\xF9\xF2\xFC9\x01\xC7\x04\xB3\x04\xB6\xFE\xFF\xF76\xF9\xEA\0\x8A\x07\xC1\x03\xBD\xFA\x18\xF9M\xFE\x84\x06\xEB\x07D\xFF\xA8\xF8\x18\xFB\x1F\x03N\x07\xEE\x03\xEE\xFD\xA1\xFCh\xFEt\x01%\x03\x10\x01\x81\xFE#\xFC\x95\xFCu\xFFp\x03h\x01-\xFBe\xFA\x80\xFFX\x05<\x04\xCB\xFF\x85\xFD\x1C\xFE1\0\xC4\x01\xF2\x02\xEA\0\xCB\xFE\x04\xFEh\xFF>\x04\x84\x05\x9A\0\x9B\xFA\x9E\xFB0\x02\xB6\x04\xFF\0\b\xFD\x05\xFDK\xFF+\x02+\x03\xC1\0\x9C\xFD\xA9\xFC8\xFF0\x02\xCE\x024\x01"\xFE$\xFE\xF3\xFF\xDB\0V\0\xD8\xFD\xE0\xFD\xD1\xFE\x03\xFF]\xFF\xB6\xFF\xA1\xFE\xD1\xFD_\xFF\x99\0\xC7\x01\xA1\x01\x88\xFF\xD9\xFEb\x01\x01\x03\xE3\x02>\x02\xEE\0\x95\xFF\x93\0v\x02Y\x02\xED\0 \xFE\x95\xFE?\0\x12\0F\xFF\x17\xFF\x83\xFE\x9C\xFD\x90\xFEy\xFE\xBF\xFE\xBF\xFF\xAB\xFD\xDA\xFDW\x01\xDC\x01\x1C\0\xBB\xFF\xEF\0\xAF\x02\xD1\x03\xDF\0W\xFF^\0\x19\0p\xFF\xA6\xFE\x04\0q\x01\n\xFF\xF9\xFC\x87\xFF:\x02e\0{\xFDd\xFD0\0\x97\x02t\x014\xFF\x03\xFF9\x01\xB7\x01\x07\0\x15\xFF!\xFF\x1B\x01\xC0\0\xC5\xFF \x01J\0U\xFFX\xFF\xC3\xFF\x1D\x01\xFF\0=\xFE\0\xFD\xF5\xFE\x85\0\xF3\xFFe\xFF\x91\xFF#\0&\0\x88\xFF(\0|\0Z\0\x04\x01\xCD\0+\xFFs\0\x1A\x01\x1F\0\xDB\xFF\x1D\0"\x01+\x02!\x02\x04\0\xCC\xFFV\xFF\xB7\xFE;\xFF\x90\xFF\xDF\xFFj\0\xFA\xFF(\0\x81\0\xFA\xFF\x14\0\xEF\0',
        '\x9F\0\xAB\x01\xE8\x01\xC2\x01m\0\xF0\xFFy\x01\x7F\x01p\xFF\xEC\xFEr\xFFj\xFF\xC6\xFE8\xFF_\xFF\xD3\xFD\xEB\xFES\x01\x9F\0\xBC\xFFt\xFF\x10\0\x82\x01p\x01r\0L\xFFq\0f\x01P\xFF\x95\xFE\x82\xFFW\x01\x16\x01Y\xFFG\xFFL\0\x8F\x016\x01\xF6\xFE\x18\xFE\x9A\0\xF1\xFF;\xFFe\0c\xFF\xE8\xFFS\0\xBE\xFF)\x01\x93\0\xE0\xFFO\x01]\xFE]\xFE\x1C\x02\x19\0\xA8\xFD\xD5\xFC\x88\xFD}\x01s\x01L\xFFK\xFF\xEA\0\x86\x02v\0*\xFED\0\xAA\x04\x90\x03\x1D\xFE\xE1\xFCI\0\x0B\x03:\x02\x0B\xFE\xAA\xFC\xD3\0\xF2\x01\\\xFFU\xFD\x86\xFD\xC3\xFF$\0\x8D\xFE\xB1\xFE\x96\xFE\xCE\0\x84\x03\xF0\0\xA0\xFE\xD3\xFB\xF5\0\xDF\x07\x8A\x02\xB5\xFE\xCD\xFCm\xFDs\b\x97\x03X\xFA,\xFF"\xFB\xF4\x01\xE4\t\xDD\xF9\xC1\xFB\xDE\xFF\r\xFC\x1F\x0B\xDA\xFC\0\xEF=\x02+\x05\xA2\t\xA1\x04\xBA\xE9k\xFA\xB7\x12\r\x0B#\x03#\xF0\xEE\xF0\xA3\x0E\x17\r\xC3\xFC\x15\xF9C\xF6y\x03J\x0Bj\xFFT\xFB\x8D\xFE\xF4\xFF\x0F\x04\xD1\x01\xE9\xF9T\xFE\x87\x07\x1A\x06w\x01\x9E\xF8\xAF\xF3)\x03\xBC\x0Bs\x06)\xFB\x0B\xEFK\xF87\n\x92\x0Ba\x01\x8B\xF4\xBE\xF4\xA9\x037\x0BC\x06\xA2\xFCG\xF9\x05\xFF\x1F\x04\xF6\x02\xEF\xFE-\0u\x03\x83\x016\xFDB\xFD\xAF\x01S\x05\x18\x03\x95\xFD\x06\xFA\xA4\xF9@\xFE\x9C\x03\xD2\x04\x02\x03\x8B\xFC\x97\xF7\x82\xFA\xF7\x01\x01\t\xFE\x05\xAC\xFC\x13\xF8\xE3\xFA\xC3\x036\x0B+\bn\xFF\x91\xF7t\xF6W\xFF\x91\n;\f\r\x02I\xF5-\xF2\xA1\xFD{\nd\f\x11\x02-\xF3\x80\xF0+\xFD?\n~\rY\x02y\xF5\x8A\xF4\xED\xFD \t2\f\xCD\x03\x1F\xFA@\xF6\x8C\xF9&\x03\x0E\n\x13\b\x8F\xFE\r\xF5\x7F\xF6K\x01B\tY\b\x10\0b\xF8\xC4\xF8\x15\xFF"\x06[\t$\x04:\xFC\b\xF8\xF4\xFB\xBB\x03\xB3\x06q\x04F\xFE\xD2\xF8\x11\xFAJ\xFF\xB9\x03\xFB\x04\x91\x01\'\xFB7\xF83\xFD-\x04\x8C\x07L\x03\x9D\xFC\xA6\xF9V\xFC\x1F\x03\x10\b\xD2\x05*\xFF\x02\xFA\xCA\xFAC\x01q\x06\xB5\x05\x1B\0\0\xFA\xEA\xF7V\xFC\x95\x03\xFE\x06\x9F\x019\xFA&\xF9y\xFE\x13\x04\xDA\x05\xDE\x02\xEC\xFC\xD4\xFA\xBD\xFE\xF9\x03\x14\x06\xC3\x03\xEA\xFE\x06\xFC6\xFD$\x02\x1C\x04\xF4\x01\x1C\xFF\x82\xFC\xCD\xFC\x05\xFF\xE6\x01\xC6\x02o\xFF\xBC\xFBM\xFC\xF9\xFEd\x02<\x03\x7F\0;\xFE\xC3\xFEg\0v\x01\xC6\x01\xC7\x01H\x01\x9C\xFEL\xFE*\xFF\xAC\0l\x02\x83\0U\xFDG\xFD\xC9\xFF\x17\x02\xFA\xFF\x9E\xFE\xD9\xFE\x96\xFE<\0\xC3\0g\0\x0E\x01\xB5\x01\x99\0#\xFF\x01\xFF\xF8\x01\\\x03\x8A\0\n\xFE\xCD\xFE:\0N\x01\x90\0\xCB\xFE\x94\xFD\xE5\xFC\xF9\xFDH\0\x91\x02\xB0\x01l\xFE{\xFD\xF3\xFF\xB6\x02\x7F\x03\x97\x01O\0\xF4\xFF\x03\0k\0\xAB\xFF\x8E\0\x18\x02"\xFF\xA2\xFCi\xFE$\x01T\x01\xE6\xFDh\xFB\xEF\xFD\x10\x01\x0F\x01E\xFFJ\xFEI\0\xAF\x01J\x01\xDE\0\xD4\0\xDA\x01\f\x02\r\0\xD2\xFE\x87\xFF'
      ];
      (x || (x = 0),
        y || (y = 0),
        W || (W = h.getWidth() - x),
        H || (H = h.getHeight() - y));
      const x0 = x,
        y0 = y;
      Pip.timers.typeText && clearTimeout(Pip.timers.typeText);
      let wordIndex = 0,
        charIndex = 0;
      const words = txt.split(/\x20|\xa0|\x09/);
      let word = words[0];
      h.setFont(font).setFontAlign(-1, -1).setColor(3);
      const lineH = h.getFontHeight();
      let cursorTimer,
        flipCtr = 0;
      return new Promise((resolve) => {
        function drawChInternal(ch) {
          if (
            (1 == charIndex &&
              x + h.stringWidth(word) > x0 + W &&
              ((x = x0), (y += lineH)),
              y > y0 + H - lineH &&
              (h.setClipRect(x0, y0, x0 + W - 1, y0 + H - 1),
                h.scroll(0, -lineH).flip(),
                h.setClipRect(0, 0, 479, 319),
                (y -= lineH)),
              charIndex <= word.length)
          )
            (h.drawString(ch, x, y, !0),
              (x += h.stringWidth(ch)),
              ('\n' == ch || x > x0 + W - 6) && ((x = x0), (y += lineH)));
          else {
            if (
              ((charIndex = 0), x > x0 && (x += 8), !(++wordIndex < words.length))
            )
              return (
                Pip.timers.typeText && clearTimeout(Pip.timers.typeText),
                delete Pip.timers.typeText,
                resolve({ x: x, y: y }),
                void 0
              );
            word = words[wordIndex];
          }
        }
        (function drawCharacter() {
          let ch = word[charIndex++];
          if ('\xA7' == ch)
            ((cursorTimer = setInterval(() => {
              h.setColor(++flipCtr % 10 < 5 ? 3 : 0)
                .fillRect(x, y, x + 6, y + 15)
                .flip();
            }, 50)),
              (Pip.timers.typeText = setTimeout(() => {
                (h
                  .setColor(0)
                  .fillRect(x, y, x + 6, y + 15)
                  .setColor(3)
                  .flip(),
                  clearInterval(cursorTimer),
                  drawCharacter());
              }, 600)));
          else {
            if (
              (h.setFont(font).setFontAlign(-1, -1),
                drawChInternal(ch),
                charIndex <= word.length &&
                (3 & flipCtr++
                  ? Pip.blitScreen(
                    h,
                    Object.assign({ y1: y, y2: y + 15 }, Pip.blitOptions)
                  )
                  : h.flip(),
                  (Pip.lastFlip = getTime()),
                  ('\n' != ch || wordIndex > 0) &&
                  Pip.audioStartVar(clicks[Math.randInt(clicks.length)]),
                  digitalRead([BTN_STATS, BTN_ITEMS, BTN_DATA, ENC1_PRESS])))
            )
              for (; wordIndex < words.length;)
                ((ch = word[charIndex++]), '\xA7' != ch && drawChInternal(ch));
            wordIndex < words.length &&
              (Pip.timers.typeText = setTimeout(drawCharacter, Math.randInt(25)));
          }
        })();
      });
    }),
    (Pip._mPrev = null),
    (Pip.checkSelectorSwitch = () => {
      let v = MODE_SELECTOR.analog(),
        m = 0;
      if (v > 0.9)
        return (
          pinMode(MEAS_ENB, 'input'),
          pinMode(MEAS_ENB, 'opendrain'),
          MEAS_ENB.write(0),
          void 0
        );
      (v < 0.1
        ? (m = 4)
        : v < 0.3
          ? (m = 3)
          : v < 0.5
            ? (m = 2)
            : v < 0.7 && (m = 1),
        m == Pip._mPrev &&
        m != Pip.MENUX &&
        (Pip.emit('menuX', m), Pip.kickIdleTimer()),
        (Pip._mPrev = m));
    }),
    (Pip.screenGlitch = () => {
      if (Math.randInt(2))
        return (
          (Pip.blitOptions.anim = [
            { filter: 858993459, ydiff: 0 },
            { filter: 858993459, ydiff: 1 },
            { filter: 322122547, ydiff: 1 },
            { filter: 288568115, ydiff: 1 },
            { filter: 286470963, ydiff: 1 },
            { filter: 286327075, ydiff: 1 }
          ]),
          void 0
        );
      ((Pip.blitOptions.anim = [
        [
          { filter: 257 },
          { filter: 822149411, ydiff: 7 },
          { filter: 50397475, ydiff: 6 },
          { filter: 19988771, ydiff: 5 },
          { filter: 16974115, ydiff: 4 },
          { filter: 16855331, ydiff: 3 },
          { filter: 16843571, ydiff: 2 },
          { filter: 269488947, ydiff: 1 },
          { filter: 16843043, ydiff: 1, y: 0 }
        ],
        [
          { filter: 257 },
          { filter: 16843043, y: 8 },
          { y: 4 },
          { y: 0 },
          { y: -4 },
          { y: -8 },
          { y: -4 },
          { y: 0 },
          { y: 2 },
          { y: 0 },
          { y: -2 },
          { y: 0 },
          { y: 1 },
          { y: 0, ydiff: 1, filter: 16843043 }
        ],
        [
          { filter: 257 },
          { filter: 16843043, y: -200 },
          { y: -100 },
          { y: 0 },
          { y: -120 },
          { y: -60 },
          { y: 0 },
          { y: -40 },
          { y: -20 },
          { y: 0 },
          { y: -20 },
          { y: -10 },
          { y: 0, ydiff: 1, filter: 16843043 }
        ]
      ][Math.randInt(3)]),
        setTimeout(
          () => Pip.audioStart(`SOUND/FX/STATIC/C_0${Math.randInt(5) + 1}.WAV`),
          100
        ));
    }),
    Pip.on('mode', (mode, force) => {
      if ((Pip.CURRENT.notDefault && (force = !0), Pip.MODE == mode && !force))
        return;
      ((Pip.MODE = mode), Pip.changeMenu(), Pip.playSound('MODE'));
      const b = Pip.settings.brightness;
      switch (mode) {
        case 0:
          Pip.fadeTo([
            { pin: LED_STATS, target: b },
            { pin: LED_ITEMS, target: 0 },
            { pin: LED_DATA, target: 0 }
          ]);
          break;
        case 1:
          Pip.fadeTo([
            { pin: LED_STATS, target: 0 },
            { pin: LED_ITEMS, target: b },
            { pin: LED_DATA, target: 0 }
          ]);
          break;
        case 2:
          Pip.fadeTo([
            { pin: LED_STATS, target: 0 },
            { pin: LED_ITEMS, target: 0 },
            { pin: LED_DATA, target: b }
          ]);
      }
      Pip.screenGlitch();
    }),
    Pip.on('menuX', (d) => {
      ((Pip.MENUX = d),
        Pip.changeMenu(),
        Pip.playSound('TAB'),
        Pip.screenGlitch());
    }),
    (Pip.setBrightness = (v) => {
      ((Pip.settings.brightness = v),
        Pip.fadeTo([
          { pin: LCD_BL, target: v, stepFactor: 1.1 },
          { pin: LED_STATS, target: 0 === Pip.MODE ? v : 0, stepFactor: 1.1 },
          { pin: LED_ITEMS, target: 1 === Pip.MODE ? v : 0, stepFactor: 1.1 },
          { pin: LED_DATA, target: 2 === Pip.MODE ? v : 0, stepFactor: 1.1 },
          { pin: LED_RED, target: v, stepFactor: 1.1 },
          { pin: LED_GREEN, target: v / 2, stepFactor: 1.1 },
          { pin: LED_DOWNFIRE, target: Pip.charging ? v : 0, stepFactor: 1.1 }
        ]));
    }),
    (Pip.checkChargeStatus = (force) => {
      if (VUSB_PRESENT.read()) {
        const b = Pip.settings.brightness;
        if (Pip.charging) {
          const s = ~~getTime() % 6;
          Pip.battLevel >= C.BAT_FULL_LEVEL
            ? 0 == s && Pip.fadeTo({ pin: LED_DOWNFIRE, target: b })
            : CHARGE_STAT.read()
              ? s % 2 == 0
                ? Pip.fadeTo({ pin: LED_DOWNFIRE, target: 0 })
                : Pip.fadeTo({ pin: LED_DOWNFIRE, target: b })
              : 0 == s
                ? Pip.fadeTo({
                  pin: LED_DOWNFIRE,
                  target: b / 8,
                  stepFactor: 1.03
                })
                : 3 == s &&
                Pip.fadeTo({ pin: LED_DOWNFIRE, target: b, stepFactor: 1.03 });
        } else
          (Pip.kickIdleTimer(),
            (Pip.charging = !0),
            Pip.fadeTo({ pin: LED_DOWNFIRE, target: b }),
            Pip.sleeping ||
            (debug('USB power connected'),
              Pip.audioStart('SOUND/FX/ARC_03.WAV'),
              Pip.CURRENT.fullscreen || Pip.renderHeader(),
              h.flip()),
            Pip.checkBatteryLevel(!0));
      } else
        Pip.charging &&
          ((cmode = !1),
            (Pip.charging = !1),
            Pip.kickIdleTimer(),
            Pip.fadeTo({ pin: LED_DOWNFIRE, target: 0 }),
            Pip.sleeping ||
            (debug('USB power disconnected'),
              Pip.checkBatteryLevel(!0),
              Pip.CURRENT.fullscreen || Pip.renderHeader(),
              h.flip()));
      (Pip.checkBatteryLevel(force),
        Pip.sleeping
          ? !Pip.charging &&
          Pip.timers.chargeStatus &&
          (clearInterval(Pip.timers.chargeStatus),
            delete Pip.timers.chargeStatus,
            setWatch(Pip.startChargeStatusTimer, VUSB_PRESENT, {
              edge: 'rising',
              repeat: 0,
              debounce: 100
            }),
            MEAS_ENB.write(1))
          : Pip.checkHeadphoneState());
    }),
    (Pip.startChargeStatusTimer = () => {
      Pip.timers.chargeStatus ||
        (Pip.timers.chargeStatus = setInterval(Pip.checkChargeStatus, 1000));
    }),
    (Pip.checkBatteryLevel = (force) => {
      MEAS_ENB.write(0);
      {
        let v,
          vPrev = 0;
        for (; Math.abs((v = VBAT_MEAS.analog()) - vPrev) > 0.01;) vPrev = v;
        ((v *= 2 * E.getAnalogVRef()),
          (Pip.battLevel =
            Pip.battLevel && v > 0 && !force
              ? C.BAT_SMOOTHING * v + (1 - C.BAT_SMOOTHING) * Pip.battLevel
              : v));
      }
      const chg = VUSB_PRESENT.read(),
        vLo = chg ? 3.6 : 3.5,
        vHi = chg ? 4.2 : 4.1;
      Pip.lowBatt = Pip.battLevel < C.BAT_LOW_LEVEL && !chg;
      const battIcon = Math.round(
        9 * E.clip((Pip.battLevel - vLo) / (vHi - vLo), 0, 1)
      );
      (battIcon != Pip.battIcon || Pip.lowBatt) &&
        ((Pip.battIcon = battIcon),
          Pip.CURRENT.id && !Pip.CURRENT.fullscreen && Pip.drawIcons());
      let isCritical = !chg && Pip.battLevel < C.BAT_CRITICAL_LEVEL;
      return (
        isCritical &&
        (LED_GREEN.write(0),
          force
            ? (Pip.log(`Battery critical (${Pip.battLevel.toFixed(2)} V) !`),
              digitalPulse(LED_RED, 1, [100, 200, 100, 200, 100]),
              MEAS_ENB.write(1))
            : Pip.sleeping ||
            (Pip.log(
              `Battery critical (${Pip.battLevel.toFixed(2)} V) - going to sleep`
            ),
              h.clear(),
              clearWatch(),
              Pip.goToSleep(() =>
                Pip.typeText(
                  '*************** PIP-OS(R) V5.0.1.4 ***************\n\n> SYSTEM STATUS: CRITICAL\n> MICROFUSION CELL OUTPUT: 0.03%\n> POWER RESERVE: EXHAUSTED\n\nWarning: Power levels insufficient for continued operation.\nAll active processes will be terminated to prevent data corruption.\n\n> Saving user configuration... [OK]\n> Shutting down nonessential subsystems... [OK]\n> Disconnecting uplink modules... [OK]\n> Locking biometric user profile... [OK]\n\nNOTICE: Replace microfusion cell at nearest Vault-Tec service facility.\nDevice will enter hibernation mode in 5 seconds. \xA7\xA7\xA7\xA7\xA7\xA7\n\n>>> SYSTEM SHUTDOWN INITIATED <<< \xA7\xA7\xA7',
                  40,
                  40,
                  400,
                  240
                ).then(() => Pip.ledsAllOff())
              ))),
        !isCritical
      );
    }),
    (Pip.checkHeadphoneState = (force) => {
      (!HP_DETECT.read() !== Pip.headphonesPresent || force) &&
        ((Pip.headphonesPresent = !HP_DETECT.read()),
          debug(
            'Headphones ' + (Pip.headphonesPresent ? 'connected' : 'disconnected')
          ),
          SPEAKER_ENB.write(
            !!Pip.settings.muteOnHeadphones && Pip.headphonesPresent
          ));
    }),
    (Pip.startTimers = () => {
      (Pip.startChargeStatusTimer(),
        Pip.kickIdleTimer(),
        Pip.settings.debug &&
        (Pip.timers.debug = setInterval(Pip.renderDebugInfo, 10000)));
      ([ACCEL_INT, VUSB_PRESENT, CHARGE_STAT, CHARGE_STANDBY, HP_DETECT].forEach(
        (pin) => pin.mode('input')
      ),
        [MODE_SELECTOR, CHARGE_CURRENT, VUSB_MEAS, VBAT_MEAS].forEach((pin) =>
          pin.mode('analog')
        ),
        (Pip.timers.selectorSwitch = setInterval(Pip.checkSelectorSwitch, 100)),
        (Pip.timers.flip = setInterval(function () {
          (ACCEL_INT.read() ||
            (Pip.accel.releaseInt(),
              Pip.settings.glitchOnTap &&
              (function () {
                let glitches = [
                  [
                    { filter: 822149411, ydiff: 7, y: 0 },
                    { filter: 50397475, ydiff: 6 },
                    { filter: 19988771, ydiff: 5 },
                    { filter: 16974115, ydiff: 4 },
                    { filter: 16855331, ydiff: 3 },
                    { filter: 16843571, ydiff: 2 },
                    { filter: 269488947, ydiff: 1 },
                    { filter: 16843043, ydiff: 1 }
                  ],
                  [
                    { filter: 307, ydiff: 1, y: 8 },
                    { y: 4 },
                    { y: 0 },
                    { y: -4 },
                    { y: -8 },
                    { y: -4 },
                    { y: 0 },
                    { y: 2 },
                    { y: 0 },
                    { y: -2 },
                    { y: 0 },
                    { y: 1 },
                    { y: 0 }
                  ],
                  [
                    { filter: 307, ydiff: 1, y: 0 },
                    { filter: 307 },
                    { filter: 4913 },
                    { filter: 1257728 },
                    { filter: 321978368 },
                    { filter: 1257728 },
                    { filter: 4913 },
                    { filter: 1257728 },
                    { filter: 321978368 },
                    { filter: 1257728 },
                    { filter: 4913 },
                    { filter: 307 }
                  ]
                ];
                if (
                  2 == Pip.settings.glitchOnTap &&
                  0 == Pip.blitOptions.anim.length
                ) {
                  let endTime = getTime() + 10;
                  (glitches.push([
                    { filter: 307, y: 0, ydiff: 1 },
                    { filter: 4659 },
                    { filter: 74546 },
                    { filter: 1192753 },
                    { filter: 17969969 },
                    {
                      filter: 286405425,
                      cb: function cb1() {
                        Pip.blitOptions.anim =
                          getTime() < endTime
                            ? [
                              { filter: 286405425, c: 2 },
                              { filter: 287519537, c: 3 },
                              { filter: 305345329, c: 3 },
                              { filter: 305345329, c: 3 },
                              { filter: 287519537, c: 2 },
                              { filter: 287519537, cb: cb1 }
                            ]
                            : [{ filter: 307, ydiff: 1, y: 0 }];
                      }
                    }
                  ]),
                    glitches.push([
                      { filter: 307, y: 0, ydiff: 1 },
                      { filter: 4659, y: 10 },
                      { filter: 74546, y: 20 },
                      { filter: 1192753, y: 40 },
                      { filter: 17969969, y: 80 },
                      {
                        filter: 286405425,
                        y: 120,
                        cb: function cb2() {
                          Pip.blitOptions.anim =
                            getTime() < endTime
                              ? [
                                { y: 160 },
                                { y: 200 },
                                { y: 240 },
                                { y: 280 },
                                { y: 0 },
                                { y: 40 },
                                { y: 80 },
                                { y: 120, cb: cb2 }
                              ]
                              : [{ filter: 307, ydiff: 1, y: 0 }];
                        }
                      }
                    ]));
                }
                Pip.blitOptions.anim = glitches[Math.randInt(glitches.length)];
              })()),
            getTime() - Pip.lastFlip > 0.03 && h.flip());
        }, 50)));
    }),
    (Pip.stopTimers = (extra) => {
      (extra || [])
        .concat([
          'flip',
          'selectorSwitch',
          'seek',
          'idle',
          'debug',
          'radio',
          'timeHeader',
          'demo'
        ])
        .forEach((t) => {
          (Pip.timers[t] && clearInterval(Pip.timers[t]), delete Pip.timers[t]);
        });
    }),
    (Pip.kickIdleTimer = function () {
      (0,
        Pip.timers.idle && clearTimeout(Pip.timers.idle),
        (Pip.timers.idle =
          !Pip.settings.idleTimeout || VUSB_PRESENT.read() || Pip.sleeping
            ? void 0
            : setTimeout(() => {
              const txt = 'Pip-OS entering sleep mode...';
              (Pip.remove(),
                h.clearRect(BR).setFontMonofonto16(),
                Pip.typeText(txt, 240 - h.stringWidth(txt) / 2, 150).then(() =>
                  setTimeout(Pip.goToSleep, 800)
                ));
            }, Pip.settings.idleTimeout)));
    }),
    (Pip.radio = {
      freq: 9950,
      volume: 8,
      interval: void 0,
      write_reg: function (r, d) {
        I2C2.writeTo(17, [r, (d >> 8) & 255, 255 & d]);
      },
      read_reg: function (r) {
        try {
          const bytes = I2C2.readReg(17, r, 2);
          return (bytes[0] << 8) | bytes[1];
        } catch (e) {
          return (
            Pip.log(
              'RDA5807 I2C read error: ' + e.message + '\n' + e.stack,
              'errors.txt'
            ),
            Pip.I2CInit(I2C2),
            0
          );
        }
      },
      init: function () {
        (Pip.I2CInit(I2C2), I2C1.writeTo(16, 68, 3));
        const id = this.read_reg(0) >> 8;
        switch (
        (debug(
          88 == id
            ? `RDA5807 ID: 0x${id.toHex()} (as expected)`
            : `Unexpected value reading RDA5807 ID: 0x${id.toHex()}`
        ),
          this.write_reg(2, 3),
          this.write_reg(2, 53261),
          this.write_reg(3, 8),
          this.write_reg(4, 1536),
          this.write_reg(5, 34464 | (15 & this.volume)),
          this.write_reg(6, 32768),
          this.write_reg(7, 24346),
          (this.band = (12 & this.read_reg(3)) >> 2),
          this.band)
        ) {
          case 0:
            ((this.start = 8700), (this.end = 10800));
            break;
          case 1:
            ((this.start = 7600), (this.end = 9100));
            break;
          case 2:
            ((this.start = 7600), (this.end = 10800));
            break;
          case 3:
            (this.read_reg(7) >> 9) & 1
              ? ((this.start = 6500), (this.end = 7600))
              : ((this.start = 5000), (this.end = 7600));
        }
        switch (((this.space = 3 & this.read_reg(3)), this.space)) {
          case 0:
            this.chans_per_MHz = 10;
            break;
          case 1:
            this.chans_per_MHz = 5;
            break;
          case 2:
            this.chans_per_MHz = 20;
            break;
          case 3:
            this.chans_per_MHz = 40;
        }
      },
      off: function () {
        (this.stopIntervals(),
          this.write_reg(2, 0),
          I2C1.writeTo(16, 68, 0),
          Pip.enableMCLK && Pip.enableMCLK(0));
      },
      setPower: function (on) {
        on
          ? (debug('Turning radio ON'),
            (Pip.radioOn = !0),
            1,
            this.init(),
            this.setFreq(this.freq),
            Pip.enableMCLK(1),
            Pip.setDACMode('out'))
          : (debug('Turning radio OFF'), (Pip.radioOn = !1), 1, this.off());
      },
      seek: function (seekUp, callback) {
        let ctrlReg = this.read_reg(2);
        ((ctrlReg |= 256),
          seekUp ? (ctrlReg |= 512) : (ctrlReg &= -513),
          this.write_reg(2, ctrlReg),
          debug(`Seeking ${seekUp ? 'up' : 'down'}...`),
          this.interval && clearInterval(this.interval),
          (this.interval = setInterval(() => {
            const status = this.read_reg(10),
              chan = 1023 & status,
              freq = chan * this.chans_per_MHz + this.start;
            (callback &&
              callback({
                chan: chan,
                freq: freq / 100,
                status: 8192 & status ? 'FAIL' : 16384 & status ? 'FOUND' : 'SEEK'
              }),
              24576 & status &&
              (clearInterval(this.interval),
                (this.interval = void 0),
                debug(
                  `- ch ${chan} (${freq / 100} MHz) ${8192 & status ? '(failed)' : 16384 & status ? 'found' : ''}`
                )));
          }, 200)));
      },
      setFreq: function (f) {
        if (f < this.start || f > this.end)
          return (
            debug(
              `Invalid frequency (${f}) - must be between ${this.start} and ${this.end}`
            ),
            void 0
          );
        this.interval && (clearInterval(this.interval), (this.interval = void 0));
        const chan = ((f - this.start) / this.chans_per_MHz) & 1023,
          chanReg = (chan << 6) | (this.band << 2) | this.space;
        (debug(
          `Band:${this.band} (start:${this.start}, end:${this.end}), spacing:${1e3 / this.chans_per_MHz} kHz, tuning to ${f / 100} MHz (channel ${chan})`
        ),
          this.write_reg(3, chanReg),
          this.write_reg(3, 16 | chanReg));
        let t = 0;
        this.interval = setInterval(() => {
          const status = this.read_reg(10);
          24576 & status
            ? (debug(
              `- set channel=${1023 & status} ${8192 & status ? '(failed)' : 'OK'}`
            ),
              clearInterval(this.interval),
              (this.interval = void 0))
            : t++ > 10 &&
            (debug('Giving up!'),
              clearInterval(this.interval),
              (this.interval = void 0),
              this.write_reg(3, -17 & chanReg));
        }, 400);
      },
      stopIntervals: function () {
        this.interval && (clearInterval(this.interval), (this.interval = void 0));
      }
    }),
    (Pip.configureAlarm = function () {
      (Pip.timers.alarm &&
        (debug('Cancelling existing alarm'), clearTimeout(Pip.timers.alarm)),
        (Pip.timers.alarm = void 0));
      let alarm = Pip.settings.alarm;
      if (alarm && alarm.enabled && alarm.time && !Pip.inDemoMode) {
        let now = Pip.getDateAndTime(),
          d = new Date(alarm.time);
        if (
          (alarm.snoozeTime && (d = new Date(alarm.snoozeTime)),
            d.getTime() <= now.getTime() &&
            (Pip.log(`Alarm time (${d}) is in the past, setting to tomorrow`),
              (d = Pip.getDateAndTime()),
              d.setDate(now.getDate() + 1),
              d.setHours(new Date(alarm.time).getHours()),
              d.setMinutes(new Date(alarm.time).getMinutes()),
              delete alarm.snoozeTime),
            d.getTime() > now.getTime() + 31556925974)
        )
          return (
            Pip.log(
              `Alarm time (${d}) is more than a year in the future - disabling`
            ),
            (alarm.enabled = !1),
            fs.writeFileSync(
              'SETTINGS/DEVICE.JSON',
              JSON.stringify(Pip.settings)
            ),
            void 0
          );
        (alarm.snoozeTime || (alarm.time = d.getTime()),
          (Pip.timers.alarm = setTimeout(function alarmHandler() {
            if ('BUSY' == Pip.sleeping) return setTimeout(alarmHandler, 10000);
            (alarm.repeat || (alarm.enabled = !1),
              Pip.sleeping
                ? (Pip.wake(), Pip.wakeUp(!1, 'ALARM.JS'))
                : ((Pip.settings.brightness || 0) < C.LOW_BRIGHTNESS &&
                  Pip.setBrightness(1),
                  Pip.changeMenu('ALARM.JS')),
              debug('ALARM!'));
          }, d.getTime() - now.getTime())),
          debug(
            `Alarm set to ${d} (${((d.getTime() - now.getTime()) / 60 / 6e4).toFixed(3)} hours away)`
          ));
      }
    }),
    (Pip.demoMode = function () {
      (clearWatch(),
        1,
        clearInterval(Pip.timers.selectorSwitch),
        delete Pip.timers.selectorSwitch,
        Pip.kickIdleTimer(),
        (Pip.inDemoMode = !0));
      let demoFile = E.openFile('DATA/DEMO', 'r'),
        demoBuf = '',
        powerWatch;
      function onTimer() {
        for (; !demoBuf.includes('\n');) {
          var b = demoFile.read(512);
          if (void 0 === b) break;
          demoBuf += b;
        }
        let newlineIdx = demoBuf.indexOf('\n');
        newlineIdx < 0 && (newlineIdx = demoBuf.length);
        let demoLine = demoBuf.substr(0, newlineIdx).trim();
        demoBuf = demoBuf.substr(newlineIdx + 1);
        let demoInfo = demoLine.split('|');
        if (!demoLine.length)
          return (
            debug('Demo finished - restart'),
            demoFile.close(),
            (demoFile = E.openFile('DATA/DEMO', 'r')),
            (demoBuf = ''),
            onTimer(),
            void 0
          );
        (debug('<<<' + demoInfo),
          (Pip.timers.demo = setTimeout(function () {
            (delete Pip.timers.demo, eval(demoInfo[1]), onTimer());
          }, demoInfo[0])));
      }
      (Pip.remove(),
        h.clear(1).setColor(3).setFontAlign(0, 0),
        h.setFontMonofonto23().drawString('Starting Demo Mode', 240, 130),
        h
          .setFontMonofonto18()
          .drawString('Press power button to exit', 240, 190)
          .flip(),
        (Pip.cancelDemoMode = function () {
          (powerWatch && clearWatch(powerWatch),
            delete Pip.cancelDemoMode,
            delete Pip.inDemoMode,
            demoFile.close(),
            Pip.timers.demo && clearTimeout(Pip.timers.demo),
            delete Pip.timers.demo);
        }),
        (Pip.timers.demo = setTimeout(() => {
          (onTimer(),
            (powerWatch = setWatch(
              () => {
                ((powerWatch = void 0),
                  Pip.cancelDemoMode(),
                  Pip.emit('powerButton'));
              },
              BTN_POWER,
              { edge: -1, repeat: !1 }
            )));
        }, 2000)));
    }),
    (Pip.run = () => {
      ((Pip.running = !0),
        (Pip.charging = VUSB_PRESENT.read()),
        (Pip.sleeping = !1),
        (Pip.headphonesPresent = !1),
        Pip.checkBatteryLevel(),
        Pip.audioStart('SOUND/FX/CRT_ON2.WAV'),
        1,
        HP_DETECT.mode('input'),
        Pip.setWatches(),
        Pip.accel.init(),
        Pip.radio.init(),
        Pip.startTimers(),
        Pip.configureAlarm(),
        Pip.emit('mode', Pip.MODE, !0));
      const b = Pip.settings.brightness;
      Pip.setBrightness((b || 0) < C.LOW_BRIGHTNESS ? 1 : b);
    }),
    (Pip.bootAnimation = function () {
      const m = process.memory(!1);
      return (
        h.clear(),
        Pip.typeText(
          `\n\n for for for*************** PIP-OS(R) V5.0.1.4 ***************\n\nCOPYRIGHT 2068 ROBCO(R) for\nLOADER V${VERSION}\nEXEC VERSION ${process.env.VERSION} for\n${((m.total * m.blocksize) / 1e3).toFixed(0)}K RAM SYSTEM\n${m.free * m.blocksize} BYTES FREE\nNO HOLOTAPE FOUND for\nLOAD ROM(1): DEITRIX 2040... COMPLETE for\n\n\n\n\n\n\n\n\n\n\n\n\n`,
          40,
          0,
          400,
          240
        )
      );
    }),
    LCD_BL.write(1),
    Pip.checkBatteryLevel(!0))
)
  if (
    ((Pip.settings = loadJSONWithDefaults(
      Pip.doReset ? null : 'SETTINGS/DEVICE.JSON',
      'SETTINGS/DEFAULT/DEVICE.JSON'
    )),
      Pip.doReset &&
      fs.writeFileSync('SETTINGS/DEVICE.JSON', JSON.stringify(Pip.settings)),
      (NV = !!Pip.settings.nv),
      setRGB(Pip.settings.theme),
      (global.player = new Player('SETTINGS/PLAYER.JSON')),
      player.getinfo(!0),
      Pip.setVol(Pip.settings.volume),
      0,
      Pip.log(`------- Booting ${process.env.VERSION} - ${VERSION} -------`),
      Pip.log(`Battery: ${Pip.battLevel.toFixed(2)} V`),
      Pip.log(`Reset byte: 0x${Pip.resetByte.toHex()}`),
      Pip.log(
        'Reset flags: ' +
        (['RMVF', 'BOR', 'PIN', 'POR', 'SFT', 'IWDG', 'WWDG', 'LPWR']
          .filter((n, i) => Pip.resetByte & (1 << i))
          .join(',') || 'None')
      ),
      BTN_ITEMS.read())
  )
    (Pip.playSound('SELECT'), eval(fs.readFileSync('JS/FACTORYTEST.JS'))());
  else if (BTN_POWER.read())
    8 & Pip.resetByte || 4 == Pip.resetByte
      ? Pip.run()
      : (g
        .setFontMonofonto16()
        .setFontAlign(0, 0)
        .drawString('Release power button to continue booting', 240, 210),
        setWatch(Pip.run, BTN_POWER, { edge: -1 }));
  else if (Pip.doReset) {
    delete Pip.doReset;
    let run = () => {
      Pip.bootAnimation().then(Pip.run);
    };
    (setWatch(run, BTN_STATS, { edge: -1, debounce: 200 }),
      BTN_STATS.read()
        ? (h.clearRect(BR).setFontMonofonto16().setFontAlign(0, 0),
          h.drawString('Rebooting Pip-OS...', 240, 150).flip())
        : setTimeout(run, 1000));
  } else Pip.run();
else Pip.goToSleep();
(1,
  (Pip.offAnimation = function () {
    Pip.blitOptions.anim = [
      { filter: 4658, y: 0, ydiff: 1 },
      { filter: 1192737 },
      { filter: 19084065 },
      { filter: 305345313 }
    ];
    var bin = (E.toFlatString || E.toString)(
      '\x10\xB5@\xF2?\x14\xA2BO\xF0x\x03!\xEA\xE1q\xA8\xBF"F\x03\xFB\x01\x01\x02\xFB\x033\x18D\0#\x81B\x02\xD2A\xF8\x04;\xFA\xE7\x10\xBD\x10\xB5\0#\x02hP\xF8xL\x14C\x82o\x14C\xD0\xF8\xF0 "CA\xF8# \x013\x1E+\0\xF1\x04\0\xEF\xD1\x10\xBD-\xE9\xF8O\x04F\xD0\xB3P%\0\xF5\x95F\rA\0\xF5\x96H\b6\xA0\'O\xF0\0\x0BO\xF0x\t@\xF2=\x1A]E\x19\xDD\xC7\xF5\x9Fp\x01(\xB8\xBF\x01 1F\t\xFB\0@\xFF\xF7\xCF\xFFWE8F\xA8\xBFPFAF\t\xFB\0@\x0B\xF1\x01\x0B\xFF\xF7\xC4\xFF\b\xF1x\b\x027x>\xE3\xE7n\0\xC5\xF1\xA0\x02\xC6\xF1\xA0\x01 F\xFF\xF7\xA1\xFF\x06\xF1\xA0\x02\x05\xF1\xA0\x01 F\xBD\xE8\xF8O\xFF\xF7\x98\xBF\xBD\xE8\xF8\x8F'
    ),
      squish = E.nativeCall(83, 'void(int,int)', bin);
    return new Promise((resolve) => {
      var frame = 0,
        intr = setInterval(function () {
          if (frame < 7)
            (squish(E.getAddressOf(h.buffer, 1), frame),
              Pip.blitImage(h, 0, 0, { noScanEffect: 1 }));
          else {
            h.clearRect(0, 158, 479, 162);
            var x1 = 240 - 20 * (frame - 7);
            x1 < 0
              ? (clearInterval(intr), h.flip(), resolve())
              : (h.setColor(2).fillRect(240 - x1, 159, 240 + x1, 161),
                h
                  .setColor(3)
                  .fillRect(235 - x1, 160, 245 + x1, 160)
                  .flip());
          }
          frame++;
        }, 30);
    });
  }));
