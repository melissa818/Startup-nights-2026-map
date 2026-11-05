// POST /chat/messages/:id/report · callers: ["Visitor"]
// input: [{ name: "id", in: "path" }, { name: "reason", type: "string", required: true },
//         { name: "detail", type: "string" }]
//   reason: personal | photo | harassment | illegal | spam | other
// Report a public chat message (once per person) with a reason. Hosts see the count; at 3 reports
// from different people the message and its photo are removed automatically.
async function handler(ctx) {
  const REASONS = ['personal', 'photo', 'harassment', 'illegal', 'spam', 'other'];
  const AUTO_REMOVE_AT = 3;
  const reason = String(ctx.body.reason || '');
  if (!REASONS.includes(reason)) ctx.badRequest(`reason must be one of: ${REASONS.join(', ')}.`);
  const detail = String(ctx.body.detail || '').replace(/\s+/g, ' ').trim().slice(0, 500);

  const row = await ctx.db.ChatMessage.get(ctx.params.id);
  if (!row || row.deleted === true || row.published !== true) ctx.notFound();
  const authorId = typeof row.author === 'object' && row.author ? row.author.id : row.author;
  if (authorId === ctx.principal) ctx.badRequest('This is your own message: you can delete it instead.');

  const now = Date.now();
  // One report per person and message (ChatReport.create: the reporter is the caller).
  await ctx.db.ChatReport.insertMany(
    [{ message_id: row.id, reporter: ctx.principal, reason, detail, created_at: now }],
    { skipExisting: ['message_id', 'reporter'] },
  );
  // Counting everyone's reports needs to look past the caller's own rows; only the number leaves here.
  const reports = (await ctx.db.ChatReport.list({ where: { message_id: row.id }, limit: 50, policy: false })).length;

  if (reports >= AUTO_REMOVE_AT) {
    if (row.image) {
      try { await ctx.files.delete(row.image); } catch (e) { ctx.log.warn('photo delete failed', { id: row.id }); }
    }
    await ctx.db.ChatMessage.update(row.id, { deleted: true, text: '', image: null, reports, changed_at: now }, { policy: false });
    ctx.log('chat message removed after reports', { name: 'chat.auto_removed', id: row.id, reports });
    await ctx.realtime.publish('chat/public', { chat: 1, type: 'deleted', id: row.id, changed_at: now });
    return ctx.ok({ reported: true, reports, removed: true });
  }

  await ctx.db.ChatMessage.update(row.id, { reports, changed_at: now }, { policy: false });
  ctx.log('chat message reported', { name: 'chat.reported', id: row.id, reason, reports });
  await ctx.realtime.publish('chat/public', { chat: 1, type: 'reported', id: row.id, reports, changed_at: now });
  return ctx.ok({ reported: true, reports, removed: false });
}
