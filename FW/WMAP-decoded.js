(function () {
  let e,
    t = !0,
    o = player.getav('locz') || 0,
    n = player.getav('map') || 'WMAP';
  const l = JSON.parse(fs.readFile(`MAP/${NV ? 'NV' : 'F3'}/MAPS.JSON`)),
    i = Object.keys(l),
    a = { x: 16, y: BR.y, w: 450, h: BR.h };
  let c,
    r,
    s = i.indexOf(n),
    p = player.getav('locx') || 1024,
    d = player.getav('locy') || 1024;
  function v() {
    (Pip.blitFile(h, e, {
      width: a.w,
      height: a.h,
      dstx: a.x,
      dsty: a.y,
      x: 0 | p,
      y: 0 | d,
      srcWidth: 2048 >> o,
      srcHeight: 2048 >> o
    }),
      r && r.draw(),
      h.flip(),
      (Pip.lastFlip = getTime()));
  }
  function u() {
    c ||
      (c = setTimeout(function () {
        ((c = void 0), v());
      }, 50));
  }
  function f(e) {
    const t = (p + a.w / 2) * (1 << o),
      n = (d + a.h / 2) * (1 << o);
    ((o = e),
      (p = Math.max(0, Math.min(t / (1 << e) - a.w / 2, (2048 >> e) - a.w))),
      (d = Math.max(0, Math.min(n / (1 << e) - a.h / 2, (2048 >> e) - a.h))),
      player.setav('locx', p),
      player.setav('locy', d),
      player.setav('locz', e));
  }
  function m(t, l) {
    const i = 1 << o;
    let a = `MAP/${NV ? 'NV' : 'F3'}/${t}${i > 1 ? '_' + i : ''}${l ? '_ICON' : ''}.MAP`;
    (fs.statSync(a) ||
      (a = `MAP/${NV ? 'NV' : 'F3'}/WMAP${l ? '_ICON' : ''}.MAP`),
      e && e.close(),
      (e = E.openFile(a, 'r')),
      v(),
      (n = t),
      player.setav('map', t),
      Pip.renderHeader());
  }
  function g(e, l) {
    0 == e &&
      (l
        ? (Pip.playSound('SELECT'),
          (r = (function (e) {
            let t = e[''],
              o = Object.keys(e);
            (t && o.splice(o.indexOf(''), 1),
              t instanceof Object || (t = {}),
              void 0 === t.selected && (t.selected = 0),
              (t.rowHeight = 24));
            const n = {
              draw: function () {
                t.predraw && t.predraw(h);
                let l = 22,
                  i = 60;
                (h.clearRect(l, i, 142, i + 24 * o.length + 31),
                  h
                    .setFontAlign(-1, -1)
                    .setFont('Monofonto16')
                    .drawString(t.title, 31, i + 4)
                    .setColor(2)
                    .fillRect(l, i + 23, 142, i + 23)
                    .drawRect(l, i, 142, i + 24 * o.length + 31),
                  (i += 30));
                let a = 0 | Math.min((280 - i) / t.rowHeight, o.length),
                  c = E.clip(t.selected - (a >> 1), 0, o.length - a),
                  r = i;
                for (; a--;) {
                  const l = o[c],
                    i = e[l];
                  if (
                    (c == t.selected &&
                      !n.selectEdit &&
                      Pip.shadeBox(26, r - 2, 138, r + t.rowHeight - 3),
                    h
                      .setFont('Monofonto14')
                      .setColor(3)
                      .drawString(l, 31, r + 3),
                    'object' == typeof i)
                  ) {
                    let e = 134,
                      o = i.value;
                    (i.format && (o = i.format(o)),
                      'boolean' == typeof o && null == i.format
                        ? (h.drawRect(e - 12, r + 3, e, r + 15),
                          o && h.fillRect(e - 10, r + 5, e - 2, r + 13))
                        : (n.selectEdit &&
                            c == t.selected &&
                            ((e -= 9),
                            h
                              .setBgColor(3)
                              .clearRect(
                                e - (h.stringWidth(o) + 2),
                                r,
                                139,
                                r + t.rowHeight - 5
                              ),
                            h
                              .setColor(0)
                              .drawImage(
                                {
                                  width: 5,
                                  height: 8,
                                  buffer: '#\xBE\0}\xC4',
                                  transparent: 0
                                },
                                e + 2,
                                r + 2,
                                { scale: 2 }
                              )),
                          h
                            .setFontAlign(1, -1)
                            .drawString(o.toString(), e, r + 4)
                            .setBgColor(0)
                            .setFontAlign(-1, -1)));
                  }
                  ((r += t.rowHeight), c++);
                }
              },
              select: function () {
                const l = e[o[t.selected]];
                (Pip.playSound('SELECT'),
                  'function' == typeof l
                    ? l(n)
                    : 'object' == typeof l &&
                      ('number' == typeof l.value
                        ? (n.selectEdit = n.selectEdit ? void 0 : l)
                        : ('boolean' == typeof l.value && (l.value = !l.value),
                          l.onchange && l.onchange(l.value)),
                      n.draw()));
              },
              move: function (e) {
                if (n.selectEdit) {
                  const t = n.selectEdit,
                    o = t.value;
                  ((t.value -= (e || 1) * (t.step || 1)),
                    void 0 !== t.min &&
                      t.value < t.min &&
                      (t.value = t.wrap ? t.max : t.min),
                    void 0 !== t.max &&
                      t.value > t.max &&
                      (t.value = t.wrap ? t.min : t.max),
                    t.onchange &&
                      t.value != o &&
                      (t.onchange(t.value, -e), Pip.playSound('HIGHLIGHT')));
                } else {
                  const n = t.selected;
                  (t.wrapSelection
                    ? (t.selected = (e + n + o.length) % o.length)
                    : (t.selected = E.clip(n + e, 0, o.length - 1)),
                    n !== t.selected && Pip.playSound('SCROLL'));
                }
                n.draw();
              },
              remove: function () {
                (Pip.removeListener('knob1', l),
                  Pip.onExclusive('knob1', g),
                  (r = void 0),
                  v());
              }
            };
            function l(e, t) {
              e ? n.move(e) : t ? n.remove() : n.select();
            }
            return (
              n.draw(),
              Pip.removeListener('knob1', g),
              Pip.onExclusive('knob1', l),
              n
            );
          })({
            '': { title: 'Map Options', wrapSelection: !0 },
            'Show Icons': {
              value: t,
              onchange: (e) => {
                ((t = e), m(n, t));
              }
            },
            'Zoom Level': {
              value: o,
              min: 0,
              max: 2,
              step: 1,
              format: (e) => e + 1,
              onchange: (e) => {
                (f(e), m(n, t));
              }
            },
            'Map #': {
              value: s + 1,
              min: 1,
              max: i.length,
              step: 1,
              wrap: !0,
              onchange: (e) => {
                ((s = e - 1), m(i[s], t));
              }
            },
            Done: function (e) {
              e.remove();
            }
          })))
        : (Pip.playSound('HIGHLIGHT'), f((o + 1) % 3), void m(i[s], t)));
    const c = d;
    ((d += 16 * e),
      d < 0 && (d = 0),
      d > (2048 >> o) - a.h && (d = (2048 >> o) - a.h),
      c != d && u(),
      player.setav('locy', d));
  }
  function y(e) {
    const t = p;
    ((p += 16 * e),
      p < 0 && (p = 0),
      p > (2048 >> o) - a.w && (p = (2048 >> o) - a.w),
      t != p && u(),
      player.setav('locx', p));
  }
  return (
    m(n, t),
    v(),
    Pip.onExclusive('knob1', g),
    Pip.onExclusive('knob2', y),
    {
      id: 'WMAP',
      remove: () => {
        (player.sync(),
          c && clearTimeout(c),
          r && r.remove(),
          Pip.removeListener('knob1', g),
          Pip.removeListener('knob2', y),
          e && e.close());
      }
    }
  );
});
