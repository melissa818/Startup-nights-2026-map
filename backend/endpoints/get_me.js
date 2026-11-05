// GET /visitors/me · callers: ["Visitor"]
// The signed-in visitor's own profile (id and email).
async function handler(ctx) {
  const me = await ctx.db.Visitor.get(ctx.principal);
  if (!me) ctx.notFound();
  return ctx.ok({ id: me.id, email: me.email });
}
