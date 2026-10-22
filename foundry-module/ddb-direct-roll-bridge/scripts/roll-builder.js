function dieFaces(type) {
  const match = String(type || "").match(/d(\d+)/i);
  return match ? Number(match[1]) : 20;
}

function termDie(type, values, rollKind) {
  const faces = dieFaces(type);
  const chosen = rollKind === "advantage" ? Math.max(...values)
    : rollKind === "disadvantage" ? Math.min(...values) : null;
  const results = values.map(result => ({
    result,
    active: chosen === null || result === chosen
  }));
  const die = new foundry.dice.terms.Die({ number: values.length, faces });
  die.results = results;
  die._evaluated = true;
  return die;
}

export function buildRecordedRoll(data) {
  const terms = [];
  for (const die of data.dice || []) {
    if (terms.length) terms.push(new foundry.dice.terms.OperatorTerm({ operator: "+" }));
    terms.push(termDie(die.type, die.values, data.rollKind));
  }
  if (data.constant !== 0 || !terms.length) {
    if (terms.length) terms.push(new foundry.dice.terms.OperatorTerm({ operator: data.constant < 0 ? "-" : "+" }));
    terms.push(new foundry.dice.terms.NumericTerm({ number: Math.abs(data.constant || 0) }));
  }
  const roll = Roll.fromTerms(terms);
  const calculated = (data.dice || []).reduce((sum, die) => {
    const vals = die.values;
    if (data.rollKind === "advantage" && vals.length > 1) return sum + Math.max(...vals);
    if (data.rollKind === "disadvantage" && vals.length > 1) return sum + Math.min(...vals);
    return sum + vals.reduce((a, b) => a + b, 0);
  }, Number(data.constant || 0));
  roll._total = Number.isFinite(data.total) ? data.total : calculated;
  roll._evaluated = true;
  return roll;
}

export function dnd5eRollFlag(rollType) {
  const type = String(rollType || "").toLowerCase();
  if (type.includes("attack") || type.includes("to hit")) return "attack";
  if (type.includes("damage")) return "damage";
  if (type.includes("save")) return "save";
  if (type.includes("check") || type.includes("skill")) return "skill";
  if (type.includes("heal")) return "healing";
  if (type.includes("ability")) return "ability";
  return null;
}
