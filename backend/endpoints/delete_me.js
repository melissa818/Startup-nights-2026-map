// DELETE /visitors/me?confirm=delete-my-account · callers: ["Visitor"]
// input: [{ name: "confirm", type: "string", required: true, in: "query" }]
// Permanently delete the signed-in visitor's account with all their booth marks, notes, visitor
// notes, feedback and assistant usage records (and rows of the retired public chat), then sign them out.
async function handler(ctx) {
  if (ctx.query.confirm !== 'delete-my-account') {
    ctx.badRequest('To delete your account, confirm with confirm=delete-my-account.');
  }
  const me = await ctx.db.Visitor.get(ctx.principal);
  if (!me) ctx.notFound();

  // Children first (they point at the Visitor row). Policies limit each delete to the caller's own rows.
  const marks = await ctx.db.BoothMark.deleteWhere({ visitor: ctx.principal });
  const notes = await ctx.db.BoothNote.deleteWhere({ owner: ctx.principal });
  const generalNotes = await ctx.db.Note.deleteWhere({ owner: ctx.principal });
  const feedback = await ctx.db.Feedback.deleteWhere({ visitor: ctx.principal });
  const assistantUses = await ctx.db.AssistantUse.deleteWhere({ visitor: ctx.principal });
  // Rows from the retired public chat (deleting a message deletes its photo).
  const chatReports = await ctx.db.ChatReport.deleteWhere({ reporter: ctx.principal });
  const chatMessages = await ctx.db.ChatMessage.deleteWhere({ author: ctx.principal });
  await ctx.db.Visitor.delete(ctx.principal);

  const counts = { marks, notes, generalNotes, feedback, assistantUses, chatMessages, chatReports };
  ctx.log('account deleted', { name: 'account.deleted', ...counts });
  return ctx.auth.logout(ctx.ok({ deleted: true, ...counts }));
}
