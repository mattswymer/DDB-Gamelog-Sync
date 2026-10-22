// background.js - Manages roll routing and cross-source deduplication
const seenRollIds = new Set();
const MAX_SEEN = 100;

function isDuplicate(rollId) {
    if (!rollId) return false;
    if (seenRollIds.has(rollId)) return true;
    seenRollIds.add(rollId);
    if (seenRollIds.size > MAX_SEEN) {
        const first = seenRollIds.values().next().value;
        seenRollIds.delete(first);
    }
    return false;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DDB_ROLL_BRIDGE_FOUND_ROLL') {
        const roll = message.roll;

        // Deduplicate based on roll ID
        if (isDuplicate(roll.id)) {
            return;
        }

        // Broadcast to all connected Foundry tabs
        chrome.tabs.query({}, (tabs) => {
            for (const tab of tabs) {
                // Look for Foundry URLs (localhost, forge-vtt, 127.0.0.1, etc.)
                if (tab.url && (tab.url.includes('forge-vtt.com') || tab.url.includes('localhost') || tab.url.includes('127.0.0.1'))) {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'DDB_FORWARD_ROLL_TO_FOUNDRY',
                        roll: roll
                    }).catch(() => {
                        // Ignore errors if the content script isn't active on a given tab
                    });
                }
            }
        });
    }
});