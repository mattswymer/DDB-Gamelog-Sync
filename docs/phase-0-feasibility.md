# Phase 0: Direct D&D Beyond game-log feasibility

## Current architecture decision

A Foundry-only browser implementation cannot reliably perform the CobaltSession exchange because browser `fetch` cannot set a `Cookie` request header, and the auth endpoint may reject cross-origin requests. The current spike therefore performs the exchange in the local Node-based bridge, where the `Cookie` header is permitted, then gives Foundry only a short-lived local bridge access token.

The bridge requests:

- Token: `POST https://auth-service.dndbeyond.com/v1/cobalt-token`
- WebSocket: `wss://game-log-api-live.dndbeyond.com/v1?gameId=…&userId=…&stt=…`
- REST messages: `https://game-log-rest-live.dndbeyond.com/v1/getmessages`

The WebSocket client currently supplies `Origin: https://www.dndbeyond.com` from the bridge process. This tests the D&D Beyond-origin path, not a direct Foundry-origin WebSocket.

## What is implemented in the spike

- The bridge exchanges the configured CobaltSession cookie for a bearer token.
- The token is used for the D&D Beyond WebSocket and REST requests.
- The bridge binds only to `127.0.0.1`, checks a per-process local access token, and limits allowed browser origins.
- The cookie and D&D Beyond bearer token are not written to disk or printed in logs.
- Token refresh/reconnect and a bounded message-ID dedupe set are present.

## What is not yet proven

This repository cannot validate live D&D Beyond authentication without a current session cookie and an actual running bridge. A successful static build is not proof that D&D Beyond accepts the exchange, that the current cookie is valid, or that a campaign's event payload matches the parser. The first live run must verify token exchange, WebSocket open, and a new `dice/roll/fulfilled` event. REST history recovery is currently only a dedupe seed; full catch-up since the last seen timestamp remains unfinished.

## Phase 0 acceptance checklist

- [ ] Token exchange succeeds with a current CobaltSession cookie.
- [ ] JWT exposes the correct D&D Beyond user ID and expiry.
- [ ] WebSocket opens for the configured campaign and remains open.
- [ ] One fresh roll arrives as `dice/roll/fulfilled`.
- [ ] REST response shape and pagination/time filters are verified before implementing reliable missed-roll backfill.
- [ ] Foundry localhost connection works from the user's actual hosting setup (local Foundry, hosted Foundry, or The Forge).

**Fallback:** if the exchange or WebSocket cannot be made to work from the bridge, do not attempt to work around authentication controls. Reassess a user-supplied short-lived token or supported D&D Beyond integration before adding more code.
