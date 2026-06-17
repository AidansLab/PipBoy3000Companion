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

    it('should use additemhealthpercent for items with degraded condition', async () => {
      await engine.processSnapshot({
        game: 'F3',
        player: { name: 'Test' },
        inventory: [
          { formId: '0x00004322', type: 'WEAP', count: 1, condition: 75 },
        ],
        perks: [],
      });

      const cmd = bridge.sentCommands.find(c => c.includes('additemhealthpercent'));
      assert.ok(cmd, 'Should use additemhealthpercent for degraded items');
      assert.ok(cmd.includes('75'));
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
