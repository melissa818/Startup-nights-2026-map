// GET /notes · callers: ["Visitor"]
// The signed-in visitor's general notes (not tied to a startup), newest first. Private to the author.
async function handler(ctx) {
  // Note.read only lets a visitor see notes they wrote.
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
