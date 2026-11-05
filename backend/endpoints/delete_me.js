// DELETE /visitors/me?confirm=delete-my-account · callers: ["Visitor"]
// input: [{ name: "confirm", type: "string", required: true, in: "query" }]
// Permanently delete the signed-in visitor's account with all their booth marks, notes, visitor
// notes, general notes and chat messages (with their photos), then sign them out.
async function handler(ctx) {
  if (ctx.query.confirm !== 'delete-my-account') {
    ctx.badRequest('To delete your account, confirm with confirm=delete-my-account.');
  }
  const me = await ctx.db.Visitor.get(ctx.principal);
  if (!me) ctx.notFound();

  // Their public chat messages go too (deleting a row deletes its photo); live readers are told.
  const said = await ctx.db.ChatMessage.list({ where: { author: ctx.principal, published: true, deleted: false }, limit: 5000 });

  // Children first (they point at the Visitor row). Policies limit each delete to the caller's own rows.
  const marks = await ctx.db.BoothMark.deleteWhere({ visitor: ctx.principal });
  const notes = await ctx.db.BoothNote.deleteWhere({ owner: ctx.principal });
  const generalNotes = await ctx.db.Note.deleteWhere({ owner: ctx.principal });
  const chatReports = await ctx.db.ChatReport.deleteWhere({ reporter: ctx.principal });
  const chatMessages = await ctx.db.ChatMessage.deleteWhere({ author: ctx.principal });
  await ctx.db.Visitor.delete(ctx.principal);

  if (said.length) {
    await ctx.realtime.publish('chat/public', { chat: 1, type: 'deleted', ids: said.map((r) => r.id), changed_at: Date.now() });
  }
  ctx.log('account deleted', { name: 'account.deleted', marks, notes, generalNotes, chatMessages, chatReports });
  return ctx.auth.logout(ctx.ok({ deleted: true, marks, notes, generalNotes, chatMessages, chatReports }));
}
