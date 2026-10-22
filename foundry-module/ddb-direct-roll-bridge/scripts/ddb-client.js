const MODULE_ID = "ddb-direct-roll-bridge";
const BASE_URL = "http://127.0.0.1:39210";
let eventSource = null;
let connected = false;
let retryTimer = null;
let retryCount = 0;
let stopped = true;

function localToken() {
  return game.settings.get(MODULE_ID, "bridgeToken").trim();
}

async function request(path, options = {}) {
  const token = localToken();
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Local bridge request failed (${response.status}).`);
  return body;
}

export async function configureBridge() {
  const gameId = String(game.settings.get(MODULE_ID, "gameId") || "").trim();
  const cobaltSession = String(game.settings.get(MODULE_ID, "cobaltCookie") || "").trim();
  if (!gameId || !cobaltSession) throw new Error("Enter the campaign ID and CobaltSession cookie in module settings.");
  return request("/configure", {
    method: "POST",
    body: JSON.stringify({ gameId, cobaltSession })
  });
}

export async function connectBridge(onRoll, onStatus) {
  stopped = false;
  try {
    const status = await request("/status");
    onStatus?.(status);
    eventSource?.close();
    eventSource = new EventSource(`${BASE_URL}/events?token=${encodeURIComponent(localToken())}`);
    eventSource.addEventListener("status", event => {
      const data = JSON.parse(event.data);
      connected = data.state === "connected";
      if (connected) retryCount = 0;
      onStatus?.(data);
    });
    eventSource.addEventListener("roll", event => {
      try { onRoll(JSON.parse(event.data)); } catch (error) { console.error("[DDB Gamelog Sync] Invalid event payload", error); }
    });
    eventSource.onerror = () => {
      connected = false;
      onStatus?.({ state: "local-bridge-unreachable", lastError: "Cannot read the local bridge event stream." });
      eventSource?.close();
      eventSource = null;
      if (!stopped) {
        const delay = Math.min(30000, 1000 * (2 ** retryCount++));
        retryTimer = setTimeout(() => void connectBridge(onRoll, onStatus), delay);
      }
    };
    return status;
  } catch (error) {
    onStatus?.({ state: "error", lastError: error.message });
    throw error;
  }
}

export async function startCapture() {
  await configureBridge();
  return request("/start", { method: "POST", body: "{}" });
}

export async function disconnectBridge() {
  stopped = true;
  connected = false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  eventSource?.close();
  eventSource = null;
  try { return await request("/stop", { method: "POST", body: "{}" }); }
  catch (error) { console.warn("[DDB Gamelog Sync] Bridge stop request failed", error); return null; }
}

export async function getBridgeStatus() {
  return request("/status");
}
