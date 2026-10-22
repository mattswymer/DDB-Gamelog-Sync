const MODULE_ID = "ddb-direct-roll-bridge";

export function findActor(data) {
  const actors = game.actors?.contents || [];
  if (data.entityId) {
    const linked = actors.find(actor => actor.getFlag(MODULE_ID, "ddbId") === String(data.entityId));
    if (linked) return linked;
  }
  const name = String(data.characterName || "").trim().toLocaleLowerCase();
  return name ? actors.find(actor => actor.name.trim().toLocaleLowerCase() === name) || null : null;
}

export function findFoundryUser(ddbUserId) {
  if (!ddbUserId) return null;
  return game.users?.contents?.find(user => String(user.getFlag(MODULE_ID, "ddbUserId") || "") === String(ddbUserId)) || null;
}

export async function linkActorDialog(data) {
  const actors = (game.actors?.contents || []).map(actor =>
    `<option value="${foundry.utils.escapeHTML(actor.id)}">${foundry.utils.escapeHTML(actor.name)}</option>`
  ).join("");
  const content = `<form><p>No Foundry Actor matches <strong>${foundry.utils.escapeHTML(data.characterName || "Unknown Character")}</strong>.</p><label>Link to Actor<select name="actorId" style="width:100%">${actors}</select></label><p>This stores the D&D Beyond character ID on the selected Actor.</p></form>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Link D&D Beyond Character" },
    content,
    ok: { label: "Link Actor", callback: (_event, button) => button.form?.elements?.actorId?.value },
    rejectClose: false
  });
  if (!result || !data.entityId) return null;
  const actor = game.actors.get(String(result));
  if (!actor) return null;
  await actor.setFlag(MODULE_ID, "ddbId", String(data.entityId));
  return actor;
}
