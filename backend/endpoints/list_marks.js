// GET /marks · callers: ["Visitor"]
// The signed-in visitor's booth marks: which startups they visited or starred, and their notes.
async function handler(ctx) {
  // BoothMark.read only lets a visitor see their own rows.
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
