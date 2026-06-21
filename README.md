# Pip-Boy 3000 Companion App

Sync your **Fallout 3** and **Fallout: New Vegas** player stats and inventory to [The Wand Company's Pip-Boy 3000](https://www.thewandcompany.com/pip-boy-3000/) replica in real-time over USB.

> **⚠ DISCLAIMER**: This is an unofficial fan project. Not affiliated with or endorsed by Bethesda Softworks, The Wand Company, or any other entity.

> **⚠ WARNING**: Compatibility with mods and modpacks that add or modify items and/or modify gameplay is not guaranteed. YUP is specifically not supported because the mod changes the formid's on some vanilla items.

## How It Works

```
┌──────────────────┐    Named Pipe     ┌──────────────────┐    USB Serial    ┌──────────────────┐
│   Fallout 3/NV   │ ───────────────── │  Companion App   │ ──────────────── │  Pip-Boy 3000    │
│  (FOSE/NVSE DLL) │  JSON snapshots   │    (Node.js)     │    JS commands   │   (Espruino)     │
└──────────────────┘                   └──────────────────┘                  └──────────────────┘
```

1. **Game Plugin** (C++ DLL) hooks into Fallout via xFOSE/xNVSE, reads player state on update
2. **Companion App** (Node.js) receives JSON snapshots over a Windows Named Pipe, diffs against previous state
3. **Pip-Boy commands** Espruino commands are sent over USB serial to update the device

## Quick Start
- Download the latest companion app exe from the [Releases page](https://github.com/AidansLab/PipBoy3000CompanionApp/releases)
- Install [NVSE](https://github.com/xNVSE/NVSE/releases) or [xFOSE](https://www.nexusmods.com/fallout3/mods/8606?tab=description) depending on your game.
- Install the latest plugin DLL from [Nexus mods]() with mod manager or manually install from the [Releases page](https://github.com/AidansLab/PipBoy3000CompanionApp/releases) to your NVSE plugins folder.
- Open the companion app and click "Install Companion Menus & Boot Patch" to install the companion firmware to your device.
- Make sure your Pip-Boy is set to the same mode as the game you want to sync with by going to DATA>Settings>Pip-Boy mode and selecting New Vegas or Fallout 3.
- Launch your game via your mod manager, nvse_loader.exe, or fose_loader.exe.

## Building

### Prerequisites
- Node.js 18+
- Visual Studio 2022+

### Desktop UI (Windows executable)
```bash
cd CompanionApp
npm install
npm run build-fw              # Build firmware files
npm run build:win             # Build portable .exe in release/
```

### Install companion firmware (CLI)
```bash
npm run build-fw
npm run flash-fw
```

## Building the Game Plugin

The game plugin requires:
- Visual Studio 2022+ with C++ Desktop Development
- [xFOSE SDK](https://github.com/xFOSE/xFOSE) for Fallout 3
- [xNVSE SDK](https://github.com/xNVSE/NVSE) for New Vegas

### Instructions
- Go to GamePlugin\build and open FalloutPipBoySync.sln
- Click Build -> Build Solution
- The DLL will be built to Release

## License

This software is licensed under the AGPLv3. For commercial use without the AGPL's copyleft restrictions, please contact me to purchase a commercial license.
