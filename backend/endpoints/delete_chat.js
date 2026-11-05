// DELETE /chat/messages/:id · callers: ["Visitor"]
// input: [{ name: "id", type: "string", in: "path" }]
// Remove a chat message: its author may remove their own, a chat host (email listed in the
// CHAT_MODERATORS secret) any. The photo is deleted; a tombstone tells readers to hide it.
async function handler(ctx) {
  const row = await ctx.db.ChatMessage.get(ctx.params.id);
  if (!row || row.deleted === true) ctx.notFound();
  const authorId = typeof row.author === 'object' && row.author ? row.author.id : row.author;
  const mine = authorId === ctx.principal;

  if (!mine) {
    const me = await ctx.db.Visitor.get(ctx.principal);
    let hosts = '';
    try { hosts = String(ctx.secrets.CHAT_MODERATORS || ''); } catch (e) { hosts = ''; }
    const host = !!me && hosts.toLowerCase().split(/[\s,;]+/).filter(Boolean).includes(String(me.email || '').toLowerCase());
    if (!host) ctx.forbid();
  }

  const now = Date.now();
  if (row.image) {
    try { await ctx.files.delete(row.image); } catch (e) { ctx.log.warn('photo delete failed', { id: row.id }); }
  }
  const patch = { deleted: true, text: '', image: null, changed_at: now };
  // ChatMessage.update covers an author's own message; a host removing someone else's is checked above.
  if (mine) await ctx.db.ChatMessage.update(row.id, patch);
  else await ctx.db.ChatMessage.update(row.id, patch, { policy: false });

  ctx.log('chat message removed', { name: 'chat.removed', id: row.id, by: mine ? 'author' : 'host' });
  if (row.published === true) {
    await ctx.realtime.publish('chat/public', { chat: 1, type: 'deleted', id: row.id, changed_at: now });
  }
  return ctx.ok({ deleted: true, id: row.id });
}
