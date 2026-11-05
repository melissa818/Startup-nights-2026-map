// PUT /marks · callers: ["Visitor"]
// input: [{ name: "marks", type: "object", required: true }]
//   marks = { "<startup-id>": { visited, interested, note, changed_at } }
// Save the signed-in visitor's booth marks. Merges by changed_at so the newest edit wins;
// answers the full merged list.
async function handler(ctx) {
  const input = ctx.body.marks;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    ctx.badRequest('marks must be an object keyed by startup id.');
  }
  const entries = Object.entries(input);
  if (entries.length > 400) ctx.badRequest('At most 400 marks per request.');

  // Validate and normalise.
  const byStartup = new Map();
  for (const [startup, m] of entries) {
    if (!/^[a-z0-9-]{1,80}$/.test(startup)) ctx.badRequest(`Invalid startup id: ${startup.slice(0, 80)}`);
    if (!m || typeof m !== 'object') ctx.badRequest(`Mark for ${startup} must be an object.`);
    const note = m.note == null ? '' : String(m.note);
    if (note.length > 4000) ctx.badRequest('A note can be at most 4000 characters.');
    const changed = Number(m.changed_at);
    byStartup.set(startup, {
      startup,
      visited: m.visited === true,
      interested: m.interested === true,
      note,
      changed_at: Number.isFinite(changed) && changed > 0 ? Math.floor(changed) : Date.now(),
    });
  }

  if (byStartup.size > 0) {
    // One query for what is stored already (BoothMark.read keeps it to this visitor's rows).
    const stored = await ctx.db.BoothMark.list({
      where: { startup: { in: [...byStartup.keys()] } },
      limit: 1000,
    });
    const storedAt = new Map(stored.map((r) => [r.startup, Number(r.changed_at) || 0]));
    // Newest edit wins, so an old offline change never overwrites a newer one from another device.
    const newer = [...byStartup.values()]
      .filter((m) => !storedAt.has(m.startup) || m.changed_at > storedAt.get(m.startup))
      .map((m) => ({ ...m, visitor: ctx.principal }));
    if (newer.length > 0) {
      await ctx.db.BoothMark.upsertMany(newer, ['visitor', 'startup']);
    }
  }

  const rows = await ctx.db.BoothMark.list({ limit: 1000 });
  return ctx.ok({
    marks: rows.map((r) => ({
      startup: r.startup,
      visited: !!r.visited,
      interested: !!r.interested,
      note: r.note || '',
      changed_at: Number(r.changed_at) || 0,
    })),
  });
}
