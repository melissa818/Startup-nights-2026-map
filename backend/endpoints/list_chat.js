// GET /chat/messages · callers: ["*"]
// input (query): after (number), before (number), ids (string)
// The public live chat: the latest messages, older ones (before), changes since a time (after,
// includes removals), or given ids. Anyone may read; a signed-in caller is also granted the
// realtime channel chat/public.
async function handler(ctx) {
  const PAGE = 60;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const after = num(ctx.query.after);
  const before = num(ctx.query.before);
  const ids = String(ctx.query.ids || '').split(',').map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 50);

  // ChatMessage.read lets anyone read published messages (and authors their own drafts);
  // every query below also asks for published ones only.
  let rows;
  let more = false;
  if (ids.length) {
    rows = await ctx.db.ChatMessage.list({ where: { id: { in: ids }, published: true }, limit: 50 });
  } else if (after) {
    rows = await ctx.db.ChatMessage.list({
      where: { published: true, changed_at: { gte: after } },
      orderBy: { field: 'changed_at', dir: 'asc' }, limit: 200,
    });
  } else {
    rows = await ctx.db.ChatMessage.list({
      where: { published: true, deleted: false, ...(before ? { created_at: { lt: before } } : {}) },
      orderBy: { field: 'created_at', dir: 'desc' }, limit: PAGE + 1,
    });
    more = rows.length > PAGE;
    rows = rows.slice(0, PAGE).reverse();
  }

  // Signed-in readers hear new messages live; anonymous ones poll this endpoint.
  if (ctx.principal) await ctx.realtime.allow('chat/public');

  const view = async (r) => {
    const gone = r.deleted === true;
    let image = null;
    if (!gone && r.image) {
      try {
        image = { url: await ctx.files.getUrl(r.image), w: Number(r.image_w) || 0, h: Number(r.image_h) || 0 };
      } catch (e) {
        image = null;
      }
    }
    return {
      id: r.id,
      author: typeof r.author === 'object' && r.author ? r.author.id : r.author,
      name: gone ? '' : r.name || '',
      host: r.host === true,
      text: gone ? '' : r.text || '',
      image,
      created_at: Number(r.created_at) || 0,
      changed_at: Number(r.changed_at) || 0,
      deleted: gone,
    };
  };
  const messages = await Promise.all(rows.map(view));
  return ctx.ok({ messages, more, now: Date.now() });
}
