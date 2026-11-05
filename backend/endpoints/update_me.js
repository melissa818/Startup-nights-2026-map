// PATCH /visitors/me · callers: ["Visitor"]
// input: [{ name: "own_startup", type: "string" }, { name: "welcomed", type: "boolean" }]
// Update the signed-in visitor's profile: the startup whose booth they staff (empty to clear)
// and whether they have seen the first-login welcome.
async function handler(ctx) {
  const patch = {};
  if (ctx.body.own_startup !== undefined) {
    const own = String(ctx.body.own_startup || '').trim();
    if (own && !/^[a-z0-9-]{1,80}$/.test(own)) ctx.badRequest('Invalid startup id.');
    patch.own_startup = own || null;
  }
  if (ctx.body.welcomed !== undefined) patch.welcomed = ctx.body.welcomed === true;
  if (Object.keys(patch).length === 0) ctx.badRequest('Nothing to update.');

  // Visitor.update only allows a visitor to change their own row.
  const me = await ctx.db.Visitor.update(ctx.principal, patch);
  if (!me) ctx.notFound();
  return ctx.ok({
    id: me.id,
    email: me.email,
    own_startup: me.own_startup || null,
    welcomed: me.welcomed === true,
  });
}
