/**
 * Rebuild a Foundry Roll from D&D Beyond's recorded die values.
 * This module intentionally never calls evaluate() or rolls any dice.
 */
function facesFromType(type) {
  const match = String(type || "").match(/d(\d+)/i);
  return match ? Number(match[1]) : 20;
}

function advantageSelection(roll) {
  const kind = String(roll.rollKind || "").toLowerCase();
  // Check disadvantage first: "disadvantage" contains the word "advantage".
  if (kind.includes("disadvantage")) return "low";
  if (kind.includes("advantage")) return "high";
  return null;
}

export function buildRecordedRoll(rollData) {
  const notation = rollData.diceNotation || {};
  const sets = Array.isArray(notation.set) ? notation.set : [];
  const values = Array.isArray(rollData.values) ? [...rollData.values] : [];
  const terms = [];
  let valueIndex = 0;
  const selection = advantageSelection(rollData);

  for (const set of sets) {
    const count = Math.max(0, Number(set.count) || 0);
    const faces = facesFromType(set.dieType);
    if (!count || !faces) continue;
    const dieValues = values.slice(valueIndex, valueIndex + count);
    valueIndex += count;
    if (dieValues.length !== count) continue;
    if (terms.length) terms.push(new foundry.dice.terms.OperatorTerm({ operator: "+" }));
    const chosen = selection && count > 1 ? (selection === "high" ? Math.max(...dieValues) : Math.min(...dieValues)) : null;
    const die = new foundry.dice.terms.Die({
      number: count,
      faces,
      modifiers: selection && count > 1 ? [selection === "high" ? "kh" : "kl"] : [],
      results: dieValues.map(result => ({ result, active: chosen === null || result === chosen }))
    });
    die._evaluated = true;
    terms.push(die);
  }

  const constant = Number(notation.constant || 0);
  if (constant !== 0 || !terms.length) {
    if (terms.length) terms.push(new foundry.dice.terms.OperatorTerm({ operator: constant < 0 ? "-" : "+" }));
    terms.push(new foundry.dice.terms.NumericTerm({ number: Math.abs(constant) }));
  }
  // Roll.fromTerms requires every term to have the same evaluation state.
  // The dice above contain recorded results, so mark operators/constants evaluated too.
  for (const term of terms) term._evaluated = true;
  const roll = Roll.fromTerms(terms);
  if (Number.isFinite(rollData.total)) roll._total = rollData.total;
  else roll._total = null;
  roll._evaluated = true;
  return roll;
}
