import test from "node:test";
import assert from "node:assert/strict";
import { isFulfilledRoll, parseRollEvent } from "../../foundry-module/ddb-direct-roll-bridge/scripts/parser.js";

test("ignores deferred animation events", () => {
  assert.equal(isFulfilledRoll({ eventType: "dice/roll/deferred", id: "x" }), false);
  assert.equal(parseRollEvent({ eventType: "dice/roll/deferred", id: "x", data: {} }), null);
});

test("normalizes a completed roll and keeps the source ID", () => {
  const result = parseRollEvent({
    eventType: "dice/roll/fulfilled",
    id: "event-123",
    timestamp: 1720000000000,
    userId: 77,
    messageScope: "gameId",
    data: {
      rollId: "roll-456", entityId: 42, entityType: "character",
      characterName: "Test Hero", action: "Perception", rollType: "check",
      dice: [{ type: "d20", values: [17] }], constant: 5, total: 22
    }
  });
  assert.equal(result.id, "event-123");
  assert.equal(result.rollId, "roll-456");
  assert.equal(result.characterName, "Test Hero");
  assert.equal(result.action, "Perception");
  assert.deepEqual(result.dice, [{ type: "d20", values: [17] }]);
  assert.equal(result.total, 22);
});

test("maps operation 2 to advantage and operation 1 to disadvantage", () => {
  const base = { eventType: "dice/roll/fulfilled", id: "id", data: { operation: 2 } };
  assert.equal(parseRollEvent(base).rollKind, "advantage");
  assert.equal(parseRollEvent({ ...base, id: "id2", data: { operation: 1 } }).rollKind, "disadvantage");
});
