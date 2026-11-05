// PATCH /visitors/me · callers: ["Visitor"]
// input: [{ name: "own_startup", type: "string" }, { name: "welcomed", type: "boolean" },
//         { name: "accept_terms", type: "string" }]
// Update the signed-in visitor's profile: the startup whose booth they staff (empty to clear),
// whether they have seen the first-login welcome, and acceptance of the current terms of use and
// privacy policy (accept_terms = the version, which is recorded with the time).
async function handler(ctx) {
  const TERMS = '2026-11-05b'; // the version of the terms of use and privacy policy in force
  const patch = {};
  if (ctx.body.own_startup !== undefined) {
    const own = String(ctx.body.own_startup || '').trim();
    if (own && !/^[a-z0-9-]{1,80}$/.test(own)) ctx.badRequest('Invalid startup id.');
    patch.own_startup = own || null;
  }
  if (ctx.body.welcomed !== undefined) patch.welcomed = ctx.body.welcomed === true;
  if (ctx.body.accept_terms !== undefined) {
    if (ctx.body.accept_terms !== TERMS) ctx.badRequest(`The current terms are version ${TERMS}. Reload the page and accept them again.`);
    patch.terms_version = TERMS;
    patch.terms_accepted_at = Date.now();
  }
  if (Object.keys(patch).length === 0) ctx.badRequest('Nothing to update.');

  // Visitor.update only allows a visitor to change their own row.
  const me = await ctx.db.Visitor.update(ctx.principal, patch);
  if (!me) ctx.notFound();
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
