# DDB Gamelog Sync local bridge

The local bridge performs the D&D Beyond CobaltSession token exchange and forwards completed game-log events to the Foundry v13 module. It binds to `127.0.0.1` only.

## End-user install

1. Download the standalone Windows executable from the repository's GitHub Actions artifact or Releases page once a build has passed.
2. Run it and leave its console window open. Copy the local bridge access token printed at startup.
3. In Foundry v13, enable **DDB Gamelog Sync** and open its module settings.
4. Enter the numeric campaign ID, CobaltSession cookie value, and local bridge access token. Save and select **Connect**.
5. Verify that the module status changes to connected, then make one new D&D Beyond roll.

Never share the CobaltSession cookie or local bridge access token. The cookie is held in the bridge's process memory; closing the bridge clears it.

## Developer tests

With Node.js 20 or newer installed:

```sh
cd direct-bridge
npm test
```

End users do not need Node.js or npm when using the packaged executable. Live authentication and WebSocket behavior must still be tested against a real D&D Beyond session.
