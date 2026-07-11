<div align="center">
<h1>Pip-Boy 3000 Companion</h1>

<a href="https://www.paypal.com/donate/?hosted_button_id=YCQRQCCNQGCHY">
  <img src="https://img.shields.io/badge/PayPal-Donate-blue?logo=paypal&logoColor=white&style=for-the-badge" alt="PayPal"></a>
<img alt="GitHub package.json version" src="https://img.shields.io/github/package-json/v/AidansLab/PipBoy3000Companion?style=for-the-badge&filename=CompanionApp/package.json">
<img alt="GitHub commits since latest release" src="https://img.shields.io/github/commits-since/AidansLab/PipBoy3000Companion/latest?style=for-the-badge">
<p></p>
<img alt="GitHub License" src="https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-blue?style=flat-square&link=https%3A%2F%2Fgithub.com%2FAidansLab%2FPipBoy3000Companion%2Fblob%2Fmain%2FLICENSE">
<img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/AidansLab/PipBoy3000Companion?style=flat-square">
<img alt="GitHub last commit" src="https://img.shields.io/github/last-commit/AidansLab/PipBoy3000Companion?flat-square">
<img alt="GitHub forks" src="https://img.shields.io/github/forks/AidansLab/PipBoy3000Companion?style=flat-square">


</div>

Sync your **Fallout: New Vegas** and **Fallout 3** player stats and inventory to [The Wand Company's Pip-Boy 3000](https://www.thewandcompany.com/pip-boy-3000/) replica in real-time over USB.

> **⚠ DISCLAIMER**: This is an unofficial fan project. Not affiliated with or endorsed by Bethesda Softworks, The Wand Company, or any other entity.

> **⚠ WARNING**: Compatibility with mods and modpacks that add or modify items and/or modify gameplay is not guaranteed. YUP is specifically known to have issues because the mod changes the formid's on some vanilla items. I am one person, so bugs are innevitable, please open an issue if you run into any bugs or errors. Donations help me to continue this project.

## How It Works

```
┌──────────────────┐    Named Pipe     ┌──────────────────┐    USB Serial    ┌──────────────────┐
│   Fallout 3/NV   │ ───────────────── │  Companion App   │ ──────────────── │  Pip-Boy 3000    │
│  (FOSE/NVSE DLL) │  JSON snapshots   │    (Node.js)     │    JS commands   │   (Espruino)     │
└──────────────────┘                   └──────────────────┘                  └──────────────────┘
```

1. **Game Plugin** (C++ DLL) hooks into Fallout via FOSE/xNVSE, reads player state on update
2. **Companion App** (Node.js) receives JSON snapshots over a Windows Named Pipe, diffs against previous state
3. **Pip-Boy commands** Espruino commands are sent over USB serial to update the device

## Quick Start
- Download the latest companion app exe from the [Releases page](https://github.com/AidansLab/PipBoy3000Companion/releases)
- Install [NVSE](https://www.nexusmods.com/newvegas/mods/67883?tab=files) or [FOSE](https://www.nexusmods.com/fallout3/mods/8606?tab=description) depending on your game.
- Install the latest plugin DLL for [Fallout New Vegas]() or [Fallout 3]() by clicking the Mod manager download if you are using a mod manager, or manually install from the [Releases page](https://github.com/AidansLab/PipBoy3000Companion/releases) to your NVSE/FOSE plugins folder.
- Plug in your Pip-Boy 3000 with a USB C cable, make sure to use a USB cable that supports data transfer, not just charging. The one that came with your Pip-Boy works great.
- Make sure your Pip-Boy is set to the same mode as the game you want to sync with by going to DATA>Settings>Pip-Boy mode and selecting New Vegas or Fallout 3.
- Open the companion app and click "Install Companion Menus & Boot Patch" to install the companion firmware to your device. Wait for it to reboot and connect to the app.
- Launch your game via your mod manager, or script extender loader (nvse_loader.exe/fose_loader.exe).

## Limitations/Known Issues
- Equip/unequip sounds on Pip-Boy can sometimes be delayed slightly
- Dropping or picking up many items at once (20+) can cause the Pip-Boy to freeze for about 2-3 seconds after the last item is picked up/dropped.
- Holotapes may suffer from memory issues, and have been known to crash the Pip-Boy when loading. (This issue is largely eliminated, but might still be present under certain conditions, so is kept as a warning)
Limitations
- YUP is known to cause issues because it changes Form IDs on some vanilla items.
- XP does not sync on every change, and only updates on a full sync, load sync, or on level up.
- Bleak Venom is not usable from the Pip-Boy due to issues with how the game handles usage.

## Building From Source

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

## Building the Game Plugins

Both game plugins require:
- Visual Studio 2022+ with C++ Desktop Development (includes CMake)
- xNVSE's SDK is a bundled submodule: `git submodule update --init`
- FOSE's SDK is not on GitHub - download it from [fose.silverlock.org](https://fose.silverlock.org)
  and extract it to `GamePlugin/FOSE` (containing `fose/` and `common/` directories)

The Visual Studio solutions are **generated by CMake** (they contain
machine-specific paths, so they are not committed) - run the matching
configure command once from a Developer Command Prompt in `GamePlugin\`,
then either build on the command line or open the generated `.sln`.
Each build tree contains only its own game's plugin.

### Fallout: New Vegas (xNVSE)
```bash
cmake -S . -B build-nv -A Win32 -DBUILD_FO3_PLUGIN=OFF
cmake --build build-nv --config Release
```
- Or open `build-nv\FalloutPipBoySync.sln` and Build -> Build Solution
- The DLL will be built to `build-nv\Release\FalloutPipBoySyncNV.dll` (install to `Data\NVSE\Plugins\`)

### Fallout 3 (FOSE)
```bash
cmake -S . -B build-fo3 -A Win32 -DBUILD_NV_PLUGIN=OFF
cmake --build build-fo3 --config Release
```
- Or open `build-fo3\FalloutPipBoySync.sln` and Build -> Build Solution
- The DLL will be built to `build-fo3\Release\FalloutPipBoySyncF3.dll` (install to `Data\FOSE\Plugins\`)

### Credits

- Author: Aidan's Lab
- Pip-Boy 3000: [The Wand Company](https://www.thewandcompany.com/)
- Script extenders: [xNVSE](https://www.nexusmods.com/newvegas/mods/67883) and [FOSE](https://fose.silverlock.org/) teams
- Helpful Resources: [JIP-LN-NVSE](https://github.com/jazzisparis/JIP-LN-NVSE) and [Command Extender](https://www.nexusmods.com/fallout3/mods/23682)
- Testers: Special thanks to [Theeohn](https://www.youtube.com/channel/UCEPD_e4JH7xFLzdrPGUM_Gg) and Jim D for testing.

## License

See LICENSE file.