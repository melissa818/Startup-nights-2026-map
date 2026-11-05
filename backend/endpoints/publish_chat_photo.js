// POST /chat/messages/:id/publish · callers: ["Visitor"]
// input: [{ name: "id", type: "string", in: "path" }]
// Publish the signed-in visitor's photo message once its upload has finished, and broadcast it
// to the live chat.
async function handler(ctx) {
  // ChatMessage.read lets an author see their own unpublished photo message.
  const row = await ctx.db.ChatMessage.get(ctx.params.id);
  const authorId = row && (typeof row.author === 'object' && row.author ? row.author.id : row.author);
  if (!row || authorId !== ctx.principal || row.deleted === true) ctx.notFound();
  if (!row.image) ctx.badRequest('This message has no photo to publish.');

  const view = async (r) => {
    let image = null;
    try {
      image = { url: await ctx.files.getUrl(r.image), w: Number(r.image_w) || 0, h: Number(r.image_h) || 0 };
    } catch (e) {
      image = null;
    }
    return {
      id: r.id, author: ctx.principal, name: r.name || '', host: r.host === true, text: r.text || '', image,
      created_at: Number(r.created_at) || 0, changed_at: Number(r.changed_at) || 0, deleted: false,
    };
  };
  if (row.published === true) return ctx.ok({ message: await view(row) });

  // Sent time is when it appears, so readers polling by time never miss it.
  const now = Date.now();
  const updated = await ctx.db.ChatMessage.update(row.id, { published: true, created_at: now, changed_at: now });
  const message = await view(updated || { ...row, published: true, created_at: now, changed_at: now });
  await ctx.realtime.publish('chat/public', { chat: 1, type: 'message', message });
  return ctx.ok({ message });
}
