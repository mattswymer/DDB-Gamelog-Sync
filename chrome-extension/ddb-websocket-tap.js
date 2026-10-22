// ddb-websocket-tap.js - Runs in the MAIN world to tap D&D Beyond game-log WebSockets
(function () {
    'use strict';

    // Verify we are on a D&D Beyond domain
    if (!window.location.hostname.includes('dndbeyond.com')) return;

    const TARGET_SUBSTRING = 'game-log'; // Matches the game-log WebSocket endpoint

    const NativeWebSocket = window.WebSocket;

    window.WebSocket = function (url, protocols) {
        const ws = protocols ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);

        // Check if this WebSocket connection is the game-log service
        if (typeof url === 'string' && url.includes(TARGET_SUBSTRING)) {
            ws.addEventListener('message', function (event) {
                try {
                    // Ensure the message is valid JSON
                    const data = JSON.parse(event.data);
                    
                    // Filter out non-dice or unwanted frame types early if needed
                    if (data && data.eventType) {
                        window.postMessage({
                            source: 'ddb-roll-bridge-tap',
                            payload: data
                        }, window.location.origin);
                    }
                } catch (err) {
                    // Silent fail for non-JSON or malformed frames to keep page stable
                }
            });
        }

        return ws;
    };

    // Preserve static properties/prototype of the native WebSocket
    window.WebSocket.prototype = NativeWebSocket.prototype;
    Object.defineProperties(window.WebSocket, Object.getOwnPropertyDescriptors(NativeWebSocket));
})(window);