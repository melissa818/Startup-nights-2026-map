// POST /chat/messages · callers: ["Visitor"]
// input: [{ name: "text", type: "string" }, { name: "image", type: "object" }]
//   image = { contentType: image/jpeg|image/png|image/webp, w, h }
// Post to the public live chat as the signed-in visitor (under their chat name). Text goes out at
// once; a photo answers an upload URL (PUT the bytes there, then POST /chat/messages/:id/publish).
// At most 8 messages a minute.
async function handler(ctx) {
  const me = await ctx.db.Visitor.get(ctx.principal);
  if (!me) ctx.notFound();
  const name = String(me.display_name || '').trim();
  if (!name) ctx.badRequest('Choose a chat name first.');

  const text = String(ctx.body.text || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > 1000) ctx.badRequest('A message can be at most 1000 characters.');

  let image = null;
  const img = ctx.body.image;
  if (img != null) {
    if (typeof img !== 'object' || Array.isArray(img)) ctx.badRequest('image must be an object.');
    const type = String(img.contentType || '');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) ctx.badRequest('Photos must be JPEG, PNG or WebP.');
    const w = Math.round(Number(img.w));
    const h = Math.round(Number(img.h));
    if (!(w > 0 && w <= 4096 && h > 0 && h <= 4096)) ctx.badRequest('Invalid photo size.');
    image = { type, w, h };
  }
  if (!text && !image) ctx.badRequest('Write a message or add a photo.');

  const now = Date.now();
  // Keep the room readable: at most 8 messages a minute per person.
  const recent = await ctx.db.ChatMessage.list({ where: { author: ctx.principal, created_at: { gt: now - 60000 } }, limit: 8 });
  if (recent.length >= 8) {
    return ctx.json(429, { error: 'Too many messages', detail: 'You are sending messages very fast. Try again in a minute.' });
  }
  // Photo messages whose upload never finished.
  await ctx.db.ChatMessage.deleteWhere({ author: ctx.principal, published: false, created_at: { lt: now - 15 * 60000 } });

  let hosts = '';
  try { hosts = String(ctx.secrets.CHAT_MODERATORS || ''); } catch (e) { hosts = ''; }
  const host = hosts.toLowerCase().split(/[\s,;]+/).filter(Boolean).includes(String(me.email || '').toLowerCase());

  const row = await ctx.db.ChatMessage.insert({
    author: ctx.principal,
    name: name.slice(0, 40),
    text,
    host,
    published: !image,
    deleted: false,
    created_at: now,
    changed_at: now,
    ...(image ? { image_w: image.w, image_h: image.h } : {}),
  });

  if (image) {
    const ext = image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg';
    const up = await ctx.files.uploadUrl({
      model: 'ChatMessage', id: row.id, field: 'image',
      name: `photo-${String(row.id).slice(0, 8)}.${ext}`, contentType: image.type,
    });
    await ctx.db.ChatMessage.update(row.id, { image: up.file });
    return ctx.created({ id: row.id, pending: true, uploadUrl: up.uploadUrl, contentType: image.type });
  }

  const message = {
    id: row.id, author: ctx.principal, name: row.name, host, text, image: null,
    created_at: now, changed_at: now, deleted: false,
  };
  await ctx.realtime.publish('chat/public', { chat: 1, type: 'message', message });
  return ctx.created({ message });
}
