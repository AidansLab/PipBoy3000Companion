/**
 * cli.js
 * 
 * Command-line interface for the Fallout Pip-Boy 3000 Sync companion app.
 * Provides:
 *   - Auto-detection and manual selection of the Pip-Boy COM port
 *   - Game mode selection (Fallout 3 / New Vegas)
 *   - Live sync status display with color-coded output
 *   - Manual test commands for sending items, stats, and perks
 *   - Interactive REPL for sending raw Espruino commands
 */

import { createInterface } from 'readline';
import { SerialBridge } from './serial-bridge.js';
import { SyncEngine } from './sync-engine.js';
import { PipeClient } from './pipe-client.js';
import { FormIdMapper, formatGameFormId } from './form-id-mapper.js';
import { PRESYNC_RESTORE_HINT, COMPANION_PATCH_REQUIRED_MSG } from './app-core.js';

// ─── ANSI Color Helpers ────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  pipGreen: '\x1b[38;2;55;250;55m',  // Pip-Boy green
  pipAmber: '\x1b[38;2;255;176;0m',   // Pip-Boy amber
};

// ─── Parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const portArg = args.find((_, i) => args[i - 1] === '--port');
const gameArg = args.find((_, i) => args[i - 1] === '--game');
const noGameArg = args.includes('--no-game') ||
  process.env.npm_config_no_game === 'true' ||
  process.env.npm_config_game === 'false';
const helpArg = args.includes('--help') || args.includes('-h');

if (helpArg) {
  printHelp();
  process.exit(0);
}

function printHelp() {
  console.log(`
${C.pipGreen}╔══════════════════════════════════════════════════════════════╗
║          FALLOUT PIP-BOY 3000 SYNC COMPANION           ║
╚══════════════════════════════════════════════════════════════╝${C.reset}

${C.bold}USAGE:${C.reset}
  node src/cli.js [options]

${C.bold}OPTIONS:${C.reset}
  --port <COM#>    Specify the Pip-Boy serial port (e.g., COM3)
  --game <mode>    Set game mode: F3 (Fallout 3) or FNV (New Vegas)
  --no-game        Skip connecting to game pipe (manual mode only)
  --help, -h       Show this help message

${C.bold}INTERACTIVE COMMANDS:${C.reset}
  ${C.cyan}status${C.reset}           Show connection and sync status
  ${C.cyan}ports${C.reset}            List available serial ports
  ${C.cyan}connect [port]${C.reset}   Connect to Pip-Boy (auto-detect or specify port)
  ${C.cyan}disconnect${C.reset}       Disconnect from Pip-Boy
  ${C.cyan}game <F3|FNV>${C.reset}    Set game mode
  ${C.cyan}sync on|off${C.reset}      Enable/disable live sync
  ${C.cyan}resync${C.reset}           Force a full resync
  ${C.cyan}test stats${C.reset}       Send test player stats to Pip-Boy
  ${C.cyan}test item${C.reset}        Send a test Nuka-Cola to Pip-Boy
  ${C.cyan}test perk${C.reset}        Send a test perk to Pip-Boy
  ${C.cyan}test reset${C.reset}       Reset Pip-Boy inventory
  ${C.cyan}send <command>${C.reset}   Send a raw JS command to the Pip-Boy REPL
  ${C.cyan}eval <expr>${C.reset}      Evaluate a JS expression and print result
  ${C.cyan}help${C.reset}             Show this help
  ${C.cyan}quit${C.reset}             Exit the app
`);
}

// ─── ASCII Art Banner ──────────────────────────────────────────────────────────
function printBanner() {
  console.log(`${C.pipGreen}
  ╔═══════════════════════════════════════════════════════════════════════╗
  ║                                                                       ║
  ║   ██████╗ ██╗██████╗       ██████╗  ██████╗ ██╗   ██╗                 ║
  ║   ██╔══██╗██║██╔══██╗      ██╔══██╗██╔═══██╗╚██╗ ██╔╝                 ║
  ║   ██████╔╝██║██████╔╝█████╗██████╔╝██║   ██║ ╚████╔╝                  ║
  ║   ██╔═══╝ ██║██╔═══╝ ╚════╝██╔══██╗██║   ██║  ╚██╔╝                   ║
  ║   ██║     ██║██║           ██████╔╝╚██████╔╝   ██║                    ║
  ║   ╚═╝     ╚═╝╚═╝           ╚═════╝  ╚═════╝    ╚═╝                    ║
  ║                                                                       ║
  ║   ${C.bold}3000 — LIVE SYNC COMPANION${C.pipGreen}                                          ║
  ║   ${C.dim}Fallout 3 & New Vegas Edition${C.pipGreen}                                       ║
  ║                                                                       ║
  ╚═══════════════════════════════════════════════════════════════════════╝${C.reset}
  `);
}

// ─── Status formatting ─────────────────────────────────────────────────────────
function logStatus(msg) {
  console.log(`${C.cyan}[STATUS]${C.reset} ${msg}`);
}

function logSync(msg) {
  console.log(`${C.pipGreen}[SYNC]${C.reset} ${msg}`);
}

function logWarn(msg) {
  console.log(`${C.yellow}[WARN]${C.reset} ${msg}`);
}

function logError(msg) {
  console.log(`${C.red}[ERROR]${C.reset} ${msg}`);
}

function logCmd(msg) {
  console.log(`${C.magenta}[CMD]${C.reset} ${C.dim}${msg}${C.reset}`);
}

// ─── Main Application ─────────────────────────────────────────────────────────
async function main() {
  printBanner();

  // Initialize components
  const bridge = new SerialBridge({
    comPort: portArg || null,
    autoReconnect: true,
  });

  const mapper = new FormIdMapper();
  await mapper.load();

  const syncEngine = new SyncEngine(bridge, mapper);
  const pipeClient = new PipeClient({ autoReconnect: true });
  let initialSyncHintShown = false;
  let companionPatchInstalled = false;

  async function verifyCompanionPatch() {
    try {
      companionPatchInstalled = await bridge.hasCompanionPatch();
    } catch (err) {
      companionPatchInstalled = false;
      logWarn(`Could not verify companion patch: ${err.message}`);
    }
    if (!companionPatchInstalled) {
      logWarn(COMPANION_PATCH_REQUIRED_MSG);
    }
    return companionPatchInstalled;
  }

  async function tryEnableSync() {
    if (!companionPatchInstalled || !bridge.connected || !pipeClient.connected) {
      return;
    }
    syncEngine.setEnabled(true);
    await bridge.sendCommand('cmode = !0');
  }

  // Set game mode if specified via CLI arg (otherwise auto-detected after connect)
  if (gameArg) {
    syncEngine.setGameMode(gameArg.toUpperCase());
    logStatus(`Game mode: ${gameArg.toUpperCase()}`);
  }

  // Helper: auto-detect game mode from the Pip-Boy device
  async function autoDetectGameMode() {
    if (syncEngine.gameMode) return; // Already set
    try {
      logStatus('Detecting Pip-Boy game mode...');
      const mode = await bridge.detectGameMode();
      syncEngine.setGameMode(mode);
      const label = mode === 'FNV' ? 'Fallout: New Vegas' : 'Fallout 3';
      logStatus(`${C.green}✓ Detected game mode: ${label}${C.reset}`);
    } catch (err) {
      logWarn(`Could not auto-detect game mode: ${err.message}`);
      logStatus('Use "game <F3|FNV>" to set manually');
    }
  }

  // ─── Wire up event handlers ──────────────────────────────────────────────
  bridge.on('status', logStatus);
  bridge.on('connected', async (port) => {
    logStatus(`${C.green}✓ Pip-Boy connected on ${port}${C.reset}`);
    if (!(await verifyCompanionPatch())) {
      return;
    }
    if (!gameArg) {
      await autoDetectGameMode();
    }
    if (pipeClient.connected) {
      await tryEnableSync();
    } else {
      await bridge.sendCommand('cmode = !1');
    }
  });
  bridge.on('disconnected', () => {
    logWarn('Pip-Boy disconnected');
    companionPatchInstalled = false;
    syncEngine.setEnabled(false);
    if (!gameArg) {
      syncEngine.clearGameMode();
    }
  });
  bridge.on('error', (err) => {
    logError(`Serial: ${err.message}`);
  });
  bridge.on('command-sent', (cmd) => {
    logCmd(cmd);
  });

  // Pip-Boy → game: user used/equipped an item on the device
  bridge.on('device-event', async (evt) => {
    if (evt.action === 'restore') {
      await syncEngine.notifyPresyncRestored();
      logSync('Pre-sync data restored on Pip-Boy (companion was disconnected)');
      return;
    }

    const gameMode = syncEngine.gameMode || 'FNV';
    const gameFormId = mapper.resolveToGame(evt.formId, gameMode);
    const pipeFormId = formatGameFormId(gameFormId);

    // An AID use already decremented the device's local count — make sure the
    // sync engine doesn't echo the game's matching decrement back to it
    if (evt.action === 'use') {
      syncEngine.notifyDeviceConsumed(pipeFormId);
    }

    if (pipeClient.connected) {
      pipeClient.send(`${evt.action.toUpperCase()} ${pipeFormId}`);
      if (pipeFormId.toLowerCase() !== String(evt.formId).toLowerCase()) {
        logSync(`Pip-Boy → game: ${evt.action} ${evt.category} ${evt.formId} → ${pipeFormId}`);
      } else {
        logSync(`Pip-Boy → game: ${evt.action} ${evt.category} ${pipeFormId}`);
      }
    } else {
      logWarn(`Pip-Boy ${evt.action} ${evt.category} ${gameFormId} ignored (game not connected)`);
    }
  });

  syncEngine.on('status', logStatus);
  syncEngine.on('syncing', ({ commandCount }) => {
    logSync(`Sending ${commandCount} update(s)...`);
  });
  syncEngine.on('synced', ({ commandCount }) => {
    logSync(`${C.green}✓ ${commandCount} command(s) sent${C.reset}`);
  });
  syncEngine.on('initial-sync-complete', () => {
    if (initialSyncHintShown) return;
    initialSyncHintShown = true;
    console.log(`\n${C.bold}${C.pipGreen}★ ${PRESYNC_RESTORE_HINT}${C.reset}\n`);
  });
  // Lock the game (disable controls + "please wait" pop-up) during the heavy
  // initial sync, then release it.
  syncEngine.on('initial-sync-start', () => {
    if (pipeClient.connected) pipeClient.send('SYNC_LOCK');
  });
  syncEngine.on('initial-sync-end', () => {
    if (pipeClient.connected) pipeClient.send('SYNC_UNLOCK');
  });
  syncEngine.on('flushed', () => {
    logSync(`${C.dim}Flushed to Pip-Boy SD card${C.reset}`);
  });
  syncEngine.on('warning', logWarn);
  syncEngine.on('error', (err) => {
    logError(`Sync: ${err.message}`);
  });

  pipeClient.on('status', logStatus);
  pipeClient.on('connected', async () => {
    await tryEnableSync();
  });
  pipeClient.on('disconnected', async () => {
    logWarn('Game connection lost');
    syncEngine.setEnabled(false);
    if (bridge.connected && companionPatchInstalled) {
      try {
        await bridge.sendCommand('cmode = !1');
      } catch (_) {}
    }
  });
  pipeClient.on('save-load', () => {
    syncEngine.handleSaveLoad();
  });
  pipeClient.on('snapshot', (snapshot) => {
    syncEngine.processSnapshot(snapshot);
  });
  pipeClient.on('error', (err) => {
    if (err.code !== 'ENOENT') {
      logError(`Pipe: ${err.message}`);
    }
  });

  // ─── Auto-connect to Pip-Boy ─────────────────────────────────────────────
  logStatus('Searching for Pip-Boy 3000...');
  try {
    await bridge.connect(portArg);
  } catch (err) {
    logWarn(`Auto-connect failed: ${err.message}`);
    logStatus('Use "connect" or "connect <COM#>" to connect manually');
  }

  // ─── Connect to game pipe (unless --no-game) ────────────────────────────
  if (!noGameArg) {
    pipeClient.connect();
  } else {
    logStatus('Running in manual mode (--no-game). Use test commands to interact.');
  }

  // ─── Cleanup Handlers ────────────────────────────────────────────────────
  let isShuttingDown = false;
  const cleanup = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logStatus('Shutting down...');
    syncEngine.setEnabled(false);
    if (bridge.connected) {
      try {
        if (companionPatchInstalled) {
          await bridge.sendCommand('cmode = !1');
        }
        await bridge.sendCommand('player.sync()');
        await bridge.disconnect();
      } catch (e) {}
    }
    pipeClient.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGHUP', cleanup);

  // ─── Interactive REPL ────────────────────────────────────────────────────
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${C.pipGreen}PipBoy>${C.reset} `,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    const [cmd, ...rest] = input.split(/\s+/);
    const argStr = rest.join(' ');

    try {
      switch (cmd.toLowerCase()) {
        case 'help':
          printHelp();
          break;

        case 'status': {
          const stats = syncEngine.getStats();
          const mapperStats = mapper.getStats();
          console.log(`
${C.bold}Connection Status:${C.reset}
  Pip-Boy:    ${bridge.connected ? `${C.green}Connected${C.reset}` : `${C.red}Disconnected${C.reset}`}
  Patch:      ${companionPatchInstalled ? `${C.green}Installed${C.reset}` : `${C.yellow}Not installed${C.reset}`}
  Game Pipe:  ${pipeClient.connected ? `${C.green}Connected${C.reset}` : `${C.red}Disconnected${C.reset}`}
  Sync:       ${syncEngine.enabled ? `${C.green}Active${C.reset}` : `${C.yellow}Paused${C.reset}`}
  Game Mode:  ${syncEngine.gameMode || `${C.dim}Not set${C.reset}`}

${C.bold}Sync Statistics:${C.reset}
  Snapshots Processed: ${stats.snapshotsProcessed}
  Commands Sent:       ${stats.commandsSent}
  Errors:              ${stats.errors}

${C.bold}Item Database:${C.reset}
  FO3 Items:  ${mapperStats.fo3Items}
  FNV Items:  ${mapperStats.fonvItems}
  FO3 Perks:  ${mapperStats.fo3Perks}
  FNV Perks:  ${mapperStats.fonvPerks}
  Loaded:     ${mapperStats.loaded ? 'Yes' : 'No (pass-through mode)'}
`);
          break;
        }

        case 'ports': {
          const ports = await SerialBridge.listPorts();
          if (ports.length === 0) {
            logWarn('No serial ports found');
          } else {
            console.log(`\n${C.bold}Available serial ports:${C.reset}`);
            for (const p of ports) {
              const isPipBoy = p.vendorId?.toLowerCase() === '0483';
              const marker = isPipBoy ? ` ${C.pipGreen}← likely Pip-Boy${C.reset}` : '';
              console.log(`  ${C.cyan}${p.path}${C.reset} — ${p.manufacturer || 'Unknown'}${marker}`);
            }
            console.log('');
          }
          break;
        }

        case 'connect':
          try {
            await bridge.connect(argStr || undefined);
            // Auto-detect game mode after connecting
            await autoDetectGameMode();
          } catch (err) {
            logError(err.message);
          }
          break;

        case 'disconnect':
          await bridge.disconnect();
          logStatus('Disconnected from Pip-Boy');
          break;

        case 'game':
          if (argStr && ['F3', 'FNV'].includes(argStr.toUpperCase())) {
            syncEngine.setGameMode(argStr.toUpperCase());
            logStatus(`Game mode set to ${argStr.toUpperCase()}`);
          } else if (argStr === 'auto' || !argStr) {
            // Re-detect from device
            const prevMode = syncEngine.gameMode;
            syncEngine.gameMode = null; // Reset so autoDetect runs
            await autoDetectGameMode();
            if (!syncEngine.gameMode && prevMode) {
              syncEngine.setGameMode(prevMode); // Restore if detection failed
            }
          } else {
            logError('Usage: game <F3|FNV|auto>');
          }
          break;

        case 'sync':
          if (argStr.toLowerCase() === 'on') {
            if (!companionPatchInstalled) {
              logWarn(COMPANION_PATCH_REQUIRED_MSG);
            } else {
              await tryEnableSync();
            }
          } else if (argStr.toLowerCase() === 'off') {
            syncEngine.setEnabled(false);
          } else {
            logError('Usage: sync on|off');
          }
          break;

        case 'resync':
          await syncEngine.forceFullSync();
          logStatus('Full resync will occur on next snapshot');
          break;

        case 'test':
          await handleTestCommand(rest[0], bridge, syncEngine);
          break;

        case 'send':
          if (!argStr) {
            logError('Usage: send <js command>');
          } else if (!bridge.connected) {
            logError('Not connected to Pip-Boy');
          } else {
            await bridge.sendCommand(argStr);
            logStatus(`Sent: ${argStr}`);
          }
          break;

        case 'eval':
          if (!argStr) {
            logError('Usage: eval <js expression>');
          } else if (!bridge.connected) {
            logError('Not connected to Pip-Boy');
          } else {
            try {
              const result = await bridge.eval(argStr);
              console.log(`${C.green}→${C.reset} ${result}`);
            } catch (err) {
              logError(`Eval failed: ${err.message}`);
            }
          }
          break;

        case 'quit':
        case 'exit':
          await cleanup();
          break;

        default:
          logWarn(`Unknown command: ${cmd}. Type "help" for available commands.`);
      }
    } catch (err) {
      logError(err.message);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    cleanup();
  });
}

// ─── Test commands ─────────────────────────────────────────────────────────────
async function handleTestCommand(subCmd, bridge, syncEngine) {
  if (!bridge.connected) {
    logError('Not connected to Pip-Boy. Use "connect" first.');
    return;
  }

  switch (subCmd?.toLowerCase()) {
    case 'stats':
      logStatus('Sending test player stats...');
      await bridge.sendBatch([
        `player.setav('name', 'Vault Dweller')`,
        `player.setlevel(15)`,
        `player.setav('karma', 500)`,
        `player.setav('strength', 6)`,
        `player.setav('perception', 7)`,
        `player.setav('endurance', 5)`,
        `player.setav('charisma', 4)`,
        `player.setav('intelligence', 8)`,
        `player.setav('agility', 7)`,
        `player.setav('luck', 6)`,
        `player.sync()`,
      ]);
      logSync('Test stats sent! Check your Pip-Boy.');
      break;

    case 'item':
      logStatus('Adding test items to all inventory pages...');
      await bridge.sendBatch([
        `player.additem(0x0001519E, 6)`,  // Nuka-Cola (AID)
        `player.additem(0x0000434F, 1)`,  // 10mm Pistol (WEAP)
        `player.additem(0x00004241, 50)`, // 10mm Round (AMMO)
        `player.additem(0x0000000A, 25)`, // Bobby Pin (MISC)
        `player.additem(0x000340C8, 1)`,  // Pre-War Hat (APPAREL)
        `if(Pip.CURRENT && ['WEAPONS','APPAREL','AID','MISC','AMMO'].indexOf(Pip.CURRENT.id)>=0) Pip.changeMenu();`,
        `player.sync()`,
      ]);
      logSync('Added test items across categories! Check your Pip-Boy.');
      break;

    case 'perk':
      logStatus('Adding test perk (Computer Whiz)...');
      await bridge.sendBatch([
        `player.addperk(0x00031DC4)`,  // Computer Whiz
        `player.sync()`,
      ]);
      logSync('Added Computer Whiz perk! Check STAT > PERKS on your Pip-Boy.');
      break;

    case 'weapon':
      logStatus('Sending test weapon...');
      await bridge.sendBatch([
        `player.additemhealthpercent('0x0004322', 1, 85)`, // 10mm Pistol
        `if(Pip.CURRENT && ['WEAPONS','APPAREL','AID','MISC','AMMO'].indexOf(Pip.CURRENT.id)>=0) Pip.changeMenu();`,
      ]);
      logSync('Added 10mm Pistol! Check INV > WEAPONS on your Pip-Boy.');
      break;

    case 'apparel':
      logStatus('Sending test apparel...');
      await bridge.sendBatch([
        `player.additemhealthpercent('0x0006B464', 1, 100)`, // Tesla Armor
        `if(Pip.CURRENT && ['WEAPONS','APPAREL','AID','MISC','AMMO'].indexOf(Pip.CURRENT.id)>=0) Pip.changeMenu();`,
      ]);
      logSync('Added Tesla Armor! Check INV > APPAREL on your Pip-Boy.');
      break;

    case 'misc':
      logStatus('Sending test misc item...');
      await bridge.sendBatch([
        `player.additem('0x0000000F', 250)`, // Caps
        `if(Pip.CURRENT && ['WEAPONS','APPAREL','AID','MISC','AMMO'].indexOf(Pip.CURRENT.id)>=0) Pip.changeMenu();`,
      ]);
      logSync('Added 250 Bottlecaps! Check INV > MISC on your Pip-Boy.');
      break;

    case 'ammo':
      logStatus('Sending test ammo...');
      await bridge.sendBatch([
        `player.additem('0x00004241', 50)`, // 10mm Rounds
        `if(Pip.CURRENT && ['WEAPONS','APPAREL','AID','MISC','AMMO'].indexOf(Pip.CURRENT.id)>=0) Pip.changeMenu();`,
      ]);
      logSync('Added 50 10mm Rounds! Check INV > AMMO on your Pip-Boy.');
      break;

    case 'reset':
      logStatus('Resetting Pip-Boy inventory...');
      await bridge.sendBatch([
        `['AID','AMMO','APPAREL','MISC','WEAPONS'].forEach(function(v){try{require('fs').writeFileSync('INV/'+(NV?'NV':'F3')+'/'+v+'.INV','')}catch(e){}})`,
        `player.calculateInvWeight()`,
      ]);
      logSync('Inventory reset complete.');
      break;

    case 'full': {
      logStatus('Sending full test snapshot...');
      const testSnapshot = {
        game: syncEngine.gameMode || 'FNV',
        player: {
          name: 'Lone Wanderer',
          level: 20,
          xpNext: 25000,
          hp: 350,
          maxHP: 400,
          ap: 90,
          maxAP: 95,
          wg: 180,
          maxWg: 275,
          karma: 750,
          special: { ST: 7, PE: 6, EN: 8, CH: 5, IN: 9, AG: 6, LK: 7 },
          skills: {
            barter: 45, energyweapons: 20, explosives: 30, lockpick: 55, medicine: 60,
            meleeweapons: 25, repair: 70, science: 85, guns: 90, sneak: 40, speech: 65,
            survival: 50, unarmed: 15
          }
        },
        inventory: [
          { formId: '0x0001519E', type: 'AID', count: 12, condition: 100 },  // Nuka-Cola
          { formId: '0x00015038', type: 'AID', count: 5, condition: 100 },   // Stimpak
          { formId: '0x00004322', type: 'WEAP', count: 1, condition: 85 },   // 10mm Pistol
        ],
        perks: ['0x00031DC4'],  // Computer Whiz
      };
      await syncEngine.processSnapshot(testSnapshot);
      logSync('Full test snapshot synced!');
      break;
    }

    default:
      console.log(`
${C.bold}Test commands:${C.reset}
  test stats    Send sample player stats (name, level, S.P.E.C.I.A.L., etc.)
  test item     Add 6 Nuka-Colas to inventory (AID)
  test weapon   Add 1 10mm Pistol to inventory (WEAPONS)
  test apparel  Add 1 Tesla Armor to inventory (APPAREL)
  test misc     Add 250 Bottlecaps to inventory (MISC)
  test ammo     Add 50 10mm Rounds to inventory (AMMO)
  test perk     Add "Computer Whiz" perk
  test reset    Reset Pip-Boy inventory to default
  test full     Send a complete test snapshot (stats + inventory + perks)
`);
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error(`${C.red}Fatal error: ${err.message}${C.reset}`);
  process.exit(1);
});
