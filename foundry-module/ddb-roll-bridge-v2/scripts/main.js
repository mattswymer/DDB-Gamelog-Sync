import { normalizeMessage } from "./roll-parser.js";
import { buildRecordedRoll } from "./roll-builder.js";

const MODULE_ID = "ddb-roll-bridge-v2";
const MAX_SEEN_EVENTS = 1000;
const seenEvents = new Set();
const mappingPrompted = new Set();
let eventSource = null;
let bridgeState = "disconnected";
let bridgeError = "";
let settingsApp = null;
let lastNotifiedAuthError = "";

function log(...args) {
  try { if (game.settings.get(MODULE_ID, "debug")) console.debug(`[${MODULE_ID}]`, ...args); }
  catch { /* Settings may not be registered during module evaluation. */ }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

function baseUrl() {
  return String(setting("bridgeUrl") || "http://127.0.0.1:39210").replace(/\/+$/, "");
}

function authHeaders() {
  return { "Content-Type": "application/json", "Authorization": `Bearer ${setting("bridgeToken") || ""}` };
}

async function bridgeRequest(path, options = {}) {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
    cache: "no-store"
  });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body.error || `Local bridge request failed (HTTP ${response.status}).`);
  return body;
}

function rememberEvent(id) {
  if (!id || seenEvents.has(id)) return false;
  seenEvents.add(id);
  while (seenEvents.size > MAX_SEEN_EVENTS) seenEvents.delete(seenEvents.values().next().value);
  void game.settings.set(MODULE_ID, "processedEventIds", [...seenEvents]);
  return true;
}

function resolveActor(roll) {
  const actors = game.actors?.contents || [];
  const flagged = actors.find(actor => String(actor.getFlag(MODULE_ID, "ddbId") || "") === String(roll.entityId || ""));
  if (flagged) return flagged;
  const mappings = setting("actorMappings") || {};
  const mappedId = mappings[String(roll.entityId)];
  if (mappedId) {
    const actor = game.actors?.get(mappedId);
    if (actor) return actor;
  }
  const matches = game.actors?.filter?.(actor => actor.name?.trim().toLowerCase() === roll.character.trim().toLowerCase()) || [];
  return matches.length === 1 ? matches[0] : null;
}

function renderRollCard(roll) {
  const rows = roll.rolls.map(item => {
    const total = item.total === null ? "—" : String(item.total);
    const type = item.rollKind ? `${item.rollType} · ${item.rollKind}` : item.rollType;
    const values = item.breakdown || (item.values.length ? item.values.join(" + ") : "");
    return `
      <section class="ddb-rb2-row" data-category="${escapeHtml(item.category)}">
        <div class="ddb-rb2-kind">${escapeHtml(type)}</div>
        <div class="ddb-rb2-total">${escapeHtml(total)}</div>
        <div class="ddb-rb2-tags"><span class="ddb-rb2-tag">${escapeHtml(item.category)}</span></div>
        ${item.formula ? `<div class="ddb-rb2-formula"><strong>Formula:</strong> ${escapeHtml(item.formula)}</div>` : ""}
        ${values ? `<div class="ddb-rb2-breakdown"><strong>Actual dice:</strong> ${escapeHtml(values)}</div>` : ""}
      </section>`;
  }).join("");

  return `
    <article class="ddb-rb2-card">
      <header class="ddb-rb2-header">
        <div><div class="ddb-rb2-character">${escapeHtml(roll.character)}</div><div class="ddb-rb2-action">${escapeHtml(roll.action)}</div></div>
        <span class="ddb-rb2-source">D&D Beyond</span>
      </header>
      ${rows}
    </article>`;
}

async function postRoll(roll) {
  // Only the active GM creates chat messages; this remains true if another GM connects manually.
  if (!setting("enabled") || !game.user?.isGM || game.users.activeGM?.id !== game.user.id) return;
  if (!rememberEvent(roll.id)) return;
  const nextSeen = Math.max(Number(setting("lastSeenTimestamp") || 0), Number(roll.timestamp) || Date.now());
  void game.settings.set(MODULE_ID, "lastSeenTimestamp", nextSeen);
  const actor = resolveActor(roll);
  const speaker = actor
    ? ChatMessage.getSpeaker({ actor })
    : { ...ChatMessage.getSpeaker(), alias: roll.character || "D&D Beyond" };
  const userMappings = setting("userMappings") || {};
  const mappedUserId = userMappings[String(roll.userId || "")];
  const dndbeyondUser = mappedUserId ? game.users.get(mappedUserId) : null;
  const flags = {
    [MODULE_ID]: {
      eventId: roll.id,
      rollId: roll.rollId,
      gameId: roll.gameId,
      entityId: roll.entityId,
      entityType: roll.entityType,
      userId: roll.userId,
      scope: roll.scope,
      action: roll.action,
      character: roll.character,
      timestamp: roll.timestamp,
      source: roll.source,
      categories: [...new Set(roll.rolls.map(item => item.category))],
      rolls: roll.rolls,
      raw: setting("debug") ? roll.raw : undefined
    }
  };
  const firstCategory = roll.rolls[0]?.category;
  const rawAbilityCheck = /^(str|dex|con|int|wis|cha)$/i.test(String(roll.action || ""));
  const systemType = firstCategory === "check" && rawAbilityCheck
    ? "ability"
    : ({ attack: "attack", damage: "damage", save: "save", check: "skill", healing: "healing", initiative: "ability" })[firstCategory];
  if (game.system.id === "dnd5e" && systemType) flags.dnd5e = { roll: { type: systemType } };

  const messageData = {
    speaker,
    user: dndbeyondUser?.id || game.user.id,
    flavor: `${roll.action} (${roll.rolls.map(item => item.rollType).join(", ")})`,
    content: renderRollCard(roll),
    rolls: roll.rolls.map(buildRecordedRoll),
    flags
  };
  // D&D Beyond's gameId scope is public. User-scoped events are whispered to the mapped Foundry user,
  // or to the GM only when no identity mapping exists, rather than accidentally exposed to the table.
  const isPublicScope = !roll.scope || roll.scope === "gameId" || roll.scope === String(roll.gameId) || roll.scope === String(setting("gameId"));
  if (!isPublicScope) messageData.whisper = [dndbeyondUser?.id || game.user.id];
  await ChatMessage.create(messageData);
  log("Mirrored fulfilled roll", { id: roll.id, rollId: roll.rollId, character: roll.character, action: roll.action });
  Hooks.callAll("ddbGamelogSync.roll", roll);
  if (!actor && roll.entityId && !mappingPrompted.has(String(roll.entityId))) {
    mappingPrompted.add(String(roll.entityId));
    void openMappingDialog();
  }
}

function processRawMessage(raw) {
  if (setting("debug")) console.debug(`[${MODULE_ID}] Raw fulfilled event`, raw);
  const normalized = normalizeMessage(raw);
  if (!normalized) return;
  postRoll(normalized).catch(error => {
    console.error(`[${MODULE_ID}] Failed to create chat card:`, error);
    ui.notifications?.error?.(`DDB Roll Bridge: ${error.message}`);
  });
}

function stopEventStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

async function startEventStream() {
  stopEventStream();
  const ticketResponse = await bridgeRequest("/stream-ticket", { method: "POST", body: "{}" });
  const url = new URL(`${baseUrl()}/events`);
  url.searchParams.set("ticket", ticketResponse.ticket);
  eventSource = new EventSource(url.toString());

  eventSource.addEventListener("roll", event => {
    try { processRawMessage(JSON.parse(event.data)); }
    catch (error) { console.warn(`[${MODULE_ID}] Ignored malformed roll event.`, error); }
  });
  eventSource.addEventListener("status", event => {
    try {
      const status = JSON.parse(event.data);
      bridgeState = status.state || "unknown";
      bridgeError = status.lastError || "";
      if (bridgeError && /authentication failed|cobaltsession|token exchange/i.test(bridgeError) && bridgeError !== lastNotifiedAuthError) {
        lastNotifiedAuthError = bridgeError;
        ui.notifications?.warn?.(`DDB Roll Bridge: ${bridgeError}`);
      }
      updateBridgeButton();
      settingsApp?.render({ force: true });
      log("Transport status", status);
    } catch {}
  });
  return new Promise((resolve, reject) => {
    let opened = false;
    const timeout = setTimeout(() => {
      if (!opened) reject(new Error("Could not open the local bridge event stream. Check the bridge URL and access token."));
    }, 8000);
    eventSource.addEventListener("open", () => {
      opened = true;
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    eventSource.onerror = () => {
      bridgeState = "reconnecting";
      updateBridgeButton();
      if (!opened) {
        clearTimeout(timeout);
        reject(new Error("The local bridge event stream failed before connecting."));
      }
    };
  });
}

function updateBridgeButton() {
  document.querySelectorAll("[data-ddb-rb2-open]").forEach(button => {
    button.dataset.state = bridgeState;
    button.title = `DDB Roll Bridge: ${bridgeState}`;
    const label = button.querySelector(".ddb-rb2-button-label");
    if (label) label.textContent = `DDB Bridge · ${bridgeState}`;
  });
}

async function connectBridge({ cobaltSession, gameId, skipBeyond20 }) {
  const url = baseUrl();
  const token = setting("bridgeToken");
  if (!token) throw new Error("Enter the local bridge access token shown in the direct-bridge terminal.");

  const configured = await bridgeRequest("/configure", {
    method: "POST",
    body: JSON.stringify({ cobaltSession, gameId, skipBeyond20 })
  });
  // Open the event stream before starting capture so REST catch-up events cannot be missed.
  await startEventStream();
  await bridgeRequest("/start", {
    method: "POST",
    body: JSON.stringify({ sinceTimestamp: Number(setting("lastSeenTimestamp") || 0) })
  });

  await game.settings.set(MODULE_ID, "campaignId", String(gameId));
  await game.settings.set(MODULE_ID, "gameId", String(gameId));
  if (configured.userId) await game.settings.set(MODULE_ID, "userId", String(configured.userId));
  await game.settings.set(MODULE_ID, "skipBeyond20", !!skipBeyond20);
  bridgeState = "connecting";
  updateBridgeButton();
  ui.notifications?.info?.("DDB Roll Bridge connected. Waiting for new fulfilled rolls.");
}

class DDBBridgeSettingsApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ddb-rb2-settings",
    tag: "form",
    window: { title: "DDB Direct Roll Bridge", resizable: true },
    position: { width: 620, height: "auto" },
    form: { handler: this.#submit, submitOnChange: false, closeOnSubmit: false }
  };
  static PARTS = { main: { template: "modules/ddb-roll-bridge-v2/templates/settings.hbs" } };

  static async #submit(event, form, formData) {
    const data = formData.object;
    await game.settings.set(MODULE_ID, "bridgeUrl", String(data.bridgeUrl || "http://127.0.0.1:39210").trim().replace(/\/+$/, ""));
    await game.settings.set(MODULE_ID, "bridgeToken", String(data.bridgeToken || "").trim());
    await game.settings.set(MODULE_ID, "campaignId", String(data.gameId || "").trim());
    await game.settings.set(MODULE_ID, "cobaltCookie", String(data.cobaltSession || "").trim());
    await game.settings.set(MODULE_ID, "skipBeyond20", Boolean(data.skipBeyond20));
    await game.settings.set(MODULE_ID, "enabled", Boolean(data.enabled));
    await game.settings.set(MODULE_ID, "debug", Boolean(data.debug));
    ui.notifications?.info?.("DDB Direct Roll Bridge settings saved.");
  }

  async _prepareContext() {
    return {
      bridgeUrl: baseUrl(),
      bridgeToken: setting("bridgeToken") || "",
      campaignId: setting("campaignId") || "",
      cobaltSession: setting("cobaltCookie") || "",
      skipBeyond20: setting("skipBeyond20") !== false,
      enabled: setting("enabled") !== false,
      debug: setting("debug") === true,
      status: bridgeState,
      lastError: bridgeError
    };
  }

  async _onRender(context, options) {
    super._onRender(context, options);
    settingsApp = this;
    this.element.querySelectorAll("[data-action]").forEach(button => {
      button.addEventListener("click", async event => {
        event.preventDefault();
        const action = button.dataset.action;
        if (action === "mapping") return openMappingDialog();
        if (action === "status") {
          try {
            const result = await bridgeRequest("/status");
            bridgeState = result.state || "unknown";
            bridgeError = result.lastError || "";
            updateBridgeButton();
            return this.render({ force: true });
          } catch (error) {
            bridgeError = error.message;
            bridgeState = "unreachable";
            return this.render({ force: true });
          }
        }
        if (action === "stop") {
          try { await bridgeRequest("/stop", { method: "POST", body: "{}" }); }
          catch (error) { bridgeError = error.message; }
          stopEventStream();
          bridgeState = "stopped";
          updateBridgeButton();
          return this.render({ force: true });
        }
        if (action === "connect") {
          const form = this.element.querySelector("form");
          const data = new FormData(form);
          const gameId = String(data.get("gameId") || "").trim();
          const cobaltSession = String(data.get("cobaltSession") || "").trim();
          if (!/^\d{1,20}$/.test(gameId)) {
            ui.notifications?.error?.("Enter the numeric D&D Beyond campaign ID.");
            return;
          }
          await game.settings.set(MODULE_ID, "bridgeUrl", String(data.get("bridgeUrl") || "http://127.0.0.1:39210").trim().replace(/\/+$/, ""));
          await game.settings.set(MODULE_ID, "bridgeToken", String(data.get("bridgeToken") || "").trim());
          await game.settings.set(MODULE_ID, "campaignId", gameId);
          await game.settings.set(MODULE_ID, "cobaltCookie", cobaltSession);
          await game.settings.set(MODULE_ID, "skipBeyond20", form.querySelector('[name="skipBeyond20"]').checked);
          await game.settings.set(MODULE_ID, "enabled", form.querySelector('[name="enabled"]').checked);
          await game.settings.set(MODULE_ID, "debug", form.querySelector('[name="debug"]').checked);
          try {
            await connectBridge({ cobaltSession, gameId, skipBeyond20: form.querySelector('[name="skipBeyond20"]').checked });
            bridgeState = "connecting";
            bridgeError = "";
            this.render({ force: true });
          } catch (error) {
            bridgeState = "error";
            bridgeError = error.message;
            console.error(`[${MODULE_ID}] Connection failed:`, error);
            ui.notifications?.error?.(`DDB Roll Bridge: ${error.message}`);
            this.render({ force: true });
          }
        }
      });
    });
  }
}

function openSetupDialog() {
  new DDBBridgeSettingsApp().render({ force: true });
}

async function openMappingDialog() {
  let characters;
  try {
    const response = await bridgeRequest("/characters");
    characters = response.characters || [];
  } catch (error) {
    ui.notifications?.error?.(`Could not load D&D Beyond characters: ${error.message}`);
    return;
  }

  const actorMappings = setting("actorMappings") || {};
  const userMappings = setting("userMappings") || {};
  const actors = game.actors?.contents || [];
  const users = game.users?.contents || [];
  const rows = characters.map(character => {
    const actorOptions = ['<option value="">— Use character name as chat alias —</option>']
      .concat(actors.map(actor => `<option value="${escapeHtml(actor.id)}" ${actorMappings[character.id] === actor.id ? "selected" : ""}>${escapeHtml(actor.name)}</option>`))
      .join("");
    const userOptions = ['<option value="">— Not mapped —</option>']
      .concat(users.map(user => `<option value="${escapeHtml(user.id)}" ${userMappings[String(character.userId)] === user.id ? "selected" : ""}>${escapeHtml(user.name)}</option>`))
      .join("");
    return `
      <div class="form-group ddb-rb2-map-row">
        <label><strong>${escapeHtml(character.name)}</strong><small> DDB character ID: ${escapeHtml(character.id)} · DDB user: ${escapeHtml(character.userName || character.userId || "unknown")}</small></label>
        <select data-ddb-id="${escapeHtml(character.id)}" aria-label="Foundry actor for ${escapeHtml(character.name)}">${actorOptions}</select>
        <select data-ddb-user-id="${escapeHtml(character.userId || "")}" aria-label="Foundry user for ${escapeHtml(character.userName || character.name)}">${userOptions}</select>
      </div>`;
  }).join("");

  new Dialog({
    title: "D&D Beyond → Foundry Character and User Mapping",
    content: `<form class="ddb-rb2-mappings"><p>Map each D&D Beyond character to a Foundry actor and its D&D Beyond account to a Foundry user. User mapping is used for private game-log events.</p>${rows || "<p>No characters were returned for this campaign.</p>"}</form>`,
    buttons: {
      save: {
        label: "Save Mapping",
        callback: async html => {
          const root = html[0] || html;
          const nextActors = {};
          const nextUsers = { ...userMappings };
          root.querySelectorAll("select[data-ddb-id]").forEach(select => {
            if (select.value) {
              nextActors[select.dataset.ddbId] = select.value;
              const actor = game.actors.get(select.value);
              if (actor) void actor.setFlag(MODULE_ID, "ddbId", String(select.dataset.ddbId));
            }
          });
          root.querySelectorAll("select[data-ddb-user-id]").forEach(select => {
            const ddbUserId = select.dataset.ddbUserId;
            if (!ddbUserId) return;
            if (select.value) nextUsers[ddbUserId] = select.value;
            else delete nextUsers[ddbUserId];
          });
          await game.settings.set(MODULE_ID, "actorMappings", nextActors);
          await game.settings.set(MODULE_ID, "userMappings", nextUsers);
          ui.notifications?.info?.("Character and user mappings saved.");
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "save"
  }, { width: 760 }).render(true);
}

function addChatButton(app, html) {
  const root = html?.[0] || html;
  if (!(root instanceof HTMLElement) || root.querySelector("[data-ddb-rb2-open]")) return;
  const target = root.querySelector(".chat-controls") || root.querySelector(".chat-form") || root.querySelector(".window-header");
  if (!target) return;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.ddbRb2Open = "true";
  button.className = "ddb-rb2-open";
  button.innerHTML = '<span class="ddb-rb2-button-label">DDB Bridge · disconnected</span>';
  button.addEventListener("click", openSetupDialog);
  target.append(button);
  updateBridgeButton();
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "bridgeUrl", {
    name: "Local Bridge URL",
    hint: "Address of the local DDB Direct Bridge service.",
    scope: "client", config: true, type: String, default: "http://127.0.0.1:39210"
  });
  game.settings.register(MODULE_ID, "bridgeToken", {
    name: "Local Bridge Access Token",
    hint: "Generated when the local bridge starts. Stored as a client setting.",
    scope: "client", config: true, type: String, default: ""
  });
  game.settings.register(MODULE_ID, "campaignId", {
    name: "D&D Beyond Campaign ID",
    hint: "Numeric ID from the D&D Beyond campaign URL.",
    scope: "client", config: true, type: String, default: ""
  });
  game.settings.register(MODULE_ID, "gameId", {
    name: "D&D Beyond Game ID",
    scope: "world", config: false, type: String, default: ""
  });
  game.settings.register(MODULE_ID, "userId", {
    name: "D&D Beyond User ID",
    scope: "client", config: false, type: String, default: ""
  });
  game.settings.register(MODULE_ID, "skipBeyond20", {
    name: "Skip Beyond20-bridged rolls",
    hint: "Avoid duplicate chat cards when Beyond20 already delivered a roll to Foundry.",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "actorMappings", {
    name: "D&D Beyond Character Mappings",
    scope: "world", config: false, type: Object, default: {}
  });
  game.settings.register(MODULE_ID, "userMappings", {
    name: "D&D Beyond User Mappings",
    scope: "world", config: false, type: Object, default: {}
  });
  game.settings.register(MODULE_ID, "cobaltCookie", {
    name: "CobaltSession cookie",
    hint: "Client-only session credential. Never share it.",
    scope: "client", config: false, type: String, default: ""
  });
  game.settings.register(MODULE_ID, "processedEventIds", {
    name: "Processed D&D Beyond event IDs",
    scope: "client", config: false, type: Array, default: []
  });
  game.settings.register(MODULE_ID, "lastSeenTimestamp", {
    name: "Last seen D&D Beyond timestamp",
    scope: "client", config: false, type: Number, default: 0
  });
  game.settings.register(MODULE_ID, "debug", {
    name: "Debug logging", scope: "client", config: false, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, "enabled", {
    name: "Enable roll mirroring", scope: "world", config: false, type: Boolean, default: true
  });
  game.settings.registerMenu(MODULE_ID, "connection", {
    name: "DDB Direct Roll Bridge",
    label: "Configure / Connect",
    hint: "Configure the local D&D Beyond bridge and connection status.",
    icon: "fas fa-dice-d20",
    type: DDBBridgeSettingsApp,
    restricted: false
  });
  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = {
      openSetupDialog,
      openMappingDialog,
      getStatus: () => bridgeState,
      stop: () => { stopEventStream(); bridgeState = "stopped"; updateBridgeButton(); }
    };
  }
});

Hooks.once("ready", async () => {
  for (const id of setting("processedEventIds") || []) seenEvents.add(String(id));
  if (!game.user?.isGM) return;
  Hooks.on("renderChatLog", addChatButton);
  log("Ready. Open the DDB Bridge button in chat or use Module Settings to configure the connection.");
  if (game.users.activeGM?.id !== game.user.id || !setting("enabled")) return;
  if (!setting("bridgeToken") || !setting("campaignId") || !setting("cobaltCookie")) return;
  try {
    await connectBridge({
      cobaltSession: setting("cobaltCookie"),
      gameId: setting("campaignId"),
      skipBeyond20: setting("skipBeyond20") !== false
    });
  } catch (error) {
    bridgeState = "error";
    bridgeError = error.message;
    ui.notifications?.warn?.(`DDB Roll Bridge: ${error.message}`);
    log("Automatic connection failed", error.message);
  }
});

Hooks.on("deleteChatMessage", message => {
  const id = message?.flags?.[MODULE_ID]?.eventId;
  if (id) seenEvents.delete(String(id));
});


