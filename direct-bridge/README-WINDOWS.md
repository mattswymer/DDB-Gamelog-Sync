# Windows quick start — no Node.js or npm required

Most users should download the prebuilt files from this repository's **Actions → Direct Bridge — tests and Windows download → latest successful run → Artifacts** rather than running commands.

The downloaded artifact contains:
- `DDB-Gamelog-Sync.exe` — the local service with its runtime and dependencies bundled.
- `ddb-roll-bridge-v2-foundry-module.zip` — the Foundry module folder.

## Run the helper

1. Extract the artifact ZIP to a folder you can find again.
2. Double-click `DDB-Gamelog-Sync.exe`. Windows may show a SmartScreen warning because this experimental build is not code-signed; only run it if you trust the repository and have reviewed the source.
3. Leave its console window open. It prints a randomly generated local access token. Keep that token private.
4. In Foundry, install the included module ZIP using your normal module upload/install workflow, enable **DDB Roll Bridge (Direct)**, then open the chat sidebar's **DDB Bridge** button.
5. Enter the token, your numeric D&D Beyond campaign ID, and your CobaltSession cookie value. The cookie is a session credential: never share it. It is held in the helper's memory and is not saved to disk.
6. Click **Connect**, then **Character Mapping** to associate D&D Beyond characters with Foundry actors.

The helper listens only on `127.0.0.1:39210`. Keep it running during the session. Closing the console stops the connection.

## If Windows blocks the executable

The build is not code-signed, so SmartScreen may warn. Do not bypass a warning unless you have confirmed that the file came from this project's GitHub Actions artifact and you are comfortable running it. Running from source with Node.js 20+ is an alternative for developers, but not the intended user workflow.

## Limitations

This is experimental and has not yet been end-to-end tested against a live D&D Beyond account and your Foundry/Forge setup. Browser private-network restrictions may prevent a hosted Foundry page from contacting localhost. The old extension-based implementation remains available as a fallback.
