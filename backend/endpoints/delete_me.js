// DELETE /visitors/me?confirm=delete-my-account · callers: ["Visitor"]
// input: [{ name: "confirm", type: "string", required: true, in: "query" }]
// Permanently delete the signed-in visitor's account with all their booth marks, notes and
// visitor notes, then sign them out.
async function handler(ctx) {
  if (ctx.query.confirm !== 'delete-my-account') {
    ctx.badRequest('To delete your account, confirm with confirm=delete-my-account.');
  }
  const me = await ctx.db.Visitor.get(ctx.principal);
  if (!me) ctx.notFound();

  // Children first (they point at the Visitor row). Policies limit each delete to the caller's own rows.
  const marks = await ctx.db.BoothMark.deleteWhere({ visitor: ctx.principal });
  const notes = await ctx.db.BoothNote.deleteWhere({ owner: ctx.principal });
  await ctx.db.Visitor.delete(ctx.principal);

  ctx.log('account deleted', { name: 'account.deleted', marks, notes });
  return ctx.auth.logout(ctx.ok({ deleted: true, marks, notes }));
}
