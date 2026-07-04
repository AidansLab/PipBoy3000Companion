E.setFlags({ pretokenise: 1, onErrorSave: 1 });
const EMU = process.env.BOARD.includes('LINUX');
(0,
  Date() < new Date('2000-01-01T0:01') &&
    setTime(new Date('2077-10-23T09:47').getTime() / 1000),
  (Number.prototype.twoDigit = function () {
    return this.toString().padStart(2, '0');
  }),
  (Number.prototype.toHex = function (e) {
    return this.toString(16)
      .padStart(e || 2, '0')
      .toUpperCase();
  }));
const fs = require('fs');
((Pip.log = function (e, t) {
  (t || (t = 'log.txt'),
    (e = `[${new Date().toISOString()}] ${e}`),
    console.log(e));
  const i = require('Storage');
  try {
    Pip.sleeping || Pip.battLevel < C.BAT_CRITICAL_LEVEL
      ? i.getFree() > 4096 &&
        i.open(t, 'a').write(`${e} (sleeping = ${Pip.sleeping})\n`)
      : (fs.statSync('LOGS') || fs.mkdir('LOGS'),
        fs.appendFile('LOGS/' + t, e + '\n'));
  } catch (r) {
    i.getFree() > 4096 &&
      i.open(t, 'a').write(`${e}\nSD Write Fail Reason:${r}\n`);
  }
}),
  1,
  (Pip.resetByte = peek32(1073887348) >> 24),
  poke32(1073887348, 1 << 24),
  (Pip.settings = {}));
let NV = !1;
((Pip.torchOn = !1),
  (Pip.blitOptions = { anim: [], idleIndex: 0, idleFilter: [307] }),
  (Pip.CURRENT = { remove: () => {} }));
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
        let e = Pip.blitOptions.anim[0];
        (Object.assign(Pip.blitOptions, e),
          void 0 !== e.y && (Pip.blitOptions.y = e.y + Pip.settings.vShift),
          (e.c && e.c--) ||
            (Pip.blitOptions.anim.shift(),
            e.cb && e.cb(),
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
function loadJSONWithDefaults(e, t) {
  (t || (t = {}),
    'string' == typeof t && (t = JSON.parse(fs.readFileSync(t))),
    'string' != typeof e || fs.statSync(e) || fs.writeFileSync(e, '{}'));
  const i = e ? JSON.parse(fs.readFileSync(e)) : {};
  for (let e in i) t[e] = i[e];
  return t;
}
function RGBtoHSV(e, t, i) {
  ((e /= 255), (t /= 255), (i /= 255));
  const r = Math.max(e, t, i),
    n = Math.min(e, t, i);
  let o,
    s,
    a = r - n;
  return (
    (s = 0 == r ? 0 : a / r),
    (o =
      r == n
        ? 0
        : r == e
          ? ((t - i) / a + (t < i ? 6 : 0)) / 6
          : r == t
            ? ((i - e) / a + 2) / 6
            : ((e - t) / a + 4) / 6),
    { h: o, s: s, v: r }
  );
}
function generatePalette(e, t, i) {
  const r = (e) => (e > 255 ? 255 : e),
    n = [
      new Uint16Array(16),
      new Uint16Array(16),
      new Uint16Array(16),
      new Uint16Array(16)
    ];
  i = E.clip(i, C.LOW_BRIGHTNESS, 1);
  for (let o = 0; o < 16; o++) {
    const s = (220 * o) >> 4,
      a = (255 * o) >> 4,
      l = 1 - Math.max(0, (o - 8) / 50);
    ((n[0][o] = E.HSBtoRGB(e, t * l, ((24 + s) / 255) * i, 16)),
      (n[1][o] = E.HSBtoRGB(e, t * l, ((18 + ((3 * s) >> 2)) / 255) * i, 16)),
      (n[2][o] = E.HSBtoRGB(e, 0.9 * t * l, (r(32 + a) / 255) * i, 16)),
      (n[3][o] = E.HSBtoRGB(e, 0.9 * t * l, (r(16 + a) / 255) * i, 16)));
  }
  return n;
}
function setRGB(e) {
  e || (e = NV ? C.AMBER : C.GREEN);
  const t = RGBtoHSV((e >> 16) & 255, (e >> 8) & 255, 255 & e);
  let i = generatePalette(t.h, t.s, t.v);
  Pip.setPalette(i);
}
((Pip.errorBox = function (e) {
  LCD_BL.set();
  for (let e = 0; e < 480; e += 2) h.clearRect(e, 0, e, 379);
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
          .wrapString(e, 320)
          .filter((e) => !e.match(/^[ ^]*$/))
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
      let t = global.__FILE__ ? `(${global.__FILE__}) : ` : '';
      ((t += e.type ? `${e.type}: ${e.message}` : `Error ${E.toJS(e)}`),
        Pip.sleeping && (t += ' (sleeping: ' + Pip.sleeping + ')'),
        e && e.stack && (t += '\n' + e.stack.trim()),
        Pip.log(t),
        !0 !== Pip.sleeping && ((Pip.sleeping = !1), Pip.errorBox(t)));
    } catch (t) {
      (console.log(
        'Error in uncaught exception handler: ' + t.message + '\n' + t.stack
      ),
        console.log('Original error: ' + e + '\n' + e.stack));
    }
  }),
  E.on('errorFlag', function (e) {
    if (!(e = e.filter((e) => 'FIFO_FULL' != e)).length) return;
    let t = `Error${e.length > 1 ? 's' : ''}: ${e.join(', ')}`;
    if (Pip.menuChanging)
      try {
        t += ` (while changing to ${Pip.getMode(Pip.MODE).footer[Pip.MENUX].txt} page)`;
      } catch {}
    (Pip.sleeping && (t += ' (sleeping: ' + Pip.sleeping + ')'),
      Pip.log(t),
      Pip.errorBox(t));
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
    Pip.CURRENT = { remove: () => {} };
  }),
  (Pip.setWatches = () => {
    clearWatch();
    {
      pinMode(ENC1_B, 'input');
      let t,
        i,
        r,
        n,
        o = null;
      function e(e, t) {
        t.state
          ? ((e.longPress = setTimeout(
              () => {
                ((e.longPress = !0), e.long());
              },
              e.pin == BTN_POWER ? 2500 : 800
            )),
            Pip.kickIdleTimer())
          : ('number' == typeof e.longPress && clearTimeout(e.longPress),
            !0 !== e.longPress && e.short(),
            delete e.longPress);
      }
      (setWatch(
        (e) => {
          if (o !== e.data) {
            if (((o = e.data), e.state)) {
              (e.time - t < 0.1 ? r++ : (r = 1), (t = e.time));
              const i = E.clip(r >> 1, 1, 5);
              Pip.emit('knob1', e.state ^ e.data ? i : -i);
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
            (e.time - i < 0.1 ? n++ : (n = 1), (i = e.time));
            const t = E.clip(n >> 2, 1, 5);
            (Pip.emit('knob2', e.state ^ e.data ? t : -t),
              E.kickWatchdog(),
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
        ].forEach((t) =>
          setWatch(e.bind(null, t), t.pin, { edge: 0, repeat: !0 })
        ));
    }
  }));
class Player {
  constructor(e) {
    ((this.modified = !1),
      (this.filePath = e),
      (this.player = loadJSONWithDefaults(e, 'SETTINGS/DEFAULT/PLAYER.JSON')),
      (this.ephemeral = {}),
      (this.limbs = [
        'perceptioncondition',
        'endurancecondition',
        'leftattackcondition',
        'rightattackcondition',
        'rightmobilitycondition',
        'leftmobilitycondition'
      ]));
  }
  sync() {
    if (this.modified && !Pip.inDemoMode)
      return (
        (this.modified = !1),
        debug(`Writing to ${this.filePath}`),
        fs.writeFileSync(this.filePath, JSON.stringify(this.player))
      );
  }
  getinfo(e) {
    const t = this.player.clone();
    for (let e in this.ephemeral) t[e] = this.ephemeral[e];
    t.level = E.clip(t.level || 1, 1, NV ? 50 : 30);
    const i = NV
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
      (t.xpNext = i[t.level - 1]),
      (t.maxHP =
        (NV ? 100 : 90) +
        20 * t.endurance +
        (NV ? 5 * (t.level - 1) : 10 * t.level)),
      (t.maxAP = 65 + t.agility * (NV ? 3 : 2)),
      (t.maxWg = 150 + 10 * t.strength),
      (t.hp =
        this.limbs.reduce((e, i) => {
          const r = t[i];
          return (e += void 0 !== r ? r : 100);
        }, 0) / 600),
      (0 === Object.keys(t.invWt || {}).length || e) &&
        this.calculateInvWeight(),
      (t.wg = 0),
      Object.entries(t.invWt || {}).forEach((e) => {
        e[0].startsWith('INV/' + (NV ? 'NV' : 'F3')) &&
          (t.wg += Math.round(e[1]));
      }),
      t
    );
  }
  getav(e) {
    if ('string' != typeof e) throw new Error('av should be string');
    return this.ephemeral[e.toLowerCase()] ?? this.player[e.toLowerCase()];
  }
  setav(e, t, i) {
    if ('string' != typeof e) throw new Error('av should be string');
    i
      ? ((this.modified = this.player[e.toLowerCase()] !== t),
        (this.player[e.toLowerCase()] = t))
      : (this.ephemeral[e.toLowerCase()] = t);
  }
  addperk(e) {
    if ('number' != typeof e) throw new Error('perk should be a number');
    const t = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/PERKS.DAT`);
    if (!t.ids.includes(e)) throw new Error('did not find perk with given id');
    const i = `SETTINGS/${NV ? 'NV' : 'F3'}_PERKS.JSON`,
      r = loadJSONWithDefaults(i);
    ((r[Pip.formatId(e)] = 1),
      fs.writeFileSync(i, JSON.stringify(r)),
      debug(`Added perk ${t.getId(e).txt}`));
  }
  removeperk(e) {
    if ('number' != typeof e) throw new Error('perk should be a number');
    const t = `SETTINGS/${NV ? 'NV' : 'F3'}_PERKS.JSON`,
      i = loadJSONWithDefaults(t);
    (delete i[Pip.formatId(e)], fs.writeFileSync(t, JSON.stringify(i)));
  }
  advlevel() {
    player.setlevel((player.getav('level') || 1) + 1);
  }
  setlevel(e) {
    player.setav('level', e, !0);
  }
  additem(e, t) {
    player.additemhealthpercent(e, t, 100);
  }
  additemhealthpercent(e, t, i) {
    if (t <= 0) return;
    let r = !1;
    return (
      ['AID', 'AMMO', 'APPAREL', 'MISC', 'WEAPONS'].forEach((n) => {
        const o = new DataFile(`DATA/${NV ? 'NV' : 'F3'}/${n}.DAT`),
          s = o.ids.indexOf(e);
        if ((o.close(), s < 0)) return;
        const a = new InvFile(`INV/${NV ? 'NV' : 'F3'}/${n}.INV`, {
            idOrder: o.ids
          }),
          l = a.indexOf(e);
        if (l > 0) {
          let e = a.get(l);
          ((e.cnt += t), a.set(l, e));
        } else a.add({ id: e, cnt: t, cnd: i });
        ((r = !0), a.sync());
      }),
      r
    );
  }
  removeitem(e, t) {}
  equipitem(e) {}
  resetinventory() {
    const e = this;
    let t = 0;
    ['AID', 'AMMO', 'APPAREL', 'MISC', 'WEAPONS'].forEach((i) => {
      ['F3', 'NV'].forEach((r) => {
        (t++,
          E.openFile(`INV/DEFAULT/${r}/${i}.INV`, 'r').pipe(
            E.openFile(`INV/${r}/${i}.INV`, 'w'),
            {
              complete: () => {
                0 === --t && e.calculateInvWeight();
              }
            }
          ));
      });
    });
  }
  calculateInvWeight() {
    Pip.log('Calculating inventory weights...');
    const e = getTime();
    (this.player.invWt || (this.player.invWt = {}),
      ['AID', 'AMMO', 'APPAREL', 'MISC', 'WEAPONS'].forEach((e) => {
        ['F3', 'NV'].forEach((t) => {
          fs.statSync('INV/' + t) || fs.mkdirSync('INV/' + t);
          try {
            let i = 0;
            const r = new DataFile(`DATA/${t}/${e}.DAT`),
              n = new InvFile(`INV/${t}/${e}.INV`);
            for (let e = 0; e < n.count; e++) {
              const t = n.get(e),
                o = r.getId(t.id);
              i += ((o && o.wt) || 0) * t.cnt;
            }
            (r.close(), n.sync(), (this.player.invWt[`INV/${t}/${e}.INV`] = i));
          } catch (i) {
            Pip.log(` - ERROR calculating INV weights for ${t}/${e}: ${i}`);
          }
        });
      }),
      Pip.log(` - calculation took ${(getTime() - e).toFixed(2)} seconds`),
      (this.modified = !0),
      this.sync());
  }
  heal(e) {
    const t = e * (600 / this.getinfo(!1).maxHP);
    let i =
      600 -
      this.limbs.reduce((e, t) => {
        let i = this.getav(t);
        return e + (void 0 !== i ? i : 100);
      }, 0);
    if (!(i <= 0)) {
      for (let e of this.limbs) {
        let r = this.getav(e) ?? 100,
          n = 100 - r;
        if (n > 0) {
          let o = (n / i) * t;
          ((r = E.clip(r + o, 0, 100)), this.setav(e, r));
        }
      }
      Pip.renderHeader();
    }
  }
}
((Pip.setDateAndTime = (e) => {
  (debug(`Setting date/time to ${e}`),
    (Pip.settings.century = Math.floor(e.getFullYear() / 100)),
    e.setFullYear((e.getFullYear() % 100) + 2000),
    (Pip._lastRTCYear = e.getFullYear()),
    setTime(e.getTime() / 1000),
    debug('Writing date/time to file SETTINGS/DEVICE.JSON'),
    fs.writeFileSync('SETTINGS/DEVICE.JSON', JSON.stringify(Pip.settings)));
}),
  (Pip.getDateAndTime = () => {
    let e = new Date();
    const t = e.getFullYear();
    if (2099 == Pip._lastRTCYear && 2099 != t) {
      ((Pip.settings.century = (Pip.settings.century || 20) + 1),
        debug(`Century is now ${Pip.settings.century}`));
      try {
        fs.writeFileSync('SETTINGS/DEVICE.JSON', JSON.stringify(Pip.settings));
      } catch (e) {
        Pip.log('Failed to save new century: ' + e.message, 'errors.txt');
      }
    }
    return (
      (Pip._lastRTCYear = t),
      e.setFullYear(100 * Pip.settings.century + (e.getFullYear() % 100)),
      e
    );
  }),
  (Pip.setTorch = (e) => {
    ((Pip.torchOn = void 0 === e ? !Pip.torchOn : !!e),
      debug(' - Switching torch ' + (Pip.torchOn ? 'ON' : 'OFF')),
      0 == Pip.settings.torchMode || void 0 !== e
        ? (Pip.audioStart(`SOUND/FX/LIGHT_${Pip.torchOn ? 'ON' : 'OFF'}.WAV`),
          Pip.fadeTo({ pin: LED_TORCH, target: Pip.torchOn ? 1 : 0 }))
        : 'TORCH' == Pip.CURRENT.id
          ? Pip.torchOn || Pip.CURRENT.turnOff()
          : Pip.torchOn && Pip.changeMenu('TORCH.JS'),
      Pip.drawIcons());
  }),
  Pip.on('longPress', (e) => {
    function t() {
      (debug('- Reloading JS files'),
        clearInterval(),
        (Pip.timers = {}),
        clearWatch(),
        load());
    }
    switch ((debug(`Long press on ${e} button`), e)) {
      case 'STATS':
        BTN_DATA.read() && t();
        break;
      case 'ITEMS':
        BTN_POWER.read() ||
          (Pip.setTorch(),
          'SETTINGS' === Pip.CURRENT.id && setTimeout(Pip.changeMenu, 100));
        break;
      case 'DATA':
        BTN_STATS.read() && t();
        break;
      case 'POWER':
        (function () {
          (debug('- Shutting down'),
            Pip.stopTimers(['alarm']),
            Pip.remove(),
            clearWatch());
          const e = 'Pip-OS shutting down...';
          (h.clearRect(BR).setFontMonofonto16(),
            Pip.typeText(e, 240 - h.stringWidth(e) / 2, 150).then((e) => {
              if (((Pip.wakeOnLongPress = !0), BTN_POWER.read())) {
                let t = 0;
                const i = setInterval(() => {
                  h.setColor(++t % 10 < 5 ? 3 : 0)
                    .fillRect(e.x - 6, e.y, e.x, e.y + 16)
                    .flip();
                }, 50);
                setWatch(
                  () => {
                    (clearInterval(i), Pip.goToSleep());
                  },
                  BTN_POWER,
                  { edge: -1 }
                );
              } else Pip.goToSleep();
            }));
        })();
    }
  }),
  (Pip.goToSleep = (e) => {
    function t() {
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
    debug(`Pip.goToSleep(${typeof e})`);
    try {
      ((Pip.sleeping = 'GOING_TO_SLEEP'),
        Pip.remove(),
        Pip.cancelDemoMode && Pip.cancelDemoMode(),
        process.memory(!0),
        Pip.stopTimers(),
        clearWatch(),
        Pip.setTorch(0),
        'function' == typeof e
          ? e().then(() => {
              setTimeout(t, 100);
            })
          : e
            ? setTimeout(t, 50)
            : (Pip.audioStart('SOUND/FX/CRT_OFF.WAV'),
              Pip.offAnimation().then(() => {
                (Pip.ledsAllOff(), setTimeout(t, 500));
              })));
    } catch (e) {
      (Pip.log(
        'Error during goToSleep: ' + e.message + '\n' + e.stack,
        'errors.txt'
      ),
        setTimeout(t, 50));
    }
  }),
  (Pip.wakeUp = (e, t) => {
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
      let e = 240,
        t = 160;
      (h
        .clear(1)
        .fillRect(e - 60, t - 20, e + 60, t - 18)
        .fillRect(e - 60, t + 18, e + 60, t + 20)
        .fillRect(e - 60, t - 18, e - 58, t + 18)
        .fillRect(e + 58, t - 18, e + 60, t + 18)
        .fillRect(e + 60, t - 6, e + 68, t + 6)
        .setColor(1)
        .fillRect(e - 54, t - 14, e - 48, t + 14)
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
        e || (Pip.renderHeader(), Pip.renderFooter(), Pip.loadMenu(t)),
        setTimeout(function () {
          (delete Pip.blitOptions.disable,
            Pip.audioStart('SOUND/FX/CRT_ON2.WAV'));
        }, 0),
        e
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
        let t;
        function e() {
          (t && clearTimeout(t),
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
          let i = setWatch(e, BTN_POWER, { edge: -1 });
          t = setTimeout(() => {
            (clearWatch(i), (Pip.wakeOnLongPress = !1), Pip.wakeUp(!0));
          }, 1200);
        } else e();
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
  const e = 22;
  let t = 22;
  (h.clearRect(t, e, t + 23, 40),
    h
      .setColor(Pip.lowBatt && (0 | getTime()) % 2 ? 1 : 2)
      .drawImage(icons.emptyBattery, t, e),
    Pip.lowBatt && h.drawImage(icons['!'], t + 12, e),
    h.fillRect(t + 3, 36, t + 6, 36 - Pip.battIcon).setColor(3),
    Pip.torchOn
      ? h.drawImage(icons.torch, (t += 12), e)
      : Pip.charging && h.drawImage(icons.charging, (t += 12), e));
  let i = Pip.settings.alarm;
  if (i && i.enabled) {
    let e = void 0 !== i.snoozeTime,
      r = new Date(e ? i.snoozeTime : i.time),
      n = Pip.currentDateTime(r);
    (h.drawImage(e ? icons.snooze : icons.alarm, (t += 12), 23),
      h.setFontCustom(
        '\0\0\0\0\0\0\0\0\x10\b\x04\0\0\0\b\x01\xDD\x01\x80\xC0]\xC0\0\0\0\0\0w\0\x01\xD1\x18\x8CE\xC0\0\0Db1\x17p\x01\xC0\x10\b\x04\x1D\xC0\x07\x04F#\x11\x07\0\x1D\xD1\x18\x8CD\x1C\0\0@ \x10\x07p\x01\xDD\x11\x88\xC4]\xC0\x07\x04F#\x11w\0\x05\0\0',
        32,
        '\x06\0\0\0\0\0\0\0\0\0\0\0\0\x06\x02\0\x06\x06\x06\x06\x06\x06\x06\x06\x06\x06\x02',
        9
      ),
      h.setFontAlign(-1, 0).drawString(n[0], t + 20, 34));
  }
  return t;
}),
  (Pip.timers = {}),
  (Pip.MODE = 0),
  (Pip.MENUX = 0),
  (Pip.getMode = function (e) {
    switch (e) {
      case 0:
        return {
          title: 'STATS',
          header: () => {
            const e = player.getinfo();
            return [
              ['LVL', e.level],
              ['HP', `${Math.floor(e.maxHP * e.hp)}/${e.maxHP}`],
              ['AP', `${e.maxAP}/${e.maxAP}`],
              [
                'XP',
                e.xpNext
                  ? `${Math.floor(e.xpNext * (new Date().getDate() / 32))}/${e.xpNext}`
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
            const e = new InvFile(`INV/${NV ? 'NV' : 'F3'}/MISC.INV`),
              t = player.getinfo();
            let i = 0;
            const r = e.indexOf(15);
            if (r >= 0) {
              const t = e.get(r);
              t && (i = t.cnt);
            }
            return [
              ['Wg', `${t.wg}/${t.maxWg}`],
              [
                'HP',
                `${Math.floor(t.maxHP * t.hp)}/${t.maxHP}`.padStart(7, ' ')
              ],
              [NV ? 'DT' : 'DR', `${(NV ? t.dt : t.dr) || 0}`.padStart(2, ' ')],
              ['Caps', String(i).padStart(5, ' ')]
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
            const e = JSON.parse(
                fs.readFile(`MAP/${NV ? 'NV' : 'F3'}/MAPS.JSON`)
              )[player.getav('map') || 'WMAP'] || { name: void 0 },
              t = Pip.currentDateTime(),
              i = e.name;
            return [
              ['', i || (NV ? 'Mojave Wasteland' : 'The Capital Wasteland')],
              ['', t[2]]
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
        throw new Error(`Unknown mode ${e}`);
    }
  }),
  (Pip.formatId = (e) => e.toHex(8)),
  (Pip._fade = {
    timer: null,
    state: {},
    waiters: [],
    step: function () {
      let e = !0;
      for (let t in Pip._fade.state) {
        const i = Pip._fade.state[t];
        if (null === i.t) continue;
        e = !1;
        const r = i.t;
        let n = i.b || 0;
        n !== r
          ? (n < r
              ? (n < 0.01 && (n = 0.01), (n *= i.sf), n >= r && (n = r))
              : ((n /= i.sf), n <= Math.max(0.01, r) && (n = r)),
            (i.b = n),
            n % 1 ? analogWrite(t, n, { freq: 200 }) : digitalWrite(t, n))
          : (i.t = null);
      }
      if (!e) return !1;
      if (Pip._fade.resolve) {
        try {
          Pip._fade.resolve();
        } catch (e) {
          debug('Error resolving fade promise:', e);
        }
        Pip._fade.resolve = null;
      }
      return (
        null !== Pip._fade.timer &&
          (require('timer').remove(Pip._fade.timer), (Pip._fade.timer = null)),
        !0
      );
    }
  }),
  (Pip._fade.state[LCD_BL.toString()] = { b: 1, t: null }),
  (Pip.fadeTo = (e) => {
    Array.isArray(e) || (e = [e]);
    for (let t of e) {
      const e = t.pin.toString();
      (Pip._fade.state[e] || (Pip._fade.state[e] = { b: 0, t: null }),
        (Pip._fade.state[e].t = t.target),
        (Pip._fade.state[e].sf = t.stepFactor || 1.46));
    }
    const t = new Promise((e) => (Pip._fade.resolve = e));
    return (
      null !== Pip._fade.timer ||
        Pip._fade.step() ||
        (Pip._fade.timer = require('timer').add({
          type: 'EXEC',
          fn: Pip._fade.step,
          time: 30,
          interval: 30
        })),
      t
    );
  }),
  (Pip.ledsAllOff = () => {
    let e = [];
    return (
      Object.keys(Pip._fade.state).forEach((t) => {
        if (t == LED_DOWNFIRE.toString()) return;
        const i = Pip._fade.state[t];
        ((i.bs = i.b || 0), e.push({ pin: t, target: 0 }));
      }),
      Pip.fadeTo(e)
    );
  }),
  (Pip.ledsRestore = () => {
    let e = [];
    return (
      Object.keys(Pip._fade.state).forEach((t) => {
        const i = Pip._fade.state[t];
        e.push({ pin: t, target: i.bs || 0 });
      }),
      Pip.fadeTo(e)
    );
  }),
  (Pip.playSound = (e) => {
    Pip.audioStartVar(Pip.audioBuiltin(e), { overlap: !0 });
  }),
  (Pip.I2CInit = (e) => {
    (0, e || (e = I2C1));
    const t = e == I2C1 ? INT_SCL : EXT_SCL,
      i = e == I2C1 ? INT_SDA : EXT_SDA,
      r = e == I2C1 ? 2e5 : 8e4;
    try {
      if (0 == i.read()) {
        Pip.log(
          `I2C SDA pin (${i}) is low - trying to unstick the bus with SCL pulses`
        );
        for (var n = 1; n <= 32 && (t.write(0), t.write(1), !i.read()); n++);
        Pip.log(
          `I2C bus ${i.read() ? 'unstuck' : 'still stuck'} after ${n} pulses`
        );
      }
      e.setup({ scl: t, sda: i, bitrate: r });
    } catch (e) {
      Pip.log(`Failed to set up I2C: ${e.message}`);
    }
  }),
  (Pip.accel = {
    writeReg: function (e, t) {
      try {
        I2C1.writeTo(this.addr, [e, t]);
      } catch (t) {
        (Pip.log(
          `Failed to write accelerometer register ${e.toHex()}: ${t.message}`
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
        const e = I2C1.readReg(this.addr, 15, 1);
        if (53 == e)
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
          if (17 != e)
            throw new Error(
              `Unexpected WHO_AM_I response from accelerometer (${e})`
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
          const e = I2C1.readReg(this.addr, 7, 5);
          return [256 - e[2], e[0], e[4]].map((e) =>
            e > 127 ? (e - 256) / 64 : e / 64
          );
        }
        {
          const e = I2C1.readReg(this.addr, 168, 5);
          return [e[2], 256 - e[0], e[4]].map((e) =>
            e > 127 ? (e - 256) / 64 : e / 64
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
    setThreshold: function (e) {
      if (this.isKXTJ3) {
        const t = I2C1.readReg(this.addr, 27, 1)[0];
        (this.writeReg(27, -129 & t),
          this.writeReg(106, e),
          this.writeReg(27, 128 | t));
      } else this.writeReg(50, 2 * e);
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
  constructor(e) {
    this.file = E.openFile(e, 'r');
    const t = new Uint32Array(E.toArrayBuffer(this.file.read(8)));
    if (0 === t[0]) throw new Error('number of records was zero');
    if (0 === t[1]) throw new Error('size of record was zero');
    ((this.end = 8 + 4 * t[0]),
      (this.len = t[1]),
      (this.ids = new Uint32Array(E.toArrayBuffer(this.file.read(4 * t[0])))));
  }
  getId(e) {
    if (this.ids.indexOf(e) < 0) return { txt: '== MISSING ==' };
    this.file.seek(this.end + this.ids.indexOf(e) * this.len);
    const t = this.file.read(this.len);
    try {
      return JSON.parse(t);
    } catch (e) {
      return (
        debug('failed to parse data', e, t),
        { txt: '== ERROR ==', desc: e }
      );
    }
  }
  close() {
    this.file.close();
  }
}
class InvFile {
  constructor(e, t) {
    if (
      (t || (t = {}),
      (this.path = e),
      (this.onLoaded = t.onLoaded),
      (this.idOrder = t.idOrder),
      !fs.statSync(e))
    ) {
      const t = this;
      E.openFile(e.replace('INV/', 'INV/DEFAULT/'), 'r').pipe(
        E.openFile(e, 'w'),
        {
          complete: function () {
            t.refreshItems();
          }
        }
      );
    }
    this.refreshItems();
  }
  refreshItems() {
    const e = E.toArrayBuffer(fs.readFileSync(this.path) ?? '');
    ((this.count = e ? e.byteLength >> 3 : 0),
      (this.buf = new ArrayBuffer(
        8 * (this.idOrder ? this.idOrder.length : 256)
      )),
      e && E.mapInPlace(e, this.buf),
      this.onLoaded && this.onLoaded(this));
  }
  sync() {
    if (this.buf && this._requiresSync) {
      if (this.idOrder && this._requiresSort) {
        const e = new Float64Array(this.buf),
          t = new Uint32Array(this.buf),
          i = new Uint16Array(this.count),
          r = new Uint16Array(this.count);
        for (let e = 0; e < this.count; e++)
          ((i[e] = e), (r[e] = this.idOrder.indexOf(t[2 * e])));
        for (let e = 1; e < this.count; e++) {
          const t = i[e],
            n = r[t];
          let o = e;
          for (; o > 0 && r[i[o - 1]] > n;) ((i[o] = i[o - 1]), o--);
          i[o] = t;
        }
        for (let t = 0; t < this.count; t++) {
          if (32768 & i[t]) continue;
          let r = t;
          for (; i[r] !== t;) {
            const t = i[r],
              n = e[r];
            ((e[r] = e[t]), (e[t] = n), (i[r] |= 32768), (r = t));
          }
          i[r] |= 32768;
        }
        this._requiresSort = !1;
      }
      (debug(`Writing to ${this.path}`),
        fs.writeFileSync(
          this.path,
          this.count > 0 ? new Uint8Array(this.buf, 0, 8 * this.count) : []
        ),
        (this._requiresSync = !1));
    }
  }
  indexOf(e) {
    const t = new Uint32Array(this.buf),
      i = 2 * this.count;
    for (let r = 0; r < i; r += 2) if (t[r] === e) return r >> 1;
    return -1;
  }
  ids() {
    return new Array(this.count)
      .fill(0)
      .map((e, t) => new DataView(this.buf, 8 * t, 4).getUint32(0, !0));
  }
  get(e) {
    if (e < 0 || e >= this.count) return null;
    const t = 8 * e,
      i = new Uint8Array(this.buf, t, 8);
    return {
      id: i[0] | (i[1] << 8) | (i[2] << 16) | (i[3] << 24),
      cnt: i[4] | (i[5] << 8),
      cnd: i[6],
      fl: i[7]
    };
  }
  set(e, t) {
    if (e < 0 || e >= this.count) return null;
    const i = new DataView(this.buf, 8 * e, 8);
    ('id' in t && i.setUint32(0, t.id, !0),
      'cnt' in t && i.setUint16(4, t.cnt, !0),
      'cnd' in t && i.setUint8(6, t.cnd),
      'fl' in t && i.setUint8(7, t.fl),
      (this._requiresSync = !0));
  }
  add(e) {
    if (!('id' in e)) throw new Error('Cannot add item without an ID');
    const t = this.idOrder
      ? ((e, t) => {
          for (
            var i, r = this.idOrder.indexOf.bind(this.idOrder), n = r(t), o = 0;
            o < this.count;
            o++
          ) {
            if ((i = r(e[2 * o])) == n) return -(o + 1);
            if (i > n) return o;
          }
          return this.count;
        })(new Uint32Array(this.buf), e.id)
      : this.count;
    if (t < 0) return (this.set(-(t + 1), e), void 0);
    (new Float64Array(this.buf).set(new Float64Array(this.buf, 8 * t), t + 1),
      this.count++,
      this.set(t, {
        id: e.id,
        cnt: E.clip(e.cnt, 1, 9999),
        cnd: e.cnd || 100,
        fl: e.fl || 0
      }),
      (this._requiresSync = !0));
  }
  remove(e) {
    const t = new Float64Array(this.buf, 0, this.count);
    if (e < 0 || e >= this.count) return null;
    for (let i = e; i < this.count - 1; i++) t[i] = t[i + 1];
    (this.count--,
      (this._requiresSync = !0),
      this.onLoaded && this.onLoaded(this));
  }
}
function debug(e) {
  if (!Pip.settings.debug) return;
  const t = process.memory(!1),
    i = t.usage.toString().padEnd(5, ' '),
    r =
      ((t.usage - 2135).toString().padEnd(5, ' '),
      t.free.toString().padEnd(5, ' ')),
    n = `${e}`.padEnd(50, ' ') + `usage: ${i} free: ${r}`;
  if (VUSB_PRESENT.read()) console.log(n);
  else {
    const e = require('Storage');
    e.getFree() > 4096 &&
      e
        .open('debug.txt', 'a')
        .write(
          `[${new Date().toISOString()}] ${n} batt: ${Pip.battLevel.toFixed(2)} V\n`
        );
  }
}
if (
  ((Pip.shadeBox = (e, t, i, r) => {
    h.setColor(1);
    for (let n = t + 1; n <= r - 1; n += 2) h.fillRect(e, n, i, n);
    h.setColor(3).drawRect(e, t, i, r);
  }),
  (Pip.drawGauge = (e, t, i, r, n) => {
    let o = 226;
    n || (n = {});
    const s = Math.round(((Math.max(i, Math.min(t, r)) - i) / (r - i)) * 210),
      a = n.y || 215,
      l = t % 1 ? t.toFixed(2) : t;
    if (
      (h.setFont('Monofonto14').setColor(3),
      n.update ||
        (h
          .fillRect(164, a, 464, a + 1)
          .drawImage(icons.fadedown, 463, a)
          .drawImage(icons.fadedown, 464, a)
          .fillPoly([o, a, o, a + 12, o - 12, a])
          .setFontAlign(-1, 0)
          .drawString(e, 164, a + 15)
          .setFontAlign(0, 1)
          .drawString((r + i) / 2, o + 105, a)
          .drawString(r, o + 210, a),
        n.showMin && h.drawString(i, o, a),
        n.lTxt &&
          h
            .clearRect(20, a + 7, 101, a + 38)
            .fillRect(20, a, 158, a + 1)
            .drawImage(icons.fadedown, 157, a)
            .drawImage(icons.fadedown, 158, a)
            .setFontAlign(-1, -1)
            .drawString(n.lTxt, 20, a + 7)),
      n.lVal &&
        h
          .clearRect(104, a + 7, 147, a + 38)
          .setFontAlign(1, -1)
          .drawString(' ' + n.lVal, 148, a + 7, !0),
      h
        .clearRect(o - 10, a + 15, o + 220, a + 47)
        .clearRect(o - 40, a + 20, o - 10, a + 47),
      h
        .fillRect(o + s - 1, a + 25, o + s + 1, a + 43)
        .fillPoly([o + s, a + 15, o + s - 9, a + 25, o + s + 8, a + 25]),
      n.showVal && h.setFontAlign(1, 1).drawString(l, o + s - 7, a + 47),
      !n.update)
    ) {
      for (let e = 1; e < 15; e++)
        ((o += 14), h.fillRect(o, a, o + 1, a + (e % 3 ? 5 : 10)));
      ((o += 14), h.fillPoly([o, a, o, a + 12, o + 12, a]));
    }
  }),
  (Pip.onExclusive = (e, t) => {
    const i = Pip['#on' + e];
    (Pip.removeAllListeners(e),
      Pip.on(e, t),
      i &&
        i.length > 0 &&
        Pip.log(
          `Event ${e} not exclusive already ${i.length} callbacks attached, they have been removed\n${i.map((e) => e.toString()).join('\n')}`,
          'errors.txt'
        ));
  }),
  (Pip.createScroller = (e) => {
    const t =
        '\x10\b\x02\0\0\x80\0\0\x03\xE0\0\0\x0F\xF8\0\0\x7F\xBF\0\x01\xF8\x1F\x80\x06\xE0\x03\xE0\x1A@\0\xB8h\0\0\x1A',
      i =
        '\x10\b\x02T\0\0\x05*\0\0)\x0E\xC0\x01\xE8\x03\xF4\x0B\xD0\0\xBD?@\0/\xFD\0\0\x0B\xF0\0\0\x02\xC0\0',
      r =
        '\x04@\x02TU\xA9i\xA9\xA9\xA9\xA9\xA9\xA9\xAD\xA9\xBD\xA9\xBD\xB9\xBD\xB9\xBD\xBD\xB9\xBD\xBD\xBD\xBD\xFD\xBD\xBD\xFD\xBD\xBD\xFD\xBD\xBD\xFD\xBD\xBD\xFD\xBD\xBD\xBD\xBD\xB9\xBD\xBD\xB9\xBD\xB9\xBD\xAD\xB9\xA9\xB9\xAD\xA9\xA9\xA9\xA9i\xA9i\x99dd';
    let n,
      o = [],
      s = (e, t) => {
        let i = h.setFont('Monofonto14').wrapString(t.txt, p - 40);
        return (o[e] = {
          txt: i,
          activ: t.activ,
          rtxt: t.rtxt,
          h: 10 + 14 * i.length
        });
      },
      a = (e) => o[e] || s(e, c.getItem(e)),
      l = e.getItem ? e.itemCount : e.items.length,
      p = e.width || 180;
    const d = 266;
    let c = {
      scrollIndex: e.scrollStart ? E.clip(e.scrollStart, 0, e.itemCount) : 0,
      scrollY: 0,
      selectedIndex: e.scrollStart ? E.clip(e.scrollStart, 0, e.itemCount) : 0,
      updateItemCount: (e) => {
        ((l = e), (o = []));
      },
      render: (o) => {
        if (l <= 0) return;
        o = o || {};
        let A = c.getItem(c.selectedIndex);
        s(c.selectedIndex, A);
        const g = 24;
        let P = 50 + c.scrollY,
          f = c.scrollIndex,
          u = l,
          m = 50,
          E = d;
        if (void 0 !== o.justItem) {
          for (; f < o.justItem; f++) P += a(f).h;
          ((u = o.justItem + 1), (o.listOnly = !0), (m = P), (E = P + a(f).h));
        }
        for (
          h
            .clearRect(BR.x, m, g + p, E)
            .setFont('Monofonto14')
            .setClipRect(BR.x, m, g + p, E);
          f < u;
          f++
        ) {
          const t = a(f);
          if (t) {
            if (P >= d) break;
            (f == c.selectedIndex &&
              (Pip.shadeBox(g, P, g + p, P + t.h),
              e.hasEquipStates && h.drawRect(30, P + 8, 38, P + 16)),
              t.activ && e.hasEquipStates && h.fillRect(30, P + 8, 38, P + 16),
              h
                .setFontAlign(-1, 0)
                .drawString(t.txt.join('\n'), 46, P + 7 * t.txt.length + 7),
              void 0 !== t.rtxt &&
                h.setFontAlign(1, 0).drawString(t.rtxt, g + p - 4, P + 14),
              h.setBgColor(0),
              (P += t.h));
          }
        }
        (l > 9 &&
          h
            .drawImage(t, 7, 50)
            .drawImage(i, 7, 259)
            .drawImage(r, 14, 59 + (142 * c.selectedIndex) / l),
          h.setClipRect(0, 0, 479, 319),
          !o.listOnly &&
            e.render &&
            (n && clearTimeout(n),
            (n = setTimeout(function () {
              ((n = void 0),
                h.setBgColor(0).clearRect(g + p + 2, BR.y, 480, BR.y + BR.h),
                e.render(A),
                h.flip(),
                (Pip.lastFlip = getTime()));
            }, 100))),
          Pip.blitOptions.anim.length ||
            ((Pip.blitOptions.y1 = m), (Pip.blitOptions.y2 = E)),
          h.flip(),
          (Pip.lastFlip = getTime()),
          delete Pip.blitOptions.y1,
          delete Pip.blitOptions.y2);
      },
      remove: () => {
        (n && clearTimeout(n), Pip.removeListener('knob1', A));
      }
    };
    function A(t, i) {
      if (0 === t)
        return (
          e.onClick &&
            !i &&
            (e.onClick(c.selectedIndex),
            c.render({ listOnly: void 0 === e.render })),
          e.onLongClick && i && e.onLongClick(c.selectedIndex),
          void 0
        );
      const r = l - 1,
        n = Math.max(0, Math.min(r, c.selectedIndex + t));
      if (n !== c.selectedIndex) {
        if (
          ((c.selectedIndex = n),
          Pip.playSound('SCROLL'),
          c.selectedIndex <= c.scrollIndex)
        )
          ((c.scrollIndex = c.selectedIndex), (c.scrollY = 0));
        else {
          let e,
            t = 1,
            i = 0,
            r = c.scrollIndex;
          for (; t > 0;) {
            if (((t = -216), i > 0 && c.scrollIndex === r + 1))
              ((i -= a(r).h), (t += i), (r = c.scrollIndex));
            else {
              i = 0;
              for (let e = c.scrollIndex; e <= c.selectedIndex; e++) {
                const r = a(e).h;
                ((i += r), (t += r));
              }
              r = c.scrollIndex;
            }
            ((e = a(c.selectedIndex).h),
              t >= e
                ? ((c.scrollY = 0), c.scrollIndex++)
                : t > 0 && ((c.scrollY = -t), (t = 0)));
          }
        }
        if (o.length > 18) {
          const e = [],
            t = c.scrollIndex,
            i = c.scrollIndex + 9;
          for (let r = t; r <= i; r++) o[r] && (e[r] = o[r]);
          o = e;
        }
        c.render({ listOnly: void 0 === e.render });
      }
    }
    return (
      (c.getItem = e.getItem ? e.getItem : (t) => e.items[t]),
      c.render(),
      Pip.onExclusive('knob1', A),
      c
    );
  }),
  (Pip.createDateTimePicker = function (e, t, i, r) {
    e.setSeconds(0);
    let n = t ? 0 : 3,
      o = () => {
        let i = e.getHours().twoDigit(),
          r = e.getMinutes().twoDigit();
        (h.reset().setFontMonofonto28().setFontAlign(-1, -1),
          t
            ? (h.drawString(
                e.getFullYear().toString().padStart(4),
                117,
                148,
                !0
              ),
              h.drawString('-', 176, 148),
              h.drawString((e.getMonth() + 1).twoDigit(), 193, 148, !0),
              h.drawString('-', 224, 148),
              h.drawString(e.getDate().twoDigit(), 241, 148, !0),
              h.drawString(i, 289, 148, !0),
              h.drawString(':', 320, 148),
              h.drawString(r, 337, 148, !0))
            : (h.drawString(i, 202, 148, !0),
              h.drawString(':', 233, 148),
              h.drawString(r, 250, 148, !0)));
      },
      s = (e, t, i, r, n) => {
        null == n && (n = 1);
        let o = e,
          s = e + i,
          a = t,
          l = t + r;
        for (; n--;) (h.drawRect(o, a, s, l), o++, s--, a++, l--);
      },
      a = (e) => {
        let i;
        (null == e && (e = 3),
          (i = t
            ? [
                [113, 141, 64, 42, 2],
                [189, 141, 36, 42, 2],
                [237, 141, 36, 42, 2],
                [285, 141, 36, 42, 2],
                [333, 141, 36, 42, 2],
                [190, 210, 100, 33, 1]
              ]
            : [
                [],
                [],
                [],
                [198, 141, 36, 42, 2],
                [246, 141, 36, 42, 2],
                [190, 210, 100, 33, 1]
              ]),
          h.setColor(e));
        let r = i[n];
        (5 == n &&
          (h.setBgColor(1).clearRect(r[0], r[1], r[0] + r[2], r[1] + r[3]),
          h.setFontMonofonto23().setFontAlign(0, -1),
          h.drawString('SET', 240, 215).setBgColor(0)),
          s(r[0], r[1], r[2], r[3], r[4]));
      };
    function l(t) {
      if (t) {
        switch (n) {
          case 0:
            e.setFullYear(e.getFullYear() - t);
            break;
          case 1:
            e.setMonth(e.getMonth() - t);
            break;
          case 2:
            e.setDate(e.getDate() - t);
            break;
          case 3:
            e.setHours(e.getHours() - t);
            break;
          case 4:
            e.setMinutes(e.getMinutes() - t);
        }
        (o(), Pip.playSound('SCROLL'));
      } else
        n >= 5
          ? (Pip.playSound('SELECT'), setTimeout(r, 400, e))
          : (Pip.playSound('TAB'), a(0), n++, a());
      h.flip();
    }
    function p(e) {
      (Pip.playSound('TAB'),
        a(5 == n ? 0.3 : 0),
        (n = t ? (n + e + 6) % 6 : ((n + e + 3) % 3) + 3),
        a(),
        h.flip());
    }
    return (
      Pip.onExclusive('knob1', l),
      Pip.onExclusive('knob2', p),
      h.reset().clearRect(BR),
      h.setFontMonofonto28().setColor(2).setFontAlign(0, -1),
      h.drawString(i, 240, 88),
      h.setFontMonofonto23().setColor(1),
      h.drawString('SET', 240, 215),
      h.drawRect(190, 210, 290, 243),
      t ? s(88, 134, 306, 56, 3) : s(164, 134, 152, 56, 3),
      o(),
      a(),
      h.flip(),
      {
        remove: () => {
          (Pip.removeListener('knob1', l), Pip.removeListener('knob2', p));
        }
      }
    );
  }),
  (Pip.createKeyboard = function (e, t, i) {
    let r = 0,
      n = 0,
      o = !1,
      s = !1;
    const a = [
        '`1234567890-=\b',
        ' qwertyuiop[]\x03',
        "\x02asdfghjkl;'\x03\x03",
        ' \\zxcvbnm,./  '
      ],
      l = [
        '~!"#$%^&*()_+\b',
        ' QWERTYUIOP{}\x03',
        '\x02ASDFGHJKL:@\x03\x03',
        ' |ZXCVBNM<>?  '
      ],
      p =
        '\x15\x15\x82\0\0\0\x15\0\0\0\0\x1F\xE0\0\0\0\x1Fn\0\0\0\x1FB\xE0\0\0\x0F@>\0\0\x0B\x80\x03\xD0\0\x0B\x80\0}\0\x0B\x80\0\x07\xD0\x0B\x80\0\0}\x0B\x80\0\0\x07\xD7\x80\0\0\0}\xFF\xE0\0\x1F\xFF/\xFC\0\x07\xFE@\x0B\0\x01\xD0\0\x02\xC0\0t\0\0\xB5Um\0\0/\xFF\xFF@\0\x01UU@\0\0\0\0\0\0\0j\xAA\xA9\0\0/\xFF\xFF@\0',
      d =
        '\x1B\x12\x82\0\0\x07\xFF\xFF\xFF\xFF\xFC\0?\xFF\xFF\xFF\xFF\xF0\x02\xE0\0\0\0\x03\xC0/\0\0\0\0\x0F\x01\xF4\0\0\0\0<\x1F@\x03\x80<\0\xF0\xF8\0\x0F\x83\xF0\x03\xCF\x80\0\x0F\xBF\0\x0F\xBC\0\0\x1F\xF0\0>\xF0\0\0?\x80\0\xF3\xE0\0\x03\xFF\x80\x03\xC7\xD0\0?\x1F\x80\x0F\x07\xD0\x01\xF0\x1F\0<\x0B\xC0\x01\0\x10\0\xF0\x0B\xC0\0\0\0\x03\xC0\x0F\x80\0\0\0\x0F\0\x1F\xFF\xFF\xFF\xFF\xFC\0\x1F\xFF\xFF\xFF\xFF\xF0',
      c = 32,
      A = 32,
      g = 20,
      P = 150,
      f = [
        439, 185, 464, 185, 464, 242, 408, 242, 408, 218, 439, 218, 439, 185
      ],
      u = { x: 407, y: 249, x2: 464, y2: 274 };
    function m(t, s) {
      if (s) {
        let e = setInterval(() => {
          m(t);
        }, 200);
        return (
          setWatch(
            () => {
              clearInterval(e);
            },
            ENC1_PRESS,
            { edge: -1, repeat: !1 }
          ),
          void 0
        );
      }
      if (t) (Pip.playSound('SCROLL'), (n = (n + 4 + t) % 4), w.draw());
      else {
        Pip.playSound('SELECT');
        var p = (o ? l : a)[n][r];
        ('\x02' == p
          ? (o = !o)
          : '\x03' == p
            ? i(e)
            : '\b' == p
              ? (e = e.slice(0, -1))
              : (e += p),
          w.removed || w.draw());
      }
    }
    function E(e) {
      (Pip.playSound('SCROLL'), (r = (r + e + 14) % 14), w.draw());
    }
    let w = {
      draw: () => {
        const i = o ? l : a;
        (h.reset().setFontAlign(0, 0),
          h.clearRect(BR).setColor(1),
          r >= 0 &&
            ((r >= 12 && 2 == n) || (13 == r && 1 == n)
              ? h.fillPoly(f)
              : r >= 12 && 3 == n
                ? h.fillRect(u)
                : h.fillRect(
                    g + r * c,
                    P + n * A,
                    g + (r + 1) * c - 1,
                    P + (n + 1) * A - 1
                  )),
          h.setColor(3).drawImage(p, 25, 219),
          h.drawImage(d, 439, 156),
          h.setFontMonofonto14().drawString('Enter', 430, 232).drawPoly(f),
          h.drawString('Space', 430, 264).drawRect(u),
          h.setFontMonofonto23());
        let m = 36,
          E = 166;
        for (let e = 0; e < 14; e++)
          (h
            .drawString(i[0][e], m, E)
            .drawString(i[1][e], m, 198)
            .drawString(i[2][e], m, 230)
            .drawString(i[3][e], m, 262),
            (m += c));
        (h.setFontMonofonto14().setFontAlign(-1, 0),
          h.drawString(t, 20, BR.y + 38),
          h.setFontMonofonto28(),
          h.stringWidth(e) > 415 && (e = e.slice(0, -1)),
          h.drawRect(20, BR.y + 52, 465, BR.y + 102),
          h.drawString(e + (s ? '_' : ' '), 32, BR.y + 80),
          h.flip());
      },
      remove: () => {
        ((w.removed = !0),
          Pip.removeListener('knob1', m),
          Pip.removeListener('knob2', E),
          clearInterval(S));
      }
    };
    (w.draw(), Pip.onExclusive('knob1', m), Pip.onExclusive('knob2', E));
    var S = setInterval(() => {
      ((s = !s), w.draw());
    }, 600);
    return w;
  }),
  (Pip.renderTextOverflow = (e, t, i, r, n) => {
    const o =
        '\x10\b\x02\0\0\x80\0\0\x03\xE0\0\0\x0F\xF8\0\0\x7F\xBF\0\x01\xF8\x1F\x80\x06\xE0\x03\xE0\x1A@\0\xB8h\0\0\x1A',
      s =
        '\x10\b\x02T\0\0\x05*\0\0)\x0E\xC0\x01\xE8\x03\xF4\x0B\xD0\0\xBD?@\0/\xFD\0\0\x0B\xF0\0\0\x02\xC0\0',
      a = h.setFont('Monofonto14').wrapString(e, r - 15),
      l = a.length * h.getFontHeight(),
      p = l > n;
    let d = 0,
      c = function (e) {
        ((d = Math.max(0, Math.min(l - n, d + 10 * e))), A.render(), h.flip());
      },
      A = {
        render: () => {
          (h.clearRect(t - r, i, t + 5, i + n),
            p &&
              h
                .drawImage(o, t - 8, i)
                .drawImage(s, t - 8, i + n - 8)
                .fillRect(
                  t - 1,
                  i +
                    10 +
                    (l - n ? Math.min(1, Math.max(0, d / (l - n))) : 0) *
                      (n - 20 - (n / l) * (n - 20)),
                  t + 1,
                  i +
                    10 +
                    (l - n ? Math.min(1, Math.max(0, d / (l - n))) : 0) *
                      (n - 20 - (n / l) * (n - 20)) +
                    (n / l) * (n - 20)
                ),
            h
              .setClipRect(t - r, i, t, i + n)
              .setFontAlign(-1, -1)
              .drawString(a.join('\n'), t - r, i - d)
              .setClipRect(0, 0, 480, 320));
        },
        remove: () => {
          (Pip.removeListener('knob2', c), (c = void 0), (A = {}));
        }
      };
    return (A.render(), p && Pip.onExclusive('knob2', c), A);
  }),
  (Pip.renderBlock = (e, t, i, r, n) => {
    (h
      .drawImage(icons.fadedown, e + i, t)
      .drawLine(e, t, e + i, t)
      .setFont('Monofonto14'),
      h.setFontAlign(-1, -1).drawString(r, e + 4, t + 7),
      h.setFontAlign(1, -1).drawString(n, e + i - 4, t + 7));
  }),
  (Pip.renderDebugInfo = () => {
    if ((h.clearRect(120, 0, 360, 17), Pip.settings.debug)) {
      let e = process.memory(0);
      h.setFont('Fixedsys16')
        .setFontAlign(0, 0)
        .drawString(
          `Free mem:${e.free}/${e.total}, stack:${e.stackFree}`,
          240,
          8
        )
        .setFont('Monofonto14');
    }
  }),
  (Pip.renderHeader = () => {
    const e = Pip.getMode(Pip.MODE),
      t = e.header(),
      i = 18;
    h.clearRect(15, 9, 465, 39).drawImage(icons.fadedown, 15, i);
    const r = Math.max(34, Pip.drawIcons());
    h.drawLine(15, i, r + 13, i)
      .setFont('Monofonto18')
      .setFontAlign(-1, 0)
      .drawString(e.title, r + 23, i);
    let n = h.stringWidth(e.title);
    h.setFont('Monofonto14');
    let o =
      465 -
      t.reduce((e, t) => h.stringWidth(t[0]) + 30 + h.stringWidth(t[1]) + e, 0);
    (h.drawLine(r + n + 33, i, o + 10, i),
      t.forEach((e, t) => {
        let r = o;
        (h.setFontAlign(-1, 0).drawString(e[0], o + 10, 32),
          (o += h.stringWidth(e[0]) + 30 + h.stringWidth(e[1])),
          h.setFontAlign(1, 0).drawString(e[1], o - 4, 32),
          h.drawImage(icons.fadedown, o, i).drawLine(r + 10, i, o, i));
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
    const e = Pip.getMode(Pip.MODE).footer,
      t = e.length,
      i = 300;
    h.setFont('Monofonto14').setFontAlign(0, 0);
    let r = (450 - e.reduce((e, t) => h.stringWidth(t.txt) + e, 0)) / (2 * t),
      n = 15;
    (h.clearRect(0, 286, 479, 314),
      e.forEach((e, t) => {
        n += r;
        let o = h.stringWidth(e.txt);
        (t == Pip.MENUX && Pip.shadeBox(n - 8, 286, n + 8 + o, 311),
          h.drawLine(n - r, i, n - 8, i).drawString(e.txt, n + o / 2, 301),
          h.drawLine(n + o + 8, i, n + o + r, i),
          h.setBgColor(0),
          (n += o + r));
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
          (Pip.CURRENT = { remove: () => {} }),
          h
            .setFont('Monofonto14')
            .setFontAlign(0, 0)
            .drawString('UNABLE TO LOAD ' + src, 240, 160),
          (Pip.menuChanging = !1));
      }
    }, 0);
  }),
  (Pip.changeMenu = (e, t) => {
    if (Pip.menuChanging)
      return (debug('**** Menu change already in progress, ignoring'), void 0);
    ((Pip.menuChanging = !0),
      Pip.remove(),
      process.memory(!0),
      h.clear(),
      Pip.renderHeader(),
      Pip.renderFooter(),
      h.flip(),
      Pip.loadMenu(e, t));
  }),
  (Pip.currentDateTime = (e) => {
    let t = e;
    e || (t = Pip.getDateAndTime());
    let i,
      r = t.getFullYear().toString().padStart(4, 0),
      n = (t.getMonth() + 1).twoDigit(),
      o = t.getDate().twoDigit();
    ((i = Pip.settings.hr12
      ? ((t.getHours() + 11) % 12) + 1
      : t.getHours().toString().padStart(2, 0)),
      Pip.settings.year4 || (r = r.slice(2, 4)));
    let s = [`${i}:${t.getMinutes().twoDigit()}`];
    switch (Pip.settings.timeFormat) {
      case 0:
        ((s[1] = `${o}.${n}.${r}`), (s[2] = s[0] + ', ' + s[1]));
        break;
      case 1:
        ((s[1] = `${n}.${o}.${r}`), (s[2] = s[0] + ', ' + s[1]));
        break;
      case 2:
        ((s[1] = `${r}-${n}-${o}`), (s[2] = s[1] + ' ' + s[0]));
    }
    return ((s[3] = t.getHours() < 12 ? 'AM' : 'PM'), s);
  }),
  (Pip.typeText = (e, t, i, r, n, o) => {
    o || (o = 'Monofonto16');
    let s = [
      'W\0O\0I\0\xC9\xFF\xD2\xFE\xC7\xFEr\0A\x01m\xFF\xC2\xFD\x0F\xFF\xF7\0y\0\xB4\xFE&\xFE\xF7\0\xFC\x02o\x01H\xFF\x8D\xFE\xED\xFF\xDB\x01\xC4\0\x19\xFFW\xFEW\xFFy\x01\xA2\x01y\0\xCB\xFE4\xFE\x85\xFF\\\0\x04\0\xD6\xFF\xC0\xFE\x88\xFF\x95\x01B\x01\x15\0\xC4\xFE\x87\xFE\x8F\0\xE3\0Q\0\xC2\xFF\xFC\xFEC\x01\x8F\x01K\xFFo\xFFu\0\xAB\x01V\x01\xC8\xFE\xC9\xFF\xF5\0\xA4\0\x83\0\x10\xFE\x8D\xFD\x07\xFFg\xFFo\x01\x8D\xFF\xF0\xFD\xEB\xFF<\xFFH\x02-\x02q\xFE\xA7\0\x1E\xFD\xF6\xFD\xE7\x06\x99\x03\x1A\0=\xFB/\xF65\x06\x97\x0B/\xFD\xE2\xFBJ\xF9O\xFFy\f\x87\xFF\xA1\xF8$\0D\xFD\x83\x02\xFD\x03\x17\xFC2\x02\x96\xFF\x9B\xFAf\x02X\x02\xA1\xFF\xF2\x01\xA5\xFE\x17\xFE\x8A\xFFi\0\xC8\x03w\x02G\xFE:\xFD;\xFF)\x01\xD5\0\x07\xFF\x99\x01\x02\xFFy\xFC\xFC\x01a\x04]\x02\b\xFE\x13\xF5\xBE\xFDH\x0BX\x03\x90\xFE\xC2\xFB\xFD\xF5\x0B\x04\x8A\x0Bp\xFEz\xFF\xED\xF6\xC8\xF5\xFD\x114\r\xB2\xF7\xF6\xF9\x03\xF2\f\x01\x81\x1A\x14\xFF\b\xF6\x99\xFEY\xED\xDE\x07#\x17\x9A\xF7\xA0\xFF\xEE\xF3\xB7\xED\xBB\x1B\xC4\x0B\xF3\xEF\xF1\x01\xE2\xF0\x7F\0M\x19\xA7\xF6\xF4\x01u\x06\x19\xE8\x10\x03\xF7\f\xF2\xFEU\r\xF0\xF6\xE8\xEFE\n>\0\x97\0~\n\xF7\xF5\xBD\xF7L\x03\x84\xFF%\x0B\xE5\x04\x80\xF2\xA2\xF8W\xFE-\x03Y\x0F\x1F\x07\x95\xF5\xF6\xF0\xB9\xF9\x05\x0B\xB3\x13\'\x02\x8B\xF02\xF6\x89\x02\x9A\n\x7F\b]\xFBA\xF38\xFA\x02\x02w\t+\n\xB3\xFB8\xF4\x80\xFBv\x02k\t\x15\x06\n\xFC5\xFC\x1C\xFB[\xFC"\x07\xE6\x07+\xFEL\xF9D\xFA\x05\x04U\t\xE4\xFF\xA9\xFA\xA6\xFD\x16\xFES\x01\xA0\x03W\x02\xFF\xFF\x18\xF9\xB3\xF9 \x04\xBF\x07\xDF\x01\xCF\xFC\x0E\xFCT\0\xBA\x02i\0{\xFFB\xFE\n\xFE\xDE\x03\xE3\x04\x17\0z\xFB\x8D\xFA\xA9\x01\xAD\x069\x01z\xFBP\xFC"\x01\xDB\x04I\x01\x18\xFEG\xFE<\xFD\x95\xFE\xB0\x04\xF1\x05\xEF\xFFz\xF7\x80\xF7\xCA\x03\xF5\bR\x03O\xFD@\xFB\xD8\xFD\xF1\x017\x02\x9A\x02\x96\x011\xFB\x82\xFA\xBC\x01\xFD\x05\xCB\x04\xF5\xFDe\xF9\xCA\xFC8\x02\xF3\x04\xE7\x02\x7F\xFDg\xFA\xDA\xFDr\x02\xC4\x04\xBF\x03J\xFF\xC6\xFB\xFD\xFC\xE3\xFF\f\x02\xC6\x02I\xFF;\xFC.\xFE\xEF\x01-\x04\x90\x01\x81\xFCw\xFD1\x01\xA6\x01|\x01\x7F\0b\xFEL\xFE@\xFE(\0U\x02"\0z\xFE\x1D\0\xA8\x01\xC5\0\xC2\xFD%\xFD\x19\x01C\x02\x1F\0\x19\0V\x01\x92\0\xE7\xFD\xD1\xFEN\x02\xBD\x02\x7F\xFFL\xFC\xC1\xFE\xA9\x03y\x03^\xFF \xFDW\xFD\x83\0i\x02\x93\x007\0\xE2\xFE\xE2\xFC\x99\xFF!\x01K\x014\x02\x91\xFF\xA3\xFDY\xFE\xF5\xFFI\x03\xA0\x02\x13\xFE\xEA\xFCG\xFF\x14\x02\xAC\x01\xEC\xFD\xC5\xFD\x8C\0x\0 \0',
      't\0E\0\x90\xFF4\0}\xFF\xD3\xFF\xFC\0\xC8\xFF\xCE\xFF\xE4\xFFT\xFF \x01F\0\x9A\xFEy\0=\0B\0\xC1\0e\xFE\x9D\xFFD\x01\xC7\xFF\xBC\0\xE6\xFFH\xFE\x1C\0\xA5\0[\x01\xCD\0\xCF\xFD\x81\xFEo\0\xF1\x01\x92\x01\xD4\xFE\xBA\xFE\x8E\xFE\xD7\xFF]\x03\x86\0\x95\xFE!\xFF\x8F\xFD\xC1\x012\x03,\xFF\xA9\xFF\xFF\xFD\x7F\xFEb\x02\x1D\0\xC6\0W\x01\xAB\xFE\x8A\xFE\x8F\xFD\x10\x01\x9A\x041\0K\xFE.\xFD9\xFEG\x04`\x01\xDF\xFEy\0\xF8\xFB\x1D\0v\x04\x87\xFE\x9E\0\xD1\xFF5\xFC\f\x03\x92\0\x01\xFE\xAA\x03\x8A\xFDw\xFD{\x04\0\xFE\xE8\xFE\x80\x02\xE3\xFC\x8E\x02z\x02\x90\xFAW\x01\xB7\0\xC1\xFD]\x05\xD2\xFF\x03\xFC\x10\x01\xD4\xFCe\x01Q\x06\x9E\xFD)\xFE\x99\xFE\x13\xFC\x9D\x048\x05\xA4\xFE\xD6\xFD\xC4\xFA\xA8\xFD>\x06\x1A\x05\xFD\0v\xFC\xE7\xF7\x93\xFD\xDF\x06\x8F\x07\x1C\x019\xFA&\xF8\xB2\xFE\x99\x06\xCE\x06\x8B\x01V\xFA\xA3\xF7\x83\xFE)\x07\x97\x07a\x01\xB9\xF9b\xF7\xB6\xFE\xA2\x06\xA6\x07\x01\x02\x05\xFA\xD1\xF7P\xFE\x9D\x05=\x07\xA9\x02\xBD\xFA\t\xF8\x17\xFEN\x05\xF5\x061\x02\xF7\xFA*\xF9{\xFE$\x04\x12\x06\x8B\x02\xB3\xFB\xCC\xF9y\xFE\xBD\x03\x1C\x05\xB5\x01\x84\xFC\xFA\xFB\x18\xFF\xBF\x01\xFF\x02\x82\x01\xE5\xFE\xE4\xFD_\xFE\xF1\xFF=\x02\xD8\x01q\xFFz\xFE\xA7\xFEQ\0>\x01\x87\0&\0\xF1\xFF \xFF\x05\xFF\x18\0\xC2\0\x16\x01u\0M\xFF=\xFF;\xFFd\xFF\xBE\0\xEC\x01\x1B\x01B\xFF\x83\xFD\xD2\xFD\xA0\x01\xA8\x03.\x01\xE0\xFD\x97\xFC\xE4\xFE\xBD\x02I\x03r\0\xB2\xFD\xA5\xFC\x13\xFF\xDD\x02Q\x03\x9D\0|\xFD\xB5\xFC\\\xFF\xBD\x02\x84\x02N\0`\xFE\x8E\xFDe\xFFw\x01\x0E\x02\xF7\0\xEF\xFE\xB1\xFD\xF1\xFE<\x01\xEA\x01T\x01\x11\xFF\xAB\xFD\xF0\xFE\xDE\0\xE8\x01p\x01`\xFF\x95\xFD\xCB\xFE\x15\x01\x15\x02\xC7\0\x8B\xFE\x8F\xFE\xFB\xFF\x13\x01\xE9\0\xAE\xFF\x03\xFF\xC0\xFF\x9C\0~\0\xE3\xFFv\xFF\xCB\xFFe\0\x8F\0\xD5\xFF/\xFF\xBB\xFF\xB1\0\xE9\0\xEC\xFF\x04\xFFP\xFF9\0\xCB\0\x89\0\xDB\xFFR\xFF\xCD\xFF\x17\0\x11\0;\0\x1F\0\x15\0\xF2\xFF\xC6\xFF\xAF\xFF\xFA\xFFn\0|\0\xEE\xFFT\xFF\x8C\xFF=\0\xD8\0z\0u\xFF\x07\xFF\xBC\xFF\xDF\0\xED\0\xDB\xFF\t\xFFt\xFFn\0\xAA\0\x18\0\xB9\xFF\xB5\xFF\xDE\xFF',
      '\xC1\0\xD8\0*\0[\0]\x01+\x01E\x02\x0B\x02\xDB\0%\x01\x94\0=\x01\xF1\xFFH\xFE\xFF\xFEX\0\xF5\xFF\xBC\xFE\x16\xFE\xC4\xFF\xB2\xFE1\xFC\x9E\xFD\xFC\xFD\xFC\xFE(\x02D\xFD\xC7\xFE\xD5\x03\x95\x008\x04\xE8\xFE\xA7\xFA\xF8\b\xFC\x07\xCA\xFB*\xFF\b\xFC$\x05\x1B\f\xFB\xF5\xBE\xF7\n\x05J\xFF\xF1\x01\xC3\xFE\xFE\xF6\xCF\x03F\x04r\xFA\x8D\x02\xC6\x04\x8C\xF9\xF0\x006\xFFJ\xFB\'\x0EG\x02\x93\xECZ\x02\x05\x058\x05c\x0F\xCD\xED\xD1\xF7\xD0\x0EA\xF7I\x02\x15\x06\xC2\xF5\xB9\b\xBB\xF9\x1B\xEF7\r\x96\x06\x07\xFDC\0\xD8\xF4\x11\x04\xE1\x13\x1E\x03[\xF7\xDD\xF7{\xFDr\x07\x06\n%\xF9\xB8\xF7w\xFF\x19\xFB\x8F\x05b\n\xB8\xFC;\xFC\xE5\xF7\x89\xFBO\x0E\xDE\x07W\xFCR\xF6\x03\xF6\xD1\x05\x04\x0Ey\x03\f\xFB\xA3\xF7\xAB\xFD\x83\x066\x06\xD9\xFF\x17\xFA\x98\xFA\xFC\xFC\xC9\x02\xE7\x04+\0\xB0\xFA\xB5\xF6,\xFD\x97\t\xA9\n\xE5\x02x\xF8\xC9\xF6\xC4\x02@\fw\t\x1B\xFD\xDF\xF3T\xFB\xE6\x07\x84\n+\x02\x85\xF6"\xF7E\xFFD\x07`\x07\x99\xFF\x9C\xF7q\xF5\xC6\xFCz\x05p\b\xBA\0\xB4\xF6\xE7\xF6\t\x01\x18\n\xAF\b:\xFF\x04\xF8\x87\xFB\x9F\x04\xF5\t\xFF\x05L\xFCw\xF9\xF2\xFC9\x01\xC7\x04\xB3\x04\xB6\xFE\xFF\xF76\xF9\xEA\0\x8A\x07\xC1\x03\xBD\xFA\x18\xF9M\xFE\x84\x06\xEB\x07D\xFF\xA8\xF8\x18\xFB\x1F\x03N\x07\xEE\x03\xEE\xFD\xA1\xFCh\xFEt\x01%\x03\x10\x01\x81\xFE#\xFC\x95\xFCu\xFFp\x03h\x01-\xFBe\xFA\x80\xFFX\x05<\x04\xCB\xFF\x85\xFD\x1C\xFE1\0\xC4\x01\xF2\x02\xEA\0\xCB\xFE\x04\xFEh\xFF>\x04\x84\x05\x9A\0\x9B\xFA\x9E\xFB0\x02\xB6\x04\xFF\0\b\xFD\x05\xFDK\xFF+\x02+\x03\xC1\0\x9C\xFD\xA9\xFC8\xFF0\x02\xCE\x024\x01"\xFE$\xFE\xF3\xFF\xDB\0V\0\xD8\xFD\xE0\xFD\xD1\xFE\x03\xFF]\xFF\xB6\xFF\xA1\xFE\xD1\xFD_\xFF\x99\0\xC7\x01\xA1\x01\x88\xFF\xD9\xFEb\x01\x01\x03\xE3\x02>\x02\xEE\0\x95\xFF\x93\0v\x02Y\x02\xED\0 \xFE\x95\xFE?\0\x12\0F\xFF\x17\xFF\x83\xFE\x9C\xFD\x90\xFEy\xFE\xBF\xFE\xBF\xFF\xAB\xFD\xDA\xFDW\x01\xDC\x01\x1C\0\xBB\xFF\xEF\0\xAF\x02\xD1\x03\xDF\0W\xFF^\0\x19\0p\xFF\xA6\xFE\x04\0q\x01\n\xFF\xF9\xFC\x87\xFF:\x02e\0{\xFDd\xFD0\0\x97\x02t\x014\xFF\x03\xFF9\x01\xB7\x01\x07\0\x15\xFF!\xFF\x1B\x01\xC0\0\xC5\xFF \x01J\0U\xFFX\xFF\xC3\xFF\x1D\x01\xFF\0=\xFE\0\xFD\xF5\xFE\x85\0\xF3\xFFe\xFF\x91\xFF#\0&\0\x88\xFF(\0|\0Z\0\x04\x01\xCD\0+\xFFs\0\x1A\x01\x1F\0\xDB\xFF\x1D\0"\x01+\x02!\x02\x04\0\xCC\xFFV\xFF\xB7\xFE;\xFF\x90\xFF\xDF\xFFj\0\xFA\xFF(\0\x81\0\xFA\xFF\x14\0\xEF\0',
      '\x9F\0\xAB\x01\xE8\x01\xC2\x01m\0\xF0\xFFy\x01\x7F\x01p\xFF\xEC\xFEr\xFFj\xFF\xC6\xFE8\xFF_\xFF\xD3\xFD\xEB\xFES\x01\x9F\0\xBC\xFFt\xFF\x10\0\x82\x01p\x01r\0L\xFFq\0f\x01P\xFF\x95\xFE\x82\xFFW\x01\x16\x01Y\xFFG\xFFL\0\x8F\x016\x01\xF6\xFE\x18\xFE\x9A\0\xF1\xFF;\xFFe\0c\xFF\xE8\xFFS\0\xBE\xFF)\x01\x93\0\xE0\xFFO\x01]\xFE]\xFE\x1C\x02\x19\0\xA8\xFD\xD5\xFC\x88\xFD}\x01s\x01L\xFFK\xFF\xEA\0\x86\x02v\0*\xFED\0\xAA\x04\x90\x03\x1D\xFE\xE1\xFCI\0\x0B\x03:\x02\x0B\xFE\xAA\xFC\xD3\0\xF2\x01\\\xFFU\xFD\x86\xFD\xC3\xFF$\0\x8D\xFE\xB1\xFE\x96\xFE\xCE\0\x84\x03\xF0\0\xA0\xFE\xD3\xFB\xF5\0\xDF\x07\x8A\x02\xB5\xFE\xCD\xFCm\xFDs\b\x97\x03X\xFA,\xFF"\xFB\xF4\x01\xE4\t\xDD\xF9\xC1\xFB\xDE\xFF\r\xFC\x1F\x0B\xDA\xFC\0\xEF=\x02+\x05\xA2\t\xA1\x04\xBA\xE9k\xFA\xB7\x12\r\x0B#\x03#\xF0\xEE\xF0\xA3\x0E\x17\r\xC3\xFC\x15\xF9C\xF6y\x03J\x0Bj\xFFT\xFB\x8D\xFE\xF4\xFF\x0F\x04\xD1\x01\xE9\xF9T\xFE\x87\x07\x1A\x06w\x01\x9E\xF8\xAF\xF3)\x03\xBC\x0Bs\x06)\xFB\x0B\xEFK\xF87\n\x92\x0Ba\x01\x8B\xF4\xBE\xF4\xA9\x037\x0BC\x06\xA2\xFCG\xF9\x05\xFF\x1F\x04\xF6\x02\xEF\xFE-\0u\x03\x83\x016\xFDB\xFD\xAF\x01S\x05\x18\x03\x95\xFD\x06\xFA\xA4\xF9@\xFE\x9C\x03\xD2\x04\x02\x03\x8B\xFC\x97\xF7\x82\xFA\xF7\x01\x01\t\xFE\x05\xAC\xFC\x13\xF8\xE3\xFA\xC3\x036\x0B+\bn\xFF\x91\xF7t\xF6W\xFF\x91\n;\f\r\x02I\xF5-\xF2\xA1\xFD{\nd\f\x11\x02-\xF3\x80\xF0+\xFD?\n~\rY\x02y\xF5\x8A\xF4\xED\xFD \t2\f\xCD\x03\x1F\xFA@\xF6\x8C\xF9&\x03\x0E\n\x13\b\x8F\xFE\r\xF5\x7F\xF6K\x01B\tY\b\x10\0b\xF8\xC4\xF8\x15\xFF"\x06[\t$\x04:\xFC\b\xF8\xF4\xFB\xBB\x03\xB3\x06q\x04F\xFE\xD2\xF8\x11\xFAJ\xFF\xB9\x03\xFB\x04\x91\x01\'\xFB7\xF83\xFD-\x04\x8C\x07L\x03\x9D\xFC\xA6\xF9V\xFC\x1F\x03\x10\b\xD2\x05*\xFF\x02\xFA\xCA\xFAC\x01q\x06\xB5\x05\x1B\0\0\xFA\xEA\xF7V\xFC\x95\x03\xFE\x06\x9F\x019\xFA&\xF9y\xFE\x13\x04\xDA\x05\xDE\x02\xEC\xFC\xD4\xFA\xBD\xFE\xF9\x03\x14\x06\xC3\x03\xEA\xFE\x06\xFC6\xFD$\x02\x1C\x04\xF4\x01\x1C\xFF\x82\xFC\xCD\xFC\x05\xFF\xE6\x01\xC6\x02o\xFF\xBC\xFBM\xFC\xF9\xFEd\x02<\x03\x7F\0;\xFE\xC3\xFEg\0v\x01\xC6\x01\xC7\x01H\x01\x9C\xFEL\xFE*\xFF\xAC\0l\x02\x83\0U\xFDG\xFD\xC9\xFF\x17\x02\xFA\xFF\x9E\xFE\xD9\xFE\x96\xFE<\0\xC3\0g\0\x0E\x01\xB5\x01\x99\0#\xFF\x01\xFF\xF8\x01\\\x03\x8A\0\n\xFE\xCD\xFE:\0N\x01\x90\0\xCB\xFE\x94\xFD\xE5\xFC\xF9\xFDH\0\x91\x02\xB0\x01l\xFE{\xFD\xF3\xFF\xB6\x02\x7F\x03\x97\x01O\0\xF4\xFF\x03\0k\0\xAB\xFF\x8E\0\x18\x02"\xFF\xA2\xFCi\xFE$\x01T\x01\xE6\xFDh\xFB\xEF\xFD\x10\x01\x0F\x01E\xFFJ\xFEI\0\xAF\x01J\x01\xDE\0\xD4\0\xDA\x01\f\x02\r\0\xD2\xFE\x87\xFF'
    ];
    (t || (t = 0),
      i || (i = 0),
      r || (r = h.getWidth() - t),
      n || (n = h.getHeight() - i));
    const a = t,
      l = i;
    Pip.timers.typeText && clearTimeout(Pip.timers.typeText);
    let p = 0,
      d = 0;
    const c = e.split(/\x20|\xa0|\x09/);
    let A = c[0];
    h.setFont(o).setFontAlign(-1, -1).setColor(3);
    const g = h.getFontHeight();
    let P,
      f = 0;
    return new Promise((e) => {
      function u(o) {
        if (
          (1 == d && t + h.stringWidth(A) > a + r && ((t = a), (i += g)),
          i > l + n - g &&
            (h.setClipRect(a, l, a + r - 1, l + n - 1),
            h.scroll(0, -g).flip(),
            h.setClipRect(0, 0, 479, 319),
            (i -= g)),
          d <= A.length)
        )
          (h.drawString(o, t, i, !0),
            (t += h.stringWidth(o)),
            ('\n' == o || t > a + r - 6) && ((t = a), (i += g)));
        else {
          if (((d = 0), t > a && (t += 8), !(++p < c.length)))
            return (
              Pip.timers.typeText && clearTimeout(Pip.timers.typeText),
              delete Pip.timers.typeText,
              e({ x: t, y: i }),
              void 0
            );
          A = c[p];
        }
      }
      (function e() {
        let r = A[d++];
        if ('\xA7' == r)
          ((P = setInterval(() => {
            h.setColor(++f % 10 < 5 ? 3 : 0)
              .fillRect(t, i, t + 6, i + 15)
              .flip();
          }, 50)),
            (Pip.timers.typeText = setTimeout(() => {
              (h
                .setColor(0)
                .fillRect(t, i, t + 6, i + 15)
                .setColor(3)
                .flip(),
                clearInterval(P),
                e());
            }, 600)));
        else {
          if (
            (h.setFont(o).setFontAlign(-1, -1),
            u(r),
            d <= A.length &&
              (3 & f++
                ? Pip.blitScreen(
                    h,
                    Object.assign({ y1: i, y2: i + 15 }, Pip.blitOptions)
                  )
                : h.flip(),
              (Pip.lastFlip = getTime()),
              ('\n' != r || p > 0) &&
                Pip.audioStartVar(s[Math.randInt(s.length)]),
              digitalRead([BTN_STATS, BTN_ITEMS, BTN_DATA, ENC1_PRESS])))
          )
            for (; p < c.length;) ((r = A[d++]), '\xA7' != r && u(r));
          p < c.length &&
            (Pip.timers.typeText = setTimeout(e, Math.randInt(25)));
        }
      })();
    });
  }),
  (Pip._vPrev = null),
  (Pip.checkSelectorSwitch = () => {
    let e = MODE_SELECTOR.analog();
    if (Math.abs(e - Pip._vPrev) < 0.005) {
      let t = 0;
      (e > 0.9
        ? (pinMode(MEAS_ENB, 'input'),
          pinMode(MEAS_ENB, 'opendrain'),
          MEAS_ENB.write(0),
          (t = Pip.settings.fallbackMode))
        : e < 0.1
          ? (t = 4)
          : e < 0.3
            ? (t = 3)
            : e < 0.5
              ? (t = 2)
              : e < 0.7 && (t = 1),
        null != t &&
          t != Pip.MENUX &&
          (Pip.emit('menuX', t), Pip.kickIdleTimer()));
    }
    Pip._vPrev = e;
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
  Pip.on('mode', (e, t) => {
    if ((Pip.CURRENT.notDefault && (t = !0), Pip.MODE == e && !t)) return;
    ((Pip.MODE = e), Pip.changeMenu(), Pip.playSound('MODE'));
    const i = Pip.settings.brightness;
    switch (e) {
      case 0:
        Pip.fadeTo([
          { pin: LED_STATS, target: i },
          { pin: LED_ITEMS, target: 0 },
          { pin: LED_DATA, target: 0 }
        ]);
        break;
      case 1:
        Pip.fadeTo([
          { pin: LED_STATS, target: 0 },
          { pin: LED_ITEMS, target: i },
          { pin: LED_DATA, target: 0 }
        ]);
        break;
      case 2:
        Pip.fadeTo([
          { pin: LED_STATS, target: 0 },
          { pin: LED_ITEMS, target: 0 },
          { pin: LED_DATA, target: i }
        ]);
    }
    Pip.screenGlitch();
  }),
  Pip.on('menuX', (e) => {
    ((Pip.MENUX = e),
      Pip.changeMenu(),
      Pip.playSound('TAB'),
      Pip.screenGlitch());
  }),
  (Pip.setBrightness = (e) => {
    ((Pip.settings.brightness = e),
      Pip.fadeTo([
        { pin: LCD_BL, target: e, stepFactor: 1.1 },
        { pin: LED_STATS, target: 0 === Pip.MODE ? e : 0, stepFactor: 1.1 },
        { pin: LED_ITEMS, target: 1 === Pip.MODE ? e : 0, stepFactor: 1.1 },
        { pin: LED_DATA, target: 2 === Pip.MODE ? e : 0, stepFactor: 1.1 },
        { pin: LED_RED, target: e, stepFactor: 1.1 },
        { pin: LED_GREEN, target: e / 2, stepFactor: 1.1 },
        { pin: LED_DOWNFIRE, target: Pip.charging ? e : 0, stepFactor: 1.1 }
      ]));
  }),
  (Pip.checkChargeStatus = (e) => {
    if (VUSB_PRESENT.read()) {
      const e = Pip.settings.brightness;
      if (Pip.charging) {
        const t = ~~getTime() % 6;
        Pip.battLevel >= C.BAT_FULL_LEVEL
          ? 0 == t && Pip.fadeTo({ pin: LED_DOWNFIRE, target: e })
          : CHARGE_STAT.read()
            ? t % 2 == 0
              ? Pip.fadeTo({ pin: LED_DOWNFIRE, target: 0 })
              : Pip.fadeTo({ pin: LED_DOWNFIRE, target: e })
            : 0 == t
              ? Pip.fadeTo({
                  pin: LED_DOWNFIRE,
                  target: e / 8,
                  stepFactor: 1.03
                })
              : 3 == t &&
                Pip.fadeTo({ pin: LED_DOWNFIRE, target: e, stepFactor: 1.03 });
      } else
        (Pip.kickIdleTimer(),
          (Pip.charging = !0),
          Pip.fadeTo({ pin: LED_DOWNFIRE, target: e }),
          Pip.sleeping ||
            (debug('USB power connected'),
            Pip.audioStart('SOUND/FX/ARC_03.WAV'),
            Pip.CURRENT.fullscreen || Pip.renderHeader(),
            h.flip()),
          Pip.checkBatteryLevel(!0));
    } else
      Pip.charging &&
        ((Pip.charging = !1),
        Pip.kickIdleTimer(),
        Pip.fadeTo({ pin: LED_DOWNFIRE, target: 0 }),
        Pip.sleeping ||
          (debug('USB power disconnected'),
          Pip.checkBatteryLevel(!0),
          Pip.CURRENT.fullscreen || Pip.renderHeader(),
          h.flip()));
    (Pip.checkBatteryLevel(e),
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
  (Pip.startDebugInfoTimer = () => {
    Pip.timers.debug ||
      (Pip.timers.debug = setInterval(Pip.renderDebugInfo, 2000));
  }),
  (Pip.checkBatteryLevel = (e) => {
    MEAS_ENB.write(0);
    {
      let t,
        i = 0;
      for (; Math.abs((t = VBAT_MEAS.analog()) - i) > 0.01;) i = t;
      ((t *= 2 * E.getAnalogVRef()),
        (Pip.battLevel =
          Pip.battLevel && t > 0 && !e
            ? C.BAT_SMOOTHING * t + (1 - C.BAT_SMOOTHING) * Pip.battLevel
            : t));
    }
    const t = VUSB_PRESENT.read(),
      i = t ? 3.6 : 3.5,
      r = t ? 4.2 : 4.1;
    Pip.lowBatt = Pip.battLevel < C.BAT_LOW_LEVEL && !t;
    const n = Math.round(9 * E.clip((Pip.battLevel - i) / (r - i), 0, 1));
    (n != Pip.battIcon || Pip.lowBatt) &&
      ((Pip.battIcon = n),
      Pip.CURRENT.id && !Pip.CURRENT.fullscreen && Pip.drawIcons());
    let o = !t && Pip.battLevel < C.BAT_CRITICAL_LEVEL;
    return (
      o &&
        (LED_GREEN.write(0),
        e
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
      !o
    );
  }),
  (Pip.checkHeadphoneState = (e) => {
    (!HP_DETECT.read() !== Pip.headphonesPresent || e) &&
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
      Pip.settings.debug && Pip.startDebugInfoTimer());
    ([ACCEL_INT, VUSB_PRESENT, CHARGE_STAT, CHARGE_STANDBY, HP_DETECT].forEach(
      (e) => e.mode('input')
    ),
      [MODE_SELECTOR, CHARGE_CURRENT, VUSB_MEAS, VBAT_MEAS].forEach((e) =>
        e.mode('analog')
      ),
      (Pip.timers.selectorSwitch = setInterval(Pip.checkSelectorSwitch, 100)),
      (Pip.timers.flip = setInterval(function () {
        (ACCEL_INT.read() ||
          (Pip.accel.releaseInt(),
          Pip.settings.glitchOnTap &&
            (function () {
              let e = [
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
                let t = getTime() + 10;
                (e.push([
                  { filter: 307, y: 0, ydiff: 1 },
                  { filter: 4659 },
                  { filter: 74546 },
                  { filter: 1192753 },
                  { filter: 17969969 },
                  {
                    filter: 286405425,
                    cb: function e() {
                      Pip.blitOptions.anim =
                        getTime() < t
                          ? [
                              { filter: 286405425, c: 2 },
                              { filter: 287519537, c: 3 },
                              { filter: 305345329, c: 3 },
                              { filter: 305345329, c: 3 },
                              { filter: 287519537, c: 2 },
                              { filter: 287519537, cb: e }
                            ]
                          : [{ filter: 307, ydiff: 1, y: 0 }];
                    }
                  }
                ]),
                  e.push([
                    { filter: 307, y: 0, ydiff: 1 },
                    { filter: 4659, y: 10 },
                    { filter: 74546, y: 20 },
                    { filter: 1192753, y: 40 },
                    { filter: 17969969, y: 80 },
                    {
                      filter: 286405425,
                      y: 120,
                      cb: function e() {
                        Pip.blitOptions.anim =
                          getTime() < t
                            ? [
                                { y: 160 },
                                { y: 200 },
                                { y: 240 },
                                { y: 280 },
                                { y: 0 },
                                { y: 40 },
                                { y: 80 },
                                { y: 120, cb: e }
                              ]
                            : [{ filter: 307, ydiff: 1, y: 0 }];
                      }
                    }
                  ]));
              }
              Pip.blitOptions.anim = e[Math.randInt(e.length)];
            })()),
          getTime() - Pip.lastFlip > 0.03 && h.flip());
      }, 50)));
  }),
  (Pip.stopTimers = (e) => {
    (e || [])
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
      .forEach((e) => {
        (Pip.timers[e] && clearInterval(Pip.timers[e]), delete Pip.timers[e]);
      });
  }),
  (Pip.kickIdleTimer = function () {
    (0,
      Pip.timers.idle && clearTimeout(Pip.timers.idle),
      (Pip.timers.idle =
        !Pip.settings.idleTimeout || VUSB_PRESENT.read() || Pip.sleeping
          ? void 0
          : setTimeout(() => {
              const e = 'Pip-OS entering sleep mode...';
              (Pip.remove(),
                clearWatch(),
                h.clearRect(BR).setFontMonofonto16(),
                Pip.typeText(e, 240 - h.stringWidth(e) / 2, 150).then(() =>
                  setTimeout(Pip.goToSleep, 800)
                ));
            }, Pip.settings.idleTimeout)));
  }),
  (Pip.radio = {
    freq: 9950,
    interval: void 0,
    write_reg: function (e, t) {
      I2C2.writeTo(17, [e, (t >> 8) & 255, 255 & t]);
    },
    read_reg: function (e) {
      try {
        const t = I2C2.readReg(17, e, 2);
        return (t[0] << 8) | t[1];
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
    getVol: function () {
      0;
      const e = (I2C1.readReg(16, 72, 1) || [0])[0] >> 1;
      return Math.round((e - 19) / 4);
    },
    setVol: function (e) {
      (0,
        I2C1.writeTo(16, 72, ((4 * e + 19) << 1) & 254),
        (Pip.settings.rdVol = e));
    },
    init: function () {
      (Pip.settings.rdFreq && (this.freq = Pip.settings.rdFreq),
        Pip.I2CInit(I2C2),
        I2C1.writeTo(16, 68, 3),
        void 0 !== Pip.settings.rdVol && this.setVol(Pip.settings.rdVol));
      const e = this.read_reg(0) >> 8;
      switch (
        (debug(
          88 == e
            ? `RDA5807 ID: 0x${e.toHex()} (as expected)`
            : `Unexpected value reading RDA5807 ID: 0x${e.toHex()}`
        ),
        this.write_reg(2, 3),
        this.write_reg(2, 49157),
        this.write_reg(3, 8),
        this.write_reg(4, 1024),
        this.write_reg(5, 34476),
        this.write_reg(6, 0),
        this.write_reg(7, 24112),
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
    setPower: function (e) {
      e
        ? (debug('Turning radio ON'),
          (Pip.radioOn = !0),
          1,
          this.init(),
          this.setFreq(this.freq),
          Pip.enableMCLK(1),
          Pip.setDACMode('out'))
        : (debug('Turning radio OFF'), (Pip.radioOn = !1), 1, this.off());
    },
    seek: function (e, t) {
      let i = this.read_reg(2);
      ((i |= 256),
        e ? (i |= 512) : (i &= -513),
        this.write_reg(2, i),
        debug(`Seeking ${e ? 'up' : 'down'}...`),
        this.interval && clearInterval(this.interval),
        (this.interval = setInterval(() => {
          const e = this.read_reg(10),
            i = 1023 & e,
            r = i * this.chans_per_MHz + this.start;
          (t &&
            t({
              chan: i,
              freq: r / 100,
              status: 8192 & e ? 'FAIL' : 16384 & e ? 'FOUND' : 'SEEK'
            }),
            24576 & e &&
              (clearInterval(this.interval),
              (this.interval = void 0),
              debug(
                `- ch ${i} (${r / 100} MHz) ${8192 & e ? '(failed)' : 16384 & e ? 'found' : ''}`
              )));
        }, 200)));
    },
    setFreq: function (e) {
      if (e < this.start || e > this.end)
        return (
          debug(
            `Invalid frequency (${e}) - must be between ${this.start} and ${this.end}`
          ),
          void 0
        );
      this.interval && (clearInterval(this.interval), (this.interval = void 0));
      const t = ((e - this.start) / this.chans_per_MHz) & 1023,
        i = (t << 6) | (this.band << 2) | this.space;
      (debug(
        `Band:${this.band} (start:${this.start}, end:${this.end}), spacing:${1e3 / this.chans_per_MHz} kHz, tuning to ${e / 100} MHz (channel ${t})`
      ),
        this.write_reg(3, i),
        this.write_reg(3, 16 | i));
      let r = 0;
      this.interval = setInterval(() => {
        const e = this.read_reg(10);
        24576 & e
          ? (debug(`- set channel=${1023 & e} ${8192 & e ? '(failed)' : 'OK'}`),
            clearInterval(this.interval),
            (this.interval = void 0))
          : r++ > 10 &&
            (debug('Giving up!'),
            clearInterval(this.interval),
            (this.interval = void 0),
            this.write_reg(3, -17 & i));
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
    let e = Pip.settings.alarm;
    if (e && e.enabled && e.time && !Pip.inDemoMode) {
      let t = Pip.getDateAndTime(),
        i = new Date(e.time);
      if (
        (e.snoozeTime && (i = new Date(e.snoozeTime)),
        i.getTime() <= t.getTime() &&
          (Pip.log(`Alarm time (${i}) is in the past, setting to tomorrow`),
          (i = Pip.getDateAndTime()),
          i.setDate(t.getDate() + 1),
          i.setHours(new Date(e.time).getHours()),
          i.setMinutes(new Date(e.time).getMinutes()),
          delete e.snoozeTime),
        i.getTime() > t.getTime() + 31556925974)
      )
        return (
          Pip.log(
            `Alarm time (${i}) is more than a year in the future - disabling`
          ),
          (e.enabled = !1),
          fs.writeFileSync(
            'SETTINGS/DEVICE.JSON',
            JSON.stringify(Pip.settings)
          ),
          void 0
        );
      (e.snoozeTime || (e.time = i.getTime()),
        (Pip.timers.alarm = setTimeout(function t() {
          if ('BUSY' == Pip.sleeping) return setTimeout(t, 10000);
          (e.repeat || (e.enabled = !1),
            Pip.sleeping
              ? (Pip.wake(), Pip.wakeUp(!1, 'ALARM.JS'))
              : ((Pip.settings.brightness || 0) < C.LOW_BRIGHTNESS &&
                  Pip.setBrightness(1),
                Pip.changeMenu('ALARM.JS')),
            debug('ALARM!'));
        }, i.getTime() - t.getTime())),
        debug(
          `Alarm set to ${i} (${((i.getTime() - t.getTime()) / 60 / 6e4).toFixed(3)} hours away)`
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
    const e = Pip.settings.brightness;
    Pip.setBrightness((e || 0) < C.LOW_BRIGHTNESS ? 1 : e);
  }),
  (Pip.bootAnimation = function () {
    const e = process.memory(!1);
    return (
      h.clear(),
      Pip.typeText(
        `\n\n§§§*************** PIP-OS(R) V5.0.1.4 ***************\n\nCOPYRIGHT 2068 ROBCO(R) §\nLOADER V${VERSION}\nEXEC VERSION ${process.env.VERSION} §\n${((e.total * e.blocksize) / 1e3).toFixed(0)}K RAM SYSTEM\n${e.free * e.blocksize} BYTES FREE\nNO HOLOTAPE FOUND §\nLOAD ROM(1): DEITRIX 2040... COMPLETE §\n\n\n\n\n\n\n\n\n\n\n\n\n`,
        40,
        0,
        400,
        240
      )
    );
  }),
  LCD_BL.write(1),
  Pip.checkBatteryLevel(!0))
) {
  if (
    (Pip.log(`------- Booting ${process.env.VERSION} - ${VERSION} -------`),
    Pip.log(`Battery: ${Pip.battLevel.toFixed(2)} V`),
    1,
    Pip.log(`Reset byte: 0x${Pip.resetByte.toHex()}`),
    1,
    Pip.log(
      'Reset flags: ' +
        (['RMVF', 'BOR', 'PIN', 'POR', 'SFT', 'IWDG', 'WWDG', 'LPWR']
          .filter((e, t) => Pip.resetByte & (1 << t))
          .join(',') || 'None')
    ),
    g.setFontMonofonto16().setFontAlign(0, 0),
    (Pip.doReset = 4 == Pip.resetByte),
    Pip.doReset)
  ) {
    const e = 'Resetting settings to defaults';
    (Pip.log(e),
      g.drawString(e, 240, 210),
      fs.writeFileSync(
        'SETTINGS/DEVICE.JSON',
        fs.readFileSync('SETTINGS/DEFAULT/DEVICE.JSON')
      ));
  }
  ((Pip.settings = loadJSONWithDefaults(
    'SETTINGS/DEVICE.JSON',
    'SETTINGS/DEFAULT/DEVICE.JSON'
  )),
    (NV = !!Pip.settings.nv),
    setRGB(Pip.settings.theme),
    (global.player = new Player('SETTINGS/PLAYER.JSON')),
    player.getinfo(!0),
    Pip.setVol(Pip.settings.volume),
    E.setTimeZone(Pip.settings.tz || 0),
    0,
    BTN_ITEMS.read()
      ? (Pip.playSound('SELECT'), eval(fs.readFileSync('JS/FACTORYTEST.JS'))())
      : BTN_POWER.read()
        ? (g.drawString(
            'Release power button to continue booting',
            240,
            210,
            !0
          ),
          setWatch(Pip.run, BTN_POWER, { edge: -1 }))
        : Pip.doReset
          ? (delete Pip.doReset, Pip.bootAnimation().then(Pip.run))
          : Pip.run());
} else Pip.goToSleep();
(1,
  (Pip.offAnimation = function () {
    Pip.blitOptions.anim = [
      { filter: 4658, y: 0, ydiff: 1 },
      { filter: 1192737 },
      { filter: 19084065 },
      { filter: 305345313 }
    ];
    var e = (E.toFlatString || E.toString)(
        '\x10\xB5@\xF2?\x14\xA2BO\xF0x\x03!\xEA\xE1q\xA8\xBF"F\x03\xFB\x01\x01\x02\xFB\x033\x18D\0#\x81B\x02\xD2A\xF8\x04;\xFA\xE7\x10\xBD\x10\xB5\0#\x02hP\xF8xL\x14C\x82o\x14C\xD0\xF8\xF0 "CA\xF8# \x013\x1E+\0\xF1\x04\0\xEF\xD1\x10\xBD-\xE9\xF8O\x04F\xD0\xB3P%\0\xF5\x95F\rA\0\xF5\x96H\b6\xA0\'O\xF0\0\x0BO\xF0x\t@\xF2=\x1A]E\x19\xDD\xC7\xF5\x9Fp\x01(\xB8\xBF\x01 1F\t\xFB\0@\xFF\xF7\xCF\xFFWE8F\xA8\xBFPFAF\t\xFB\0@\x0B\xF1\x01\x0B\xFF\xF7\xC4\xFF\b\xF1x\b\x027x>\xE3\xE7n\0\xC5\xF1\xA0\x02\xC6\xF1\xA0\x01 F\xFF\xF7\xA1\xFF\x06\xF1\xA0\x02\x05\xF1\xA0\x01 F\xBD\xE8\xF8O\xFF\xF7\x98\xBF\xBD\xE8\xF8\x8F'
      ),
      t = E.nativeCall(83, 'void(int,int)', e);
    return new Promise((e) => {
      var i = 0,
        r = setInterval(function () {
          if (i < 7)
            (t(E.getAddressOf(h.buffer, 1), i),
              Pip.blitImage(h, 0, 0, { noScanEffect: 1 }));
          else {
            h.clearRect(0, 158, 479, 162);
            var n = 240 - 20 * (i - 7);
            n < 0
              ? (clearInterval(r), h.flip(), e())
              : (h.setColor(2).fillRect(240 - n, 159, 240 + n, 161),
                h
                  .setColor(3)
                  .fillRect(235 - n, 160, 245 + n, 160)
                  .flip());
          }
          i++;
        }, 30);
    });
  }));
