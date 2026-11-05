// GET /feedback · callers: ["Visitor"]
// The feedback people sent, newest first, for hosts only (signed-in visitors whose email is listed
// in the HOST_EMAILS secret). The sender's account is not shown, only a contact they chose to give.
async function handler(ctx) {
  const me = await ctx.db.Visitor.get(ctx.principal);
  let hosts = '';
  try { hosts = String(ctx.secrets.HOST_EMAILS || ''); } catch (e) { hosts = ''; }
  const host = !!me && hosts.toLowerCase().split(/[\s,;]+/).filter(Boolean).includes(String(me.email || '').toLowerCase());
  if (!host) ctx.forbid();

  // Hosts read everyone's feedback; feedback.read admits nobody else.
  const rows = await ctx.db.Feedback.list({ orderBy: { field: 'created_at', dir: 'desc' }, limit: 500, policy: false });
  return ctx.ok({
    feedback: rows.map((r) => ({
      id: r.id,
      message: r.message || '',
      rating: Number(r.rating) || null,
      contact: r.contact || '',
      source: r.source || '',
      signed_in: !!r.visitor,
      created_at: Number(r.created_at) || 0,
    })),
  });
}
