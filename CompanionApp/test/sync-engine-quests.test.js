import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine } from '../src/sync-engine.js';
import { FormIdMapper } from '../src/form-id-mapper.js';

/** Minimal bridge stub: connected, and records nothing (we call diffs directly). */
function makeEngine({ questSupport = true } = {}) {
  const bridge = { connected: true, sendCommand: async () => {} };
  const engine = new SyncEngine(bridge, new FormIdMapper());
  engine.setGameMode('FNV');
  // Real runs set this from the firmware capability probe; default it on so
  // the diff tests below exercise the command paths.
  engine.setQuestSyncSupported(questSupport);
  return engine;
}

const quest = (over = {}) => ({
  formId: '0x00104c1c',
  stage: 30,
  flags: 1,
  objCount: 4,
  disp: 'f',
  done: '3',
  ...over,
});

describe('SyncEngine quest normalization', () => {
  let engine;
  beforeEach(() => {
    engine = makeEngine();
  });

  it('parses a snapshot quest into the device entry shape', () => {
    const e = engine._toQuestEntry(quest());
    assert.deepEqual(e, {
      formId: 0x00104c1c,
      stage: 30,
      flags: 1,
      objCount: 4,
      disp: 'f',
      done: '3',
    });
  });

  it('keeps masks as strings so >32-bit values survive intact', () => {
    // 36 objectives all displayed - beyond what a JS bitwise op could hold.
    const wide = 'fffffffff';
    const e = engine._toQuestEntry(quest({ disp: wide, objCount: 36 }));
    assert.equal(e.disp, wide);
    assert.equal(typeof e.disp, 'string');
  });

  it('normalizes mask casing, 0x prefix and leading zeros', () => {
    const e = engine._toQuestEntry(quest({ disp: '0x00FF', done: '000' }));
    assert.equal(e.disp, 'ff');
    assert.equal(e.done, '0');
  });

  it('rejects a malformed mask rather than passing it to the device', () => {
    const e = engine._toQuestEntry(quest({ disp: 'nonsense' }));
    assert.equal(e.disp, '0');
  });
});

describe('SyncEngine._diffQuests', () => {
  let engine;
  beforeEach(() => {
    engine = makeEngine();
  });

  it('emits nothing when the quest list is unchanged', () => {
    const list = [quest()];
    assert.deepEqual(engine._diffQuests(list, [quest()]), []);
  });

  it('emits one setquest for a newly started quest', () => {
    const cmds = engine._diffQuests([quest()], []);
    assert.equal(cmds.length, 1);
    assert.match(cmds[0], /^player\.setquest\(1068060,30,1,"f","3"\)$/);
  });

  it('emits one setquest when an objective completes', () => {
    const cmds = engine._diffQuests([quest({ done: '7' })], [quest()]);
    assert.equal(cmds.length, 1);
    assert.match(cmds[0], /player\.setquest\(.*"7"\)/);
  });

  it('emits removequest for a quest that vanished', () => {
    const cmds = engine._diffQuests([], [quest()]);
    assert.deepEqual(cmds, ['player.removequest(1068060)']);
  });

  it('uses setactivequest when only the active bit changed', () => {
    const before = quest({ flags: 1 });
    const after = quest({ flags: 1 | 4 });
    assert.deepEqual(engine._diffQuests([after], [before]), [
      'player.setactivequest(1068060)',
    ]);
  });

  it('emits no command for the quest that merely lost the active bit', () => {
    const a = quest({ formId: '0x00104c1c', flags: 1 | 4 });
    const b = quest({ formId: '0x0010a214', flags: 1 });
    const aAfter = quest({ formId: '0x00104c1c', flags: 1 });
    const bAfter = quest({ formId: '0x0010a214', flags: 1 | 4 });

    const cmds = engine._diffQuests([aAfter, bAfter], [a, b]);
    assert.deepEqual(cmds, ['player.setactivequest(1090068)']);
  });

  it('falls back to a full setquest when active changes alongside progress', () => {
    const before = quest({ flags: 1, done: '3' });
    const after = quest({ flags: 1 | 4, done: '7' });
    const cmds = engine._diffQuests([after], [before]);
    assert.equal(cmds.length, 1);
    assert.match(cmds[0], /^player\.setquest\(/);
  });

  it('suppresses the echo of an active quest the device itself picked', () => {
    const before = quest({ flags: 1 });
    const after = quest({ flags: 1 | 4 });
    engine.notifyDeviceActiveQuest('0x00104c1c');
    assert.deepEqual(engine._diffQuests([after], [before]), []);
    // The suppression is one-shot: a later genuine change still emits.
    assert.deepEqual(engine._diffQuests([after], [before]), [
      'player.setactivequest(1068060)',
    ]);
  });
});

describe('SyncEngine._buildSetQuestsBulkCommands', () => {
  let engine;
  beforeEach(() => {
    engine = makeEngine();
  });

  it('brackets chunks with begin and end even when empty', () => {
    const cmds = engine._buildSetQuestsBulkCommands([]);
    assert.deepEqual(cmds, [
      'player.setquestsbulk_begin()',
      'player.setquestsbulk_end()',
    ]);
  });

  it('splits into chunks and keeps every line inside the serial limit', () => {
    const many = [];
    for (let i = 0; i < 40; i++) {
      many.push(quest({ formId: '0x0010' + i.toString(16).padStart(4, '0') }));
    }
    const cmds = engine._buildSetQuestsBulkCommands(many);

    assert.equal(cmds[0], 'player.setquestsbulk_begin()');
    assert.equal(cmds[cmds.length - 1], 'player.setquestsbulk_end()');

    const chunks = cmds.slice(1, -1);
    assert.equal(chunks.length, Math.ceil(40 / 12));
    for (const c of chunks) {
      assert.ok(c.length < 512, `chunk too long for the serial bridge: ${c.length}`);
    }

    // Every quest must appear exactly once across the chunks.
    const ids = chunks.join('').match(/\[\d+,/g) || [];
    assert.equal(ids.length, 40);
  });

  it('drops entries whose form ID cannot be resolved', () => {
    const cmds = engine._buildSetQuestsBulkCommands([
      quest(),
      { formId: 'not-a-form-id' },
    ]);
    const chunks = cmds.slice(1, -1).join('');
    assert.match(chunks, /1068060/);
    assert.equal((chunks.match(/\[\d+,/g) || []).length, 1);
  });
});

describe('SyncEngine quest sync capability gate', () => {
  it('emits no quest commands when the firmware lacks the methods', () => {
    const engine = makeEngine({ questSupport: false });
    assert.deepEqual(engine._diffQuests([quest()], []), []);
    assert.deepEqual(engine._buildSetQuestsBulkCommands([quest()]), []);
  });

  it('leaves quests out of a full sync on unsupported firmware', () => {
    const engine = makeEngine({ questSupport: false });
    const cmds = engine._generateFullSync({
      game: 'FNV',
      player: {},
      inventory: [],
      perks: [],
      quests: [quest()],
    });
    assert.ok(!cmds.some((c) => c.includes('quest')), 'no quest command should be sent');
    // The rest of the full sync must still happen.
    assert.ok(cmds.some((c) => c.startsWith('player.setperksbulk(')));
  });

  it('defaults to unsupported until the probe says otherwise', () => {
    const bridge = { connected: true, sendCommand: async () => {} };
    const engine = new SyncEngine(bridge, new FormIdMapper());
    assert.equal(engine.isQuestSyncSupported(), false);
  });
});

describe('SyncEngine full sync includes quests', () => {
  it('reconciles quests as part of _generateFullSync', () => {
    const engine = makeEngine();
    const cmds = engine._generateFullSync({
      game: 'FNV',
      player: { name: 'Courier', level: 5 },
      inventory: [],
      perks: [],
      quests: [quest()],
    });
    assert.ok(cmds.includes('player.setquestsbulk_begin()'));
    assert.ok(cmds.includes('player.setquestsbulk_end()'));
    assert.ok(cmds.some((c) => c.startsWith('player.setquestsbulk_chunk(')));
  });

  it('still emits the bulk bracket when the snapshot has no quests field', () => {
    const engine = makeEngine();
    const cmds = engine._generateFullSync({
      game: 'FNV',
      player: {},
      inventory: [],
      perks: [],
    });
    // Brackets with no chunks is what clears stale device rows.
    assert.ok(cmds.includes('player.setquestsbulk_begin()'));
    assert.ok(!cmds.some((c) => c.startsWith('player.setquestsbulk_chunk(')));
  });
});
