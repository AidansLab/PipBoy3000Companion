/**
 * main.cpp — xNVSE Plugin for Fallout New Vegas Pip-Boy 3000 Sync
 *
 * This plugin hooks into Fallout: New Vegas via xNVSE to read the player's
 * stats and inventory, then writes JSON snapshots to a Windows Named Pipe
 * for the companion app to consume.
 *
 * BUILD REQUIREMENTS:
 * - Visual Studio 2019 or 2022 with C++ Desktop Development workload
 * - xNVSE SDK: https://github.com/xNVSE/NVSE
 * - Target platform: x86 (32-bit) — Fallout NV is 32-bit
 *
 * BUILD STEPS:
 * 1. Clone xNVSE: git clone https://github.com/xNVSE/NVSE.git
 * 2. Open this project in Visual Studio
 * 3. Set include paths to point to the xNVSE source (nvse/ directory)
 * 4. Build as Release x86
 * 5. Copy the resulting .dll to <FNV>/Data/NVSE/Plugins/
 *
 * The plugin creates a Named Pipe at: \\.\pipe\FalloutPipBoySync
 * The companion app connects to this pipe to receive player data.
 */

#include <atomic>
#include <cmath>
#include <iomanip>
#include <mutex>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <vector>
#include <windows.h>

// ═══════════════════════════════════════════════════════════════════════════════
// xNVSE SDK HEADERS
// Adjust the include path to match where you've cloned the xNVSE repo.
// ═══════════════════════════════════════════════════════════════════════════════

#include "nvse/GameAPI.h"
#include "nvse/GameData.h"
#include "nvse/GameExtraData.h"
#include "nvse/GameForms.h"
#include "nvse/GameObjects.h"
#include "nvse/GameProcess.h"
#include "nvse/GameRTTI.h"
#include "nvse/GameScript.h"
#include "nvse/GameUI.h"
#include "nvse/PluginAPI.h"
#include "nvse/Utilities.h"

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

#define PLUGIN_NAME "FalloutPipBoySync"
#define PLUGIN_VERSION 1

// How often to snapshot player state (in milliseconds)
#define SNAPSHOT_INTERVAL_MS 250

// How often the pipe thread checks whether the snapshot changed (in
// milliseconds). Snapshots are only written to the pipe when they differ from
// the last one sent, so a short poll here costs almost nothing but keeps
// end-to-end latency low.
#define PIPE_POLL_INTERVAL_MS 50

// Named pipe path
#define PIPE_NAME "\\\\.\\pipe\\FalloutPipBoySync"

// ═══════════════════════════════════════════════════════════════════════════════
// ACTOR VALUES
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
  kAV_Karma = 23,
  kAV_InventoryWeight = 46,

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
  kAV_Guns = 41,
  kAV_Sneak = 42,
  kAV_Speech = 43,
  kAV_Survival = 44,
  kAV_Unarmed = 45,
};

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════════════════════════

static HMODULE g_hModule = NULL;
static NVSEInterface *g_nvse = NULL;
static NVSEMessagingInterface *g_msgIntfc = NULL;

static std::atomic<bool> g_running(true);
static std::mutex g_snapshotMutex;
static std::string g_latestSnapshot;
static std::thread g_pipeThread;
static bool g_gameLoaded = false;
static DWORD g_lastSnapshotTime = 0;
static std::atomic<bool> g_saveLoadPending(false);

// Set by the companion app (SYNC_LOCK / SYNC_UNLOCK) while it performs the
// initial Pip-Boy sync. Disables player controls and shows a "please wait"
// message so the player can't move or act mid-sync. Reconciled on the main
// thread in MainGameLoop; auto-cleared if the companion disconnects so the
// player is never left stuck.
static std::atomic<bool> g_syncLockRequested(false);

// Commands received from the companion app (Pip-Boy initiated actions).
// Queued by the pipe thread, executed on the main thread in MainGameLoop —
// calling game functions from a background thread is unsafe.
static std::mutex g_commandMutex;
static std::vector<std::string> g_commandQueue;

// ═══════════════════════════════════════════════════════════════════════════════
// JSON HELPER (Minimal — no external dependencies)
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
// UTILITY: Get the record type string for a TESForm
// ═══════════════════════════════════════════════════════════════════════════════

static const char *GetFormTypeString(UInt8 typeID) {
  switch (typeID) {
  case kFormType_TESObjectWEAP:
    return "WEAP";
  case kFormType_TESObjectARMO:
    return "ARMO";
  case kFormType_TESAmmo:
    return "AMMO";
  case kFormType_AlchemyItem:
    return "AID";
  case kFormType_TESObjectMISC:
    return "MISC";
  case kFormType_TESObjectBOOK:
    return "BOOK";
  case kFormType_TESKey:
    return "KEYM";
  case kFormType_BGSNote:
    return "NOTE";
  default:
    return "MISC";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIP-BOY LIGHT (in-game flashlight)
// Same approach as JIP LN NVSE TogglePipBoyLight: check whether the PipBoyLight
// spell effect is active on the player.
// ═══════════════════════════════════════════════════════════════════════════════

static bool IsPipBoyLightOn(PlayerCharacter *player) {
  if (!player)
    return false;

  SpellItem *pipBoyLight = *(SpellItem **)0x11C358C;
  if (!pipBoyLight)
    return false;

  return ThisStdCall<bool>(0x822B90, &player->magicTarget, &pipBoyLight->magicItem,
                           1);
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

  // Game identifier
  // NOTE: no timestamp field — the snapshot must be byte-identical when the
  // player state hasn't changed, so the pipe thread can skip redundant sends.
  json.keyStr("game", "FNV");

  // ─── Player attributes ─────────────────────────────────────────────
  json.key("player");
  json.beginObject();
  {
    // Player name
    const char *name = GetFullName(player);
    bool hasValidName = name && name[0] != '\0' &&
                        strcmp(name, "<no name>") != 0 &&
                        strcmp(name, "<NULL>") != 0;
    json.keyStr("name", hasValidName ? name : "Courier");

    // Level
    json.keyInt("level", player->avOwner.Fn_0A());

    // Hit Points
    // hp is emitted as a whole number: FNV heals in fractional ticks
    // (e.g. +0.1/sec regen), and emitting decimals would make every tick
    // look like a changed snapshot, spamming the pipe and serial link.
    // Rounded UP to match the game HUD, which displays ceil(health)
    // (you survive at 0.4 HP showing "1", never "0").
    float maxHP = player->avOwner.Fn_01(kAV_Health);
    float curHP = player->avOwner.Fn_03(kAV_Health);
    json.keyInt("hp", (int)ceilf(curHP));
    json.keyFloat("maxHP", maxHP);

    // Action Points
    float maxAP = player->avOwner.Fn_01(kAV_ActionPoints);
    float curAP = player->avOwner.Fn_03(kAV_ActionPoints);
    json.keyFloat("ap", curAP);
    json.keyFloat("maxAP", maxAP);

    // Carry Weight
    // maxWg is the max carry weight AV (includes Strong Back / implants / buffs).
    float maxWg = player->avOwner.Fn_01(kAV_CarryWeight);
    json.keyInt("maxWg", (int)(maxWg + 0.5f));
    // wg is the player's actual carried inventory weight, taken straight from
    // the engine (AV 46). This is authoritative — it counts every item the
    // player is carrying, including modded items the Pip-Boy doesn't know about.
    // Rounded to a whole number so float jitter doesn't spam the pipe/serial.
    float curWg = player->avOwner.Fn_03(kAV_InventoryWeight);
    json.keyInt("wg", (int)(curWg + 0.5f));

    // Karma
    float karma = player->avOwner.Fn_03(kAV_Karma);
    json.keyFloat("karma", karma);

    // Limb Conditions (0-100 percentage)
    json.keyFloat("perceptioncondition",
                  player->avOwner.Fn_03(kAV_PerceptionCondition));
    json.keyFloat("endurancecondition",
                  player->avOwner.Fn_03(kAV_EnduranceCondition));
    json.keyFloat("leftattackcondition",
                  player->avOwner.Fn_03(kAV_LeftAttackCondition));
    json.keyFloat("rightattackcondition",
                  player->avOwner.Fn_03(kAV_RightAttackCondition));
    json.keyFloat("leftmobilitycondition",
                  player->avOwner.Fn_03(kAV_LeftMobilityCondition));
    json.keyFloat("rightmobilitycondition",
                  player->avOwner.Fn_03(kAV_RightMobilityCondition));

    // Pip-Boy flashlight (hold Pip-Boy key / toggle hotkey in-game)
    json.key("torch");
    json.valueBool(IsPipBoyLightOn(player));

    // XP — xNVSE doesn't expose this directly via simple AV,
    // but we can try to read it from the player's level data.
    // For now we'll set a placeholder; this needs refinement.
    json.keyInt("xpNext", 0);

    // S.P.E.C.I.A.L. stats (Base Levels)
    json.key("special");
    json.beginObject();
    {
      json.keyInt("ST", (int)player->avOwner.Fn_01(kAV_Strength));
      json.keyInt("PE", (int)player->avOwner.Fn_01(kAV_Perception));
      json.keyInt("EN", (int)player->avOwner.Fn_01(kAV_Endurance));
      json.keyInt("CH", (int)player->avOwner.Fn_01(kAV_Charisma));
      json.keyInt("IN", (int)player->avOwner.Fn_01(kAV_Intelligence));
      json.keyInt("AG", (int)player->avOwner.Fn_01(kAV_Agility));
      json.keyInt("LK", (int)player->avOwner.Fn_01(kAV_Luck));
    }
    json.endObject();

    // Skills (Base Levels)
    json.key("skills");
    json.beginObject();
    {
      json.keyInt("barter", (int)player->avOwner.Fn_01(kAV_Barter));
      json.keyInt("energyweapons",
                  (int)player->avOwner.Fn_01(kAV_EnergyWeapons));
      json.keyInt("explosives", (int)player->avOwner.Fn_01(kAV_Explosives));
      json.keyInt("lockpick", (int)player->avOwner.Fn_01(kAV_Lockpick));
      json.keyInt("medicine", (int)player->avOwner.Fn_01(kAV_Medicine));
      json.keyInt("meleeweapons", (int)player->avOwner.Fn_01(kAV_MeleeWeapons));
      json.keyInt("repair", (int)player->avOwner.Fn_01(kAV_Repair));
      json.keyInt("science", (int)player->avOwner.Fn_01(kAV_Science));
      json.keyInt("guns", (int)player->avOwner.Fn_01(kAV_Guns));
      json.keyInt("sneak", (int)player->avOwner.Fn_01(kAV_Sneak));
      json.keyInt("speech", (int)player->avOwner.Fn_01(kAV_Speech));
      json.keyInt("survival", (int)player->avOwner.Fn_01(kAV_Survival));
      json.keyInt("unarmed", (int)player->avOwner.Fn_01(kAV_Unarmed));
    }
    json.endObject();

    // ─── Equipped items (integer form IDs for Pip-Boy sync) ──────────
    TESObjectWEAP *eqWeapon = player->GetEquippedWeapon();
    json.keyInt("equippedweap", eqWeapon ? (int)eqWeapon->refID : 0);

    // ─── Weapon ammo (for Pip-Boy ammo selection) ────────────────────
    // A weapon's ammo is a BGSAmmoForm whose inner form is either a single
    // TESAmmo or a BGSListForm of several TESAmmo (e.g. the 10mm pistol can
    // take standard / JHP / hand load). "current" is the ammo actually loaded
    // right now; "usable" is every ammo type the equipped weapon accepts. The
    // Pip-Boy uses these to restrict selection and dim unusable ammo.
    json.key("weaponammo");
    json.beginObject();
    {
      UInt32 currentAmmo = 0;
      if (player->baseProcess) {
        BaseProcess::AmmoInfo *ammoInfo = player->baseProcess->GetAmmoInfo();
        if (ammoInfo && ammoInfo->ammo)
          currentAmmo = ammoInfo->ammo->refID;
      }
      json.keyInt("current", (int)currentAmmo);

      json.key("usable");
      json.beginArray();
      if (eqWeapon) {
        TESForm *ammoForm = eqWeapon->ammo.ammo;
        if (ammoForm) {
          if (ammoForm->typeID == kFormType_BGSListForm) {
            BGSListForm *ammoList = (BGSListForm *)ammoForm;
            UInt32 ammoCount = ammoList->Count();
            for (UInt32 i = 0; i < ammoCount; i++) {
              TESForm *f = ammoList->GetNthForm(i);
              if (f)
                json.arrayElementInt((int)f->refID);
            }
          } else if (ammoForm->typeID == kFormType_TESAmmo) {
            json.arrayElementInt((int)ammoForm->refID);
          }
        }
      }
      json.endArray();
    }
    json.endObject();

    json.key("equippedapparel");
    json.beginArray();
    {
      ExtraContainerDataArray equipped = player->GetEquippedEntryDataList();
      std::set<UInt32> seenApparel;
      for (size_t i = 0; i < equipped.size(); i++) {
        ExtraContainerChanges::EntryData *entry = equipped[i];
        if (!entry || !entry->type)
          continue;
        if (entry->type->typeID == kFormType_TESObjectWEAP)
          continue;
        if (entry->type->typeID != kFormType_TESObjectARMO)
          continue;
        UInt32 apparelId = entry->type->refID;
        if (seenApparel.count(apparelId))
          continue;
        seenApparel.insert(apparelId);
        json.arrayElementInt((int)apparelId);
      }
    }
    json.endArray();
  }
  json.endObject();

  // ─── Inventory ─────────────────────────────────────────────────────
  json.key("inventory");
  json.beginArray();
  {
    ExtraContainerChanges *containerChanges =
        (ExtraContainerChanges *)player->extraDataList.GetByType(
            kExtraData_ContainerChanges);

    if (containerChanges && containerChanges->data &&
        containerChanges->data->objList) {
      auto *entryList = containerChanges->data->objList;

      for (auto iter = entryList->Begin(); !iter.End(); ++iter) {
        auto *entry = iter.Get();
        if (!entry || !entry->type)
          continue;

        TESForm *baseForm = entry->type;
        UInt32 formId = baseForm->refID;
        int count = entry->countDelta;

        if (count <= 0)
          continue; // Skip removed items

        // Get item condition (health percentage)
        float condition = 100.0f;
        if (entry->extendData) {
          for (auto extIter = entry->extendData->Begin(); !extIter.End();
               ++extIter) {
            auto *extraDataList = extIter.Get();
            if (extraDataList) {
              ExtraHealth *healthData =
                  (ExtraHealth *)extraDataList->GetByType(kExtraData_Health);
              if (healthData) {
                condition = healthData->health;
                break;
              }
            }
          }
        }

        json.arrayElement();
        json.beginObject();
        json.keyStr("formId", FormatFormId(formId));
        json.keyStr("type", GetFormTypeString(baseForm->typeID));
        json.keyInt("count", count);
        json.keyFloat("condition", condition);
        json.endObject();
      }
    }
  }
  json.endArray();

  // ─── Perks ─────────────────────────────────────────────────────────
  json.key("perks");
  json.beginArray();
  {
    DataHandler *dataHandler = DataHandler::Get();
    if (dataHandler) {
      for (auto iter = dataHandler->perkList.Begin(); !iter.End(); ++iter) {
        BGSPerk *perk = iter.Get();
        if (perk) {
          UInt8 rank = player->GetPerkRank(perk, false);
          if (rank > 0) {
            json.arrayElement();
            json.beginObject();
            json.keyStr("formId", FormatFormId(perk->refID));
            json.keyInt("rank", rank);
            json.endObject();
          }
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
// Direct EquipItem/UnequipItem calls update game data but do not repaint the
// open Pip-Boy menus. Mirror JIP LN NVSE's RefreshItemListBox (used by the
// RefreshItemsList script command) so item counts and the HP header update
// immediately without switching tabs.
// ═══════════════════════════════════════════════════════════════════════════════

static void RefreshPipBoyUI() {
  if (InterfaceManager::IsMenuVisible(kMenuType_Inventory)) {
    // InventoryMenu::Refresh — rebuilds the item list
    CdeclCall(0x782A90);
    // HP shown in the Pip-Boy chrome is sourced from stats menu data; refresh
    // it even while the ITEMS tab is active (tab-switching did this implicitly)
    if (Menu *statsMenu = InterfaceManager::GetMenuByType(kMenuType_Stats))
      ThisStdCall(0x7DF230, statsMenu, 4);
  } else if (InterfaceManager::IsMenuVisible(kMenuType_Stats)) {
    if (Menu *statsMenu = InterfaceManager::GetMenuByType(kMenuType_Stats))
      ThisStdCall(0x7DF230, statsMenu, 4);
  } else if (InterfaceManager::IsMenuVisible(kMenuType_Map)) {
    if (Menu *mapMenu = InterfaceManager::GetMenuByType(kMenuType_Map))
      ThisStdCall(0x79DBB0, mapMenu);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VANILLA EQUIP COMMANDS
// Direct Actor::EquipItem() does not run the full worn-item pipeline that the
// in-game Pip-Boy uses, so in-game equips won't conflict and the model won't
// update. Route through the game's own equipitem / unequipitem script commands
// (same path as the console and GECK) via Script::RunScriptLine2.
// ═══════════════════════════════════════════════════════════════════════════════

static bool RunVanillaItemCommand(PlayerCharacter *player, TESForm *form,
                                  bool equip) {
  std::stringstream ss;
  // Run with player as thisObj — same as an actor script calling EquipItem
  ss << (equip ? "EquipItem " : "UnequipItem ") << std::hex << std::uppercase
     << std::setfill('0') << std::setw(8) << form->refID;
  return Script::RunScriptLine2(ss.str().c_str(), player, true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIP-BOY COMMAND EXECUTION
// Executes a command line received from the companion app. Lines look like:
//   "USE 0x0001519e"      — consume an aid item (EquipItem on an ingestible)
//   "EQUIP 0x0000434f"    — equip a weapon/apparel
//   "UNEQUIP 0x000340c8"  — unequip a weapon/apparel
// MUST be called from the main game thread.
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// INITIAL-SYNC LOCK
// While the companion app runs the initial sync it sends SYNC_LOCK; we disable
// the player's controls and keep a "please wait" message on screen until it
// sends SYNC_UNLOCK (or disconnects). Must run on the main game thread.
// ═══════════════════════════════════════════════════════════════════════════════

static const char *SYNC_WAIT_MESSAGE = "Please wait for initial Pip-Boy sync";
static bool g_syncControlsDisabled = false;
static DWORD g_lastSyncMsgTime = 0;

static void ApplySyncLock(bool wantLock) {
  PlayerCharacter *player = PlayerCharacter::GetSingleton();
  if (!player)
    return;

  if (wantLock) {
    if (!g_syncControlsDisabled) {
      // Disable movement, Pip-Boy, fighting, POV switch, looking, rollover and
      // sneaking — a full "cutscene" style lock so nothing can be done.
      Script::RunScriptLine2("DisablePlayerControls 1 1 1 1 1 1 1", player, true);
      g_syncControlsDisabled = true;
      g_lastSyncMsgTime = 0; // show the message immediately
    }
    // HUD messages fade out, so re-post periodically to keep it on screen for
    // the whole sync.
    DWORD now = GetTickCount();
    if (now - g_lastSyncMsgTime >= 3500) {
      g_lastSyncMsgTime = now;
      QueueUIMessage(SYNC_WAIT_MESSAGE, 0, NULL, NULL, 4.0f, true);
    }
  } else if (g_syncControlsDisabled) {
    Script::RunScriptLine2("EnablePlayerControls 1 1 1 1 1 1 1", player, true);
    g_syncControlsDisabled = false;
  }
}

static void ExecutePipBoyCommand(const std::string &line) {
  size_t space = line.find(' ');
  if (space == std::string::npos)
    return;

  std::string verb = line.substr(0, space);
  UInt32 formId = (UInt32)strtoul(line.substr(space + 1).c_str(), NULL, 16);
  if (formId == 0)
    return;

  PlayerCharacter *player = PlayerCharacter::GetSingleton();
  TESForm *form = LookupFormByID(formId);
  if (!player || !form)
    return;

  if (verb == "USE" || verb == "EQUIP") {
    // USE (ingestibles) and EQUIP both go through vanilla equipitem
    if (!RunVanillaItemCommand(player, form, true))
      player->EquipItem(form, 1, NULL, 1, false, 1);
  } else if (verb == "UNEQUIP") {
    if (!RunVanillaItemCommand(player, form, false))
      player->UnequipItem(form, 1, NULL, 1, false, 1);
  }

  RefreshPipBoyUI();
}

// ═══════════════════════════════════════════════════════════════════════════════
// NAMED PIPE SERVER (Background Thread)
// Creates a duplex named pipe: writes player snapshots to the companion app and
// reads Pip-Boy-initiated commands (use/equip/unequip) back from it.
// ═══════════════════════════════════════════════════════════════════════════════

void PipeServerThread() {
  while (g_running) {
    // Create pipe instance
    HANDLE hPipe = CreateNamedPipeA(
        PIPE_NAME, PIPE_ACCESS_DUPLEX, PIPE_TYPE_BYTE | PIPE_WAIT,
        1,     // Max instances
        65536, // Out buffer size (64KB)
        4096,  // In buffer size (commands from companion app)
        0,     // Default timeout
        NULL   // Default security
    );

    if (hPipe == INVALID_HANDLE_VALUE) {
      Sleep(5000);
      continue;
    }

    // Wait for the companion app to connect (blocking)
    BOOL connected =
        ConnectNamedPipe(hPipe, NULL)
            ? TRUE
            : (GetLastError() == ERROR_PIPE_CONNECTED ? TRUE : FALSE);

    if (connected) {
      // Client connected — push snapshots until disconnected.
      // Poll frequently but only write when the snapshot actually changed,
      // so the companion app hears about changes within ~PIPE_POLL_INTERVAL_MS
      // instead of waiting out a fixed broadcast interval.
      std::string lastSent;
      std::string readBuffer;
      while (g_running) {
        if (g_saveLoadPending.exchange(false)) {
          const char *loadMsg = "{\"event\":\"saveLoad\"}\n";
          DWORD written = 0;
          WriteFile(hPipe, loadMsg, (DWORD)strlen(loadMsg), &written, NULL);
          lastSent.clear();
        }

        std::string snapshot;
        {
          std::lock_guard<std::mutex> lock(g_snapshotMutex);
          snapshot = g_latestSnapshot;
        }

        if (!snapshot.empty() && snapshot != lastSent) {
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
          break; // Pipe broken — client disconnected
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
              if (line == "SYNC_LOCK") {
                g_syncLockRequested = true;
              } else if (line == "SYNC_UNLOCK") {
                g_syncLockRequested = false;
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

    // Companion disconnected — drop any sync lock so the player isn't left with
    // disabled controls if the app closed mid-sync. The main loop re-enables
    // them on the next frame.
    g_syncLockRequested = false;

    DisconnectNamedPipe(hPipe);
    CloseHandle(hPipe);
  }
}

// (SnapshotThread removed, polling moved to MainGameLoop hook)

// ═══════════════════════════════════════════════════════════════════════════════
// NVSE MESSAGE HANDLER
// Listens for game lifecycle events (load, save, new game, etc.)
// ═══════════════════════════════════════════════════════════════════════════════

void MessageHandler(NVSEMessagingInterface::Message *msg) {
  switch (msg->type) {
  case NVSEMessagingInterface::kMessage_PostLoadGame:
    g_gameLoaded = true;
    g_saveLoadPending = true;
    {
      std::lock_guard<std::mutex> lock(g_snapshotMutex);
      g_latestSnapshot.clear();
    }
    break;
  case NVSEMessagingInterface::kMessage_NewGame:
    g_gameLoaded = true;
    g_saveLoadPending = true;
    {
      std::lock_guard<std::mutex> lock(g_snapshotMutex);
      g_latestSnapshot.clear();
    }
    break;
  case NVSEMessagingInterface::kMessage_ExitGame:
    g_gameLoaded = false;
    break;
  case NVSEMessagingInterface::kMessage_ExitToMainMenu:
    g_gameLoaded = false;
    break;
  case NVSEMessagingInterface::kMessage_MainGameLoop:
    if (g_gameLoaded) {
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

      DWORD now = GetTickCount();
      if (now - g_lastSnapshotTime >= SNAPSHOT_INTERVAL_MS) {
        g_lastSnapshotTime = now;
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
    break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLUGIN ENTRY POINTS (xNVSE)
// ═══════════════════════════════════════════════════════════════════════════════

extern "C" {

/**
 * Called by xNVSE to verify plugin compatibility.
 * Must fill in the PluginInfo structure and return true if compatible.
 */
__declspec(dllexport) bool NVSEPlugin_Query(const NVSEInterface *nvse,
                                            PluginInfo *info) {
  info->infoVersion = PluginInfo::kInfoVersion;
  info->name = PLUGIN_NAME;
  info->version = PLUGIN_VERSION;

  // Don't load in the GECK (editor)
  if (nvse->isEditor) {
    return false;
  }

  // Version check — require xNVSE 6.x+
  if (nvse->nvseVersion < 0x06000000) {
    return false;
  }

  return true;
}

/**
 * Called by xNVSE after successful query. This is where we set up
 * our hooks, start background threads, and register for messages.
 */
__declspec(dllexport) bool NVSEPlugin_Load(NVSEInterface *nvse) {
  g_nvse = nvse;

  // Get the messaging interface for lifecycle events
  g_msgIntfc =
      (NVSEMessagingInterface *)nvse->QueryInterface(kInterface_Messaging);

  if (g_msgIntfc) {
    g_msgIntfc->RegisterListener(nvse->GetPluginHandle(), "NVSE",
                                 MessageHandler);
  }

  // Start the Named Pipe server on a background thread
  g_pipeThread = std::thread(PipeServerThread);
  g_pipeThread.detach();

  return true;
}

} // extern "C"

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
    break;
  }
  return TRUE;
}
