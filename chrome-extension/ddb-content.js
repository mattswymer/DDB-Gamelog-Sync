// ddb-content.js - Runs in the isolated world to bridge intercepted WebSocket rolls
(function () {
    'use strict';

    if (!window.location.hostname.includes('dndbeyond.com')) return;

    // Track when this script started listening to ignore historical replays
    const sessionStartTime = Date.now();
    
    // Bounded set to prevent processing the same roll ID twice in a session
    const seenRollIds = new Set();
    const MAX_SEEN_IDS = 100;

    function markSeen(id) {
        if (seenRollIds.has(id)) return true;
        seenRollIds.add(id);
        if (seenRollIds.size > MAX_SEEN_IDS) {
            const firstKey = seenRollIds.values().next().value;
            seenRollIds.delete(firstKey);
        }
        return false;
    }

    // Listen for messages from ddb-websocket-tap.js (MAIN world)
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        if (!event.data || event.data.source !== 'ddb-roll-bridge-tap') return;

        const rawMessage = event.data.payload;
        try {
            processGameLogMessage(rawMessage);
        } catch (err) {
            console.warn('[DDB Bridge] Error parsing game-log message:', err);
        }
    });

    function processGameLogMessage(msg) {
        // 1. Validate basic structure
        if (!msg || !msg.eventType || !msg.data) return;

        // 2. We only care about fulfilled rolls (ignore 'dice/roll/deferred')
        if (msg.eventType !== 'dice/roll/fulfilled') return;

        // 3. Skip history replay: Check if message timestamp is older than session start
        const msgTime = parseInt(msg.dateTime, 10);
        if (!isNaN(msgTime) && msgTime < sessionStartTime - 2000) {
            return; // Ignore historical frames loaded upon connection
        }

        const rollId = msg.data.rollId || msg.id;
        if (markSeen(rollId)) return; // Already processed this roll

        // 4. Normalize into a clean structured roll object
        const normalizedRoll = normalizeRoll(msg);
        if (!normalizedRoll) return;

        // 5. Forward to extension background script
        chrome.runtime.sendMessage({
            type: 'DDB_ROLL_BRIDGE_FOUND_ROLL',
            roll: normalizedRoll
        });
    }

    function normalizeRoll(msg) {
        const data = msg.data;
        const context = data.context || {};
        const primaryRoll = data.rolls && data.rolls[0] ? data.rolls[0] : {};

        return {
            id: data.rollId || msg.id,
            timestamp: parseInt(msg.dateTime, 10) || Date.now(),
            characterName: context.name || 'Unknown Character',
            entityId: context.entityId || null,
            actionName: data.action || 'Unknown Action',
            rollType: primaryRoll.rollType || 'roll', // e.g., check, save, to hit, damage, heal, roll
            rollKind: primaryRoll.rollKind || '', // normal, advantage, disadvantage
            formula: primaryRoll.result ? primaryRoll.result.text : '',
            total: primaryRoll.result ? primaryRoll.result.total : 0,
            dice: extractDiceDetails(primaryRoll),
            raw: msg // preserved for debugging/fallback
        };
    }

    function extractDiceDetails(rollObj) {
        if (!rollObj.diceNotation || !rollObj.diceNotation.set) return [];
        
        return rollObj.diceNotation.set.map(set => ({
            sides: set.dieType,
            count: set.count,
            operation: set.operation,
            results: set.dice ? set.dice.map(d => d.dieValue) : []
        }));
    }
})();