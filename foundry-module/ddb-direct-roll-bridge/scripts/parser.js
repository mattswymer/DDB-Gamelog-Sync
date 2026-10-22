const ROLL_EVENT = "dice/roll/fulfilled";

function first(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "");
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDice(data) {
  const source = first(data?.dice, data?.rolls, data?.roll?.dice, []);
  if (!Array.isArray(source)) return [];
  return source.map(die => {
    const values = first(die?.values, die?.results, die?.rolls, []);
    return {
      type: String(first(die?.type, die?.diceType, die?.dieType, die?.notation, "d20")),
      values: (Array.isArray(values) ? values : [values])
        .map(v => asNumber(typeof v === "object" ? first(v?.value, v?.result) : v))
        .filter(v => v !== null)
    };
  }).filter(die => die.values.length);
}

export function isFulfilledRoll(message) {
  return message?.eventType === ROLL_EVENT && Boolean(message?.id);
}

export function parseRollEvent(message) {
  if (!isFulfilledRoll(message)) return null;
  const data = message.data || {};
  const roll = data.roll || data;
  const character = data.character || data.entity || {};
  const entityId = first(data.entityId, character.id, data.characterId, "");
  const entityType = String(first(data.entityType, data.entity?.type, "character"));
  const characterName = String(first(data.characterName, character.name, data.entityName, "Unknown Character"));
  const rollType = String(first(data.rollType, roll.rollType, data.type, "roll")).toLowerCase();
  const rollKindRaw = String(first(data.rollKind, roll.rollKind, data.advantageType, "")).toLowerCase();
  const operation = asNumber(first(data.operation, roll.operation));
  let rollKind = rollKindRaw;
  if (!rollKind && operation === 2) rollKind = "advantage";
  if (!rollKind && operation === 1) rollKind = "disadvantage";
  if (["normal", "none", "0"].includes(rollKind)) rollKind = "";
  const dice = normalizeDice(roll);
  const constant = asNumber(first(roll.constant, roll.modifier, data.constant, 0)) ?? 0;
  const total = asNumber(first(roll.total, roll.result, data.total, data.result));
  const action = String(first(data.action, data.actionName, data.name, roll.name, "Roll"));
  const scope = String(first(message.messageScope, data.messageScope, "gameId"));
  return {
    id: String(message.id),
    rollId: String(first(data.rollId, roll.rollId, message.rollId, message.id)),
    ts: first(message.timestamp, message.createdAt, data.timestamp, Date.now()),
    userId: String(first(message.userId, data.userId, data.actor?.userId, "")),
    entityId: String(entityId),
    entityType,
    characterName,
    action,
    rollType,
    rollKind,
    scope,
    dice,
    constant,
    total,
    raw: data
  };
}
