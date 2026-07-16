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
 * main.cpp - FOSE Plugin for Fallout 3 Pip-Boy 3000 Sync
 *
 * This plugin hooks into Fallout 3 via FOSE to read the player's
 * stats and inventory, then writes JSON snapshots to a Windows Named Pipe
 * for the companion app to consume.
 */

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdarg>
#include <iomanip>
#include <map>
#include <mutex>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <vector>
#include <windows.h>

#include "fo3_engine.h"

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

#define PLUGIN_NAME "FalloutPipBoySync"
#define PLUGIN_VERSION 32

// Write FalloutPipBoySync.log beside this DLL (Data/FOSE/Plugins/).
#ifndef PIPBOY_VERBOSE_LOG
#define PIPBOY_VERBOSE_LOG 0
#endif

// How often to snapshot player state (in milliseconds)
#define SNAPSHOT_INTERVAL_MS 100

// How often the pipe thread checks whether the snapshot changed (in
// milliseconds). Snapshots are only written to the pipe when they differ from
// the last one sent, so a short poll here costs almost nothing but keeps
// end-to-end latency low.
#define PIPE_POLL_INTERVAL_MS 50

// Main-thread pump cadence (WM_TIMER; replaces NVSE's per-frame
// kMessage_MainGameLoop - see fo3_engine.h).
#define PUMP_INTERVAL_MS 50

// Named pipe path
#define PIPE_NAME "\\\\.\\pipe\\FalloutPipBoySync"

// ═══════════════════════════════════════════════════════════════════════════════
// ACTOR VALUES (Fallout 3 - same numbering family as FNV, FNV later renamed
// SmallGuns>Guns and Throwing>Survival, so 41 is Small Guns here and 44 is
// the unused Throwing skill, which Fallout 3 does not expose)
// ═══════════════════════════════════════════════════════════════════════════════
enum ActorValueCode {
  kAV_Strength = 5,
  kAV_Perception = 6,
  kAV_Endurance = 7,
  kAV_Charisma = 8,
  kAV_Intelligence = 9,
  kAV_Agility = 10,
  kAV_Luck = 11,
  kAV_ActionPoints = 12,
  kAV_CarryWeight = 13,
  kAV_Health = 16,
  kAV_MeleeDamage = 17,
  kAV_Karma = 23,
  kAV_InventoryWeight = 46,

  kAV_XP = 24,

  kAV_PerceptionCondition = 25,
  kAV_EnduranceCondition = 26,
  kAV_LeftAttackCondition = 27,
  kAV_RightAttackCondition = 28,
  kAV_LeftMobilityCondition = 29,
  kAV_RightMobilityCondition = 30,

  kAV_Barter = 32,
  kAV_BigGuns = 33,
  kAV_EnergyWeapons = 34,
  kAV_Explosives = 35,
  kAV_Lockpick = 36,
  kAV_Medicine = 37,
  kAV_MeleeWeapons = 38,
  kAV_Repair = 39,
  kAV_Science = 40,
  kAV_SmallGuns = 41,
  kAV_Sneak = 42,
  kAV_Speech = 43,
  kAV_Unarmed = 45,
};

// Convenience wrappers - ActorValueOwner's vtable slots match the NV SDK's
// (Fn_01 = base value, Fn_03 = current value, Fn_0A = level).
static float AVBase(PlayerCharacter *player, UInt32 av) {
  return player->avOwner.Fn_01((void *)av);
}
static float AVCurrent(PlayerCharacter *player, UInt32 av) {
  return player->avOwner.Fn_03((void *)av);
}
static UInt16 AVLevel(PlayerCharacter *player) {
  return player->avOwner.Fn_0A();
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════════════════════════

static HMODULE g_hModule = NULL;
static const FOSEInterface *g_fose = NULL;
static FOSEMessagingInterface *g_msgIntfc = NULL;
static PluginHandle g_pluginHandle = 0;

static std::atomic<bool> g_running(true);
static std::mutex g_snapshotMutex;
static std::string g_latestSnapshot;
static std::thread g_pipeThread;
static bool g_gameLoaded = false;
static DWORD g_lastSnapshotTime = 0;
static std::atomic<bool> g_saveLoadPending(false);
static std::atomic<bool> g_mainMenuPending(false);

// Set by the companion app (SYNC_LOCK/SYNC_UNLOCK) while it performs the
// initial Pip-Boy sync. Disables player controls, freezes the game world, and
// shows a syncing pop up so nothing can move or act mid-sync.
// Reconciled on the main thread in OnMainGameLoop, auto-cleared if the
// companion disconnects so the player is never left stuck.
static std::atomic<bool> g_syncLockRequested(false);

// Commands received from the companion app (Pip-Boy initiated actions).
// Queued by the pipe thread, executed on the main thread in OnMainGameLoop -
// calling game functions from a background thread is unsafe.
static std::mutex g_commandMutex;
static std::vector<std::string> g_commandQueue;

// Vanilla command handlers, located by name at load.
static CommandInfo *g_cmdCIOS = NULL;
static CommandInfo *g_cmdDispel = NULL;
static CommandInfo *g_cmdHasPerk = NULL;

// ═══════════════════════════════════════════════════════════════════════════════
// VERBOSE LOGGING
// ═══════════════════════════════════════════════════════════════════════════════

static std::mutex g_logMutex;
static FILE *g_logFile = nullptr;
static UInt32 g_lastLoggedMenuMask = 0xFFFFFFFF;
static DWORD g_lastSnapshotSkipLogTime = 0;

static void PipBoyLogInit() {
#if PIPBOY_VERBOSE_LOG
  if (g_logFile)
    return;
  char path[MAX_PATH] = {};
  if (!g_hModule || !GetModuleFileNameA(g_hModule, path, MAX_PATH))
    return;
  char *slash = strrchr(path, '\\');
  if (slash)
    *(slash + 1) = '\0';
  strcat_s(path, "FalloutPipBoySync.log");
  g_logFile = fopen(path, "a");
  if (!g_logFile)
    return;
  SYSTEMTIME st;
  GetLocalTime(&st);
  fprintf(
      g_logFile,
      "\n=== FalloutPipBoySync (FO3) v%d started %04d-%02d-%02d %02d:%02d:%02d ===\n",
      PLUGIN_VERSION, st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute,
      st.wSecond);
  fflush(g_logFile);
#endif
}

static void PipBoyLog(const char *level, const char *fmt, ...) {
#if PIPBOY_VERBOSE_LOG
  {
    std::lock_guard<std::mutex> lock(g_logMutex);
    if (!g_logFile)
      PipBoyLogInit();
    if (!g_logFile)
      return;
    DWORD ms = GetTickCount();
    fprintf(g_logFile, "[%lu.%03lu][%s] ", ms / 1000, ms % 1000, level);
    va_list args;
    va_start(args, fmt);
    vfprintf(g_logFile, fmt, args);
    va_end(args);
    fputc('\n', g_logFile);
    fflush(g_logFile);
  }
#endif
  (void)level;
  (void)fmt;
}

static void PipBoyLogSnapshotOut(const std::string &snapshot) {
#if PIPBOY_VERBOSE_LOG
  PipBoyLog("PIPE-OUT", "snapshot %zu bytes", snapshot.size());
  if (snapshot.empty())
    return;
  const size_t kChunk = 2000;
  for (size_t off = 0; off < snapshot.size(); off += kChunk) {
    const size_t len = (std::min)(kChunk, snapshot.size() - off);
    std::string chunk = snapshot.substr(off, len);
    PipBoyLog("PIPE-OUT", "snapshot[%04zu]: %s", off, chunk.c_str());
  }
#endif
}

// ═══════════════════════════════════════════════════════════════════════════════
// MENU / MOD COMPATIBILITY HELPERS
// Same gating as the NV plugin. Fallout 3 has no ItemMod menu (weapon mods
// are an FNV feature), so the repair/mod check reduces to the Repair menu.
// ═══════════════════════════════════════════════════════════════════════════════

static UInt32 GetOpenMenuMask() {
  UInt32 mask = 0;
  if (InterfaceManager::IsMenuVisible(kMenuType_Message))
    mask |= 1u << 0;
  if (InterfaceManager::IsMenuVisible(kMenuType_Inventory))
    mask |= 1u << 1;
  if (InterfaceManager::IsMenuVisible(kMenuType_Stats))
    mask |= 1u << 2;
  if (InterfaceManager::IsMenuVisible(kMenuType_Map))
    mask |= 1u << 3;
  if (InterfaceManager::IsMenuVisible(kMenuType_Container))
    mask |= 1u << 4;
  if (InterfaceManager::IsMenuVisible(kMenuType_Barter))
    mask |= 1u << 5;
  if (InterfaceManager::IsMenuVisible(kMenuType_Repair))
    mask |= 1u << 6;
  if (InterfaceManager::IsMenuVisible(kMenuType_SleepWait))
    mask |= 1u << 7;
  if (InterfaceManager::IsMenuVisible(kMenuType_LevelUp))
    mask |= 1u << 8;
  if (InterfaceManager::IsMenuVisible(kMenuType_Loading))
    mask |= 1u << 9;
  return mask;
}

static void LogMenuMaskIfChanged() {
  UInt32 mask = GetOpenMenuMask();
  if (mask == g_lastLoggedMenuMask)
    return;
  PipBoyLog("MENU",
            "mask=0x%03X msg=%d pipinv=%d stats=%d map=%d container=%d "
            "barter=%d repair=%d sleep=%d levelup=%d loading=%d",
            mask, !!(mask & (1u << 0)), !!(mask & (1u << 1)),
            !!(mask & (1u << 2)), !!(mask & (1u << 3)), !!(mask & (1u << 4)),
            !!(mask & (1u << 5)), !!(mask & (1u << 6)), !!(mask & (1u << 7)),
            !!(mask & (1u << 8)), !!(mask & (1u << 9)));
  g_lastLoggedMenuMask = mask;
}

static bool ShouldSkipSnapshotDuringModMenu() {
  return InterfaceManager::IsMenuVisible(kMenuType_Barter) ||
         InterfaceManager::IsMenuVisible(kMenuType_Repair) ||
         InterfaceManager::IsMenuVisible(kMenuType_Message) ||
         InterfaceManager::IsMenuVisible(kMenuType_SleepWait) ||
         InterfaceManager::IsMenuVisible(kMenuType_LevelUp);
}

static bool IsPipBoyTabMenuOpen() {
  return InterfaceManager::IsMenuVisible(kMenuType_Inventory) ||
         InterfaceManager::IsMenuVisible(kMenuType_Stats) ||
         InterfaceManager::IsMenuVisible(kMenuType_Map);
}

static bool IsPipBoyRepairOrModMenuOpen() {
  return InterfaceManager::IsMenuVisible(kMenuType_Repair);
}

// Pip-Boy STATS/ITEMS/DATA tabs (used for snapshot gating and session start).
static bool IsPipBoyMenuOpen() { return IsPipBoyTabMenuOpen(); }

// ═══════════════════════════════════════════════════════════════════════════════
// ITEM CONDITION HELPERS (identical logic to the NV plugin - the container
// data structures are the same in FOSE's SDK)
// ═══════════════════════════════════════════════════════════════════════════════

// ExtraHealth::health is current hit points; TESHealthForm::health is the
// maximum. In-game condition is current / max * 100.
static int GetInventoryItemConditionPct(TESForm *baseForm,
                                        ExtraDataList *extraDataList) {
  TESHealthForm *healthForm = DYNAMIC_CAST(baseForm, TESForm, TESHealthForm);
  if (!healthForm)
    return 100;

  const float maxHealth = (float)healthForm->health;
  if (maxHealth <= 0.0f)
    return 100;

  float currentHealth = maxHealth;
  if (extraDataList) {
    ExtraHealth *xHealth =
        (ExtraHealth *)extraDataList->GetByType(kExtraData_Health);
    if (xHealth)
      currentHealth = xHealth->health;
  }

  if (currentHealth <= 0.0f)
    return 0;
  if (currentHealth >= maxHealth)
    return 100;

  return (int)(currentHealth / maxHealth * 100.0f + 0.5f);
}

// Condition (0–100) of the actually-worn instance of `baseForm`. A form's
// container entry can list several stacks (worn + bag) in any order, so we must
// find the ExtraDataList carrying the worn flag rather than reading the first
// one. A worn pristine item has no ExtraHealth, so it correctly reports 100.
static int GetWornConditionPct(PlayerCharacter *player, TESForm *baseForm) {
  if (!player || !baseForm)
    return 100;
  ExtraContainerChanges *cc =
      (ExtraContainerChanges *)player->extraDataList.GetByType(
          kExtraData_ContainerChanges);
  if (!cc || !cc->data || !cc->data->objList)
    return 100;
  for (tList<ExtraContainerChanges::EntryData>::Iterator it =
           cc->data->objList->Begin();
       !it.End(); ++it) {
    ExtraContainerChanges::EntryData *entry = it.Get();
    if (!entry || !entry->type || entry->type->refID != baseForm->refID)
      continue;
    if (entry->extendData) {
      for (tList<ExtraDataList>::Iterator eit = entry->extendData->Begin();
           !eit.End(); ++eit) {
        ExtraDataList *xdl = eit.Get();
        if (xdl && (xdl->GetByType(kExtraData_Worn) ||
                    xdl->GetByType(kExtraData_WornLeft)))
          return GetInventoryItemConditionPct(baseForm, xdl);
      }
    }
    break; // found the form's entry; no worn list = pristine worn item (100)
  }
  return 100;
}

// The equipped weapon: the WEAP container entry carrying a Worn extra list.
// (FOSE's PlayerCharacter has no GetEquippedWeapon helper, this walk reads
// the same data the NV helper does.)
static TESObjectWEAP *GetEquippedWeaponFO3(PlayerCharacter *player) {
  if (!player)
    return NULL;
  ExtraContainerChanges *cc =
      (ExtraContainerChanges *)player->extraDataList.GetByType(
          kExtraData_ContainerChanges);
  if (!cc || !cc->data || !cc->data->objList)
    return NULL;
  for (tList<ExtraContainerChanges::EntryData>::Iterator it =
           cc->data->objList->Begin();
       !it.End(); ++it) {
    ExtraContainerChanges::EntryData *entry = it.Get();
    if (!entry || !entry->type || entry->type->typeID != kFormType_Weapon)
      continue;
    if (!entry->extendData)
      continue;
    for (tList<ExtraDataList>::Iterator eit = entry->extendData->Begin();
         !eit.End(); ++eit) {
      ExtraDataList *xdl = eit.Get();
      if (xdl && xdl->GetByType(kExtraData_Worn))
        return (TESObjectWEAP *)entry->type;
    }
  }
  return NULL;
}

// Thrown weapons (grenades, mines) equip as a whole stack, so the Pip-Boy
// must not split one copy off the equipped row. Defined below, forward-declared
// here for the snapshot's equipped-weapon reporting.
static bool IsThrownWeapon(TESForm *form);

// Displayed weapon DAM, mirroring the game: Dam = base x Skill x Cond, with a
// post-multiply bonus for melee (MeleeDamage AV) and unarmed
// ((Unarmed/20)+0.5). Identical formula to the NV plugin.
//
// FO3 CAVEAT: FOSE's SDK does not map BGSProjectile->explosion or
// BGSExplosion->damage for Fallout 3, so the explosion-damage probe the NV
// plugin uses for grenades/launchers is unavailable. Weapons whose WEAP
// record carries no direct damage (thrown explosives) return 0 here, the
// snapshot omits `dam`, and the Pip-Boy keeps its static DAT damage value -
// which the Pip-Boy's F3 data files already carry.
static int ComputeWeaponDisplayDamage(PlayerCharacter *player,
                                      TESObjectWEAP *weap, int conditionPct) {
  if (!weap)
    return 0;

  // FO3 eWeaponType values:
  //   0 HandToHandMelee, 1 OneHandMelee, 2 TwoHandMelee,
  //   3 OneHandPistol, 4 OneHandPistolEnergy, 5 TwoHandRifle,
  //   6 TwoHandAutomatic, 7 TwoHandRifleEnergy, 8 TwoHandHandle,
  //   9 TwoHandLauncher, 10 OneHandGrenade, 11 OneHandMine,
  //   12 OneHandLunchboxMine. (No FNV type 13 OneHandThrown.)
  const UInt8 wtype = weap->eWeaponType;

  // attackDmg.damage stores the TOTAL damage across all projectiles.
  float base = (float)weap->attackDmg.damage;
  if (base <= 0.0f)
    return 0;

  float skill = 100.0f;
  if (player)
    skill = AVCurrent(player, weap->weaponSkill);
  if (skill < 0.0f)
    skill = 0.0f;
  else if (skill > 100.0f)
    skill = 100.0f;
  float skillMult = 0.5f + 0.005f * skill;

  float cond = (float)conditionPct / 100.0f;
  if (cond < 0.0f)
    cond = 0.0f;
  else if (cond > 1.0f)
    cond = 1.0f;
  float condMult = 0.5f + (cond / 0.75f) * 0.5f;
  if (condMult > 1.0f)
    condMult = 1.0f;

  const float core = base * skillMult * condMult;

  // Melee: engine rounds the skill x condition product, then adds the Melee
  // Damage bonus as a truncated integer.
  if (player && (wtype == 1 || wtype == 2)) {
    float bonus = AVCurrent(player, kAV_MeleeDamage);
    if (bonus < 0.0f)
      bonus = 0.0f;
    int out = (int)roundf(core) + (int)bonus;
    return out < 0 ? 0 : out;
  }

  float dam = core;
  if (player && wtype == 0) {
    float unarmed = AVCurrent(player, kAV_Unarmed);
    if (unarmed < 0.0f)
      unarmed = 0.0f;
    dam += unarmed / 20.0f + 0.5f;
  }

  int out = (int)(dam + 0.5f);
  return out < 0 ? 0 : out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// JSON HELPER (Minimal - no external dependencies, identical to NV plugin)
// ═══════════════════════════════════════════════════════════════════════════════

class JsonBuilder {
public:
  void beginObject() {
    ss << "{";
    firstStack.push_back(true);
  }
  void endObject() {
    ss << "}";
    firstStack.pop_back();
  }
  void beginArray() {
    ss << "[";
    firstStack.push_back(true);
  }
  void endArray() {
    ss << "]";
    firstStack.pop_back();
  }

  void key(const std::string &k) {
    comma();
    ss << "\"" << escape(k) << "\":";
  }

  void valueStr(const std::string &v) { ss << "\"" << escape(v) << "\""; }
  void valueInt(int v) { ss << v; }
  void valueFloat(float v) { ss << std::fixed << std::setprecision(2) << v; }
  void valueBool(bool v) { ss << (v ? "true" : "false"); }

  void keyStr(const std::string &k, const std::string &v) {
    key(k);
    valueStr(v);
  }
  void keyInt(const std::string &k, int v) {
    key(k);
    valueInt(v);
  }
  void keyFloat(const std::string &k, float v) {
    key(k);
    valueFloat(v);
  }
  void keyBool(const std::string &k, bool v) {
    key(k);
    valueBool(v);
  }

  // For array elements (no key, just comma-separated values)
  void arrayElement() { comma(); }
  void arrayElementInt(int v) {
    comma();
    valueInt(v);
  }

  std::string str() const { return ss.str(); }

private:
  std::stringstream ss;
  std::vector<bool> firstStack;

  void comma() {
    if (!firstStack.empty()) {
      if (firstStack.back()) {
        firstStack.back() = false;
      } else {
        ss << ",";
      }
    }
  }

  static std::string escape(const std::string &s) {
    std::string result;
    for (char c : s) {
      switch (c) {
      case '"':
        result += "\\\"";
        break;
      case '\\':
        result += "\\\\";
        break;
      case '\n':
        result += "\\n";
        break;
      case '\r':
        result += "\\r";
        break;
      case '\t':
        result += "\\t";
        break;
      default:
        result += c;
        break;
      }
    }
    return result;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY: Format a form ID as hex string (e.g., "0x0001519E")
// ═══════════════════════════════════════════════════════════════════════════════

static std::string FormatFormId(UInt32 formId) {
  std::stringstream ss;
  ss << "0x" << std::hex << std::setfill('0') << std::setw(8) << formId;
  return ss.str();
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY: Get the record type string for a TESForm (FO3 form-type enum)
// ═══════════════════════════════════════════════════════════════════════════════

static const char *GetFormTypeString(UInt8 typeID) {
  switch (typeID) {
  case kFormType_Weapon:
    return "WEAP";
  case kFormType_Armor:
    return "ARMO";
  case kFormType_Ammo:
    return "AMMO";
  case kFormType_AlchemyItem:
    return "AID";
  case kFormType_Misc:
    return "MISC";
  case kFormType_Book:
    return "BOOK";
  case kFormType_Key:
    return "KEYM";
  case kFormType_Note:
    return "NOTE";
  default:
    return "MISC";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIP-BOY LIGHT (in-game flashlight)
// Fallout 3 implements the held-TAB light as a self-targeted Actor Effect,
// like FNV. The spell form is located at runtime by name (fo3_engine.h) -
// no hardcoded form id. State is read through the game's own IsSpellTarget
// condition handler, toggling goes through CastImmediateOnSelf/Dispel.
// ═══════════════════════════════════════════════════════════════════════════════

static SpellItem *g_pipBoyLightSpell = NULL;
static bool g_pipBoyLightSearched = false;

// The engine's own cached PipBoyLight spell pointer, FO3's equivalent of
// NV's 0x11C358C global. Found by scanning Fallout3.exe for `push 0x147`
// (the spell's FormID): the bootstrap at 0x408A2C looks the form up and
// stores it here (creating a default SPEL if the lookup fails, so after
// startup this global is always populated), and the vanilla TAB-hold
// flashlight handler at 0x7748C0 reads the spell back from this exact
// global for its own state check / cast / remove calls.
static SpellItem **const g_enginePipBoyLightSpell = (SpellItem **)0x106C86C;

static SpellItem *GetPipBoyLightSpell() {
  if (!g_pipBoyLightSearched && g_gameLoaded) {
    g_pipBoyLightSearched = true;
    // Prefer the engine's own cached pointer - it's the exact object the
    // vanilla TAB-hold toggle uses, so state checks/removes against it can
    // never miss due to a mod replacing the base form. The FormID lookup
    // stays as a fallback for the (unexpected) case of the global being
    // empty.
    g_pipBoyLightSpell = *g_enginePipBoyLightSpell;
    if (!g_pipBoyLightSpell)
      g_pipBoyLightSpell = FO3FindPipBoyLightSpell();
    if (g_pipBoyLightSpell)
      PipBoyLog("TORCH", "Pip-Boy light spell found: %08X (%s)",
                g_pipBoyLightSpell->refID, GetFullName(g_pipBoyLightSpell));
    else
      PipBoyLog("TORCH",
                "Pip-Boy light spell NOT found - torch sync disabled");
  }
  return g_pipBoyLightSpell;
}

// MagicTarget::HasMagicItemEffect(MagicItem*, UInt32) - returns bool (al).
// This is the EXACT state check the vanilla TAB-hold flashlight handler
// (0x7748C0) performs before deciding to toggle: `push 1; push magicItem;
// ecx = &actor->magicTarget; call 0x6B6D00`.
static const UInt32 kAddr_MagicTargetHasMagicItemEffect = 0x6B6D00;

static bool IsPipBoyLightOn(PlayerCharacter *player) {
  if (!player)
    return false;
  SpellItem *pipBoyLight = GetPipBoyLightSpell();
  if (!pipBoyLight)
    return false;
  return ThisCall<bool>(kAddr_MagicTargetHasMagicItemEffect,
                        &player->magicTarget, &pipBoyLight->magicItem,
                        (UInt32)1);
}

// Companion torch intent (physical Pip-Boy ITEMS shortcut).
static bool g_companionTorchDesired = false;
static bool g_pipBoyChromeSession = false;
static bool g_pipBoyTorchUiWasActive = false;
static bool g_lastObservedTorchOn = false;
// True while a companion-initiated toggle is still propagating (mirrors the
// NV plugin's g_companionTorchPending). The cast in EngineCastPipBoyLightOnSelf
// applies through the same queued-effect mechanism NV uses, and the Pip-Boy
// menu pauses gameplay, so IsPipBoyLightOn() can keep reading the stale
// pre-toggle value for the menu's entire lifetime. Without this guard, the
// main-loop observer below mistakes that stale read for a genuine in-game
// toggle and overwrites g_companionTorchDesired right back to the old value.
static bool g_companionTorchPending = false;

// True while the Pip-Boy 3D chrome is visible (tabs or Repair from Pip-Boy).
static bool IsPipBoyTorchUiActive() {
  if (IsPipBoyTabMenuOpen())
    return true;
  if (IsPipBoyRepairOrModMenuOpen() && g_pipBoyChromeSession)
    return true;
  return false;
}

// MagicCaster vtable slot 0: cast-on-self, args (SpellItem*, 0). This is
// verbatim what the vanilla TAB-hold flashlight handler's ON branch does
// (0x7749F3 in Fallout3.exe 1.7.0.3: loads the spell from the engine's own
// 0x106C86C global, `ecx = &player->magicCaster`, calls vtbl[0] with the
// SpellItem* - the full form here, unlike the check/remove calls which take
// the MagicItem sub-object - plus a 0).
static void EngineCastPipBoyLightOnSelf(PlayerCharacter *player,
                                         SpellItem *pipBoyLight) {
  void *magicCaster = &player->magicCaster;
  void **vtbl = *(void ***)magicCaster;
  using CastFn = void(__thiscall *)(void *, SpellItem *, UInt32);
  ((CastFn)vtbl[0])(magicCaster, pipBoyLight, 0);
}

// MagicTarget::RemoveEffect - thiscall + 3 stack args (ret 0xC), the same
// routine both the vanilla Dispel handler (0x5234A0) and the vanilla
// TAB-hold flashlight handler's OFF branch (0x774975..0x77498D) call on
// &actor->magicTarget.
static const UInt32 kAddr_MagicTargetRemoveEffect = 0x6B76E0;
static void EngineRemovePipBoyLightFromSelf(PlayerCharacter *player,
                                             SpellItem *pipBoyLight) {
  ThisCall<void>(kAddr_MagicTargetRemoveEffect, &player->magicTarget,
                 &pipBoyLight->magicItem, (UInt32)0, (UInt32)0);
}

// suppressPipBoyGlow is accepted for interface parity with the NV plugin;
// FO3 has no separate FOPipboyManager glow-suppression path to skip.
static void SetPipBoyLight(PlayerCharacter *player, bool wantOn,
                           bool suppressPipBoyGlow = false) {
  (void)suppressPipBoyGlow;
  if (!player)
    return;

  SpellItem *pipBoyLight = GetPipBoyLightSpell();
  if (!pipBoyLight)
    return;

  if (IsPipBoyLightOn(player) == wantOn)
    return;

  // Committed to changing the state - see g_companionTorchPending's comment.
  g_companionTorchPending = true;

  if (wantOn) {
    EngineCastPipBoyLightOnSelf(player, pipBoyLight);
  } else {
    EngineRemovePipBoyLightFromSelf(player, pipBoyLight);
  }
  bool nowOn = IsPipBoyLightOn(player);
  PipBoyLog("TORCH", "%s via native call (now %s)", wantOn ? "ON" : "OFF",
            nowOn ? "ON" : "OFF");

  if (nowOn != wantOn) {
    // Native call didn't take for this direction - fall back to the (likely
    // broken for argument-taking commands, but cheap to try) script path.
    GameCommandArg arg = GameCommandArg::Form(pipBoyLight);
    bool ok = wantOn ? CallGameCommand(g_cmdCIOS, player, &arg, 1)
                     : CallGameCommand(g_cmdDispel, player, &arg, 1);
    PipBoyLog("TORCH", "native call did not reach %s, fallback via %s (%s, now %s)",
              wantOn ? "ON" : "OFF", wantOn ? "CIOS" : "Dispel",
              ok ? "ok" : "FAILED", IsPipBoyLightOn(player) ? "ON" : "OFF");
  }
}

// After closing the in-game Pip-Boy, re-assert companion intent so the world
// light matches the device (mirrors the NV plugin's reconcile step).
static void ReconcileCompanionTorchAfterPipBoyClose() {
  PlayerCharacter *player = PlayerCharacter::GetSingleton();
  if (!player)
    return;
  PipBoyLog("TORCH-DIAG", "reconcile enter desired=%d beforeAny=%d",
            g_companionTorchDesired ? 1 : 0,
            IsPipBoyLightOn(player) ? 1 : 0);
  SetPipBoyLight(player, g_companionTorchDesired);
  PipBoyLog("TORCH", "reconciled %s after Pip-Boy menu close (now %s, pending=%d)",
            g_companionTorchDesired ? "ON" : "OFF",
            IsPipBoyLightOn(player) ? "ON" : "OFF",
            g_companionTorchPending ? 1 : 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAYER SNAPSHOT
// Build a JSON snapshot of the player's current state.
// ═══════════════════════════════════════════════════════════════════════════════

std::string BuildPlayerSnapshot() {
  PlayerCharacter *player = PlayerCharacter::GetSingleton();
  if (!player)
    return "";

  JsonBuilder json;
  json.beginObject();

  // Game identifier - the companion app validates 'F3' | 'FNV' exactly.
  // NOTE: no timestamp field - the snapshot must be byte-identical when the
  // player state hasn't changed, so the pipe thread can skip redundant sends.
  json.keyStr("game", "F3");

  // Load order - runtime mod index to plugin filename. The companion app only
  // uses this for FNV form-ID remapping today, but it is cheap to emit and
  // keeps the snapshot shape identical between the two plugins.
  json.key("loadOrder");
  json.beginArray();
  {
    DataHandler *dataHandler = DataHandler::Get();
    if (dataHandler) {
      const UInt32 modCount = dataHandler->modList.loadedModCount;
      for (UInt32 i = 0; i < modCount; i++) {
        const ModInfo *mod = dataHandler->modList.loadedMods[i];
        if (!mod)
          continue;
        json.arrayElement();
        json.beginObject();
        json.keyInt("index", (int)i);
        json.keyStr("name", mod->name);
        json.endObject();
      }
    }
  }
  json.endArray();

  // --- Player attributes ---
  json.key("player");
  json.beginObject();
  {
    // Player name
    const char *name = GetFullName(player);
    bool hasValidName = name && name[0] != '\0' &&
                        strcmp(name, "<no name>") != 0 &&
                        strcmp(name, "<NULL>") != 0;
    json.keyStr("name", hasValidName ? name : "Wanderer");

    // Level
    json.keyInt("level", AVLevel(player));

    // Hit Points
    // hp is emitted as a whole number: fractional regen ticks would make
    // every tick look like a changed snapshot, spamming the pipe and serial
    // link. Rounded UP to match the game HUD, which displays ceil(health).
    float maxHP = AVBase(player, kAV_Health);
    float curHP = AVCurrent(player, kAV_Health);
    json.keyInt("hp", (int)ceilf(curHP));
    json.keyFloat("maxHP", maxHP);

    // Action Points - floor to match game HUD, fractional regen ignored for
    // sync.
    float maxAP = AVBase(player, kAV_ActionPoints);
    float curAP = AVCurrent(player, kAV_ActionPoints);
    json.keyInt("ap", (int)floorf(curAP));
    json.keyInt("maxAP", (int)(maxAP + 0.5f));

    // Carry Weight
    // maxWg is the max carry weight AV (includes Strong Back/buffs).
    float maxWg = AVBase(player, kAV_CarryWeight);
    json.keyInt("maxWg", (int)(maxWg + 0.5f));
    // wg is the player's actual carried inventory weight, taken straight from
    // the engine (AV 46). Truncated (floor) to match the in-game HUD display.
    float curWg = AVCurrent(player, kAV_InventoryWeight);
    json.keyInt("wg", (int)floorf(curWg));

    // Karma (drives the device's F3 GENERAL screen, Fallout 3 has no faction
    // reputation, so no "factions" array is emitted - the companion app
    // skips faction sync entirely in F3 mode)
    float karma = AVCurrent(player, kAV_Karma);
    json.keyFloat("karma", karma);

    // Limb Conditions (0-100 percentage)
    json.keyFloat("perceptioncondition",
                  AVCurrent(player, kAV_PerceptionCondition));
    json.keyFloat("endurancecondition",
                  AVCurrent(player, kAV_EnduranceCondition));
    json.keyFloat("leftattackcondition",
                  AVCurrent(player, kAV_LeftAttackCondition));
    json.keyFloat("rightattackcondition",
                  AVCurrent(player, kAV_RightAttackCondition));
    json.keyFloat("leftmobilitycondition",
                  AVCurrent(player, kAV_LeftMobilityCondition));
    json.keyFloat("rightmobilitycondition",
                  AVCurrent(player, kAV_RightMobilityCondition));

    // Pip-Boy flashlight (hold TAB in-game)
    json.key("torch");
    json.valueBool(IsPipBoyLightOn(player));

    // XP - AV 24, current value. Only pushed to the device on first sync,
    // save-load, and level-up.
    json.keyInt("xp", (int)AVCurrent(player, kAV_XP));

    // S.P.E.C.I.A.L. - effective values (includes equipment modifiers).
    json.key("special");
    json.beginObject();
    {
      json.keyInt("ST", (int)AVCurrent(player, kAV_Strength));
      json.keyInt("PE", (int)AVCurrent(player, kAV_Perception));
      json.keyInt("EN", (int)AVCurrent(player, kAV_Endurance));
      json.keyInt("CH", (int)AVCurrent(player, kAV_Charisma));
      json.keyInt("IN", (int)AVCurrent(player, kAV_Intelligence));
      json.keyInt("AG", (int)AVCurrent(player, kAV_Agility));
      json.keyInt("LK", (int)AVCurrent(player, kAV_Luck));
    }
    json.endObject();

    // Skills - effective values. Fallout 3 set: Small Guns and Big Guns
    // instead of FNV's Guns, no Survival. Key names must normalize to the
    // device's F3 SKILLS.DAT display names ("Small Guns" = "smallguns").
    json.key("skills");
    json.beginObject();
    {
      json.keyInt("barter", (int)AVCurrent(player, kAV_Barter));
      json.keyInt("bigguns", (int)AVCurrent(player, kAV_BigGuns));
      json.keyInt("energyweapons", (int)AVCurrent(player, kAV_EnergyWeapons));
      json.keyInt("explosives", (int)AVCurrent(player, kAV_Explosives));
      json.keyInt("lockpick", (int)AVCurrent(player, kAV_Lockpick));
      json.keyInt("medicine", (int)AVCurrent(player, kAV_Medicine));
      json.keyInt("meleeweapons", (int)AVCurrent(player, kAV_MeleeWeapons));
      json.keyInt("repair", (int)AVCurrent(player, kAV_Repair));
      json.keyInt("science", (int)AVCurrent(player, kAV_Science));
      json.keyInt("smallguns", (int)AVCurrent(player, kAV_SmallGuns));
      json.keyInt("sneak", (int)AVCurrent(player, kAV_Sneak));
      json.keyInt("speech", (int)AVCurrent(player, kAV_Speech));
      json.keyInt("unarmed", (int)AVCurrent(player, kAV_Unarmed));
    }
    json.endObject();

    // --- Equipped items (integer form IDs for Pip-Boy sync) ---
    TESObjectWEAP *eqWeapon = GetEquippedWeaponFO3(player);
    json.keyInt("equippedweap", eqWeapon ? (int)eqWeapon->refID : 0);

    // Condition of the equipped weapon stack - lets the Pip-Boy flag only the
    // matching condition row as equipped when several conditions of one weapon
    // are carried at once.
    int equippedWeapCnd =
        eqWeapon ? GetWornConditionPct(player, eqWeapon) : 100;
    json.keyInt("equippedweapcnd", equippedWeapCnd);

    // Thrown weapons ready the whole stack, so the Pip-Boy keeps them as one
    // row, all other weapons equip a single copy and the list splits it off.
    json.keyBool("equippedweapwhole", eqWeapon && IsThrownWeapon(eqWeapon));

    // --- Weapon ammo (for Pip-Boy ammo tab dimming) ---
    // Fallout 3 has no ammo variants: each weapon fires exactly one ammo
    // form. "current" is that form, "usable" is the single-element list.
    // The device's AMMO-tab active/dim logic behaves identically to FNV.
    json.key("weaponammo");
    json.beginObject();
    {
      UInt32 currentAmmo = 0;
      if (eqWeapon && eqWeapon->ammo.ammo &&
          ((TESForm *)eqWeapon->ammo.ammo)->typeID == kFormType_Ammo)
        currentAmmo = ((TESForm *)eqWeapon->ammo.ammo)->refID;
      json.keyInt("current", (int)currentAmmo);

      json.key("usable");
      json.beginArray();
      if (currentAmmo)
        json.arrayElementInt((int)currentAmmo);
      json.endArray();
    }
    json.endObject();

    // Equipped apparel: ARMO container entries carrying a Worn extra list.
    // One container walk fills both the id array and the parallel condition
    // array.
    json.key("equippedapparel");
    std::vector<UInt32> apparelIds;
    std::vector<int> apparelCnds;
    {
      ExtraContainerChanges *cc =
          (ExtraContainerChanges *)player->extraDataList.GetByType(
              kExtraData_ContainerChanges);
      std::set<UInt32> seenApparel;
      if (cc && cc->data && cc->data->objList) {
        for (tList<ExtraContainerChanges::EntryData>::Iterator it =
                 cc->data->objList->Begin();
             !it.End(); ++it) {
          ExtraContainerChanges::EntryData *entry = it.Get();
          if (!entry || !entry->type ||
              entry->type->typeID != kFormType_Armor)
            continue;
          if (!entry->extendData)
            continue;
          bool worn = false;
          ExtraDataList *wornXdl = NULL;
          for (tList<ExtraDataList>::Iterator eit =
                   entry->extendData->Begin();
               !eit.End(); ++eit) {
            ExtraDataList *xdl = eit.Get();
            if (xdl && (xdl->GetByType(kExtraData_Worn) ||
                        xdl->GetByType(kExtraData_WornLeft))) {
              worn = true;
              wornXdl = xdl;
              break;
            }
          }
          if (!worn)
            continue;
          UInt32 apparelId = entry->type->refID;
          if (seenApparel.count(apparelId))
            continue;
          seenApparel.insert(apparelId);
          apparelIds.push_back(apparelId);
          apparelCnds.push_back(
              GetInventoryItemConditionPct(entry->type, wornXdl));
        }
      }
    }
    json.beginArray();
    for (size_t i = 0; i < apparelIds.size(); i++)
      json.arrayElementInt((int)apparelIds[i]);
    json.endArray();

    // Conditions parallel to "equippedapparel", so the Pip-Boy can flag only
    // the worn condition row of each apparel form.
    json.key("equippedapparelcnd");
    json.beginArray();
    for (size_t i = 0; i < apparelCnds.size(); i++)
      json.arrayElementInt(apparelCnds[i]);
    json.endArray();
  }
  json.endObject();

  // --- Inventory ---
  // Sum by (formId, conditionPct) so items of differing condition stay
  // separate stacks (matches the game's per-condition inventory rows).
  json.key("inventory");
  json.beginArray();
  {
    struct AggInvItem {
      int count;
      const char *typeStr;
      TESForm *baseForm; // for per-stack derived stats (e.g. weapon DAM)
    };
    std::map<std::pair<UInt32, int>, AggInvItem> agg;

    ExtraContainerChanges *containerChanges =
        (ExtraContainerChanges *)player->extraDataList.GetByType(
            kExtraData_ContainerChanges);

    if (containerChanges && containerChanges->data &&
        containerChanges->data->objList) {
      ExtraContainerChanges::EntryDataList *entryList =
          containerChanges->data->objList;

      for (tList<ExtraContainerChanges::EntryData>::Iterator iter =
               entryList->Begin();
           !iter.End(); ++iter) {
        ExtraContainerChanges::EntryData *entry = iter.Get();
        if (!entry || !entry->type)
          continue;

        TESForm *baseForm = entry->type;
        UInt32 formId = baseForm->refID;
        int count = entry->countDelta;

        if (count <= 0)
          continue;

        const char *typeStr = GetFormTypeString(baseForm->typeID);

        // A single base form occupies ONE container entry (countDelta =
        // total), but instances of differing condition live as separate
        // ExtraDataLists in its extendData (each optionally carrying an
        // ExtraCount for how many share that data).
        int remaining = count;
        if (entry->extendData) {
          for (tList<ExtraDataList>::Iterator extIter =
                   entry->extendData->Begin();
               !extIter.End() && remaining > 0; ++extIter) {
            ExtraDataList *xdl = extIter.Get();
            if (!xdl)
              continue;
            int subCount = 1;
            ExtraCount *xCount =
                (ExtraCount *)xdl->GetByType(kExtraData_Count);
            if (xCount && xCount->count > 0)
              subCount = xCount->count;
            if (subCount > remaining)
              subCount = remaining;
            const int conditionPct =
                GetInventoryItemConditionPct(baseForm, xdl);
            AggInvItem &slot = agg[std::make_pair(formId, conditionPct)];
            if (slot.count == 0) {
              slot.typeStr = typeStr;
              slot.baseForm = baseForm;
            }
            slot.count += subCount;
            remaining -= subCount;
          }
        }
        if (remaining > 0) {
          AggInvItem &slot = agg[std::make_pair(formId, 100)];
          if (slot.count == 0) {
            slot.typeStr = typeStr;
            slot.baseForm = baseForm;
          }
          slot.count += remaining;
        }
      }
    }

    for (const auto &pair : agg) {
      const UInt32 formId = pair.first.first;
      const int conditionPct = pair.first.second;
      const AggInvItem &item = pair.second;
      json.arrayElement();
      json.beginObject();
      json.keyStr("formId", FormatFormId(formId));
      json.keyStr("type", item.typeStr);
      json.keyInt("count", item.count);
      json.keyInt("condition", conditionPct);
      // Weapons carry a condition/skill-adjusted display damage so the
      // Pip-Boy can show the same dynamic DAM the game does. Omitted
      // (Pip-Boy keeps its static DAT value) for non-weapons or weapons
      // with no direct base damage (see ComputeWeaponDisplayDamage).
      if (item.baseForm && item.baseForm->typeID == kFormType_Weapon) {
        int dam = ComputeWeaponDisplayDamage(
            player, (TESObjectWEAP *)item.baseForm, conditionPct);
        if (dam > 0)
          json.keyInt("dam", dam);
      }
      json.endObject();
    }
  }
  json.endArray();

  // --- Perks ---
  // Enumerate every loaded BGSPerk and read the player's rank through the
  // game's own HasPerk condition handler - on Fallout 3, HasPerk's numeric
  // result IS the rank (the script compiler can't store it, but the direct
  // eval call reads it fine), so multi-rank perks report correctly.
  json.key("perks");
  json.beginArray();
  {
    DataHandler *dataHandler = DataHandler::Get();
    if (dataHandler && g_cmdHasPerk) {
      for (tList<BGSPerk>::Iterator iter = dataHandler->perkList.Begin();
           !iter.End(); ++iter) {
        BGSPerk *perk = iter.Get();
        if (!perk)
          continue;
        double rank = 0.0;
        if (!EvalGameCommand(g_cmdHasPerk, player, perk, NULL, &rank))
          continue;
        if (rank > 0.0) {
          json.arrayElement();
          json.beginObject();
          json.keyStr("formId", FormatFormId(perk->refID));
          json.keyInt("rank", (int)rank);
          json.endObject();
        }
      }
    }
  }
  json.endArray();

  json.endObject();
  return json.str();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIP-BOY UI REFRESH
// The NV plugin repaints the open in-game Pip-Boy after device-initiated
// equips via FNV-only menu addresses; those don't apply to FO3.
// ═══════════════════════════════════════════════════════════════════════════════

static const UInt32 kAddr_RefreshItemListBox = 0x61B500;

static void RefreshPipBoyUI() {
  CdeclCall<void>(kAddr_RefreshItemListBox);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIME FREEZE (SetGlobalTimeMultiplier)
// Slows game time to near zero. kFrozenTimeMultiplier is small enough to be
// visually indistinguishable from a full pause over a sync's ~1-2s duration,
// while staying well clear of exactly 0.0.
// ═══════════════════════════════════════════════════════════════════════════════

static const UInt32 kAddr_SetGlobalTimeMultiplier = 0x86C220;
static void *const kGlobalTimeMultiplierThis = (void *)0x1090BA0;
static const float kFrozenTimeMultiplier = 0.00001f;
static const float kNormalTimeMultiplier = 1.0f;

static void SetGlobalTimeMultiplier(float mult) {
  ThisCall<void>(kAddr_SetGlobalTimeMultiplier, kGlobalTimeMultiplierThis, mult,
                 true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// INITIAL-SYNC LOCK
// While the companion app runs the initial sync it sends SYNC_LOCK, we
// disable the player's controls, freeze the world, and show a centered
// overlay until SYNC_UNLOCK (or disconnect). Must run on the main game
// thread.
// ═══════════════════════════════════════════════════════════════════════════════

// Tile::ReadXML - thiscall, parses a UI XML file and attaches the resulting
// tile tree under `this`. Source: Command Extender decoding.h kAddr_ReadXML.
static const UInt32 kAddr_TileReadXML = 0xBF37B0;
static const char *kSyncWaitTempXmlFile = "pipboy_sync_temp.xml";

// Inject on menuRoot so screen-relative coordinates are correct. Same XML as
// the NV plugin's overlay
static const char kSyncWaitOverlayXml[] =
    "<rect name=\"PipBoySyncWait\">"
    "<visible> &true; </visible>"
    "<depth> 2500 </depth>"
    "<locus> &true; </locus>"
    // Center on screen
    "<x><copy src=\"screen\" trait=\"width\"/>"
    "<sub src=\"me\" trait=\"width\"/><div>2</div></x>"
    "<y><copy src=\"screen\" trait=\"height\"/>"
    "<sub src=\"me\" trait=\"height\"/><div>2</div></y>"
    "<width> 500 </width>"
    "<height> 180 </height>"
    "<target> 0 </target>"
    // Background: inset 10px on each side from parent edges
    "<image name=\"sync_background\">"
    "<filename> Interface\\Shared\\solid.dds </filename>"
    "<red> 20 </red>"
    "<green> 20 </green>"
    "<blue> 20 </blue>"
    "<alpha> 210 </alpha>"
    "<x> 10 </x>"
    "<y> 10 </y>"
    "<width><copy src=\"parent\" trait=\"width\"/><sub>20</sub></width>"
    "<height><copy src=\"parent\" trait=\"height\"/><sub>20</sub></height>"
    "<depth> 1 </depth>"
    "</image>"
    // Border top: x=10, y=10, spans full inner width
    "<image name=\"sync_border_top\">"
    "<filename> Interface\\Shared\\solid.dds </filename>"
    "<systemcolor> &hudmain; </systemcolor>"
    "<x> 10 </x>"
    "<y> 10 </y>"
    "<width><copy src=\"parent\" trait=\"width\"/><sub>20</sub></width>"
    "<height> 2 </height>"
    "<depth> 2 </depth>"
    "</image>"
    // Border bottom: y = parent.height - 12 (10px inset + 2px border)
    "<image name=\"sync_border_bottom\">"
    "<filename> Interface\\Shared\\solid.dds </filename>"
    "<systemcolor> &hudmain; </systemcolor>"
    "<x> 10 </x>"
    "<y><copy src=\"parent\" trait=\"height\"/><sub>12</sub></y>"
    "<width><copy src=\"parent\" trait=\"width\"/><sub>20</sub></width>"
    "<height> 2 </height>"
    "<depth> 2 </depth>"
    "</image>"
    // Border left: x=10, y=10, full inner height
    "<image name=\"sync_border_left\">"
    "<filename> Interface\\Shared\\solid.dds </filename>"
    "<systemcolor> &hudmain; </systemcolor>"
    "<x> 10 </x>"
    "<y> 10 </y>"
    "<width> 2 </width>"
    "<height><copy src=\"parent\" trait=\"height\"/><sub>20</sub></height>"
    "<depth> 2 </depth>"
    "</image>"
    // Border right: x = parent.width - 12 (10px inset + 2px border)
    "<image name=\"sync_border_right\">"
    "<filename> Interface\\Shared\\solid.dds </filename>"
    "<systemcolor> &hudmain; </systemcolor>"
    "<x><copy src=\"parent\" trait=\"width\"/><sub>12</sub></x>"
    "<y> 10 </y>"
    "<width> 2 </width>"
    "<height><copy src=\"parent\" trait=\"height\"/><sub>20</sub></height>"
    "<depth> 2 </depth>"
    "</image>"
    // Title: x=center, y=height*2/9 (~40px for h=180, scales with height)
    "<text name=\"sync_title\">"
    "<string> Pip-Boy Sync </string>"
    "<x><copy src=\"parent\" trait=\"width\"/><div>2</div></x>"
    "<y><copy src=\"parent\" trait=\"height\"/><mul>2</mul><div>9</div></y>"
    "<font> 1 </font>"
    "<justify> &center; </justify>"
    "<systemcolor> &hudmain; </systemcolor>"
    "<width><copy src=\"parent\" trait=\"width\"/></width>"
    "<depth> 3 </depth>"
    "</text>"
    // Body: x=center, y=height/2 (=90px for h=180, scales with height)
    "<text name=\"sync_body\">"
    "<string> Please wait while your Pip-Boy syncs with the companion app. "
    "</string>"
    "<x><copy src=\"parent\" trait=\"width\"/><div>2</div></x>"
    "<y><copy src=\"parent\" trait=\"height\"/><div>2</div></y>"
    "<font> 2 </font>"
    "<justify> &center; </justify>"
    "<systemcolor> &hudmain; </systemcolor>"
    "<width><copy src=\"parent\" trait=\"width\"/></width>"
    "<wrapwidth><copy src=\"parent\" trait=\"width\"/><sub>40</sub></wrapwidth>"
    "<depth> 3 </depth>"
    "</text>"
    "</rect>";

static bool g_syncControlsDisabled = false;
static bool g_syncWorldFrozen = false;
// Pump ticks to wait after a save/load before applying a lock (defensive,
// mirrors the NV plugin's HUD-ready delay).
static UInt32 g_syncLockReadyDelay = 0;
static bool g_syncOverlayInjected = false;

static Tile *GetSyncOverlayParent() {
  if (g_syncLockReadyDelay > 0)
    return NULL;
  InterfaceManager *im = InterfaceManager::GetSingleton();
  return im ? im->menuRoot : NULL;
}

static Tile *InjectTileXml(Tile *parent, const char *xml) {
  if (!parent || !xml || !*xml)
    return NULL;

  FILE *file = fopen(kSyncWaitTempXmlFile, "wb");
  if (!file)
    return NULL;
  fputs(xml, file);
  fclose(file);
  return ThisCall<Tile *>(kAddr_TileReadXML, parent, kSyncWaitTempXmlFile);
}

static void DestroySyncOverlayTile(Tile *overlay) {
  if (!overlay)
    return;
  ThisCall<void>(kTile_SetFloatAddr, overlay, (UInt32)kTileValue_visible, 0.0f,
                 true);
  overlay->Destroy(true);
}

static void ShowSyncWaitOverlay() {
  if (g_syncOverlayInjected)
    return;
  Tile *parent = GetSyncOverlayParent();
  if (!parent || !parent->niNode)
    return;

  InjectTileXml(parent, kSyncWaitOverlayXml);
  if (parent->GetChild("PipBoySyncWait")) {
    g_syncOverlayInjected = true;
    PipBoyLog("SYNC", "Overlay injected");
  }
}

static void CloseSyncWaitOverlay() {
  if (InterfaceManager *im = InterfaceManager::GetSingleton()) {
    if (im->menuRoot) {
      if (Tile *overlay = im->menuRoot->GetChild("PipBoySyncWait"))
        DestroySyncOverlayTile(overlay);
    }
  }
  if (g_syncOverlayInjected)
    PipBoyLog("SYNC", "Overlay closed");
  g_syncOverlayInjected = false;
}

static void ApplySyncLock(bool wantLock) {
  PlayerCharacter *player = PlayerCharacter::GetSingleton();
  if (!player)
    return;

  if (wantLock) {
    if (g_syncLockReadyDelay > 0)
      return;

    if (!g_syncControlsDisabled) {
      FO3DisablePlayerControls(player);
      PipBoyLog("SYNC", "Lock ON: disabledControlFlags |= 0x%02X (we set 0x%02X)",
                kSyncControlFlagsAll, g_controlFlagsWeSet);
      g_syncControlsDisabled = true;
    }
    if (!g_syncWorldFrozen) {
      // Freeze NPCs/projectiles/physics too - player controls alone still let
      // the world move around a player who can't react to it.
      SetGlobalTimeMultiplier(kFrozenTimeMultiplier);
      PipBoyLog("SYNC", "Lock ON: SetGlobalTimeMultiplier(%g)",
                kFrozenTimeMultiplier);
      g_syncWorldFrozen = true;
    }
    // ApplySyncLock runs every pump tick while the lock is requested, so if
    // the HUD wasn't ready yet this retries until the overlay lands - same
    // reconcile-until-injected behavior as the NV plugin's per-frame loop.
    if (!g_syncOverlayInjected)
      ShowSyncWaitOverlay();
  } else {
    const bool wasLocked = g_syncControlsDisabled;
    if (g_syncControlsDisabled) {
      FO3EnablePlayerControls(player);
      PipBoyLog("SYNC", "Lock OFF: control flags restored");
      g_syncControlsDisabled = false;
    }
    if (g_syncWorldFrozen) {
      SetGlobalTimeMultiplier(kNormalTimeMultiplier);
      PipBoyLog("SYNC", "Lock OFF: SetGlobalTimeMultiplier(%g)",
                kNormalTimeMultiplier);
      g_syncWorldFrozen = false;
    }
    if (g_syncOverlayInjected)
      CloseSyncWaitOverlay();
    (void)wasLocked;
  }
}

static void ResetSyncLockState(bool reenableControls) {
  g_syncLockReadyDelay = 300 / PUMP_INTERVAL_MS;
  // Flag only - no tile teardown here. This runs on save/load/exit where the
  // UI is being rebuilt and the old menuRoot children are already gone,
  // touching them would be a stale pointer walk. Mirrors the NV plugin.
  g_syncOverlayInjected = false;
  if (reenableControls && g_syncControlsDisabled) {
    if (PlayerCharacter *player = PlayerCharacter::GetSingleton())
      FO3EnablePlayerControls(player);
    PipBoyLog("SYNC", "ResetSyncLockState: control flags restored");
    g_syncControlsDisabled = false;
  }
  // Safety net matching g_syncControlsDisabled above - a save/load or exit
  // mid-lock (e.g. companion crashed during sync) must not leave the world
  // permanently frozen.
  if (reenableControls && g_syncWorldFrozen) {
    SetGlobalTimeMultiplier(kNormalTimeMultiplier);
    PipBoyLog("SYNC", "ResetSyncLockState: world unfrozen");
    g_syncWorldFrozen = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIP-BOY COMMAND EXECUTION
// Executes a command line received from the companion app. Lines look like:
//   "USE 0x0001519e"      - consume an aid item (EquipItem on an ingestible)
//   "EQUIP 0x0000434f"    - equip a weapon/apparel
//   "UNEQUIP 0x000340c8"  - unequip a weapon/apparel
//   "TORCH ON" / "TORCH OFF" - toggle the in-game Pip-Boy flashlight
// MUST be called from the main game thread.
// ═══════════════════════════════════════════════════════════════════════════════

static DWORD g_lastEquipFormId = 0;
static DWORD g_lastEquipTime = 0;
static int g_lastEquipCnd = -1;

static int GetItemCountForEquip(PlayerCharacter *player, UInt32 targetFormId) {
  if (!player)
    return 1;
  ExtraContainerChanges *containerChanges =
      (ExtraContainerChanges *)player->extraDataList.GetByType(
          kExtraData_ContainerChanges);
  if (!containerChanges || !containerChanges->data ||
      !containerChanges->data->objList)
    return 1;

  int count = 0;
  for (tList<ExtraContainerChanges::EntryData>::Iterator iter =
           containerChanges->data->objList->Begin();
       !iter.End(); ++iter) {
    ExtraContainerChanges::EntryData *entry = iter.Get();
    if (entry && entry->type && entry->type->refID == targetFormId) {
      if (entry->countDelta > 0)
        count += entry->countDelta;
    }
  }
  return count;
}

// Thrown weapons (grenades, mines) must equip the whole stack so the player
// can throw all of them. FO3 weapon types 10–12 (grenade/mine/lunchbox mine)
// Fallout 3 has no type-13 thrown spears.
static bool IsThrownWeapon(TESForm *form) {
  if (!form || form->typeID != kFormType_Weapon)
    return false;
  UInt8 wt = ((TESObjectWEAP *)form)->eWeaponType;
  return wt >= 10 && wt <= 12;
}


// ═══════════════════════════════════════════════════════════════════════════════
// NATIVE EQUIP/UNEQUIP (bypasses CallGameCommand's EquipItem/UnequipItem
// script-command dispatch, which fails 100% of the time - see fo3_engine.h's
// "NATIVE ENGINE CALLS" section for why). Calls Actor::EquipItem/UnequipItem
// directly at their real engine addresses, exactly the way
// the NV plugin calls player>EquipItem()/UnequipItem() as native C++ methods
// (same 6-arg thiscall shape, xNVSE GameObjects.cpp).
// ═══════════════════════════════════════════════════════════════════════════════

static const UInt32 kAddr_ActorEquipItemAlt = 0x7198E0;
static const UInt32 kAddr_ActorUnequipItem = 0x7133E0;

// TESObjectREFR::Update3D's player-only branch.
static const UInt32 kAddr_UpdatePlayerAppearance = 0x729880;
static void RefreshPlayerAppearance(Actor *actor) {
  ThisCall<void>(kAddr_UpdatePlayerAppearance, actor);
}

// Extra height (game units) added to each device-dropped item's spawn
// position.
static const float kDropZOffset = 50.0f;

struct FO3ObjectWithRemoveItem : public TESObjectREFR {
  virtual void Unk_4E(void);
  virtual void Unk_4F(void);
  virtual void Unk_50(void);
  virtual void Unk_51(void);
  virtual bool Unk_52(void);
  virtual void Unk_53(void);
  virtual void Unk_54(void);
  virtual void Unk_55(void);
  virtual void Unk_56(void);
  virtual bool Unk_57(void);
  virtual void Unk_58(void);
  virtual void Unk_59(void);
  virtual void Unk_5A(void);
  virtual void Unk_5B(void);
  virtual void Unk_5C(void);
  virtual void Unk_5D(void);
  virtual void Unk_5E(void);
  virtual TESObjectREFR *RemoveItem(TESForm *toRemove, BaseExtraList *extraList,
                                     UInt32 quantity, bool keepOwner, bool drop,
                                     TESObjectREFR *destRef, UInt32 unk6,
                                     UInt32 unk7, bool unk8, bool unk9);
};

// Finds this form's container entry (holds count + per-condition extra data).
static ExtraContainerChanges::EntryData *
FindContainerEntryForItem(PlayerCharacter *player, TESForm *form) {
  if (!player || !form)
    return NULL;
  ExtraContainerChanges *cc =
      (ExtraContainerChanges *)player->extraDataList.GetByType(
          kExtraData_ContainerChanges);
  if (!cc || !cc->data || !cc->data->objList)
    return NULL;
  for (tList<ExtraContainerChanges::EntryData>::Iterator it =
           cc->data->objList->Begin();
       !it.End(); ++it) {
    ExtraContainerChanges::EntryData *entry = it.Get();
    if (entry && entry->type && entry->type->refID == form->refID)
      return entry;
  }
  return NULL;
}

static bool IsFormCurrentlyWorn(PlayerCharacter *player, TESForm *form) {
  ExtraContainerChanges::EntryData *entry =
      FindContainerEntryForItem(player, form);
  if (!entry || !entry->extendData)
    return false;
  for (tList<ExtraDataList>::Iterator eit = entry->extendData->Begin();
       !eit.End(); ++eit) {
    ExtraDataList *xdl = eit.Get();
    if (xdl && (xdl->GetByType(kExtraData_Worn) ||
                xdl->GetByType(kExtraData_WornLeft)))
      return true;
  }
  return false;
}

// Total owned count of a form: base-container count plus the
// container-changes delta.
static SInt32 GetTotalFormCount(PlayerCharacter *player, TESForm *form) {
  if (!player || !form || !player->baseForm)
    return 0;
  TESActorBase *actorBase = (TESActorBase *)player->baseForm;
  SInt32 total = 0;
  for (tList<TESContainer::FormCount>::Iterator it =
           actorBase->container.formCountList.Begin();
       !it.End(); ++it) {
    TESContainer::FormCount *fc = it.Get();
    if (fc && fc->form == form)
      total += fc->count;
  }
  ExtraContainerChanges::EntryData *entry = FindContainerEntryForItem(player, form);
  if (entry) {
    bool hasLeveledItem = false;
    if (entry->extendData) {
      for (tList<ExtraDataList>::Iterator eit = entry->extendData->Begin();
           !eit.End(); ++eit) {
        ExtraDataList *xdl = eit.Get();
        if (xdl && xdl->GetByType(kExtraData_LeveledItem)) {
          hasLeveledItem = true;
          break;
        }
      }
    }
    if (total != 0) {
      // Leveled-item entries leave the base count untouched.
      if (!hasLeveledItem) {
        total += entry->countDelta;
        if (total < 0)
          total = 0;
      }
    } else {
      total = entry->countDelta;
      if (total < 0)
        total = 0;
    }
  }
  return total;
}

// How many units EquipItemAlt should equip: 1 for anything worn as a single
// item (armor/book/aid), the whole stack for ammo and thrown weapons (which
// ready their entire count), 1 for other weapons. Unrecognized form types
// return 0 so the caller can bail rather than guess.
static SInt32 DetermineNativeEquipCount(ExtraContainerChanges::EntryData *entry) {
  TESForm *form = entry->type;
  UInt8 formType = form->typeID;
  if (formType == kFormType_Armor || formType == kFormType_Book ||
      formType == kFormType_AlchemyItem)
    return 1;
  if (formType == kFormType_Ammo)
    return entry->countDelta;
  if (formType == kFormType_Weapon)
    return IsThrownWeapon(form) ? entry->countDelta : 1;
  return 0;
}

// Locate the specific carried instance of `baseForm` whose condition matches
// `wantCnd` - straight port of the NV plugin's FindStackByCondition (the
// container structures are identical).
static ExtraDataList *FindStackByCondition(PlayerCharacter *player,
                                           TESForm *baseForm, int wantCnd,
                                           bool *found) {
  *found = false;
  ExtraContainerChanges::EntryData *entry =
      FindContainerEntryForItem(player, baseForm);
  if (!entry || entry->countDelta <= 0)
    return NULL;

  int remaining = entry->countDelta;
  ExtraDataList *wornMatch = NULL;
  if (entry->extendData) {
    for (tList<ExtraDataList>::Iterator eit = entry->extendData->Begin();
         !eit.End(); ++eit) {
      ExtraDataList *xdl = eit.Get();
      if (!xdl)
        continue;
      int subCount = 1;
      ExtraCount *xc = (ExtraCount *)xdl->GetByType(kExtraData_Count);
      if (xc && xc->count > 0)
        subCount = xc->count;
      remaining -= subCount;
      if (GetInventoryItemConditionPct(baseForm, xdl) == wantCnd) {
        // Prefer a non-worn instance; remember a worn match as a fallback.
        if (!xdl->GetByType(kExtraData_Worn)) {
          *found = true;
          return xdl;
        }
        wornMatch = xdl;
      }
    }
  }
  if (wornMatch) {
    *found = true;
    return wornMatch;
  }
  // Remaining items carry no extra data = pristine, full condition.
  if (wantCnd >= 100 && remaining > 0) {
    *found = true;
    return NULL;
  }
  return NULL;
}

// Untargeted equip - count derived from form type
// (whole stack for ammo/thrown, else 1), xData =
// the first extend node when one exists.
static bool NativeEquipDefault(Actor *actor,
                               ExtraContainerChanges::EntryData *entry) {
  if (!actor || !entry || !entry->type)
    return false;
  SInt32 count = DetermineNativeEquipCount(entry);
  if (count <= 0)
    return false;
  ExtraDataList *xData = NULL;
  if (entry->extendData) {
    tList<ExtraDataList>::Iterator eit = entry->extendData->Begin();
    if (!eit.End())
      xData = eit.Get();
  }
  ThisCall<void>(kAddr_ActorEquipItemAlt, actor, entry->type, count, xData,
                 (UInt32)1, (UInt32)0, (UInt32)1);
  return true;
}

// Condition-targeted equip - count 1, exact instance. Mirrors NV's
// player->EquipItem(form, 1, xdl, 1, false, 1).
static bool NativeEquipInstance(Actor *actor, TESForm *form,
                                ExtraDataList *xData) {
  if (!actor || !form)
    return false;
  ThisCall<void>(kAddr_ActorEquipItemAlt, actor, form, (SInt32)1, xData,
                 (UInt32)1, (UInt32)0, (UInt32)1);
  return true;
}

// Mirrors NV's player->UnequipItem(form, 1, NULL, 1, false, 1) - xData NULL
// lets the engine resolve the worn instance itself (only one instance of a
// form can ever be worn), same as the proven NV call.
static bool NativeUnequip(Actor *actor, TESForm *form) {
  if (!actor || !form)
    return false;
  ThisCall<void>(kAddr_ActorUnequipItem, actor, form, (UInt32)1, (void *)NULL,
                 (UInt32)1, (UInt32)0, (UInt32)1);
  return true;
}

static void ExecutePipBoyCommand(const std::string &line) {
  PipBoyLog("CMD-IN", "%s", line.c_str());
  if (line == "TORCH ON") {
    PlayerCharacter *player = PlayerCharacter::GetSingleton();
    g_companionTorchDesired = true;
    SetPipBoyLight(player, true, IsPipBoyTorchUiActive());
    return;
  }
  if (line == "TORCH OFF") {
    PlayerCharacter *player = PlayerCharacter::GetSingleton();
    g_companionTorchDesired = false;
    SetPipBoyLight(player, false, IsPipBoyTorchUiActive());
    return;
  }

  size_t space = line.find(' ');
  if (space == std::string::npos)
    return;

  std::string verb = line.substr(0, space);
  std::string args = line.substr(space + 1);
  // args is "<hexFormId>" or "<hexFormId> <conditionPct>". The condition (when
  // present) selects which carried instance to equip for multi-condition
  // stacks.
  int wantCnd = -1;
  size_t argSpace = args.find(' ');
  std::string formIdStr =
      (argSpace == std::string::npos) ? args : args.substr(0, argSpace);
  if (argSpace != std::string::npos)
    wantCnd = atoi(args.substr(argSpace + 1).c_str());

  UInt32 formId = (UInt32)strtoul(formIdStr.c_str(), NULL, 16);
  if (formId == 0)
    return;

  PlayerCharacter *player = PlayerCharacter::GetSingleton();
  TESForm *form = LookupFormByID(formId);
  if (!player || !form)
    return;

  bool dispatchOk = true;
  if (verb == "USE" || verb == "EQUIP") {
    int countToEquip = GetItemCountForEquip(player, formId);
    if (countToEquip <= 0) {
      PipBoyLog("CMD-IN", "%s rejected - item %08X not in player inventory",
                verb.c_str(), formId);
      return;
    }
    if (verb == "EQUIP") {
      const DWORD now = GetTickCount();
      // Key the debounce on form + condition so switching between two
      // condition instances of the same form isn't swallowed as a duplicate.
      if (formId == g_lastEquipFormId && wantCnd == g_lastEquipCnd &&
          now - g_lastEquipTime < 500) {
        PipBoyLog("CMD-IN", "EQUIP debounced (duplicate within 500ms)");
        return;
      }
      g_lastEquipFormId = formId;
      g_lastEquipCnd = wantCnd;
      g_lastEquipTime = now;
    }
    // Branch shape mirrors the NV plugin's ExecutePipBoyCommand exactly.
    // Skip only when the requested instance is ALREADY the worn one (same
    // form AND same condition, or no condition given) - an EQUIP that names a
    // different condition instance of the worn form must go through so the
    // engine swaps instances.
    if (verb == "EQUIP" && IsFormCurrentlyWorn(player, form) &&
        (wantCnd < 0 || GetWornConditionPct(player, form) == wantCnd)) {
      dispatchOk = true;
    } else if (verb == "EQUIP" && countToEquip > 1 && !IsThrownWeapon(form) &&
               wantCnd >= 0) {
      // Several instances of one form differ by condition. Equip the exact
      // instance the user picked on the Pip-Boy instead of the engine's
      // default (highest-condition) match.
      bool found = false;
      ExtraDataList *xdl = FindStackByCondition(player, form, wantCnd, &found);
      dispatchOk =
          NativeEquipInstance((Actor *)player, form, found ? xdl : NULL);
      PipBoyLog("CMD-IN", "EQUIP %08X targeted cnd=%d (%s)", formId, wantCnd,
                found ? (xdl ? "matched stack" : "pristine") : "no match");
    } else {
      // USE, thrown weapons, and untargeted equips.
      ExtraContainerChanges::EntryData *entry =
          FindContainerEntryForItem(player, form);
      dispatchOk = NativeEquipDefault((Actor *)player, entry);
      if (!dispatchOk)
        PipBoyLog("CMD-IN", "%s %08X - native equip failed (entry=%p)",
                  verb.c_str(), formId, (void *)entry);
    }
  } else if (verb == "UNEQUIP") {
    // Real Actor::UnequipItem (0x7133E0).
    if (!IsFormCurrentlyWorn(player, form)) {
      PipBoyLog("CMD-IN", "UNEQUIP %08X rejected - item not currently worn",
                formId);
      dispatchOk = false;
    } else {
      dispatchOk = NativeUnequip((Actor *)player, form);
      if (!dispatchOk)
        PipBoyLog("CMD-IN", "UNEQUIP %08X - native unequip failed", formId);
    }
  } else if (verb == "DROP") {
    int dropCount = wantCnd > 0 ? wantCnd : 1;
    SInt32 total = GetTotalFormCount(player, form);
    if (total < 1) {
      PipBoyLog("CMD-IN", "DROP rejected - item %08X not in player inventory",
                formId);
    } else {
      if (dropCount < total)
        total = dropCount;

      const bool stacked = (form->typeID == kFormType_Weapon)
                               ? IsThrownWeapon(form)
                               : (form->typeID != kFormType_Armor);
      TESScriptableForm *scriptable =
          DYNAMIC_CAST(form, TESForm, TESScriptableForm);
      const bool hasScript = scriptable && scriptable->script;
      FO3ObjectWithRemoveItem *playerRefr = (FO3ObjectWithRemoveItem *)player;
      std::set<UInt32> raisedRefs;
      auto raiseDropRef = [&raisedRefs](TESObjectREFR *dropped) {
        if (dropped && raisedRefs.insert(dropped->refID).second)
          dropped->posZ += kDropZOffset;
      };

      ExtraContainerChanges::EntryData *entry =
          FindContainerEntryForItem(player, form);
      if (entry && entry->extendData) {
        // Per-instance extra data (condition, script state)
        // must ride along with the dropped reference - always re-read the
        // FIRST node: each RemoveItem consumes it and the list shifts up.
        while (total > 0 && entry->extendData) {
          // FOSE's tList<>::Begin() returns Iterator BY VALUE (const-qualified),
          // so it must be captured in a named variable before calling the
          // non-const Get() on it - chaining .Begin().Get() directly fails to
          // compile (binds a non-const method to a const temporary).
          tList<ExtraDataList>::Iterator eit = entry->extendData->Begin();
          ExtraDataList *xData = eit.Get();
          if (!xData)
            break;
          int subCount = 1;
          ExtraCount *xCount = (ExtraCount *)xData->GetByType(kExtraData_Count);
          if (xCount && xCount->count > 1) {
            subCount = xCount->count;
            if (hasScript && xData->GetByType(kExtraData_Script)) {
              // Scripted stack: strip the count and drop a single instance -
              // dropping a scripted stack whole is a known vanish case.
              // FOSE's BaseExtraList has no RemoveByType convenience (unlike
              // xNVSE's SDK) - Remove() takes the BSExtraData pointer itself.
              xData->Remove(xCount);
              subCount = 1;
            } else if (subCount > total) {
              subCount = total;
            }
          }
          total -= subCount;
          if (stacked) {
            raiseDropRef(playerRefr->RemoveItem(form, xData, subCount, true,
                                                true, NULL, 0, 0, true, false));
          } else {
            while (subCount-- > 0)
              raiseDropRef(playerRefr->RemoveItem(form, xData, 1, true, true,
                                                  NULL, 0, 0, true, false));
          }
        }
      }
      // Remainder with no per-instance data (pristine units, or
      // base-container items with no container-changes entry at all).
      while (total > 0) {
        int subCount = (total < 0x7FFF) ? total : 0x7FFF;
        raiseDropRef(playerRefr->RemoveItem(form, NULL, subCount, true, true,
                                            NULL, 0, 0, true, false));
        total -= subCount;
      }
    }
  }

  // Native equip/unequip above bypass the full vanilla pipeline that rebuilds
  // the player's worn-item 3D appearance (see RefreshPlayerAppearance) - kick
  // it explicitly so the in-game model updates immediately instead of only on
  // the next Pip-Boy open/close.
  if (dispatchOk && (verb == "EQUIP" || verb == "UNEQUIP"))
    RefreshPlayerAppearance((Actor *)player);

  RefreshPipBoyUI();
  // Was unconditionally logged "CMD-OK" even when the dispatch above failed -
  // fixed to reflect what actually happened.
  PipBoyLog(dispatchOk ? "CMD-OK" : "CMD-FAIL", "%s -> form %08X",
            verb.c_str(), formId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN-THREAD PUMP BODY
// Runs on the game's main thread every PUMP_INTERVAL_MS (see fo3_engine.h).
// Mirrors the NV plugin's kMessage_MainGameLoop handler.
// ═══════════════════════════════════════════════════════════════════════════════

static void OnMainGameLoop() {
  {
    PlayerCharacter *livePlayer = PlayerCharacter::GetSingleton();
    bool nowLoaded = (livePlayer != NULL && livePlayer->parentCell != NULL);
    if (nowLoaded && !g_gameLoaded) {
      PipBoyLog("MSG", "game loaded (live-detected)");
      g_gameLoaded = true;
      g_saveLoadPending = true;
      g_pipBoyLightSearched = false;
      ResetSyncLockState(true);
      std::lock_guard<std::mutex> lock(g_snapshotMutex);
      g_latestSnapshot.clear();
    } else if (!nowLoaded && g_gameLoaded) {
      PipBoyLog("MSG", "game unloaded (live-detected)");
      g_gameLoaded = false;
      g_syncLockRequested = false;
      g_mainMenuPending = true;
      ResetSyncLockState(true);
    }
  }
  if (!g_gameLoaded)
    return;

  LogMenuMaskIfChanged();
  if (g_syncLockReadyDelay > 0)
    g_syncLockReadyDelay--;

  // Track Pip-Boy chrome sessions and reconcile the torch when the in-game
  // Pip-Boy closes (mirrors the NV plugin's spell-only/manager reconcile).
  {
    if (IsPipBoyTabMenuOpen())
      g_pipBoyChromeSession = true;

    const bool pipBoyTorchUi = IsPipBoyTorchUiActive();

    if (g_pipBoyTorchUiWasActive && !pipBoyTorchUi) {
      try {
        ReconcileCompanionTorchAfterPipBoyClose();
      } catch (...) {
      }
    }
    if (!IsPipBoyTabMenuOpen() && !IsPipBoyRepairOrModMenuOpen())
      g_pipBoyChromeSession = false;

    g_pipBoyTorchUiWasActive = pipBoyTorchUi;
  }

  // Apply/clear the initial-sync control lock (main thread only)
  try {
    ApplySyncLock(g_syncLockRequested.load());
  } catch (...) {
  }

  // Execute Pip-Boy-initiated commands on the main thread
  {
    std::vector<std::string> commands;
    {
      std::lock_guard<std::mutex> lock(g_commandMutex);
      commands.swap(g_commandQueue);
    }
    for (const auto &cmd : commands) {
      try {
        ExecutePipBoyCommand(cmd);
      } catch (...) {
      }
    }
  }

  // In-game flashlight toggles (holding TAB), including while the in-game
  // Pip-Boy UI is open - keep companion intent aligned so snapshots reflect
  // actual game state, and so ReconcileCompanionTorchAfterPipBoyClose()
  // doesn't get stomped by this same observer reading a still-propagating
  // toggle as if it were a fresh user action (see g_companionTorchPending).
  {
    PlayerCharacter *player = PlayerCharacter::GetSingleton();
    if (player) {
      const bool torchOn = IsPipBoyLightOn(player);
      if (g_companionTorchPending) {
        if (torchOn == g_companionTorchDesired) {
          g_companionTorchPending = false;
          g_lastObservedTorchOn = torchOn;
        }
      } else if (torchOn != g_lastObservedTorchOn) {
        g_companionTorchDesired = torchOn;
        g_lastObservedTorchOn = torchOn;
      }
    }
  }

  DWORD now = GetTickCount();
  if (now - g_lastSnapshotTime >= SNAPSHOT_INTERVAL_MS) {
    g_lastSnapshotTime = now;
    if (!g_syncLockRequested.load() && ShouldSkipSnapshotDuringModMenu() &&
        !IsPipBoyMenuOpen()) {
      if (now - g_lastSnapshotSkipLogTime >= 1000) {
        PipBoyLog("SNAP",
                  "skip snapshot during mod gameplay menu (not container)");
        g_lastSnapshotSkipLogTime = now;
      }
      return;
    }
    try {
      std::string snapshot = BuildPlayerSnapshot();
      if (!snapshot.empty()) {
        std::lock_guard<std::mutex> lock(g_snapshotMutex);
        g_latestSnapshot = std::move(snapshot);
      }
    } catch (...) {
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NAMED PIPE SERVER (Background Thread)
// Creates a duplex named pipe: writes player snapshots to the companion app
// and reads Pip-Boy-initiated commands (use/equip/unequip) back from it.
// Identical protocol to the NV plugin. Also (re)tries attaching the
// main-thread pump until the game window exists.
// ═══════════════════════════════════════════════════════════════════════════════

void PipeServerThread() {
  PipBoyLog("PIPE", "Pipe server thread started");
  bool pumpLogged = false;
  while (g_running) {
    if (FO3TryInstallMainThreadPump(OnMainGameLoop, PUMP_INTERVAL_MS) &&
        !pumpLogged) {
      pumpLogged = true;
      PipBoyLog("PUMP", "main-thread pump attached (hwnd found)");
    }

    // Create pipe instance
    HANDLE hPipe = CreateNamedPipeA(PIPE_NAME, PIPE_ACCESS_DUPLEX,
                                    PIPE_TYPE_BYTE | PIPE_WAIT,
                                    1,     // Max instances
                                    65536, // Out buffer size (64KB)
                                    4096,  // In buffer size (commands)
                                    0,     // Default timeout
                                    NULL   // Default security
    );

    if (hPipe == INVALID_HANDLE_VALUE) {
      PipBoyLog("PIPE", "CreateNamedPipe failed, retrying");
      Sleep(5000);
      continue;
    }

    // Wait for the companion app to connect (blocking)
    BOOL connected =
        ConnectNamedPipe(hPipe, NULL)
            ? TRUE
            : (GetLastError() == ERROR_PIPE_CONNECTED ? TRUE : FALSE);

    if (connected) {
      PipBoyLog("PIPE", "Client connected");
      // Watchdog bookkeeping: if the pump never ticks while a client is
      // connected and a game is loaded, say so loudly instead of failing
      // silently (the pump is our only main-thread execution context).
      LONG lastPumpTicks = FO3PumpTicks();
      DWORD lastPumpCheck = GetTickCount();

      std::string lastSent;
      std::string readBuffer;
      while (g_running) {
        if (FO3TryInstallMainThreadPump(OnMainGameLoop, PUMP_INTERVAL_MS) &&
            !pumpLogged) {
          pumpLogged = true;
          PipBoyLog("PUMP", "main-thread pump attached (hwnd found)");
        }
        {
          DWORD now = GetTickCount();
          if (now - lastPumpCheck >= 5000) {
            LONG ticks = FO3PumpTicks();
            if (g_gameLoaded && ticks == lastPumpTicks)
              PipBoyLog("PUMP", "WARNING: main-thread pump has not ticked in "
                                "5s - commands/snapshots stalled");
            lastPumpTicks = ticks;
            lastPumpCheck = now;
          }
        }

        if (g_saveLoadPending.exchange(false)) {
          const char *loadMsg = "{\"event\":\"saveLoad\"}\n";
          DWORD written = 0;
          WriteFile(hPipe, loadMsg, (DWORD)strlen(loadMsg), &written, NULL);
          PipBoyLog("PIPE-OUT", "saveLoad event");
          lastSent.clear();
        }

        if (g_mainMenuPending.exchange(false)) {
          const char *mainMenuMsg = "{\"event\":\"mainMenu\"}\n";
          DWORD written = 0;
          WriteFile(hPipe, mainMenuMsg, (DWORD)strlen(mainMenuMsg), &written,
                    NULL);
          PipBoyLog("PIPE-OUT", "mainMenu event");
          lastSent.clear();
          {
            std::lock_guard<std::mutex> lock(g_snapshotMutex);
            g_latestSnapshot.clear();
          }
        }

        std::string snapshot;
        {
          std::lock_guard<std::mutex> lock(g_snapshotMutex);
          snapshot = g_latestSnapshot;
        }

        if (!snapshot.empty() && snapshot != lastSent) {
          PipBoyLogSnapshotOut(snapshot);
          lastSent = snapshot;
          snapshot += "\n"; // Newline delimiter for the client parser
          DWORD written;
          BOOL ok = WriteFile(hPipe, snapshot.c_str(), (DWORD)snapshot.size(),
                              &written, NULL);
          if (!ok)
            break; // Client disconnected
        }

        // Drain any incoming commands (non-blocking peek + read)
        DWORD bytesAvailable = 0;
        if (!PeekNamedPipe(hPipe, NULL, 0, NULL, &bytesAvailable, NULL)) {
          break; // Pipe broken - client disconnected
        }
        if (bytesAvailable > 0) {
          char buf[1024];
          DWORD bytesRead = 0;
          if (ReadFile(hPipe, buf, sizeof(buf) - 1, &bytesRead, NULL) &&
              bytesRead > 0) {
            readBuffer.append(buf, bytesRead);

            // Queue complete newline-delimited command lines
            size_t newline;
            while ((newline = readBuffer.find('\n')) != std::string::npos) {
              std::string line = readBuffer.substr(0, newline);
              readBuffer.erase(0, newline + 1);
              if (!line.empty() && line.back() == '\r')
                line.pop_back();
              PipBoyLog("PIPE-IN", "%s", line.c_str());
              if (line == "SYNC_LOCK") {
                g_syncLockRequested = true;
                PipBoyLog("SYNC", "SYNC_LOCK received");
              } else if (line == "SYNC_UNLOCK") {
                g_syncLockRequested = false;
                PipBoyLog("SYNC", "SYNC_UNLOCK received");
              } else if (!line.empty()) {
                std::lock_guard<std::mutex> lock(g_commandMutex);
                g_commandQueue.push_back(line);
              }
            }
          }
        }

        Sleep(PIPE_POLL_INTERVAL_MS);
      }
    }

    // Companion disconnected - drop any sync lock so the player isn't left
    // with disabled controls if the app closed mid-sync. The main loop
    // re-enables them on the next pump tick.
    g_syncLockRequested = false;
    PipBoyLog("PIPE", "Client disconnected");

    DisconnectNamedPipe(hPipe);
    CloseHandle(hPipe);
  }
  PipBoyLog("PIPE", "Pipe server thread stopped");
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND LOOKUP AT LOAD
// Every game command is located by name in the vanilla tables. A missing
// command disables its feature with a loud log - never a crash.
// ═══════════════════════════════════════════════════════════════════════════════

static void LookupGameCommands() {
  struct {
    CommandInfo **slot;
    const char *name;
    bool console;
  } wanted[] = {
      {&g_cmdCIOS, "CastImmediateOnSelf", false},
      {&g_cmdDispel, "Dispel", false},
      {&g_cmdHasPerk, "HasPerk", false},
  };
  for (auto &w : wanted) {
    *w.slot = w.console ? FindConsoleCommand(w.name) : FindScriptCommand(w.name);
    if (*w.slot)
      PipBoyLog("LOAD", "command %-22s -> opcode 0x%04X execute %p eval %p",
                w.name, (*w.slot)->opcode, (*w.slot)->execute,
                (*w.slot)->eval);
    else
      PipBoyLog("LOAD", "command %-22s NOT FOUND - dependent feature disabled",
                w.name);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FOSE MESSAGE HANDLER
// Listens for game lifecycle events (load, save, new game, exit). Real signal
// when the installed FOSE runtime provides kInterface_Messaging,
// OnMainGameLoop's live parentCell check covers the same ground independently
// in case it doesn't, so nothing here is load-bearing on its own.
// ═══════════════════════════════════════════════════════════════════════════════

static void MessageHandler(FOSEMessagingInterface::Message *msg) {
  switch (msg->type) {
  case FOSEMessagingInterface::kMessage_PreLoadGame:
    PipBoyLog("MSG", "PreLoadGame");
    g_syncLockRequested = false;
    ResetSyncLockState(true);
    break;
  case FOSEMessagingInterface::kMessage_PostLoadGame:
    PipBoyLog("MSG", "PostLoadGame");
    g_gameLoaded = true;
    g_saveLoadPending = true;
    // A different save may be a different character - re-locate the light
    // spell (mod added/removed) on the next use.
    g_pipBoyLightSearched = false;
    ResetSyncLockState(true);
    {
      std::lock_guard<std::mutex> lock(g_snapshotMutex);
      g_latestSnapshot.clear();
    }
    break;
  case FOSEMessagingInterface::kMessage_NewGame:
    PipBoyLog("MSG", "NewGame");
    g_gameLoaded = true;
    g_saveLoadPending = true;
    g_pipBoyLightSearched = false;
    ResetSyncLockState(true);
    {
      std::lock_guard<std::mutex> lock(g_snapshotMutex);
      g_latestSnapshot.clear();
    }
    break;
  case FOSEMessagingInterface::kMessage_ExitGame:
  case FOSEMessagingInterface::kMessage_ExitGame_Console:
    PipBoyLog("MSG", "ExitGame");
    g_gameLoaded = false;
    g_syncLockRequested = false;
    g_mainMenuPending = true;
    ResetSyncLockState(true);
    break;
  case FOSEMessagingInterface::kMessage_ExitToMainMenu:
    PipBoyLog("MSG", "ExitToMainMenu");
    g_gameLoaded = false;
    g_syncLockRequested = false;
    g_mainMenuPending = true;
    ResetSyncLockState(true);
    break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLUGIN ENTRY POINTS (FOSE)
// ═══════════════════════════════════════════════════════════════════════════════

extern "C" {

/**
 * Called by FOSE to verify plugin compatibility.
 */
__declspec(dllexport) bool FOSEPlugin_Query(const FOSEInterface *fose,
                                            PluginInfo *info) {
  info->infoVersion = PluginInfo::kInfoVersion;
  info->name = PLUGIN_NAME;
  info->version = PLUGIN_VERSION;

  // Don't load in the GECK (editor)
  if (fose->isEditor) {
    return false;
  }

  // This build carries engine data for Fallout 3 1.7.0.3 only.
  if (fose->runtimeVersion != FALLOUT_VERSION_1_7) {
    PipBoyLogInit();
    PipBoyLog("LOAD", "unsupported runtime version %08X (need %08X / 1.7.0.3)",
              fose->runtimeVersion, FALLOUT_VERSION_1_7);
    return false;
  }

  return true;
}

/**
 * Called by FOSE after successful query. Registers for messages, resolves
 * the vanilla command handlers, and starts the pipe server thread.
 */
__declspec(dllexport) bool FOSEPlugin_Load(const FOSEInterface *fose) {
  g_fose = fose;
  PipBoyLogInit();
  PipBoyLog("LOAD", "FOSEPlugin_Load called (fose %08X, runtime %08X)",
            fose->foseVersion, fose->runtimeVersion);

  g_pluginHandle = fose->GetPluginHandle();

  // Messaging interface for lifecycle events. NULL on older FOSE runtimes
  // (pre-1.3b2) that don't provide kInterface_Messaging - OnMainGameLoop's
  // live parentCell check covers g_gameLoaded independently either way, so
  // this is a nice-to-have, not a requirement.
  g_msgIntfc =
      (FOSEMessagingInterface *)fose->QueryInterface(kInterface_Messaging);
  if (g_msgIntfc) {
    g_msgIntfc->RegisterListener(g_pluginHandle, "FOSE", MessageHandler);
  } else {
    PipBoyLog("LOAD", "messaging interface unavailable - save/load events "
                      "will not be relayed (falling back to live detection)");
  }

  LookupGameCommands();

  // Start the Named Pipe server on a background thread
  g_pipeThread = std::thread(PipeServerThread);
  g_pipeThread.detach();
  PipBoyLog("LOAD", "Plugin loaded (version %d)", PLUGIN_VERSION);

  return true;
}

}

// ═══════════════════════════════════════════════════════════════════════════════
// DLL ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID lpReserved) {
  switch (reason) {
  case DLL_PROCESS_ATTACH:
    g_hModule = hModule;
    DisableThreadLibraryCalls(hModule);
    break;
  case DLL_PROCESS_DETACH:
    g_running = false;
    {
      std::lock_guard<std::mutex> lock(g_logMutex);
      if (g_logFile) {
        fprintf(g_logFile, "=== FalloutPipBoySync (FO3) shutdown ===\n");
        fclose(g_logFile);
        g_logFile = nullptr;
      }
    }
    break;
  }
  return TRUE;
}
