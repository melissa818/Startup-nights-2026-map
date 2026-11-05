// GET /visitors/me · callers: ["Visitor"]
// The signed-in visitor's own profile, whether they are a host (their email is listed in the
// HOST_EMAILS secret; hosts read feedback) and which terms they accepted.
async function handler(ctx) {
  const me = await ctx.db.Visitor.get(ctx.principal);
  // A session whose account was deleted (by its owner or the retention cleanup) is signed out.
  if (!me) return ctx.json(401, { error: 'Unauthorized', detail: 'This account no longer exists.' });
  let hosts = '';
  try { hosts = String(ctx.secrets.HOST_EMAILS || ''); } catch (e) { hosts = ''; }
  const host = hosts.toLowerCase().split(/[\s,;]+/).filter(Boolean).includes(String(me.email || '').toLowerCase());
  return ctx.ok({
    id: me.id,
    email: me.email,
    own_startup: me.own_startup || null,
    welcomed: me.welcomed === true,
    host,
    terms_version: me.terms_version || null,
    terms_accepted_at: Number(me.terms_accepted_at) || null,
  });
}
