# Forge Cloud Bridge: implementation plan

## Goal

Use the DDB Roll Bridge from a Foundry game hosted by The Forge without a locally launched executable, terminal, or browser extension.

## Current state

The proven roll parsing and Foundry chat-card code is in `foundry-module/ddb-roll-bridge-v2`. The current bridge in `direct-bridge/server.js` is a local service: it binds to loopback, creates a random access token at startup, and keeps the CobaltSession cookie in memory. It is not safe to expose publicly unchanged.

## Proposed architecture

1. Deploy the Node bridge as a small HTTPS service with outbound WebSocket access to D&D Beyond.
2. The Foundry module connects to that service from the Forge-hosted Foundry client.
3. Store the D&D Beyond session cookie in the bridge process memory only; do not persist it to disk or log it.
4. Require a long random service credential for administrative requests. Do not place that long-lived credential in the browser's EventSource URL; use short-lived, single-use stream tickets instead.
5. Allow only HTTPS and restrict browser origins to The Forge and any explicitly configured custom Foundry domain.
6. Keep the existing local EXE path working as a fallback until the hosted deployment is proven.

## Security requirements before deployment

- HTTPS only; reject insecure non-local URLs in the module.
- Long random service credential supplied through the host's secret/environment settings, never committed to Git.
- Short-lived, single-use EventSource tickets; never put the long-lived service credential in an event-stream URL.
- Rate limits and request body size limits on public endpoints.
- No CobaltSession, bearer token, stream ticket, or full roll payload in logs.
- Clear explanation that the D&D Beyond session cookie is sent over HTTPS to the user's chosen hosting provider and held in memory by the service.
- Do not ask users to paste cookies or access tokens into GitHub issues, source files, or chat.
- Reconnection and duplicate suppression must be tested across service restarts and browser disconnects.

## Deployment decision

The service must run continuously enough to maintain D&D Beyond's WebSocket. A host that sleeps when idle can miss events unless reconnect/backfill behavior is verified. Choose a host only after checking its current pricing, idle/sleep behavior, secret management, and persistent WebSocket support. Do not claim the no-terminal workflow is ready until a live Forge test succeeds.

## Acceptance test

- Configure the service URL and credential in Foundry once.
- Connect from a Forge-hosted game with no local executable running.
- Confirm one roll and a burst of at least four rapid rolls arrive exactly once and in order.
- Disconnect/reconnect the Foundry client and restart the service; confirm clear status reporting and no unintended replay.
- Confirm invalid credentials are rejected and no secrets appear in service logs.
