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
#include <unordered_map>
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
#define PLUGIN_VERSION 16

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

static NVSEScriptInterface *g_scriptInterface = nullptr;

// Pip-Boy GENERAL screen order (must match FW/GENERAL-decoded.js and REP.IMG).
struct FactionRepDef {
  const char *name;
  UInt32 repFormId; // REPU form ID (vanilla base-game)
};

static const FactionRepDef kFactionReps[] = {
    {"Boomers", 0x000FFAE8},
    {"Brotherhood of Steel", 0x0011E662},
    {"Caesar's Legion", 0x000F43DD},
    {"Followers of the Apocalypse", 0x00124AD1},
    {"Freeside", 0x00129A7A},
    {"Goodsprings", 0x00104C22},
    {"Great Khans", 0x0011989B},
    {"NCR", 0x000F43DE},
    {"Novac", 0x00129A79},
    {"Powder Gangers", 0x001558E6},
    {"Primm", 0x000F2406},
    {"The Strip", 0x00118F61},
    {"White Glove Society", 0x00116F16},
};

static const char *GetReputationEditorId(UInt32 formId) {
  TESForm *form = LookupFormByID(formId);
  if (!form)
    return nullptr;
  const char *edid = form->GetEditorID();
  if (!edid || !edid[0])
    return nullptr;
  return edid;
}

static std::unordered_map<std::string, Script *> g_exprScriptCache;

// Evaluate a one-line NVSE expression (SetFunctionValue wrapper) on the player.
static bool EvalExprNumber(const char *expr, double *out) {
  PlayerCharacter *player = PlayerCharacter::GetSingleton();
  if (!g_scriptInterface || !player || !expr || !out)
    return false;

  Script *scr = nullptr;
  auto it = g_exprScriptCache.find(expr);
  if (it != g_exprScriptCache.end()) {
    scr = it->second;
  } else {
    scr = g_scriptInterface->CompileExpression(expr);
    if (!scr)
      return false;
    g_exprScriptCache[expr] = scr;
  }

  NVSEArrayVarInterface::Element result;
  if (!g_scriptInterface->CallFunction(scr, player, nullptr, &result, 0))
    return false;
  if (result.GetType() != NVSEArrayVarInterface::Element::kType_Numeric)
    return false;

  *out = result.GetNumber();
  return true;
}

static int EvalReputationValue(UInt32 repFormId, const char *repEditorId,
                               int fameOrInfamy) {
  char expr[128];
  double v = 0.0;

  // Console/GECK use the REPU form ID (e.g. GetReputation 001558E6 0).
  _snprintf_s(expr, _TRUNCATE, "GetReputation %08X %d",
              repFormId & 0x00FFFFFF, fameOrInfamy);
  if (EvalExprNumber(expr, &v))
    goto done;

  if (repEditorId) {
    _snprintf_s(expr, _TRUNCATE, "GetReputation %s %d", repEditorId,
                fameOrInfamy);
    if (EvalExprNumber(expr, &v))
      goto done;
  }
  return 0;

done:
  if (v < 0.0)
    v = 0.0;
  if (v > 100.0)
    v = 100.0;
  return (int)(v + 0.5);
}

static int EvalReputationThreshold(UInt32 repFormId, const char *repEditorId,
                                   int axis) {
  char expr[128];
  double v = 0.0;

  _snprintf_s(expr, _TRUNCATE, "GetReputationThreshold %08X %d",
              repFormId & 0x00FFFFFF, axis);
  if (EvalExprNumber(expr, &v))
    goto done;

  if (repEditorId) {
    _snprintf_s(expr, _TRUNCATE, "GetReputationThreshold %s %d", repEditorId,
                axis);
    if (EvalExprNumber(expr, &v))
      goto done;
  }
  return 1;

done:
  if (v < 0.0)
    v = 0.0;
  if (v > 6.0)
    v = 6.0;
  return (int)(v + 0.5);
}

static bool IsFactionDiscovered(int fame, int infamy, int goodThr, int badThr,
                                int mixedThr) {
  return fame > 0 || infamy > 0 || goodThr > 1 || badThr > 1 || mixedThr > 1;
}

// Map game reputation thresholds to Pip-Boy REP.JSON tier index (0–15).
static int ComputePipRepTier(int fame, int infamy, int goodThr, int badThr,
                             int mixedThr) {
  if (badThr >= 2) {
    switch (badThr) {
    case 6:
      return 15; // Vilified
    case 5:
      return 14; // Hated
    case 4:
      return 11; // Shunned
    case 3:
      return 13; // Merciful Thug
    case 2:
      return 12; // Sneering Punk
    default:
      return 5;
    }
  }
  if (goodThr >= 2) {
    switch (goodThr) {
    case 6:
      return 0; // Idolized
    case 5:
      return 1; // Liked
    case 4:
      return 2; // Accepted
    case 3:
      return 3; // Good-Natured Rascal
    case 2:
      return 4; // Smiling Troublemaker
    default:
      return 5;
    }
  }
  if (mixedThr >= 2) {
    switch (mixedThr) {
    case 5:
      return 9; // Wild Child
    case 4:
      return 8; // Unpredictable
    case 3:
      return 6; // Mixed
    case 2:
      return (fame >= infamy) ? 7 : 10; // Dark Hero / Soft-Hearted Devil
    default:
      return 5;
    }
  }
  return 5; // Neutral
}

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

static SpellItem *GetPipBoyLightSpell() {
  return *(SpellItem **)0x11C358C;
}

#if defined(_M_IX86)
// Globals for the asm toggle — do NOT read turnON from the stack inside the naked
// function; calling it from __try shifts the frame and breaks OFF (UI refresh was
// re-enabling the light with a garbage edx value).
static UInt32 s_turnONForToggle = 0;
static void *s_pipboyManagerForToggle = nullptr;

// Engine-native Pip-Boy light toggle — copied from JIP LN NVSE TogglePipBoyLight.
__declspec(naked) static void __fastcall
EngineTogglePipBoyLight(PlayerCharacter *thePlayer, SpellItem *pipBoyLight,
                        UInt32 turnON) {
  __asm {
    push 0
    cmp dword ptr s_turnONForToggle, 0
    jz turnOFF
    push edx
    add ecx, 0x88
    mov eax, [ecx]
    call dword ptr [eax]
    jmp finish
  turnOFF:
    push 0
    add edx, 0x18
    push edx
    add ecx, 0x94
    mov eax, 0x824400
    call eax
  finish:
    mov ecx, dword ptr s_pipboyManagerForToggle
    mov edx, dword ptr s_turnONForToggle
    push 1
    push edx
    push 0
    push ecx
    push 1
    push edx
    push 1
    mov eax, 0x7FA310
    call eax
    pop ecx
    mov eax, 0x7FA310
    call eax
    ret 4
  }
}
#endif

static void PlayPipBoyLightSound(PlayerCharacter *player, bool wantOn) {
  if (!player)
    return;
  // SystemSound flag (1) so the UI click plays even in menu mode.
  const char *cmd =
      wantOn ? "PlaySound UIPipboyLightOn 1" : "PlaySound UIPipboyLightOff 1";
  Script::RunScriptLine2(cmd, player, true);
}

static void SetPipBoyLightScriptFallback(PlayerCharacter *player, bool wantOn) {
  if (!player)
    return;
  SpellItem *pipBoyLight = GetPipBoyLightSpell();
  if (wantOn) {
    Script::RunScriptLine2("TogglePipBoyLight 1", player, true);
    if (!IsPipBoyLightOn(player))
      Script::RunScriptLine2("cios PipBoyLight", player, true);
    if (!IsPipBoyLightOn(player) && pipBoyLight) {
      std::stringstream ss;
      ss << "cios " << std::hex << std::uppercase << std::setfill('0')
         << std::setw(8) << pipBoyLight->refID;
      Script::RunScriptLine2(ss.str().c_str(), player, true);
    }
  } else {
    Script::RunScriptLine2("TogglePipBoyLight 0", player, true);
    if (IsPipBoyLightOn(player))
      Script::RunScriptLine2("dispel PipBoyLight", player, true);
    if (IsPipBoyLightOn(player) && pipBoyLight) {
      std::stringstream ss;
      ss << "dispel " << std::hex << std::uppercase << std::setfill('0')
         << std::setw(8) << pipBoyLight->refID;
      Script::RunScriptLine2(ss.str().c_str(), player, true);
    }
  }
}

// Turn the in-game Pip-Boy flashlight on or off (companion-initiated).
static void SetPipBoyLight(PlayerCharacter *player, bool wantOn) {
  if (!player)
    return;

  SpellItem *pipBoyLight = GetPipBoyLightSpell();
  if (!pipBoyLight)
    return;

  const UInt32 turnON = wantOn ? 1 : 0;
  if ((IsPipBoyLightOn(player) ? 1u : 0u) == turnON)
    return;

  InterfaceManager *im = InterfaceManager::GetSingleton();
  if (!im || !im->pipboyManager)
    return;

#if defined(_M_IX86)
  s_turnONForToggle = turnON;
  s_pipboyManagerForToggle = im->pipboyManager;
  __try {
    EngineTogglePipBoyLight(player, pipBoyLight, turnON);
  } __except (EXCEPTION_EXECUTE_HANDLER) {
    SetPipBoyLightScriptFallback(player, wantOn);
  }
#else
  SetPipBoyLightScriptFallback(player, wantOn);
#endif

  // Belt-and-suspenders if the engine path did not reach the desired state.
  if ((IsPipBoyLightOn(player) ? 1u : 0u) != turnON)
    SetPipBoyLightScriptFallback(player, wantOn);

  PlayPipBoyLightSound(player, wantOn);
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

  // Load order — runtime mod index to plugin filename. The companion app uses
  // this to remap form IDs to the Pip-Boy's fixed plugin offsets (e.g. GRA at
  // 0x08) which do not follow the player's live load order.
  json.key("loadOrder");
  json.beginArray();
  {
    DataHandler *dataHandler = DataHandler::Get();
    if (dataHandler) {
      const ModInfo **activeMods = dataHandler->GetActiveModList();
      const UInt32 modCount = dataHandler->modList.modInfoList.Count();
      for (UInt32 i = 0; i < modCount; i++) {
        const ModInfo *mod = activeMods[i];
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

    // Faction reputation (FNV Pip-Boy GENERAL screen)
    json.key("factions");
    json.beginArray();
    for (const FactionRepDef &fac : kFactionReps) {
      const char *repEdid = GetReputationEditorId(fac.repFormId);
      int fame = 0;
      int infamy = 0;
      int goodThr = 1;
      int badThr = 1;
      int mixedThr = 1;
      if (g_scriptInterface) {
        fame = EvalReputationValue(fac.repFormId, repEdid, 1);
        infamy = EvalReputationValue(fac.repFormId, repEdid, 0);
        goodThr = EvalReputationThreshold(fac.repFormId, repEdid, 1);
        badThr = EvalReputationThreshold(fac.repFormId, repEdid, 2);
        mixedThr = EvalReputationThreshold(fac.repFormId, repEdid, 0);
      }
      int tier = ComputePipRepTier(fame, infamy, goodThr, badThr, mixedThr);
      bool discovered =
          IsFactionDiscovered(fame, infamy, goodThr, badThr, mixedThr) ||
          tier != 5;

      json.arrayElement();
      json.beginObject();
      json.keyStr("name", fac.name);
      json.keyInt("tier", tier);
      json.keyBool("discovered", discovered);
      json.keyInt("fame", fame);
      json.keyInt("infamy", infamy);
      json.endObject();
    }
    json.endArray();

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

    // S.P.E.C.I.A.L. — effective values (GetActorValue), includes equipment
    // modifiers such as Metal Armor's AGILITY -1. Fn_01 is base only.
    json.key("special");
    json.beginObject();
    {
      json.keyInt("ST", (int)player->avOwner.Fn_03(kAV_Strength));
      json.keyInt("PE", (int)player->avOwner.Fn_03(kAV_Perception));
      json.keyInt("EN", (int)player->avOwner.Fn_03(kAV_Endurance));
      json.keyInt("CH", (int)player->avOwner.Fn_03(kAV_Charisma));
      json.keyInt("IN", (int)player->avOwner.Fn_03(kAV_Intelligence));
      json.keyInt("AG", (int)player->avOwner.Fn_03(kAV_Agility));
      json.keyInt("LK", (int)player->avOwner.Fn_03(kAV_Luck));
    }
    json.endObject();

    // Skills — effective values (GetActorValue), includes equipment bonuses.
    json.key("skills");
    json.beginObject();
    {
      json.keyInt("barter", (int)player->avOwner.Fn_03(kAV_Barter));
      json.keyInt("energyweapons",
                  (int)player->avOwner.Fn_03(kAV_EnergyWeapons));
      json.keyInt("explosives", (int)player->avOwner.Fn_03(kAV_Explosives));
      json.keyInt("lockpick", (int)player->avOwner.Fn_03(kAV_Lockpick));
      json.keyInt("medicine", (int)player->avOwner.Fn_03(kAV_Medicine));
      json.keyInt("meleeweapons", (int)player->avOwner.Fn_03(kAV_MeleeWeapons));
      json.keyInt("repair", (int)player->avOwner.Fn_03(kAV_Repair));
      json.keyInt("science", (int)player->avOwner.Fn_03(kAV_Science));
      json.keyInt("guns", (int)player->avOwner.Fn_03(kAV_Guns));
      json.keyInt("sneak", (int)player->avOwner.Fn_03(kAV_Sneak));
      json.keyInt("speech", (int)player->avOwner.Fn_03(kAV_Speech));
      json.keyInt("survival", (int)player->avOwner.Fn_03(kAV_Survival));
      json.keyInt("unarmed", (int)player->avOwner.Fn_03(kAV_Unarmed));
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
//   "TORCH ON" / "TORCH OFF" — toggle the in-game Pip-Boy flashlight
// MUST be called from the main game thread.
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// INITIAL-SYNC LOCK
// While the companion app runs the initial sync it sends SYNC_LOCK; we disable
// the player's controls and inject a custom HUD XML overlay until SYNC_UNLOCK
// (or disconnect). Must run on the main game thread.
// ═══════════════════════════════════════════════════════════════════════════════

// Engine Tile::ReadXML via temp file — same fallback path JIP LN NVSE uses.
static const UInt32 kTileReadXMLAddr = 0x00A01B00;
static const char *kSyncWaitTempXmlFile = "pipboy_sync_temp.xml";
static char s_hudInjectionParentPath[] = "HUDMainMenu/HUDMainMenu";

// GetMenuComponentTile mutates the path (writes NULs over '/' separators).
// Never pass string literals — use a stack copy each call.
static Tile *GetMenuComponentTileCopy(const char *path) {
  if (!path || !path[0])
    return nullptr;
  char pathBuf[0x100];
  strncpy(pathBuf, path, sizeof(pathBuf) - 1);
  pathBuf[sizeof(pathBuf) - 1] = '\0';
  return InterfaceManager::GetMenuComponentTile(pathBuf);
}

// Inject on menuRoot so screen-relative coordinates are correct (HUDMainMenu
// is offset/scaled). Text with &center; anchors on x — set x to parent/2.
static const char kSyncWaitOverlayXml[] =
    "<rect name=\"PipBoySyncWait\">"
    "<visible> &true; </visible>"
    "<depth> 2500 </depth>"
    "<locus> &true; </locus>"
    "<x><copy src=\"screen\" trait=\"width\"/>"
    "<sub src=\"me\" trait=\"width\"/><div>2</div></x>"
    "<y><copy src=\"screen\" trait=\"height\"/>"
    "<sub src=\"me\" trait=\"height\"/><div>2</div></y>"
    "<width> 600 </width>"
    "<height> 200 </height>"
    "<systemcolor> &hudmain; </systemcolor>"
    "<target> 0 </target>"
    "<text name=\"sync_title\">"
    "<string> Pip-Boy Sync </string>"
    "<x><copy src=\"parent\" trait=\"width\"/><div>2</div></x>"
    "<y> 24 </y>"
    "<font> 3 </font>"
    "<justify> &center; </justify>"
    "<width> 600 </width>"
    "</text>"
    "<text name=\"sync_body\">"
    "<string> Please wait while your Pip-Boy syncs with the companion app. "
    "</string>"
    "<x><copy src=\"parent\" trait=\"width\"/><div>2</div></x>"
    "<y> 72 </y>"
    "<font> 1 </font>"
    "<justify> &center; </justify>"
    "<width> 600 </width>"
    "<wrapwidth> 560 </wrapwidth>"
    "</text>"
    "</rect>";

static bool g_syncControlsDisabled = false;
static bool g_syncOverlayInjected = false;
// Frames to wait after a save/load before touching HUD tiles (HUD is rebuilt).
static UInt32 g_syncHudReadyDelay = 0;

static bool IsSafeForHudTileAccess() {
  if (g_syncHudReadyDelay > 0)
    return false;
  if (InterfaceManager::IsMenuVisible(kMenuType_Loading))
    return false;
  return InterfaceManager::GetSingleton() != nullptr;
}

static Tile *GetLegacyHudParentUnsafe() {
  if (!InterfaceManager::GetSingleton())
    return nullptr;

  Tile *parent = GetMenuComponentTileCopy(s_hudInjectionParentPath);
  if (!parent) {
    if (Menu *hud = InterfaceManager::GetMenuByType(kMenuType_HUDMain))
      parent = hud->tile;
  }
  return parent;
}

static Tile *GetSyncOverlayParent() {
  if (!IsSafeForHudTileAccess())
    return nullptr;
  InterfaceManager *im = InterfaceManager::GetSingleton();
  return im ? im->menuRoot : nullptr;
}

static bool IsHudReadyForSyncOverlay() {
  if (!IsSafeForHudTileAccess())
    return false;

  Tile *parent = GetSyncOverlayParent();
  return parent && parent->node;
}

static void ResetSyncLockState(bool reenableControls) {
  g_syncHudReadyDelay = 90;
  g_syncOverlayInjected = false;
  if (reenableControls && g_syncControlsDisabled) {
    if (PlayerCharacter *player = PlayerCharacter::GetSingleton())
      Script::RunScriptLine2("EnablePlayerControls 1 1 1 1 1 1 1", player, true);
    g_syncControlsDisabled = false;
  }
}

static Tile *InjectTileXml(Tile *parent, const char *xml) {
  if (!parent || !xml || !*xml)
    return nullptr;

  FILE *file = fopen(kSyncWaitTempXmlFile, "wb");
  if (!file)
    return nullptr;
  fputs(xml, file);
  fclose(file);
  return ThisStdCall<Tile *>(kTileReadXMLAddr, parent, kSyncWaitTempXmlFile);
}

static void DestroySyncOverlayTile(Tile *overlay) {
  if (!overlay)
    return;
  ThisStdCall(0x00A012D0, overlay, Tile::kTileValue_visible, 0.0f, true);
  overlay->Destroy(true);
}

static void ShowSyncWaitOverlay() {
  if (!IsHudReadyForSyncOverlay() || g_syncOverlayInjected)
    return;

  Tile *parent = GetSyncOverlayParent();
  if (!parent || !parent->node)
    return;

  InjectTileXml(parent, kSyncWaitOverlayXml);
  if (parent->GetChild("PipBoySyncWait"))
    g_syncOverlayInjected = true;
}

static void CloseSyncWaitOverlay() {
  if (InterfaceManager::IsMenuVisible(kMenuType_Loading))
    return;

  // Dismiss any Message menu left open by older plugin versions (ShowMessageBox).
  if (InterfaceManager::IsMenuVisible(kMenuType_Message))
    CdeclCall(0x7AA480);

  if (InterfaceManager *im = InterfaceManager::GetSingleton()) {
    if (im->menuRoot) {
      if (Tile *overlay = im->menuRoot->GetChild("PipBoySyncWait"))
        DestroySyncOverlayTile(overlay);
    }
  }
  // Remove overlays injected by older plugin versions on HUDMainMenu.
  if (Tile *legacyParent = GetLegacyHudParentUnsafe()) {
    if (Tile *overlay = legacyParent->GetChild("PipBoySyncWait"))
      DestroySyncOverlayTile(overlay);
  }

  g_syncOverlayInjected = false;
}

static void ApplySyncLock(bool wantLock) {
  PlayerCharacter *player = PlayerCharacter::GetSingleton();
  if (!player)
    return;

  if (wantLock) {
    if (!IsSafeForHudTileAccess())
      return;

    if (!g_syncControlsDisabled) {
      // Disable movement, Pip-Boy, fighting, POV switch, looking, rollover and
      // sneaking — a full "cutscene" style lock so nothing can be done.
      Script::RunScriptLine2("DisablePlayerControls 1 1 1 1 1 1 1", player, true);
      g_syncControlsDisabled = true;
    }
    if (IsHudReadyForSyncOverlay() && !g_syncOverlayInjected)
      ShowSyncWaitOverlay();
  } else {
    if (g_syncControlsDisabled) {
      Script::RunScriptLine2("EnablePlayerControls 1 1 1 1 1 1 1", player, true);
      g_syncControlsDisabled = false;
    }
    CloseSyncWaitOverlay();
  }
}

static void ExecutePipBoyCommand(const std::string &line) {
  if (line == "TORCH ON") {
    SetPipBoyLight(PlayerCharacter::GetSingleton(), true);
    return;
  }
  if (line == "TORCH OFF") {
    SetPipBoyLight(PlayerCharacter::GetSingleton(), false);
    return;
  }

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
  case NVSEMessagingInterface::kMessage_PreLoadGame:
    g_syncLockRequested = false;
    ResetSyncLockState(true);
    break;
  case NVSEMessagingInterface::kMessage_PostLoadGame:
    g_gameLoaded = true;
    g_saveLoadPending = true;
    ResetSyncLockState(true);
    {
      std::lock_guard<std::mutex> lock(g_snapshotMutex);
      g_latestSnapshot.clear();
    }
    break;
  case NVSEMessagingInterface::kMessage_NewGame:
    g_gameLoaded = true;
    g_saveLoadPending = true;
    ResetSyncLockState(true);
    {
      std::lock_guard<std::mutex> lock(g_snapshotMutex);
      g_latestSnapshot.clear();
    }
    break;
  case NVSEMessagingInterface::kMessage_ExitGame:
    g_gameLoaded = false;
    g_syncLockRequested = false;
    ResetSyncLockState(true);
    break;
  case NVSEMessagingInterface::kMessage_ExitToMainMenu:
    g_gameLoaded = false;
    g_syncLockRequested = false;
    ResetSyncLockState(true);
    break;
  case NVSEMessagingInterface::kMessage_MainGameLoop:
    if (g_gameLoaded) {
      if (g_syncHudReadyDelay > 0)
        g_syncHudReadyDelay--;

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

  // Script interface is required for GetReputation / GetReputationThreshold.
  g_scriptInterface =
      (NVSEScriptInterface *)nvse->QueryInterface(kInterface_Script);

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
