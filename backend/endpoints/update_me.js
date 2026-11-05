// PATCH /visitors/me · callers: ["Visitor"]
// input: [{ name: "own_startup", type: "string" }, { name: "welcomed", type: "boolean" },
//         { name: "display_name", type: "string" }]
// Update the signed-in visitor's profile: the startup whose booth they staff (empty to clear),
// whether they have seen the first-login welcome, and their public chat name.
async function handler(ctx) {
  const patch = {};
  if (ctx.body.own_startup !== undefined) {
    const own = String(ctx.body.own_startup || '').trim();
    if (own && !/^[a-z0-9-]{1,80}$/.test(own)) ctx.badRequest('Invalid startup id.');
    patch.own_startup = own || null;
  }
  if (ctx.body.welcomed !== undefined) patch.welcomed = ctx.body.welcomed === true;
  if (ctx.body.display_name !== undefined) {
    // Shown publicly in the chat: one line, no control characters, 2-30 characters.
    const name = String(ctx.body.display_name || '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 30) ctx.badRequest('Your chat name needs 2 to 30 characters.');
    patch.display_name = name;
  }
  if (Object.keys(patch).length === 0) ctx.badRequest('Nothing to update.');

  // Visitor.update only allows a visitor to change their own row.
  const me = await ctx.db.Visitor.update(ctx.principal, patch);
  if (!me) ctx.notFound();
  let hosts = '';
  try { hosts = String(ctx.secrets.CHAT_MODERATORS || ''); } catch (e) { hosts = ''; }
  const host = hosts.toLowerCase().split(/[\s,;]+/).filter(Boolean).includes(String(me.email || '').toLowerCase());
  return ctx.ok({
    id: me.id,
    email: me.email,
    own_startup: me.own_startup || null,
    welcomed: me.welcomed === true,
    display_name: me.display_name || '',
    chat_host: host,
  });
}
