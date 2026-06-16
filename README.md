# Fallout Pip-Boy 3000 — Live Sync

Sync your **Fallout 3** and **Fallout: New Vegas** player stats and inventory to [The Wand Company's Pip-Boy 3000](https://www.thewandcompany.com/pip-boy/) replica in real-time over USB.

> **⚠ DISCLAIMER**: This is an unofficial fan project. Not affiliated with or endorsed by Bethesda Softworks, The Wand Company, or any other entity.

## How It Works

```
┌──────────────────┐    Named Pipe     ┌──────────────────┐    USB Serial    ┌──────────────────┐
│   Fallout 3/NV   │ ──────────────── │  Companion App   │ ──────────────── │  Pip-Boy 3000    │
│  (FOSE/NVSE DLL) │   JSON snapshots  │    (Node.js)     │  JS commands     │   (Espruino)     │
└──────────────────┘                   └──────────────────┘                  └──────────────────┘
```

1. **Game Plugin** (C++ DLL) hooks into Fallout via xFOSE/xNVSE, reads player state every second
2. **Companion App** (Node.js) receives JSON snapshots over a Windows Named Pipe, diffs against previous state
3. **Pip-Boy commands** (`player.setav()`, `player.additem()`, etc.) are sent over USB serial to update the device

## Quick Start

### Prerequisites
- Node.js 18+
- The Wand Company Pip-Boy 3000
- USB-C data cable (not charge-only!)

### Install & Run
```bash
cd CompanionApp
npm install
npm start          # CLI (terminal)
npm run ui         # Desktop UI with live console + firmware upload
```

### Desktop UI (Windows executable)
```bash
cd CompanionApp
npm install
npm run ui                    # Launch the Electron window during development
npm run build:win             # Build portable .exe in CompanionApp/dist/
```

The UI shows live sync console output and an **Upload Firmware to Pip-Boy** button
that writes modified `FW/*-decoded.js` menu files to the device over USB.

### Upload firmware (CLI)
```bash
npm run flash-fw
```

### CLI Options
When running via npm, prefix your flags with `--` so they are passed to the app instead of npm:
```
npm start -- --port <COM#>    Specify the Pip-Boy serial port manually
npm start -- --game <F3|FNV>  Set game mode (Fallout 3 or New Vegas)
npm start -- --no-game        Skip game connection (manual testing mode)
```

### Interactive Commands
```
PipBoy> status           Show connection status
PipBoy> ports            List serial ports
PipBoy> connect COM3     Connect to a specific port
PipBoy> game FNV         Set game mode to New Vegas
PipBoy> test stats       Send test player stats
PipBoy> test item        Add test Nuka-Colas
PipBoy> test perk        Add test perk
PipBoy> test full        Send full test snapshot
PipBoy> send <command>   Send raw JS to Pip-Boy
PipBoy> eval <expr>      Evaluate expression and get result
```

## Project Structure

```
├── CompanionApp/          # Node.js bridge application
│   ├── src/
│   │   ├── cli.js             # Interactive CLI interface
│   │   ├── app-core.js        # Shared sync logic (CLI + UI)
│   │   ├── flash-fw.js        # Firmware upload over USB
│   │   ├── serial-bridge.js   # USB serial communication
│   │   ├── sync-engine.js     # State diffing & command generation
│   │   ├── pipe-client.js     # Named Pipe client (reads from game)
│   │   └── form-id-mapper.js  # Game ↔ Pip-Boy form ID translation
│   ├── electron/              # Desktop UI (Electron)
│   ├── data/
│   │   ├── fo3-items.json     # Fallout 3 item database
│   │   ├── fonv-items.json    # New Vegas item database
│   │   ├── fo3-perks.json     # Fallout 3 perk database
│   │   └── fonv-perks.json    # New Vegas perk database
│   └── test/
│       └── sync-engine.test.js
│
├── GamePlugin/            # C++ FOSE/NVSE plugin (Phase 2)
│   └── src/
│       └── main.cpp           # Plugin skeleton with Named Pipe server
│
└── PipBoyApp/             # Optional on-device Pip-Boy app
    ├── USER/
    │   └── falloutSync.js     # Sync status display app
    └── APPINFO/
        └── falloutSync.json   # App metadata
```

## Pip-Boy API Reference

The Pip-Boy 3000 runs Espruino (JavaScript) and exposes these player commands via its serial REPL:

| Command | Description |
|---------|-------------|
| `player.setav(attr, value)` | Set a player attribute |
| `player.getav(attr)` | Get a player attribute |
| `player.setlevel(n)` | Set player level |
| `player.advlevel()` | Advance level by 1 |
| `player.additem(formId, count)` | Add items to inventory |
| `player.additemhealthpercent(formId, count, condition)` | Add items with condition |
| `player.addperk(formId)` | Add a perk |
| `player.removeperk(formId)` | Remove a perk |
| `player.resetinventory()` | Reset all inventory |
| `player.sync()` | Flush changes to SD card |

## Running Tests

```bash
cd CompanionApp
npm test
```

## Building the Game Plugin (Phase 2)

The game plugin requires:
- Visual Studio 2019/2022 with C++ Desktop Development
- [xFOSE SDK](https://github.com/xFOSE/xFOSE) for Fallout 3
- [xNVSE SDK](https://github.com/xNVSE/NVSE) for New Vegas

See `GamePlugin/src/main.cpp` for build instructions and TODO markers.

## License

MIT
