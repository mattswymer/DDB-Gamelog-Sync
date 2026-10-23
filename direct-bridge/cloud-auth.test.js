import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { once } from "node:events";

const accessToken = "test-only-bridge-access-token-that-is-at-least-48-characters-long";
let child;
let baseUrl;

async function unusedPort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

before(async () => {
  const port = await unusedPort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: new URL(".", import.meta.url),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      BRIDGE_ACCESS_TOKEN: accessToken,
      REQUIRE_HTTPS: "false"
    },
    stdio: ["ignore", "ignore", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Bridge exited before startup: ${stderr}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`Bridge did not become healthy: ${stderr}`);
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});

test("health endpoint is public and reports service identity", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "ddb-foundry-direct-bridge");
});

test("protected routes reject missing and incorrect bearer tokens", async () => {
  for (const headers of [{}, { Authorization: "Bearer wrong-token" }]) {
    const response = await fetch(`${baseUrl}/stream-ticket`, { method: "POST", headers });
    assert.equal(response.status, 401);
  }
});

test("legacy long-lived token in event URL is rejected", async () => {
  const response = await fetch(`${baseUrl}/events?token=${encodeURIComponent(accessToken)}`);
  assert.equal(response.status, 401);
});

test("stream tickets are single-use and do not expose the long-lived token", async () => {
  const minted = await fetch(`${baseUrl}/stream-ticket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(minted.status, 200);
  const { ticket, expiresInMs } = await minted.json();
  assert.equal(typeof ticket, "string");
  assert.equal(ticket.length, 64);
  assert.equal(expiresInMs, 60_000);
  assert.notEqual(ticket, accessToken);

  const firstUse = await fetch(`${baseUrl}/events?ticket=${encodeURIComponent(ticket)}`);
  assert.equal(firstUse.status, 200);
  assert.match(firstUse.headers.get("content-type"), /text\/event-stream/);
  await firstUse.body.cancel();

  const secondUse = await fetch(`${baseUrl}/events?ticket=${encodeURIComponent(ticket)}`);
  assert.equal(secondUse.status, 401);
});
