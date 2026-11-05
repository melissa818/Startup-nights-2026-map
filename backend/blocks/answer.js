// Block answer · input: text (string, required), startup_ids (string), place_ids (string), feedback_saved (boolean)
// The agent's final answer (a response-mode tool: it ends the turn). Ids are comma-separated and
// checked here; the app shows each as a "Show on map" card.
async function block(input, ctx) {
  const ids = (v, max) => String(v || '').split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^[a-z0-9-]{1,80}$/.test(s)).slice(0, max);
  return {
    text: String((input && input.text) || '').trim().slice(0, 2000),
    startups: ids(input.startup_ids, 6),
    places: ids(input.place_ids, 3),
    feedback_saved: input.feedback_saved === true,
  };
}
