// Flow "Retention cleanup" · trigger: schedule, cron "41 2 * * *" (daily, 02:41 UTC) · no URL
// Orchestrator retention_cleanup. Runs on staging and production once deployed; acts as the flow
// itself, which the delete policies of every model allow (rule: caller flow id = retention_cleanup).
async function orchestrate(event, ctx) {
  // The privacy policy promises: everything is deleted on 6 December 2026 (30 days after the event).
  // 00:00 on 6 Dec 2026 in Switzerland (CET, UTC+1). Runs daily, so anything created later goes too.
  const CUTOFF = Date.UTC(2026, 11, 5, 23, 0, 0);
  // `force` only reaches this flow from a test drive: it has no URL.
  const force = !!event && event.force === true;
  if (Date.now() < CUTOFF && !force) {
    return { skipped: true, until: new Date(CUTOFF).toISOString() };
  }

  // Every table, children before the Visitor rows they point at. Deleting a chat message deletes its photo.
  const all = { id: { null: false } };
  const deleted = {};
  deleted.chatReports = await ctx.db.ChatReport.deleteWhere(all);
  deleted.chatMessages = await ctx.db.ChatMessage.deleteWhere(all);
  deleted.boothMarks = await ctx.db.BoothMark.deleteWhere(all);
  deleted.boothNotes = await ctx.db.BoothNote.deleteWhere(all);
  deleted.notes = await ctx.db.Note.deleteWhere(all);
  deleted.visitors = await ctx.db.Visitor.deleteWhere(all);

  const total = Object.values(deleted).reduce((a, b) => a + (Number(b) || 0), 0);
  if (total > 0) ctx.log('retention cleanup', { name: 'retention.cleanup', ...deleted });
  if (deleted.chatMessages > 0) await ctx.realtime.publish('chat/public', { chat: 1, type: 'reset' });
  return { done: true, deleted };
}
