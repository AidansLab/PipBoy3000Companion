# Device recovery — what broke, how it was fixed, what still needs doing

Written 2026-09-27 after the Pip-Boy stopped booting during quest sync
development. Everything here was observed on real hardware.

**Read section 5 before flashing this device again.** There is a real bug in
the flasher that will repeat this failure.

---

## 1. Current state of the device

Working:

- Boots stock firmware, STATS page renders, `Pip.sleeping` is `false`
- Battery healthy (4.20 V), USB enumerates on COM9
- Storage healthy: `131,072` total, `72,472` free, **0 trash**
- SD card untouched throughout — all 27 `JS/*.JS`, `.INV` data, `QUESTS.STA`
  (46 rows) and `QUESTS_EXT.TXT` (10,231 bytes, 23 records) intact and CRC-verified

Not working:

- **`.boot0` is absent** (erased during recovery), so there is no companion patch
- Therefore `WEAPONS.JS`, `APPAREL.JS`, `SETTINGS.JS` report **"unable to load"**.
  Those are *our* companion menu scripts sitting on the SD, and they reference
  globals `.boot0` defines (`cmode`, `Pip.companionDropItem`,
  `player.refreshequip`). Without it they throw on load and stock FW shows its
  "unable to load" screen. The files themselves are fine.
- `QUESTS.JS` still loads, because its calls are wrapped in `try/catch`; with no
  `player.getquests()` it falls back to browsing all 168 catalog quests.

**To finish the fix:** reinstall `.boot0` (`npm run flash-fw`). Storage is clean,
so a single flash is safe. But fix section 5 first, or the leak resumes.

---

## 2. Root cause

**Espruino Storage is append-only. Every `.boot0` rewrite leaves the previous
copy as trash until compaction, and the flasher's compaction silently does
nothing.**

`flash-fw.js` calls `ensureStorageSpace()`, which calls `Storage.compact()` when
free space is low. But **`compact()` cannot relocate `.bootcde` while the
interpreter is executing it** — Espruino runs Storage code memory-mapped from
flash. During normal operation `.bootcde` *is* the running firmware, so
compaction is a no-op that reports success.

Five reflashes in one session leaked 61 KB:

| | fileBytes | freeBytes | trashBytes |
| --- | --- | --- | --- |
| Start of session | 70,232 | 60,736 | (not measured) |
| After 5 flashes | 54,504 | 15,384 | **61,184 (8 entries)** |
| After proper compaction | 54,504 | 76,568 | 0 |

Free space ratcheted down each flash until a write failed and took the boot with
it. `getStats()` reports `trashBytes` directly and would have made this obvious
at any point; nothing in the project ever called it.

### What it was NOT

Three wrong theories were pursued before the right one, all stated with more
confidence than the evidence supported:

- **Not RAM exhaustion from a larger `.boot0`.** `.boot0` grew 15,798 → 18,529
  bytes and that looked causal, but it was incidental.
- **Not a corrupt SD card.** Every menu file was size- and CRC-verified against
  local builds; all matched.
- **Not a dead battery.** 4.19 V throughout, `lowBatt: false`.
- **Not "too many quests."** Quest data was valid the whole time
  (`QUESTS.STA` exactly 1,104 bytes = 46 × 24).

---

## 3. The recovery, in order

All of this is now in `CompanionApp/scripts/device-recovery.mjs`.

### 3.1 Confirm the REPL is alive

```
node scripts/device-recovery.mjs status
```

Even with the UI dead the REPL usually works — Espruino brings up USB before
running boot code. If `typeof Pip` is `function`, the firmware loaded and the
problem is above the interpreter.

### 3.2 Remove the companion patch

```
node scripts/device-recovery.mjs erase-boot0
```

`.boot0` is a Storage entry that runs *before* stock `FW.JS`; erasing it reverts
to stock. Stock firmware on the SD is never modified by this project.

**Trap:** `.boot0`'s retry loop (`setTimeout(pipCompanionBoot0, 50)`) holds a
function body that lived in the erased entry. After erasing it throws
`Error: Function code is null, not a string` once a second, and stock FW appends
every error to `log.txt` in Storage — **consuming flash continuously**
(39,960 → 19,480 free in about two minutes). The command above clears orphaned
timers and deletes the log; do not skip that.

### 3.3 Reclaim the leaked Storage — the key step

```
node scripts/device-recovery.mjs compact
```

Plain `compact()` does nothing during normal operation. The sequence that works:

1. **`reset()`** — the essential step
2. `Storage.compact()`
3. `E.reboot()` back into firmware

Result was immediate: `freeBytes` 15,384 → 76,568, `trashBytes` 61,184 → 0.

**What actually matters here is `reset()`, not stopping the firmware.** The
script also spams Ctrl-C through the boot window, and an earlier draft of this
document claimed that was the point — that compaction needed `.bootcde` not to
be executing. That is wrong: `typeof Pip` was `function` during the successful
compaction *and* on every later run, so the firmware had reloaded regardless,
and compaction still worked. `reset()` reinitialises the interpreter and drops
its references to flash-resident code; that is what frees compaction to
relocate entries. Bare `compact()` was called three times without `reset()` and
moved nothing (`trashBytes` stayed at 61,184).

The Ctrl-C spam is harmless and left in place, but do not rely on it as the
mechanism.

Note that running `compact` on an already-clean device proves nothing about
whether it works — with `trashBytes: 0` there is nothing to reclaim. Trust the
before/after numbers the command prints.

### 3.4 If the screen stays dark

```
node scripts/device-recovery.mjs wake
```

Two distinct causes were hit:

- **`Pip.sleeping` holding a string.** `FW-decoded.js:700` ignores the power
  button entirely while `typeof Pip.sleeping === 'string'`
  (`'WAKING_UP'` / `'GOING_TO_SLEEP'`). An interrupted sleep transition leaves
  it stuck and the device looks dead — the tab LEDs flash as the button
  registers, then the handler returns.
- **`Pip.wakeUp()` aborting on audio.** It calls `Pip.setVol()` early, which
  throws `Can't change volume when DAC is powered off`, so the wake never
  reaches display bring-up. The workaround stubs `setVol` for the duration.

A wake also surfaced a wedged I2C bus, which the firmware recovered itself:

```
I2C SDA pin (B7) is low - trying to unstick the bus with SCL pulses
I2C bus unstuck after 7 pulses
Failed to write accelerometer register
```

This may well be the original "memory error" — a hung I2C bus can make the
firmware fail in ways that look like memory corruption.

### 3.5 Clean reboot

```
node scripts/device-recovery.mjs reboot
```

Re-runs the firmware's own hardware bring-up (display, audio, accelerometer)
rather than patching subsystems individually over serial. This is what finally
restored normal operation.

---

## 4. USB gotchas

- **A failed enumeration can be fixed by changing USB port.** After a reboot the
  device showed `Unknown USB Device (Device Descriptor Request Failed)`,
  `ConfigManagerErrorCode 43`, and no COM port. Power cycling did not help;
  **moving to a different USB port did**, immediately.
- The device presents as `VID_0483&PID_A4F1` (composite) — note
  `serial-bridge.js` lists `5740` in `KNOWN_PRODUCTS`, so auto-detect may match
  on vendor alone. Pass `--port COM9` if detection fails.
- The port disappears and re-enumerates across a reboot; wait ~3 s before
  reconnecting.
- **Alt-tabbing pauses the game**, so device→game commands queue rather than
  execute. Unrelated to this failure but it wasted time during debugging.

---

## 5. The bug that must be fixed before flashing again

`ensureStorageSpace()` in `CompanionApp/src/flash-fw.js` is unsound:

1. **It never verifies compaction worked.** It calls `compact()` and re-reads
   free space, but compaction silently no-ops while firmware runs, so the retry
   reads the same number and it proceeds anyway.
2. **It infers from `getFree()` instead of reading `getStats()`**, which reports
   `trashBytes` and `trashCount` directly. Leaked space is invisible to the
   current check.
3. **It has no way to actually reclaim trash**, because that requires the
   reset-and-interrupt sequence from 3.3.

Minimum fix:

- Read `Storage.getStats()`; if `trashBytes` is significant, run the
  reset/interrupt/compact sequence rather than a bare `compact()`
- **Verify** `trashBytes` dropped afterwards, and abort with a clear message if not
- Keep deriving the space requirement from the actual `.boot0` size (already
  done — `STORAGE_MIN_FREE_BYTES` 21 KB floor plus `STORAGE_WRITE_SLACK_BYTES`)

Until that lands, **compact manually before each flash**:

```
node scripts/device-recovery.mjs compact
node scripts/device-recovery.mjs status      # confirm trashBytes: 0
npm run flash-fw
```

Each flash costs ~18.5 KB of trash. From a clean 76 KB free that is roughly
three flashes before trouble.

---

## 6. Useful device facts learned

| Thing | Value |
| --- | --- |
| Espruino version | 2v29.361 |
| Storage total | 131,072 bytes |
| `.bootcde` | 54,429 bytes — **this is the firmware**, same size as `FW.JS` on SD. Never erase it; there is no local copy |
| `VERSION` | 5 bytes |
| `.boot0` (companion) | 15,798 stock release → 18,529 with quest sync |
| Battery (healthy) | ~4.19–4.20 V, `Pip.lowBatt === false` |
| SD `JS/` | 27 files |
| Screen lit but blank | backlight on with nothing drawn = half-completed wake |

Handy REPL one-liners:

```js
require('Storage').getStats()          // totalBytes/freeBytes/fileBytes/trashBytes
require('Storage').list()
typeof Pip                             // "function" = firmware loaded
Pip.sleeping                           // string = power button is being ignored
Pip.battLevel
require('fs').readdirSync('JS').length
```

---

## 7. Recovery path if the REPL is ever unreachable

Not needed this time, but the fallback: The Wand Company's official upgrade page
(linked in `README.md`) → Fallout 3 / New Vegas → Advanced options → Factory
Reset. It reflashes through their own recovery path and does not need a working
boot or the REPL. It wipes device-side state; the SD card and this repo are
unaffected.
