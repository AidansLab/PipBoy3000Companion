import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FormIdMapper, ID_ALIASES } from '../src/form-id-mapper.js';
import { SyncEngine } from '../src/sync-engine.js';

const FO3_BYTE = {
  'fallout3.esm': 0,
  'anchorage.esm': 1,
  'brokensteel.esm': 2,
  'pointlookout.esm': 3,
  'thepitt.esm': 4,
  'zeta.esm': 5,
};
const FILE_NAME = {
  'fallout3.esm': 'Fallout3.esm',
  'anchorage.esm': 'Anchorage.esm',
  'brokensteel.esm': 'BrokenSteel.esm',
  'zeta.esm': 'Zeta.esm',
};
const hex = (n) => '0x' + (n >>> 0).toString(16).padStart(8, '0');

// [label, game mode, plugin -> game load-order index, plugin -> Pip-Boy high byte]
const SCENARIOS = [
  ['F3', 'F3', { 'fallout3.esm': 0, 'anchorage.esm': 1, 'brokensteel.esm': 2, 'zeta.esm': 5 }, (p) => FO3_BYTE[p]],
  ['F3, other load order', 'F3', { 'fallout3.esm': 0, 'zeta.esm': 1, 'brokensteel.esm': 2, 'anchorage.esm': 3 }, (p) => FO3_BYTE[p]],
  ['F3, no Zeta', 'F3', { 'fallout3.esm': 0, 'anchorage.esm': 1, 'brokensteel.esm': 2 }, (p) => FO3_BYTE[p]],
  ['TTW', 'FNV', { 'falloutnv.esm': 0, 'fallout3.esm': 3, 'anchorage.esm': 7, 'brokensteel.esm': 8, 'zeta.esm': 9 }, (p) => 0x40 | FO3_BYTE[p]],
];

function mapperFor(order) {
  const m = new FormIdMapper();
  m.setLoadOrder(
    Object.entries(order).map(([name, index]) => ({ index, name: FILE_NAME[name] || 'FalloutNV.esm' }))
  );
  return m;
}

for (const [label, mode, order, pipByte] of SCENARIOS) {
  describe(`ID aliases (${label})`, () => {
    const game = (plugin, local) => hex((order[plugin] << 24) | local);
    const pip = (plugin, local) => hex((pipByte(plugin) << 24) | local);
    const loaded = (plugin) => order[plugin] !== undefined;

    it('maps every variant to the DAT item, and the DAT item to itself', () => {
      const m = mapperFor(order);
      for (const [fp, fl, tp, tl] of ID_ALIASES) {
        if (!loaded(fp)) continue;
        assert.equal(hex(m.resolve(game(fp, fl), mode)), pip(tp, tl), `${fp}:${fl.toString(16)}`);
        if (loaded(tp)) assert.equal(hex(m.resolve(game(tp, tl), mode)), pip(tp, tl));
      }
    });

    it('sends back whichever variant the player holds, preferring the DAT item', () => {
      const m = mapperFor(order);
      for (const [fp, fl, tp, tl] of ID_ALIASES) {
        if (!loaded(fp)) continue;
        const tag = `${fp}:${fl.toString(16)}`;
        const target = pip(tp, tl);

        m.setHeldItems({ inventory: [{ formId: game(fp, fl) }] });
        assert.equal(hex(m.resolveToGame(target, mode)), game(fp, fl), `${tag} held`);

        m.setHeldItems({ player: { equippedapparel: [game(fp, fl)] } });
        assert.equal(hex(m.resolveToGame(target, mode)), game(fp, fl), `${tag} worn`);

        m.setHeldItems({ equippedweap: game(fp, fl) });
        assert.equal(hex(m.resolveToGame(target, mode)), game(fp, fl), `${tag} wielded`);

        if (!loaded(tp)) continue;
        m.setHeldItems({ inventory: [{ formId: game(tp, tl) }] });
        assert.equal(hex(m.resolveToGame(target, mode)), game(tp, tl), `${tag} DAT item held`);

        m.setHeldItems({ inventory: [{ formId: game(fp, fl) }, { formId: game(tp, tl) }] });
        assert.equal(hex(m.resolveToGame(target, mode)), game(tp, tl), `${tag} both held`);

        m.setHeldItems({ inventory: [] });
        assert.equal(hex(m.resolveToGame(target, mode)), game(tp, tl), `${tag} none held`);
      }
    });

    it('leaves items without an alias alone', () => {
      const m = mapperFor(order);
      m.setHeldItems({ inventory: [] });
      for (const [plugin, local] of [
        ['anchorage.esm', 0x00c18f], // Chinese Stealth Armor - the DAT's own entry
        ['anchorage.esm', 0x00742f], // Outcast Scribe Robe - its own DAT entry
        ['fallout3.esm', 0x0854cf], // Brotherhood Scribe Robe
      ]) {
        if (!loaded(plugin)) continue;
        assert.equal(hex(m.resolve(game(plugin, local), mode)), pip(plugin, local));
        assert.equal(hex(m.resolveToGame(pip(plugin, local), mode)), game(plugin, local));
      }
    });
  });
}

describe('ID aliases do not leak between items', () => {
  it('holding the sim 10mm Pistol only redirects the 10mm Pistol', () => {
    const m = mapperFor({ 'fallout3.esm': 0, 'anchorage.esm': 1 });
    m.setHeldItems({ inventory: [{ formId: '0x01003f49' }] });
    assert.equal(hex(m.resolveToGame('0x0000434f', 'F3')), '0x01003f49');
    assert.equal(hex(m.resolveToGame('0x00004321', 'F3')), '0x00004321'); // 10mm SMG
  });
});

describe('ID aliases in inventory syncs', () => {
  const order = { 'fallout3.esm': 0, 'anchorage.esm': 1 };
  const engine = () => {
    const e = new SyncEngine(null, mapperFor(order));
    e.gameMode = 'F3';
    return e;
  };
  const wrap = (formId, count, condition = 100) => ({ formId, type: 'ARMO', count, condition });

  it('sums stacks that land on one device row in a full sync', () => {
    const cmds = engine()._buildSetItemsBulkCommands('APPAREL', [
      [0x00074296, 1, 100],
      [0x00074296, 2, 100],
      [0x00074296, 1, 80],
    ]);
    assert.deepEqual(cmds, [
      "player.setitemsbulk_begin('APPAREL')",
      `player.setitemsbulk_chunk('APPAREL',[[${0x00074296},3,100],[${0x00074296},1,80]])`,
      "player.setitemsbulk_end('APPAREL')",
    ]);
  });

  it('adds a newly picked-up variant as a count on the shared row', () => {
    // Player holds one head wrap; a differently coloured one is picked up.
    const e = engine();
    const cmds = e._diffInventory(
      [wrap('0x00074296', 1), wrap('0x00074336', 1)],
      [wrap('0x00074296', 1)]
    );
    assert.ok(
      cmds.some((c) => c === `player.additemsbulk('APPAREL',[[${0x00074296},1,100]])`),
      cmds.join('\n')
    );
  });

  it('rebuilds all variants of a device row together when a condition changes', () => {
    // Merc Charmer Outfit (regular + unique variant); the regular one degrades.
    const e = engine();
    const cmds = e._diffInventory(
      [wrap('0x00034122', 1, 90), wrap('0x000cb606', 1, 100)],
      [wrap('0x00034122', 1, 100), wrap('0x000cb606', 1, 100)]
    );
    const rebuilds = cmds.filter((c) => c.startsWith('player.setformstacks('));
    assert.equal(rebuilds.length, 1, cmds.join('\n'));
    assert.equal(
      rebuilds[0],
      `player.setformstacks(${0x00034122},[{cnt:1,cnd:90},{cnt:1,cnd:100}])`
    );
  });
});
