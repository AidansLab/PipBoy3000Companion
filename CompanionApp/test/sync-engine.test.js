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
    eval: async (expr) => {
      return '{"hasManifest":true,"manifestOld":false,"playerMissing":false,"invMissing":false,"perksMissing":false,"skillsMissing":false}';
    },
    on: () => {},
    emit: () => {},
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('SyncEngine', () => {
  let bridge;
  let engine;
  const settle = () => new Promise((r) => setTimeout(r, 550));

  beforeEach(() => {
    bridge = createMockBridge();
    engine = new SyncEngine(bridge, null); // No mapper — pass-through
    engine.bypassMismatchCheck = true; // Avoid breaking legacy test cases with mismatched snapshots
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

      assert.ok(bridge.sentCommands.some(c => c.includes('player.clearinv()')));
      assert.ok(bridge.sentCommands.some(c => c.includes("'name'")));
      assert.ok(bridge.sentCommands.some(c => c.includes('setlevel(10)')));
      assert.ok(bridge.sentCommands.some(c => c.includes("'hp'")));
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

      const addCmd = bridge.sentCommands.find(c => c.includes("additemhealthpercent"));
      assert.ok(addCmd, 'Should have an additemhealthpercent command');
      assert.ok(addCmd.includes('86430'));
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

      const cmd = bridge.sentCommands.find(c => c.includes("additemhealthpercent"));
      assert.ok(cmd, 'Should have an additemhealthpercent command for 17186');
      assert.ok(cmd.includes('17186'));
      assert.ok(cmd.includes('75'));
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

      const cmd = bridge.sentCommands.find(c => c.includes("additemhealthpercent"));
      assert.ok(cmd, 'Should convert 0.75 to condition 75');
      assert.ok(cmd.includes('17186'));
      assert.ok(cmd.includes('75'));
    });

    it('should add perks on first sync', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [],
        perks: ['0x00031DC4'],
      });

      const cmd = bridge.sentCommands.find(c => c.includes('safeaddperk'));
      assert.ok(cmd);
      assert.ok(cmd.includes('204228'));
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
      await settle();

      bridge.sentCommands.length = 0; // Clear

      // Second snapshot — only hp changed
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', level: 5, hp: 80, maxHP: 100 },
        inventory: [],
        perks: [],
      });
      await settle();

      // Should only have the hp change, not name or level
      assert.ok(bridge.sentCommands.some(c => c.includes("'hp', 80")));
      assert.ok(!bridge.sentCommands.some(c => c.includes('setlevel')));
      assert.ok(!bridge.sentCommands.some(c => c.includes("'name'")));
    });

    it('should sync flashlight LED when torch state changes', async () => {
      // Snapshots are debounced (500ms); wait out the window between sends.

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

      assert.ok(bridge.sentCommands.some(c => c.includes('player.settorch(!0)')));

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', torch: true },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(!bridge.sentCommands.some(c => c.includes('player.settorch')));
    });

    it('should sync flashlight on the first (full) sync when enabled by default', async () => {
      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', torch: true },
        inventory: [],
        perks: [],
      });

      assert.ok(bridge.sentCommands.some(c => c.includes('player.settorch(!0)')));
    });

    it('should not sync flashlight when torch sync is disabled', async () => {
      engine.setTorchSyncEnabled(false);

      assert.strictEqual(engine.handleDeviceTorch(true), false);

      // Full sync with the flashlight on — must not touch the torch LED.
      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', torch: true },
        inventory: [],
        perks: [],
      });

      assert.ok(!bridge.sentCommands.some(c => c.includes('player.settorch')));
    });

    it('should not echo game torch off after the device turned it on', async () => {
      const settle = () => new Promise((r) => setTimeout(r, 550));

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', torch: false },
        inventory: [],
        perks: [],
      });
      await settle();

      bridge.sentCommands.length = 0;
      engine.notifyDeviceTorch(true);

      // Game still reports off (e.g. Pip-Boy menu just closed before reconcile).
      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', torch: false },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(!bridge.sentCommands.some((c) => c.includes('player.settorch(!1)')));

      // Game caught up — device already matches; no redundant setTorch (avoids double sound).
      bridge.sentCommands.length = 0;
      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', torch: true },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(!bridge.sentCommands.some((c) => c.includes('player.settorch')));
    });

    it('should sync game torch off after device-on was confirmed', async () => {
      const settle = () => new Promise((r) => setTimeout(r, 550));

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', torch: false },
        inventory: [],
        perks: [],
      });
      await settle();

      engine.notifyDeviceTorch(true);

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', torch: true },
        inventory: [],
        perks: [],
      });
      await settle();

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', torch: false },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(bridge.sentCommands.some((c) => c.includes('player.settorch(!1)')));
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
      assert.ok(bridge.sentCommands.some(c => c.includes('renderheader')));
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
        bridge.sentCommands.some((c) => c.includes("player.refreshequip('AMMO')"))
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

      const fullSkillCmd = bridge.sentCommands.find((c) => c.includes('syncskills'));
      assert.ok(fullSkillCmd, 'Full sync should write skills via syncskills');
      assert.ok(fullSkillCmd.includes('"guns":80'));

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Test', skills: { ...baseSkills, guns: 90 } },
        inventory: [],
        perks: [],
      });
      await settle();

      const incSkillCmd = bridge.sentCommands.find((c) => c.includes('syncskills'));
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
        !bridge.sentCommands.some((c) => c.includes('syncskills')),
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

      const skillCmd = bridge.sentCommands.find((c) => c.includes('syncskills'));
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

      const fullCmd = bridge.sentCommands.find((c) => c.includes('syncfactions'));
      assert.ok(fullCmd, 'Full sync should write faction reputation');
      assert.ok(fullCmd.includes('"name":"NCR"'));
      assert.ok(fullCmd.includes('"tier":1'));
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

      const incCmd = bridge.sentCommands.find((c) => c.includes('syncfactions'));
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
        !bridge.sentCommands.some((c) => c.includes('syncfactions')),
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

      const cmd = bridge.sentCommands.find((c) => c.includes('syncfactions'));
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

      const cmd = bridge.sentCommands.find((c) => c.includes('syncfactions'));
      assert.ok(cmd, 'Tier change should sync factions');
      assert.ok(cmd.includes('!1'));
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

      const skillCmd = bridge.sentCommands.find((c) => c.includes('syncskills'));
      assert.ok(skillCmd);
      assert.ok(skillCmd.includes('"guns":90'));
    });

    it('should ignore sub-whole-number hp changes (regen ticks)', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', hp: 80.2 },
        inventory: [],
        perks: [],
      });
      await settle();

      bridge.sentCommands.length = 0;

      // Regen tick — hp moved by a decimal but ceil(hp) is unchanged (81)
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', hp: 80.9 },
        inventory: [],
        perks: [],
      });
      await settle();

      assert.ok(!bridge.sentCommands.some(c => c.includes("'hp'")));

      // Crossed a whole number — should sync as ceil(81.1) = 82,
      // matching the game HUD's round-up display
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', hp: 81.1 },
        inventory: [],
        perks: [],
      });
      await settle();

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
      await settle();

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
      await settle();

      // Should only add the new Stimpak, not re-add Nuka-Cola
      const addCmds = bridge.sentCommands.filter(c => c.includes('additemhealthpercent'));
      assert.equal(addCmds.length, 1);
      assert.ok(addCmds[0].includes('86072')); // Hex: 0x00015038 -> Dec: 86072
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
      await settle();

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [
          { formId: '0x0001519E', count: 5 },
        ],
        perks: [],
      });
      await settle();

      const addCmd = bridge.sentCommands.find(c => c.includes('additemhealthpercent') && c.includes(',2,100'));
      assert.ok(addCmd);
    });

    it('should detect new perks', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [],
        perks: ['0x00031DC4'],
      });
      await settle();

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [],
        perks: ['0x00031DC4', '0x00031DB7'],
      });
      await settle();

      const addPerk = bridge.sentCommands.find(c => c.includes('safeaddperk'));
      assert.ok(addPerk);
      assert.ok(addPerk.includes('204215')); // Hex: 0x00031DB7 -> Dec: 204215
      // Should NOT re-add the existing perk
      assert.ok(!bridge.sentCommands.some(c => c.includes('204228'))); // Hex: 0x00031DC4 -> Dec: 204228
    });

    it('should detect removed perks', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [],
        perks: ['0x00031DC4', '0x00031DB7'],
      });
      await settle();

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [],
        perks: ['0x00031DC4'],
      });
      await settle();

      const removePerk = bridge.sentCommands.find(c => c.includes('saferemoveperk'));
      assert.ok(removePerk);
      assert.ok(removePerk.includes('204215')); // Hex: 0x00031DB7 -> Dec: 204215
    });

    it('should detect S.P.E.C.I.A.L. changes', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', special: { ST: 5, PE: 5, EN: 5, CH: 5, IN: 5, AG: 5, LK: 5 } },
        inventory: [],
        perks: [],
      });
      await settle();

      bridge.sentCommands.length = 0;

      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', special: { ST: 6, PE: 5, EN: 5, CH: 5, IN: 5, AG: 5, LK: 5 } },
        inventory: [],
        perks: [],
      });
      await settle();

      // Only ST (strength) changed
      const stCmd = bridge.sentCommands.find(c => c.includes("'strength'"));
      assert.ok(stCmd);
      assert.ok(stCmd.includes('6'));
      // Other SPECIAL stats should not be sent
      assert.ok(!bridge.sentCommands.some(c => c.includes("'perception'")));
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
      await settle();

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
      await settle();

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
      await settle();

      bridge.sentCommands.length = 0;
      engine.notifyDeviceConsumed('0x00015038');

      // One use came from the device, but two more were used in-game (5 -> 2)
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [{ formId: '0x00015038', count: 2 }],
        perks: [],
      });
      await settle();

      const removeCmd = bridge.sentCommands.find(c => c.includes('removeitem') && c.includes(',2'));
      assert.ok(removeCmd, 'Should send a removal for the in-game uses');
    });

    it('should not echo a bag-count drop after the device equips a stackable weapon', async () => {
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
      await settle();

      bridge.sentCommands.length = 0;
      await engine.forceFullSync();

      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test', level: 5 },
        inventory: [],
        perks: [],
      });
      await settle();

      // Should have cleared inventory (full sync behavior)
      assert.ok(bridge.sentCommands.some(c => c.includes('player.clearinv()')));
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

  describe('Game mode mismatch', () => {
    it('should disable sync and turn off companion mode if Pip-Boy mode does not match game', async () => {
      engine.bypassMismatchCheck = false;
      engine.setGameMode('F3');
      engine.setEnabled(true);

      let warningEmitted = false;
      engine.on('warning', (msg) => {
        if (msg.includes('Game/Pip-Boy mode mismatch')) {
          warningEmitted = true;
        }
      });

      await engine.processSnapshot({
        game: 'FNV',
        player: { name: 'Courier' },
        inventory: [],
        perks: [],
      });

      assert.strictEqual(engine.enabled, false);
      assert.ok(warningEmitted, 'Should emit warning');
      assert.ok(bridge.sentCommands.includes('cmode = !1'), 'Should send cmode = !1');
    });
  });
});
