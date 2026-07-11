/*
 * Copyright (c) 2026 Aidan Lee-Calamera (aka Aidan's Lab). 
 * All rights reserved.
 *
 * This source code is licensed under the Creative Commons
 * Attribution-NonCommercial-ShareAlike 4.0 International License (CC BY-NC-SA 4.0).
 *
 * You are free to share and adapt this code under the following conditions:
 *  - Attribution: You must give appropriate credit and provide a link to the license.
 *  - Non-Commercial: You may not use this material for commercial purposes.
 *  - ShareAlike: If you alter, transform, or build upon this work, you must
 *    distribute your contributions under the same CC BY-NC-SA 4.0 license.
 *
 * You may obtain a full copy of the License text in the LICENSE file in the
 * root directory of this project repository or online at:
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 */

/**
 * fo3_engine.h - Fallout 3 engine glue for the Pip-Boy sync plugin (FOSE).
 */

#pragma once

#include <windows.h>
#include <cstring>
#include <cstdio>
#include <utility>

#include "fose/GameAPI.h"
#include "fose/GameData.h"
#include "fose/GameExtraData.h"
#include "fose/GameForms.h"
#include "fose/GameInterface.h"
#include "fose/GameMenus.h"
#include "fose/GameObjects.h"
#include "fose/GameRTTI.h"
#include "fose/GameTiles.h"
#include "fose/GameTypes.h"
#include "fose/CommandTable.h"
#include "fose/PluginAPI.h"
#include "fose/Utilities.h"

#if FALLOUT_VERSION != FALLOUT_VERSION_1_7
#error "This plugin is built for Fallout 3 runtime 1.7.0.3 only (FALLOUT_VERSION_1_7)."
#endif

// ═══════════════════════════════════════════════════════════════════════════════
// VANILLA COMMAND TABLES (addresses from FOSE's CommandTable.cpp, runtime 1.7)
// ═══════════════════════════════════════════════════════════════════════════════

static CommandInfo *const kConsoleCommandsBegin = (CommandInfo *)0x00F52B70;
static CommandInfo *const kConsoleCommandsEnd = (CommandInfo *)0x00F54B50;
static CommandInfo *const kScriptCommandsBegin = (CommandInfo *)0x00F54B78;
static CommandInfo *const kScriptCommandsEnd = (CommandInfo *)0x00F5A438;

static CommandInfo *FindCommandIn(CommandInfo *begin, CommandInfo *end,
                                  const char *name) {
  for (CommandInfo *info = begin; info < end; info++) {
    if (info->longName && _stricmp(info->longName, name) == 0)
      return info;
    if (info->shortName && _stricmp(info->shortName, name) == 0)
      return info;
  }
  return NULL;
}

static CommandInfo *FindConsoleCommand(const char *name) {
  return FindCommandIn(kConsoleCommandsBegin, kConsoleCommandsEnd, name);
}

static CommandInfo *FindScriptCommand(const char *name) {
  return FindCommandIn(kScriptCommandsBegin, kScriptCommandsEnd, name);
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND DISPATCH
// ═══════════════════════════════════════════════════════════════════════════════

struct GameCommandArg {
  enum Kind { kInt, kFloat, kForm } kind;
  SInt32 intVal;
  double floatVal;
  TESForm *formVal;

  static GameCommandArg Int(SInt32 v) {
    GameCommandArg a;
    a.kind = kInt;
    a.intVal = v;
    a.floatVal = 0;
    a.formVal = NULL;
    return a;
  }
  static GameCommandArg Float(double v) {
    GameCommandArg a;
    a.kind = kFloat;
    a.intVal = 0;
    a.floatVal = v;
    a.formVal = NULL;
    return a;
  }
  static GameCommandArg Form(TESForm *f) {
    GameCommandArg a;
    a.kind = kForm;
    a.intVal = 0;
    a.floatVal = 0;
    a.formVal = f;
    return a;
  }
};

// Node layout of tList<T> (GameTypes.h _Node: { item, next }).
struct FO3RawListNode {
  void *item;
  FO3RawListNode *next;
};

static const UInt32 kMaxGameCommandArgs = 4;

// Invoke a vanilla command handler with literal/form arguments. Returns false
// if the command pointer is NULL or has no execute handler. `outResult`
// receives the command's numeric result (may be NULL if not wanted).
static bool CallGameCommand(CommandInfo *info, TESObjectREFR *thisObj,
                            const GameCommandArg *args, UInt32 numArgs,
                            double *outResult = NULL) {
  if (!info || !info->execute)
    return false;
  if (numArgs > kMaxGameCommandArgs)
    return false;
  // Never pass more args than the command declares - optional trailing params
  // are simply omitted, matching what the script compiler emits.
  if (numArgs > info->numParams)
    numArgs = info->numParams;

  // Compiled-arg buffer: UInt16 numArgs, then 'n'+SInt32 / 'z'+double /
  // 'r'+UInt16(1-based ref index).
  UInt8 argBuf[2 + kMaxGameCommandArgs * 9];
  UInt32 off = 0;
  *(UInt16 *)(argBuf + off) = (UInt16)numArgs;
  off += 2;

  // Fake calling script carrying the form refs. Script layout is
  // STATIC_ASSERTed by the SDK (info @0x18, refs tList @0x44, sizeof 0x54).
  UInt8 scriptBlock[sizeof(Script)];
  memset(scriptBlock, 0, sizeof(scriptBlock));
  Script *fakeScript = (Script *)scriptBlock;
  fakeScript->typeID = kFormType_Script;
  fakeScript->refID = 0xFF000FF0; // implausible dynamic id, purely cosmetic

  Script::RefVariable refVars[kMaxGameCommandArgs];
  FO3RawListNode refNodes[kMaxGameCommandArgs];
  memset(refVars, 0, sizeof(refVars));
  memset(refNodes, 0, sizeof(refNodes));
  UInt32 numRefs = 0;

  for (UInt32 i = 0; i < numArgs; i++) {
    switch (args[i].kind) {
    case GameCommandArg::kInt:
      argBuf[off++] = 'n';
      *(SInt32 *)(argBuf + off) = args[i].intVal;
      off += 4;
      break;
    case GameCommandArg::kFloat:
      argBuf[off++] = 'z';
      *(double *)(argBuf + off) = args[i].floatVal;
      off += 8;
      break;
    case GameCommandArg::kForm: {
      if (!args[i].formVal)
        return false;
      refVars[numRefs].form = args[i].formVal;
      refVars[numRefs].varIdx = 0; // 0 = RefVariable::Resolve keeps `form`
      numRefs++;
      argBuf[off++] = 'r';
      *(UInt16 *)(argBuf + off) = (UInt16)numRefs; // ref indices are 1-based
      off += 2;
      break;
    }
    }
  }

  // Chain the ref nodes into the fake script's refs tList (offset 0x44).
  if (numRefs > 0) {
    for (UInt32 i = 0; i < numRefs; i++) {
      refNodes[i].item = &refVars[i];
      refNodes[i].next = (i + 1 < numRefs) ? &refNodes[i + 1] : NULL;
    }
    FO3RawListNode *refsHead =
        (FO3RawListNode *)((UInt8 *)fakeScript + 0x44);
    refsHead->item = refNodes[0].item;
    refsHead->next = refNodes[0].next;
    fakeScript->info.numRefs = numRefs;
  }

  double result = 0.0;
  UInt32 opcodeOffset = 0;
  bool ok = info->execute(info->params, argBuf, thisObj, NULL, fakeScript,
                          NULL, &result, &opcodeOffset);
  if (outResult)
    *outResult = result;
  return ok;
}

// Invoke a command's condition-evaluation handler (no arg buffer - args are
// passed pre-extracted). Used for reads: HasPerk rank, IsSpellTarget, etc.
static bool EvalGameCommand(CommandInfo *info, TESObjectREFR *thisObj,
                            void *arg1, void *arg2, double *outResult) {
  if (!info || !info->eval)
    return false;
  double result = 0.0;
  bool ok = info->eval(thisObj, arg1, arg2, &result);
  if (outResult)
    *outResult = result;
  return ok;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NATIVE ENGINE CALLS (direct address, thiscall - bypasses the CallGameCommand
// simulation above entirely). CallGameCommand's hand-built compiled-argument
// buffer reliably dispatches zero-argument commands but fails 100% of the time
// on any command invoked with an argument (int, float, or form ref alike -
// confirmed via device logs across ToggleFlyCam, SetUFOCamSpeedMult, EquipItem,
// UnequipItem), and FOSE has no RunScriptLine-equivalent to fall back on
// (PluginManager.cpp registers it behind `#if 0 // not yet supported`, in the
// official SDK, not just xFOSE). Real engine addresses called directly, the
// way a native C++ method call would, don't go through that argument-buffer
// path at all, so they sidestep the bug.
//
// kAddr_ActorEquipItemAlt is reverse-engineered data from Command Extender, a
// long-shipped, widely-used FO3 plugin - not a guess. Confirmed targeting the
// same exact build this project does: Command Extender's own
// g_menuVisibility constant (0x011793DB) matches FOSE's FALLOUT_VERSION_1_7
// address exactly, and its loader hashes explicitly name "1.7.0.3" variants.
// kAddr_ActorUnequipItem comes from xNVSE GameObjects.cpp's FOSE
// cross-references on s_Actor_EquipItem/s_Actor_UnequipItem (see main.cpp).
//
// Diagnostic caveat: a `true` return from CallGameCommand means only that the
// handler ran - vanilla Cmd_*_Execute handlers return true even when their
// internal ExtractArgs fails (verified in Command Extender's sources), so an
// argument-form dispatch can log "ok" while silently doing nothing. Only the
// zero-argument dispatch class is trusted; everything needing arguments goes
// through direct native-address calls.
// ═══════════════════════════════════════════════════════════════════════════════

// Invokes _addr as if it were a member function of *_this with the MSVC
// thiscall convention (this in ECX), for an arbitrary address we only know by
// its numeric value. Standard technique for calling reverse-engineered native
// engine functions.
template <typename T_Ret = void, typename... Args>
__forceinline T_Ret ThisCall(UInt32 _addr, void *_this, Args... args) {
  class T {};
  union {
    UInt32 addr;
    T_Ret (T::*func)(Args...);
  } u = {_addr};
  return ((T *)_this->*u.func)(std::forward<Args>(args)...);
}

// Same idea as ThisCall, for free functions with no `this` (plain __cdecl).
template <typename T_Ret = void, typename... Args>
__forceinline T_Ret CdeclCall(UInt32 _addr, Args... args) {
  return ((T_Ret(__cdecl *)(Args...))_addr)(std::forward<Args>(args)...);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAYER CONTROL LOCK (direct flag writes - the AltEx-style "don't clobber
// other mods" guarantee: only bits *we* turned on get turned back off)
// ═══════════════════════════════════════════════════════════════════════════════

static const UInt32 kSyncControlFlagsAll =
    PlayerCharacter::kControlFlag_Movement |
    PlayerCharacter::kControlFlag_Look |
    PlayerCharacter::kControlFlag_Pipboy |
    PlayerCharacter::kControlFlag_Fight |
    PlayerCharacter::kControlFlag_POVSwitch |
    PlayerCharacter::kControlFlag_RolloverText |
    PlayerCharacter::kControlFlag_Sneak;

static UInt32 g_controlFlagsWeSet = 0;

static void FO3DisablePlayerControls(PlayerCharacter *player) {
  if (!player)
    return;
  // Remember exactly which bits were clear before we set them.
  g_controlFlagsWeSet = kSyncControlFlagsAll & ~player->disabledControlFlags;
  player->disabledControlFlags |= kSyncControlFlagsAll;
}

static void FO3EnablePlayerControls(PlayerCharacter *player) {
  if (!player)
    return;
  player->disabledControlFlags &= ~g_controlFlagsWeSet;
  g_controlFlagsWeSet = 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN-THREAD PUMP (WM_TIMER on the game's main window)
// ═══════════════════════════════════════════════════════════════════════════════

typedef void (*FO3PumpCallback)();

static HWND g_gameWindow = NULL;
static UINT_PTR g_pumpTimerId = 0;
static FO3PumpCallback g_pumpCallback = NULL;
static volatile LONG g_pumpTickCount = 0;

static void CALLBACK FO3PumpTimerProc(HWND, UINT, UINT_PTR, DWORD) {
  InterlockedIncrement(&g_pumpTickCount);
  if (g_pumpCallback)
    g_pumpCallback();
}

static BOOL CALLBACK FO3FindGameWindowProc(HWND hwnd, LPARAM lparam) {
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  if (pid != GetCurrentProcessId())
    return TRUE;
  if (!IsWindowVisible(hwnd))
    return TRUE;
  if (GetWindow(hwnd, GW_OWNER) != NULL)
    return TRUE;
  char title[64] = {};
  GetWindowTextA(hwnd, title, sizeof(title) - 1);
  if (!title[0])
    return TRUE;
  *(HWND *)lparam = hwnd;
  return FALSE;
}

// Try to attach the pump. Safe to call repeatedly (e.g. from the pipe thread)
// until it succeeds - the game window doesn't exist during plugin load.
static bool FO3TryInstallMainThreadPump(FO3PumpCallback cb, UINT intervalMs) {
  if (g_pumpTimerId)
    return true;
  HWND hwnd = NULL;
  EnumWindows(FO3FindGameWindowProc, (LPARAM)&hwnd);
  if (!hwnd)
    return false;
  g_pumpCallback = cb;
  g_gameWindow = hwnd;
  // Timer messages are delivered to (and the TIMERPROC runs on) the thread
  // that owns the window - the game's main thread - regardless of which
  // thread calls SetTimer.
  g_pumpTimerId = SetTimer(hwnd, 0x50495042 /* 'PIPB' */, intervalMs,
                           FO3PumpTimerProc);
  return g_pumpTimerId != 0;
}

static LONG FO3PumpTicks() { return g_pumpTickCount; }

// ═══════════════════════════════════════════════════════════════════════════════
// RUNTIME FORM DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════════

// Locate the Pip-Boy light SpellItem by scanning the spell list for a full
// name containing both "pip" and "light" (case-insensitive). Avoids
// hardcoding a form id the SDK doesn't publish.
static SpellItem *FO3FindPipBoyLightSpell() {
  DataHandler *dh = DataHandler::Get();
  if (!dh)
    return NULL;
  for (tList<SpellItem>::Iterator it = dh->spellItemList.Begin(); !it.End();
       ++it) {
    SpellItem *spell = it.Get();
    if (!spell)
      continue;
    const char *name = GetFullName(spell);
    if (!name || !name[0])
      continue;
    char lower[128] = {};
    for (UInt32 i = 0; name[i] && i < sizeof(lower) - 1; i++)
      lower[i] = (char)tolower((unsigned char)name[i]);
    if (strstr(lower, "pip") && strstr(lower, "light"))
      return spell;
  }
  return NULL;
}
