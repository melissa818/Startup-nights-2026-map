// PUT /notes · callers: ["Visitor"]
// input: [{ name: "notes", type: "object", required: true }]
//   notes = { "<client id>": { text, created_at, changed_at, deleted } }
// Save the signed-in visitor's general notes (create, edit or delete). Merges by changed_at so the
// newest edit wins (deleted: true is a tombstone that syncs to other devices); answers the full list.
async function handler(ctx) {
  const input = ctx.body.notes;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    ctx.badRequest('notes must be an object keyed by note id.');
  }
  const entries = Object.entries(input);
  if (entries.length > 500) ctx.badRequest('At most 500 notes per request.');
  const time = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : Date.now();
  };

  const byId = new Map();
  for (const [id, n] of entries) {
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) ctx.badRequest(`Invalid note id: ${id.slice(0, 64)}`);
    if (!n || typeof n !== 'object') ctx.badRequest(`Note ${id} must be an object.`);
    const text = n.text == null ? '' : String(n.text);
    if (text.length > 8000) ctx.badRequest('A note can be at most 8000 characters.');
    byId.set(id, {
      client_id: id,
      text,
      created_at: time(n.created_at),
      changed_at: time(n.changed_at),
      deleted: n.deleted === true,
    });
  }

  if (byId.size > 0) {
    // One query for what is stored already (Note.read keeps it to this visitor's rows).
    const stored = await ctx.db.Note.list({ where: { client_id: { in: [...byId.keys()] } }, limit: 1000 });
    const storedAt = new Map(stored.map((r) => [r.client_id, Number(r.changed_at) || 0]));
    const newer = [...byId.values()]
      .filter((n) => !storedAt.has(n.client_id) || n.changed_at > storedAt.get(n.client_id))
      .map((n) => ({ ...n, owner: ctx.principal }));
    if (newer.length > 0) await ctx.db.Note.upsertMany(newer, ['owner', 'client_id']);
  }

  const rows = await ctx.db.Note.list({ limit: 2000, orderBy: { field: 'created_at', dir: 'desc' } });
  return ctx.ok({
    notes: rows.map((r) => ({
      id: r.client_id,
      text: r.text || '',
      created_at: Number(r.created_at) || 0,
      changed_at: Number(r.changed_at) || 0,
      deleted: r.deleted === true,
    })),
  });
}
