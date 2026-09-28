import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine } from '../src/sync-engine.js';
import { FormIdMapper } from '../src/form-id-mapper.js';

function makeEngine() {
  const bridge = { connected: true, sendCommand: async () => {} };
  const engine = new SyncEngine(bridge, new FormIdMapper());
  engine.setGameMode('FNV');
  return engine;
}

const pushesCurrentAp = (cmds) => cmds.some((c) => c.includes("setav('ap'"));

describe('SyncEngine AP sync', () => {
  let engine;
  beforeEach(() => {
    engine = makeEngine();
  });

  it('never pushes current AP, however much it moves', () => {
    // A sprint mod spends AP as stamina: drain to empty, recharge to full.
    for (let ap = 95; ap >= 0; ap -= 5) {
      assert.deepEqual(engine._diffAP({ ap, maxAP: 95 }, { ap: ap + 5, maxAP: 95 }), []);
    }
    for (let ap = 0; ap <= 95; ap += 5) {
      assert.deepEqual(engine._diffAP({ ap, maxAP: 95 }, { ap: ap - 5, maxAP: 95 }), []);
    }
  });

  it('ignores ap from older plugin builds that still send it', () => {
    assert.deepEqual(engine._diffAP({ ap: 10 }, { ap: 90 }), []);
  });

  it('pushes maxAP when it changes, with a header refresh', () => {
    const cmds = engine._diffAP({ ap: 50, maxAP: 98 }, { ap: 50, maxAP: 95 });
    assert.deepEqual(cmds, ["player.setav('maxap', 98, !1)", 'player.renderheader();']);
  });

  it('pushes maxAP on a full sync but not current AP', () => {
    const cmds = engine._diffAP({ ap: 50, maxAP: 95 }, {});
    assert.ok(cmds.includes("player.setav('maxap', 95, !1)"));
    assert.equal(pushesCurrentAp(cmds), false);
  });

  it('sends nothing when only AP changed in a full snapshot diff', () => {
    const base = { player: { level: 10, hp: 100, maxHP: 100, ap: 95, maxAP: 95 } };
    engine.previousState = structuredClone(base);
    const next = structuredClone(base);
    next.player.ap = 12;
    // Empty, not merely AP-free: an empty diff is what skips the serial write
    // and the "Sending N update(s)" / "N command(s) sent" log pair entirely.
    assert.deepEqual(engine._generateCommands(next), []);
  });
});
