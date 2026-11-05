// GET /booth-notes · callers: ["Visitor"]
// The signed-in exhibitor's own notes about people who visited their booth. Private to the author.
async function handler(ctx) {
  // BoothNote.read only lets a visitor see notes they wrote.
  const rows = await ctx.db.BoothNote.list({ limit: 2000, orderBy: { field: 'created_at', dir: 'desc' } });
  return ctx.ok({
    notes: rows.map((r) => ({
      id: r.client_id,
      startup: r.startup,
      person: r.person || '',
      contact: r.contact || '',
      note: r.note || '',
      created_at: Number(r.created_at) || 0,
      changed_at: Number(r.changed_at) || 0,
      deleted: r.deleted === true,
    })),
  });
}
