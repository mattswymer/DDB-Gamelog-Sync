import { connectBridge, disconnectBridge, getBridgeStatus, startCapture } from "./ddb-client.js";
import { parseRollEvent } from "./parser.js";
import { findActor, findFoundryUser, linkActorDialog } from "./mapper.js";
import { buildRecordedRoll, dnd5eRollFlag } from "./roll-builder.js";

const MODULE_ID = "ddb-direct-roll-bridge";
const seenIds = new Set();
const MAX_SEEN = 3000;
let settingsApp = null;
let statusText = "Not connected";
let lastError = "";
let captureStarted = false;

function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

function setStatus(status, error = "") {
  statusText = status || "Unknown";
  lastError = error || "";
  Hooks.callAll("ddbGamelogSync.status", { status: statusText, error: lastError });
  settingsApp?.render({ force: true });
}

function remember(id) {
  if (!id || seenIds.has(id)) return false;
  seenIds.add(id);
  while (seenIds.size > MAX_SEEN) seenIds.delete(seenIds.values().next().value);
  void game.settings.set(MODULE_ID, "seenIds", [...seenIds]);
  return true;
}

async function postRoll(message) {
  // The active GM is the sole message writer, even if another client manually connects.
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  const parsed = parseRollEvent(message);
  if (!parsed || !remember(parsed.id)) return;
  if (parsed.scope !== String(setting("gameId")) && parsed.scope !== "gameId") {
    parsed.whisper = game.users.contents.filter(user =>
      String(user.getFlag(MODULE_ID, "ddbUserId") || "") === parsed.userId
    ).map(user => user.id);
  }
  let actor = findActor(parsed);
  if (!actor && parsed.entityId && game.user.isGM) actor = await linkActorDialog(parsed);
  const user = findFoundryUser(parsed.userId);
  const speaker = ChatMessage.getSpeaker({ actor: actor || null, token: actor?.getActiveTokens?.()[0]?.document || null });
  const roll = buildRecordedRoll(parsed);
  const flags = { [MODULE_ID]: { ...parsed, raw: undefined } };
  const dnd5eType = game.system.id === "dnd5e" ? dnd5eRollFlag(parsed.rollType) : null;
  if (dnd5eType) flags.dnd5e = { roll: { type: dnd5eType } };
  const messageData = {
    user: user?.id || game.user.id,
    speaker,
    flavor: `${parsed.action} (${parsed.rollType})`,
    rolls: [roll],
    flags
  };
  if (parsed.whisper?.length) messageData.whisper = parsed.whisper;
  await ChatMessage.create(messageData);
  if (setting("debug")) console.debug("[DDB Gamelog Sync] Mirrored completed roll", {
    id: parsed.id, rollId: parsed.rollId, action: parsed.action, rollType: parsed.rollType, total: parsed.total
  });
  Hooks.callAll("ddbGamelogSync.roll", parsed);
}

class DDBSyncSettingsApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "ddb-gamelog-sync-settings",
    tag: "form",
    window: { title: "DDB Gamelog Sync", resizable: true },
    position: { width: 540, height: "auto" },
    form: { handler: this.#submit, submitOnChange: false, closeOnSubmit: false }
  };
  static PARTS = { main: { template: "modules/ddb-direct-roll-bridge/templates/settings.hbs" } };

  static async #connect() {
    try {
      if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) {
        throw new Error("Only the active GM client may connect and create chat messages.");
      }
      if (!setting("bridgeToken")) throw new Error("Paste the local bridge access token from the bridge console first.");
      if (!captureStarted) {
        await startCapture();
        captureStarted = true;
      }
      await connectBridge(postRoll, data => setStatus(data.state, data.lastError));
      setStatus("connecting");
      ui.notifications.info("DDB Gamelog Sync connected to the local bridge.");
    } catch (error) {
      setStatus("error", error.message);
      ui.notifications.error(error.message);
    }
  }

  static async #disconnect() {
    await disconnectBridge();
    captureStarted = false;
    setStatus("disconnected");
  }

  static async #refreshStatus() {
    try {
      const status = await getBridgeStatus();
      setStatus(status.state, status.lastError);
    } catch (error) { setStatus("unreachable", error.message); }
  }

  static async #submit(event, form, formData) {
    const data = formData.object;
    for (const key of ["gameId", "cobaltCookie", "bridgeToken", "enabled", "debug"]) {
      if (data[key] !== undefined) await game.settings.set(MODULE_ID, key, data[key]);
    }
    ui.notifications.info("DDB Gamelog Sync settings saved.");
  }

  async _prepareContext() {
    return {
      gameId: setting("gameId"),
      cobaltCookie: setting("cobaltCookie"),
      bridgeToken: setting("bridgeToken"),
      enabled: setting("enabled"),
      debug: setting("debug"),
      status: statusText,
      lastError
    };
  }

  async _onRender(context, options) {
    super._onRender(context, options);
    settingsApp = this;
    this.element.querySelectorAll("[data-action]").forEach(button => {
      button.addEventListener("click", event => {
        event.preventDefault();
        const action = button.dataset.action;
        if (action === "connect") void DDBSyncSettingsApp.#connect();
        if (action === "disconnect") void DDBSyncSettingsApp.#disconnect();
        if (action === "status") void DDBSyncSettingsApp.#refreshStatus();
      });
    });
  }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "cobaltCookie", { name: "CobaltSession cookie", hint: "Stored locally in this Foundry client. Never share it.", scope: "client", config: false, type: String, default: "" });
  game.settings.register(MODULE_ID, "bridgeToken", { name: "Local bridge access token", scope: "client", config: false, type: String, default: "" });
  game.settings.register(MODULE_ID, "gameId", { name: "D&D Beyond campaign ID", scope: "world", config: false, type: String, default: "" });
  game.settings.register(MODULE_ID, "userId", { name: "D&D Beyond user ID", scope: "client", config: false, type: String, default: "" });
  game.settings.register(MODULE_ID, "enabled", { name: "Enable capture", scope: "world", config: false, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "debug", { name: "Debug logging", scope: "client", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "seenIds", { name: "Processed game-log IDs", scope: "client", config: false, type: Array, default: [] });
  game.settings.registerMenu(MODULE_ID, "settings", {
    name: "DDB Gamelog Sync",
    label: "Configure / Connect",
    hint: "Configure the local D&D Beyond bridge and roll mirroring.",
    icon: "fas fa-dice-d20",
    type: DDBSyncSettingsApp,
    restricted: false
  });
  for (const id of setting("seenIds") || []) seenIds.add(String(id));
});

Hooks.once("ready", async () => {
  if (!setting("enabled") || !setting("cobaltCookie") || !setting("gameId") || !setting("bridgeToken")) return;
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  try {
    await startCapture();
    captureStarted = true;
    await connectBridge(postRoll, data => setStatus(data.state, data.lastError));
  } catch (error) {
    setStatus("error", error.message);
    ui.notifications.warn(`DDB Gamelog Sync: ${error.message}`);
  }
});
