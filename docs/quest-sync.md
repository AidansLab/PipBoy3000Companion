# Quest Sync — implementation notes

Reference for the quest sync feature: the device data formats it depends on,
the decisions behind the design, how each layer works, and what is still open.

Written during implementation (September 2026). Everything here was verified
against a real device and a real save unless explicitly marked as an
assumption.

---

## 1. How it fits together

Quest data is a fourth stream alongside inventory, stats and perks, using the
existing transport:

```
Fallout NV ──named pipe──▶ Companion app ──USB serial──▶ Pip-Boy 3000
 (NVSE DLL)   JSON lines     (Node.js)      player.* cmds   (Espruino)
           ◀── "QUEST 0x…" ──            ◀── "PIPSYNC:QUEST:…" ──
```

The single most important property: **no quest text ever crosses the wire.**
The device already ships a complete quest catalog with every name and every
objective string. The companion sends only form IDs, counters and bitmasks.

---

## 2. Device data formats

### 2.1 `DATA/<mode>/QUESTS.DAT` — the quest catalog (read-only, TWC's)

A standard `DataFile` (see `FW/FW-decoded.js:1095`):

```
offset 0   recordCount  u32
offset 4   recordLen    u32
offset 8   ids          u32 × recordCount
offset 8+4*count        records, each exactly recordLen bytes, NUL-padded
```

Each record is JSON: `{"txt":"<quest name>","obj":["<objective>", …]}`.
Only those two keys. No `desc`, no image offsets, and no `QUESTS.IMG` — quest
entries have no artwork.

|                        | Fallout NV        | Fallout 3        |
| ---------------------- | ----------------- | ---------------- |
| File size              | 484,688 bytes     | 77,699 bytes     |
| Quests (`recordCount`) | 168               | 57               |
| `recordLen`            | 2,881             | 1,359            |
| Record keys            | `txt`, `obj`      | `txt`, `obj`     |
| Objectives per quest   | min 1, max 36, mean 7.1 | not measured |
| Largest record JSON    | 2,868 B (13 B spare) | not measured  |

FNV plugin spread (high byte → count): `0x00` FalloutNV 108, `0x05` DeadMoney
12, `0x06` HonestHearts 22, `0x07` OldWorldBlues 18, `0x08` LonesomeRoad 8.
These match `FNV_PIPBOY_PLUGIN_HIGH_BYTE` in `form-id-mapper.js` exactly.

FO3 spread: `0x00` 32, then `0x01`–`0x05` at 4/6/9/3/3 — all five DLCs present.

Quirks worth knowing:

- The ID table is **not sorted**; `DataFile.getId` does a linear `indexOf`.
- Objective text is **plain ASCII throughout** — no glyphs baked in.
- Vanilla uses both `(Optional)` and `[Optional]` prefixes, inconsistently.
- **9 NV quests repeat an objective string within the same quest**, so
  objectives cannot be identified by text. Position is the only usable key.
- Two NV quests exceed 32 objectives: *Render Unto Caesar* (35) and
  *How Little We Know* (36). This is why masks are 64-bit.

### 2.2 `INV/<mode>/QUESTS.STA` — synced quest state (ours)

A flat fixed-width file written by the boot0 quest methods. Deliberately *not*
an `InvFile`: an 8-byte InvFile row has nowhere to put two 64-bit masks.

```
offset  0   id        u32   quest form ID (Pip-Boy ID space)
offset  4   stage     u8    TESQuest::currentStage
offset  5   flags     u8    bit0 running, bit1 complete, bit2 active
offset  6   objCount  u8    objectives in the catalog record
offset  7   pad       u8
offset  8   dispLo    u32   displayed objectives, bits 0–31
offset 12   dispHi    u32   displayed objectives, bits 32–63
offset 16   doneLo    u32   completed objectives, bits 0–31
offset 20   doneHi    u32   completed objectives, bits 32–63
```

24 bytes per row, so 168 quests is ~4 KB — small enough to rewrite whole on
every change, which is what `questWrite()` does.

Masks are split into `lo`/`hi` u32 pairs because **Espruino's bitwise
operators are 32-bit** and BigInt is not worth relying on there. Testing
objective *n*:

```js
n < 32 ? (lo >>> n) & 1 : (hi >>> (n - 32)) & 1
```

Row order is meaningful: running quests first, completed last, matching the
in-game Quests tab. `questOrder()` partitions rather than sorts, so arrival
order is preserved within each group without depending on sort stability.

### 2.3 Font glyphs

Probed directly off the device by rendering into an offscreen `Graphics`
buffer and reading pixels back (`CompanionApp/scripts/glyph-probe.mjs`).

`\x80` and `\x81` are a **matched pair in Monofonto14**, both `stringWidth` 8:

```
0x80 (incomplete)     0x81 (complete)
   ########              ########
   #......#              ########
   #......#              ########
   #......#      vs      ########
   #......#              ########
   #......#              ########
   #......#              ########
   ########              ########
```

Because the widths are identical, swapping one for the other **never reflows
wrapped text** — toggling an objective does not shift the pane.

Other glyphs in that range, should a completed-quest marker ever want one:
`\x8c` is 14 wide (boxed icon), `\x85`/`\x89` are 11 wide outlined, `\x83`–
`\x87` and `\x8a` are 7 wide outlined, `\x88` and `\x8d`–`\x8f` are empty.

**The box glyphs exist only in Monofonto14.** In Monofonto18 the code point is
undefined and the device reports a sentinel `stringWidth` of 255.

---

## 3. Stock behaviour we replaced

Stock `JS/QUESTS.JS` is 516 bytes and has **no player state at all**. It lists
all 168 catalog quests unconditionally, lets you tap one to mark it active, and
draws every objective with the filled marker — which is why every objective
looks complete on an unmodified device. Decompiled:

```js
const e = new DataFile(`DATA/${NV?"NV":"F3"}/QUESTS.DAT`);
let t, r = player.getav('quest');
const n = Pip.createScroller({
  hasEquipStates: !0, itemCount: e.ids.length,
  getItem: t => { const n = e.getId(e.ids[t]); return n.activ = (e.ids[t] === r), n },
  onClick: t => { r = e.ids[t], player.setav('quest', r), n.updateItemCount(e.ids.length),
                  Pip.audioStart('SOUND/FX/PREVNEXT.WAV') },
  render: e => { t && t.remove(),
                 e.obj && e.obj.length > 0 &&
                 (t = Pip.renderTextOverflow(' ' + e.obj.join('\n\n '), 464, 91, 220, 175),
                  t.render()) }
});
```

Note the marker is a literal `\x81` inside those strings — the decompile above
shows it as a space because the byte is non-printing. The real call is
`renderTextOverflow("\x81 " + e.obj.join("\n\n\x81 "), 464, 91, 220, 175)`.

Two useful facts inherited from stock:

- The active quest is stored as actor value **`quest`**, which our renderer
  still reads and `questWrite()` keeps in sync.
- `hasEquipStates: !0` draws the left-column marker: `drawRect` (outlined) for
  the selected row, `fillRect` (solid) when `item.activ` is set
  (`FW-decoded.js:1394`). That is a per-**quest** marker drawn with graphics
  primitives, unrelated to the per-objective glyphs.

### Dimmed rows come free

boot0 already implements dimming for unusable ammo, and it is generic:
set `item.dim = !0` in `getItem`, boot0 prefixes a `\x01` sentinel, and its
`h.drawString` hook recolours that row to palette index 1
(`boot0-decoded.js:1031-1100`, used by `AMMO-decoded.js:33`). Completed quests
use exactly this.

### The scroller passes the whole item to `render`

`e.render(A)` receives the full object returned by `getItem`, not the cached
`{txt, activ, rtxt}` subset used for list drawing (`FW-decoded.js:1408`). That
is why `QUESTS-decoded.js` can attach `item.r` (the state row) in `getItem` and
read it in `render`.

---

## 4. Game side (`GamePlugin/src-nv/main.cpp`)

### What is read

| Data | Source |
| --- | --- |
| Player's quest log | `PlayerCharacter::questObjectiveList` (`0x6BC`), a `tList<BGSQuestObjective>` |
| Active quest | `PlayerCharacter::quest` (`0x6B8`) |
| Quest identity | `BGSQuestObjective::quest` → `TESQuest::refID` |
| Objective index | `BGSQuestObjective::objectiveId` (GECK index: 10, 20, 30 …) |
| Objective text | `BGSQuestObjective::displayText` (`String`) |
| Objective state | `BGSQuestObjective::status` — bit0 displayed, bit1 completed |
| Quest stage | `TESQuest::currentStage` (`0x060`) |
| Quest flags | `TESQuest::flags` (`0x03C`) — bit0 running, bit1 complete |
| All objectives of a quest | `TESQuest::lVarOrObjectives` (`0x04C`) |

### The rank-order mapping (the load-bearing assumption)

The catalog stores objectives **positionally**; the game keys them by
`objectiveId`. The mapping is: sort a quest's objectives by `objectiveId`
ascending, and the *n*th is catalog position *n*.

**Verified 2026-09-24** against a 50-quest save: 49 of 50 quests matched the
catalog position-for-position, 0 order mismatches. (The 50th, *Vance's Gun*, is
absent from the catalog entirely — see below.)

Two filters are essential to that result:

1. **`lVarOrObjectives` holds both objectives and script local variables** —
   the SDK says so outright at `GameForms.h:3773`. Entries are filtered on the
   back-pointer: a real `BGSQuestObjective` has `->quest` pointing at its owning
   quest. Casting the node data straight to `BGSQuestObjective*` follows
   xNVSE's own `Cmd_GetNthQuestObjective`.
2. **Objectives with empty display text must be excluded**, because TWC's
   catalog excludes them. This was found the hard way: before the filter, 3 of
   50 quests mismatched. In *Volare!* and *Vance's Gun* the empty entry sits at
   **rank 0**, so every subsequent bit would have been shifted by one and the
   wrong objectives marked complete — a silent, plausible-looking corruption.

### Other rules

- Quests with an empty `fullName` are skipped (hidden scripted quests; the
  catalog has no record for them either).
- Quests with nothing displayed are skipped.
- Objectives ranking past bit 63 are dropped with a log line rather than
  wrapping onto bit 0.
- **`done &= disp`.** Completed quests come back from the engine with every
  objective flagged done, including ones never displayed (observed live:
  `disp=0x59d` with `done=0xfff`). The device renders only displayed
  objectives, so `done` is kept a strict subset rather than making the renderer
  reconcile a contradiction.
- Quests are keyed and emitted in **form-ID order, not game log order**. The
  log reorders itself as objectives are added, and any reordering makes an
  otherwise-unchanged snapshot differ byte-wise, defeating the pipe thread's
  send-only-on-change check.

### Device → game

The `QUEST` verb in `ExecutePipBoyCommand()` sets `player->quest`, the same
field xNVSE's `Cmd_SetCurrentQuest` writes (`Commands_Quest.cpp:52`). It runs
on the main thread from the command queue like every other device-initiated
action. The next snapshot re-derives the active flag from it, so there is no
separate state to keep in step.

### `PIPBOY_QUEST_DEBUG`

Compile-time flag (default **0**). At 1 it writes `FalloutPipBoyQuests.log`
beside the DLL — one JSON line per quest with rank, `objectiveId` and display
text — for re-checking the rank-order mapping against a catalog dump. It gates
only logging; the snapshot is identical either way, and at 0 it compiles out
(DLL shrinks ~4 KB).

---

## 5. Wire format

One top-level `quests` array in the snapshot, beside `inventory` and `perks`:

```json
"quests": [
  { "formId": "0x00104C1C", "stage": 30, "flags": 5,
    "objCount": 4, "disp": "f", "done": "3" }
]
```

- `flags` — bit0 running, bit1 complete, bit2 active.
- `disp` / `done` — lowercase hex **strings**, bitmasks over catalog positions.
  Strings rather than numbers because they exceed 32 bits and JavaScript
  bitwise operators would silently truncate them.
- `formId` — `0x%08X`, the same shape `inventory[].formId` uses, so load-order
  remapping works unchanged.
- Quests with no displayed objectives are omitted; a fresh character sends `[]`.

The plugin emits **raw game form IDs**; the companion remaps DLC high bytes.
On a real save, 18 of 19 quests that looked "missing" from the catalog were
simply load-order shifts (player DLC at `0x01`–`0x04`, catalog at `0x05`–`0x08`,
low 24 bits identical) — handled by `FormIdMapper` exactly as for items.

---

## 6. Companion app

| Piece | Location |
| --- | --- |
| `_toQuestEntry` / `_questMap` / `_questChanged` | `sync-engine.js` — normalization; masks stay strings end to end |
| `_diffQuests` | `setquest` per change, `removequest` per removal, `setactivequest` when only the active bit moved |
| `_buildSetQuestsBulkCommands` | begin/chunk/end mark-and-sweep, `MAX_QUEST_BATCH` = 12 per chunk |
| `notifyDeviceActiveQuest` | one-shot echo suppression for device-originated picks |
| `PIPSYNC:QUEST:<id>` | `serial-bridge.js` `_scanDeviceEvents` — separate pattern; quests carry no category or count segment |
| `QUEST <formId>` | `app-core.js` device-event handler → pipe |
| `QUESTS.STA` backup | `_backupPresyncData` — a separate command, not a `PRESYNC_CATEGORIES` entry, because stock ships no such file and there is no `INV/DEFAULT` fallback |

### Capability probe

The device methods arrived after the first public firmware, so the app probes
`typeof player.setquestsbulk_begin === 'function'` and omits all quest commands
when unsupported. Calling an undefined function on Espruino throws into the
REPL where boot0's `try/catch` cannot help, so the probe **fails closed**.

There is also a **lazy re-probe**: the first time a snapshot carries quests
while support reads false, the app asks the device once more. See known issues.

---

## 7. Verified behaviour

All confirmed on hardware against a real save (2026-09-24):

- Full sync of 45 quests from a live game
- Completed quests listed below active ones and rendered dimmed
- Only displayed objectives shown, with correct filled/hollow markers
- Completing an objective in game updates the device
- Completing a whole quest updates the device
- Tapping a quest on the Pip-Boy sets the active quest in game
- 64-bit masks round-trip: `"fffffffff"` → `dispLo=0xffffffff dispHi=0xf`
- Quests absent from the catalog are rejected device-side
- A 45-quest bulk in 4 chunks writes all 45 rows

---

## 8. Known issues and open work

### Connect-time capability probe produces nothing

The probe called from `_handleDeviceConnected` emits **no result at all** — not
true, not false, no log line even with the emit made unconditional — while the
identical expression returns `true` from a standalone REPL script and from the
lazy re-probe moments later. Quest sync currently works *because* of the
re-probe, so the original failure is worked around rather than understood.
**First place to look if a user reports quests not syncing.**

### In-game Pip-Boy does not refresh on a device-set active quest

Setting the active quest from the device updates game data, but if the in-game
Pip-Boy is already open the change is not visible until it is closed and
reopened. The quest list lives in `kMenuType_Map` (the DATA tab), and
`RefreshPipBoyUI()` only refreshes Inventory and Stats — when Map is visible it
refreshes the Stats menu for the HP chrome and nothing else.

The xNVSE SDK has **no `MapMenu` class**, so there is no refresh call to make.
The existing refreshes are raw engine addresses (`0x782A90` =
`InventoryMenu::Refresh`, `0x7DF230` = a StatsMenu update). Options, least
risky first: dump the MapMenu tile tree to find the quest list tile and poke a
trait; simulate the click through `Menu::HandleClick`; reverse-engineer a
`MapMenu` refresh address. **Do not** call `0x7DF230` with a MapMenu pointer —
it is StatsMenu-specific and would misinterpret the object layout.

### `objCount` is never sent

`_questEntryLiteral` emits 5 fields; `questRowFromEntry` reads a 6th
(`objCount`), so rows written by the companion store `objCount = 0`. Harmless
today because the renderer takes the objective count from the catalog, but the
two sides disagree and the wire format documents a field that never arrives.

### Cosmetic: selection highlight overlaps the objective pane

The scroller is 220 wide from x=24 (right edge 244) and the objective pane
starts at x=244, so the selected-row box abuts and slightly overlaps the text.
Fix is narrowing the scroller or shifting the pane.

### FO3 not ported

Confirmed a straight port: identical catalog format, same `{txt, obj}` records,
all 5 DLCs present, and the firmware's `NV ? 'NV' : 'F3'` ternary already
handles the path. The plugin work is porting `AppendQuestsJson` and the `QUEST`
verb to `src-fo3/main.cpp` against FOSE's struct layouts, which need offset
verification first.

### FO3 load-order remapping is missing (pre-existing)

`_resolveByLoadOrder` and `_resolveToGameByLoadOrder` return early unless
`gameMode === 'FNV'` (`form-id-mapper.js:216,233`). 25 of FO3's 57 quests are
DLC, so an FO3 load order differing from the Pip-Boy's fixed offsets will
mis-key them. Affects items equally; not introduced by quest sync, but FO3
quest sync would surface it.

### Diagnostic logging still on

`Quest full sync: …` and `Quest support re-probe: …` are useful now but should
drop to a quieter level before release.

---

## 9. Storage budget

`.boot0` grew **15,798 → 18,012 bytes** (+14%) when the quest methods landed.

This broke the pre-flight check: `STORAGE_MIN_FREE_BYTES` was `17 * 1024` =
17,408 — *smaller than the file it was meant to guarantee room for*. On a
device with tight Storage the check would have passed and the write then
failed. `ensureStorageSpace()` now derives the requirement from the actual
`.boot0` size plus `STORAGE_WRITE_SLACK_BYTES` (3 KB), with the constant raised
to 21 KB as a floor.

For reference, a healthy device: 60,736 bytes free, with `.bootcde` (TWC's own
boot code, 54,429 bytes) as the bulk of the usage.

**If `.boot0` grows further, re-check this.** The failure mode is a flash that
aborts mid-write.

---

## 10. Development tooling

All in `CompanionApp/scripts/`, all read-only against the device unless noted:

| Script | Purpose |
| --- | --- |
| `dump-device-file.mjs` | Pull files off the SD card. `--ls DIR`, `--dir DIR`, `--head N`/`--offset N` for partial reads. Menu `.JS` files come back Espruino-pretokenised — decode with `untokenize.js` from [Pip-Boy-CFW-Builder](https://github.com/AidansLab/Pip-Boy-CFW-Builder) |
| `glyph-probe.mjs` | Print font glyphs as ASCII art. `--range LO HI`, `--font NAME`. Renders into an offscreen buffer; never touches the display |
| `check-pipe.mjs` | Validate snapshot JSON straight off the named pipe. Checks the quest contract (`done ⊆ disp`, `disp` within `objCount`) and exits non-zero on problems. Needs the game running, not the device |

Dumped device files live in `FW/stock/` (gitignored — TWC's data).

### Useful REPL snippets

Read current quest state:

```js
player.getquests()
```

Seed test rows without the game (`[id, stage, flags, dispHex, doneHex, objCount]`):

```js
player.setquestsbulk_begin()
player.setquestsbulk_chunk([[1068060,30,5,"f","3",4],[1090068,10,1,"7","1",6]])
player.setquestsbulk_end()
```

Clear it:

```js
player.setquestsbulk_begin(); player.setquestsbulk_end()
```

Check free Storage before a flash:

```js
require('Storage').getFree()
```
