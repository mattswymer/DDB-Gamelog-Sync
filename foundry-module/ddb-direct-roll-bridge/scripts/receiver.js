// receiver.js - Runs inside Foundry VTT to create native rolls
window.addEventListener('message', async (event) => {
    // Ensure message comes from our extension content script
    if (!event.data || event.data.type !== 'DDB_FORWARD_ROLL_TO_FOUNDRY') return;

    const rollData = event.data.roll;
    await processNativeRollInFoundry(rollData);
});

async function processNativeRollInFoundry(rollData) {
    try {
        // 1. Reconstruct formula or term evaluation safely without re-rolling
        // DDB provides formula like "12+13" or "2+4+7" or "(19,20)+3"
        const formula = rollData.formula;
        if (!formula) return;

        // Create a Foundry Roll instance from the exact formula
        let roll = new Roll(formula);

        // Optional: If you want to force exact die results to match DDB's rolled values:
        // We can map rollData.dice results into the roll terms if needed, 
        // but passing the evaluated formula directly preserves the math.
        await roll.evaluate({ async: true });

        // 2. Resolve speaker (match characterName to an existing Actor in Foundry)
        let actor = game.actors.find(a => a.name.toLowerCase() === rollData.characterName.toLowerCase());
        let speaker = ChatMessage.getSpeaker({ actor: actor });

        // 3. Post to Foundry Chat with proper flags
        await roll.toMessage({
            speaker: speaker,
            flavor: `${rollData.actionName} (${rollData.rollType})`,
            flags: {
                "ddb-direct-roll-bridge": {
                    rollId: rollData.id,
                    rollType: rollData.rollType,
                    actionName: rollData.actionName
                }
            }
        });

    } catch (err) {
        console.error('[DDB Bridge] Failed to create native Foundry roll:', err);
    }
});