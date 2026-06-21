/**
 * sync-engine.test.js
 * 
 * Unit tests for the sync engine's diffing logic.
 * Uses Node.js built-in test runner (node --test).
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SyncEngine } from '../src/sync-engine.js';

// ─── Mock Serial Bridge ────────────────────────────────────────────────────────
function createMockBridge() {
  const commands = [];
  return {
    connected: true,
    sentCommands: commands,
    sendCommand: async (cmd) => {
      commands.push(cmd);
    },
    sendBatch: async (cmds) => {
      commands.push(...cmds);
    },
    on: () => {},
    emit: () => {},
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('SyncEngine', () => {
  let bridge;
  let engine;

  beforeEach(() => {
    bridge = createMockBridge();
    engine = new SyncEngine(bridge, null); // No mapper — pass-through
    engine.setGameMode('F3');
    engine.setEnabled(true);
  });

  describe('First snapshot (full sync)', () => {
    it('should send resetinventory and all player attributes', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: {
          name: 'TestPlayer',
          level: 10,
          hp: 200,
          maxHP: 250,
        },
        inventory: [],
        perks: [],
      });

      assert.ok(bridge.sentCommands.includes('player.resetinventory()'));
      assert.ok(bridge.sentCommands.some(c => c.includes("'name'")));
      assert.ok(bridge.sentCommands.some(c => c.includes('setlevel(10)')));
      assert.ok(bridge.sentCommands.some(c => c.includes("'hp'")));
      assert.ok(bridge.sentCommands.some(c => c.includes("'maxHP'")));
    });

    it('should add inventory items on first sync', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [
          { formId: '0x0001519E', type: 'AID', count: 5, condition: 100 },
        ],
        perks: [],
      });

      const addCmd = bridge.sentCommands.find(c => c.includes('additem'));
      assert.ok(addCmd, 'Should have an additem command');
      assert.ok(addCmd.includes('0x0001519E'));
      assert.ok(addCmd.includes('5'));
    });

    it('should set cnd for items with degraded condition', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [
          { formId: '0x00004322', type: 'WEAP', count: 1, condition: 75 },
        ],
        perks: [],
      });

      const cmd = bridge.sentCommands.find(c => c.includes('cnd=75'));
      assert.ok(cmd, 'Should set cnd=75 for degraded items');
      assert.ok(cmd.includes('id=17186'));
    });

    it('should normalize 0–1 game condition to 0–100 percent', async () => {
      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test' },
        inventory: [
          { formId: '0x00004322', type: 'WEAP', count: 1, condition: 0.75 },
        ],
        perks: [],
      });

      const cmd = bridge.sentCommands.find(c => c.includes('cnd=75'));
      assert.ok(cmd, 'Should convert 0.75 to cnd=75');
    });

    it('should add perks on first sync', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [],
        perks: ['0x00031DC4'],
      });

      const cmd = bridge.sentCommands.find(c => c.includes('addperk'));
      assert.ok(cmd);
      assert.ok(cmd.includes('0x00031DC4'));
    });
  });

  describe('Incremental diffs', () => {
    it('should only send changed attributes on second snapshot', async () => {
      // First snapshot
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', level: 5, hp: 100, maxHP: 100 },
        inventory: [],
        perks: [],
      });

      bridge.sentCommands.length = 0; // Clear

      // Second snapshot — only hp changed
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', level: 5, hp: 80, maxHP: 100 },
        inventory: [],
        perks: [],
      });

      // Should only have the hp change, not name or level
      assert.ok(bridge.sentCommands.some(c => c.includes("'hp', 80")));
      assert.ok(!bridge.sentCommands.some(c => c.includes('setlevel')));
      assert.ok(!bridge.sentCommands.some(c => c.includes("'name'")));
    });

    it('should sync flashlight LED when torch state changes', async () => {
      // Snapshots are debounced (500ms); wait out the window between sends.
      const settle = () => new Promise((r) => setTimeout(r, 550));

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', torch: false },
        inventory: [],
        perks: [],
      });
      await settle();

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', torch: true },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(bridge.sentCommands.some(c => c.includes('Pip.setTorch(!0)')));

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', torch: true },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(!bridge.sentCommands.some(c => c.includes('Pip.setTorch')));
    });

    it('should sync flashlight on the first (full) sync when enabled by default', async () => {
      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', torch: true },
        inventory: [],
        perks: [],
      });

      assert.ok(bridge.sentCommands.some(c => c.includes('Pip.setTorch(!0)')));
    });

    it('should not sync flashlight when torch sync is disabled', async () => {
      engine.setTorchSyncEnabled(false);

      // Full sync with the flashlight on — must not touch the torch LED.
      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', torch: true },
        inventory: [],
        perks: [],
      });

      assert.ok(!bridge.sentCommands.some(c => c.includes('Pip.setTorch')));
    });

    it('should copy carry weight from the game when it changes', async () => {
      // Snapshots are debounced (500ms); wait out the window between sends so
      // each one is processed on the leading edge.
      const settle = () => new Promise((r) => setTimeout(r, 550));

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', wg: 100, maxWg: 200 },
        inventory: [],
        perks: [],
      });
      await settle();

      bridge.sentCommands.length = 0;

      // Only current weight changes
      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', wg: 125, maxWg: 200 },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(bridge.sentCommands.some(c => c.includes("setav('wg', 125, !1)")));
      assert.ok(!bridge.sentCommands.some(c => c.includes("setav('maxwg'")));

      bridge.sentCommands.length = 0;

      // Unchanged weight — nothing sent
      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', wg: 125, maxWg: 200 },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(!bridge.sentCommands.some(c => c.includes("setav('wg'")));
    });

    it('should copy action points from the game when they change', async () => {
      const settle = () => new Promise((r) => setTimeout(r, 550));

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', ap: 80, maxAP: 95 },
        inventory: [],
        perks: [],
      });
      await settle();

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', ap: 65, maxAP: 95 },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(bridge.sentCommands.some(c => c.includes("setav('ap', 65, !1)")));
      assert.ok(bridge.sentCommands.some(c => c.includes('renderHeader')));
    });

    it('should push usable ammo and the loaded ammo type to the device', async () => {
      const settle = () => new Promise((r) => setTimeout(r, 550));

      await engine.processSnapshot({
        game: 'FNV',
        player: {
          name: 'Test',
          weaponammo: { current: 5, usable: [5, 6, 7] },
        },
        inventory: [],
        perks: [],
      });
      await settle();

      // Full sync sends both the active ammo and the usable set.
      assert.ok(bridge.sentCommands.some(c => c.includes("setav('ammoActive', 5, !1)")));
      assert.ok(bridge.sentCommands.some(c => c.includes("setav('ammoUsable', [5,6,7], !1)")));

      bridge.sentCommands.length = 0;

      // Only the loaded ammo changes (player switched type); usable set is the same.
      await engine.processSnapshot({
        game: 'FNV',
        player: {
          name: 'Test',
          weaponammo: { current: 6, usable: [5, 6, 7] },
        },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(bridge.sentCommands.some(c => c.includes("setav('ammoActive', 6, !1)")));
      assert.ok(!bridge.sentCommands.some(c => c.includes("setav('ammoUsable'")));

      bridge.sentCommands.length = 0;

      // Nothing changed — no ammo commands.
      await engine.processSnapshot({
        game: 'FNV',
        player: {
          name: 'Test',
          weaponammo: { current: 6, usable: [5, 6, 7] },
        },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(!bridge.sentCommands.some(c => c.includes("setav('ammoActive'")));
      assert.ok(!bridge.sentCommands.some(c => c.includes("setav('ammoUsable'")));
    });

    it('should re-push weapon ammo when equipped weapon changes to ammoless', async () => {
      const settle = () => new Promise((r) => setTimeout(r, 550));

      await engine.processSnapshot({
        game: 'FNV',
        player: {
          name: 'Test',
          equippedweap: 0,
          weaponammo: { current: 0, usable: [] },
        },
        inventory: [],
        perks: [],
      });
      await settle();

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'FNV',
        player: {
          name: 'Test',
          equippedweap: '0x00004330',
          weaponammo: { current: 0, usable: [] },
        },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(bridge.sentCommands.some((c) => c.includes("setav('ammoUsable', [], !1)")));
      assert.ok(bridge.sentCommands.some((c) => c.includes("setav('ammoActive', 0, !1)")));
    });

    it('should re-push weapon ammo when refresh is requested after reconnect', async () => {
      const settle = () => new Promise((r) => setTimeout(r, 550));
      const weaponammo = { current: 5, usable: [5, 6, 7] };

      await engine.processSnapshot({
        player: { weaponammo },
        inventory: [],
        perks: [],
      });
      await settle();
      bridge.sentCommands.length = 0;

      engine.requestWeaponAmmoRefresh();
      await engine.processSnapshot({
        player: { weaponammo },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(bridge.sentCommands.some((c) => c.includes("setav('ammoActive', 5, !1)")));
      assert.ok(bridge.sentCommands.some((c) => c.includes("setav('ammoUsable', [5,6,7], !1)")));
      assert.ok(
        bridge.sentCommands.some((c) => c.includes("Pip.CURRENT.id==='AMMO'"))
      );
    });

    it('should sync skill levels to SKILLS.JSON on full and incremental sync', async () => {
      const settle = () => new Promise((r) => setTimeout(r, 550));
      const baseSkills = {
        barter: 45,
        energyweapons: 20,
        explosives: 30,
        lockpick: 55,
        medicine: 60,
        meleeweapons: 40,
        repair: 25,
        science: 70,
        guns: 80,
        sneak: 35,
        speech: 50,
        survival: 15,
        unarmed: 65,
      };

      engine.setGameMode('FNV');
      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', skills: { ...baseSkills } },
        inventory: [],
        perks: [],
      });
      await settle();

      const fullSkillCmd = bridge.sentCommands.find((c) => c.includes('SKILLS.DAT'));
      assert.ok(fullSkillCmd, 'Full sync should write skills via SKILLS.DAT lookup');
      assert.ok(fullSkillCmd.includes('"guns":80'));
      assert.ok(fullSkillCmd.includes('SKILLS.JSON'));

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', skills: { ...baseSkills, guns: 90 } },
        inventory: [],
        perks: [],
      });
      await settle();

      const incSkillCmd = bridge.sentCommands.find((c) => c.includes('SKILLS.DAT'));
      assert.ok(incSkillCmd, 'Incremental sync should update changed skills');
      assert.ok(incSkillCmd.includes('"guns":90'));

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', skills: { ...baseSkills, guns: 90 } },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(
        !bridge.sentCommands.some((c) => c.includes('SKILLS.DAT')),
        'Unchanged skills should not re-sync'
      );
    });

    it('should omit survival skill when syncing Fallout 3', async () => {
      const settle = () => new Promise((r) => setTimeout(r, 550));

      engine.setGameMode('F3');
      await engine.processSnapshot({
        game: 'F3',
        player: {
          name: 'Test',
          skills: { guns: 50, survival: 99, barter: 10 },
        },
        inventory: [],
        perks: [],
      });
      await settle();

      const skillCmd = bridge.sentCommands.find((c) => c.includes('SKILLS.DAT'));
      assert.ok(skillCmd);
      assert.ok(skillCmd.includes('"guns":50'));
      assert.ok(!skillCmd.includes('survival'));
    });

    it('should sync discovered faction reputation to REP.JSON', async () => {
      const settle = () => new Promise((r) => setTimeout(r, 550));
      const baseFactions = [
        { name: 'Goodsprings', tier: 5, discovered: false },
        { name: 'NCR', tier: 1, discovered: true },
      ];

      engine.setGameMode('FNV');
      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test' },
        factions: baseFactions,
        inventory: [],
        perks: [],
      });
      await settle();

      const fullCmd = bridge.sentCommands.find((c) => c.includes('REP.JSON'));
      assert.ok(fullCmd, 'Full sync should write faction reputation');
      assert.ok(fullCmd.includes('"name":"NCR"'));
      assert.ok(fullCmd.includes('"tier":1'));
      assert.ok(fullCmd.includes('REP_VISIBLE.JSON'));
      assert.ok(fullCmd.includes('"discovered":false'));

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test' },
        factions: [
          { name: 'Goodsprings', tier: 2, discovered: true },
          { name: 'NCR', tier: 1, discovered: true },
        ],
        inventory: [],
        perks: [],
      });
      await settle();

      const incCmd = bridge.sentCommands.find((c) => c.includes('REP.JSON'));
      assert.ok(incCmd, 'Incremental sync should update factions');
      assert.ok(incCmd.includes('"name":"Goodsprings"'));
      assert.ok(incCmd.includes('"tier":2'));

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test' },
        factions: [
          { name: 'Goodsprings', tier: 2, discovered: true },
          { name: 'NCR', tier: 1, discovered: true },
        ],
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(
        !bridge.sentCommands.some((c) => c.includes('REP.JSON')),
        'Unchanged factions should not re-sync'
      );
    });

    it('should read factions nested under player (plugin snapshot shape)', async () => {
      const settle = () => new Promise((r) => setTimeout(r, 550));
      engine.setGameMode('FNV');
      await engine.processSnapshot({
        game: 'FNV',
        player: {
          name: 'Test',
          factions: [
            { name: 'Powder Gangers', tier: 12, discovered: false, fame: 0, infamy: 15 },
            { name: 'NCR', tier: 5, discovered: false, fame: 0, infamy: 0 },
          ],
        },
        inventory: [],
        perks: [],
      });
      await settle();

      const cmd = bridge.sentCommands.find((c) => c.includes('REP_VISIBLE.JSON'));
      assert.ok(cmd, 'Should sync factions from player.factions');
      assert.ok(cmd.includes('"name":"Powder Gangers","tier":12,"discovered":true'));
    });

    it('should soft-refresh GENERAL on tier-only faction changes', async () => {
      const settle = () => new Promise((r) => setTimeout(r, 550));
      engine.setGameMode('FNV');
      await engine.processSnapshot({
        game: 'FNV',
        player: {
          name: 'Test',
          factions: [
            { name: 'Powder Gangers', tier: 5, discovered: true },
            { name: 'NCR', tier: 5, discovered: false },
          ],
        },
        inventory: [],
        perks: [],
      });
      await settle();
      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'FNV',
        player: {
          name: 'Test',
          factions: [
            { name: 'Powder Gangers', tier: 15, discovered: true },
            { name: 'NCR', tier: 5, discovered: false },
          ],
        },
        inventory: [],
        perks: [],
      });
      await settle();

      const cmd = bridge.sentCommands.find((c) => c.includes('REP_VISIBLE.JSON'));
      assert.ok(cmd, 'Tier change should sync factions');
      assert.ok(cmd.includes("Pip.emit('factions')"));
      assert.ok(!cmd.includes('Pip.changeMenu'));
    });

    it('should soft-refresh SPECIAL on agility change without changeMenu', async () => {
      const settle = () => new Promise((r) => setTimeout(r, 550));

      await engine.processSnapshot({
        game: 'FNV',
        player: {
          name: 'Test',
          special: { ST: 5, PE: 5, EN: 5, CH: 5, IN: 5, AG: 5, LK: 5 },
        },
        inventory: [],
        perks: [],
      });
      await settle();
      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'FNV',
        player: {
          name: 'Test',
          special: { ST: 5, PE: 5, EN: 5, CH: 5, IN: 5, AG: 4, LK: 5 },
        },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(
        bridge.sentCommands.some((c) => c.includes("player.setav('agility', 4"))
      );
      assert.ok(bridge.sentCommands.some((c) => c.includes("Pip.emit('special')")));
      assert.ok(
        !bridge.sentCommands.some(
          (c) => c.includes('Pip.changeMenu') && c.includes("id==='SPECIAL'")
        )
      );
    });

    it('should soft-refresh SKILLS on skill change without changeMenu', async () => {
      const settle = () => new Promise((r) => setTimeout(r, 550));
      const baseSkills = {
        barter: 45,
        guns: 80,
        sneak: 35,
      };

      engine.setGameMode('FNV');
      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', skills: { ...baseSkills } },
        inventory: [],
        perks: [],
      });
      await settle();
      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', skills: { ...baseSkills, guns: 90 } },
        inventory: [],
        perks: [],
      });
      await settle();

      const skillCmd = bridge.sentCommands.find((c) => c.includes('SKILLS.DAT'));
      assert.ok(skillCmd);
      assert.ok(skillCmd.includes("Pip.emit('skills')"));
      assert.ok(!skillCmd.includes('Pip.changeMenu'));
    });

    it('should ignore sub-whole-number hp changes (regen ticks)', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', hp: 80.2 },
        inventory: [],
        perks: [],
      });

      bridge.sentCommands.length = 0;

      // Regen tick — hp moved by a decimal but ceil(hp) is unchanged (81)
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', hp: 80.9 },
        inventory: [],
        perks: [],
      });

      assert.ok(!bridge.sentCommands.some(c => c.includes("'hp'")));

      // Crossed a whole number — should sync as ceil(81.1) = 82,
      // matching the game HUD's round-up display
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', hp: 81.1 },
        inventory: [],
        perks: [],
      });

      assert.ok(bridge.sentCommands.some(c => c.includes("'hp', 82")));
    });

    it('should detect new inventory items', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [
          { formId: '0x0001519E', count: 3 },
        ],
        perks: [],
      });

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [
          { formId: '0x0001519E', count: 3 },
          { formId: '0x00015038', count: 2 },
        ],
        perks: [],
      });

      // Should only add the new Stimpak, not re-add Nuka-Cola
      const addCmds = bridge.sentCommands.filter(c => c.includes('additem'));
      assert.equal(addCmds.length, 1);
      assert.ok(addCmds[0].includes('0x00015038'));
    });

    it('should detect count increases', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [
          { formId: '0x0001519E', count: 3 },
        ],
        perks: [],
      });

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [
          { formId: '0x0001519E', count: 5 },
        ],
        perks: [],
      });

      const addCmd = bridge.sentCommands.find(c => c.includes('additem'));
      assert.ok(addCmd);
      // Should add the delta (2), not the total
      assert.ok(addCmd.includes(', 2)'));
    });

    it('should detect new perks', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [],
        perks: ['0x00031DC4'],
      });

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [],
        perks: ['0x00031DC4', '0x00031DB7'],
      });

      const addPerk = bridge.sentCommands.find(c => c.includes('addperk'));
      assert.ok(addPerk);
      assert.ok(addPerk.includes('0x00031DB7'));
      // Should NOT re-add the existing perk
      assert.ok(!bridge.sentCommands.some(c => c.includes('0x00031DC4')));
    });

    it('should detect removed perks', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [],
        perks: ['0x00031DC4', '0x00031DB7'],
      });

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [],
        perks: ['0x00031DC4'],
      });

      const removePerk = bridge.sentCommands.find(c => c.includes('removeperk'));
      assert.ok(removePerk);
      assert.ok(removePerk.includes('0x00031DB7'));
    });

    it('should detect S.P.E.C.I.A.L. changes', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', special: { ST: 5, PE: 5, EN: 5, CH: 5, IN: 5, AG: 5, LK: 5 } },
        inventory: [],
        perks: [],
      });

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', special: { ST: 6, PE: 5, EN: 5, CH: 5, IN: 5, AG: 5, LK: 5 } },
        inventory: [],
        perks: [],
      });

      // Only ST changed
      const stCmd = bridge.sentCommands.find(c => c.includes("'ST'"));
      assert.ok(stCmd);
      assert.ok(stCmd.includes('6'));
      // Other SPECIAL stats should not be sent
      assert.ok(!bridge.sentCommands.some(c => c.includes("'PE'")));
    });
  });

  describe('Device-initiated consumption (bidirectional sync)', () => {
    it('should not echo a decrement the device already applied to itself', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [{ formId: '0x00015038', count: 5 }], // Stimpaks
        perks: [],
      });

      bridge.sentCommands.length = 0;

      // User used a stimpak ON the Pip-Boy; the device already decremented
      // itself and we mirrored the use into the game
      engine.notifyDeviceConsumed('0x00015038');

      // Game snapshot echoes the consumption back (5 -> 4)
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [{ formId: '0x00015038', count: 4 }],
        perks: [],
      });

      assert.ok(!bridge.sentCommands.some(c => c.includes('it.cnt-=')),
        'Should not send a removal for a device-initiated consumption');
    });

    it('should still sync decrements beyond the device-consumed amount', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [{ formId: '0x00015038', count: 5 }],
        perks: [],
      });

      bridge.sentCommands.length = 0;
      engine.notifyDeviceConsumed('0x00015038');

      // One use came from the device, but two more were used in-game (5 -> 2)
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [{ formId: '0x00015038', count: 2 }],
        perks: [],
      });

      const removeCmd = bridge.sentCommands.find(c => c.includes('it.cnt-='));
      assert.ok(removeCmd, 'Should send a removal for the in-game uses');
      assert.ok(removeCmd.includes('it.cnt-=2'), 'Should only remove the 2 in-game uses');
    });

    it('should not echo a bag-count drop after the device equips a stackable weapon', async () => {
      const settle = () => new Promise((r) => setTimeout(r, 550));

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', equippedweap: 0 },
        inventory: [{ formId: '0x00004330', type: 'WEAP', count: 10 }],
        perks: [],
      });
      await settle();

      bridge.sentCommands.length = 0;
      engine.notifyDeviceEquipped('0x00004330');

      // Game still owns 10 total (1 worn + 9 in bag) but bag-only read was 9.
      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', equippedweap: '0x00004330' },
        inventory: [{ formId: '0x00004330', type: 'WEAP', count: 9 }],
        perks: [],
      });
      await settle();

      assert.ok(
        !bridge.sentCommands.some((c) => c.includes('it.cnt-=')),
        'Should not remove from Pip-Boy when equip only moved one to worn'
      );
    });
  });

  describe('Force full sync', () => {
    it('should reset state and do full sync on next snapshot', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', level: 5 },
        inventory: [],
        perks: [],
      });

      bridge.sentCommands.length = 0;
      await engine.forceFullSync();

      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', level: 5 },
        inventory: [],
        perks: [],
      });

      // Should have resetinventory (full sync behavior)
      assert.ok(bridge.sentCommands.includes('player.resetinventory()'));
    });
  });

  describe('Sync disabled', () => {
    it('should not send any commands when disabled', async () => {
      engine.setEnabled(false);

      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', level: 99 },
        inventory: [],
        perks: [],
      });

      assert.equal(bridge.sentCommands.length, 0);
    });
  });
});
